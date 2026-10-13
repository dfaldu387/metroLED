import type { MetricApprovalStatus } from '@prisma/client'

/**
 * Canonical metric definitions (Phase 1 scope, section 15).
 *
 * This file is the single source of truth for every formula the platform
 * reports. It is seeded into the `MetricDefinition` table, shown verbatim in
 * the metric tooltips, returned by the AI assistant as part of its source
 * attribution, and listed on the Settings > Metric definitions screen for
 * approval.
 *
 * APPROVAL: the financial definitions (revenue, gross margin, accounts
 * receivable, DSO) require Farida's sign-off before any figure derived from
 * them may be presented as verified. Until then they carry
 * `defaultApproval: 'PENDING_APPROVAL'` and the UI labels them accordingly.
 */

export interface MetricDefinitionSpec {
  key: string
  name: string
  shortDescription: string
  formula: string
  sourceSystems: string[]
  dateBasis: string
  includedRecords: string
  excludedRecords: string
  currencyHandling: string
  divisionMapping: string
  defaultApproval: MetricApprovalStatus
  /** Who has to approve this definition before it is reported as verified. */
  approver: string
  notes?: string
}

const CURRENCY_NOTE =
  'Reported in the company base currency. Amounts recorded in another currency are converted using the exchange rate stored on the source document; no live FX rate is applied after the fact.'

const DIVISION_NOTE =
  'Division comes from the mapping rules in Settings > Divisions. A record that matches no rule is reported as "Unassigned" and never silently attributed to a division.'

