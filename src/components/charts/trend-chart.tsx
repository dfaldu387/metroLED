'use client'

import * as React from 'react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { CHART_CHROME, MARKS, SERIES_COMPARISON, SERIES_PRIMARY, divisionColor } from '@/lib/charts/palette'
import { formatCurrency, formatInteger } from '@/lib/format'
import { ChartFrame, ChartTooltip, axisTickStyle, type LegendEntry } from './chart-frame'
import type { DivisionRef, TimeSeriesPoint } from '@/lib/types'

/**
 * Time-series charts.
 *
 * All of these follow the same rules:
 *   - ONE y-axis. A second measure on a different scale gets its own chart,
 *     never a second axis, because the alignment of two scales is arbitrary
 *     and invents a correlation the data does not contain.
 *   - 2px lines with an 8px active marker carrying a 2px surface ring.
 *   - Bars capped at 24px with a 4px rounded data-end, square at the baseline.
 *   - Hairline, solid, recessive gridlines - horizontal only.
 *   - A crosshair tooltip on line and area; per-mark hover on bars.
 *   - Axis and label text uses text tokens, never the series colour.
 */

function compactCurrency(value: number): string {
  return formatCurrency(value, { compact: true })
}

/** Period-over-period trend. One measure, optionally two periods. */
export function TrendChart({
  data,
  comparisonLabel,
  currentLabel,
  valueFormatter = (v: number) => formatCurrency(v),
  height = 280,
  footnote,
}: {
  data: TimeSeriesPoint[]
  currentLabel: string
  comparisonLabel?: string
  valueFormatter?: (value: number) => string
  height?: number
  footnote?: React.ReactNode
}) {
  const hasComparison =
    Boolean(comparisonLabel) && data.some((d) => d.comparisonValue !== null && d.comparisonValue !== undefined)
  const isEmpty = data.length === 0 || data.every((d) => d.value === 0)

  const legend: LegendEntry[] = hasComparison
    ? [
        { label: currentLabel, color: SERIES_PRIMARY },
        { label: comparisonLabel!, color: SERIES_COMPARISON, dashed: true },
      ]
    : [{ label: currentLabel, color: SERIES_PRIMARY }]

  return (
    <ChartFrame
      legend={legend}
      isEmpty={isEmpty}
      emptyTitle="No activity in this period"
      emptyDescription="Nothing was recorded in the selected date range. Try a wider range, or check on the Data Health page that the source has finished syncing."
      footnote={footnote}
      tableRows={data}
      tableColumns={[
        { key: 'label', label: 'Period', render: (r) => r.label },
        { key: 'value', label: currentLabel, numeric: true, render: (r) => valueFormatter(r.value) },
        ...(hasComparison
          ? [
              {
                key: 'comparisonValue',
                label: comparisonLabel!,
                numeric: true,
                render: (r: TimeSeriesPoint) =>
                  r.comparisonValue === null || r.comparisonValue === undefined
                    ? '—'
                    : valueFormatter(r.comparisonValue),
              },
            ]
          : []),
      ]}
    >
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={SERIES_PRIMARY} stopOpacity={0.14} />
              <stop offset="100%" stopColor={SERIES_PRIMARY} stopOpacity={0.01} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={CHART_CHROME.grid} vertical={false} />
          <XAxis
            dataKey="label"
            tick={axisTickStyle}
            tickLine={false}
            axisLine={{ stroke: CHART_CHROME.axis }}
            minTickGap={16}
            dy={4}
          />
          <YAxis
            tick={axisTickStyle}
            tickLine={false}
            axisLine={false}
            width={56}
            tickFormatter={(v: number) => compactCurrency(v)}
          />
          <Tooltip
            cursor={{ stroke: CHART_CHROME.crosshair, strokeWidth: 1 }}
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null
              return (
                <ChartTooltip
                  title={String(label)}
                  rows={payload.map((p) => ({
                    label: p.dataKey === 'comparisonValue' ? (comparisonLabel ?? 'Previous') : currentLabel,
                    value: valueFormatter(Number(p.value ?? 0)),
                    color: String(p.stroke ?? SERIES_PRIMARY),
                    muted: p.dataKey === 'comparisonValue',
                  }))}
                />
              )
            }}
          />
          {hasComparison ? (
            <Area
              type="monotone"
              dataKey="comparisonValue"
              name={comparisonLabel}
              stroke={SERIES_COMPARISON}
              strokeWidth={MARKS.lineWidth}
              strokeDasharray="4 3"
              fill="none"
              dot={false}
              activeDot={{
                r: MARKS.markerRadius,
                fill: SERIES_COMPARISON,
                stroke: CHART_CHROME.surface,
                strokeWidth: MARKS.surfaceGap,
              }}
              isAnimationActive={false}
            />
          ) : null}
          <Area
            type="monotone"
            dataKey="value"
            name={currentLabel}
            stroke={SERIES_PRIMARY}
            strokeWidth={MARKS.lineWidth}
            fill="url(#trendFill)"
            dot={false}
            activeDot={{
              r: MARKS.markerRadius,
              fill: SERIES_PRIMARY,
              stroke: CHART_CHROME.surface,
              strokeWidth: MARKS.surfaceGap,
            }}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </ChartFrame>
  )
}

