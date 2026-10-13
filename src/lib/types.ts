import type {
  CustomerClassification,
  IntegrationProvider,
  IntegrationStatus,
  InvoiceStatus,
  QuoteStatus,
  ShopifyFinancialStatus,
  ShopifyFulfillmentStatus,
  SyncStatus,
  SyncTrigger,
} from '@prisma/client'

/**
 * Plain record shapes used by the analytics layer.
 *
 * Both the live database and the labelled demo dataset are projected into
 * these types, and every figure on every page is computed from them by the
 * pure functions in `src/lib/analytics`. One implementation means the demo
 * interface and the production interface cannot drift apart, and it makes the
 * financial calculations directly unit-testable.
 */

/** Where a reported number came from. Rendered by the "View source" controls. */
export interface SourceRef {
  provider: IntegrationProvider | 'INTERNAL'
  /** Human label, e.g. "QuickBooks Online - Invoice 10432". */
  label: string
  /** Original identifier in the source system. */
  sourceId?: string
  docNumber?: string
}

export interface DivisionRef {
  id: string
  code: string
  name: string
  sortOrder: number
}

export interface InvoiceRecord {
  id: string
  sourceId: string
  docNumber: string
  provider: IntegrationProvider
  status: InvoiceStatus
  issuedOn: Date
  dueOn: Date | null
  divisionId: string | null
  divisionCode: string | null
  divisionName: string | null
  customerId: string | null
  customerName: string | null
  customerClassification: CustomerClassification
  salesRepId: string | null
  salesRepName: string | null
  currency: string
  /** Subtotal excluding tax, in base currency. The revenue basis. */
  revenueAmount: number
  total: number
  amountPaid: number
  balance: number
  /** Direct cost attributed to this invoice, when available. */
  costAmount: number | null
  syncedAt: Date
}

export interface QuoteRecord {
  id: string
  sourceId: string
  docNumber: string
  provider: IntegrationProvider
  status: QuoteStatus
  stage: string
  stageNormalized: string
  issuedOn: Date
  expiresOn: Date | null
  closedOn: Date | null
  lastActivityAt: Date | null
  divisionId: string | null
  divisionCode: string | null
  divisionName: string | null
  customerId: string | null
  customerName: string | null
  salesRepId: string | null
  salesRepName: string | null
  currency: string
  amount: number
  syncedAt: Date
}

export interface OrderRecord {
  id: string
  sourceId: string
  orderNumber: string
  provider: IntegrationProvider
  financialStatus: ShopifyFinancialStatus
  fulfillmentStatus: ShopifyFulfillmentStatus
  placedAt: Date
  cancelledAt: Date | null
  divisionId: string | null
  divisionCode: string | null
  customerName: string | null
  email: string | null
  currency: string
  subtotalPrice: number
  totalDiscounts: number
  totalTax: number
  totalShipping: number
  totalRefunded: number
  totalPrice: number
  /** Subtotal after discounts, less refunds; excludes tax and shipping. */
  netSalesAmount: number
  lines: OrderLineRecord[]
  syncedAt: Date
}

export interface OrderLineRecord {
  sku: string | null
  title: string
  quantity: number
  amount: number
  productSourceId: string | null
}

export interface CostRecord {
  divisionId: string
  periodStart: Date
  periodEnd: Date
  cogsAmount: number
  isApproved: boolean
  basis: string
}

export interface IntegrationHealth {
  provider: IntegrationProvider
  displayName: string
  status: IntegrationStatus
  isEnabled: boolean
  isConfigured: boolean
  lastSuccessAt: Date | null
  lastAttemptAt: Date | null
  lastErrorAt: Date | null
  lastErrorMessage: string | null
  consecutiveFailures: number
  syncIntervalMin: number
  /** True when `lastSuccessAt` is older than the configured staleness window. */
  isStale: boolean
  minutesSinceSuccess: number | null
}

export interface SyncRunSummary {
  id: string
  provider: IntegrationProvider
  entity: string
  trigger: SyncTrigger
  status: SyncStatus
  startedAt: Date
  finishedAt: Date | null
  durationMs: number | null
  recordsRead: number
  recordsCreated: number
  recordsUpdated: number
  recordsFailed: number
  errorSummary: string | null
}

// ---------------------------------------------------------------------------
// Data mode and freshness
// ---------------------------------------------------------------------------

/**
 * How the figures on screen were produced.
 *  - `live`        real records from the unified database
 *  - `demo`        the labelled demo dataset; never presented as live
 *  - `unavailable` the database is reachable but holds no records for the
 *                  requested scope, or a required source is not connected
 */
export type DataMode = 'live' | 'demo' | 'unavailable'

export interface DataFreshness {
  mode: DataMode
  /** Most recent successful sync across the sources feeding this view. */
  lastRefreshAt: Date | null
  /** True when any contributing source is past its staleness window. */
  isStale: boolean
  staleSources: string[]
  /** Sources that are not connected at all, so their figures are missing. */
  missingSources: string[]
}

/** Every analytics result carries the provenance of the numbers inside it. */
export interface Provenance {
  freshness: DataFreshness
  sources: SourceRef[]
  /** Reasons a figure is partial, e.g. "Cost of goods sold not yet approved". */
  caveats: string[]
}

export interface Dataset {
  mode: DataMode
  divisions: DivisionRef[]
  invoices: InvoiceRecord[]
  quotes: QuoteRecord[]
  orders: OrderRecord[]
  costs: CostRecord[]
  integrations: IntegrationHealth[]
  salesReps: { id: string; name: string }[]
  freshness: DataFreshness
  /** Window the records were loaded for. Figures outside it are not available. */
  loadedRange: { start: Date; end: Date }
}

// ---------------------------------------------------------------------------
// Presentation primitives
// ---------------------------------------------------------------------------

export type MetricAvailability = 'available' | 'partial' | 'unavailable' | 'restricted'

export interface MetricValue {
  key: string
  label: string
  availability: MetricAvailability
  value: number | null
  /** Same metric for the comparison period, when one could be computed. */
  previousValue: number | null
  deltaAbsolute: number | null
  deltaPercent: number | null
  /** Whether an increase is good. Drives the green/red treatment. */
  higherIsBetter: boolean
  format: 'currency' | 'percent' | 'number' | 'integer'
  /** Plain-language definition shown in the metric tooltip. */
  definition: string
  /** Where the number came from. */
  sourceSummary: string
  /** Why the value is partial or unavailable. */
  note?: string
  href?: string
}

export interface TimeSeriesPoint {
  /** ISO date of the bucket start. */
  date: string
  label: string
  value: number
  comparisonValue?: number | null
  [series: string]: string | number | null | undefined
}

export interface BreakdownRow {
  key: string
  label: string
  value: number
  share: number
  /** Set on division breakdowns so the fixed identity hue can be applied. */
  divisionCode?: string | null
  previousValue?: number | null
  deltaPercent?: number | null
  secondaryValue?: number | null
  secondaryLabel?: string
}

export type AttentionSeverity = 'urgent' | 'warning' | 'info'

export interface AttentionItem {
  id: string
  severity: AttentionSeverity
  title: string
  detail: string
  /** The number that makes this item matter, already formatted. */
  amountLabel?: string
  actionLabel: string
  href: string
  source?: SourceRef
}

export type Granularity = 'day' | 'week' | 'month'
