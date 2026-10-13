import { describe, expect, it } from 'vitest'
import {
  countRevenueInvoices,
  percentChange,
  revenueByClassification,
  revenueByDivision,
  revenueTrend,
  sumRevenue,
} from '@/lib/analytics/revenue'
import {
  agingBuckets,
  bucketFor,
  daysOverdue,
  daysSalesOutstanding,
  newlyOverdue,
  receivablesSummary,
} from '@/lib/analytics/receivables'
import { marginFor, approvedCostFor } from '@/lib/analytics/margin'
import { pipelineSummary, staleQuotes, winRate, daysSinceActivity } from '@/lib/analytics/pipeline'
import { ecommerceSummary, bestSellers } from '@/lib/analytics/ecommerce'
import type { CostRecord, InvoiceRecord, OrderRecord, QuoteRecord } from '@shared/types'

/**
 * Financial calculation accuracy (section 19).
 *
 * These assert the behaviours the Phase 1 scope calls out specifically:
 * what counts as revenue, how aging is bucketed, when a figure must be
 * reported as unavailable rather than zero, and that no metric silently
 * invents a number it cannot support.
 */

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

function invoice(overrides: Partial<InvoiceRecord> = {}): InvoiceRecord {
  return {
    id: 'inv-1',
    sourceId: 'qbo-1',
    docNumber: '1001',
    provider: 'QUICKBOOKS',
    status: 'OPEN',
    issuedOn: d('2026-03-10'),
    dueOn: d('2026-04-09'),
    divisionId: 'div-metroled',
    divisionCode: 'METROLED',
    divisionName: 'MetroLED',
    customerId: 'cust-1',
    customerName: 'Harbourfront Retail Group',
    customerClassification: 'DIRECT',
    salesRepId: 'rep-1',
    salesRepName: 'Jordan Mills',
    currency: 'CAD',
    revenueAmount: 1000,
    total: 1130,
    amountPaid: 0,
    balance: 1130,
    costAmount: 600,
    syncedAt: d('2026-03-11'),
    ...overrides,
  }
}

function quote(overrides: Partial<QuoteRecord> = {}): QuoteRecord {
  return {
    id: 'q-1',
    sourceId: 'method-1',
    docNumber: 'Q-1',
    provider: 'METHOD_CRM',
    status: 'OPEN',
    stage: 'Estimate Sent',
    stageNormalized: 'estimate_sent',
    issuedOn: d('2026-03-01'),
    expiresOn: d('2026-03-31'),
    closedOn: null,
    lastActivityAt: d('2026-03-05'),
    divisionId: 'div-metroled',
    divisionCode: 'METROLED',
    divisionName: 'MetroLED',
    customerId: 'cust-1',
    customerName: 'Harbourfront Retail Group',
    salesRepId: 'rep-1',
    salesRepName: 'Jordan Mills',
    currency: 'CAD',
    amount: 5000,
    syncedAt: d('2026-03-06'),
    ...overrides,
  }
}

function order(overrides: Partial<OrderRecord> = {}): OrderRecord {
  return {
    id: 'o-1',
    sourceId: 'shopify-1',
    orderNumber: '#ELM1',
    provider: 'SHOPIFY',
    financialStatus: 'PAID',
    fulfillmentStatus: 'FULFILLED',
    placedAt: new Date('2026-03-10T14:00:00.000Z'),
    cancelledAt: null,
    divisionId: 'div-eco',
    divisionCode: 'ECO',
    customerName: 'Dana Whitfield',
    email: null,
    currency: 'CAD',
    subtotalPrice: 200,
    totalDiscounts: 20,
    totalTax: 26,
    totalShipping: 15,
    totalRefunded: 0,
    totalPrice: 241,
    netSalesAmount: 200,
    lines: [{ sku: 'ELM-A19', title: 'A19 Bulb', quantity: 4, amount: 200, productSourceId: 'p-1' }],
    syncedAt: d('2026-03-11'),
    ...overrides,
  }
}

const MARCH = { start: d('2026-03-01'), end: new Date('2026-03-31T23:59:59.999Z') }

// ---------------------------------------------------------------------------

