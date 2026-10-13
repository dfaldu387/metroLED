import { daysBetween, formatRelativeTime, type ResolvedRange } from '../dates'
import { formatCurrency, formatInteger } from '../format'
import { getMetricDefinition } from '../metrics/definitions'
import { marginFor } from './margin'
import { newlyOverdue, receivablesSummary } from './receivables'
import { pipelineSummary, staleQuotes } from './pipeline'
import { percentChange, round2, sumRevenue } from './revenue'
import type {
  AttentionItem,
  CostRecord,
  Dataset,
  DivisionRef,
  InvoiceRecord,
  MetricValue,
  QuoteRecord,
} from '../types'

/**
 * Overview dashboard composition (section 5).
 *
 * The five KPI cards, the division summaries and the "Attention required"
 * list are all built here, so the Overview page, the Daily Brief and the AI
 * assistant report exactly the same numbers.
 *
 * Role visibility is handled by the caller passing a scope: a sales
 * representative never receives the gross margin card, and the metric is
 * returned with `availability: 'restricted'` rather than being silently
 * dropped, so the interface can explain the omission.
 */

export interface OverviewScope {
  canSeeMargin: boolean
  canSeeReceivables: boolean
  canSeePipeline: boolean
  canSeeEcommerce: boolean
  canSeeRevenue: boolean
}

export interface OverviewSettings {
  staleQuoteDays: number
  largeQuoteAmount: number
}

function definitionText(key: string): string {
  const def = getMetricDefinition(key)
  return def ? def.shortDescription : ''
}

function sourceText(key: string): string {
  const def = getMetricDefinition(key)
  return def ? def.sourceSystems.join(', ') : 'Unified database'
}

