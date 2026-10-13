import type { IntegrationProvider } from '@shared/enums'
import { db, sql } from '../db'
import type { WebhookEventRow } from '../db-rows'
import { syncAllProviders, syncProvider, persistOrder } from '../integrations/sync-service'
import { normalizeOrder, type ShopifyOrderPayload } from '../integrations/shopify'
import { generateAndStoreBrief } from '../brief/generate'
import { sendDailyBrief } from '../brief/send'
import { JOB_NAMES, type ClaimedJob } from './queue'

/**
 * Job handlers.
 *
 * Each returns a short summary that is logged by the worker. A handler that
 * throws causes the job to be retried with backoff; a handler that returns
 * normally marks the job succeeded.
 */

export type JobHandler = (payload: Record<string, unknown>, job: ClaimedJob) => Promise<string>

function readString(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key]
  return typeof value === 'string' && value.length > 0 ? value : null
}

function readBoolean(payload: Record<string, unknown>, key: string): boolean {
  return payload[key] === true
}

export const HANDLERS: Record<string, JobHandler> = {
  [JOB_NAMES.SYNC_ALL]: async (payload) => {
    const results = await syncAllProviders({
      trigger: 'SCHEDULED',
      fullBackfill: readBoolean(payload, 'fullBackfill'),
    })

    const failed = results.filter((r) => !r.ok)
    const summary = results
      .map((r) => `${r.displayName}: ${r.ok ? `${r.totalRead} read` : `FAILED (${r.error})`}`)
      .join('; ')

    // One provider failing must not fail the whole job, or the healthy
    // providers would be retried pointlessly. The failure is already recorded
    // on the integration and visible on Data Health.
    if (failed.length === results.length && results.length > 0) {
      throw new Error(`Every provider failed to sync. ${summary}`)
    }

    return summary || 'No providers are enabled.'
  },

  [JOB_NAMES.SYNC_PROVIDER]: async (payload) => {
    const provider = readString(payload, 'provider') as IntegrationProvider | null
    if (!provider) throw new Error('sync.provider requires a "provider" in its payload.')

    const result = await syncProvider(provider, {
      trigger: (readString(payload, 'trigger') as 'MANUAL' | 'SCHEDULED' | 'RETRY' | null) ?? 'SCHEDULED',
      fullBackfill: readBoolean(payload, 'fullBackfill'),
      triggeredByUserId: readString(payload, 'triggeredByUserId') ?? undefined,
    })

    if (!result.ok) throw new Error(result.error ?? `${result.displayName} sync failed.`)

    return `${result.displayName}: ${result.totalRead} read, ${result.totalCreated} created, ${result.totalUpdated} updated, ${result.totalFailed} failed in ${result.durationMs}ms.`
  },

  [JOB_NAMES.SYNC_BACKFILL]: async (payload) => {
    const provider = readString(payload, 'provider') as IntegrationProvider | null

    if (provider) {
      const result = await syncProvider(provider, { trigger: 'BACKFILL', fullBackfill: true })
      if (!result.ok) throw new Error(result.error ?? `${result.displayName} backfill failed.`)
      return `${result.displayName} backfill: ${result.totalRead} records read.`
    }

    const results = await syncAllProviders({ trigger: 'BACKFILL', fullBackfill: true })
    return results.map((r) => `${r.displayName}: ${r.ok ? `${r.totalRead} read` : 'FAILED'}`).join('; ')
  },

  [JOB_NAMES.GENERATE_BRIEF]: async (payload) => {
    const dateString = readString(payload, 'briefDate')
    const briefDate = dateString ? new Date(`${dateString}T00:00:00.000Z`) : undefined
    const { payload: brief, regenerated } = await generateAndStoreBrief({ briefDate })
    return `Daily brief for ${brief.briefDate} ${regenerated ? 'regenerated' : 'generated'}.`
  },

  [JOB_NAMES.SEND_BRIEF]: async (payload) => {
    const dateString = readString(payload, 'briefDate')
    const briefDate = dateString ? new Date(`${dateString}T00:00:00.000Z`) : undefined

    const result = await sendDailyBrief({ briefDate, force: readBoolean(payload, 'force') })

    // A partial failure must retry, so the recipients that failed get another
    // attempt. The ones already sent are skipped by the delivery records.
    if (result.failed > 0) {
      throw new Error(
        `${result.failed} of ${result.attempted} deliveries failed for the ${result.briefDate} brief. Successful deliveries will not be repeated on retry.`,
      )
    }

    return `Daily brief for ${result.briefDate}: ${result.sent} sent, ${result.skipped} already delivered${result.simulated ? ' (logged to console, not actually sent)' : ''}.`
  },

  [JOB_NAMES.PROCESS_WEBHOOK]: async (payload) => {
    const webhookEventId = readString(payload, 'webhookEventId')
    if (!webhookEventId) throw new Error('webhook.process requires a "webhookEventId" in its payload.')

    const event = await db.maybeOne<WebhookEventRow>(sql`SELECT * FROM "WebhookEvent" WHERE "id" = ${webhookEventId}`)
    if (!event) throw new Error(`Webhook event ${webhookEventId} no longer exists.`)

    // Already processed: a duplicate delivery from Shopify is a no-op.
    if (event.processedAt) return `Webhook ${event.topic}/${event.externalId} was already processed.`

    try {
      if (event.topic.startsWith('orders/')) {
        const order = normalizeOrder(event.payload as unknown as ShopifyOrderPayload)
        const outcome = await persistOrder(event.integrationId, order)
        await db.exec(sql`
          UPDATE "WebhookEvent"
          SET "processedAt" = ${new Date()}, "processError" = NULL, "attempts" = "attempts" + 1
          WHERE "id" = ${event.id}`)
        // Near-real-time updates arriving by webhook do not count as a sync,
        // so `lastSuccessAt` is deliberately not touched here: the freshness
        // indicator must reflect the scheduled sync, not an incidental push.
        return `Shopify order ${order.orderNumber} ${outcome} from webhook ${event.topic}.`
      }

      await db.exec(sql`
        UPDATE "WebhookEvent"
        SET "processedAt" = ${new Date()},
            "processError" = ${`No handler is implemented for topic "${event.topic}"; the event was stored and ignored.`},
            "attempts" = "attempts" + 1
        WHERE "id" = ${event.id}`)
      return `Webhook topic "${event.topic}" has no handler; stored for review.`
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error processing the webhook.'
      await db.exec(sql`
        UPDATE "WebhookEvent" SET "processError" = ${message}, "attempts" = "attempts" + 1 WHERE "id" = ${event.id}`)
      throw error
    }
  },
}

export function handlerFor(name: string): JobHandler | null {
  return HANDLERS[name] ?? null
}
