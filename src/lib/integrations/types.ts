import type { IntegrationProvider } from '@prisma/client'
import type { RequestCounter } from './http'

/**
 * The adapter contract.
 *
 * Each provider implements this. The sync service knows nothing about
 * QuickBooks, Method or Shopify specifics - it only knows how to run an
 * adapter, record the outcome, and move the checkpoint forward.
 *
 * A deliberate rule from section 14: the adapters do NOT assume the three APIs
 * expose the same fields or the same business semantics. Each one maps its own
 * payload into the normalised shapes below, and anything it cannot map is
 * reported rather than guessed.
 */

export interface SyncContext {
  integrationId: string
  provider: IntegrationProvider
  /** Only records changed at or after this point need to be fetched. */
  since: Date | null
  /** Resume token from the last interrupted run, if any. */
  cursor: string | null
  /** Upper bound of the window being synced. */
  until: Date
  counter: RequestCounter
  signal?: AbortSignal
  log: (message: string) => void
  onRetry: (info: { attempt: number; delayMs: number; reason: string }) => void
}

export interface NormalizedCustomer {
  sourceId: string
  name: string
  email: string | null
  phone: string | null
  city: string | null
  region: string | null
  country: string | null
  /** Provider's own classification hint, when it has one. */
  classificationHint: 'DIRECT' | 'DISTRIBUTOR' | null
  raw: Record<string, unknown>
}

export interface NormalizedInvoiceLine {
  sourceLineId: string | null
  lineNumber: number
  description: string | null
  itemSourceId: string | null
  itemName: string | null
  quantity: number
  unitPrice: number
  amount: number
}

export interface NormalizedInvoice {
  sourceId: string
  docNumber: string
  customerSourceId: string | null
  customerName: string | null
  salesRepSourceId: string | null
  salesRepName: string | null
  status: 'DRAFT' | 'OPEN' | 'PARTIALLY_PAID' | 'PAID' | 'VOID' | 'WRITTEN_OFF'
  issuedOn: Date
  dueOn: Date | null
  currency: string
  exchangeRate: number
  subtotal: number
  taxTotal: number
  total: number
  amountPaid: number
  balance: number
  /** Revenue basis: subtotal excluding tax, in base currency. */
  revenueAmount: number
  memo: string | null
  sourceCreatedAt: Date | null
  sourceUpdatedAt: Date | null
  lines: NormalizedInvoiceLine[]
  /** Fields used by the division mapping rules. */
  mappingFields: Record<string, string | null>
}

export interface NormalizedPayment {
  sourceId: string
  customerSourceId: string | null
  receivedOn: Date
  currency: string
  amount: number
  method: string | null
  reference: string | null
  sourceUpdatedAt: Date | null
  /** Invoice source ids this payment was applied to, with amounts. */
  applications: { invoiceSourceId: string; amount: number }[]
}

export interface NormalizedQuote {
  sourceId: string
  docNumber: string
  customerSourceId: string | null
  customerName: string | null
  salesRepSourceId: string | null
  salesRepName: string | null
  status: 'OPEN' | 'WON' | 'LOST' | 'EXPIRED' | 'CANCELLED'
  stage: string
  stageNormalized: string
  currency: string
  amount: number
  issuedOn: Date
  expiresOn: Date | null
  closedOn: Date | null
  lastActivityAt: Date | null
  sourceCreatedAt: Date | null
  sourceUpdatedAt: Date | null
  lines: NormalizedInvoiceLine[]
  mappingFields: Record<string, string | null>
}

export interface NormalizedOrderLine {
  sourceLineId: string
  lineNumber: number
  productSourceId: string | null
  variantSourceId: string | null
  sku: string | null
  title: string
  quantity: number
  unitPrice: number
  discount: number
  amount: number
}

export interface NormalizedOrder {
  sourceId: string
  orderNumber: string
  customerSourceId: string | null
  customerName: string | null
  email: string | null
  financialStatus:
    | 'PENDING'
    | 'AUTHORIZED'
    | 'PARTIALLY_PAID'
    | 'PAID'
    | 'PARTIALLY_REFUNDED'
    | 'REFUNDED'
    | 'VOIDED'
    | 'UNKNOWN'
  fulfillmentStatus: 'UNFULFILLED' | 'PARTIAL' | 'FULFILLED' | 'RESTOCKED' | 'UNKNOWN'
  currency: string
  subtotalPrice: number
  totalDiscounts: number
  totalTax: number
  totalShipping: number
  totalRefunded: number
  totalPrice: number
  netSalesAmount: number
  placedAt: Date
  cancelledAt: Date | null
  closedAt: Date | null
  sourceUpdatedAt: Date | null
  lines: NormalizedOrderLine[]
}

/** One page of results plus the cursor needed to resume after it. */
export interface Page<T> {
  items: T[]
  /** Opaque resume token. `null` means there are no more pages. */
  nextCursor: string | null
}

export type SyncEntity =
  | 'customers'
  | 'invoices'
  | 'payments'
  | 'quotes'
  | 'orders'
  | 'accounts'
  | 'cogs'

export interface ProviderAdapter {
  provider: IntegrationProvider
  displayName: string
  /** Entities this provider contributes, in the order they must be synced. */
  entities: SyncEntity[]
  /** Minimum milliseconds between requests, to stay inside the rate limit. */
  minRequestIntervalMs: number

  /** Verifies credentials without importing anything. */
  testConnection(context: SyncContext): Promise<{ ok: boolean; detail: string }>

  fetchCustomers?(context: SyncContext): Promise<Page<NormalizedCustomer>>
  fetchInvoices?(context: SyncContext): Promise<Page<NormalizedInvoice>>
  fetchPayments?(context: SyncContext): Promise<Page<NormalizedPayment>>
  fetchQuotes?(context: SyncContext): Promise<Page<NormalizedQuote>>
  fetchOrders?(context: SyncContext): Promise<Page<NormalizedOrder>>
  /** Monthly direct-cost totals per account, for the gross margin basis. */
  fetchCogs?(context: SyncContext): Promise<
    Page<{
      periodStart: Date
      periodEnd: Date
      accountSourceId: string
      accountName: string
      accountType: string | null
      amount: number
    }>
  >
}

export interface EntityResult {
  entity: SyncEntity
  read: number
  created: number
  updated: number
  skipped: number
  failed: number
  errors: { sourceId: string | null; message: string; retryable: boolean; code?: string }[]
  nextCursor: string | null
  lastRecordAt: Date | null
}
