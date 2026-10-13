import { NextResponse } from 'next/server'
import { authorizeCron } from '@/lib/cron-auth'
import { syncAllProviders } from '@/lib/integrations/sync-service'
import { reclaimStalledJobs } from '@/lib/jobs/queue'

export const maxDuration = 300

/**
 * Scheduled synchronisation.
 *
 * Call every 2-4 hours for the incremental sync, and once nightly with
 * `?backfill=true` for the historical re-read.
 *
 *   curl -X POST https://<host>/api/cron/sync \
 *        -H "Authorization: Bearer $CRON_SECRET"
 */
export async function POST(request: Request) {
  const denied = authorizeCron(request)
  if (denied) return denied

  const url = new URL(request.url)
  const fullBackfill = url.searchParams.get('backfill') === 'true'

  const reclaimed = await reclaimStalledJobs()

  const results = await syncAllProviders({
    trigger: fullBackfill ? 'BACKFILL' : 'SCHEDULED',
    fullBackfill,
  })

  const failed = results.filter((r) => !r.ok)

  return NextResponse.json(
    {
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
    },
    // 207 signals a partial success so the scheduler's alerting can
    // distinguish "one provider is down" from "everything is down".
    { status: failed.length === 0 ? 200 : failed.length === results.length ? 500 : 207 },
  )
}
