import { Router } from 'express'
import { db, sql, databaseReachable } from '../lib/db'
import type { IntegrationRow } from '../lib/db-rows'
import { env } from '../lib/env'
import { verifyShopifyWebhook } from '../lib/integrations/shopify'
import { readCredentials, type ShopifyCredentials } from '../lib/integrations/credentials'
import { enqueue, JOB_NAMES, QUEUES } from '../lib/jobs/queue'
import { handlerFor } from '../lib/jobs/handlers'
import { handler } from '../lib/http/errors'

/**
 * Mounted at /api/webhooks behind `express.raw`, so `req.body` is the exact
 * Buffer received (or undefined for an empty body).
 */
export const webhooksRouter = Router()

/**
 * Shopify order webhooks (section 13).
 *
 * Correctness rules, in order:
 *
 *  1. The RAW request body is read first and used for signature verification.
 *     Parsing the JSON and re-serialising it would change the bytes and every
 *     signature would fail.
 *
 *  2. An unverified request is rejected with 401 and nothing is stored. The
 *     endpoint is public, so the signature is the only thing standing between
 *     the reporting database and anyone who finds the URL.
 *
 *  3. A verified delivery is stored before it is processed, keyed on
 *     (integration, topic, Shopify event id). A duplicate delivery - which
 *     Shopify will send on its own retry schedule - is recognised and
 *     acknowledged without being applied twice.
 *
 *  4. The response is 200 as soon as the event is safely stored. Shopify
 *     requires an answer within five seconds and retries anything slower, so
 *     processing must not hold the response open.
 */

const SUPPORTED_TOPICS = new Set([
  'orders/create',
  'orders/updated',
  'orders/cancelled',
  'orders/paid',
  'orders/fulfilled',
  'orders/partially_fulfilled',
  'refunds/create',
])

webhooksRouter.post(
  '/shopify',
  handler(async (req, res) => {
    // 1. Raw body first, before anything parses it.
    const rawBody: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0)

    const topic = req.get('x-shopify-topic') ?? ''
    const signature = req.get('x-shopify-hmac-sha256') ?? null
    const shopDomain = req.get('x-shopify-shop-domain') ?? ''
    const eventId = req.get('x-shopify-event-id') ?? req.get('x-shopify-webhook-id') ?? `${topic}-${Date.now()}`

    if (!(await databaseReachable())) {
      // 503 makes Shopify retry later rather than dropping the event.
      res.status(503)
      return { error: 'DATABASE_UNAVAILABLE', message: 'The database is unreachable. Please retry.' }
    }

    const integration = await db.maybeOne<Pick<IntegrationRow, 'id'>>(
      sql`SELECT "id" FROM "Integration" WHERE "provider" = ${'SHOPIFY'}`,
    )
    if (!integration) {
      res.status(404)
      return { error: 'NOT_CONFIGURED', message: 'Shopify is not configured on this deployment.' }
    }

    // 2. Verify the signature. The stored (encrypted) secret wins; the
    //    environment variable is the fallback for a deployment that configures
    //    Shopify entirely through env rather than the connect flow.
    let secret: string | undefined
    try {
      const stored = await readCredentials<ShopifyCredentials>(integration.id)
      secret = stored?.webhookSecret ?? undefined
    } catch {
      // Credential decryption is unavailable; fall through to the env secret.
    }
    secret = secret ?? env().SHOPIFY_WEBHOOK_SECRET

    if (!secret) {
      console.error('[webhook:shopify] no webhook secret configured; rejecting delivery')
      res.status(503)
      return { error: 'NOT_CONFIGURED', message: 'No Shopify webhook secret is configured.' }
    }

    if (!verifyShopifyWebhook(rawBody, signature, secret)) {
      console.warn(`[webhook:shopify] rejected an unverified delivery for topic "${topic}" from ${shopDomain}`)
      res.status(401)
      return { error: 'INVALID_SIGNATURE', message: 'The webhook signature did not verify.' }
    }

    if (!SUPPORTED_TOPICS.has(topic)) {
      // Acknowledge so Shopify stops retrying a topic we do not handle.
      return { ok: true, ignored: true, topic }
    }

    let payload: unknown
    try {
      payload = JSON.parse(rawBody.toString('utf8'))
    } catch {
      res.status(400)
      return { error: 'INVALID_BODY', message: 'The webhook body was not valid JSON.' }
    }

    // 3. Store first; the unique key makes a duplicate delivery a no-op.
    //    (Prisma surfaced the duplicate as a P2002 error; ON CONFLICT DO
    //    NOTHING returns no row instead, which is handled the same way.)
    let webhookEventId: string
    let alreadySeen = false

    const inserted = await db.maybeOne<{ id: string }>(sql`
      INSERT INTO "WebhookEvent" ("integrationId", "topic", "externalId", "payload")
      VALUES (${integration.id}, ${topic}, ${eventId}, ${sql`${JSON.stringify(payload)}::jsonb`})
      ON CONFLICT ("integrationId", "topic", "externalId") DO NOTHING
      RETURNING "id"`)

    if (inserted) {
      webhookEventId = inserted.id
    } else {
      const existing = await db.maybeOne<{ id: string; processedAt: Date | null }>(sql`
        SELECT "id", "processedAt" FROM "WebhookEvent"
        WHERE "integrationId" = ${integration.id} AND "topic" = ${topic} AND "externalId" = ${eventId}`)
      if (existing?.processedAt) {
        return { ok: true, duplicate: true, message: 'This event was already processed.' }
      }
      webhookEventId = existing?.id ?? ''
      alreadySeen = true
    }

    if (!webhookEventId) {
      return { ok: true, duplicate: true }
    }

    // 4. Process without holding the response open.
    //
    // The job queue is the durable path: if processing fails, the job retries
    // with backoff. We also kick off an immediate attempt so an order appears on
    // the dashboard within seconds rather than at the next worker poll, but its
    // failure is not reported to Shopify - the queued job owns the retry.
    await enqueue({
      queue: QUEUES.WEBHOOK,
      name: JOB_NAMES.PROCESS_WEBHOOK,
      payload: { webhookEventId },
      idempotencyKey: `webhook:${integration.id}:${topic}:${eventId}`,
      maxAttempts: 5,
    })

    const jobHandler = handlerFor(JOB_NAMES.PROCESS_WEBHOOK)
    if (jobHandler) {
      void jobHandler(
        { webhookEventId },
        {
          id: 'inline',
          queue: QUEUES.WEBHOOK,
          name: JOB_NAMES.PROCESS_WEBHOOK,
          payload: { webhookEventId },
          attempts: 1,
          maxAttempts: 1,
        },
      ).catch((error: unknown) => {
        console.warn(
          `[webhook:shopify] inline processing failed for ${topic}/${eventId}; the queued job will retry.`,
          error,
        )
      })
    }

    return { ok: true, queued: true, topic, duplicate: alreadySeen }
  }),
)

/** Shopify sends a GET when the endpoint URL is being verified. */
webhooksRouter.get(
  '/shopify',
  handler(async () => ({
    ok: true,
    endpoint: 'Shopify order webhooks',
    note: 'POST only. Deliveries must carry a valid X-Shopify-Hmac-Sha256 signature.',
  })),
)
