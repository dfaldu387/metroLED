import { integrationEnv } from '../env'
import { hmacBase64, safeEqual } from '../crypto'
import { ProviderAuthError, providerFetch, providerJson, RateLimiter } from './http'
import { readCredentials, type ShopifyCredentials } from './credentials'
import type {
  NormalizedCustomer,
  NormalizedOrder,
  NormalizedOrderLine,
  Page,
  ProviderAdapter,
  SyncContext,
} from './types'

/**
 * Shopify adapter for the Eco LED Mart store.
 *
 * API: Admin REST API, versioned (`SHOPIFY_API_VERSION`), authenticated with
 * a custom app access token in `X-Shopify-Access-Token`.
 *
 * Pagination: cursor-based via the `Link` header (`rel="next"`). Page-number
 * pagination was removed by Shopify, so the `page_info` cursor from the Link
 * header is the only correct way to walk a large order history.
 *
 * Rate limit: the REST Admin API leaky bucket allows 2 requests/second on a
 * standard plan. Requests are paced to stay inside it, and a 429 is honoured
 * via `Retry-After` in the shared HTTP client.
 *
 * READ ONLY. No order is ever created, updated, cancelled or fulfilled by this
 * system (section 9).
 */

const PAGE_SIZE = 100
const limiter = new RateLimiter(520)

interface ShopifyOrderPayload {
  id: number
  name?: string
  order_number?: number
  email?: string | null
  currency?: string
  subtotal_price?: string
  total_discounts?: string
  total_tax?: string
  total_price?: string
  financial_status?: string | null
  fulfillment_status?: string | null
  created_at?: string
  processed_at?: string
  updated_at?: string
  cancelled_at?: string | null
  closed_at?: string | null
  customer?: { id?: number; first_name?: string | null; last_name?: string | null; email?: string | null } | null
  line_items?: {
    id: number
    product_id?: number | null
    variant_id?: number | null
    sku?: string | null
    title?: string
    name?: string
    quantity?: number
    price?: string
    total_discount?: string
  }[]
  shipping_lines?: { price?: string; discounted_price?: string }[]
  refunds?: {
    id: number
    created_at?: string
    transactions?: { amount?: string; kind?: string; status?: string }[]
    refund_line_items?: { subtotal?: number | string; quantity?: number }[]
  }[]
}

interface ShopifyCustomerPayload {
  id: number
  first_name?: string | null
  last_name?: string | null
  email?: string | null
  phone?: string | null
  default_address?: { city?: string | null; province?: string | null; country?: string | null } | null
  tags?: string
  updated_at?: string
}

async function connection(context: SyncContext): Promise<{ shopDomain: string; token: string; apiVersion: string }> {
  const stored = await readCredentials<ShopifyCredentials>(context.integrationId)
  const fromEnv = integrationEnv.shopify()
  const shopDomain = stored?.shopDomain ?? fromEnv.shopDomain
  const token = stored?.accessToken ?? fromEnv.token

  if (!shopDomain || !token) {
    throw new ProviderAuthError(
      'Shopify is not connected. Add the shop domain and Admin API access token on the Data Health page.',
      401,
      '',
      'Shopify',
    )
  }
  return { shopDomain, token, apiVersion: fromEnv.apiVersion }
}