describe('revenue', () => {
  it('sums the subtotal excluding tax, not the invoice total', () => {
    const invoices = [invoice({ revenueAmount: 1000, total: 1130 }), invoice({ id: 'i2', revenueAmount: 2500, total: 2825 })]
    expect(sumRevenue(invoices, MARCH)).toBe(3500)
  })

  it('counts open, partially paid and paid invoices as revenue', () => {
    const invoices = [
      invoice({ id: 'a', status: 'OPEN', revenueAmount: 100 }),
      invoice({ id: 'b', status: 'PARTIALLY_PAID', revenueAmount: 200 }),
      invoice({ id: 'c', status: 'PAID', revenueAmount: 300 }),
    ]
    expect(sumRevenue(invoices, MARCH)).toBe(600)
    expect(countRevenueInvoices(invoices, MARCH)).toBe(3)
  })

  it('excludes draft, voided and written-off invoices', () => {
    const invoices = [
      invoice({ id: 'a', status: 'PAID', revenueAmount: 1000 }),
      invoice({ id: 'b', status: 'DRAFT', revenueAmount: 500 }),
      invoice({ id: 'c', status: 'VOID', revenueAmount: 700 }),
      invoice({ id: 'd', status: 'WRITTEN_OFF', revenueAmount: 900 }),
    ]
    expect(sumRevenue(invoices, MARCH)).toBe(1000)
  })

  it('uses the invoice date, not the payment or sync date', () => {
    const invoices = [
      invoice({ id: 'in', issuedOn: d('2026-03-15'), revenueAmount: 1000, syncedAt: d('2026-05-01') }),
      invoice({ id: 'out', issuedOn: d('2026-04-02'), revenueAmount: 9999, syncedAt: d('2026-03-02') }),
    ]
    expect(sumRevenue(invoices, MARCH)).toBe(1000)
  })

  it('treats the period boundaries as inclusive', () => {
    const invoices = [
      invoice({ id: 'first', issuedOn: d('2026-03-01'), revenueAmount: 100 }),
      invoice({ id: 'last', issuedOn: d('2026-03-31'), revenueAmount: 200 }),
      invoice({ id: 'before', issuedOn: d('2026-02-28'), revenueAmount: 400 }),
      invoice({ id: 'after', issuedOn: d('2026-04-01'), revenueAmount: 800 }),
    ]
    expect(sumRevenue(invoices, MARCH)).toBe(300)
  })

  it('does not lose cents when summing many invoices', () => {
    const invoices = Array.from({ length: 300 }, (_, i) =>
      invoice({ id: `i${i}`, revenueAmount: 10.1, total: 11.41 }),
    )
    // 300 x 10.10 = 3030.00 exactly, with no floating-point tail.
    expect(sumRevenue(invoices, MARCH)).toBe(3030)
  })

  it('reports no percentage change when the previous period was zero', () => {
    // An increase "from nothing" has no meaningful percentage.
    expect(percentChange(5000, 0)).toBeNull()
    expect(percentChange(5000, null)).toBeNull()
    expect(percentChange(150, 100)).toBe(50)
    expect(percentChange(50, 100)).toBe(-50)
  })

  it('groups unassigned invoices separately rather than into a division', () => {
    const invoices = [
      invoice({ id: 'a', revenueAmount: 1000 }),
      invoice({ id: 'b', revenueAmount: 500, divisionId: null, divisionCode: null, divisionName: null }),
    ]
    const rows = revenueByDivision(invoices, { range: MARCH })
    expect(rows).toHaveLength(2)
    const unassigned = rows.find((r) => r.key === '__unassigned__')
    expect(unassigned?.label).toBe('Unassigned')
    expect(unassigned?.value).toBe(500)
  })

  it('splits distributor from direct revenue', () => {
    const invoices = [
      invoice({ id: 'a', revenueAmount: 1000, customerClassification: 'DIRECT' }),
      invoice({ id: 'b', revenueAmount: 400, customerClassification: 'DISTRIBUTOR' }),
      invoice({ id: 'c', revenueAmount: 100, customerClassification: 'UNCLASSIFIED' }),
    ]
    const rows = revenueByClassification(invoices, { range: MARCH })
    expect(rows.find((r) => r.key === 'DIRECT')?.value).toBe(1000)
    expect(rows.find((r) => r.key === 'DISTRIBUTOR')?.value).toBe(400)
    expect(rows.find((r) => r.key === 'UNCLASSIFIED')?.label).toBe('Not classified')
  })

  it('produces a complete set of buckets, including empty ones', () => {
    const points = revenueTrend([invoice({ issuedOn: d('2026-03-10'), revenueAmount: 500 })], MARCH, 'day')
    expect(points).toHaveLength(31)
    expect(points.find((p) => p.date === '2026-03-10')?.value).toBe(500)
    expect(points.find((p) => p.date === '2026-03-11')?.value).toBe(0)
  })
})

