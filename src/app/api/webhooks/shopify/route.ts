import { NextResponse } from 'next/server'
import { prisma, databaseReachable } from '@/lib/db'
import { env } from '@/lib/env'
import { verifyShopifyWebhook } from '@/lib/integrations/shopify'
import { readCredentials, type ShopifyCredentials } from '@/lib/integrations/credentials'
import { enqueue, JOB_NAMES, QUEUES } from '@/lib/jobs/queue'
import { handlerFor } from '@/lib/jobs/handlers'

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

export async function POST(request: Request) {
  // 1. Raw body first, before anything parses it.
  const rawBody = await request.text()

  const topic = request.headers.get('x-shopify-topic') ?? ''
  const signature = request.headers.get('x-shopify-hmac-sha256')
  const shopDomain = request.headers.get('x-shopify-shop-domain') ?? ''
  const eventId =
    request.headers.get('x-shopify-event-id') ??
    request.headers.get('x-shopify-webhook-id') ??
    `${topic}-${Date.now()}`

  if (!(await databaseReachable())) {
    // 503 makes Shopify retry later rather than dropping the event.
    return NextResponse.json(
      { error: 'DATABASE_UNAVAILABLE', message: 'The database is unreachable. Please retry.' },
      { status: 503 },
    )
  }

  const integration = await prisma.integration.findUnique({ where: { provider: 'SHOPIFY' } })
  if (!integration) {
    return NextResponse.json(
      { error: 'NOT_CONFIGURED', message: 'Shopify is not configured on this deployment.' },
      { status: 404 },
    )
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
    return NextResponse.json(
      { error: 'NOT_CONFIGURED', message: 'No Shopify webhook secret is configured.' },
      { status: 503 },
    )
  }

  if (!verifyShopifyWebhook(rawBody, signature, secret)) {
    console.warn(`[webhook:shopify] rejected an unverified delivery for topic "${topic}" from ${shopDomain}`)
    return NextResponse.json(
      { error: 'INVALID_SIGNATURE', message: 'The webhook signature did not verify.' },
      { status: 401 },
    )
  }

  if (!SUPPORTED_TOPICS.has(topic)) {
    // Acknowledge so Shopify stops retrying a topic we do not handle.
    return NextResponse.json({ ok: true, ignored: true, topic })
  }

  let payload: unknown
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return NextResponse.json(
      { error: 'INVALID_BODY', message: 'The webhook body was not valid JSON.' },
      { status: 400 },
    )
  }

  // 3. Store first; the unique key makes a duplicate delivery a no-op.
  let webhookEventId: string
  let alreadySeen = false

  try {
    const event = await prisma.webhookEvent.create({
      data: { integrationId: integration.id, topic, externalId: eventId, payload: payload as never },
      select: { id: true },
    })
    webhookEventId = event.id
  } catch (error) {
    if (typeof error === 'object' && error !== null && (error as { code?: string }).code === 'P2002') {
      const existing = await prisma.webhookEvent.findUnique({
        where: {
          integrationId_topic_externalId: { integrationId: integration.id, topic, externalId: eventId },
        },
        select: { id: true, processedAt: true },
      })
      if (existing?.processedAt) {
        return NextResponse.json({ ok: true, duplicate: true, message: 'This event was already processed.' })
      }
      webhookEventId = existing?.id ?? ''
      alreadySeen = true
    } else {
      throw error
    }
  }

  if (!webhookEventId) {
    return NextResponse.json({ ok: true, duplicate: true })
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

  const handler = handlerFor(JOB_NAMES.PROCESS_WEBHOOK)
  if (handler) {
    void handler({ webhookEventId }, {
      id: 'inline',
      queue: QUEUES.WEBHOOK,
      name: JOB_NAMES.PROCESS_WEBHOOK,
      payload: { webhookEventId },
      attempts: 1,
      maxAttempts: 1,
    }).catch((error: unknown) => {
      console.warn(
        `[webhook:shopify] inline processing failed for ${topic}/${eventId}; the queued job will retry.`,
        error,
      )
    })
  }

  return NextResponse.json({ ok: true, queued: true, topic, duplicate: alreadySeen })
}

/** Shopify sends a GET when the endpoint URL is being verified. */
export async function GET() {
  return NextResponse.json({
    ok: true,
    endpoint: 'Shopify order webhooks',
    note: 'POST only. Deliveries must carry a valid X-Shopify-Hmac-Sha256 signature.',
  })
}