/**
 * Revenue split by division, as stacked columns.
 *
 * Columns rather than a stacked area: the monthly totals are what the reader
 * compares, and a 2px surface gap between segments keeps them countable.
 */
export function DivisionStackChart({
  data,
  divisions,
  includeUnassigned,
  height = 300,
  footnote,
}: {
  data: TimeSeriesPoint[]
  divisions: DivisionRef[]
  includeUnassigned: boolean
  height?: number
  footnote?: React.ReactNode
}) {
  const series = [
    ...divisions.map((d, i) => ({ key: d.code, label: d.name, color: divisionColor(d.code, i) })),
    ...(includeUnassigned ? [{ key: 'UNASSIGNED', label: 'Unassigned', color: divisionColor(null) }] : []),
  ]

  const isEmpty = data.length === 0 || data.every((d) => d.value === 0)

  return (
    <ChartFrame
      legend={series.map((s) => ({ label: s.label, color: s.color }))}
      isEmpty={isEmpty}
      emptyTitle="No revenue in this period"
      emptyDescription="No invoices fall inside the selected date range for the divisions you can see."
      footnote={footnote}
      tableRows={data}
      tableColumns={[
        { key: 'label', label: 'Period', render: (r) => r.label },
        ...series.map((s) => ({
          key: s.key,
          label: s.label,
          numeric: true,
          render: (r: TimeSeriesPoint) => formatCurrency(Number(r[s.key] ?? 0)),
        })),
        { key: 'total', label: 'Total', numeric: true, render: (r: TimeSeriesPoint) => formatCurrency(r.value) },
      ]}
    >
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={CHART_CHROME.grid} vertical={false} />
          <XAxis
            dataKey="label"
            tick={axisTickStyle}
            tickLine={false}
            axisLine={{ stroke: CHART_CHROME.axis }}
            minTickGap={12}
            dy={4}
          />
          <YAxis
            tick={axisTickStyle}
            tickLine={false}
            axisLine={false}
            width={56}
            tickFormatter={(v: number) => compactCurrency(v)}
          />
          <Tooltip
            cursor={{ fill: CHART_CHROME.grid, fillOpacity: 0.5 }}
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null
              const total = payload.reduce((acc, p) => acc + Number(p.value ?? 0), 0)
              return (
                <ChartTooltip
                  title={String(label)}
                  rows={[
                    ...payload
                      .slice()
                      .reverse()
                      .map((p) => ({
                        label: series.find((s) => s.key === p.dataKey)?.label ?? String(p.dataKey),
                        value: formatCurrency(Number(p.value ?? 0)),
                        color: String(p.fill ?? SERIES_PRIMARY),
                      })),
                    { label: 'Total', value: formatCurrency(total), muted: true },
                  ]}
                />
              )
            }}
          />
          {series.map((s, i) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              stackId="divisions"
              name={s.label}
              fill={s.color}
              maxBarSize={MARKS.maxBarSize}
              // A 2px stroke in the surface colour is the surface gap that
              // keeps touching stacked segments countable.
              stroke={CHART_CHROME.surface}
              strokeWidth={MARKS.surfaceGap}
              radius={i === series.length - 1 ? MARKS.barRadiusVertical : undefined}
              isAnimationActive={false}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  )
}

/**
 * A count-over-time column chart.
 * Exists so a count never shares an axis with a currency measure.
 */
