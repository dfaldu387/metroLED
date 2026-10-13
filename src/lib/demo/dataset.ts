import {
  addDays,
  addMonths,
  endOfMonth,
  startOfDayInZone,
  startOfMonth,
  toIsoDate,
} from '../dates'
import { round2 } from '../analytics/revenue'
import type {
  CostRecord,
  Dataset,
  DivisionRef,
  IntegrationHealth,
  InvoiceRecord,
  OrderLineRecord,
  OrderRecord,
  QuoteRecord,
} from '../types'

/**
 * Labelled demo dataset.
 *
 * Purpose: let the client review the complete interface before the live
 * integrations are connected, as section 22 requires.
 *
 * Rules this file exists to honour:
 *   - Demo figures are NEVER presented as live production data. Every page
 *     served from this dataset shows a persistent banner, and the AI assistant
 *     states in its answer that it queried the demo dataset.
 *   - Demo mode is impossible in production (`demoDataAllowed()` returns false
 *     when APP_ENV is production).
 *   - The data is generated from a fixed seed so every render, every chart and
 *     every AI answer agrees. A reviewer who sees $412,800 on the Overview page
 *     sees the same number in the Revenue page and in the Daily Brief.
 *
 * The shape is realistic for a lighting and signage business: lumpy project
 * invoices for MetroLED and Pixel LED, a steady stream of small e-commerce
 * orders for Eco LED Mart, and a handful of large open quotes.
 */

export const DEMO_DIVISIONS: DivisionRef[] = [
  { id: 'demo-division-metroled', code: 'METROLED', name: 'MetroLED', sortOrder: 1 },
  { id: 'demo-division-pixel', code: 'PIXEL', name: 'Pixel LED Displays', sortOrder: 2 },
  { id: 'demo-division-eco', code: 'ECO', name: 'Eco LED Mart', sortOrder: 3 },
]

export const DEMO_SALES_REPS = [
  { id: 'demo-rep-1', name: 'Jordan Mills' },
  { id: 'demo-rep-2', name: 'Priya Raman' },
  { id: 'demo-rep-3', name: 'Marcus Webb' },
  { id: 'demo-rep-4', name: 'Chloe Tran' },
]

interface DemoCustomer {
  id: string
  name: string
  classification: 'DIRECT' | 'DISTRIBUTOR'
  divisionId: string
}

const DEMO_CUSTOMERS: DemoCustomer[] = [
  { id: 'demo-cust-01', name: 'Harbourfront Retail Group', classification: 'DIRECT', divisionId: 'demo-division-metroled' },
  { id: 'demo-cust-02', name: 'Northgate Property Management', classification: 'DIRECT', divisionId: 'demo-division-metroled' },
  { id: 'demo-cust-03', name: 'Lakeshore Signs & Graphics', classification: 'DISTRIBUTOR', divisionId: 'demo-division-metroled' },
  { id: 'demo-cust-04', name: 'Riverview Dental Centre', classification: 'DIRECT', divisionId: 'demo-division-metroled' },
  { id: 'demo-cust-05', name: 'Summit Electrical Supply', classification: 'DISTRIBUTOR', divisionId: 'demo-division-metroled' },
  { id: 'demo-cust-06', name: 'Westway Auto Group', classification: 'DIRECT', divisionId: 'demo-division-metroled' },
  { id: 'demo-cust-07', name: 'Pinnacle Hospitality Partners', classification: 'DIRECT', divisionId: 'demo-division-metroled' },
  { id: 'demo-cust-08', name: 'Beacon Construction Ltd.', classification: 'DIRECT', divisionId: 'demo-division-metroled' },
  { id: 'demo-cust-09', name: 'Cedar Park Municipality', classification: 'DIRECT', divisionId: 'demo-division-metroled' },
  { id: 'demo-cust-10', name: 'Trillium Distributors Inc.', classification: 'DISTRIBUTOR', divisionId: 'demo-division-metroled' },

  { id: 'demo-cust-11', name: 'Centre Court Arena', classification: 'DIRECT', divisionId: 'demo-division-pixel' },
  { id: 'demo-cust-12', name: 'Metro Transit Authority', classification: 'DIRECT', divisionId: 'demo-division-pixel' },
  { id: 'demo-cust-13', name: 'Skyline Media Networks', classification: 'DIRECT', divisionId: 'demo-division-pixel' },
  { id: 'demo-cust-14', name: 'Fairgrounds Events Co.', classification: 'DIRECT', divisionId: 'demo-division-pixel' },
  { id: 'demo-cust-15', name: 'AV Integrators Wholesale', classification: 'DISTRIBUTOR', divisionId: 'demo-division-pixel' },
  { id: 'demo-cust-16', name: 'Grandview Cinemas', classification: 'DIRECT', divisionId: 'demo-division-pixel' },
  { id: 'demo-cust-17', name: 'Stadium Systems Group', classification: 'DISTRIBUTOR', divisionId: 'demo-division-pixel' },
  { id: 'demo-cust-18', name: 'University of Ridgemont', classification: 'DIRECT', divisionId: 'demo-division-pixel' },

  { id: 'demo-cust-19', name: 'Eco LED Mart — online orders', classification: 'DIRECT', divisionId: 'demo-division-eco' },
]

