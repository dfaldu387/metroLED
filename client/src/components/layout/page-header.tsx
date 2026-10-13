import * as React from 'react'
import { AlertTriangle, FlaskConical } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { DataMode } from '@shared/types'
import { describeDataMode } from '@shared/data-mode'

/**
 * Page header.
 *
 * Every page states its purpose under the title, so no screen is unexplained,
 * and exposes exactly one primary action on the right.
 */
export function PageHeader({
  title,
  description,
  primaryAction,
  secondaryActions,
  meta,
  className,
}: {
  title: string
  description?: string
  primaryAction?: React.ReactNode
  secondaryActions?: React.ReactNode
  /** Small facts shown under the description, e.g. last refresh time. */
  meta?: React.ReactNode
  className?: string
}) {
  return (
    <header className={cn('mb-5', className)}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
        <div className="min-w-0">
          <h1 className="text-[21px] font-semibold leading-tight tracking-[-0.015em] text-ink-900 sm:text-[23px]">
            {title}
          </h1>
          {description ? (
            <p className="mt-1.5 max-w-2xl text-[13.5px] leading-5 text-ink-600">{description}</p>
          ) : null}
          {meta ? <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5">{meta}</div> : null}
        </div>
        {primaryAction || secondaryActions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2 print-hidden">
            {secondaryActions}
            {primaryAction}
          </div>
        ) : null}
      </div>
    </header>
  )
}

/**
 * The persistent data-mode banner.
 *
 * Non-negotiable requirement (section 3 / 22): demo figures are never
 * presented as live production data. This banner is rendered above every page
 * when the dataset is not live, and it cannot be dismissed.
 */
export function DataModeBanner({ mode, className }: { mode: DataMode; className?: string }) {
  const description = describeDataMode(mode)
  if (!description) return null

  const isDemo = mode === 'demo'
  const Icon = isDemo ? FlaskConical : AlertTriangle

  return (
    <div
      role="status"
      className={cn(
        'mb-5 flex items-start gap-3 rounded-xl border px-4 py-3',
        isDemo ? 'border-warning-300 bg-warning-50' : 'border-ink-300 bg-ink-100',
        className,
      )}
    >
      <Icon
        className={cn('mt-0.5 size-[18px] shrink-0', isDemo ? 'text-warning-700' : 'text-ink-600')}
        aria-hidden
      />
      <div className="min-w-0">
        <p className={cn('text-[13.5px] font-semibold', isDemo ? 'text-warning-900' : 'text-ink-900')}>
          {description.title}
        </p>
        <p className={cn('mt-0.5 text-[13px] leading-5', isDemo ? 'text-warning-800' : 'text-ink-700')}>
          {description.detail}
        </p>
      </div>
    </div>
  )
}

/** A small labelled fact for the header meta row. */
export function MetaFact({
  label,
  value,
  tone = 'default',
}: {
  label: string
  value: React.ReactNode
  tone?: 'default' | 'warning' | 'negative'
}) {
  const tones = {
    default: 'text-ink-700',
    warning: 'text-warning-800',
    negative: 'text-negative-700',
  }
  return (
    <p className="text-[12.5px] leading-5">
      <span className="text-ink-500">{label}:</span> <span className={cn('font-medium', tones[tone])}>{value}</span>
    </p>
  )
}

export function SectionHeading({
  title,
  description,
  action,
  className,
}: {
  title: string
  description?: string
  action?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('mb-3 flex flex-col gap-1.5 sm:flex-row sm:items-end sm:justify-between', className)}>
      <div>
        <h2 className="text-[15px] font-semibold text-ink-900">{title}</h2>
        {description ? <p className="mt-0.5 text-[13px] leading-5 text-ink-600">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  )
}
