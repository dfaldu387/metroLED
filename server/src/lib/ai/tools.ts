import { z } from 'zod'
import type Anthropic from '@anthropic-ai/sdk'
import type { AccessScope } from '../auth/guards'
import type { LoadedDataset } from '../data/dataset'
import {
  resolveRange,
  daysBetween,
  formatRangeLabel,
  type RangePreset,
  type ResolvedRange,
} from '@shared/dates'
import { formatCurrency, formatInteger, formatPercent } from '@shared/format'
import { getMetricDefinition } from '@shared/metric-definitions'
import {
  countRevenueInvoices,
  percentChange,
  revenueByCustomer,
  revenueByDivision,
  revenueBySalesRep,
  sumRevenue,
} from '../analytics/revenue'
import {
  agingBuckets,
  daysOverdue,
  daysSalesOutstanding,
  outstandingInvoices,
  receivablesByCustomer,
  receivablesSummary,
} from '../analytics/receivables'
import { pipelineSummary, quotesByStage, staleQuotes, winRate } from '../analytics/pipeline'
import { ecommerceSummary, bestSellers } from '../analytics/ecommerce'
import { marginByDivision, marginFor } from '../analytics/margin'
import { describeFreshness } from '../analytics/overview'

/**
 * Approved business-query tools for Ask MetroLED (section 11).
 *
 * Three rules this file exists to enforce:
 *
 *  1. The model never writes SQL. It chooses one of these fixed tools and
 *     supplies parameters, which are validated with Zod before anything runs.
 *     There is no code path from model output to a database query string.
 *
 *  2. Permission is enforced HERE, before any figure is produced. The model is
 *     never trusted to respect access control. A tool the signed-in role may
 *     not use returns a refusal object, so a sales representative cannot
 *     obtain margin or another representative's data by asking cleverly.
 *
 *  3. Every result carries its own provenance - source system, reporting
 *     period, metric definition and data mode - so the answer can cite where
 *     the number came from instead of asserting it.
 */

export interface ToolContext {
  scope: AccessScope
  dataset: LoadedDataset
  settings: { staleQuoteDays: number; largeQuoteAmount: number; timezone: string }
  now: Date
}

export interface ToolSource {
  system: string
  period?: string
  recordCount?: number
  metricDefinition?: string
  note?: string
}

export interface ToolResult {
  ok: boolean
  /** Rendered for the model. Figures are pre-formatted so it cannot misread them. */
  data: Record<string, unknown>
  sources: ToolSource[]
  /** Set when the tool refused. The model must relay this, not work around it. */
  refusal?: string
}

const PERIOD_VALUES = [
  'today',
  'yesterday',
  'last_7_days',
  'last_30_days',
  'this_month',
  'last_month',
  'this_quarter',
  'last_quarter',
  'this_year',
  'last_12_months',
] as const

const periodSchema = z
  .enum(PERIOD_VALUES)
  .describe('The reporting period. Calendar periods in the company timezone.')

function refuse(message: string): ToolResult {
  return { ok: false, data: {}, sources: [], refusal: message }
}

function resolve(context: ToolContext, period: RangePreset): ResolvedRange {
  return resolveRange(period, { now: context.now, timeZone: context.settings.timezone })
}

function dataModeNote(context: ToolContext): string | undefined {
  if (context.dataset.mode === 'demo') {
    return 'These figures come from the labelled DEMO dataset, not from live business data.'
  }
  if (context.dataset.mode === 'unavailable') {
    return 'No business data is available; the database holds no imported records.'
  }
  return undefined
}

