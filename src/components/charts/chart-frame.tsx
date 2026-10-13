'use client'

import * as React from 'react'
import { Table2, BarChart3 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { CHART_CHROME } from '@/lib/charts/palette'
import { Table, TBody, TD, TH, THead, TR, TableScroll } from '@/components/ui/table'

/**
 * Chart frame.
 *
 * Carries the pieces every chart needs and that are easy to forget:
 *   - a legend whenever there are two or more series (identity is never
 *     carried by colour alone),
 *   - a "View as table" toggle, so the same figures are available to a screen
 *     reader and to anyone who cannot distinguish the hues,
 *   - an empty state that explains why there is nothing to plot.
 *
 * A single-series chart gets no legend box: the chart title names the series.
 */

export interface LegendEntry {
  label: string
  color: string
  /** Rendered as a dashed key for a comparison series. */
  dashed?: boolean
}

export interface TableColumn<T> {
  key: string
  label: string
  numeric?: boolean
  render: (row: T) => React.ReactNode
}

export function ChartFrame<T>({
  legend,
  children,
  tableRows,
  tableColumns,
  emptyTitle,
  emptyDescription,
  isEmpty,
  footnote,
  className,
}: {
  legend?: LegendEntry[]
  children: React.ReactNode
  tableRows?: T[]
  tableColumns?: TableColumn<T>[]
  emptyTitle?: string
  emptyDescription?: string
  isEmpty?: boolean
  footnote?: React.ReactNode
  className?: string
}) {
  const [showTable, setShowTable] = React.useState(false)
  const canToggle = Boolean(tableRows && tableColumns && tableRows.length > 0)

  if (isEmpty) {
    return (
      <div className={cn('flex flex-col items-center justify-center px-6 py-12 text-center', className)}>
        <div className="mb-3 flex size-11 items-center justify-center rounded-full bg-ink-100">
          <BarChart3 className="size-5 text-ink-500" aria-hidden />
        </div>
        <p className="text-[14px] font-semibold text-ink-900">{emptyTitle ?? 'Nothing to chart yet'}</p>
        <p className="mt-1.5 max-w-md text-[13px] leading-5 text-ink-600">
          {emptyDescription ??
            'There are no records in this period for the filters you have selected. Widen the date range or clear a filter.'}
        </p>
      </div>
    )
  }

  return (
    <div className={className}>
      {legend && legend.length > 1 ? (
        <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
          {legend.map((entry) => (
            <span key={entry.label} className="flex items-center gap-1.5 text-[12.5px] text-ink-700">
              {entry.dashed ? (
                <span
                  className="inline-block h-[2px] w-4 shrink-0 rounded-full"
                  style={{
                    backgroundImage: `repeating-linear-gradient(90deg, ${entry.color} 0 4px, transparent 4px 7px)`,
                  }}
                  aria-hidden
                />
              ) : (
                <span
                  className="inline-block size-2.5 shrink-0 rounded-sm"
                  style={{ backgroundColor: entry.color }}
                  aria-hidden
                />
              )}
              {entry.label}
            </span>
          ))}
        </div>
      ) : null}

      {showTable && canToggle ? (
        <TableScroll className="rounded-lg border border-ink-200">
          <Table>
            <THead>
              <TR>
                {tableColumns!.map((col) => (
                  <TH key={col.key} numeric={col.numeric}>
                    {col.label}
                  </TH>
                ))}
              </TR>
            </THead>
            <TBody>
              {tableRows!.map((row, i) => (
                <TR key={i} className="hover:bg-ink-50">
                  {tableColumns!.map((col) => (
                    <TD key={col.key} numeric={col.numeric}>
                      {col.render(row)}
                    </TD>
                  ))}
                </TR>
              ))}
            </TBody>
          </Table>
        </TableScroll>
      ) : (
        children
      )}

      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
        {footnote ? <p className="text-[12px] leading-4 text-ink-500">{footnote}</p> : <span />}
        {canToggle ? (
          <button
            type="button"
            onClick={() => setShowTable((v) => !v)}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-[12.5px] font-medium text-ink-600 transition-colors hover:bg-ink-100 hover:text-ink-900 print-hidden"
            aria-pressed={showTable}
          >
            {showTable ? <BarChart3 className="size-3.5" aria-hidden /> : <Table2 className="size-3.5" aria-hidden />}
            {showTable ? 'View as chart' : 'View as table'}
          </button>
        ) : null}
      </div>
    </div>
  )
}

/** Shared tooltip shell so every chart tooltip looks and reads the same. */
export function ChartTooltip({
  title,
  rows,
}: {
  title: string
  rows: { label: string; value: string; color?: string; muted?: boolean }[]
}) {
  return (
    <div className="pointer-events-none rounded-lg border border-ink-200 bg-white px-3 py-2 shadow-overlay">
      <p className="mb-1.5 text-[12px] font-semibold text-ink-900">{title}</p>
      <div className="space-y-1">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center gap-2.5 text-[12px]">
            {row.color ? (
              <span
                className="size-2 shrink-0 rounded-sm"
                style={{ backgroundColor: row.color }}
                aria-hidden
              />
            ) : null}
            <span className={cn('flex-1 whitespace-nowrap', row.muted ? 'text-ink-500' : 'text-ink-600')}>
              {row.label}
            </span>
            <span className="tabular whitespace-nowrap font-semibold text-ink-900">{row.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export const axisTickStyle = {
  fontSize: 11.5,
  fill: CHART_CHROME.axisText,
} as const
