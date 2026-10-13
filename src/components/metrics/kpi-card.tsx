import * as React from 'react'
import Link from 'next/link'
import { ArrowRight, Lock, Minus, TrendingDown, TrendingUp } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatDeltaPercent, formatMetricValue } from '@/lib/format'
import { metricTooltip } from '@/lib/metrics/definitions'
import { InfoTip } from '@/components/ui/tooltip'
import type { MetricValue } from '@/lib/types'

/**
 * KPI card (section 5).
 *
 * Every card carries all five required elements: the metric name, the
 * formatted value, a previous-period comparison when one exists, a trend
 * indicator when the change is meaningful, and a definition tooltip. The whole
 * card is clickable through to the page that explains the number.
 *
 * Structure note: the click-through is an absolutely positioned overlay link
 * rather than an anchor wrapped around the whole card. The card also contains
 * the definition tooltip, which is a button - and a button nested inside an
 * anchor is invalid HTML that browsers re-parent, which breaks both the
 * tooltip's hover behaviour and keyboard semantics. The overlay keeps the
 * whole card clickable while leaving the tooltip a real, separate control.
 *
 * Deliberate behaviours:
 *   - No comparison is shown when the previous period has no data. An
 *     "infinite % increase" from zero is not reported.
 *   - A restricted metric renders as a locked card with an explanation, rather
 *     than vanishing, so the user understands why a figure is missing.
 */

function trendTone(metric: MetricValue): 'positive' | 'negative' | 'neutral' {
  if (metric.deltaPercent === null || Math.abs(metric.deltaPercent) < 0.05) return 'neutral'
  const improving = metric.deltaPercent > 0 === metric.higherIsBetter
  return improving ? 'positive' : 'negative'
}

export function KpiCard({
  metric,
  comparisonLabel,
  className,
}: {
  metric: MetricValue
  /** e.g. "vs. previous 30 days". Omitted when there is no comparison. */
  comparisonLabel?: string
  className?: string
}) {
  const tone = trendTone(metric)
  const delta = formatDeltaPercent(metric.deltaPercent)
  const definition = metricTooltip(metric.key) || metric.definition

  const toneClasses = {
    positive: 'text-positive-700',
    negative: 'text-negative-700',
    neutral: 'text-ink-500',
  }
  const TrendIcon = tone === 'positive' ? TrendingUp : tone === 'negative' ? TrendingDown : Minus

  if (metric.availability === 'restricted') {
    return (
      <div className={cn('surface flex flex-col p-4', className)}>
        <div className="flex items-start justify-between gap-2">
          <p className="text-[13px] font-medium text-ink-600">{metric.label}</p>
          <Lock className="size-3.5 shrink-0 text-ink-400" aria-hidden />
        </div>
        <p className="mt-2.5 text-[15px] font-medium text-ink-500">Not available to your role</p>
        <p className="mt-auto pt-3 text-[12px] leading-4 text-ink-500">
          {metric.note ?? 'Ask an owner to review your permissions if you need this figure.'}
        </p>
      </div>
    )
  }

  const clickable = Boolean(metric.href) && metric.availability !== 'unavailable'

  return (
    <div
      className={cn(
        'surface group relative flex flex-col p-4',
        clickable && 'transition-colors focus-within:border-brand-300 hover:border-brand-300 hover:bg-brand-50/30',
        className,
      )}
    >
      {/*
        The label row reserves two lines whether or not the label wraps, so
        every figure in the KPI row sits on the same baseline. A dashboard
        where the numbers do not line up is harder to scan.
      */}
      <div className="flex min-h-[2.5rem] items-start justify-between gap-2">
        <p className="text-[13px] font-medium leading-5 text-ink-600">{metric.label}</p>

        {/* Sits above the overlay link so the tooltip stays independently
            hoverable, focusable and clickable. */}
        <div className="relative z-10 flex shrink-0 items-center gap-1">
          <InfoTip label={`About ${metric.label}`} content={definition} />
          {clickable ? (
            <ArrowRight
              className="size-3.5 text-ink-300 transition-colors group-hover:text-brand-600"
              aria-hidden
            />
          ) : null}
        </div>
      </div>

      <p
        className={cn(
          'tabular mt-2 text-[26px] font-semibold leading-none tracking-[-0.02em]',
          metric.availability === 'unavailable' ? 'text-ink-400' : 'text-ink-900',
        )}
      >
        {metric.availability === 'unavailable' ? 'Not available' : formatMetricValue(metric)}
      </p>

      <div className="mt-auto pt-3">
        {delta && comparisonLabel ? (
          <p className={cn('flex items-center gap-1.5 text-[12.5px] font-medium', toneClasses[tone])}>
            <TrendIcon className="size-3.5 shrink-0" aria-hidden />
            <span className="tabular">{delta}</span>
            <span className="font-normal text-ink-500">{comparisonLabel}</span>
          </p>
        ) : metric.note ? (
          <p className="text-[12px] leading-4 text-ink-500">{metric.note}</p>
        ) : (
          <p className="text-[12px] leading-4 text-ink-400">No comparison available</p>
        )}
      </div>

      {clickable && metric.href ? (
        <Link
          href={metric.href}
          className="absolute inset-0 rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
        >
          <span className="sr-only">View {metric.label} details</span>
        </Link>
      ) : null}
    </div>
  )
}

/** A compact figure for inside a card - label above, value below. */
export function Stat({
  label,
  value,
  tone = 'default',
  help,
  note,
  className,
}: {
  label: string
  value: React.ReactNode
  tone?: 'default' | 'positive' | 'negative' | 'warning' | 'muted'
  help?: string
  note?: string
  className?: string
}) {
  const tones = {
    default: 'text-ink-900',
    positive: 'text-positive-700',
    negative: 'text-negative-700',
    warning: 'text-warning-800',
    muted: 'text-ink-400',
  }
  return (
    <div className={cn('min-w-0', className)}>
      <div className="flex items-center gap-1">
        <p className="truncate text-[12.5px] font-medium text-ink-600">{label}</p>
        {help ? <InfoTip label={`About ${label}`} content={help} /> : null}
      </div>
      <p className={cn('tabular mt-1 text-[19px] font-semibold leading-tight', tones[tone])}>{value}</p>
      {note ? <p className="mt-0.5 text-[11.5px] leading-4 text-ink-500">{note}</p> : null}
    </div>
  )
}
