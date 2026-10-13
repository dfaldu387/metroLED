import { Router } from 'express'
import { authorizeCron } from '../lib/cron-auth'
import { sendDailyBrief, briefJobKey, todaysBriefDate } from '../lib/brief/send'
import { loadSettings } from '../lib/data/dataset'
import { isBusinessDay } from '@shared/dates'
import { syncAllProviders } from '../lib/integrations/sync-service'
import { reclaimStalledJobs } from '../lib/jobs/queue'
import { handler } from '../lib/http/errors'

export const cronRouter = Router()

/**
 * Scheduled daily brief: POST /api/cron/brief
 *
 * Call once each business morning at the configured time:
 *
 *   curl -X POST https://<host>/api/cron/brief \
 *        -H "Authorization: Bearer $CRON_SECRET"
 *
 * Duplicate protection: the brief is keyed on its business date, and a
 * recipient who already received it is skipped. Calling this twice in one
 * morning sends nothing the second time.
 */
cronRouter.post(
  '/brief',
  authorizeCron,
  handler(async (req, res) => {
    const settings = await loadSettings()
    const now = new Date()
    const force = req.query.force === 'true'

    if (!settings.briefEnabled && !force) {
      return {
        ok: true,
        skipped: true,
        reason: 'Automatic sending of the daily brief is turned off in Settings.',
      }
    }

    // Do not send on a weekend: the brief reports on business days only.
    if (!isBusinessDay(now) && !force) {
      return {
        ok: true,
        skipped: true,
        reason: 'Today is not a business day, so no brief was sent.',
      }
    }

    const briefDate = todaysBriefDate(now, settings.timezone)

    try {
      const result = await sendDailyBrief({ briefDate, now })
      res.status(result.failed === 0 ? 200 : 207).json({
        ok: result.failed === 0,
        idempotencyKey: briefJobKey(briefDate),
        briefDate: result.briefDate,
        attempted: result.attempted,
        sent: result.sent,
        skipped: result.skipped,
        failed: result.failed,
        simulated: result.simulated,
        outcomes: result.outcomes,
      })
    } catch (error) {
      res.status(500).json({
        ok: false,
        error: 'BRIEF_FAILED',
        message: error instanceof Error ? error.message : 'The daily brief could not be sent.',
      })
    }
    return undefined
  }),
)

/**
 * Scheduled synchronisation: POST /api/cron/sync
 *
 * Call every 2-4 hours for the incremental sync, and once nightly with
 * `?backfill=true` for the historical re-read.
 *
 *   curl -X POST https://<host>/api/cron/sync \
 *        -H "Authorization: Bearer $CRON_SECRET"
 */
cronRouter.post(
  '/sync',
  authorizeCron,
  handler(async (req, res) => {
    const fullBackfill = req.query.backfill === 'true'

    const reclaimed = await reclaimStalledJobs()

    const results = await syncAllProviders({
      trigger: fullBackfill ? 'BACKFILL' : 'SCHEDULED',
      fullBackfill,
    })

    const failed = results.filter((r) => !r.ok)

    // 207 signals a partial success so the scheduler's alerting can
    // distinguish "one provider is down" from "everything is down".
    res.status(failed.length === 0 ? 200 : failed.length === results.length ? 500 : 207).json({
      ok: failed.length === 0,
      mode: fullBackfill ? 'backfill' : 'incremental',
      reclaimedStalledJobs: reclaimed,
      providers: results.map((r) => ({
        provider: r.provider,
        ok: r.ok,
        read: r.totalRead,
        created: r.totalCreated,
        updated: r.totalUpdated,
        failed: r.totalFailed,
        durationMs: r.durationMs,
        error: r.error,
      })),
    })
    return undefined
  }),
)