export const METRIC_DEFINITIONS: MetricDefinitionSpec[] = [
  {
    key: 'revenue',
    name: 'Revenue',
    shortDescription: 'Invoiced sales excluding tax, for invoices dated inside the reporting period.',
    formula: 'Revenue = SUM(invoice subtotal excluding tax) for invoices with an invoice date in the period',
    sourceSystems: ['QuickBooks Online'],
    dateBasis: 'Invoice date (not payment date and not the date the record was synchronised).',
    includedRecords:
      'Invoices with status Open, Partially paid or Paid. An invoice counts as revenue when it is issued, regardless of whether it has been paid.',
    excludedRecords:
      'Draft invoices, voided invoices, written-off invoices, sales tax, and Shopify orders (those are reported separately as Shopify sales until they are invoiced in QuickBooks).',
    currencyHandling: CURRENCY_NOTE,
    divisionMapping: DIVISION_NOTE,
    defaultApproval: 'PENDING_APPROVAL',
    approver: 'Farida (Finance)',
    notes:
      'Accrual basis. If the client requires cash-basis revenue instead, this definition and every figure derived from it must change together.',
  },
  {
    key: 'cogs',
    name: 'Cost of Goods Sold',
    shortDescription: 'Direct costs attributed to a division for the period.',
    formula:
      'COGS = SUM(amounts posted to the QuickBooks accounts flagged as direct cost in Settings > Cost mappings) for the period',
    sourceSystems: ['QuickBooks Online'],
    dateBasis: 'Transaction date of the posting.',
    includedRecords: 'Only accounts explicitly flagged "Include in cost of goods sold" and approved by Finance.',
    excludedRecords:
      'All operating expenses - rent, salaries not directly attributable to production, marketing, software, professional fees and general overhead. Operating expenses are never treated as direct costs.',
    currencyHandling: CURRENCY_NOTE,
    divisionMapping: DIVISION_NOTE,
    defaultApproval: 'PENDING_APPROVAL',
    approver: 'Farida (Finance)',
    notes:
      'Each monthly figure must be marked approved in the Cost of goods sold table before gross margin is reported for that month. Unapproved months show as unavailable.',
  },
  {
    key: 'gross_profit',
    name: 'Gross Profit',
    shortDescription: 'Revenue less cost of goods sold.',
    formula: 'Gross Profit = Revenue − Cost of Goods Sold',
    sourceSystems: ['QuickBooks Online'],
    dateBasis: 'Invoice date for revenue; transaction date for cost.',
    includedRecords: 'As per the Revenue and Cost of Goods Sold definitions.',
    excludedRecords: 'As per the Revenue and Cost of Goods Sold definitions.',
    currencyHandling: CURRENCY_NOTE,
    divisionMapping: DIVISION_NOTE,
    defaultApproval: 'PENDING_APPROVAL',
    approver: 'Farida (Finance)',
    notes: 'Reported by division only in Phase 1. Profit per project is explicitly out of scope.',
  },
  {
    key: 'gross_margin_pct',
    name: 'Gross Margin %',
    shortDescription: 'Gross profit as a percentage of revenue.',
    formula: 'Gross Margin % = (Gross Profit ÷ Revenue) × 100',
    sourceSystems: ['QuickBooks Online'],
    dateBasis: 'Invoice date for revenue; transaction date for cost.',
    includedRecords: 'Periods where both revenue and an approved cost figure exist.',
    excludedRecords:
      'Periods with no revenue (the percentage is undefined and shown as unavailable rather than 0%), and periods whose cost figure has not been approved.',
    currencyHandling: CURRENCY_NOTE,
    divisionMapping: DIVISION_NOTE,
    defaultApproval: 'PENDING_APPROVAL',
    approver: 'Farida (Finance)',
  },
  {
    key: 'accounts_receivable',
    name: 'Accounts Receivable (Outstanding)',
    shortDescription: 'Money invoiced and not yet collected, as at today.',
    formula: 'Outstanding A/R = SUM(invoice balance) for invoices with a balance greater than zero',
    sourceSystems: ['QuickBooks Online'],
    dateBasis: 'Point in time (as at now). Not a period total.',
    includedRecords: 'Invoices with status Open or Partially paid and a remaining balance above zero.',
    excludedRecords: 'Paid, draft, voided and written-off invoices.',
    currencyHandling: CURRENCY_NOTE,
    divisionMapping: DIVISION_NOTE,
    defaultApproval: 'PENDING_APPROVAL',
    approver: 'Farida (Finance)',
    notes: 'Balance comes from QuickBooks rather than being recalculated, so partial payments are always reflected.',
  },
  {
    key: 'accounts_receivable_overdue',
    name: 'Overdue Receivables',
    shortDescription: 'Outstanding invoices whose due date has passed.',
    formula: 'Overdue A/R = SUM(invoice balance) where due date < today AND balance > 0',
    sourceSystems: ['QuickBooks Online'],
    dateBasis: 'Due date compared against today in the company timezone.',
    includedRecords: 'Outstanding invoices with a due date strictly before today.',
    excludedRecords: 'Invoices with no due date recorded - these are reported separately as "No due date recorded".',
    currencyHandling: CURRENCY_NOTE,
    divisionMapping: DIVISION_NOTE,
    defaultApproval: 'PENDING_APPROVAL',
    approver: 'Farida (Finance)',
  },
  {
    key: 'ar_aging_buckets',
    name: 'A/R Aging Buckets',
    shortDescription: 'Outstanding balance grouped by how long it has been overdue.',
    formula:
      'Days overdue = today − due date. Buckets: Current (not yet due), 1–30, 31–60, 61–90, more than 90 days overdue.',
    sourceSystems: ['QuickBooks Online'],
    dateBasis: 'Due date compared against today in the company timezone.',
    includedRecords: 'All outstanding invoices.',
    excludedRecords: 'Invoices with no due date, grouped separately.',
    currencyHandling: CURRENCY_NOTE,
    divisionMapping: DIVISION_NOTE,
    defaultApproval: 'PENDING_APPROVAL',
    approver: 'Farida (Finance)',
    notes: 'Bucket boundaries are configurable in Settings and the configured values are shown on the A/R page.',
  },
  {
    key: 'dso',
    name: 'Days Sales Outstanding (DSO)',
    shortDescription: 'Average number of days it takes to collect invoiced revenue.',
    formula: 'DSO = (Outstanding A/R ÷ Revenue for the period) × number of days in the period',
    sourceSystems: ['QuickBooks Online'],
    dateBasis: 'Outstanding A/R as at the period end; revenue by invoice date within the period.',
    includedRecords: 'As per the Revenue and Accounts Receivable definitions.',
    excludedRecords: 'Periods with no revenue, where DSO is undefined and reported as unavailable.',
    currencyHandling: CURRENCY_NOTE,
    divisionMapping: DIVISION_NOTE,
    defaultApproval: 'PENDING_APPROVAL',
    approver: 'Farida (Finance)',
    notes:
      'This is the simple (non-countback) DSO formula. Confirm with Finance whether the countback method is required before this metric is reported as verified.',
  },
  {
    key: 'pipeline_value',
    name: 'Open Pipeline Value',
    shortDescription: 'Total value of quotes that are still open.',
    formula: 'Open pipeline = SUM(quote amount) for quotes with status Open',
    sourceSystems: ['Method CRM'],
    dateBasis: 'Point in time (as at now), filtered by quote date when a period is applied.',
    includedRecords: 'Quotes whose Method CRM stage maps to an open stage.',
    excludedRecords: 'Won, lost, expired and cancelled quotes.',
    currencyHandling: CURRENCY_NOTE,
    divisionMapping: DIVISION_NOTE,
    defaultApproval: 'PENDING_APPROVAL',
    approver: 'Ali Jooma (Owner)',
    notes:
      'This is an unweighted total. Probability-weighted pipeline is NOT reported: Method CRM does not supply a probability per stage and no weighting formula has been approved. Do not infer one.',
  },
  {
    key: 'quote_aging',
    name: 'Quote Aging / Stale Quotes',
    shortDescription: 'How long an open quote has gone without activity.',
    formula:
      'Days since last activity = today − (last activity date, or the quote date when no activity is recorded). A quote is stale when that exceeds the configured threshold.',
    sourceSystems: ['Method CRM'],
    dateBasis: 'Last activity date on the quote.',
    includedRecords: 'Open quotes only.',
    excludedRecords: 'Closed quotes of any kind.',
    currencyHandling: CURRENCY_NOTE,
    divisionMapping: DIVISION_NOTE,
    defaultApproval: 'PENDING_APPROVAL',
    approver: 'Ali Jooma (Owner)',
    notes: 'The stale threshold and the "large quote" amount are configurable in Settings.',
  },
  {
    key: 'win_rate',
    name: 'Win Rate',
    shortDescription: 'Share of decided quotes that were won.',
    formula: 'Win rate = Won quotes ÷ (Won quotes + Lost quotes) × 100, counted by quotes closed in the period',
    sourceSystems: ['Method CRM'],
    dateBasis: 'Quote close date.',
    includedRecords: 'Quotes closed in the period with an outcome of Won or Lost.',
    excludedRecords:
      'Open quotes, expired quotes and cancelled quotes, because none of these represent a decision made by the customer. Periods with no decided quotes report as unavailable, not 0%.',
    currencyHandling: 'Not applicable - a count-based ratio.',
    divisionMapping: DIVISION_NOTE,
    defaultApproval: 'PENDING_APPROVAL',
    approver: 'Ali Jooma (Owner)',
    notes:
      'Counted by number of quotes. Confirm whether the client wants win rate by value instead; the two can differ substantially.',
  },
  {
    key: 'shopify_sales',
    name: 'Shopify Sales (Eco LED Mart)',
    shortDescription: 'Net merchandise sales from the Shopify store.',
    formula:
      'Shopify net sales = SUM(order subtotal after discounts) − SUM(refunds). Tax and shipping are excluded.',
    sourceSystems: ['Shopify Admin API'],
    dateBasis: 'Order placed date, converted to the company timezone.',
    includedRecords: 'Orders that are not cancelled.',
    excludedRecords:
      'Cancelled orders, sales tax, shipping charges, and gift card sales. Refunds are deducted in the period the order was placed, not the period the refund was issued.',
    currencyHandling: CURRENCY_NOTE,
    divisionMapping: 'All Shopify orders belong to the Eco LED Mart division.',
    defaultApproval: 'PENDING_APPROVAL',
    approver: 'Sabir (E-commerce) and Farida (Finance)',
    notes:
      'This is an OPERATIONAL sales figure from the store, not accounting revenue. It will not equal QuickBooks revenue for the same period, because of timing differences and because not every order has been invoiced. The two are shown separately and never added together.',
  },
  {
    key: 'average_order_value',
    name: 'Average Order Value',
    shortDescription: 'Average net sales per Shopify order.',
    formula: 'AOV = Shopify net sales ÷ number of orders',
    sourceSystems: ['Shopify Admin API'],
    dateBasis: 'Order placed date.',
    includedRecords: 'Non-cancelled orders in the period.',
    excludedRecords: 'Cancelled orders. Periods with no orders report as unavailable, not $0.',
    currencyHandling: CURRENCY_NOTE,
    divisionMapping: 'Eco LED Mart only.',
    defaultApproval: 'PENDING_APPROVAL',
    approver: 'Sabir (E-commerce)',
  },
]

export function getMetricDefinition(key: string): MetricDefinitionSpec | undefined {
  return METRIC_DEFINITIONS.find((d) => d.key === key)
}

/** Short tooltip text: the plain-language description plus the date basis. */
export function metricTooltip(key: string): string {
  const def = getMetricDefinition(key)
  if (!def) return ''
  return `${def.shortDescription}\n\nFormula: ${def.formula}\n\nDate basis: ${def.dateBasis}\n\nSource: ${def.sourceSystems.join(', ')}`
}

export const AR_AGING_BUCKETS = [
  { key: 'current', label: 'Current', minDays: null, maxDays: 0 },
  { key: '1_30', label: '1–30 days overdue', minDays: 1, maxDays: 30 },
  { key: '31_60', label: '31–60 days overdue', minDays: 31, maxDays: 60 },
  { key: '61_90', label: '61–90 days overdue', minDays: 61, maxDays: 90 },
  { key: 'over_90', label: 'More than 90 days overdue', minDays: 91, maxDays: null },
] as const

export type ArBucketKey = (typeof AR_AGING_BUCKETS)[number]['key']
