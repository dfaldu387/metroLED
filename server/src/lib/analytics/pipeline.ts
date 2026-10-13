import { daysBetween, inRange, type DateRange } from '@shared/dates'
import { round2 } from './revenue'
import type { BreakdownRow, QuoteRecord } from '@shared/types'

/**
 * Sales pipeline analytics from Method CRM.
 *
 * Deliberately NOT implemented (section 8): probability-weighted pipeline.
 * Method CRM supplies no probability per stage and no weighting formula has
 * been approved, so no weighted figure is calculated or displayed. Inventing
 * one would make the pipeline look more precise than the data supports.
 */

export function openQuotes(quotes: QuoteRecord[]): QuoteRecord[] {
  return quotes.filter((q) => q.status === 'OPEN')
}

/**
 * Days since anything happened on a quote. Falls back to the quote date when
 * the CRM records no activity, which is the conservative reading - a quote
 * with no activity has been idle since it was raised.
 */
export function daysSinceActivity(quote: QuoteRecord, asOf: Date): number {
  const reference = quote.lastActivityAt ?? quote.issuedOn
  return Math.max(0, daysBetween(reference, asOf))
}

export function isStale(quote: QuoteRecord, asOf: Date, thresholdDays: number): boolean {
  return quote.status === 'OPEN' && daysSinceActivity(quote, asOf) >= thresholdDays
}

export interface PipelineSummary {
  openValue: number
  openCount: number
  averageQuoteValue: number | null
  staleValue: number
  staleCount: number
  largeOpenValue: number
  largeOpenCount: number
  /** Open quotes that are both large and stale - the ones worth chasing first. */
  largeStaleCount: number
  oldestOpenDays: number | null
}

export function pipelineSummary(
  quotes: QuoteRecord[],
  asOf: Date,
  options: { staleThresholdDays: number; largeQuoteAmount: number },
): PipelineSummary {
  const open = openQuotes(quotes)
  const openValue = open.reduce((acc, q) => acc + q.amount, 0)

  const stale = open.filter((q) => isStale(q, asOf, options.staleThresholdDays))
  const large = open.filter((q) => q.amount >= options.largeQuoteAmount)
  const largeStale = stale.filter((q) => q.amount >= options.largeQuoteAmount)

  const oldest = open.reduce<number | null>((acc, q) => {
    const age = daysBetween(q.issuedOn, asOf)
    return acc === null || age > acc ? age : acc
  }, null)

  return {
    openValue: round2(openValue),
    openCount: open.length,
    averageQuoteValue: open.length > 0 ? round2(openValue / open.length) : null,
    staleValue: round2(stale.reduce((acc, q) => acc + q.amount, 0)),
    staleCount: stale.length,
    largeOpenValue: round2(large.reduce((acc, q) => acc + q.amount, 0)),
    largeOpenCount: large.length,
    largeStaleCount: largeStale.length,
    oldestOpenDays: oldest,
  }
}

export function quotesByStage(quotes: QuoteRecord[]): BreakdownRow[] {
  const open = openQuotes(quotes)
  const totals = new Map<string, { label: string; amount: number; count: number }>()

  for (const quote of open) {
    const key = quote.stageNormalized || 'unknown'
    const entry = totals.get(key) ?? { label: quote.stage || 'Not recorded', amount: 0, count: 0 }
    entry.amount += quote.amount
    entry.count++
    totals.set(key, entry)
  }

  const grand = [...totals.values()].reduce((acc, t) => acc + t.amount, 0)

  return [...totals.entries()]
    .map(([key, t]) => ({
      key,
      label: t.label,
      value: round2(t.amount),
      share: grand > 0 ? round2((t.amount / grand) * 100) : 0,
      secondaryValue: t.count,
      secondaryLabel: 'Quotes',
    }))
    .sort((a, b) => b.value - a.value)
}

export function quotesBySalesRep(quotes: QuoteRecord[]): BreakdownRow[] {
  const open = openQuotes(quotes)
  const totals = new Map<string, { label: string; amount: number; count: number }>()

  for (const quote of open) {
    const key = quote.salesRepId ?? '__unassigned__'
    const entry = totals.get(key) ?? {
      label: quote.salesRepName ?? 'No representative recorded',
      amount: 0,
      count: 0,
    }
    entry.amount += quote.amount
    entry.count++
    totals.set(key, entry)
  }

  const grand = [...totals.values()].reduce((acc, t) => acc + t.amount, 0)

  return [...totals.entries()]
    .map(([key, t]) => ({
      key,
      label: t.label,
      value: round2(t.amount),
      share: grand > 0 ? round2((t.amount / grand) * 100) : 0,
      secondaryValue: t.count,
      secondaryLabel: 'Quotes',
    }))
    .sort((a, b) => b.value - a.value)
}

