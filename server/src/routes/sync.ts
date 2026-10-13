import { Router } from 'express'
import { z } from 'zod'
import { PERMISSIONS } from '@shared/permissions'
import { currentUser, requireAuth } from '../lib/auth/guards'
import { syncAllProviders, syncProvider, testProviderConnection } from '../lib/integrations/sync-service'
import { AUDIT_ACTIONS, recordAudit } from '../lib/auth/audit'
import { handler } from '../lib/http/errors'

export const syncRouter = Router()

/**
 * POST /api/sync/run
 *
 * Manually trigger a synchronisation, or test a connection.
 *
 * Restricted to DATA_HEALTH_MANAGE. Source systems are only ever read.
 * (The Next route declared `maxDuration = 300`; Express imposes no handler
 * time limit of its own, so a long backfill simply keeps the request open.)
 */
const bodySchema = z.object({
  provider: z.enum(['QUICKBOOKS', 'METHOD_CRM', 'SHOPIFY', 'MONDAY']).optional(),
  action: z.enum(['sync', 'backfill', 'test']).default('sync'),
})

syncRouter.post(
  '/run',
  requireAuth(PERMISSIONS.DATA_HEALTH_MANAGE),
  handler(async (req, res) => {
    const user = currentUser(res)

    if (user.isDemo) {
      res.status(403)
      return {
        error: 'DEMO_SESSION',
        message: 'A demo session cannot contact the source systems. Sign in with a real account to run a sync.',
      }
    }

    // A missing body is treated as `{}`, as the Next route did.
    const parsed = bodySchema.safeParse(req.body ?? {})
    if (!parsed.success) {
      res.status(400)
      return { error: 'INVALID_REQUEST', message: 'Choose a valid provider and action.' }
    }
    const body = parsed.data

    try {
      // --- Connection test ---------------------------------------------------
      if (body.action === 'test') {
        if (!body.provider) {
          res.status(400)
          return { error: 'INVALID_REQUEST', message: 'Choose which integration to test.' }
        }
        const result = await testProviderConnection(body.provider)
        return { ok: result.ok, message: result.detail, tested: body.provider }
      }

      const fullBackfill = body.action === 'backfill'

      // --- One provider ------------------------------------------------------
      if (body.provider) {
        const result = await syncProvider(body.provider, {
          trigger: fullBackfill ? 'BACKFILL' : 'MANUAL',
          fullBackfill,
          triggeredByUserId: user.id,
        })

        await recordAudit({
          action: AUDIT_ACTIONS.SYNC_TRIGGERED,
          summary: `${user.name} ran a ${fullBackfill ? 'full backfill' : 'sync'} of ${result.displayName}: ${result.ok ? 'succeeded' : 'failed'}.`,
          actor: user,
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

        return {
          ok: result.ok,
          message: result.ok
            ? `${result.displayName}: ${result.totalRead} records read, ${result.totalCreated} created, ${result.totalUpdated} updated${result.totalFailed > 0 ? `, ${result.totalFailed} failed` : ''}.`
            : (result.error ?? `${result.displayName} sync failed.`),
          result,
        }
      }

      // --- Every enabled provider -------------------------------------------
      const results = await syncAllProviders({
        trigger: fullBackfill ? 'BACKFILL' : 'MANUAL',
        fullBackfill,
        triggeredByUserId: user.id,
      })

      await recordAudit({
        action: AUDIT_ACTIONS.SYNC_TRIGGERED,
        summary: `${user.name} ran a ${fullBackfill ? 'full backfill' : 'sync'} of every enabled integration.`,
        actor: user,
        metadata: { providers: results.map((r) => ({ provider: r.provider, ok: r.ok, read: r.totalRead })) },
      })

      const failed = results.filter((r) => !r.ok)

      return {
        ok: failed.length === 0,
        message:
          results.length === 0
            ? 'No integrations are enabled, so there was nothing to sync.'
            : failed.length === 0
              ? `Synced ${results.length} ${results.length === 1 ? 'integration' : 'integrations'}: ${results.reduce((acc, r) => acc + r.totalRead, 0)} records read.`
              : `${failed.length} of ${results.length} integrations failed: ${failed.map((f) => f.displayName).join(', ')}.`,
        results,
      }
    } catch (error) {
      res.status(500)
      return {
        error: 'SYNC_FAILED',
        message: error instanceof Error ? error.message : 'The sync could not be completed.',
      }
    }
  }),
)