// ---------------------------------------------------------------------------

describe('accounts receivable', () => {
  const asOf = d('2026-05-01')

  it('counts only open and partially paid invoices with a balance', () => {
    const invoices = [
      invoice({ id: 'a', status: 'OPEN', balance: 1000 }),
      invoice({ id: 'b', status: 'PARTIALLY_PAID', balance: 500 }),
      invoice({ id: 'c', status: 'PAID', balance: 0 }),
      invoice({ id: 'd', status: 'VOID', balance: 999 }),
    ]
    const summary = receivablesSummary(invoices, asOf)
    expect(summary.totalOutstanding).toBe(1500)
    expect(summary.invoiceCount).toBe(2)
  })

  it('computes days overdue from the due date', () => {
    expect(daysOverdue(invoice({ dueOn: d('2026-04-01') }), d('2026-04-11'))).toBe(10)
    // Not yet due is negative, not clamped to zero.
    expect(daysOverdue(invoice({ dueOn: d('2026-04-20') }), d('2026-04-10'))).toBe(-10)
    expect(daysOverdue(invoice({ dueOn: null }), d('2026-04-10'))).toBeNull()
  })

  it('keeps invoices with no due date out of the overdue total', () => {
    const invoices = [
      invoice({ id: 'overdue', dueOn: d('2026-04-01'), balance: 1000 }),
      invoice({ id: 'nodue', dueOn: null, balance: 700 }),
    ]
    const summary = receivablesSummary(invoices, asOf)
    expect(summary.overdueAmount).toBe(1000)
    expect(summary.noDueDateAmount).toBe(700)
    expect(summary.noDueDateCount).toBe(1)
    // The grand total still includes them.
    expect(summary.totalOutstanding).toBe(1700)
  })

  it('assigns the documented aging buckets', () => {
    expect(bucketFor(0)).toBe('current')
    expect(bucketFor(-5)).toBe('current')
    expect(bucketFor(1)).toBe('1_30')
    expect(bucketFor(30)).toBe('1_30')
    expect(bucketFor(31)).toBe('31_60')
    expect(bucketFor(60)).toBe('31_60')
    expect(bucketFor(61)).toBe('61_90')
    expect(bucketFor(90)).toBe('61_90')
    expect(bucketFor(91)).toBe('over_90')
    expect(bucketFor(400)).toBe('over_90')
  })

  it('totals each aging bucket and adds a separate no-due-date row', () => {
    const invoices = [
      invoice({ id: 'a', dueOn: d('2026-05-20'), balance: 100 }), // current
      invoice({ id: 'b', dueOn: d('2026-04-20'), balance: 200 }), // 11 days
      invoice({ id: 'c', dueOn: d('2026-03-20'), balance: 300 }), // 42 days
      invoice({ id: 'd', dueOn: d('2026-01-01'), balance: 400 }), // 120 days
      invoice({ id: 'e', dueOn: null, balance: 500 }),
    ]
    const buckets = agingBuckets(invoices, asOf)
    const byKey = Object.fromEntries(buckets.map((b) => [b.key, b.amount]))
    expect(byKey.current).toBe(100)
    expect(byKey['1_30']).toBe(200)
    expect(byKey['31_60']).toBe(300)
    expect(byKey.over_90).toBe(400)
    expect(byKey.no_due_date).toBe(500)
  })

  it('weights average days overdue by balance, not by invoice count', () => {
    const invoices = [
      invoice({ id: 'small', dueOn: d('2026-04-21'), balance: 100 }), // 10 days
      invoice({ id: 'large', dueOn: d('2026-03-02'), balance: 900 }), // 60 days
    ]
    const summary = receivablesSummary(invoices, asOf)
    // (10*100 + 60*900) / 1000 = 55, not the unweighted mean of 35.
    expect(summary.averageDaysOverdue).toBe(55)
  })

  it('reports DSO as unavailable when there is no revenue', () => {
    expect(daysSalesOutstanding(50_000, 0, 30)).toBeNull()
    expect(daysSalesOutstanding(50_000, 100_000, 30)).toBe(15)
  })

  it('finds invoices that became overdue inside a window', () => {
    const invoices = [
      invoice({ id: 'yesterday', dueOn: d('2026-04-29'), balance: 100 }),
      invoice({ id: 'old', dueOn: d('2026-01-01'), balance: 200 }),
    ]
    const results = newlyOverdue(invoices, d('2026-04-29'), d('2026-05-01'))
    expect(results.map((i) => i.id)).toEqual(['yesterday'])
  })
})