export function CountTrendChart({
  data,
  dataKey = 'orders',
  seriesLabel,
  height = 180,
  footnote,
}: {
  data: TimeSeriesPoint[]
  dataKey?: string
  seriesLabel: string
  height?: number
  footnote?: React.ReactNode
}) {
  const isEmpty = data.length === 0 || data.every((d) => Number(d[dataKey] ?? 0) === 0)

  return (
    <ChartFrame
      legend={[{ label: seriesLabel, color: SERIES_PRIMARY }]}
      isEmpty={isEmpty}
      emptyTitle={`No ${seriesLabel.toLowerCase()} in this period`}
      emptyDescription="Nothing was recorded in the selected date range."
      footnote={footnote}
      tableRows={data}
      tableColumns={[
        { key: 'label', label: 'Period', render: (r) => r.label },
        {
          key: dataKey,
          label: seriesLabel,
          numeric: true,
          render: (r) => formatInteger(Number(r[dataKey] ?? 0)),
        },
      ]}
    >
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={CHART_CHROME.grid} vertical={false} />
          <XAxis
            dataKey="label"
            tick={axisTickStyle}
            tickLine={false}
            axisLine={{ stroke: CHART_CHROME.axis }}
            minTickGap={16}
            dy={4}
          />
          <YAxis
            tick={axisTickStyle}
            tickLine={false}
            axisLine={false}
            width={36}
            allowDecimals={false}
            tickFormatter={(v: number) => formatInteger(v)}
          />
          <Tooltip
            cursor={{ fill: CHART_CHROME.grid, fillOpacity: 0.5 }}
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null
              return (
                <ChartTooltip
                  title={String(label)}
                  rows={[
                    {
                      label: seriesLabel,
                      value: formatInteger(Number(payload[0]?.value ?? 0)),
                      color: SERIES_PRIMARY,
                    },
                  ]}
                />
              )
            }}
          />
          <Bar
            dataKey={dataKey}
            name={seriesLabel}
            fill={SERIES_PRIMARY}
            maxBarSize={MARKS.maxBarSize}
            radius={MARKS.barRadiusVertical}
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  )
}

/** Monthly gross-margin percentage. Unapproved months are gaps, not zeros. */
export function MarginTrendChart({
  data,
  height = 260,
  footnote,
}: {
  data: { label: string; marginPercent: number | null; revenue: number }[]
  height?: number
  footnote?: React.ReactNode
}) {
  const isEmpty = data.every((d) => d.marginPercent === null)

  return (
    <ChartFrame
      legend={[{ label: 'Gross margin %', color: SERIES_PRIMARY }]}
      isEmpty={isEmpty}
      emptyTitle="Gross margin cannot be charted yet"
      emptyDescription="No month in this period has an approved cost of goods sold figure. Finance must approve the cost basis before a margin is reported."
      footnote={footnote}
      tableRows={data}
      tableColumns={[
        { key: 'label', label: 'Month', render: (r) => r.label },
        { key: 'revenue', label: 'Revenue', numeric: true, render: (r) => formatCurrency(r.revenue) },
        {
          key: 'marginPercent',
          label: 'Gross margin %',
          numeric: true,
          render: (r) => (r.marginPercent === null ? 'Not approved' : `${r.marginPercent.toFixed(1)}%`),
        },
      ]}
    >
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={CHART_CHROME.grid} vertical={false} />
          <XAxis
            dataKey="label"
            tick={axisTickStyle}
            tickLine={false}
            axisLine={{ stroke: CHART_CHROME.axis }}
            minTickGap={12}
            dy={4}
          />
          <YAxis
            tick={axisTickStyle}
            tickLine={false}
            axisLine={false}
            width={44}
            tickFormatter={(v: number) => `${v.toFixed(0)}%`}
          />
          <Tooltip
            cursor={{ stroke: CHART_CHROME.crosshair, strokeWidth: 1 }}
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null
              const point = payload[0]?.payload as { marginPercent: number | null; revenue: number } | undefined
              if (!point) return null
              return (
                <ChartTooltip
                  title={String(label)}
                  rows={[
                    {
                      label: 'Gross margin',
                      value: point.marginPercent === null ? 'Not approved' : `${point.marginPercent.toFixed(1)}%`,
                      color: SERIES_PRIMARY,
                    },
                    { label: 'Revenue', value: formatCurrency(point.revenue), muted: true },
                  ]}
                />
              )
            }}
          />
          <Line
            type="monotone"
            dataKey="marginPercent"
            name="Gross margin %"
            stroke={SERIES_PRIMARY}
            strokeWidth={MARKS.lineWidth}
            // `connectNulls={false}` is the point: a month with no approved
            // cost leaves a visible gap rather than a straight line implying
            // a figure that was never approved.
            connectNulls={false}
            dot={{ r: 3, fill: SERIES_PRIMARY, stroke: CHART_CHROME.surface, strokeWidth: MARKS.surfaceGap }}
            activeDot={{
              r: MARKS.markerRadius,
              fill: SERIES_PRIMARY,
              stroke: CHART_CHROME.surface,
              strokeWidth: MARKS.surfaceGap,
            }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </ChartFrame>
  )
}