const DEMO_PRODUCTS = [
  { id: 'demo-prod-1', sku: 'ELM-A19-9W-4K', title: 'A19 LED Bulb 9W 4000K (6-pack)', price: 34.99 },
  { id: 'demo-prod-2', sku: 'ELM-PANEL-2X4-50W', title: '2x4 LED Panel 50W Dimmable', price: 129.0 },
  { id: 'demo-prod-3', sku: 'ELM-STRIP-5M-RGB', title: 'RGB LED Strip 5m with Controller', price: 59.5 },
  { id: 'demo-prod-4', sku: 'ELM-FLOOD-100W', title: 'Outdoor LED Flood Light 100W', price: 89.95 },
  { id: 'demo-prod-5', sku: 'ELM-HIGHBAY-150W', title: 'UFO High Bay 150W 5000K', price: 179.0 },
  { id: 'demo-prod-6', sku: 'ELM-DOWN-6IN-12W', title: '6" Recessed Downlight 12W (4-pack)', price: 72.25 },
  { id: 'demo-prod-7', sku: 'ELM-DRIVER-60W', title: 'Constant Voltage Driver 60W', price: 41.0 },
  { id: 'demo-prod-8', sku: 'ELM-TUBE-T8-18W', title: 'T8 LED Tube 18W (10-pack)', price: 96.0 },
]

const QUOTE_STAGES = [
  { raw: 'Estimate Sent', normalized: 'estimate_sent' },
  { raw: 'Site Visit Scheduled', normalized: 'site_visit' },
  { raw: 'Awaiting Customer Decision', normalized: 'awaiting_decision' },
  { raw: 'In Negotiation', normalized: 'negotiation' },
  { raw: 'Pending Approval', normalized: 'pending_approval' },
]

/** Deterministic PRNG so the dataset is identical for every reader. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function pick<T>(rng: () => number, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)]!
}

function between(rng: () => number, min: number, max: number): number {
  return min + rng() * (max - min)
}

interface DemoCache {
  key: string
  dataset: Dataset
}

let cache: DemoCache | null = null

/**
 * Builds (and caches for the calendar day) the demo dataset.
 *
 * Caching by date keeps "last 30 days" meaningful while guaranteeing that two
 * requests in the same session see identical figures.
 */
export function getDemoDataset(now: Date = new Date()): Dataset {
  const today = startOfDayInZone(now)
  const key = toIsoDate(today)
  if (cache && cache.key === key) return cache.dataset

  const dataset = buildDemoDataset(today)
  cache = { key, dataset }
  return dataset
}

