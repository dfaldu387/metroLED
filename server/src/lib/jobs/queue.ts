import { randomUUID } from 'node:crypto'
import type { JobStatus } from '@shared/enums'
import { db, sql } from '../db'
import { backoffDelay } from '../integrations/http'
import { describeError } from '../integrations/http'

/**
 * PostgreSQL-backed job queue.
 *
 * Phase 1 volumes are small - a handful of syncs a day plus one email - so a
 * table and a polling worker are the right amount of infrastructure. Redis and
 * BullMQ would be more moving parts to deploy, monitor and explain, for no
 * benefit at this scale.
 *
 * Correctness properties:
 *   - Claiming a job uses `FOR UPDATE SKIP LOCKED`, so two workers can run
 *     side by side without ever processing the same job twice.
 *   - `idempotencyKey` is unique, which is what guarantees the daily brief is
 *     sent once even if the scheduler fires twice or a retry overlaps.
 *   - A failed job is retried with exponential backoff up to `maxAttempts`,
 *     then marked DEAD so it stops consuming capacity but stays visible.
 */

export const QUEUES = {
  SYNC: 'sync',
  BRIEF: 'brief',
  WEBHOOK: 'webhook',
} as const

export const JOB_NAMES = {
  SYNC_ALL: 'sync.all',
  SYNC_PROVIDER: 'sync.provider',
  SYNC_BACKFILL: 'sync.backfill',
  GENERATE_BRIEF: 'brief.generate',
  SEND_BRIEF: 'brief.send',
  PROCESS_WEBHOOK: 'webhook.process',
} as const

export type JobName = (typeof JOB_NAMES)[keyof typeof JOB_NAMES]

export interface EnqueueOptions {
  queue: string
  name: JobName
  payload?: Record<string, unknown>
  runAt?: Date
  maxAttempts?: number
  /**
   * When set, a second enqueue with the same key is ignored. Use it for work
   * that must happen at most once, such as one daily brief per date.
   */
  idempotencyKey?: string
}

export interface EnqueueResult {
  id: string | null
  /** True when an existing job with the same idempotency key already existed. */
  deduplicated: boolean
}

export async function enqueue(options: EnqueueOptions): Promise<EnqueueResult> {
  if (options.idempotencyKey) {
    const existing = await db.maybeOne<{ id: string }>(
      sql`SELECT "id" FROM "Job" WHERE "idempotencyKey" = ${options.idempotencyKey}`,
    )
    if (existing) return { id: existing.id, deduplicated: true }
  }

  try {
    const job = await db.one<{ id: string }>(sql`
      INSERT INTO "Job" ("queue", "name", "payload", "runAt", "maxAttempts", "idempotencyKey")
      VALUES (${options.queue}, ${options.name}, ${options.payload ?? null}, ${options.runAt ?? new Date()},
              ${options.maxAttempts ?? 5}, ${options.idempotencyKey ?? null})
      RETURNING "id"`)
    return { id: job.id, deduplicated: false }
  } catch (error) {
    // A unique-constraint violation means another process won the race on the
    // same idempotency key. That is the queue working as intended.
    if (options.idempotencyKey && isUniqueViolation(error)) {
      const existing = await db.maybeOne<{ id: string }>(
        sql`SELECT "id" FROM "Job" WHERE "idempotencyKey" = ${options.idempotencyKey}`,
      )
      return { id: existing?.id ?? null, deduplicated: true }
    }
    throw error
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    // 23505 = unique_violation (PostgreSQL SQLSTATE; Prisma reported it as P2002).
    (error as { code?: string }).code === '23505'
  )
}

export interface ClaimedJob {
  id: string
  queue: string
  name: string
  payload: Record<string, unknown> | null
  attempts: number
  maxAttempts: number
}

/**
 * Atomically claims the next due job.
 *
 * `SKIP LOCKED` is the critical part: a row another worker has locked is
 * skipped rather than waited on, so workers never block each other and never
 * both claim the same job.
 */