export function buildOverviewKpis(
  dataset: Dataset,
  range: ResolvedRange,
  scope: OverviewScope,
  settings: OverviewSettings,
  asOf: Date = new Date(),
): MetricValue[] {
  const { invoices, quotes, costs } = dataset
  const metrics: MetricValue[] = []

  // --- Total revenue -------------------------------------------------------
  if (scope.canSeeRevenue) {
    const current = sumRevenue(invoices, range)
    const previous = sumRevenue(invoices, range.comparison)
    const hasAnyInvoice = invoices.length > 0
    metrics.push({
      key: 'revenue',
      label: 'Total Revenue',
      availability: hasAnyInvoice ? 'available' : 'unavailable',
      value: hasAnyInvoice ? current : null,
      previousValue: previous > 0 ? previous : null,
      deltaAbsolute: previous > 0 ? round2(current - previous) : null,
      deltaPercent: percentChange(current, previous > 0 ? previous : null),
      higherIsBetter: true,
      format: 'currency',
      definition: definitionText('revenue'),
      sourceSummary: sourceText('revenue'),
      note: hasAnyInvoice ? undefined : 'No invoices have been imported yet.',
      href: '/revenue',
    })
  } else {
    metrics.push(restricted('revenue', 'Total Revenue', 'currency'))
  }

  // --- Outstanding and overdue receivables ---------------------------------
  if (scope.canSeeReceivables) {
    const ar = receivablesSummary(invoices, asOf)
    const hasAnyInvoice = invoices.length > 0

    metrics.push({
      key: 'accounts_receivable',
      label: 'Outstanding Receivables',
      availability: hasAnyInvoice ? 'available' : 'unavailable',
      value: hasAnyInvoice ? ar.totalOutstanding : null,
      // A point-in-time balance has no "previous period" equivalent, so no
      // comparison is shown rather than inventing one.
      previousValue: null,
      deltaAbsolute: null,
      deltaPercent: null,
      higherIsBetter: false,
      format: 'currency',
      definition: definitionText('accounts_receivable'),
      sourceSummary: sourceText('accounts_receivable'),
      note: hasAnyInvoice
        ? `${formatInteger(ar.invoiceCount)} open ${ar.invoiceCount === 1 ? 'invoice' : 'invoices'}, as at now`
        : 'No invoices have been imported yet.',
      href: '/accounts-receivable',
    })

    metrics.push({
      key: 'accounts_receivable_overdue',
      label: 'Overdue Receivables',
      availability: hasAnyInvoice ? 'available' : 'unavailable',
      value: hasAnyInvoice ? ar.overdueAmount : null,
      previousValue: null,
      deltaAbsolute: null,
      deltaPercent: null,
      higherIsBetter: false,
      format: 'currency',
      definition: definitionText('accounts_receivable_overdue'),
      sourceSummary: sourceText('accounts_receivable_overdue'),
      note: hasAnyInvoice
        ? ar.overdueInvoiceCount > 0
          ? `${formatInteger(ar.overdueInvoiceCount)} overdue, averaging ${ar.averageDaysOverdue ?? 0} days past due`
          : 'Nothing is past its due date.'
        : 'No invoices have been imported yet.',
      href: '/accounts-receivable?filter=overdue',
    })
  } else {
    metrics.push(restricted('accounts_receivable', 'Outstanding Receivables', 'currency'))
    metrics.push(restricted('accounts_receivable_overdue', 'Overdue Receivables', 'currency'))
  }

  // --- Open pipeline -------------------------------------------------------
  if (scope.canSeePipeline) {
    const pipeline = pipelineSummary(quotes, asOf, {
      staleThresholdDays: settings.staleQuoteDays,
      largeQuoteAmount: settings.largeQuoteAmount,
    })
    const hasAnyQuote = quotes.length > 0
    metrics.push({
      key: 'pipeline_value',
      label: 'Open Sales Pipeline',
      availability: hasAnyQuote ? 'available' : 'unavailable',
      value: hasAnyQuote ? pipeline.openValue : null,
      previousValue: null,
      deltaAbsolute: null,
      deltaPercent: null,
      higherIsBetter: true,
      format: 'currency',
      definition: definitionText('pipeline_value'),
      sourceSummary: sourceText('pipeline_value'),
      note: hasAnyQuote
        ? `${formatInteger(pipeline.openCount)} open ${pipeline.openCount === 1 ? 'quote' : 'quotes'}, unweighted total`
        : 'No quotes have been imported yet.',
      href: '/sales-pipeline',
    })
  } else {
    metrics.push(restricted('pipeline_value', 'Open Sales Pipeline', 'currency'))
  }

  // --- Gross margin --------------------------------------------------------
  if (scope.canSeeMargin) {
    const margin = marginFor(invoices, costs, range, null)
    metrics.push({
      key: 'gross_margin_pct',
      label: 'Gross Margin',
      availability: margin.availability === 'available' ? 'available' : 'unavailable',
      value: margin.grossMarginPercent,
      previousValue: null,
      deltaAbsolute: null,
      deltaPercent: null,
      higherIsBetter: true,
      format: 'percent',
      definition: definitionText('gross_margin_pct'),
      sourceSummary: sourceText('gross_margin_pct'),
      note:
        margin.availability === 'available'
          ? `${formatCurrency(margin.grossProfit)} gross profit on ${formatCurrency(margin.revenue)} revenue`
          : margin.reason,
      href: '/gross-margin',
    })
  } else {
    metrics.push(restricted('gross_margin_pct', 'Gross Margin', 'percent'))
  }

  return metrics
}

function restricted(key: string, label: string, format: MetricValue['format']): MetricValue {
  return {
    key,
    label,
    availability: 'restricted',
    value: null,
    previousValue: null,
    deltaAbsolute: null,
    deltaPercent: null,
    higherIsBetter: true,
    format,
    definition: definitionText(key),
    sourceSummary: sourceText(key),
    note: 'Your role does not include access to this figure.',
  }
}

// ---------------------------------------------------------------------------
// Division performance
// ---------------------------------------------------------------------------

export interface DivisionPerformance {
  divisionId: string
  code: string
  name: string
  revenue: number
  previousRevenue: number | null
  revenueDeltaPercent: number | null
  invoiceCount: number
  openPipeline: number
  openQuoteCount: number
  outstandingReceivables: number
  overdueReceivables: number
  /** null when the role cannot see margin or no approved cost exists. */
  grossMarginPercent: number | null
  marginNote?: string
}

