
import * as React from 'react'
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Data table primitives.
 *
 * Tables scroll horizontally on narrow screens rather than squashing columns,
 * and numeric columns are right-aligned with tabular figures so they line up.
 */

export function TableScroll({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={cn('w-full overflow-x-auto', className)}>
      <div className="min-w-full align-middle">{children}</div>
    </div>
  )
}

export function Table({ className, ...props }: React.TableHTMLAttributes<HTMLTableElement>) {
  return <table className={cn('w-full border-collapse text-sm', className)} {...props} />
}

export function THead({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn('bg-ink-50', className)} {...props} />
}

export function TBody({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn('divide-y divide-ink-200', className)} {...props} />
}

export function TR({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn('transition-colors', className)} {...props} />
}

export function TH({
  className,
  numeric,
  ...props
}: React.ThHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return (
    <th
      scope="col"
      className={cn(
        'whitespace-nowrap border-b border-ink-200 px-3 py-2.5 text-left text-[12px] font-semibold uppercase tracking-wide text-ink-600',
        numeric && 'text-right',
        className,
      )}
      {...props}
    />
  )
}

export function TD({
  className,
  numeric,
  ...props
}: React.TdHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return (
    <td
      className={cn('px-3 py-2.5 align-middle text-ink-800', numeric && 'tabular text-right', className)}
      {...props}
    />
  )
}

export type SortDirection = 'asc' | 'desc'

/**
 * A sortable column header. The current sort is announced to screen readers
 * through `aria-sort`, not just the arrow icon.
 */
export function SortableTH({
  label,
  columnKey,
  activeKey,
  direction,
  onSort,
  numeric,
  className,
  tooltip,
}: {
  label: string
  columnKey: string
  activeKey: string
  direction: SortDirection
  onSort: (key: string) => void
  numeric?: boolean
  className?: string
  tooltip?: string
}) {
  const isActive = activeKey === columnKey
  return (
    <TH
      numeric={numeric}
      className={cn('p-0', className)}
      aria-sort={isActive ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button
        type="button"
        onClick={() => onSort(columnKey)}
        title={tooltip}
        className={cn(
          'flex w-full items-center gap-1 px-3 py-2.5 text-[12px] font-semibold uppercase tracking-wide transition-colors hover:text-ink-900',
          numeric ? 'justify-end' : 'justify-start',
          isActive ? 'text-ink-900' : 'text-ink-600',
        )}
      >
        <span>{label}</span>
        {isActive ? (
          direction === 'asc' ? (
            <ArrowUp className="size-3.5" aria-hidden />
          ) : (
            <ArrowDown className="size-3.5" aria-hidden />
          )
        ) : (
          <ChevronsUpDown className="size-3.5 opacity-40" aria-hidden />
        )}
      </button>
    </TH>
  )
}

/** Generic in-memory sort used by the invoice and quote tables. */
export function sortRows<T>(
  rows: T[],
  key: string,
  direction: SortDirection,
  accessor: (row: T, key: string) => string | number | Date | null,
): T[] {
  const factor = direction === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    const av = accessor(a, key)
    const bv = accessor(b, key)
    // Nulls always sort last, whichever direction is active, so an empty cell
    // never masquerades as the smallest value.
    if (av === null && bv === null) return 0
    if (av === null) return 1
    if (bv === null) return -1
    if (av instanceof Date && bv instanceof Date) return (av.getTime() - bv.getTime()) * factor
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * factor
    return String(av).localeCompare(String(bv), 'en', { numeric: true, sensitivity: 'base' }) * factor
  })
}
