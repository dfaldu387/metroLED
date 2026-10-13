import { buildBuckets, inRange, type Bucket, type DateRange } from '@shared/dates'
import type { BreakdownRow, Granularity, InvoiceRecord, TimeSeriesPoint } from '@shared/types'

/**
 * Revenue analytics.
 *
 * Revenue basis (see `metrics/definitions.ts` > `revenue`):
 *   SUM(invoice subtotal excluding tax) for invoices dated in the period,
 *   excluding draft, voided and written-off invoices.
 *
 * Every function here is pure: the same records always produce the same
 * figures, which is what makes the financial calculations testable.
 */

/** Invoice statuses that count toward revenue. */
const REVENUE_STATUSES = new Set(['OPEN', 'PARTIALLY_PAID', 'PAID'])

export function countsAsRevenue(invoice: InvoiceRecord): boolean {
  return REVENUE_STATUSES.has(invoice.status)
}

export function revenueInvoices(invoices: InvoiceRecord[], range?: DateRange): InvoiceRecord[] {
  return invoices.filter((i) => countsAsRevenue(i) && (!range || inRange(i.issuedOn, range)))
}

export function sumRevenue(invoices: InvoiceRecord[], range?: DateRange): number {
  return round2(revenueInvoices(invoices, range).reduce((acc, i) => acc + i.revenueAmount, 0))
}

export function countRevenueInvoices(invoices: InvoiceRecord[], range?: DateRange): number {
  return revenueInvoices(invoices, range).length
}

/**
 * Revenue per time bucket, with an optional comparison period overlaid onto the
 * same bucket index so the chart can draw both lines.
 */
export function revenueTrend(
  invoices: InvoiceRecord[],
  range: DateRange,
  granularity: Granularity,
  comparison?: DateRange,
): TimeSeriesPoint[] {
  const buckets = buildBuckets(range, granularity)
  const current = bucketSum(invoices, buckets)

  let comparisonValues: number[] | null = null
  if (comparison) {
    const comparisonBuckets = buildBuckets(comparison, granularity)
    const values = bucketSum(invoices, comparisonBuckets)
    // Align by index so period-over-period lines sit on top of each other even
    // when the two periods have a different number of calendar days.
    comparisonValues = buckets.map((_, i) => values[i] ?? 0)
  }

  return buckets.map((bucket, i) => ({
    date: bucket.key,
    label: bucket.label,
    value: current[i] ?? 0,
    comparisonValue: comparisonValues ? (comparisonValues[i] ?? 0) : null,
  }))
}

function bucketSum(invoices: InvoiceRecord[], buckets: Bucket[]): number[] {
  const totals = new Array(buckets.length).fill(0) as number[]
  const eligible = invoices.filter(countsAsRevenue)
  for (const invoice of eligible) {
    const idx = findBucketIndex(buckets, invoice.issuedOn)
    if (idx >= 0) totals[idx] = (totals[idx] ?? 0) + invoice.revenueAmount
  }
  return totals.map(round2)
}

function findBucketIndex(buckets: Bucket[], date: Date): number {
  // Buckets are contiguous and ordered, so a linear scan with an early exit is
  // cheaper than a binary search at these volumes and easier to verify.
  for (let i = 0; i < buckets.length; i++) {
    const b = buckets[i]!
    if (date >= b.start && date <= b.end) return i
  }
  return -1
}

/** Revenue per bucket, split into one series per division. */
export function revenueTrendByDivision(
  invoices: InvoiceRecord[],
  range: DateRange,
  granularity: Granularity,
  divisions: { id: string; code: string; name: string }[],
): TimeSeriesPoint[] {
  const buckets = buildBuckets(range, granularity)
  const eligible = invoices.filter(countsAsRevenue)

  return buckets.map((bucket) => {
    const point: TimeSeriesPoint = { date: bucket.key, label: bucket.label, value: 0 }
    let total = 0
    for (const division of divisions) {
      const sum = eligible
        .filter((i) => i.divisionId === division.id && i.issuedOn >= bucket.start && i.issuedOn <= bucket.end)
        .reduce((acc, i) => acc + i.revenueAmount, 0)
      point[division.code] = round2(sum)
      total += sum
    }
    const unassigned = eligible
      .filter((i) => !i.divisionId && i.issuedOn >= bucket.start && i.issuedOn <= bucket.end)
      .reduce((acc, i) => acc + i.revenueAmount, 0)
    if (unassigned > 0) {
      point.UNASSIGNED = round2(unassigned)
      total += unassigned
    }
    point.value = round2(total)
    return point
  })
}

