import type { Granularity } from './types'

/**
 * Date-range handling.
 *
 * All reporting periods are calendar periods in the company timezone (US
 * Eastern by default, configurable in Settings). Invoice and quote dates are
 * stored as `date` columns, so they carry no time component and need no
 * timezone conversion; order timestamps do, and are converted here.
 */

export const DEFAULT_TIMEZONE = 'America/New_York'

export type RangePreset =
  | 'today'
  | 'yesterday'
  | 'last_7_days'
  | 'last_30_days'
  | 'this_month'
  | 'last_month'
  | 'this_quarter'
  | 'last_quarter'
  | 'this_year'
  | 'last_12_months'
  | 'custom'

export interface DateRange {
  start: Date
  end: Date
}

export interface ResolvedRange extends DateRange {
  preset: RangePreset
  label: string
  /** The immediately preceding period of equal length, for comparisons. */
  comparison: DateRange
  comparisonLabel: string
  /** Suggested bucket size for a trend chart over this range. */
  granularity: Granularity
}

export const RANGE_PRESET_LABELS: Record<Exclude<RangePreset, 'custom'>, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  last_7_days: 'Last 7 days',
  last_30_days: 'Last 30 days',
  this_month: 'This month',
  last_month: 'Last month',
  this_quarter: 'This quarter',
  last_quarter: 'Last quarter',
  this_year: 'This year',
  last_12_months: 'Last 12 months',
}

/** Parts of a timestamp as they appear in a given timezone. */
function zonedParts(date: Date, timeZone: string) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
  const out: Record<string, number> = {}
  for (const part of fmt.formatToParts(date)) {
    if (part.type !== 'literal') out[part.type] = Number(part.value)
  }
  return {
    year: out.year ?? 1970,
    month: out.month ?? 1,
    day: out.day ?? 1,
    hour: (out.hour ?? 0) % 24,
    minute: out.minute ?? 0,
    second: out.second ?? 0,
  }
}

/**
 * The calendar date "today" is in the given timezone, expressed as a UTC
 * midnight. Date-only columns are compared against these.
 */
export function startOfDayInZone(date: Date, timeZone = DEFAULT_TIMEZONE): Date {
  const p = zonedParts(date, timeZone)
  return new Date(Date.UTC(p.year, p.month - 1, p.day, 0, 0, 0, 0))
}

export function endOfDayInZone(date: Date, timeZone = DEFAULT_TIMEZONE): Date {
  const p = zonedParts(date, timeZone)
  return new Date(Date.UTC(p.year, p.month - 1, p.day, 23, 59, 59, 999))
}

export function addDays(date: Date, days: number): Date {
  const d = new Date(date.getTime())
  d.setUTCDate(d.getUTCDate() + days)
  return d
}

export function addMonths(date: Date, months: number): Date {
  const d = new Date(date.getTime())
  const targetMonth = d.getUTCMonth() + months
  const day = d.getUTCDate()
  d.setUTCDate(1)
  d.setUTCMonth(targetMonth)
  // Clamp to the last day of the target month (31 Jan + 1 month = 28/29 Feb).
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
  d.setUTCDate(Math.min(day, lastDay))
  return d
}

export function startOfMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 0, 0, 0, 0))
}

export function endOfMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0, 23, 59, 59, 999))
}

export function startOfWeek(date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  // Weeks start on Monday.
  const weekday = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - weekday)
  return d
}

export function startOfQuarter(date: Date): Date {
  const q = Math.floor(date.getUTCMonth() / 3)
  return new Date(Date.UTC(date.getUTCFullYear(), q * 3, 1, 0, 0, 0, 0))
}

export function endOfQuarter(date: Date): Date {
  const q = Math.floor(date.getUTCMonth() / 3)
  return new Date(Date.UTC(date.getUTCFullYear(), q * 3 + 3, 0, 23, 59, 59, 999))
}

export function daysBetween(a: Date, b: Date): number {
  const MS = 24 * 60 * 60 * 1000
  return Math.round((startOfUtcDay(b).getTime() - startOfUtcDay(a).getTime()) / MS)
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export function parseIsoDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const d = new Date(`${value}T00:00:00.000Z`)
  return Number.isNaN(d.getTime()) ? null : d
}