function toNumber(value: string | number | undefined | null): number {
  if (value === undefined || value === null) return 0
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : 0
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function parseDate(value: string | undefined | null): Date | null {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

/** Extracts the `page_info` cursor from Shopify's `Link` header. */
export function parseNextPageInfo(linkHeader: string | null): string | null {
  if (!linkHeader) return null
  for (const part of linkHeader.split(',')) {
    const [urlPart, relPart] = part.split(';')
    if (!urlPart || !relPart || !relPart.includes('rel="next"')) continue
    const match = urlPart.trim().match(/^<(.+)>$/)
    if (!match?.[1]) continue
    try {
      return new URL(match[1]).searchParams.get('page_info')
    } catch {
      return null
    }
  }
  return null
}

function mapFinancialStatus(value: string | null | undefined): NormalizedOrder['financialStatus'] {
  switch ((value ?? '').toLowerCase()) {
    case 'pending':
      return 'PENDING'
    case 'authorized':
      return 'AUTHORIZED'
    case 'partially_paid':
      return 'PARTIALLY_PAID'
    case 'paid':
      return 'PAID'
    case 'partially_refunded':
      return 'PARTIALLY_REFUNDED'
    case 'refunded':
      return 'REFUNDED'
    case 'voided':
      return 'VOIDED'
    default:
      return 'UNKNOWN'
  }
}

function mapFulfillmentStatus(value: string | null | undefined): NormalizedOrder['fulfillmentStatus'] {
  switch ((value ?? '').toLowerCase()) {
    case 'fulfilled':
      return 'FULFILLED'
    case 'partial':
      return 'PARTIAL'
    case 'restocked':
      return 'RESTOCKED'
    // Shopify sends null for an unfulfilled order rather than a status string.
    case '':
      return 'UNFULFILLED'
    default:
      return 'UNKNOWN'
  }
}

/**
 * Total refunded against an order.
 *
 * Sums the refund transactions rather than the refund line items, because a
 * refund can include shipping and adjustments that never appear as a line.
 */
export function refundedTotal(order: ShopifyOrderPayload): number {
  let total = 0
  for (const refund of order.refunds ?? []) {
    for (const transaction of refund.transactions ?? []) {
      if (transaction.kind === 'refund' && transaction.status === 'success') {
        total += toNumber(transaction.amount)
      }
    }
  }
  return round2(total)
}

export function normalizeOrder(order: ShopifyOrderPayload): NormalizedOrder {
  const subtotal = toNumber(order.subtotal_price)
  const discounts = toNumber(order.total_discounts)
  const tax = toNumber(order.total_tax)
  const totalPrice = toNumber(order.total_price)
  const shipping = round2(
    (order.shipping_lines ?? []).reduce(
      (acc, line) => acc + toNumber(line.discounted_price ?? line.price),
      0,
    ),
  )
  const refunded = refundedTotal(order)

  const lines: NormalizedOrderLine[] = (order.line_items ?? []).map((line, index) => {
    const unitPrice = toNumber(line.price)
    const quantity = line.quantity ?? 1
    const discount = toNumber(line.total_discount)
    return {
      sourceLineId: String(line.id),
      lineNumber: index + 1,
      productSourceId: line.product_id ? String(line.product_id) : null,
      variantSourceId: line.variant_id ? String(line.variant_id) : null,
      sku: line.sku ?? null,
      title: line.title ?? line.name ?? 'Untitled item',
      quantity,
      unitPrice,
      discount: round2(discount),
      amount: round2(unitPrice * quantity - discount),
    }
  })

  const customerName =
    [order.customer?.first_name, order.customer?.last_name].filter(Boolean).join(' ').trim() || null

  return {
    sourceId: String(order.id),
    orderNumber: order.name ?? (order.order_number ? `#${order.order_number}` : String(order.id)),
    customerSourceId: order.customer?.id ? String(order.customer.id) : null,
    customerName,
    email: order.email ?? order.customer?.email ?? null,
    financialStatus: mapFinancialStatus(order.financial_status),
    fulfillmentStatus: mapFulfillmentStatus(order.fulfillment_status),
    currency: order.currency ?? 'CAD',
    // Shopify's `subtotal_price` is already net of line discounts.
    subtotalPrice: round2(subtotal),
    totalDiscounts: round2(discounts),
    totalTax: round2(tax),
    totalShipping: shipping,
    totalRefunded: refunded,
    totalPrice: round2(totalPrice),
    // Net sales basis: subtotal after discounts, less refunds. Excludes tax
    // and shipping. See metrics/definitions.ts > shopify_sales.
    netSalesAmount: round2(subtotal - refunded),
    placedAt: parseDate(order.processed_at ?? order.created_at) ?? new Date(),
    cancelledAt: parseDate(order.cancelled_at),
    closedAt: parseDate(order.closed_at),
    sourceUpdatedAt: parseDate(order.updated_at),
    lines,
  }
}

export const shopifyAdapter: ProviderAdapter = {
  provider: 'SHOPIFY',
  displayName: 'Shopify — Eco LED Mart',
  entities: ['customers', 'orders'],
  minRequestIntervalMs: 520,

  async testConnection(context) {
    const { shopDomain, token, apiVersion } = await connection(context)

    await limiter.acquire()
    const payload = await providerJson<{ shop?: { name?: string; myshopify_domain?: string; currency?: string } }>(
      `https://${shopDomain}/admin/api/${apiVersion}/shop.json`,
      {
        provider: 'Shopify',
        headers: { 'X-Shopify-Access-Token': token },
        counter: context.counter,
        onRetry: context.onRetry,
        signal: context.signal,
        maxAttempts: 2,
      },
    )

    const name = payload.shop?.name
    return {
      ok: Boolean(name),
      detail: name
        ? `Connected to "${name}" (${payload.shop?.myshopify_domain ?? shopDomain}), currency ${payload.shop?.currency ?? 'unknown'}.`
        : 'Connected, but Shopify returned no shop information.',
    }
  },

  async fetchOrders(context): Promise<Page<NormalizedOrder>> {
    const { shopDomain, token, apiVersion } = await connection(context)

    const params = new URLSearchParams({ limit: String(PAGE_SIZE), status: 'any' })
    if (context.cursor) {
      // Shopify forbids combining page_info with any other filter.
      params.set('page_info', context.cursor)
    } else {
      params.set('order', 'updated_at asc')
      if (context.since) params.set('updated_at_min', context.since.toISOString())
    }

    await limiter.acquire()
    const response = await providerFetch(
      `https://${shopDomain}/admin/api/${apiVersion}/orders.json?${params.toString()}`,
      {
        provider: 'Shopify',
        headers: { 'X-Shopify-Access-Token': token, Accept: 'application/json' },
        counter: context.counter,
        onRetry: context.onRetry,
        signal: context.signal,
      },
    )

    const payload = (await response.json()) as { orders?: ShopifyOrderPayload[] }
    const orders = payload.orders ?? []

    return {
      items: orders.map(normalizeOrder),
      nextCursor: parseNextPageInfo(response.headers.get('link')),
    }
  },

  async fetchCustomers(context): Promise<Page<NormalizedCustomer>> {
    const { shopDomain, token, apiVersion } = await connection(context)

    const params = new URLSearchParams({ limit: String(PAGE_SIZE) })
    if (context.cursor) {
      params.set('page_info', context.cursor)
    } else if (context.since) {
      params.set('updated_at_min', context.since.toISOString())
    }

    await limiter.acquire()
    const response = await providerFetch(
      `https://${shopDomain}/admin/api/${apiVersion}/customers.json?${params.toString()}`,
      {
        provider: 'Shopify',
        headers: { 'X-Shopify-Access-Token': token, Accept: 'application/json' },
        counter: context.counter,
        onRetry: context.onRetry,
        signal: context.signal,
      },
    )

    const payload = (await response.json()) as { customers?: ShopifyCustomerPayload[] }

    return {
      items: (payload.customers ?? []).map((customer) => {
        const name =
          [customer.first_name, customer.last_name].filter(Boolean).join(' ').trim() ||
          customer.email ||
          `Shopify customer ${customer.id}`
        const tags = (customer.tags ?? '').toLowerCase()
        return {
          sourceId: String(customer.id),
          name,
          email: customer.email ?? null,
          phone: customer.phone ?? null,
          city: customer.default_address?.city ?? null,
          region: customer.default_address?.province ?? null,
          country: customer.default_address?.country ?? null,
          classificationHint: tags.includes('distributor') || tags.includes('wholesale') ? 'DISTRIBUTOR' : 'DIRECT',
          raw: { tags: customer.tags ?? null },
        }
      }),
      nextCursor: parseNextPageInfo(response.headers.get('link')),
    }
  },
}

/**
 * Verifies a Shopify webhook signature.
 *
 * Shopify signs the raw request body with the app's webhook secret and sends
 * the base64 HMAC in `X-Shopify-Hmac-Sha256`. The comparison is constant-time,
 * and the RAW body must be used - parsing and re-serialising the JSON first
 * would change the bytes and every signature would fail.
 */
export function verifyShopifyWebhook(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature || !secret) return false
  const expected = hmacBase64(secret, rawBody)
  return safeEqual(expected, signature)
}

export type { ShopifyOrderPayload }
