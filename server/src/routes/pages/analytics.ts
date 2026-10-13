import { Router, type Request } from 'express'
import { PERMISSIONS } from '@shared/permissions'
import { addMonths, daysBetween, endOfMonth, formatRelativeTime, startOfMonth, type ResolvedRange } from '@shared/dates'
import type {
  AccountsReceivablePageData,
  EcommercePageData,
  GrossMarginPageData,
  MarginFigures,
  OverviewPageData,
  PageCommon,
  PageRange,
  RevenuePageData,
  SalesPipelinePageData,
} from '@shared/api/analytics'
import { handler } from '../../lib/http/errors'
import { assertMarginAccess } from '../../lib/auth/guards'
import {
  comparisonLabel,
  getPageContext,
  scopeNoteForUser,
  type PageContext,
  type SearchParams,
} from '../../lib/page-context'
import { buildAttentionItems, buildDivisionPerformance, buildOverviewKpis } from '../../lib/analytics/overview'
import {
  countRevenueInvoices,
  percentChange,
  revenueByClassification,
  revenueByCustomer,
  revenueByDivision,
  revenueBySalesRep,
  revenueTrend,
  revenueTrendByDivision,
  sumRevenue,
} from '../../lib/analytics/revenue'
import {
  agingBuckets,
  bucketFor,
  daysOverdue,
  daysSalesOutstanding,
  outstandingInvoices,
  receivablesByCustomer,
  receivablesByDivision,
  receivablesSummary,
} from '../../lib/analytics/receivables'
import {
  daysSinceActivity,
  pipelineSummary,
  quoteAgingBuckets,
  quotesByDivision,
  quotesBySalesRep,
  quotesByStage,
  winRate,
} from '../../lib/analytics/pipeline'
import {
  bestSellers,
  billableOrders,
  ecommerceSummary,
  ecommerceTrend,
  hasOrderLines,
  ordersByFinancialStatus,
  ordersByFulfillmentStatus,
  recentOrders,
} from '../../lib/analytics/ecommerce'
import { marginByDivision, marginFor, marginTrend, type MarginResult } from '../../lib/analytics/margin'

/**
 * Page data for the six analytics dashboards.
 *
 * Each handler runs what the former server-rendered page ran before rendering
 * (permission check, page context, analytics builders) and returns the view
 * model the client renders. Anything the role may not see is left out here,
 * on the server, mirroring the old page's conditionals.
 */
export const analyticsPagesRouter = Router()

const params = (req: Request) => req.query as SearchParams

function readParam(searchParams: SearchParams, key: string): string | undefined {
  const value = searchParams[key]
  return typeof value === 'string' ? value : undefined
}

function pageRange(range: ResolvedRange): PageRange {
  return {
    preset: range.preset,
    label: range.label,
    comparisonLabel: range.comparisonLabel,
    comparisonText: comparisonLabel(range),
    start: range.start.toISOString(),
    end: range.end.toISOString(),
  }
}

function pageCommon(context: PageContext): PageCommon {
  const { dataset, range, now } = context
  return {
    mode: dataset.mode,
    range: pageRange(range),
    lastRefreshLabel: formatRelativeTime(dataset.freshness.lastRefreshAt, now),
    isStale: dataset.freshness.isStale,
    staleSources: dataset.freshness.isStale
      ? dataset.integrations
          .filter((integration) => integration.isStale)
          .map((integration) => ({
            name: integration.displayName,
            lastSuccessLabel: formatRelativeTime(integration.lastSuccessAt, now),
          }))
      : [],
    availableDivisions: dataset.availableDivisions,
    scopeNote: scopeNoteForUser(context),
  }
}

// ---------------------------------------------------------------------------
// GET /api/pages/overview
// ---------------------------------------------------------------------------