export function quotesByDivision(quotes: QuoteRecord[]): BreakdownRow[] {
  const open = openQuotes(quotes)
  const totals = new Map<string, { label: string; amount: number; count: number; code: string | null }>()

  for (const quote of open) {
    const key = quote.divisionId ?? '__unassigned__'
    const entry = totals.get(key) ?? {
      label: quote.divisionName ?? 'Unassigned',
      amount: 0,
      count: 0,
      code: quote.divisionCode,
    }
    entry.amount += quote.amount
    entry.count++
    totals.set(key, entry)
  }

  const grand = [...totals.values()].reduce((acc, t) => acc + t.amount, 0)

  return [...totals.entries()]
    .map(([key, t]) => ({
      key,
      label: t.label,
      divisionCode: t.code,
      value: round2(t.amount),
      share: grand > 0 ? round2((t.amount / grand) * 100) : 0,
      secondaryValue: t.count,
      secondaryLabel: 'Quotes',
    }))
    .sort((a, b) => b.value - a.value)
}

export const QUOTE_AGE_BUCKETS = [
  { key: '0_7', label: '0–7 days', min: 0, max: 7 },
  { key: '8_21', label: '8–21 days', min: 8, max: 21 },
  { key: '22_45', label: '22–45 days', min: 22, max: 45 },
  { key: '46_90', label: '46–90 days', min: 46, max: 90 },
  { key: 'over_90', label: 'More than 90 days', min: 91, max: null as number | null },
] as const

/** Open pipeline grouped by how long each quote has been idle. */
export function quoteAgingBuckets(quotes: QuoteRecord[], asOf: Date): BreakdownRow[] {
  const open = openQuotes(quotes)
  const totals = new Map<string, { amount: number; count: number }>()

  for (const quote of open) {
    const days = daysSinceActivity(quote, asOf)
    const bucket =
      QUOTE_AGE_BUCKETS.find((b) => days >= b.min && (b.max === null || days <= b.max)) ??
      QUOTE_AGE_BUCKETS[QUOTE_AGE_BUCKETS.length - 1]!
    const entry = totals.get(bucket.key) ?? { amount: 0, count: 0 }
    entry.amount += quote.amount
    entry.count++
    totals.set(bucket.key, entry)
  }

  const grand = [...totals.values()].reduce((acc, t) => acc + t.amount, 0)

  return QUOTE_AGE_BUCKETS.map((bucket) => {
    const t = totals.get(bucket.key) ?? { amount: 0, count: 0 }
    return {
      key: bucket.key,
      label: bucket.label,
      value: round2(t.amount),
      share: grand > 0 ? round2((t.amount / grand) * 100) : 0,
      secondaryValue: t.count,
      secondaryLabel: 'Quotes',
    }
  })
}

/** Stale quotes, largest first - the order a sales manager would want. */
export function staleQuotes(
  quotes: QuoteRecord[],
  asOf: Date,
  thresholdDays: number,
  limit?: number,
): (QuoteRecord & { daysIdle: number })[] {
  const rows = openQuotes(quotes)
    .map((q) => ({ ...q, daysIdle: daysSinceActivity(q, asOf) }))
    .filter((q) => q.daysIdle >= thresholdDays)
    .sort((a, b) => b.amount - a.amount || b.daysIdle - a.daysIdle)
  return limit ? rows.slice(0, limit) : rows
}

export interface WinRateResult {
  /** null when no quote was decided in the period - not 0%. */
  winRatePercent: number | null
  wonCount: number
  lostCount: number
  decidedCount: number
  wonValue: number
  lostValue: number
}

/**
 * Win rate by number of decided quotes (section 15).
 * Open, expired and cancelled quotes are excluded: none of them represents a
 * decision by the customer.
 */
export function winRate(quotes: QuoteRecord[], range: DateRange): WinRateResult {
  const decided = quotes.filter(
    (q) => (q.status === 'WON' || q.status === 'LOST') && q.closedOn && inRange(q.closedOn, range),
  )
  const won = decided.filter((q) => q.status === 'WON')
  const lost = decided.filter((q) => q.status === 'LOST')

  return {
    winRatePercent: decided.length > 0 ? round2((won.length / decided.length) * 100) : null,
    wonCount: won.length,
    lostCount: lost.length,
    decidedCount: decided.length,
    wonValue: round2(won.reduce((acc, q) => acc + q.amount, 0)),
    lostValue: round2(lost.reduce((acc, q) => acc + q.amount, 0)),
  }
}