function buildDemoDataset(today: Date): Dataset {
  // Seed from the date so the data is stable within a day and advances daily.
  const seed = Number(key2int(toIsoDate(today)))
  const rng = mulberry32(seed)

  const historyMonths = 24
  const rangeStart = startOfMonth(addMonths(today, -(historyMonths - 1)))

  const invoices: InvoiceRecord[] = []
  const quotes: QuoteRecord[] = []
  const orders: OrderRecord[] = []
  const costs: CostRecord[] = []

  const divisionById = new Map(DEMO_DIVISIONS.map((d) => [d.id, d]))
  const projectCustomers = DEMO_CUSTOMERS.filter((c) => c.divisionId !== 'demo-division-eco')

  let invoiceSeq = 10200
  let quoteSeq = 4100
  let orderSeq = 2800

  // --- Invoices ------------------------------------------------------------
  for (let monthOffset = 0; monthOffset < historyMonths; monthOffset++) {
    const monthStart = startOfMonth(addMonths(rangeStart, monthOffset))
    const monthEnd = endOfMonth(monthStart)
    const isCurrentMonth = monthStart.getUTCMonth() === today.getUTCMonth() && monthStart.getUTCFullYear() === today.getUTCFullYear()

    // Gentle growth over two years plus a seasonal lift in spring and autumn.
    const growth = 1 + monthOffset * 0.012
    const month = monthStart.getUTCMonth()
    const seasonal = month >= 3 && month <= 5 ? 1.18 : month >= 8 && month <= 10 ? 1.12 : month === 11 ? 0.82 : 1
    // The current month is only part-way through, so it gets a proportional
    // share of invoices. Without this, a month-to-date figure would look like
    // a full month and the period-over-period comparison would be nonsense.
    const daysInMonth = monthEnd.getUTCDate()
    const elapsedDays = isCurrentMonth ? today.getUTCDate() : daysInMonth
    const invoiceCount = Math.max(
      1,
      Math.round(between(rng, 9, 16) * growth * seasonal * (elapsedDays / daysInMonth)),
    )

    for (let i = 0; i < invoiceCount; i++) {
      const customer = pick(rng, projectCustomers)
      const division = divisionById.get(customer.divisionId)!
      const rep = pick(rng, DEMO_SALES_REPS)

      // Pixel LED projects are larger and less frequent than MetroLED jobs.
      const base =
        division.id === 'demo-division-pixel' ? between(rng, 12000, 78000) : between(rng, 1800, 32000)
      const revenueAmount = round2(base * growth * seasonal)
      const taxTotal = round2(revenueAmount * 0.13)
      const total = round2(revenueAmount + taxTotal)

      const dayOffset = Math.floor(between(rng, 0, isCurrentMonth ? today.getUTCDate() : monthEnd.getUTCDate()))
      const issuedOn = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth(), Math.max(1, dayOffset)))
      if (issuedOn > today) continue

      const termsDays = pick(rng, [15, 30, 30, 30, 45, 60])
      const dueOn = addDays(issuedOn, termsDays)
      const ageDays = Math.floor((today.getTime() - issuedOn.getTime()) / 86400000)

      // Collection behaviour that matches a real ledger: almost everything
      // older than four months has been collected, so the aging buckets stay
      // believable. A couple of genuinely old stragglers are left in on
      // purpose, because every business has one or two in collections and the
      // "more than 90 days" bucket should not be permanently empty.
      let status: InvoiceRecord['status']
      const roll = rng()
      if (ageDays > 120) {
        status = roll < 0.99 ? 'PAID' : 'OPEN'
      } else if (ageDays > 75) {
        status = roll < 0.9 ? 'PAID' : roll < 0.96 ? 'PARTIALLY_PAID' : 'OPEN'
      } else if (ageDays > 45) {
        status = roll < 0.7 ? 'PAID' : roll < 0.85 ? 'PARTIALLY_PAID' : 'OPEN'
      } else {
        status = roll < 0.35 ? 'PAID' : roll < 0.5 ? 'PARTIALLY_PAID' : 'OPEN'
      }
      const amountPaid =
        status === 'PAID'
          ? total
          : status === 'PARTIALLY_PAID'
            ? round2(total * between(rng, 0.25, 0.7))
            : 0
      const balance = round2(Math.max(0, total - amountPaid))

      // A small share of invoices is intentionally left without a division so
      // the "Unassigned" state and the mapping warning are visible in review.
      const assignDivision = rng() > 0.03

      invoices.push({
        id: `demo-inv-${invoiceSeq}`,
        sourceId: `qbo-${invoiceSeq}`,
        docNumber: String(invoiceSeq),
        provider: 'QUICKBOOKS',
        status,
        issuedOn,
        dueOn,
        divisionId: assignDivision ? division.id : null,
        divisionCode: assignDivision ? division.code : null,
        divisionName: assignDivision ? division.name : null,
        customerId: customer.id,
        customerName: customer.name,
        customerClassification: customer.classification,
        salesRepId: rep.id,
        salesRepName: rep.name,
        currency: 'CAD',
        revenueAmount,
        total,
        amountPaid,
        balance,
        costAmount: round2(revenueAmount * between(rng, 0.52, 0.71)),
        syncedAt: addDays(today, 0),
      })
      invoiceSeq++
    }

    // --- Cost of goods sold per division per month ------------------------
    for (const division of DEMO_DIVISIONS) {
      const monthRevenue = invoices
        .filter(
          (inv) =>
            inv.divisionId === division.id &&
            inv.issuedOn >= monthStart &&
            inv.issuedOn <= monthEnd &&
            inv.status !== 'VOID',
        )
        .reduce((acc, inv) => acc + inv.revenueAmount, 0)

      if (monthRevenue <= 0) continue

      // Pixel LED carries more hardware cost than MetroLED installations.
      const costRatio =
        division.id === 'demo-division-pixel'
          ? between(rng, 0.62, 0.72)
          : division.id === 'demo-division-eco'
            ? between(rng, 0.55, 0.65)
            : between(rng, 0.51, 0.63)

      // Every closed month is approved, so the margin pages show real figures;
      // the current month is deliberately left unapproved, which is both
      // realistic (Finance closes a month before signing off its cost) and
      // the only way to see the "not yet approved" state during review.
      const monthsAgo = Math.round(
        (today.getUTCFullYear() - monthStart.getUTCFullYear()) * 12 + (today.getUTCMonth() - monthStart.getUTCMonth()),
      )
      costs.push({
        divisionId: division.id,
        periodStart: monthStart,
        periodEnd: monthEnd,
        cogsAmount: round2(monthRevenue * costRatio),
        isApproved: monthsAgo >= 1,
        basis: 'QBO_COGS_ACCOUNTS',
      })
    }
  }

  // --- Quotes --------------------------------------------------------------
  // 24 months of quote history, with a realistic set still open today.
  for (let monthOffset = 0; monthOffset < historyMonths; monthOffset++) {
    const monthStart = startOfMonth(addMonths(rangeStart, monthOffset))
    const monthEnd = endOfMonth(monthStart)
    const quoteCount = Math.round(between(rng, 8, 15))

    for (let i = 0; i < quoteCount; i++) {
      const customer = pick(rng, projectCustomers)
      const division = divisionById.get(customer.divisionId)!
      const rep = pick(rng, DEMO_SALES_REPS)
      const stage = pick(rng, QUOTE_STAGES)

      const amount = round2(
        division.id === 'demo-division-pixel' ? between(rng, 15000, 140000) : between(rng, 2500, 48000),
      )
      const dayOffset = Math.floor(between(rng, 1, monthEnd.getUTCDate()))
      const issuedOn = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth(), dayOffset))
      if (issuedOn > today) continue

      const ageDays = Math.floor((today.getTime() - issuedOn.getTime()) / 86400000)

      // A quote reaches a decision eventually: nothing older than five months
      // is still shown as open, so the pipeline total reflects live deals
      // rather than forgotten paperwork.
      let status: QuoteRecord['status']
      const statusRoll = rng()
      if (ageDays > 150) {
        status = statusRoll < 0.33 ? 'WON' : statusRoll < 0.86 ? 'LOST' : 'EXPIRED'
      } else if (ageDays > 90) {
        status = statusRoll < 0.32 ? 'WON' : statusRoll < 0.76 ? 'LOST' : statusRoll < 0.9 ? 'EXPIRED' : 'OPEN'
      } else if (ageDays > 45) {
        status = statusRoll < 0.3 ? 'WON' : statusRoll < 0.55 ? 'LOST' : 'OPEN'
      } else {
        status = statusRoll < 0.16 ? 'WON' : statusRoll < 0.26 ? 'LOST' : 'OPEN'
      }

      const closedOn =
        status === 'WON' || status === 'LOST'
          ? addDays(issuedOn, Math.floor(between(rng, 5, Math.max(6, Math.min(ageDays, 70)))))
          : null

      // Idle time: most open quotes are recent, a handful have gone cold.
      const idleDays =
        status === 'OPEN'
          ? rng() < 0.28
            ? Math.floor(between(rng, 22, Math.max(23, Math.min(ageDays, 75))))
            : Math.floor(between(rng, 0, Math.max(1, Math.min(ageDays, 20))))
          : 0
      const lastActivityAt = status === 'OPEN' ? addDays(today, -idleDays) : closedOn

      quotes.push({
        id: `demo-quote-${quoteSeq}`,
        sourceId: `method-${quoteSeq}`,
        docNumber: `Q-${quoteSeq}`,
        provider: 'METHOD_CRM',
        status,
        stage: status === 'OPEN' ? stage.raw : status === 'WON' ? 'Closed Won' : 'Closed Lost',
        stageNormalized: status === 'OPEN' ? stage.normalized : status === 'WON' ? 'closed_won' : 'closed_lost',
        issuedOn,
        expiresOn: addDays(issuedOn, 30),
        closedOn: closedOn && closedOn <= today ? closedOn : null,
        lastActivityAt: lastActivityAt && lastActivityAt <= today ? lastActivityAt : issuedOn,
        divisionId: division.id,
        divisionCode: division.code,
        divisionName: division.name,
        customerId: customer.id,
        customerName: customer.name,
        salesRepId: rep.id,
        salesRepName: rep.name,
        currency: 'CAD',
        amount,
        syncedAt: today,
      })
      quoteSeq++
    }
  }

  // --- Shopify orders (Eco LED Mart) --------------------------------------
  const ecoDivision = divisionById.get('demo-division-eco')!
  const orderDayCount = 400
  for (let dayOffset = orderDayCount; dayOffset >= 0; dayOffset--) {
    const day = addDays(today, -dayOffset)
    const weekday = day.getUTCDay()
    // Weekends are quieter; December is busier.
    const weekendFactor = weekday === 0 || weekday === 6 ? 0.55 : 1
    const seasonFactor = day.getUTCMonth() === 11 ? 1.6 : day.getUTCMonth() === 0 ? 0.8 : 1
    const ordersToday = Math.round(between(rng, 1, 9) * weekendFactor * seasonFactor)

    for (let i = 0; i < ordersToday; i++) {
      const lineCount = Math.max(1, Math.round(between(rng, 1, 3.6)))
      const lines: OrderLineRecord[] = []
      let subtotal = 0

      for (let l = 0; l < lineCount; l++) {
        const product = pick(rng, DEMO_PRODUCTS)
        const quantity = Math.max(1, Math.round(between(rng, 1, 4)))
        const amount = round2(product.price * quantity)
        lines.push({
          sku: product.sku,
          title: product.title,
          quantity,
          amount,
          productSourceId: product.id,
        })
        subtotal += amount
      }

      const discountRate = rng() < 0.22 ? between(rng, 0.05, 0.2) : 0
      const totalDiscounts = round2(subtotal * discountRate)
      const subtotalAfterDiscount = round2(subtotal - totalDiscounts)
      const totalShipping = subtotalAfterDiscount > 150 ? 0 : round2(between(rng, 9.95, 24.95))
      const totalTax = round2(subtotalAfterDiscount * 0.13)
      const refunded = rng() < 0.035 ? round2(subtotalAfterDiscount * (rng() < 0.5 ? 1 : between(rng, 0.2, 0.6))) : 0

      const cancelled = rng() < 0.02
      const hour = Math.floor(between(rng, 7, 23))
      const placedAt = new Date(
        Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), hour, Math.floor(between(rng, 0, 59))),
      )

      const financialStatus: OrderRecord['financialStatus'] = cancelled
        ? 'VOIDED'
        : refunded === 0
          ? 'PAID'
          : refunded >= subtotalAfterDiscount - 0.01
            ? 'REFUNDED'
            : 'PARTIALLY_REFUNDED'

      const fulfillmentStatus: OrderRecord['fulfillmentStatus'] = cancelled
        ? 'RESTOCKED'
        : dayOffset > 4
          ? 'FULFILLED'
          : rng() < 0.45
            ? 'UNFULFILLED'
            : rng() < 0.6
              ? 'PARTIAL'
              : 'FULFILLED'

      orders.push({
        id: `demo-order-${orderSeq}`,
        sourceId: `shopify-${5500000000 + orderSeq}`,
        orderNumber: `#ELM${orderSeq}`,
        provider: 'SHOPIFY',
        financialStatus,
        fulfillmentStatus,
        placedAt,
        cancelledAt: cancelled ? placedAt : null,
        divisionId: ecoDivision.id,
        divisionCode: ecoDivision.code,
        customerName: pick(rng, [
          'Dana Whitfield',
          'Omar Haddad',
          'Lucy Beaumont',
          'Thomas Ng',
          'Aisha Bello',
          'Ryan Kovacs',
          'Elena Petrova',
          'Samuel Okafor',
          'Mei Lin',
          'Patrick Doyle',
        ]),
        email: null,
        currency: 'CAD',
        subtotalPrice: round2(subtotal),
        totalDiscounts,
        totalTax,
        totalShipping,
        totalRefunded: refunded,
        totalPrice: round2(subtotalAfterDiscount + totalTax + totalShipping),
        netSalesAmount: round2(subtotalAfterDiscount - refunded),
        lines,
        syncedAt: today,
      })
      orderSeq++
    }
  }

  // --- Integration health --------------------------------------------------
  // One source is deliberately shown as stale so the "Attention required"
  // section and the Data Health warnings are visible during review.
  const integrations: IntegrationHealth[] = [
    {
      provider: 'QUICKBOOKS',
      displayName: 'QuickBooks Online',
      status: 'CONNECTED',
      isEnabled: true,
      isConfigured: true,
      lastSuccessAt: new Date(Date.now() - 42 * 60 * 1000),
      lastAttemptAt: new Date(Date.now() - 42 * 60 * 1000),
      lastErrorAt: null,
      lastErrorMessage: null,
      consecutiveFailures: 0,
      syncIntervalMin: 180,
      isStale: false,
      minutesSinceSuccess: 42,
    },
    {
      provider: 'METHOD_CRM',
      displayName: 'Method CRM',
      status: 'CONNECTED',
      isEnabled: true,
      isConfigured: true,
      lastSuccessAt: new Date(Date.now() - 2 * 60 * 60 * 1000 - 11 * 60 * 1000),
      lastAttemptAt: new Date(Date.now() - 2 * 60 * 60 * 1000 - 11 * 60 * 1000),
      lastErrorAt: null,
      lastErrorMessage: null,
      consecutiveFailures: 0,
      syncIntervalMin: 180,
      isStale: false,
      minutesSinceSuccess: 131,
    },
    {
      provider: 'SHOPIFY',
      displayName: 'Shopify — Eco LED Mart',
      status: 'DEGRADED',
      isEnabled: true,
      isConfigured: true,
      lastSuccessAt: new Date(Date.now() - 9 * 60 * 60 * 1000),
      lastAttemptAt: new Date(Date.now() - 24 * 60 * 1000),
      lastErrorAt: new Date(Date.now() - 24 * 60 * 1000),
      lastErrorMessage: 'HTTP 429 from Shopify Admin API (rate limited). The next scheduled attempt will retry.',
      consecutiveFailures: 2,
      syncIntervalMin: 180,
      isStale: true,
      minutesSinceSuccess: 540,
    },
  ]

  const lastRefreshAt = integrations
    .map((i) => i.lastSuccessAt)
    .filter((d): d is Date => d !== null)
    .sort((a, b) => b.getTime() - a.getTime())[0] ?? null

  return {
    mode: 'demo',
    divisions: DEMO_DIVISIONS,
    invoices,
    quotes,
    orders,
    costs,
    integrations,
    salesReps: DEMO_SALES_REPS,
    freshness: {
      mode: 'demo',
      lastRefreshAt,
      isStale: integrations.some((i) => i.isStale),
      staleSources: integrations.filter((i) => i.isStale).map((i) => i.displayName),
      missingSources: [],
    },
    loadedRange: { start: rangeStart, end: today },
  }
}

