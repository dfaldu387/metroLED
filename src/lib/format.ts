import type { MetricValue } from './types'

/**
 * Presentation formatting.
 *
 * Currency is formatted consistently everywhere: one currency (the company
 * base currency), no decimals on dashboard figures, decimals on invoice-level
 * amounts where the cent matters.
 */

export const BASE_CURRENCY = 'CAD'

export function formatCurrency(
  value: number | null | undefined,
  options: { currency?: string; decimals?: boolean; compact?: boolean } = {},
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  const currency = options.currency ?? BASE_CURRENCY
  const decimals = options.decimals ?? false

  if (options.compact && Math.abs(value) >= 1000) {
    return new Intl.NumberFormat('en-CA', {
      style: 'currency',
      currency,
      notation: 'compact',
      maximumFractionDigits: 1,
      currencyDisplay: 'narrowSymbol',
    }).format(value)
  }

  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency,
    minimumFractionDigits: decimals ? 2 : 0,
    maximumFractionDigits: decimals ? 2 : 0,
    currencyDisplay: 'narrowSymbol',
  }).format(value)
}

export function formatPercent(value: number | null | undefined, decimals = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return `${value.toFixed(decimals)}%`
}

export function formatNumber(value: number | null | undefined, decimals = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return new Intl.NumberFormat('en-CA', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value)
}

export function formatInteger(value: number | null | undefined): string {
  return formatNumber(value, 0)
}

/** Formats a metric according to its declared format. */
export function formatMetricValue(metric: MetricValue): string {
  if (metric.availability === 'restricted') return 'Not available to your role'
  if (metric.value === null) return '—'
  switch (metric.format) {
    case 'currency':
      return formatCurrency(metric.value)
    case 'percent':
      return formatPercent(metric.value)
    case 'integer':
      return formatInteger(metric.value)
    default:
      return formatNumber(metric.value)
  }
}

/** A signed, human-readable change, e.g. "+12.4%" or "–18.0%". */
export function formatDeltaPercent(value: number | null | undefined): string | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null
  const sign = value > 0 ? '+' : value < 0 ? '−' : ''
  return `${sign}${Math.abs(value).toFixed(1)}%`
}

export function formatDate(date: Date | string | null | undefined): string {
  if (!date) return '—'
  const d = typeof date === 'string' ? new Date(date) : date
  if (Number.isNaN(d.getTime())) return '—'
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(d)
}

export function formatDateTime(date: Date | string | null | undefined, timeZone = 'America/New_York'): string {
  if (!date) return '—'
  const d = typeof date === 'string' ? new Date(date) : date
  if (Number.isNaN(d.getTime())) return '—'
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
    timeZone,
  }).format(d)
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '—'
  if (ms < 1000) return `${Math.round(ms)} ms`
  const seconds = ms / 1000
  if (seconds < 60) return `${seconds.toFixed(1)}s`
  const minutes = Math.floor(seconds / 60)
  const rest = Math.round(seconds % 60)
  return `${minutes}m ${rest}s`
}

/** Title-cases an ENUM_LIKE_VALUE for display. */
export function humanizeEnum(value: string): string {
  return value
    .toLowerCase()
    .split('_')
    .map((w) => (w.length > 0 ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(' ')
}

export function pluralize(count: number, singular: string, plural?: string): string {
  return count === 1 ? singular : (plural ?? `${singular}s`)
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase()
}

export function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, Math.max(0, max - 1))}…`
}