export function buildDivisionPerformance(
  dataset: Dataset,
  range: ResolvedRange,
  scope: OverviewScope,
  asOf: Date = new Date(),
): DivisionPerformance[] {
  return dataset.divisions
    .map((division) => {
      const divisionInvoices = dataset.invoices.filter((i) => i.divisionId === division.id)
      const divisionQuotes = dataset.quotes.filter((q) => q.divisionId === division.id)

      const revenue = sumRevenue(divisionInvoices, range)
      const previousRevenue = sumRevenue(divisionInvoices, range.comparison)
      const ar = receivablesSummary(divisionInvoices, asOf)
      const open = divisionQuotes.filter((q) => q.status === 'OPEN')

      let grossMarginPercent: number | null = null
      let marginNote: string | undefined
      if (scope.canSeeMargin) {
        const margin = marginFor(dataset.invoices, dataset.costs, range, division.id)
        grossMarginPercent = margin.grossMarginPercent
        marginNote = margin.reason
      } else {
        marginNote = 'Not available to your role.'
      }

      return {
        divisionId: division.id,
        code: division.code,
        name: division.name,
        revenue,
        previousRevenue: previousRevenue > 0 ? previousRevenue : null,
        revenueDeltaPercent: percentChange(revenue, previousRevenue > 0 ? previousRevenue : null),
        invoiceCount: divisionInvoices.filter((i) => i.issuedOn >= range.start && i.issuedOn <= range.end).length,
        openPipeline: round2(open.reduce((acc, q) => acc + q.amount, 0)),
        openQuoteCount: open.length,
        outstandingReceivables: scope.canSeeReceivables ? ar.totalOutstanding : 0,
        overdueReceivables: scope.canSeeReceivables ? ar.overdueAmount : 0,
        grossMarginPercent,
        marginNote,
      }
    })
    .sort((a, b) => b.revenue - a.revenue)
}

// ---------------------------------------------------------------------------
// Attention required
// ---------------------------------------------------------------------------