interface BreakdownOptions {
  range: DateRange
  comparison?: DateRange
  limit?: number
  /** Group everything beyond `limit` into a single "Other" row. */
  groupRemainder?: boolean
}

function buildBreakdown(
  invoices: InvoiceRecord[],
  keyOf: (i: InvoiceRecord) => { key: string; label: string; divisionCode?: string | null } | null,
  options: BreakdownOptions,
): BreakdownRow[] {
  const current = new Map<string, { label: string; value: number; divisionCode?: string | null }>()
  for (const invoice of revenueInvoices(invoices, options.range)) {
    const bucket = keyOf(invoice)
    if (!bucket) continue
    const existing = current.get(bucket.key)
    if (existing) existing.value += invoice.revenueAmount
    else
      current.set(bucket.key, {
        label: bucket.label,
        value: invoice.revenueAmount,
        divisionCode: bucket.divisionCode ?? null,
      })
  }

  const previous = new Map<string, number>()
  if (options.comparison) {
    for (const invoice of revenueInvoices(invoices, options.comparison)) {
      const bucket = keyOf(invoice)
      if (!bucket) continue
      previous.set(bucket.key, (previous.get(bucket.key) ?? 0) + invoice.revenueAmount)
    }
  }

  const total = [...current.values()].reduce((acc, r) => acc + r.value, 0)

  let rows: BreakdownRow[] = [...current.entries()]
    .map(([key, { label, value, divisionCode }]) => {
      const prev = previous.has(key) ? round2(previous.get(key)!) : null
      return {
        key,
        label,
        divisionCode: divisionCode ?? null,
        value: round2(value),
        share: total > 0 ? round2((value / total) * 100) : 0,
        previousValue: prev,
        deltaPercent: percentChange(value, prev),
      }
    })
    .sort((a, b) => b.value - a.value)

  if (options.limit && rows.length > options.limit) {
    const head = rows.slice(0, options.limit)
    if (options.groupRemainder) {
      const tail = rows.slice(options.limit)
      const otherValue = tail.reduce((acc, r) => acc + r.value, 0)
      const otherPrevious = tail.reduce((acc, r) => acc + (r.previousValue ?? 0), 0)
      head.push({
        key: '__other__',
        label: `Other (${tail.length})`,
        value: round2(otherValue),
        share: total > 0 ? round2((otherValue / total) * 100) : 0,
        previousValue: otherPrevious > 0 ? round2(otherPrevious) : null,
        deltaPercent: percentChange(otherValue, otherPrevious > 0 ? otherPrevious : null),
      })
    }
    rows = head
  }

  return rows
}

export function revenueByDivision(
  invoices: InvoiceRecord[],
  options: BreakdownOptions,
): BreakdownRow[] {
  return buildBreakdown(
    invoices,
    (i) => ({
      key: i.divisionId ?? '__unassigned__',
      label: i.divisionName ?? 'Unassigned',
      divisionCode: i.divisionCode,
    }),
    options,
  )
}

export function revenueByCustomer(invoices: InvoiceRecord[], options: BreakdownOptions): BreakdownRow[] {
  return buildBreakdown(
    invoices,
    (i) => ({
      key: i.customerId ?? '__unknown__',
      label: i.customerName ?? 'Unknown customer',
    }),
    { limit: 10, groupRemainder: true, ...options },
  )
}

export function revenueBySalesRep(invoices: InvoiceRecord[], options: BreakdownOptions): BreakdownRow[] {
  return buildBreakdown(
    invoices,
    (i) => ({
      key: i.salesRepId ?? '__unassigned__',
      label: i.salesRepName ?? 'No representative recorded',
    }),
    options,
  )
}

/** Distributor versus direct revenue (section 6). */
export function revenueByClassification(invoices: InvoiceRecord[], options: BreakdownOptions): BreakdownRow[] {
  const labels: Record<string, string> = {
    DIRECT: 'Direct',
    DISTRIBUTOR: 'Distributor',
    UNCLASSIFIED: 'Not classified',
  }
  return buildBreakdown(
    invoices,
    (i) => ({
      key: i.customerClassification,
      label: labels[i.customerClassification] ?? i.customerClassification,
    }),
    options,
  )
}

export function percentChange(current: number, previous: number | null | undefined): number | null {
  if (previous === null || previous === undefined) return null
  if (previous === 0) return null // An increase from zero has no meaningful percentage.
  return round2(((current - previous) / Math.abs(previous)) * 100)
}

export function round2(value: number): number {
  // Avoids the floating-point tail that appears when summing cents.
  return Math.round((value + Number.EPSILON) * 100) / 100
}