function key2int(iso: string): number {
  let hash = 2166136261
  for (let i = 0; i < iso.length; i++) {
    hash ^= iso.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

/** The number of unmatched demo records shown on the Data Health page. */
export const DEMO_UNMATCHED_COUNT = 3

export const DEMO_UNMATCHED_RECORDS = [
  {
    id: 'demo-unmatched-1',
    provider: 'METHOD_CRM' as const,
    entity: 'customer',
    sourceId: 'method-cust-8841',
    sourceName: 'Harbourfront Retail Grp.',
    reason: 'Name is similar to "Harbourfront Retail Group" but below the automatic match threshold.',
    suggestion: 'Harbourfront Retail Group',
  },
  {
    id: 'demo-unmatched-2',
    provider: 'SHOPIFY' as const,
    entity: 'customer',
    sourceId: 'shopify-cust-55120',
    sourceName: 'northgate pm',
    reason: 'No email on the Shopify customer record, and the name does not match any QuickBooks customer.',
    suggestion: 'Northgate Property Management',
  },
  {
    id: 'demo-unmatched-3',
    provider: 'QUICKBOOKS' as const,
    entity: 'customer',
    sourceId: 'qbo-cust-412',
    sourceName: 'Cash Sale',
    reason: 'Generic placeholder customer used for walk-in sales. Needs a decision on how to report it.',
    suggestion: null,
  },
]
