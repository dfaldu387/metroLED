/**
 * Background worker.
 *
 * Polls the Job table, claims due jobs with FOR UPDATE SKIP LOCKED and runs
 * them. Several workers can run side by side without duplicating work.
 *
 * Run with:  npm run worker
 *
 * In production this runs as a separate always-on process (or container)
 * alongside the web application. The scheduled work it performs is enqueued
 * either by the cron endpoints or by `--schedule` below.
 */

import 'dotenv/config'
import { prisma, databaseReachable } from '../src/lib/db'
import {
  claimNextJob,
  completeJob,
  enqueue,
  failJob,
  JOB_NAMES,
  newWorkerId,
  pruneJobs,
  QUEUES,
  reclaimStalledJobs,
} from '../src/lib/jobs/queue'
import { handlerFor } from '../src/lib/jobs/handlers'
import { briefJobKey, todaysBriefDate } from '../src/lib/brief/send'
import { loadSettings } from '../src/lib/data/dataset'

const POLL_INTERVAL_MS = 5_000
const IDLE_LOG_INTERVAL_MS = 5 * 60 * 1000

let shuttingDown = false

function log(message: string): void {
  console.info(`[worker ${new Date().toISOString()}] ${message}`)
}

async function runOnce(workerId: string): Promise<boolean> {
  const job = await claimNextJob(workerId)
  if (!job) return false

  const handler = handlerFor(job.name)
  if (!handler) {
    await failJob(job, new Error(`No handler is registered for job "${job.name}".`))
    log(`job ${job.id} (${job.name}) has no handler`)
    return true
  }

  const started = Date.now()
  log(`running ${job.name} (${job.id}), attempt ${job.attempts}/${job.maxAttempts}`)

  try {
    const summary = await handler(job.payload ?? {}, job)
    await completeJob(job.id)
    log(`done ${job.name} in ${Date.now() - started}ms: ${summary}`)
  } catch (error) {
    const outcome = await failJob(job, error)
    const message = error instanceof Error ? error.message : String(error)
    if (outcome.status === 'DEAD') {
      log(`FAILED PERMANENTLY ${job.name} (${job.id}) after ${job.attempts} attempts: ${message}`)
    } else {
      log(`failed ${job.name} (${job.id}): ${message} - retrying in ${Math.round((outcome.retryInMs ?? 0) / 1000)}s`)
    }
  }

  return true
}

/**
 * Enqueues the recurring work.
 *
 * Idempotency keys mean this is safe to call repeatedly: the daily brief is
 * keyed on its business date, so a second call the same morning is ignored
 * rather than sending a second email.
 */
async function scheduleRecurringWork(): Promise<void> {
  const settings = await loadSettings()
  const now = new Date()

  await enqueue({
    queue: QUEUES.SYNC,
    name: JOB_NAMES.SYNC_ALL,
    payload: {},
    idempotencyKey: `sync:${now.toISOString().slice(0, 13)}`,
  })

  if (settings.briefEnabled) {
    const briefDate = todaysBriefDate(now, settings.timezone)
    const result = await enqueue({
      queue: QUEUES.BRIEF,
      name: JOB_NAMES.SEND_BRIEF,
      payload: { briefDate: briefDate.toISOString().slice(0, 10) },
      idempotencyKey: briefJobKey(briefDate),
      maxAttempts: 3,
    })
    log(
      result.deduplicated
        ? `daily brief for ${briefDate.toISOString().slice(0, 10)} is already queued or sent`
        : `queued the daily brief for ${briefDate.toISOString().slice(0, 10)}`,
    )
  }
}

async function main(): Promise<void> {
  const workerId = newWorkerId()
  const scheduleOnly = process.argv.includes('--schedule')
  const once = process.argv.includes('--once')

  if (!(await databaseReachable(true))) {
    console.error(
      'The worker cannot start: DATABASE_URL is not set or the database is unreachable.\n' +
        'Set DATABASE_URL and run `npm run db:deploy` first.',
    )
    process.exit(1)
  }

  if (scheduleOnly) {
    await scheduleRecurringWork()
    log('recurring work enqueued')
    await prisma.$disconnect()
    return
  }

  log(`started as ${workerId}`)

  const reclaimed = await reclaimStalledJobs()
  if (reclaimed > 0) log(`reclaimed ${reclaimed} stalled jobs from a previous run`)

  let lastIdleLog = 0
  let lastPrune = 0

  while (!shuttingDown) {
    try {
      const worked = await runOnce(workerId)

      if (!worked) {
        const now = Date.now()
        if (now - lastIdleLog > IDLE_LOG_INTERVAL_MS) {
          lastIdleLog = now
          log('idle, waiting for jobs')
        }
        if (now - lastPrune > 24 * 60 * 60 * 1000) {
          lastPrune = now
          const pruned = await pruneJobs()
          if (pruned > 0) log(`pruned ${pruned} completed jobs older than 30 days`)
          const stalled = await reclaimStalledJobs()
          if (stalled > 0) log(`reclaimed ${stalled} stalled jobs`)
        }
        if (once) break
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
      }
    } catch (error) {
      log(`worker loop error: ${error instanceof Error ? error.message : String(error)}`)
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
    }
  }

  log('shutting down')
  await prisma.$disconnect()
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (shuttingDown) process.exit(1)
    shuttingDown = true
    log(`received ${signal}; finishing the current job then exiting`)
  })
}

main().catch(async (error) => {
  console.error('[worker] fatal error', error)
  await prisma.$disconnect()
  process.exit(1)
})