// ---------------------------------------------------------------------------

describe('gross margin', () => {
  const march = { start: d('2026-03-01'), end: new Date('2026-03-31T23:59:59.999Z') }

  const cost = (overrides: Partial<CostRecord> = {}): CostRecord => ({
    divisionId: 'div-metroled',
    periodStart: d('2026-03-01'),
    periodEnd: d('2026-03-31'),
    cogsAmount: 600,
    isApproved: true,
    basis: 'QBO_COGS_ACCOUNTS',
    ...overrides,
  })

  it('applies the approved formula', () => {
    const result = marginFor([invoice({ revenueAmount: 1000 })], [cost({ cogsAmount: 600 })], march, null)
    expect(result.availability).toBe('available')
    expect(result.revenue).toBe(1000)
    expect(result.cogs).toBe(600)
    expect(result.grossProfit).toBe(400)
    expect(result.grossMarginPercent).toBe(40)
  })

  it('refuses to report a margin when the cost is not approved', () => {
    const result = marginFor([invoice({ revenueAmount: 1000 })], [cost({ isApproved: false })], march, null)
    expect(result.availability).toBe('unavailable')
    expect(result.grossMarginPercent).toBeNull()
    expect(result.grossProfit).toBeNull()
    expect(result.reason).toContain('has not been approved')
    expect(result.missingCostMonths).toContain('Mar 2026')
  })

  it('refuses when only part of a multi-month period has approved costs', () => {
    const quarter = { start: d('2026-01-01'), end: new Date('2026-03-31T23:59:59.999Z') }
    const costs = [
      cost({ periodStart: d('2026-01-01'), periodEnd: d('2026-01-31'), cogsAmount: 100 }),
      cost({ periodStart: d('2026-02-01'), periodEnd: d('2026-02-28'), cogsAmount: 100 }),
      // March is missing entirely.
    ]
    const result = marginFor([invoice({ revenueAmount: 1000 })], costs, quarter, null)
    expect(result.availability).toBe('unavailable')
    expect(result.missingCostMonths).toEqual(['Mar 2026'])
  })

  it('reports an undefined percentage rather than zero when there is no revenue', () => {
    const result = marginFor([], [cost({ cogsAmount: 600 })], march, null)
    expect(result.availability).toBe('unavailable')
    expect(result.grossMarginPercent).toBeNull()
    expect(result.reason).toContain('no revenue')
  })

  it('handles a negative margin without clamping it', () => {
    const result = marginFor([invoice({ revenueAmount: 1000 })], [cost({ cogsAmount: 1400 })], march, null)
    expect(result.grossProfit).toBe(-400)
    expect(result.grossMarginPercent).toBe(-40)
  })

  it('only counts approved cost rows toward the total', () => {
    const { total, missingMonths } = approvedCostFor(
      [cost({ cogsAmount: 500, isApproved: true }), cost({ cogsAmount: 999, isApproved: false })],
      march,
      'div-metroled',
    )
    expect(total).toBe(500)
    expect(missingMonths).toHaveLength(0)
  })

  it('scopes cost to the requested division', () => {
    const costs = [
      cost({ divisionId: 'div-metroled', cogsAmount: 600 }),
      cost({ divisionId: 'div-pixel', cogsAmount: 900 }),
    ]
    const metroled = marginFor([invoice({ revenueAmount: 1000 })], costs, march, 'div-metroled')
    expect(metroled.cogs).toBe(600)
  })
})

// ---------------------------------------------------------------------------

