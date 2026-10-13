import { NextResponse } from 'next/server'
import { z } from 'zod'
import { PERMISSIONS } from '@/lib/auth/permissions'
import { requireApiPermission } from '@/lib/auth/guards'
import { syncAllProviders, syncProvider, testProviderConnection } from '@/lib/integrations/sync-service'
import { AUDIT_ACTIONS, recordAudit } from '@/lib/auth/audit'

export const maxDuration = 300

/**
 * Manually trigger a synchronisation, or test a connection.
 *
 * Restricted to DATA_HEALTH_MANAGE. Source systems are only ever read.
 */
const bodySchema = z.object({
  provider: z.enum(['QUICKBOOKS', 'METHOD_CRM', 'SHOPIFY', 'MONDAY']).optional(),
  action: z.enum(['sync', 'backfill', 'test']).default('sync'),
})

export async function POST(request: Request) {
  const auth = await requireApiPermission(PERMISSIONS.DATA_HEALTH_MANAGE)
  if (!auth.ok) return auth.response

  if (auth.user.isDemo) {
    return NextResponse.json(
      {
        error: 'DEMO_SESSION',
        message:
          'A demo session cannot contact the source systems. Sign in with a real account to run a sync.',
      },
      { status: 403 },
    )
  }

  let body: z.infer<typeof bodySchema>
  try {
    body = bodySchema.parse(await request.json().catch(() => ({})))
  } catch {
    return NextResponse.json(
      { error: 'INVALID_REQUEST', message: 'Choose a valid provider and action.' },
      { status: 400 },
    )
  }

  try {
    // --- Connection test ---------------------------------------------------
    if (body.action === 'test') {
      if (!body.provider) {
        return NextResponse.json(
          { error: 'INVALID_REQUEST', message: 'Choose which integration to test.' },
          { status: 400 },
        )
      }
      const result = await testProviderConnection(body.provider)
      return NextResponse.json({ ok: result.ok, message: result.detail, tested: body.provider })
    }

    const fullBackfill = body.action === 'backfill'

    // --- One provider ------------------------------------------------------
    if (body.provider) {
      const result = await syncProvider(body.provider, {
        trigger: fullBackfill ? 'BACKFILL' : 'MANUAL',
        fullBackfill,
        triggeredByUserId: auth.user.id,
      })

      await recordAudit({
        action: AUDIT_ACTIONS.SYNC_TRIGGERED,
        summary: `${auth.user.name} ran a ${fullBackfill ? 'full backfill' : 'sync'} of ${result.displayName}: ${result.ok ? 'succeeded' : 'failed'}.`,
        actor: auth.user,
        entityType: 'Integration',
        entityId: body.provider,
        metadata: {
          read: result.totalRead,
          created: result.totalCreated,
          updated: result.totalUpdated,
          failed: result.totalFailed,
          durationMs: result.durationMs,
        },
      })

      return NextResponse.json({
        ok: result.ok,
        message: result.ok
          ? `${result.displayName}: ${result.totalRead} records read, ${result.totalCreated} created, ${result.totalUpdated} updated${result.totalFailed > 0 ? `, ${result.totalFailed} failed` : ''}.`
          : (result.error ?? `${result.displayName} sync failed.`),
        result,
      })
    }

    // --- Every enabled provider -------------------------------------------
    const results = await syncAllProviders({
      trigger: fullBackfill ? 'BACKFILL' : 'MANUAL',
      fullBackfill,
      triggeredByUserId: auth.user.id,
    })

    await recordAudit({
      action: AUDIT_ACTIONS.SYNC_TRIGGERED,
      summary: `${auth.user.name} ran a ${fullBackfill ? 'full backfill' : 'sync'} of every enabled integration.`,
      actor: auth.user,
      metadata: { providers: results.map((r) => ({ provider: r.provider, ok: r.ok, read: r.totalRead })) },
    })

    const failed = results.filter((r) => !r.ok)

    return NextResponse.json({
      ok: failed.length === 0,
      message:
        results.length === 0
          ? 'No integrations are enabled, so there was nothing to sync.'
          : failed.length === 0
            ? `Synced ${results.length} ${results.length === 1 ? 'integration' : 'integrations'}: ${results.reduce((acc, r) => acc + r.totalRead, 0)} records read.`
            : `${failed.length} of ${results.length} integrations failed: ${failed.map((f) => f.displayName).join(', ')}.`,
      results,
    })
  } catch (error) {
    return NextResponse.json(
      {
        error: 'SYNC_FAILED',
        message: error instanceof Error ? error.message : 'The sync could not be completed.',
      },
      { status: 500 },
    )
  }
}