export async function claimNextJob(workerId: string, queues?: string[]): Promise<ClaimedJob | null> {
  const rows = await db.many<
    { id: string; queue: string; name: string; payload: unknown; attempts: number; maxAttempts: number }
  >(sql`
    UPDATE "Job"
       SET status = 'RUNNING',
           "startedAt" = NOW(),
           "lockedBy" = ${workerId},
           "lockedAt" = NOW(),
           attempts = attempts + 1
     WHERE id = (
       SELECT id
         FROM "Job"
        WHERE status = 'PENDING'
          AND "runAt" <= NOW()
          ${queues && queues.length > 0 ? sql`AND queue = ANY(${queues}::text[])` : sql.empty}
        ORDER BY "runAt" ASC, "createdAt" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
     )
     RETURNING id, queue, name, payload, attempts, "maxAttempts";
  `)

  const row = rows[0]
  if (!row) return null

  return {
    id: row.id,
    queue: row.queue,
    name: row.name,
    payload: (row.payload as Record<string, unknown> | null) ?? null,
    attempts: row.attempts,
    maxAttempts: row.maxAttempts,
  }
}

export async function completeJob(jobId: string): Promise<void> {
  await db.exec(sql`
    UPDATE "Job"
    SET "status" = ${'SUCCEEDED'}, "finishedAt" = ${new Date()}, "lockedBy" = NULL, "lockedAt" = NULL, "lastError" = NULL
    WHERE "id" = ${jobId}`)
}

export async function failJob(job: ClaimedJob, error: unknown): Promise<{ status: JobStatus; retryInMs: number | null }> {
  const message = describeError(error)
  const exhausted = job.attempts >= job.maxAttempts

  if (exhausted) {
    await db.exec(sql`
      UPDATE "Job"
      SET "status" = ${'DEAD'}, "finishedAt" = ${new Date()}, "lockedBy" = NULL, "lockedAt" = NULL,
          "lastError" = ${`${message} (gave up after ${job.attempts} attempts)`}
      WHERE "id" = ${job.id}`)
    return { status: 'DEAD', retryInMs: null }
  }

  const delay = backoffDelay(job.attempts, 5_000, 10 * 60 * 1000)
  await db.exec(sql`
    UPDATE "Job"
    SET "status" = ${'PENDING'}, "runAt" = ${new Date(Date.now() + delay)}, "lockedBy" = NULL, "lockedAt" = NULL,
        "lastError" = ${message}
    WHERE "id" = ${job.id}`)
  return { status: 'PENDING', retryInMs: delay }
}

/**
 * Releases jobs whose worker died mid-run.
 *
 * Without this, a crashed worker would leave a job RUNNING forever and the
 * work would silently never happen.
 */
export async function reclaimStalledJobs(olderThanMinutes = 30): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMinutes * 60 * 1000)
  return db.exec(sql`
    UPDATE "Job"
    SET "status" = ${'PENDING'}, "lockedBy" = NULL, "lockedAt" = NULL,
        "lastError" = ${`Reclaimed after the worker stopped responding for more than ${olderThanMinutes} minutes.`}
    WHERE "status" = ${'RUNNING'} AND "lockedAt" < ${cutoff}`)
}

export function newWorkerId(): string {
  return `${process.pid}-${randomUUID().slice(0, 8)}`
}

export async function queueStats(): Promise<Record<string, number>> {
  const grouped = await db.many<{ status: JobStatus; count: number }>(
    sql`SELECT "status", COUNT(*) AS "count" FROM "Job" GROUP BY "status"`,
  )
  const stats: Record<string, number> = { PENDING: 0, RUNNING: 0, SUCCEEDED: 0, FAILED: 0, DEAD: 0 }
  for (const row of grouped) stats[row.status] = row.count
  return stats
}

/** Removes finished jobs so the table does not grow without bound. */
export async function pruneJobs(olderThanDays = 30): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000)
  return db.exec(sql`DELETE FROM "Job" WHERE "status" = ${'SUCCEEDED'} AND "finishedAt" < ${cutoff}`)
}
