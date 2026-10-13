
import * as React from 'react'
import { cn } from '@/lib/utils'
import { formatCurrency, formatDeltaPercent, formatInteger, formatPercent } from '@shared/format'
import { SERIES_PRIMARY, agingColor, divisionColor } from '@shared/palette'
import { ChartFrame } from './chart-frame'
import type { BreakdownRow } from '@shared/types'

/**
 * Horizontal breakdown bars.
 *
 * Chosen over a pie or donut: these comparisons are between values that are
 * often close, and a bar lets the reader read the order and the magnitude
 * without comparing angles. Every bar is directly labelled with its value, so
 * the chart never depends on reading a scale.
 *
 * Colour rules applied here:
 *   - Nominal categories (customers, representatives, stages) all use ONE
 *     colour. Shading each bar darker-where-bigger would double-encode the
 *     bar length and waste the only free channel.
 *   - Divisions use their fixed identity hue, so a division keeps its colour
 *     when a filter removes another one.
 *   - Ordered age bands use the validated severity ramp.
 */

export type BreakdownColorMode = 'single' | 'division' | 'aging'

export function BreakdownBars({
  rows,
  valueFormat = 'currency',
  colorMode = 'single',
  showShare = true,
  showDelta = false,
  secondaryFormat = 'currency',
  emptyTitle,
  emptyDescription,
  maxRows,
  className,
  footnote,
}: {
  rows: BreakdownRow[]
  valueFormat?: 'currency' | 'integer' | 'percent'
  colorMode?: BreakdownColorMode
  showShare?: boolean
  showDelta?: boolean
  secondaryFormat?: 'currency' | 'integer'
  emptyTitle?: string
  emptyDescription?: string
  maxRows?: number
  className?: string
  footnote?: React.ReactNode
}) {
  const visible = maxRows ? rows.slice(0, maxRows) : rows
  const max = Math.max(...visible.map((r) => Math.abs(r.value)), 1)

  const formatValue = (v: number) =>
    valueFormat === 'currency' ? formatCurrency(v) : valueFormat === 'percent' ? formatPercent(v) : formatInteger(v)
  const formatSecondary = (v: number) =>
    secondaryFormat === 'currency' ? formatCurrency(v) : formatInteger(v)

  const colorFor = (row: BreakdownRow, index: number): string => {
    if (colorMode === 'division') return divisionColor(rowDivisionCode(row), index)
    if (colorMode === 'aging') return agingColor(row.key)
    return SERIES_PRIMARY
  }

  return (
    <ChartFrame
      isEmpty={visible.length === 0}
      emptyTitle={emptyTitle ?? 'Nothing to break down'}
      emptyDescription={
        emptyDescription ??
        'There are no records in this period for the filters you have selected.'
      }
      footnote={footnote}
      className={className}
      tableRows={visible}
      tableColumns={[
        { key: 'label', label: 'Name', render: (r) => r.label },
        { key: 'value', label: 'Value', numeric: true, render: (r) => formatValue(r.value) },
        ...(showShare
          ? [{ key: 'share', label: 'Share', numeric: true, render: (r: BreakdownRow) => formatPercent(r.share) }]
          : []),
        ...(showDelta
          ? [
              {
                key: 'delta',
                label: 'Change',
                numeric: true,
                render: (r: BreakdownRow) => formatDeltaPercent(r.deltaPercent) ?? '—',
              },
            ]
          : []),
      ]}
    >
      <ul className="space-y-2.5">
        {visible.map((row, index) => {
          const width = Math.max((Math.abs(row.value) / max) * 100, row.value === 0 ? 0 : 1.5)
          const delta = formatDeltaPercent(row.deltaPercent)
          const improving = row.deltaPercent !== null && row.deltaPercent !== undefined && row.deltaPercent > 0
          const isUnassigned = row.key === '__unassigned__' || row.key === '__unknown__'

          return (
            <li key={row.key}>
              <div className="flex items-baseline justify-between gap-3">
                <p
                  className={cn(
                    'min-w-0 truncate text-[13px]',
                    isUnassigned ? 'italic text-ink-500' : 'text-ink-800',
                  )}
                  title={row.label}
                >
                  {row.label}
                </p>
                <div className="flex shrink-0 items-baseline gap-2.5">
                  {showDelta && delta ? (
                    <span
                      className={cn(
                        'tabular text-[12px] font-medium',
                        improving ? 'text-positive-700' : 'text-negative-700',
                      )}
                    >
                      {delta}
                    </span>
                  ) : null}
                  {row.secondaryValue !== undefined && row.secondaryValue !== null ? (
                    <span className="tabular text-[12px] text-ink-500">
                      {row.secondaryLabel ? `${row.secondaryLabel}: ` : ''}
                      {formatSecondary(row.secondaryValue)}
                    </span>
                  ) : null}
                  <span className="tabular text-[13px] font-semibold text-ink-900">{formatValue(row.value)}</span>
                  {showShare ? (
                    <span className="tabular w-11 text-right text-[12px] text-ink-500">
                      {row.share.toFixed(1)}%
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-ink-100">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${width}%`, backgroundColor: colorFor(row, index) }}
                  role="presentation"
                />
              </div>
            </li>
          )
        })}
      </ul>
    </ChartFrame>
  )
}

/** Division breakdown rows carry the code in `key` for colour lookup. */
function rowDivisionCode(row: BreakdownRow): string | null {
  if (row.key === '__unassigned__' || row.key === '__unknown__' || row.key === '__other__') return null
  return row.divisionCode ?? null
}