function greetingFor(now: Date, timeZone: string): string {
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', hour12: false }).format(now))
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

analyticsPagesRouter.get(
  '/overview',
  handler(async (req): Promise<OverviewPageData> => {
    const context = await getPageContext(PERMISSIONS.OVERVIEW_VIEW, '/overview', params(req), {
      defaultRange: 'last_30_days',
    })
    const { dataset, range, scope, settings, user, now } = context

    const overviewScope = {
      canSeeMargin: scope.canSeeMargin,
      canSeeReceivables: scope.canSeeReceivables,
      canSeePipeline: scope.canSeePipeline,
      canSeeEcommerce: scope.canSeeEcommerce,
      canSeeRevenue: scope.canSeeRevenue,
    }
    const overviewSettings = {
      staleQuoteDays: settings.staleQuoteDays,
      largeQuoteAmount: settings.largeQuoteAmount,
    }

    const kpis = buildOverviewKpis(dataset, range, overviewScope, overviewSettings, now)
    const divisionPerformance = buildDivisionPerformance(dataset, range, overviewScope, now)
    const attention = buildAttentionItems(dataset, overviewScope, overviewSettings, {
      asOf: now,
      unmatchedCount: dataset.unmatchedCount,
    })

    const revenue = scope.canSeeRevenue
      ? {
          trend: revenueTrend(dataset.invoices, range, range.granularity, range.comparison),
          divisionTrend: revenueTrendByDivision(dataset.invoices, range, range.granularity, dataset.divisions),
          divisions: dataset.divisions,
          hasUnassigned: dataset.invoices.some((i) => !i.divisionId && i.revenueAmount > 0),
        }
      : null

    return {
      ...pageCommon(context),
      greeting: greetingFor(now, settings.timezone),
      firstName: user.name.split(/\s+/)[0] ?? user.name,
      can: {
        revenue: scope.canSeeRevenue,
        pipeline: scope.canSeePipeline,
        receivables: scope.canSeeReceivables,
        margin: scope.canSeeMargin,
      },
      kpis,
      attention,
      revenue,
      divisionPerformance: divisionPerformance.map((division) => ({
        divisionId: division.divisionId,
        code: division.code,
        name: division.name,
        revenue: division.revenue,
        revenueDeltaPercent: division.revenueDeltaPercent,
        invoiceCount: division.invoiceCount,
        openPipeline: scope.canSeePipeline ? division.openPipeline : null,
        overdueReceivables: scope.canSeeReceivables ? division.overdueReceivables : null,
        grossMarginPercent: scope.canSeeMargin ? division.grossMarginPercent : null,
        marginNote: scope.canSeeMargin ? (division.marginNote ?? null) : null,
      })),
      integrations: dataset.integrations.map((integration) => ({
        provider: integration.provider,
        displayName: integration.displayName,
        status: integration.status,
        isEnabled: integration.isEnabled,
        isStale: integration.isStale,
        syncIntervalMin: integration.syncIntervalMin,
        lastSuccessLabel: formatRelativeTime(integration.lastSuccessAt, now),
      })),
    }
  }),
)

// ---------------------------------------------------------------------------
// GET /api/pages/revenue
// ---------------------------------------------------------------------------

analyticsPagesRouter.get(
  '/revenue',
  handler(async (req): Promise<RevenuePageData> => {
    const context = await getPageContext(PERMISSIONS.REVENUE_VIEW, '/revenue', params(req), {
      defaultRange: 'last_30_days',
    })
    const { dataset, range, scope } = context

    const total = sumRevenue(dataset.invoices, range)
    const previous = sumRevenue(dataset.invoices, range.comparison)
    const invoiceCount = countRevenueInvoices(dataset.invoices, range)
    const averageInvoice = invoiceCount > 0 ? total / invoiceCount : null
    const change = percentChange(total, previous > 0 ? previous : null)

    const breakdownOptions = { range, comparison: range.comparison }
    const byDivision = revenueByDivision(dataset.invoices, breakdownOptions)
    const byCustomer = revenueByCustomer(dataset.invoices, breakdownOptions)
    const byRep = revenueBySalesRep(dataset.invoices, breakdownOptions)
    const byClassification = revenueByClassification(dataset.invoices, breakdownOptions)

    return {
      ...pageCommon(context),
      canSeeAllReps: scope.canSeeAllReps,
      canSeeCustomers: scope.canSeeCustomers,
      salesReps: dataset.salesReps,
      total,
      previous,
      invoiceCount,
      averageInvoice,
      change,
      customerCount: byCustomer.filter((r) => r.key !== '__other__').length,
      trend: revenueTrend(dataset.invoices, range, range.granularity, range.comparison),
      divisionTrend: revenueTrendByDivision(dataset.invoices, range, range.granularity, dataset.divisions),
      hasUnassigned: dataset.invoices.some((i) => !i.divisionId && i.revenueAmount > 0),
      byDivision,
      byClassification,
      byCustomer: scope.canSeeCustomers ? byCustomer : null,
      byRep,
      transactions: dataset.invoices
        .filter(
          (i) =>
            i.issuedOn >= range.start &&
            i.issuedOn <= range.end &&
            ['OPEN', 'PARTIALLY_PAID', 'PAID'].includes(i.status),
        )
        .map((i) => ({
          id: i.id,
          docNumber: i.docNumber,
          sourceId: i.sourceId,
          provider: i.provider,
          issuedOn: i.issuedOn.toISOString(),
          // The customer column is hidden for this role; do not ship the names either.
          customerName: scope.canSeeCustomers ? i.customerName : null,
          divisionName: i.divisionName,
          salesRepName: i.salesRepName,
          classification: i.customerClassification,
          revenueAmount: i.revenueAmount,
          total: i.total,
          balance: i.balance,
          status: i.status,
        })),
    }
  }),
)

// ---------------------------------------------------------------------------
// GET /api/pages/accounts-receivable
// ---------------------------------------------------------------------------

analyticsPagesRouter.get(
  '/accounts-receivable',
  handler(async (req): Promise<AccountsReceivablePageData> => {
    const searchParams = params(req)
    const context = await getPageContext(PERMISSIONS.RECEIVABLES_VIEW, '/accounts-receivable', searchParams, {
      defaultRange: 'last_30_days',
    })
    const { dataset, range, now } = context

    const summary = receivablesSummary(dataset.invoices, now)
    const revenueInPeriod = sumRevenue(dataset.invoices, range)
    const daysInPeriod = daysBetween(range.start, range.end) + 1
    const dso = daysSalesOutstanding(summary.totalOutstanding, revenueInPeriod, daysInPeriod)

    const initialFilter = readParam(searchParams, 'filter')
    const initialBucket = readParam(searchParams, 'bucket')

    return {
      ...pageCommon(context),
      summary: {
        totalOutstanding: summary.totalOutstanding,
        currentAmount: summary.currentAmount,
        overdueAmount: summary.overdueAmount,
        noDueDateAmount: summary.noDueDateAmount,
        invoiceCount: summary.invoiceCount,
        overdueInvoiceCount: summary.overdueInvoiceCount,
        noDueDateCount: summary.noDueDateCount,
        averageDaysOverdue: summary.averageDaysOverdue,
      },
      dso,
      buckets: agingBuckets(dataset.invoices, now),
      byDivision: receivablesByDivision(dataset.invoices, now),
      byCustomer: receivablesByCustomer(dataset.invoices, now, 10),
      initialFilter: initialFilter === 'overdue' ? 'overdue' : 'all',
      initialBucket: initialBucket ?? null,
      invoices: outstandingInvoices(dataset.invoices).map((i) => {
        const overdueDays = daysOverdue(i, now)
        return {
          id: i.id,
          docNumber: i.docNumber,
          sourceId: i.sourceId,
          provider: i.provider,
          customerName: i.customerName,
          divisionName: i.divisionName,
          salesRepName: i.salesRepName,
          issuedOn: i.issuedOn.toISOString(),
          dueOn: i.dueOn ? i.dueOn.toISOString() : null,
          daysOverdue: overdueDays,
          bucketKey: overdueDays === null ? 'no_due_date' : bucketFor(overdueDays),
          balance: i.balance,
          total: i.total,
          amountPaid: i.amountPaid,
          revenueAmount: i.revenueAmount,
          status: i.status,
          currency: i.currency,
        }
      }),
    }
  }),
)

// ---------------------------------------------------------------------------
// GET /api/pages/sales-pipeline
// ---------------------------------------------------------------------------

analyticsPagesRouter.get(
  '/sales-pipeline',
  handler(async (req): Promise<SalesPipelinePageData> => {
    const searchParams = params(req)
    const context = await getPageContext(PERMISSIONS.PIPELINE_VIEW, '/sales-pipeline', searchParams, {
      defaultRange: 'last_30_days',
    })
    const { dataset, range, scope, settings, now } = context

    const summary = pipelineSummary(dataset.quotes, now, {
      staleThresholdDays: settings.staleQuoteDays,
      largeQuoteAmount: settings.largeQuoteAmount,
    })
    const wins = winRate(dataset.quotes, range)
    const initialFilter = readParam(searchParams, 'filter')

    return {
      ...pageCommon(context),
      canSeeAllReps: scope.canSeeAllReps,
      salesReps: dataset.salesReps,
      staleQuoteDays: settings.staleQuoteDays,
      largeQuoteAmount: settings.largeQuoteAmount,
      summary: {
        openValue: summary.openValue,
        openCount: summary.openCount,
        averageQuoteValue: summary.averageQuoteValue,
        staleValue: summary.staleValue,
        staleCount: summary.staleCount,
        largeStaleCount: summary.largeStaleCount,
      },
      wins: { winRatePercent: wins.winRatePercent, wonCount: wins.wonCount, lostCount: wins.lostCount },
      byStage: quotesByStage(dataset.quotes),
      byRep: quotesBySalesRep(dataset.quotes),
      byDivision: quotesByDivision(dataset.quotes),
      aging: quoteAgingBuckets(dataset.quotes, now),
      initialFilter: initialFilter === 'stale' ? 'stale' : initialFilter === 'large' ? 'large' : 'all',
      quotes: dataset.quotes
        .filter((q) => q.status === 'OPEN')
        .map((q) => ({
          id: q.id,
          docNumber: q.docNumber,
          sourceId: q.sourceId,
          provider: q.provider,
          customerName: q.customerName,
          divisionName: q.divisionName,
          salesRepName: q.salesRepName,
          stage: q.stage,
          amount: q.amount,
          currency: q.currency,
          issuedOn: q.issuedOn.toISOString(),
          expiresOn: q.expiresOn ? q.expiresOn.toISOString() : null,
          lastActivityAt: q.lastActivityAt ? q.lastActivityAt.toISOString() : null,
          daysIdle: daysSinceActivity(q, now),
        })),
    }
  }),
)

// ---------------------------------------------------------------------------
// GET /api/pages/ecommerce
// ---------------------------------------------------------------------------

analyticsPagesRouter.get(
  '/ecommerce',
  handler(async (req): Promise<EcommercePageData> => {
    const context = await getPageContext(PERMISSIONS.ECOMMERCE_VIEW, '/ecommerce', params(req), {
      defaultRange: 'last_30_days',
    })
    const { dataset, range, now } = context

    const summary = ecommerceSummary(dataset.orders, range)
    const previous = ecommerceSummary(dataset.orders, range.comparison)
    const shopifyIntegration = dataset.integrations.find((i) => i.provider === 'SHOPIFY')

    return {
      mode: dataset.mode,
      range: pageRange(range),
      shopify: shopifyIntegration
        ? {
            displayName: shopifyIntegration.displayName,
            lastSuccessLabel: formatRelativeTime(shopifyIntegration.lastSuccessAt, now),
            isStale: shopifyIntegration.isStale,
          }
        : null,
      summary: {
        netSales: summary.netSales,
        grossSubtotal: summary.grossSubtotal,
        totalDiscounts: summary.totalDiscounts,
        totalRefunds: summary.totalRefunds,
        totalTax: summary.totalTax,
        totalShipping: summary.totalShipping,
        orderCount: summary.orderCount,
        averageOrderValue: summary.averageOrderValue,
        cancelledOrderCount: summary.cancelledOrderCount,
        refundedOrderCount: summary.refundedOrderCount,
      },
      salesChange: percentChange(summary.netSales, previous.netSales > 0 ? previous.netSales : null),
      trend: ecommerceTrend(dataset.orders, range, range.granularity, range.comparison),
      byFinancial: ordersByFinancialStatus(dataset.orders, range),
      byFulfillment: ordersByFulfillmentStatus(dataset.orders, range),
      linesAvailable: hasOrderLines(dataset.orders),
      topProducts: bestSellers(dataset.orders, range, 10),
      latest: recentOrders(billableOrders(dataset.orders, range), 10).map((order) => ({
        id: order.id,
        orderNumber: order.orderNumber,
        placedAt: order.placedAt.toISOString(),
        customerName: order.customerName,
        financialStatus: order.financialStatus,
        fulfillmentStatus: order.fulfillmentStatus,
        netSalesAmount: order.netSalesAmount,
        totalPrice: order.totalPrice,
      })),
    }
  }),
)

// ---------------------------------------------------------------------------
// GET /api/pages/gross-margin
// ---------------------------------------------------------------------------

function marginFigures(result: MarginResult): MarginFigures {
  return {
    availability: result.availability,
    revenue: result.revenue,
    cogs: result.cogs,
    grossProfit: result.grossProfit,
    grossMarginPercent: result.grossMarginPercent,
    reason: result.reason ?? null,
    missingCostMonths: result.missingCostMonths,
    costBasis: result.costBasis,
  }
}

analyticsPagesRouter.get(
  '/gross-margin',
  handler(async (req): Promise<GrossMarginPageData> => {
    const context = await getPageContext(PERMISSIONS.MARGIN_VIEW, '/gross-margin', params(req), {
      defaultRange: 'last_month',
    })
    const { dataset, range, scope } = context
    // Belt and braces: the permission check above already refuses, but a cost
    // figure must never leave the server for a role without margin access.
    assertMarginAccess(scope)

    const overall = marginFor(dataset.invoices, dataset.costs, range, null)
    const byDivision = marginByDivision(dataset.invoices, dataset.costs, range, dataset.divisions)
    // A margin trend over a one-month period would be a single dot. The trend
    // always covers the trailing 12 months, independently of the period filter,
    // and the card says so.
    const trendRange = {
      start: startOfMonth(addMonths(range.end, -11)),
      end: endOfMonth(range.end),
    }
    const trend = marginTrend(dataset.invoices, dataset.costs, trendRange, null)
    const common = pageCommon(context)

    return {
      mode: common.mode,
      range: common.range,
      lastRefreshLabel: common.lastRefreshLabel,
      isStale: common.isStale,
      availableDivisions: common.availableDivisions,
      overall: marginFigures(overall),
      trend: trend.map((t) => ({ label: t.label, marginPercent: t.marginPercent, revenue: t.revenue })),
      byDivision: byDivision.map((division) => ({
        divisionId: division.divisionId,
        divisionCode: division.divisionCode,
        divisionName: division.divisionName,
        ...marginFigures(division),
      })),
    }
  }),
)
