import { buildBuckets, inRange, type DateRange } from '../dates'
import { round2 } from './revenue'
import type { BreakdownRow, Granularity, OrderRecord, TimeSeriesPoint } from '../types'

/**
 * Eco LED Mart (Shopify) analytics.
 *
 * These are OPERATIONAL store figures, not accounting revenue. They will not
 * equal the QuickBooks revenue for the same period and the two are never
 * added together. Every screen that shows a Shopify figure says which basis
 * it is on.
 *
 * Net sales basis: order subtotal after discounts, less refunds. Tax and
 * shipping are excluded. Cancelled orders are excluded entirely.
 *
 * The system never creates, updates or cancels a Shopify order (section 9).
 */

export function billableOrders(orders: OrderRecord[], range?: DateRange): OrderRecord[] {
  return orders.filter((o) => !o.cancelledAt && (!range || inRange(o.placedAt, range)))
}

export interface EcommerceSummary {
  netSales: number
  grossSubtotal: number
  totalDiscounts: number
  totalRefunds: number
  totalTax: number
  totalShipping: number
  orderCount: number
  /** null when there are no orders - an average of nothing is not zero. */
  averageOrderValue: number | null
  unitsSold: number
  cancelledOrderCount: number
  refundedOrderCount: number
}

export function ecommerceSummary(orders: OrderRecord[], range: DateRange): EcommerceSummary {
  const inPeriod = orders.filter((o) => inRange(o.placedAt, range))
  const billable = inPeriod.filter((o) => !o.cancelledAt)

  const netSales = billable.reduce((acc, o) => acc + o.netSalesAmount, 0)
  const unitsSold = billable.reduce(
    (acc, o) => acc + o.lines.reduce((lineAcc, l) => lineAcc + l.quantity, 0),
    0,
  )

  return {
    netSales: round2(netSales),
    grossSubtotal: round2(billable.reduce((acc, o) => acc + o.subtotalPrice, 0)),
    totalDiscounts: round2(billable.reduce((acc, o) => acc + o.totalDiscounts, 0)),
    totalRefunds: round2(billable.reduce((acc, o) => acc + o.totalRefunded, 0)),
    totalTax: round2(billable.reduce((acc, o) => acc + o.totalTax, 0)),
    totalShipping: round2(billable.reduce((acc, o) => acc + o.totalShipping, 0)),
    orderCount: billable.length,
    averageOrderValue: billable.length > 0 ? round2(netSales / billable.length) : null,
    unitsSold,
    cancelledOrderCount: inPeriod.length - billable.length,
    refundedOrderCount: billable.filter((o) => o.totalRefunded > 0).length,
  }
}

export function ecommerceTrend(
  orders: OrderRecord[],
  range: DateRange,
  granularity: Granularity,
  comparison?: DateRange,
): TimeSeriesPoint[] {
  const buckets = buildBuckets(range, granularity)
  const billable = billableOrders(orders)

  const sums = buckets.map((bucket) =>
    round2(
      billable
        .filter((o) => o.placedAt >= bucket.start && o.placedAt <= bucket.end)
        .reduce((acc, o) => acc + o.netSalesAmount, 0),
    ),
  )
  const counts = buckets.map(
    (bucket) => billable.filter((o) => o.placedAt >= bucket.start && o.placedAt <= bucket.end).length,
  )

  let comparisonValues: number[] | null = null
  if (comparison) {
    const comparisonBuckets = buildBuckets(comparison, granularity)
    const values = comparisonBuckets.map((bucket) =>
      round2(
        billable
          .filter((o) => o.placedAt >= bucket.start && o.placedAt <= bucket.end)
          .reduce((acc, o) => acc + o.netSalesAmount, 0),
      ),
    )
    comparisonValues = buckets.map((_, i) => values[i] ?? 0)
  }

  return buckets.map((bucket, i) => ({
    date: bucket.key,
    label: bucket.label,
    value: sums[i] ?? 0,
    orders: counts[i] ?? 0,
    comparisonValue: comparisonValues ? (comparisonValues[i] ?? 0) : null,
  }))
}

const FINANCIAL_STATUS_LABELS: Record<string, string> = {
  PENDING: 'Payment pending',
  AUTHORIZED: 'Authorised',
  PARTIALLY_PAID: 'Partially paid',
  PAID: 'Paid',
  PARTIALLY_REFUNDED: 'Partially refunded',
  REFUNDED: 'Refunded',
  VOIDED: 'Voided',
  UNKNOWN: 'Not recorded',
}

const FULFILLMENT_STATUS_LABELS: Record<string, string> = {
  UNFULFILLED: 'Unfulfilled',
  PARTIAL: 'Partially fulfilled',
  FULFILLED: 'Fulfilled',
  RESTOCKED: 'Restocked',
  UNKNOWN: 'Not recorded',
}

export function ordersByFinancialStatus(orders: OrderRecord[], range: DateRange): BreakdownRow[] {
  return statusBreakdown(orders, range, (o) => o.financialStatus, FINANCIAL_STATUS_LABELS)
}

export function ordersByFulfillmentStatus(orders: OrderRecord[], range: DateRange): BreakdownRow[] {
  return statusBreakdown(orders, range, (o) => o.fulfillmentStatus, FULFILLMENT_STATUS_LABELS)
}

function statusBreakdown(
  orders: OrderRecord[],
  range: DateRange,
  keyOf: (o: OrderRecord) => string,
  labels: Record<string, string>,
): BreakdownRow[] {
  const billable = billableOrders(orders, range)
  const totals = new Map<string, { amount: number; count: number }>()

  for (const order of billable) {
    const key = keyOf(order)
    const entry = totals.get(key) ?? { amount: 0, count: 0 }
    entry.amount += order.netSalesAmount
    entry.count++
    totals.set(key, entry)
  }

  const grandCount = billable.length

  return [...totals.entries()]
    .map(([key, t]) => ({
      key,
      label: labels[key] ?? key,
      value: t.count,
      share: grandCount > 0 ? round2((t.count / grandCount) * 100) : 0,
      secondaryValue: round2(t.amount),
      secondaryLabel: 'Net sales',
    }))
    .sort((a, b) => b.value - a.value)
}

export interface BestSeller {
  key: string
  title: string
  sku: string | null
  unitsSold: number
  netSales: number
}

/**
 * Best-selling products, by net sales.
 * Returns an empty array when order lines were not imported, so the page can
 * show an honest "not available" state instead of a misleading empty chart.
 */
export function bestSellers(orders: OrderRecord[], range: DateRange, limit = 10): BestSeller[] {
  const billable = billableOrders(orders, range)
  const totals = new Map<string, BestSeller>()

  for (const order of billable) {
    for (const line of order.lines) {
      const key = line.productSourceId ?? line.sku ?? line.title
      const entry = totals.get(key) ?? {
        key,
        title: line.title,
        sku: line.sku,
        unitsSold: 0,
        netSales: 0,
      }
      entry.unitsSold += line.quantity
      entry.netSales += line.amount
      totals.set(key, entry)
    }
  }

  return [...totals.values()]
    .map((row) => ({ ...row, netSales: round2(row.netSales) }))
    .sort((a, b) => b.netSales - a.netSales)
    .slice(0, limit)
}

export function recentOrders(orders: OrderRecord[], limit = 10): OrderRecord[] {
  return [...orders].sort((a, b) => b.placedAt.getTime() - a.placedAt.getTime()).slice(0, limit)
}

export function hasOrderLines(orders: OrderRecord[]): boolean {
  return orders.some((o) => o.lines.length > 0)
}