function freshnessSource(context: ToolContext): ToolSource {
  return {
    system: 'Data freshness',
    note: describeFreshness(context.dataset, context.now),
  }
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

interface ToolDefinition<S extends z.ZodTypeAny> {
  name: string
  description: string
  schema: S
  /** Permission the caller must hold. Null means every signed-in user. */
  requires: (scope: AccessScope) => boolean
  refusalMessage: string
  run: (input: z.infer<S>, context: ToolContext) => ToolResult
}

function define<S extends z.ZodTypeAny>(definition: ToolDefinition<S>): ToolDefinition<z.ZodTypeAny> {
  return definition as unknown as ToolDefinition<z.ZodTypeAny>
}

export const TOOLS: ToolDefinition<z.ZodTypeAny>[] = [
  // --- Revenue -------------------------------------------------------------
  define({
    name: 'get_revenue',
    description:
      'Total invoiced revenue for a period, optionally broken down by division, customer or sales representative. Revenue is the invoice subtotal excluding tax, by invoice date.',
    schema: z.object({
      period: periodSchema,
      group_by: z
        .enum(['none', 'division', 'customer', 'sales_rep'])
        .default('none')
        .describe('How to break the total down. Use "none" for just the headline figure.'),
      compare_to_previous: z
        .boolean()
        .default(true)
        .describe('Include the equivalent previous period for comparison.'),
    }),
    requires: (scope) => scope.canSeeRevenue,
    refusalMessage: 'Your role does not include access to revenue figures.',
    run: (input, context) => {
      const range = resolve(context, input.period)
      const total = sumRevenue(context.dataset.invoices, range)
      const invoiceCount = countRevenueInvoices(context.dataset.invoices, range)
      const previous = input.compare_to_previous ? sumRevenue(context.dataset.invoices, range.comparison) : null
      const definition = getMetricDefinition('revenue')!

      const data: Record<string, unknown> = {
        period: range.label,
        period_start: range.start.toISOString().slice(0, 10),
        period_end: range.end.toISOString().slice(0, 10),
        total_revenue: formatCurrency(total),
        total_revenue_number: total,
        invoice_count: invoiceCount,
      }

      if (previous !== null) {
        const change = percentChange(total, previous > 0 ? previous : null)
        data.previous_period = range.comparisonLabel
        data.previous_period_revenue = previous > 0 ? formatCurrency(previous) : 'No data for the previous period'
        data.change_percent = change === null ? 'Not comparable' : `${change > 0 ? '+' : ''}${change.toFixed(1)}%`
      }

      if (input.group_by === 'division') {
        data.by_division = revenueByDivision(context.dataset.invoices, { range, comparison: range.comparison }).map(
          (row) => ({ name: row.label, revenue: formatCurrency(row.value), share: `${row.share.toFixed(1)}%` }),
        )
      } else if (input.group_by === 'customer') {
        if (!context.scope.canSeeCustomers) {
          return refuse('Your role does not include revenue broken down by customer.')
        }
        data.by_customer = revenueByCustomer(context.dataset.invoices, { range }).map((row) => ({
          name: row.label,
          revenue: formatCurrency(row.value),
          share: `${row.share.toFixed(1)}%`,
        }))
      } else if (input.group_by === 'sales_rep') {
        data.by_sales_rep = revenueBySalesRep(context.dataset.invoices, { range }).map((row) => ({
          name: row.label,
          revenue: formatCurrency(row.value),
          share: `${row.share.toFixed(1)}%`,
        }))
        if (!context.scope.canSeeAllReps) {
          data.scope_note = 'Restricted to the signed-in user’s own records.'
        }
      }

      if (invoiceCount === 0) {
        data.warning = 'No invoices fall inside this period, so the revenue figure is zero rather than unavailable.'
      }

      return {
        ok: true,
        data,
        sources: [
          {
            system: 'QuickBooks Online',
            period: formatRangeLabel(range),
            recordCount: invoiceCount,
            metricDefinition: definition.formula,
            note: dataModeNote(context),
          },
          freshnessSource(context),
        ],
      }
    },
  }),

  // --- Receivables ---------------------------------------------------------
  define({
    name: 'get_accounts_receivable',
    description:
      'Outstanding and overdue accounts receivable as at today, with the aging breakdown. A point-in-time balance, not a period total.',
    schema: z.object({
      include_aging: z.boolean().default(true).describe('Include the aging bucket breakdown.'),
      include_top_customers: z.boolean().default(false).describe('Include the customers who owe the most.'),
    }),
    requires: (scope) => scope.canSeeReceivables,
    refusalMessage: 'Your role does not include access to accounts receivable.',
    run: (input, context) => {
      const summary = receivablesSummary(context.dataset.invoices, context.now)
      const definition = getMetricDefinition('accounts_receivable')!

      const data: Record<string, unknown> = {
        as_at: context.now.toISOString(),
        total_outstanding: formatCurrency(summary.totalOutstanding),
        total_outstanding_number: summary.totalOutstanding,
        current_not_yet_due: formatCurrency(summary.currentAmount),
        overdue: formatCurrency(summary.overdueAmount),
        overdue_number: summary.overdueAmount,
        open_invoice_count: summary.invoiceCount,
        overdue_invoice_count: summary.overdueInvoiceCount,
        average_days_overdue: summary.averageDaysOverdue,
      }

      if (summary.noDueDateCount > 0) {
        data.no_due_date = {
          amount: formatCurrency(summary.noDueDateAmount),
          count: summary.noDueDateCount,
          note: 'These invoices have no due date in QuickBooks and cannot be aged, so they are excluded from the overdue total.',
        }
      }

      if (input.include_aging) {
        data.aging = agingBuckets(context.dataset.invoices, context.now).map((bucket) => ({
          bucket: bucket.label,
          amount: formatCurrency(bucket.amount),
          invoices: bucket.invoiceCount,
          share: `${bucket.share.toFixed(1)}%`,
        }))
      }

      if (input.include_top_customers) {
        data.top_customers = receivablesByCustomer(context.dataset.invoices, context.now, 5).map((row) => ({
          name: row.label,
          outstanding: formatCurrency(row.value),
          overdue: formatCurrency(row.secondaryValue ?? 0),
        }))
      }

      return {
        ok: true,
        data,
        sources: [
          {
            system: 'QuickBooks Online',
            period: 'As at now (point-in-time balance)',
            recordCount: summary.invoiceCount,
            metricDefinition: definition.formula,
            note: dataModeNote(context),
          },
          freshnessSource(context),
        ],
      }
    },
  }),

  define({
    name: 'list_overdue_invoices',
    description:
      'Individual overdue invoices, largest first. Use when the question asks which invoices are overdue, or overdue by more than a number of days.',
    schema: z.object({
      min_days_overdue: z
        .number()
        .int()
        .min(1)
        .max(3650)
        .default(1)
        .describe('Only include invoices overdue by at least this many days.'),
      limit: z.number().int().min(1).max(50).default(15),
    }),
    requires: (scope) => scope.canSeeReceivables,
    refusalMessage: 'Your role does not include access to accounts receivable.',
    run: (input, context) => {
      const rows = outstandingInvoices(context.dataset.invoices)
        .map((invoice) => ({ invoice, days: daysOverdue(invoice, context.now) }))
        .filter((row) => row.days !== null && row.days >= input.min_days_overdue)
        .sort((a, b) => b.invoice.balance - a.invoice.balance)

      const total = rows.reduce((acc, r) => acc + r.invoice.balance, 0)

      return {
        ok: true,
        data: {
          criteria: `Overdue by ${input.min_days_overdue}+ days`,
          matching_invoice_count: rows.length,
          matching_total: formatCurrency(total),
          invoices: rows.slice(0, input.limit).map((row) => ({
            invoice_number: row.invoice.docNumber,
            customer: row.invoice.customerName ?? 'Unknown customer',
            division: row.invoice.divisionName ?? 'Unassigned',
            balance: formatCurrency(row.invoice.balance, { decimals: true }),
            due_date: row.invoice.dueOn ? row.invoice.dueOn.toISOString().slice(0, 10) : 'Not recorded',
            days_overdue: row.days,
            source_id: row.invoice.sourceId,
          })),
          truncated: rows.length > input.limit ? `Showing ${input.limit} of ${rows.length}.` : undefined,
        },
        sources: [
          {
            system: 'QuickBooks Online',
            period: 'As at now',
            recordCount: rows.length,
            metricDefinition: getMetricDefinition('accounts_receivable_overdue')!.formula,
            note: dataModeNote(context),
          },
          freshnessSource(context),
        ],
      }
    },
  }),

  define({
    name: 'get_days_sales_outstanding',
    description: 'Days Sales Outstanding (DSO) - the average number of days it takes to collect invoiced revenue.',
    schema: z.object({ period: periodSchema.default('last_30_days') }),
    requires: (scope) => scope.canSeeReceivables && scope.canSeeRevenue,
    refusalMessage: 'Your role does not include access to accounts receivable.',
    run: (input, context) => {
      const range = resolve(context, input.period)
      const summary = receivablesSummary(context.dataset.invoices, context.now)
      const revenue = sumRevenue(context.dataset.invoices, range)
      const days = daysBetween(range.start, range.end) + 1
      const dso = daysSalesOutstanding(summary.totalOutstanding, revenue, days)
      const definition = getMetricDefinition('dso')!

      return {
        ok: true,
        data: {
          dso: dso === null ? 'Not available' : `${dso} days`,
          unavailable_reason:
            dso === null ? 'There is no revenue in the selected period, so DSO is undefined.' : undefined,
          outstanding_used: formatCurrency(summary.totalOutstanding),
          revenue_used: formatCurrency(revenue),
          period: range.label,
          days_in_period: days,
          caveat: definition.notes,
        },
        sources: [
          {
            system: 'QuickBooks Online',
            period: formatRangeLabel(range),
            metricDefinition: definition.formula,
            note: dataModeNote(context),
          },
          freshnessSource(context),
        ],
      }
    },
  }),

  // --- Pipeline ------------------------------------------------------------
  define({
    name: 'get_sales_pipeline',
    description:
      'Open sales pipeline from Method CRM: total value, quote count, stage breakdown and win rate. The total is UNWEIGHTED - no probability is applied.',
    schema: z.object({
      period: periodSchema.default('last_30_days').describe('Period used for the win-rate calculation only.'),
      include_stages: z.boolean().default(true),
    }),
    requires: (scope) => scope.canSeePipeline,
    refusalMessage: 'Your role does not include access to the sales pipeline.',
    run: (input, context) => {
      const range = resolve(context, input.period)
      const summary = pipelineSummary(context.dataset.quotes, context.now, {
        staleThresholdDays: context.settings.staleQuoteDays,
        largeQuoteAmount: context.settings.largeQuoteAmount,
      })
      const wins = winRate(context.dataset.quotes, range)
      const definition = getMetricDefinition('pipeline_value')!

      const data: Record<string, unknown> = {
        open_pipeline_value: formatCurrency(summary.openValue),
        open_pipeline_number: summary.openValue,
        open_quote_count: summary.openCount,
        average_quote_value:
          summary.averageQuoteValue === null ? 'Not available' : formatCurrency(summary.averageQuoteValue),
        stale_value: formatCurrency(summary.staleValue),
        stale_quote_count: summary.staleCount,
        stale_threshold_days: context.settings.staleQuoteDays,
        win_rate:
          wins.winRatePercent === null
            ? 'Not available - no quote was won or lost in this period'
            : formatPercent(wins.winRatePercent),
        win_rate_period: range.label,
        quotes_won: wins.wonCount,
        quotes_lost: wins.lostCount,
        important:
          'This pipeline total is unweighted. Method CRM records no probability per stage and no weighting formula has been approved, so a probability-weighted forecast must NOT be stated.',
      }

      if (input.include_stages) {
        data.by_stage = quotesByStage(context.dataset.quotes).map((row) => ({
          stage: row.label,
          value: formatCurrency(row.value),
          quotes: row.secondaryValue,
        }))
      }

      if (!context.scope.canSeeAllReps) {
        data.scope_note = 'Restricted to the signed-in user’s own quotes.'
      }

      return {
        ok: true,
        data,
        sources: [
          {
            system: 'Method CRM',
            period: `Pipeline as at now; win rate for ${formatRangeLabel(range)}`,
            recordCount: summary.openCount,
            metricDefinition: definition.formula,
            note: dataModeNote(context),
          },
          freshnessSource(context),
        ],
      }
    },
  }),

  define({
    name: 'list_stale_quotes',
    description:
      'Open quotes that have had no activity recently, largest first. Use for questions about quotes that have gone cold or quiet.',
    schema: z.object({
      min_days_idle: z.number().int().min(1).max(3650).optional().describe('Defaults to the configured threshold.'),
      min_amount: z.number().min(0).optional().describe('Only include quotes worth at least this much.'),
      limit: z.number().int().min(1).max(50).default(15),
    }),
    requires: (scope) => scope.canSeePipeline,
    refusalMessage: 'Your role does not include access to the sales pipeline.',
    run: (input, context) => {
      const threshold = input.min_days_idle ?? context.settings.staleQuoteDays
      const minAmount = input.min_amount ?? 0

      const rows = staleQuotes(context.dataset.quotes, context.now, threshold).filter(
        (q) => q.amount >= minAmount,
      )
      const total = rows.reduce((acc, q) => acc + q.amount, 0)

      return {
        ok: true,
        data: {
          criteria: `Open quotes idle for ${threshold}+ days${minAmount > 0 ? ` and worth ${formatCurrency(minAmount)} or more` : ''}`,
          matching_count: rows.length,
          matching_total: formatCurrency(total),
          quotes: rows.slice(0, input.limit).map((quote) => ({
            quote_number: quote.docNumber,
            customer: quote.customerName ?? 'Unknown customer',
            owner: quote.salesRepName ?? 'Not recorded',
            stage: quote.stage,
            value: formatCurrency(quote.amount),
            days_idle: quote.daysIdle,
            last_activity: quote.lastActivityAt
              ? quote.lastActivityAt.toISOString().slice(0, 10)
              : 'None recorded',
            source_id: quote.sourceId,
          })),
          truncated: rows.length > input.limit ? `Showing ${input.limit} of ${rows.length}.` : undefined,
        },
        sources: [
          {
            system: 'Method CRM',
            period: 'As at now',
            recordCount: rows.length,
            metricDefinition: getMetricDefinition('quote_aging')!.formula,
            note: dataModeNote(context),
          },
          freshnessSource(context),
        ],
      }
    },
  }),

  // --- E-commerce ----------------------------------------------------------
  define({
    name: 'get_ecommerce_performance',
    description:
      'Eco LED Mart (Shopify) store performance: net sales, orders, average order value and best sellers. These are STORE sales, not accounting revenue.',
    schema: z.object({
      period: periodSchema,
      include_best_sellers: z.boolean().default(false),
    }),
    requires: (scope) => scope.canSeeEcommerce,
    refusalMessage: 'Your role does not include access to e-commerce reporting.',
    run: (input, context) => {
      const range = resolve(context, input.period)
      const summary = ecommerceSummary(context.dataset.orders, range)
      const previous = ecommerceSummary(context.dataset.orders, range.comparison)
      const definition = getMetricDefinition('shopify_sales')!
      const shopify = context.dataset.integrations.find((i) => i.provider === 'SHOPIFY')

      if (!shopify?.isEnabled && context.dataset.orders.length === 0) {
        return refuse(
          'Shopify is not connected, so there is no Eco LED Mart data to report. An administrator can connect it on the Data Health page.',
        )
      }

      const data: Record<string, unknown> = {
        period: range.label,
        net_sales: summary.orderCount === 0 ? 'No orders in this period' : formatCurrency(summary.netSales),
        net_sales_number: summary.netSales,
        order_count: summary.orderCount,
        average_order_value:
          summary.averageOrderValue === null
            ? 'Not available - no orders in this period'
            : formatCurrency(summary.averageOrderValue, { decimals: true }),
        refunds: formatCurrency(summary.totalRefunds),
        discounts: formatCurrency(summary.totalDiscounts),
        cancelled_orders_excluded: summary.cancelledOrderCount,
        previous_period: range.comparisonLabel,
        previous_period_net_sales: previous.orderCount === 0 ? 'No orders' : formatCurrency(previous.netSales),
        basis:
          'Net sales is the order subtotal after discounts, less refunds. It EXCLUDES sales tax and shipping, and is on a different basis from QuickBooks accounting revenue. Never add the two together.',
      }

      if (input.include_best_sellers) {
        const products = bestSellers(context.dataset.orders, range, 5)
        data.best_sellers =
          products.length > 0
            ? products.map((p) => ({
                product: p.title,
                sku: p.sku,
                units: p.unitsSold,
                net_sales: formatCurrency(p.netSales),
              }))
            : 'Order line detail has not been imported, so best sellers cannot be calculated.'
      }

      return {
        ok: true,
        data,
        sources: [
          {
            system: 'Shopify Admin API',
            period: formatRangeLabel(range),
            recordCount: summary.orderCount,
            metricDefinition: definition.formula,
            note: dataModeNote(context),
          },
          freshnessSource(context),
        ],
      }
    },
  }),

  // --- Gross margin --------------------------------------------------------
  define({
    name: 'get_gross_margin',
    description:
      'Gross profit and gross margin percentage, overall or by division. Only available when Finance has approved the cost of goods sold for every month in the period.',
    schema: z.object({
      period: periodSchema.default('last_month'),
      by_division: z.boolean().default(true),
    }),
    // Enforced here, in code: a sales representative never reaches this tool.
    requires: (scope) => scope.canSeeMargin,
    refusalMessage:
      'Your role does not include access to profit or gross margin figures. This restriction applies to the assistant exactly as it does to the dashboards.',
    run: (input, context) => {
      const range = resolve(context, input.period)
      const overall = marginFor(context.dataset.invoices, context.dataset.costs, range, null)
      const definition = getMetricDefinition('gross_margin_pct')!

      const data: Record<string, unknown> = {
        period: range.label,
        revenue: formatCurrency(overall.revenue),
      }

      if (overall.availability === 'available') {
        data.cost_of_goods_sold = formatCurrency(overall.cogs)
        data.gross_profit = formatCurrency(overall.grossProfit)
        data.gross_margin_percent = formatPercent(overall.grossMarginPercent)
      } else {
        data.gross_margin_percent = 'Not available'
        data.unavailable_reason = overall.reason
        data.instruction =
          'Do NOT estimate or calculate a margin from other figures. State plainly that the margin is not available and give the reason.'
      }

      if (input.by_division) {
        data.by_division = marginByDivision(
          context.dataset.invoices,
          context.dataset.costs,
          range,
          context.dataset.divisions,
        ).map((division) => ({
          division: division.divisionName,
          revenue: formatCurrency(division.revenue),
          gross_margin_percent:
            division.availability === 'available'
              ? formatPercent(division.grossMarginPercent)
              : 'Not available',
          reason: division.availability === 'available' ? undefined : division.reason,
        }))
      }

      data.approval_status = `This metric definition is ${definition.defaultApproval === 'APPROVED' ? 'approved' : 'awaiting approval'} by ${definition.approver}.`

      return {
        ok: true,
        data,
        sources: [
          {
            system: 'QuickBooks Online (revenue and approved direct-cost accounts)',
            period: formatRangeLabel(range),
            metricDefinition: definition.formula,
            note: dataModeNote(context),
          },
          freshnessSource(context),
        ],
      }
    },
  }),

  // --- Division comparison -------------------------------------------------
  define({
    name: 'compare_divisions',
    description:
      'Compare MetroLED, Pixel LED Displays and Eco LED Mart on revenue, pipeline and receivables for a period. Use for "which division performed best" questions.',
    schema: z.object({ period: periodSchema }),
    requires: (scope) => scope.canSeeRevenue,
    refusalMessage: 'Your role does not include access to revenue figures.',
    run: (input, context) => {
      const range = resolve(context, input.period)

      const rows = context.dataset.divisions.map((division) => {
        const invoices = context.dataset.invoices.filter((i) => i.divisionId === division.id)
        const quotes = context.dataset.quotes.filter((q) => q.divisionId === division.id && q.status === 'OPEN')
        const revenue = sumRevenue(invoices, range)
        const previous = sumRevenue(invoices, range.comparison)
        const ar = context.scope.canSeeReceivables ? receivablesSummary(invoices, context.now) : null

        return {
          division: division.name,
          revenue: formatCurrency(revenue),
          revenue_number: revenue,
          previous_period_revenue: previous > 0 ? formatCurrency(previous) : 'No data',
          change_percent: (() => {
            const change = percentChange(revenue, previous > 0 ? previous : null)
            return change === null ? 'Not comparable' : `${change > 0 ? '+' : ''}${change.toFixed(1)}%`
          })(),
          open_pipeline: formatCurrency(quotes.reduce((acc, q) => acc + q.amount, 0)),
          outstanding_receivables: ar ? formatCurrency(ar.totalOutstanding) : 'Not available to this role',
          overdue_receivables: ar ? formatCurrency(ar.overdueAmount) : 'Not available to this role',
        }
      })

      const sorted = [...rows].sort((a, b) => b.revenue_number - a.revenue_number)

      return {
        ok: true,
        data: {
          period: range.label,
          divisions: sorted,
          highest_revenue: sorted[0]?.division ?? 'No divisions have data in this period',
          note: 'Eco LED Mart revenue here is invoiced accounting revenue from QuickBooks, which is a different basis from the Shopify store sales figure.',
        },
        sources: [
          {
            system: 'QuickBooks Online, Method CRM',
            period: formatRangeLabel(range),
            metricDefinition: getMetricDefinition('revenue')!.formula,
            note: dataModeNote(context),
          },
          freshnessSource(context),
        ],
      }
    },
  }),

  // --- Period comparison ---------------------------------------------------
  define({
    name: 'compare_periods',
    description:
      'Compare the headline figures between two periods. Use for "what changed compared with last month" style questions.',
    schema: z.object({
      period_a: periodSchema.describe('The more recent period.'),
      period_b: periodSchema.describe('The period to compare against.'),
    }),
    requires: (scope) => scope.canSeeRevenue,
    refusalMessage: 'Your role does not include access to revenue figures.',
    run: (input, context) => {
      const a = resolve(context, input.period_a)
      const b = resolve(context, input.period_b)

      const revenueA = sumRevenue(context.dataset.invoices, a)
      const revenueB = sumRevenue(context.dataset.invoices, b)
      const change = percentChange(revenueA, revenueB > 0 ? revenueB : null)

      const data: Record<string, unknown> = {
        period_a: a.label,
        period_b: b.label,
        revenue_a: formatCurrency(revenueA),
        revenue_b: formatCurrency(revenueB),
        revenue_change: change === null ? 'Not comparable' : `${change > 0 ? '+' : ''}${change.toFixed(1)}%`,
        invoices_a: countRevenueInvoices(context.dataset.invoices, a),
        invoices_b: countRevenueInvoices(context.dataset.invoices, b),
      }

      if (context.scope.canSeePipeline) {
        data.quotes_won_a = winRate(context.dataset.quotes, a).wonCount
        data.quotes_won_b = winRate(context.dataset.quotes, b).wonCount
      }

      if (context.scope.canSeeEcommerce) {
        data.shopify_net_sales_a = formatCurrency(ecommerceSummary(context.dataset.orders, a).netSales)
        data.shopify_net_sales_b = formatCurrency(ecommerceSummary(context.dataset.orders, b).netSales)
      }

      return {
        ok: true,
        data,
        sources: [
          {
            system: 'QuickBooks Online, Method CRM, Shopify',
            period: `${formatRangeLabel(a)} compared with ${formatRangeLabel(b)}`,
            metricDefinition: getMetricDefinition('revenue')!.formula,
            note: dataModeNote(context),
          },
          freshnessSource(context),
        ],
      }
    },
  }),

  // --- Data freshness ------------------------------------------------------
  define({
    name: 'get_data_freshness',
    description:
      'Whether the business data is up to date: each source system, its connection status and when it last synced successfully. Use for "is our data up to date" questions, and whenever a figure may be stale.',
    schema: z.object({}),
    requires: () => true,
    refusalMessage: '',
    run: (_input, context) => ({
      ok: true,
      data: {
        data_mode: context.dataset.mode,
        summary: describeFreshness(context.dataset, context.now),
        sources: context.dataset.integrations.map((integration) => ({
          name: integration.displayName,
          status: integration.status,
          enabled: integration.isEnabled,
          last_successful_sync: integration.lastSuccessAt
            ? integration.lastSuccessAt.toISOString()
            : 'Never',
          minutes_since_last_success: integration.minutesSinceSuccess,
          is_stale: integration.isStale,
          last_error: integration.lastErrorMessage,
          expected_sync_interval_minutes: integration.syncIntervalMin,
        })),
        unmatched_records_awaiting_review: context.dataset.unmatchedCount,
      },
      sources: [
        {
          system: 'MetroLED Intelligence synchronisation log',
          note: dataModeNote(context),
        },
      ],
    }),
  }),

  // --- Metric definitions --------------------------------------------------
  define({
    name: 'get_metric_definition',
    description:
      'The approved definition of a business metric: its formula, source system, date basis and what it includes or excludes. Use when asked how a number is calculated.',
    schema: z.object({
      metric: z
        .enum([
          'revenue',
          'cogs',
          'gross_profit',
          'gross_margin_pct',
          'accounts_receivable',
          'accounts_receivable_overdue',
          'ar_aging_buckets',
          'dso',
          'pipeline_value',
          'quote_aging',
          'win_rate',
          'shopify_sales',
          'average_order_value',
        ])
        .describe('The metric key to explain.'),
    }),
    requires: () => true,
    refusalMessage: '',
    run: (input, context) => {
      const definition = getMetricDefinition(input.metric)
      if (!definition) return refuse(`No definition is recorded for "${input.metric}".`)

      // A sales representative may learn how margin is defined, but must never
      // receive an actual margin figure. The definition carries no data.
      if (
        (input.metric === 'gross_margin_pct' || input.metric === 'gross_profit' || input.metric === 'cogs') &&
        !context.scope.canSeeMargin
      ) {
        return {
          ok: true,
          data: {
            metric: definition.name,
            formula: definition.formula,
            note: 'This explains how the metric is defined. Your role does not include access to the actual figures.',
          },
          sources: [{ system: 'Approved metric definitions' }],
        }
      }

      return {
        ok: true,
        data: {
          metric: definition.name,
          description: definition.shortDescription,
          formula: definition.formula,
          source_systems: definition.sourceSystems,
          date_basis: definition.dateBasis,
          included: definition.includedRecords,
          excluded: definition.excludedRecords,
          currency_handling: definition.currencyHandling,
          division_mapping: definition.divisionMapping,
          approval_status: definition.defaultApproval,
          approver: definition.approver,
          notes: definition.notes,
        },
        sources: [{ system: 'Approved metric definitions', metricDefinition: definition.formula }],
      }
    },
  }),

  // --- Attention -----------------------------------------------------------
  define({
    name: 'get_business_alerts',
    description:
      'What currently needs attention: newly overdue invoices, large stale quotes, failing integrations and unmatched records. Use for "what should I look at" questions.',
    schema: z.object({
      days: z.number().int().min(1).max(90).default(7).describe('Look back this many days for new problems.'),
    }),
    requires: () => true,
    refusalMessage: '',
    run: (input, context) => {
      const items: Record<string, unknown>[] = []

      for (const integration of context.dataset.integrations) {
        if (!integration.isEnabled) continue
        if (integration.status === 'ERROR' || integration.consecutiveFailures >= 3) {
          items.push({
            severity: 'urgent',
            type: 'integration_failure',
            detail: `${integration.displayName} is failing to sync. ${integration.lastErrorMessage ?? ''}`,
          })
        } else if (integration.isStale) {
          items.push({
            severity: 'warning',
            type: 'stale_data',
            detail: `${integration.displayName} has not synced recently.`,
          })
        }
      }

      if (context.scope.canSeeReceivables) {
        const since = new Date(context.now.getTime() - input.days * 86400000)
        const overdue = outstandingInvoices(context.dataset.invoices).filter((invoice) => {
          if (!invoice.dueOn) return false
          const from = new Date(invoice.dueOn.getTime() + 86400000)
          return from >= since && from <= context.now
        })
        if (overdue.length > 0) {
          items.push({
            severity: 'urgent',
            type: 'newly_overdue',
            detail: `${overdue.length} invoices worth ${formatCurrency(overdue.reduce((a, i) => a + i.balance, 0))} became overdue in the last ${input.days} days.`,
          })
        }
      }

      if (context.scope.canSeePipeline) {
        const stale = staleQuotes(context.dataset.quotes, context.now, context.settings.staleQuoteDays).filter(
          (q) => q.amount >= context.settings.largeQuoteAmount,
        )
        if (stale.length > 0) {
          items.push({
            severity: 'warning',
            type: 'stale_quotes',
            detail: `${stale.length} large quotes worth ${formatCurrency(stale.reduce((a, q) => a + q.amount, 0))} have had no activity for ${context.settings.staleQuoteDays}+ days.`,
          })
        }
      }

      if (context.dataset.unmatchedCount > 0) {
        items.push({
          severity: 'warning',
          type: 'unmatched_records',
          detail: `${context.dataset.unmatchedCount} source records could not be matched to a customer and are reported under "Unknown customer".`,
        })
      }

      return {
        ok: true,
        data: {
          lookback_days: input.days,
          alert_count: items.length,
          alerts: items.length > 0 ? items : 'Nothing needs attention right now.',
        },
        sources: [
          {
            system: 'QuickBooks Online, Method CRM, synchronisation log',
            period: `Last ${input.days} days`,
            note: dataModeNote(context),
          },
          freshnessSource(context),
        ],
      }
    },
  }),
]

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

/** The tool list sent to the model, filtered to what this role may use. */
export function toolDefinitionsFor(scope: AccessScope): Anthropic.Tool[] {
  return TOOLS.filter((tool) => tool.requires(scope)).map((tool) => ({
    name: tool.name,
    description: tool.description,
    // `strict` guarantees the arguments validate against the schema, which
    // removes a whole class of malformed-input handling.
    strict: true,
    input_schema: toJsonSchema(tool.schema),
  }))
}

export interface ToolExecution {
  name: string
  input: unknown
  result: ToolResult
  durationMs: number
}

/**
 * Runs an approved tool.
 *
 * The order is deliberate: permission first, then parameter validation, then
 * execution. A tool the role may not use never reaches its implementation,
 * whatever the model asked for.
 */
export function executeTool(name: string, rawInput: unknown, context: ToolContext): ToolExecution {
  const started = Date.now()
  const tool = TOOLS.find((t) => t.name === name)

  if (!tool) {
    return {
      name,
      input: rawInput,
      result: refuse(`"${name}" is not an approved business query.`),
      durationMs: Date.now() - started,
    }
  }

  if (!tool.requires(context.scope)) {
    return {
      name,
      input: rawInput,
      result: refuse(tool.refusalMessage),
      durationMs: Date.now() - started,
    }
  }

  const parsed = tool.schema.safeParse(rawInput ?? {})
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ')
    return {
      name,
      input: rawInput,
      result: refuse(`The parameters supplied for "${name}" are not valid (${issues}).`),
      durationMs: Date.now() - started,
    }
  }

  try {
    const result = tool.run(parsed.data, context)
    return { name, input: parsed.data, result, durationMs: Date.now() - started }
  } catch (error) {
    return {
      name,
      input: parsed.data,
      result: refuse(
        `The query could not be completed: ${error instanceof Error ? error.message : 'unexpected error'}.`,
      ),
      durationMs: Date.now() - started,
    }
  }
}