export function buildAttentionItems(
  dataset: Dataset,
  scope: OverviewScope,
  settings: OverviewSettings,
  options: { asOf?: Date; newlyOverdueSinceDays?: number; unmatchedCount?: number } = {},
): AttentionItem[] {
  const asOf = options.asOf ?? new Date()
  const sinceDays = options.newlyOverdueSinceDays ?? 7
  const since = new Date(asOf.getTime() - sinceDays * 24 * 60 * 60 * 1000)
  const items: AttentionItem[] = []

  // 1. Integration failures - the most urgent, because every other number on
  //    the page may be wrong if a source is not syncing.
  for (const integration of dataset.integrations) {
    if (!integration.isEnabled) continue
    if (integration.status === 'ERROR' || integration.consecutiveFailures >= 3) {
      items.push({
        id: `integration-error-${integration.provider}`,
        severity: 'urgent',
        title: `${integration.displayName} is not syncing`,
        detail:
          integration.lastErrorMessage ??
          `${integration.consecutiveFailures} consecutive sync attempts have failed. Figures from this source may be out of date.`,
        actionLabel: 'Retry sync',
        href: '/data-health',
      })
    } else if (integration.isStale) {
      items.push({
        id: `integration-stale-${integration.provider}`,
        severity: 'warning',
        title: `${integration.displayName} data is stale`,
        detail: `Last successful sync ${formatRelativeTime(integration.lastSuccessAt, asOf)}. Expected every ${integration.syncIntervalMin} minutes.`,
        actionLabel: 'View sync history',
        href: '/data-health',
      })
    }
  }

  // 2. Newly overdue invoices.
  if (scope.canSeeReceivables) {
    const overdue = newlyOverdue(dataset.invoices, since, asOf)
    if (overdue.length > 0) {
      const total = round2(overdue.reduce((acc, i) => acc + i.balance, 0))
      items.push({
        id: 'newly-overdue',
        severity: 'urgent',
        title: `${overdue.length} ${overdue.length === 1 ? 'invoice' : 'invoices'} became overdue in the last ${sinceDays} days`,
        detail: overdue
          .slice(0, 3)
          .map((i) => `${i.customerName ?? 'Unknown customer'} — ${formatCurrency(i.balance)}`)
          .join(' · '),
        amountLabel: formatCurrency(total),
        actionLabel: 'Review overdue invoices',
        href: '/accounts-receivable?filter=overdue',
      })
    }

    const ar = receivablesSummary(dataset.invoices, asOf)
    const over90 = dataset.invoices.filter((i) => {
      if (i.balance <= 0.005 || !i.dueOn) return false
      return daysBetween(i.dueOn, asOf) > 90
    })
    if (over90.length > 0) {
      items.push({
        id: 'over-90-days',
        severity: 'urgent',
        title: `${over90.length} ${over90.length === 1 ? 'invoice is' : 'invoices are'} more than 90 days overdue`,
        detail: `This is ${((over90.reduce((a, i) => a + i.balance, 0) / Math.max(ar.totalOutstanding, 1)) * 100).toFixed(0)}% of everything outstanding.`,
        amountLabel: formatCurrency(round2(over90.reduce((a, i) => a + i.balance, 0))),
        actionLabel: 'Review overdue invoices',
        href: '/accounts-receivable?bucket=over_90',
      })
    }
  }

  // 3. Large quotes that have gone quiet.
  if (scope.canSeePipeline) {
    const stale = staleQuotes(dataset.quotes, asOf, settings.staleQuoteDays).filter(
      (q) => q.amount >= settings.largeQuoteAmount,
    )
    if (stale.length > 0) {
      const total = round2(stale.reduce((acc, q) => acc + q.amount, 0))
      items.push({
        id: 'stale-large-quotes',
        severity: 'warning',
        title: `${stale.length} large ${stale.length === 1 ? 'quote has' : 'quotes have'} had no activity for ${settings.staleQuoteDays}+ days`,
        detail: stale
          .slice(0, 3)
          .map((q) => `${q.customerName ?? 'Unknown customer'} — ${formatCurrency(q.amount)} (${q.daysIdle} days idle)`)
          .join(' · '),
        amountLabel: formatCurrency(total),
        actionLabel: 'Review stale quotes',
        href: '/sales-pipeline?filter=stale',
      })
    }
  }

  // 4. Unmatched customer records, which make division and customer
  //    breakdowns incomplete.
  if (options.unmatchedCount && options.unmatchedCount > 0) {
    items.push({
      id: 'unmatched-customers',
      severity: 'warning',
      title: `${options.unmatchedCount} source ${options.unmatchedCount === 1 ? 'record' : 'records'} could not be matched to a customer`,
      detail:
        'Revenue and receivables for these records are reported under "Unknown customer" until they are matched.',
      actionLabel: 'Review unmatched customers',
      href: '/data-health?tab=unmatched',
    })
  }

  // 5. Invoices with no division, which make the division breakdown incomplete.
  const unassigned = dataset.invoices.filter((i) => !i.divisionId && i.revenueAmount > 0)
  if (unassigned.length > 0) {
    items.push({
      id: 'unassigned-division',
      severity: 'info',
      title: `${unassigned.length} ${unassigned.length === 1 ? 'invoice is' : 'invoices are'} not assigned to a division`,
      detail: 'These are reported as "Unassigned" and are excluded from every per-division figure.',
      amountLabel: formatCurrency(round2(unassigned.reduce((a, i) => a + i.revenueAmount, 0))),
      actionLabel: 'Review division mappings',
      href: '/settings/divisions',
    })
  }

  const severityOrder: Record<string, number> = { urgent: 0, warning: 1, info: 2 }
  return items.sort((a, b) => (severityOrder[a.severity] ?? 3) - (severityOrder[b.severity] ?? 3))
}

/** Convenience helper used by the Daily Brief and the AI "is data fresh" tool. */
export function describeFreshness(dataset: Dataset, asOf: Date = new Date()): string {
  const enabled = dataset.integrations.filter((i) => i.isEnabled)
  if (enabled.length === 0) return 'No data sources are connected yet.'
  const stale = enabled.filter((i) => i.isStale)
  const failing = enabled.filter((i) => i.status === 'ERROR')
  if (failing.length > 0) {
    return `${failing.map((i) => i.displayName).join(', ')} ${failing.length === 1 ? 'is' : 'are'} failing to sync. Figures from ${failing.length === 1 ? 'that source' : 'those sources'} are out of date.`
  }
  if (stale.length > 0) {
    return `${stale.map((i) => i.displayName).join(', ')} ${stale.length === 1 ? 'has' : 'have'} not synced recently. Last success: ${stale.map((i) => formatRelativeTime(i.lastSuccessAt, asOf)).join(', ')}.`
  }
  const latest = enabled
    .map((i) => i.lastSuccessAt)
    .filter((d): d is Date => d !== null)
    .sort((a, b) => b.getTime() - a.getTime())[0]
  return latest
    ? `All connected sources are up to date. Last successful sync ${formatRelativeTime(latest, asOf)}.`
    : 'Connected sources have not completed a successful sync yet.'
}

export type { InvoiceRecord, QuoteRecord, CostRecord, DivisionRef }
