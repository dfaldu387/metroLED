import * as React from 'react'
import Link from 'next/link'
import {
  AlertTriangle,
  CheckCircle2,
  CircleAlert,
  Clock,
  Inbox,
  Info,
  Lock,
  RefreshCw,
  XCircle,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from './button'

/**
 * Page states.
 *
 * Section 3 requires loading, empty, success, error and stale-data states on
 * every relevant page. They live here so each one looks and reads the same
 * wherever it appears, and every error says what happened AND what to do next.
 */

type AlertTone = 'info' | 'positive' | 'warning' | 'negative'

const toneStyles: Record<AlertTone, { wrap: string; icon: string; Icon: typeof Info }> = {
  info: { wrap: 'border-brand-200 bg-brand-50', icon: 'text-brand-600', Icon: Info },
  positive: { wrap: 'border-positive-200 bg-positive-50', icon: 'text-positive-700', Icon: CheckCircle2 },
  warning: { wrap: 'border-warning-200 bg-warning-50', icon: 'text-warning-700', Icon: AlertTriangle },
  negative: { wrap: 'border-negative-200 bg-negative-50', icon: 'text-negative-700', Icon: CircleAlert },
}

export function Alert({
  tone = 'info',
  title,
  children,
  action,
  className,
}: {
  tone?: AlertTone
  title: string
  children?: React.ReactNode
  action?: React.ReactNode
  className?: string
}) {
  const { wrap, icon, Icon } = toneStyles[tone]
  return (
    <div
      role={tone === 'negative' ? 'alert' : 'status'}
      className={cn('flex flex-col gap-3 rounded-xl border px-4 py-3 sm:flex-row sm:items-start', wrap, className)}
    >
      <Icon className={cn('mt-0.5 size-[18px] shrink-0', icon)} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] font-semibold text-ink-900">{title}</p>
        {children ? <div className="mt-1 text-[13px] leading-5 text-ink-700">{children}</div> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  )
}

/**
 * Empty state. Always explains why the area is empty and what would fill it,
 * rather than showing a bare "No data".
 */
export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  className,
}: {
  icon?: typeof Inbox
  title: string
  description: string
  action?: { label: string; href: string } | React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-12 text-center', className)}>
      <div className="mb-3 flex size-11 items-center justify-center rounded-full bg-ink-100">
        <Icon className="size-5 text-ink-500" aria-hidden />
      </div>
      <p className="text-[14px] font-semibold text-ink-900">{title}</p>
      <p className="mt-1.5 max-w-md text-[13px] leading-5 text-ink-600">{description}</p>
      {action ? (
        <div className="mt-4">
          {isActionLink(action) ? (
            <Button asChild variant="secondary" size="sm">
              <Link href={action.href}>{action.label}</Link>
            </Button>
          ) : (
            action
          )}
        </div>
      ) : null}
    </div>
  )
}

function isActionLink(value: unknown): value is { label: string; href: string } {
  return typeof value === 'object' && value !== null && 'href' in value && 'label' in value
}

/** Error state for a section that failed to load. */
export function ErrorState({
  title = 'This section could not be loaded',
  description,
  retryHref,
  className,
}: {
  title?: string
  description: string
  retryHref?: string
  className?: string
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-10 text-center', className)}>
      <div className="mb-3 flex size-11 items-center justify-center rounded-full bg-negative-50">
        <XCircle className="size-5 text-negative-600" aria-hidden />
      </div>
      <p className="text-[14px] font-semibold text-ink-900">{title}</p>
      <p className="mt-1.5 max-w-md text-[13px] leading-5 text-ink-600">{description}</p>
      {retryHref ? (
        <Button asChild variant="secondary" size="sm" className="mt-4">
          <Link href={retryHref}>
            <RefreshCw aria-hidden />
            Try again
          </Link>
        </Button>
      ) : null}
    </div>
  )
}

/** Shown when the signed-in role may not see a figure or a whole section. */
export function RestrictedState({
  title = 'Not available to your role',
  description,
  className,
}: {
  title?: string
  description: string
  className?: string
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-10 text-center', className)}>
      <div className="mb-3 flex size-11 items-center justify-center rounded-full bg-ink-100">
        <Lock className="size-5 text-ink-500" aria-hidden />
      </div>
      <p className="text-[14px] font-semibold text-ink-900">{title}</p>
      <p className="mt-1.5 max-w-md text-[13px] leading-5 text-ink-600">{description}</p>
    </div>
  )
}

/**
 * Inline notice that a source has not synced recently.
 *
 * Each stale source is quoted with ITS OWN last successful sync. Quoting the
 * freshest overall timestamp would understate how old the affected figures
 * actually are, which is the opposite of what this notice is for.
 */
export function StaleDataNotice({
  sources,
  className,
}: {
  sources: { name: string; lastSuccessLabel: string }[]
  className?: string
}) {
  if (sources.length === 0) return null
  return (
    <div
      className={cn(
        'flex items-start gap-2 rounded-lg border border-warning-200 bg-warning-50 px-3 py-2 text-[12.5px] leading-5 text-warning-800',
        className,
      )}
      role="status"
    >
      <Clock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <span>
        <strong className="font-semibold">Figures may be out of date.</strong>{' '}
        {sources.length === 1 ? (
          <>
            {sources[0]!.name} last synced successfully {sources[0]!.lastSuccessLabel}. Anything it contributes
            may be incomplete.
          </>
        ) : (
          <>
            These sources have not synced recently:{' '}
            {sources.map((s) => `${s.name} (last success ${s.lastSuccessLabel})`).join(', ')}. Anything they
            contribute may be incomplete.
          </>
        )}
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton h-4 w-full', className)} aria-hidden />
}

export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn('space-y-2', className)} aria-hidden>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className={i === lines - 1 ? 'w-2/3' : 'w-full'} />
      ))}
    </div>
  )
}

export function KpiSkeleton() {
  return (
    <div className="surface p-4" aria-hidden>
      <Skeleton className="h-3.5 w-28" />
      <Skeleton className="mt-3 h-7 w-36" />
      <Skeleton className="mt-3 h-3 w-20" />
    </div>
  )
}

export function ChartSkeleton({ height = 260 }: { height?: number }) {
  return (
    <div className="flex items-end gap-2 px-1" style={{ height }} aria-hidden>
      {[48, 66, 40, 78, 58, 86, 52, 70, 62, 90, 74, 56].map((h, i) => (
        <div key={i} className="skeleton flex-1" style={{ height: `${h}%` }} />
      ))}
    </div>
  )
}

export function TableSkeleton({ rows = 6, columns = 5 }: { rows?: number; columns?: number }) {
  return (
    <div className="divide-y divide-ink-200" aria-hidden>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex items-center gap-4 px-4 py-3">
          {Array.from({ length: columns }).map((__, c) => (
            <Skeleton key={c} className={c === 0 ? 'h-4 w-32' : 'h-4 flex-1'} />
          ))}
        </div>
      ))}
    </div>
  )
}

/** Accessible live-region announcement for asynchronous results. */
export function LiveRegion({ message }: { message: string | null }) {
  return (
    <div aria-live="polite" aria-atomic="true" className="sr-only">
      {message ?? ''}
    </div>
  )
}