function pickGranularity(start: Date, end: Date): Granularity {
  const days = daysBetween(start, end) + 1
  if (days <= 31) return 'day'
  if (days <= 120) return 'week'
  return 'month'
}

function monthLabel(date: Date): string {
  return new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date)
}

function dayLabel(date: Date): string {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(date)
}

export function formatRangeLabel(range: DateRange): string {
  const sameYear = range.start.getUTCFullYear() === range.end.getUTCFullYear()
  const left = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: sameYear ? undefined : 'numeric',
    timeZone: 'UTC',
  }).format(range.start)
  const right = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(range.end)
  return left === right ? right : `${left} – ${right}`
}

/**
 * Resolves a preset (or an explicit custom range) into concrete boundaries
 * plus a like-for-like comparison period.
 */
export function resolveRange(
  preset: RangePreset,
  options: { now?: Date; timeZone?: string; start?: string | null; end?: string | null } = {},
): ResolvedRange {
  const timeZone = options.timeZone ?? DEFAULT_TIMEZONE
  const now = options.now ?? new Date()
  const today = startOfDayInZone(now, timeZone)

  let start: Date
  let end: Date
  let label: string
  let comparison: DateRange
  let comparisonLabel: string

  const previousOfEqualLength = (s: Date, e: Date): DateRange => {
    const lengthDays = daysBetween(s, e) + 1
    const prevEnd = addDays(s, -1)
    const prevStart = addDays(prevEnd, -(lengthDays - 1))
    return { start: prevStart, end: endOfUtcDay(prevEnd) }
  }

  switch (preset) {
    case 'today':
      start = today
      end = endOfUtcDay(today)
      label = 'Today'
      comparison = { start: addDays(today, -1), end: endOfUtcDay(addDays(today, -1)) }
      comparisonLabel = 'Yesterday'
      break

    case 'yesterday':
      start = addDays(today, -1)
      end = endOfUtcDay(start)
      label = 'Yesterday'
      comparison = { start: addDays(today, -2), end: endOfUtcDay(addDays(today, -2)) }
      comparisonLabel = 'The day before'
      break

    case 'last_7_days':
      start = addDays(today, -6)
      end = endOfUtcDay(today)
      label = 'Last 7 days'
      comparison = previousOfEqualLength(start, end)
      comparisonLabel = 'Previous 7 days'
      break

    case 'last_30_days':
      start = addDays(today, -29)
      end = endOfUtcDay(today)
      label = 'Last 30 days'
      comparison = previousOfEqualLength(start, end)
      comparisonLabel = 'Previous 30 days'
      break

    case 'this_month':
      start = startOfMonth(today)
      end = endOfUtcDay(today)
      label = `This month (${monthLabel(start)})`
      {
        const prevMonthStart = startOfMonth(addMonths(start, -1))
        comparison = { start: prevMonthStart, end: endOfMonth(prevMonthStart) }
        comparisonLabel = monthLabel(prevMonthStart)
      }
      break

    case 'last_month':
      start = startOfMonth(addMonths(today, -1))
      end = endOfMonth(start)
      label = monthLabel(start)
      {
        const prev = startOfMonth(addMonths(start, -1))
        comparison = { start: prev, end: endOfMonth(prev) }
        comparisonLabel = monthLabel(prev)
      }
      break

    case 'this_quarter':
      start = startOfQuarter(today)
      end = endOfUtcDay(today)
      label = `This quarter (Q${Math.floor(start.getUTCMonth() / 3) + 1} ${start.getUTCFullYear()})`
      {
        const prev = startOfQuarter(addMonths(start, -3))
        comparison = { start: prev, end: endOfQuarter(prev) }
        comparisonLabel = `Q${Math.floor(prev.getUTCMonth() / 3) + 1} ${prev.getUTCFullYear()}`
      }
      break

    case 'last_quarter':
      start = startOfQuarter(addMonths(startOfQuarter(today), -3))
      end = endOfQuarter(start)
      label = `Q${Math.floor(start.getUTCMonth() / 3) + 1} ${start.getUTCFullYear()}`
      {
        const prev = startOfQuarter(addMonths(start, -3))
        comparison = { start: prev, end: endOfQuarter(prev) }
        comparisonLabel = `Q${Math.floor(prev.getUTCMonth() / 3) + 1} ${prev.getUTCFullYear()}`
      }
      break

    case 'this_year':
      start = new Date(Date.UTC(today.getUTCFullYear(), 0, 1))
      end = endOfUtcDay(today)
      label = `This year (${today.getUTCFullYear()})`
      comparison = {
        start: new Date(Date.UTC(today.getUTCFullYear() - 1, 0, 1)),
        end: endOfUtcDay(addMonths(new Date(Date.UTC(today.getUTCFullYear() - 1, today.getUTCMonth(), today.getUTCDate())), 0)),
      }
      comparisonLabel = `${today.getUTCFullYear() - 1} to date`
      break

    case 'last_12_months':
      start = startOfMonth(addMonths(today, -11))
      end = endOfUtcDay(today)
      label = 'Last 12 months'
      comparison = { start: startOfMonth(addMonths(start, -12)), end: endOfMonth(addMonths(start, -1)) }
      comparisonLabel = 'Previous 12 months'
      break

    case 'custom': {
      const parsedStart = options.start ? parseIsoDate(options.start) : null
      const parsedEnd = options.end ? parseIsoDate(options.end) : null
      if (!parsedStart || !parsedEnd || parsedStart > parsedEnd) {
        // Invalid custom range falls back to the default rather than erroring,
        // so a bad bookmark still renders a usable page.
        return resolveRange('last_30_days', options)
      }
      start = parsedStart
      end = endOfUtcDay(parsedEnd)
      label = formatRangeLabel({ start, end })
      comparison = previousOfEqualLength(start, end)
      comparisonLabel = `Previous ${daysBetween(start, end) + 1} days`
      break
    }
  }

  return {
    preset,
    start,
    end,
    label,
    comparison,
    comparisonLabel,
    granularity: pickGranularity(start, end),
  }
}

function endOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999))
}

export interface Bucket {
  key: string
  start: Date
  end: Date
  label: string
}

/** Builds the (always complete) set of buckets a trend chart should render. */
export function buildBuckets(range: DateRange, granularity: Granularity): Bucket[] {
  const buckets: Bucket[] = []
  let cursor =
    granularity === 'month'
      ? startOfMonth(range.start)
      : granularity === 'week'
        ? startOfWeek(range.start)
        : startOfUtcDay(range.start)

  let guard = 0
  while (cursor <= range.end && guard++ < 1000) {
    let end: Date
    let label: string
    if (granularity === 'month') {
      end = endOfMonth(cursor)
      label = monthLabel(cursor)
    } else if (granularity === 'week') {
      end = endOfUtcDay(addDays(cursor, 6))
      label = dayLabel(cursor)
    } else {
      end = endOfUtcDay(cursor)
      label = dayLabel(cursor)
    }
    buckets.push({ key: toIsoDate(cursor), start: cursor, end, label })
    cursor =
      granularity === 'month'
        ? startOfMonth(addMonths(cursor, 1))
        : granularity === 'week'
          ? addDays(cursor, 7)
          : addDays(cursor, 1)
  }
  return buckets
}

export function inRange(date: Date, range: DateRange): boolean {
  return date >= range.start && date <= range.end
}

/** Minutes elapsed since a timestamp, or null if there is none. */
export function minutesSince(date: Date | null, now: Date = new Date()): number | null {
  if (!date) return null
  return Math.max(0, Math.floor((now.getTime() - date.getTime()) / 60000))
}

export function formatRelativeTime(date: Date | null, now: Date = new Date()): string {
  if (!date) return 'Never'
  const mins = minutesSince(date, now) ?? 0
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`
  const months = Math.floor(days / 30)
  return `${months} month${months === 1 ? '' : 's'} ago`
}

/**
 * The business date the daily brief reports on: yesterday in company time.
 * Monday's brief covers Friday, since Saturday and Sunday are not business days.
 */
export function previousBusinessDate(now: Date = new Date(), timeZone = DEFAULT_TIMEZONE): Date {
  let d = addDays(startOfDayInZone(now, timeZone), -1)
  // 0 = Sunday, 6 = Saturday
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) {
    d = addDays(d, -1)
  }
  return d
}

export function isBusinessDay(date: Date): boolean {
  const day = date.getUTCDay()
  return day !== 0 && day !== 6
}