/**
 * Minimal Zod to JSON Schema conversion covering the shapes used above.
 *
 * Written by hand rather than pulling in a converter: the schemas here are
 * small and fixed, and a hand-written mapping is easier to audit than a
 * general-purpose library for something this security-relevant.
 */
function toJsonSchema(schema: z.ZodTypeAny): Anthropic.Tool['input_schema'] {
  const shape = (schema as unknown as z.ZodObject<z.ZodRawShape>).shape ?? {}
  const properties: Record<string, unknown> = {}
  const required: string[] = []

  for (const [key, value] of Object.entries(shape)) {
    const { json, isRequired } = fieldSchema(value as z.ZodTypeAny)
    properties[key] = json
    if (isRequired) required.push(key)
  }

  return {
    type: 'object',
    properties,
    required,
    additionalProperties: false,
  } as Anthropic.Tool['input_schema']
}

function fieldSchema(field: z.ZodTypeAny): { json: Record<string, unknown>; isRequired: boolean } {
  let current: z.ZodTypeAny = field
  let isRequired = true
  let description: string | undefined
  let defaultValue: unknown

  // Unwrap optional/default/describe layers to reach the base type.
  for (let depth = 0; depth < 6; depth++) {
    const def = current._def as { typeName?: string; description?: string; innerType?: z.ZodTypeAny; defaultValue?: () => unknown }
    if (def.description && !description) description = def.description

    if (def.typeName === 'ZodOptional') {
      isRequired = false
      current = def.innerType as z.ZodTypeAny
      continue
    }
    if (def.typeName === 'ZodDefault') {
      isRequired = false
      defaultValue = def.defaultValue?.()
      current = def.innerType as z.ZodTypeAny
      continue
    }
    break
  }

  const def = current._def as {
    typeName?: string
    values?: string[]
    description?: string
    checks?: { kind: string; value?: number }[]
  }
  if (def.description && !description) description = def.description

  const json: Record<string, unknown> = {}
  if (description) json.description = description
  if (defaultValue !== undefined) json.default = defaultValue

  switch (def.typeName) {
    case 'ZodEnum':
      json.type = 'string'
      json.enum = def.values ?? []
      break
    case 'ZodBoolean':
      json.type = 'boolean'
      break
    case 'ZodNumber': {
      json.type = Number.isInteger(defaultValue) || (def.checks ?? []).some((c) => c.kind === 'int')
        ? 'integer'
        : 'number'
      for (const check of def.checks ?? []) {
        if (check.kind === 'min' && typeof check.value === 'number') json.minimum = check.value
        if (check.kind === 'max' && typeof check.value === 'number') json.maximum = check.value
      }
      break
    }
    default:
      json.type = 'string'
  }

  return { json, isRequired }
}

export const SUGGESTED_QUESTIONS = [
  'What was our revenue last month?',
  'Which division generated the most revenue this quarter?',
  'How much money is overdue?',
  'Which invoices are more than 30 days overdue?',
  'Which large quotes have gone cold?',
  'How is Eco LED Mart performing?',
  'What changed compared with last month?',
  'Is all our business data up to date?',
  'What is our gross margin by division?',
  'What should I look at today?',
]

export { formatInteger }