describe('sales pipeline', () => {
  const asOf = d('2026-04-01')
  const settings = { staleThresholdDays: 21, largeQuoteAmount: 10_000 }

  it('counts only open quotes in the pipeline total', () => {
    const quotes = [
      quote({ id: 'a', status: 'OPEN', amount: 1000 }),
      quote({ id: 'b', status: 'WON', amount: 5000 }),
      quote({ id: 'c', status: 'LOST', amount: 7000 }),
      quote({ id: 'd', status: 'EXPIRED', amount: 2000 }),
    ]
    const summary = pipelineSummary(quotes, asOf, settings)
    expect(summary.openValue).toBe(1000)
    expect(summary.openCount).toBe(1)
  })

  it('ages a quote with no recorded activity from its quote date', () => {
    expect(daysSinceActivity(quote({ lastActivityAt: null, issuedOn: d('2026-03-01') }), asOf)).toBe(31)
    expect(daysSinceActivity(quote({ lastActivityAt: d('2026-03-25') }), asOf)).toBe(7)
  })

  it('identifies stale quotes at or beyond the threshold', () => {
    const quotes = [
      quote({ id: 'fresh', lastActivityAt: d('2026-03-28'), amount: 20_000 }),
      quote({ id: 'stale', lastActivityAt: d('2026-03-01'), amount: 30_000 }),
    ]
    const stale = staleQuotes(quotes, asOf, 21)
    expect(stale.map((q) => q.id)).toEqual(['stale'])
    expect(stale[0]?.daysIdle).toBe(31)
  })

  it('reports win rate as unavailable when nothing was decided', () => {
    const march = { start: d('2026-03-01'), end: new Date('2026-03-31T23:59:59.999Z') }
    expect(winRate([quote({ status: 'OPEN' })], march).winRatePercent).toBeNull()
  })

  it('excludes expired and cancelled quotes from win rate', () => {
    const march = { start: d('2026-03-01'), end: new Date('2026-03-31T23:59:59.999Z') }
    const quotes = [
      quote({ id: 'w1', status: 'WON', closedOn: d('2026-03-10') }),
      quote({ id: 'l1', status: 'LOST', closedOn: d('2026-03-12') }),
      quote({ id: 'e1', status: 'EXPIRED', closedOn: d('2026-03-14') }),
      quote({ id: 'c1', status: 'CANCELLED', closedOn: d('2026-03-16') }),
    ]
    const result = winRate(quotes, march)
    expect(result.decidedCount).toBe(2)
    expect(result.winRatePercent).toBe(50)
  })

  it('never produces a probability-weighted figure', () => {
    const summary = pipelineSummary([quote({ amount: 10_000 })], asOf, settings)
    // The open value is the raw total; no weighting is applied anywhere.
    expect(summary.openValue).toBe(10_000)
    expect(Object.keys(summary)).not.toContain('weightedValue')
  })
})

// ---------------------------------------------------------------------------

describe('e-commerce', () => {
  const march = { start: d('2026-03-01'), end: new Date('2026-03-31T23:59:59.999Z') }

  it('excludes tax and shipping from net sales', () => {
    const summary = ecommerceSummary([order()], march)
    expect(summary.netSales).toBe(200)
    expect(summary.totalTax).toBe(26)
    expect(summary.totalShipping).toBe(15)
    // The order total is bigger than net sales, and is reported separately.
    expect(summary.netSales).toBeLessThan(241)
  })

  it('deducts refunds from net sales', () => {
    const summary = ecommerceSummary([order({ totalRefunded: 50, netSalesAmount: 150 })], march)
    expect(summary.netSales).toBe(150)
    expect(summary.totalRefunds).toBe(50)
    expect(summary.refundedOrderCount).toBe(1)
  })

  it('excludes cancelled orders entirely', () => {
    const orders = [
      order({ id: 'live', netSalesAmount: 200 }),
      order({ id: 'cancelled', cancelledAt: new Date('2026-03-11T00:00:00.000Z'), netSalesAmount: 999 }),
    ]
    const summary = ecommerceSummary(orders, march)
    expect(summary.netSales).toBe(200)
    expect(summary.orderCount).toBe(1)
    expect(summary.cancelledOrderCount).toBe(1)
  })

  it('reports average order value as unavailable rather than zero', () => {
    expect(ecommerceSummary([], march).averageOrderValue).toBeNull()
    expect(ecommerceSummary([order({ netSalesAmount: 300 })], march).averageOrderValue).toBe(300)
  })

  it('ranks best sellers by net sales', () => {
    const orders = [
      order({
        id: 'o1',
        lines: [
          { sku: 'A', title: 'Panel', quantity: 1, amount: 500, productSourceId: 'p-a' },
          { sku: 'B', title: 'Bulb', quantity: 10, amount: 100, productSourceId: 'p-b' },
        ],
      }),
    ]
    const top = bestSellers(orders, march, 5)
    expect(top[0]?.title).toBe('Panel')
    expect(top[0]?.netSales).toBe(500)
    expect(top[1]?.unitsSold).toBe(10)
  })
})
