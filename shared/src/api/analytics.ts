import type { RangePreset } from '../dates'
import type {
  AttentionItem,
  BreakdownRow,
  DataMode,
  DivisionRef,
  IntegrationHealth,
  MetricValue,
  TimeSeriesPoint,
} from '../types'

/**
 * View models for the six analytics dashboards (GET /api/pages/<route>).
 *
 * Each one carries exactly what the former server-rendered page consumed.
 * Authorisation and scoping happen on the server: a figure the role may not
 * see is never included (it is `null`, or the field is absent).
 *
 * Dates are ISO strings. Relative times ("3 hours ago") are pre-formatted on
 * the server against the same `now` the figures were computed with.
 */

/** The resolved reporting period, as the page displays it. */
export interface PageRange {
  preset: RangePreset
  label: string
  comparisonLabel: string
  /** `comparisonLabel(range)` from page-context, e.g. "vs. previous 30 days". */
  comparisonText: string
  start: string
  end: string
}

/** Header/notice facts every analytics page shows. */
export interface PageCommon {
  mode: DataMode
  range: PageRange
  /** `formatRelativeTime(dataset.freshness.lastRefreshAt, now)`. */
  lastRefreshLabel: string
  isStale: boolean
  /** Sources for the StaleDataNotice (only filled when `isStale`). */
  staleSources: { name: string; lastSuccessLabel: string }[]
  /** Divisions the filter rail offers (the user's own access, never the UI selection). */
  availableDivisions: DivisionRef[]
  scopeNote: string | null
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

export interface OverviewDivisionCard {
  divisionId: string
  code: string
  name: string
  revenue: number
  revenueDeltaPercent: number | null
  invoiceCount: number
  /** null when the role cannot see the pipeline. */
  openPipeline: number | null
  /** null when the role cannot see receivables. */
  overdueReceivables: number | null
  /** null when the role cannot see margin or no approved cost exists. */
  grossMarginPercent: number | null
  marginNote: string | null
}

export interface OverviewIntegration {
  provider: IntegrationHealth['provider']
  displayName: string
  status: IntegrationHealth['status']
  isEnabled: boolean
  isStale: boolean
  syncIntervalMin: number
  lastSuccessLabel: string
}

export interface OverviewPageData extends PageCommon {
  greeting: string
  firstName: string
  can: {
    revenue: boolean
    pipeline: boolean
    receivables: boolean
    margin: boolean
  }
  kpis: MetricValue[]
  attention: AttentionItem[]
  /** Revenue charts; null when the role cannot see revenue. */
  revenue: {
    trend: TimeSeriesPoint[]
    divisionTrend: TimeSeriesPoint[]
    divisions: DivisionRef[]
    hasUnassigned: boolean
  } | null
  divisionPerformance: OverviewDivisionCard[]
  integrations: OverviewIntegration[]
}

// ---------------------------------------------------------------------------
// Revenue
// ---------------------------------------------------------------------------

export interface RevenueTransactionRow {
  id: string
  docNumber: string
  sourceId: string
  provider: string
  issuedOn: string
  /** Always null when the role cannot see customers. */
  customerName: string | null
  divisionName: string | null
  salesRepName: string | null
  classification: string
  revenueAmount: number
  total: number
  balance: number
  status: string
}

export interface RevenuePageData extends PageCommon {
  canSeeAllReps: boolean
  canSeeCustomers: boolean
  salesReps: { id: string; name: string }[]
  total: number
  previous: number
  invoiceCount: number
  averageInvoice: number | null
  change: number | null
  /** Distinct customers in the period (the "Across N customers" note). */
  customerCount: number
  trend: TimeSeriesPoint[]
  divisionTrend: TimeSeriesPoint[]
  hasUnassigned: boolean
  byDivision: BreakdownRow[]
  byClassification: BreakdownRow[]
  /** null when the role cannot see revenue by customer. */
  byCustomer: BreakdownRow[] | null
  byRep: BreakdownRow[]
  transactions: RevenueTransactionRow[]
}

// ---------------------------------------------------------------------------
// Accounts receivable
// ---------------------------------------------------------------------------

export interface ArInvoiceRow {
  id: string
  docNumber: string
  sourceId: string
  provider: string
  customerName: string | null
  divisionName: string | null
  salesRepName: string | null
  issuedOn: string
  dueOn: string | null
  daysOverdue: number | null
  /** Aging bucket key (`bucketFor(daysOverdue)`, or 'no_due_date'). */
  bucketKey: string
  balance: number
  total: number
  amountPaid: number
  revenueAmount: number
  status: string
  currency: string
}

export interface AccountsReceivablePageData extends PageCommon {
  summary: {
    totalOutstanding: number
    currentAmount: number
    overdueAmount: number
    noDueDateAmount: number
    invoiceCount: number
    overdueInvoiceCount: number
    noDueDateCount: number
    averageDaysOverdue: number | null
  }
  dso: number | null
  buckets: { key: string; label: string; amount: number; invoiceCount: number; share: number }[]
  byDivision: BreakdownRow[]
  byCustomer: BreakdownRow[]
  initialFilter: 'all' | 'overdue'
  initialBucket: string | null
  invoices: ArInvoiceRow[]
}

// ---------------------------------------------------------------------------
// Sales pipeline
// ---------------------------------------------------------------------------

export interface QuoteRow {
  id: string
  docNumber: string
  sourceId: string
  provider: string
  customerName: string | null
  divisionName: string | null
  salesRepName: string | null
  stage: string
  amount: number
  currency: string
  issuedOn: string
  expiresOn: string | null
  lastActivityAt: string | null
  daysIdle: number
}

export interface SalesPipelinePageData extends PageCommon {
  canSeeAllReps: boolean
  salesReps: { id: string; name: string }[]
  staleQuoteDays: number
  largeQuoteAmount: number
  summary: {
    openValue: number
    openCount: number
    averageQuoteValue: number | null
    staleValue: number
    staleCount: number
    largeStaleCount: number
  }
  wins: { winRatePercent: number | null; wonCount: number; lostCount: number }
  byStage: BreakdownRow[]
  byRep: BreakdownRow[]
  byDivision: BreakdownRow[]
  aging: BreakdownRow[]
  initialFilter: 'all' | 'stale' | 'large'
  quotes: QuoteRow[]
}

// ---------------------------------------------------------------------------
// E-commerce
// ---------------------------------------------------------------------------

export interface EcommerceOrderRow {
  id: string
  orderNumber: string
  placedAt: string
  customerName: string | null
  financialStatus: string
  fulfillmentStatus: string
  netSalesAmount: number
  totalPrice: number
}

export interface EcommercePageData {
  mode: DataMode
  range: PageRange
  shopify: { displayName: string; lastSuccessLabel: string; isStale: boolean } | null
  summary: {
    netSales: number
    grossSubtotal: number
    totalDiscounts: number
    totalRefunds: number
    totalTax: number
    totalShipping: number
    orderCount: number
    averageOrderValue: number | null
    cancelledOrderCount: number
    refundedOrderCount: number
  }
  salesChange: number | null
  trend: TimeSeriesPoint[]
  byFinancial: BreakdownRow[]
  byFulfillment: BreakdownRow[]
  linesAvailable: boolean
  topProducts: { key: string; title: string; sku: string | null; unitsSold: number; netSales: number }[]
  latest: EcommerceOrderRow[]
}

// ---------------------------------------------------------------------------
// Gross margin
// ---------------------------------------------------------------------------

export interface MarginFigures {
  availability: 'available' | 'unavailable'
  revenue: number
  cogs: number | null
  grossProfit: number | null
  grossMarginPercent: number | null
  reason: string | null
  missingCostMonths: string[]
  costBasis: string | null
}

export interface GrossMarginPageData {
  mode: DataMode
  range: PageRange
  lastRefreshLabel: string
  isStale: boolean
  availableDivisions: DivisionRef[]
  overall: MarginFigures
  trend: { label: string; marginPercent: number | null; revenue: number }[]
  byDivision: (MarginFigures & { divisionId: string; divisionCode: string; divisionName: string })[]
}
