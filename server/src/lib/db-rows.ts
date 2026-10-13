/**
 * Row shapes of every table, as returned by `pg` (see lib/db.ts).
 *
 * Generated from the former prisma/schema.prisma. NUMERIC columns are strings
 * (convert with `toNumber`), TIMESTAMP and DATE columns are Date objects, and
 * JSONB columns are already-parsed values.
 */
import type * as E from "@shared/enums"

export interface UserRow {
  id: string
  email: string
  name: string
  passwordHash: string
  isActive: boolean
  mustChangePassword: boolean
  lastLoginAt: Date | null
  failedLoginCount: number
  lockedUntil: Date | null
  timezone: string
  createdAt: Date
  updatedAt: Date
  salesRepId: string | null
}

export interface RoleRow {
  id: string
  name: E.RoleName
  label: string
  description: string
  createdAt: Date
}

export interface UserRoleRow {
  userId: string
  roleId: string
  assignedAt: Date
  assignedBy: string | null
}

export interface RolePermissionRow {
  roleId: string
  permission: string
}

export interface UserDivisionRow {
  userId: string
  divisionId: string
}

export interface SessionRow {
  id: string
  userId: string
  tokenHash: string
  expiresAt: Date
  createdAt: Date
  lastSeenAt: Date
  ipAddress: string | null
  userAgent: string | null
  revokedAt: Date | null
}

export interface AuditLogRow {
  id: string
  userId: string | null
  actorEmail: string | null
  action: string
  entityType: string | null
  entityId: string | null
  summary: string
  metadata: unknown | null
  ipAddress: string | null
  createdAt: Date
}

export interface CompanySettingRow {
  id: string
  legalName: string
  displayName: string
  timezone: string
  currency: string
  fiscalYearStartMo: number
  briefSendHour: number
  briefSendMinute: number
  briefEnabled: boolean
  staleDataHours: number
  staleQuoteDays: number
  largeQuoteAmount: string
  updatedAt: Date
  updatedBy: string | null
}

export interface DivisionRow {
  id: string
  code: string
  name: string
  description: string | null
  sortOrder: number
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}

export interface DivisionMappingRuleRow {
  id: string
  provider: E.IntegrationProvider
  field: string
  matchType: string
  matchValue: string
  divisionId: string
  priority: number
  isActive: boolean
  note: string | null
  createdAt: Date
  updatedAt: Date
  createdBy: string | null
}

export interface IntegrationRow {
  id: string
  provider: E.IntegrationProvider
  displayName: string
  status: E.IntegrationStatus
  isEnabled: boolean
  config: unknown | null
  credentials: unknown | null
  tokenExpiresAt: Date | null
  lastSuccessAt: Date | null
  lastAttemptAt: Date | null
  lastErrorAt: Date | null
  lastErrorMessage: string | null
  consecutiveFailures: number
  syncIntervalMin: number
  historyMonths: number
  createdAt: Date
  updatedAt: Date
}

export interface SyncRunRow {
  id: string
  integrationId: string
  entity: string
  trigger: E.SyncTrigger
  status: E.SyncStatus
  startedAt: Date
  finishedAt: Date | null
  durationMs: number | null
  recordsRead: number
  recordsCreated: number
  recordsUpdated: number
  recordsSkipped: number
  recordsFailed: number
  apiRequests: number
  rangeStart: Date | null
  rangeEnd: Date | null
  errorSummary: string | null
  triggeredByUserId: string | null
}

export interface SyncErrorRow {
  id: string
  syncRunId: string
  entity: string
  sourceId: string | null
  errorCode: string | null
  message: string
  isRetryable: boolean
  payload: unknown | null
  resolvedAt: Date | null
  createdAt: Date
}

export interface SyncCheckpointRow {
  id: string
  integrationId: string
  entity: string
  cursor: string | null
  lastRecordAt: Date | null
  backfillDoneTo: Date | null
  updatedAt: Date
}

export interface WebhookEventRow {
  id: string
  integrationId: string
  topic: string
  externalId: string
  payload: unknown
  receivedAt: Date
  processedAt: Date | null
  processError: string | null
  attempts: number
}

export interface JobRow {
  id: string
  queue: string
  name: string
  payload: unknown | null
  status: E.JobStatus
  runAt: Date
  startedAt: Date | null
  finishedAt: Date | null
  attempts: number
  maxAttempts: number
  lastError: string | null
  lockedBy: string | null
  lockedAt: Date | null
  idempotencyKey: string | null
  createdAt: Date
}

export interface CustomerRow {
  id: string
  name: string
  normalizedName: string
  email: string | null
  phone: string | null
  city: string | null
  region: string | null
  country: string | null
  classification: E.CustomerClassification
  divisionId: string | null
  isActive: boolean
  firstSeenAt: Date
  createdAt: Date
  updatedAt: Date
}

export interface CustomerSourceLinkRow {
  id: string
  customerId: string
  integrationId: string
  sourceId: string
  sourceName: string
  sourceEmail: string | null
  matchStatus: E.MatchStatus
  matchConfidence: number | null
  matchedAt: Date
  matchedByUserId: string | null
  createdAt: Date
  updatedAt: Date
}

export interface UnmatchedRecordRow {
  id: string
  integrationId: string
  entity: string
  sourceId: string
  sourceName: string
  reason: string
  payload: unknown | null
  suggestedCustomerId: string | null
  status: E.MatchStatus
  resolvedAt: Date | null
  resolvedByUserId: string | null
  createdAt: Date
  updatedAt: Date
}

export interface SalesRepRow {
  id: string
  name: string
  email: string | null
  normalizedName: string
  divisionId: string | null
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}

export interface SalesRepSourceLinkRow {
  id: string
  salesRepId: string
  integrationId: string
  sourceId: string
  sourceName: string
  createdAt: Date
}

export interface InvoiceRow {
  id: string
  integrationId: string
  sourceId: string
  sourceDocNumber: string
  customerId: string | null
  divisionId: string | null
  salesRepId: string | null
  status: E.InvoiceStatus
  issuedOn: Date
  dueOn: Date | null
  currency: string
  exchangeRate: string
  subtotal: string
  taxTotal: string
  total: string
  amountPaid: string
  balance: string
  revenueAmount: string
  costAmount: string | null
  memo: string | null
  sourceCreatedAt: Date | null
  sourceUpdatedAt: Date | null
  syncedAt: Date
  createdAt: Date
  updatedAt: Date
}

export interface InvoiceLineRow {
  id: string
  invoiceId: string
  sourceLineId: string | null
  lineNumber: number
  description: string | null
  itemSourceId: string | null
  itemName: string | null
  quantity: string
  unitPrice: string
  amount: string
  costAmount: string | null
  divisionId: string | null
}

export interface PaymentRow {
  id: string
  integrationId: string
  sourceId: string
  customerId: string | null
  receivedOn: Date
  currency: string
  amount: string
  method: string | null
  reference: string | null
  sourceUpdatedAt: Date | null
  syncedAt: Date
  createdAt: Date
}

export interface PaymentApplicationRow {
  id: string
  paymentId: string
  invoiceId: string
  amount: string
}

export interface QuoteRow {
  id: string
  integrationId: string
  sourceId: string
  sourceDocNumber: string
  customerId: string | null
  divisionId: string | null
  salesRepId: string | null
  status: E.QuoteStatus
  stage: string
  stageNormalized: string
  currency: string
  amount: string
  issuedOn: Date
  expiresOn: Date | null
  closedOn: Date | null
  lastActivityAt: Date | null
  sourceCreatedAt: Date | null
  sourceUpdatedAt: Date | null
  syncedAt: Date
  createdAt: Date
  updatedAt: Date
}

export interface QuoteLineRow {
  id: string
  quoteId: string
  sourceLineId: string | null
  lineNumber: number
  description: string | null
  itemName: string | null
  quantity: string
  unitPrice: string
  amount: string
}

export interface ShopifyOrderRow {
  id: string
  integrationId: string
  sourceId: string
  orderNumber: string
  customerId: string | null
  divisionId: string | null
  email: string | null
  financialStatus: E.ShopifyFinancialStatus
  fulfillmentStatus: E.ShopifyFulfillmentStatus
  currency: string
  subtotalPrice: string
  totalDiscounts: string
  totalTax: string
  totalShipping: string
  totalRefunded: string
  totalPrice: string
  netSalesAmount: string
  placedAt: Date
  cancelledAt: Date | null
  closedAt: Date | null
  sourceUpdatedAt: Date | null
  syncedAt: Date
  createdAt: Date
  updatedAt: Date
}

export interface ShopifyOrderLineRow {
  id: string
  orderId: string
  sourceLineId: string
  lineNumber: number
  productSourceId: string | null
  variantSourceId: string | null
  sku: string | null
  title: string
  quantity: number
  unitPrice: string
  discount: string
  amount: string
}

export interface DivisionCostRow {
  id: string
  divisionId: string
  periodStart: Date
  periodEnd: Date
  cogsAmount: string
  currency: string
  sourceAccounts: unknown | null
  basis: string
  isApproved: boolean
  approvedBy: string | null
  approvedAt: Date | null
  note: string | null
  createdAt: Date
  updatedAt: Date
}

export interface CogsAccountMappingRow {
  id: string
  sourceAccountId: string
  accountName: string
  accountType: string | null
  includeInCogs: boolean
  divisionId: string | null
  note: string | null
  createdAt: Date
  updatedAt: Date
}

export interface MetricDefinitionRow {
  id: string
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
  approvalStatus: E.MetricApprovalStatus
  approvedBy: string | null
  approvedAt: Date | null
  notes: string | null
  createdAt: Date
  updatedAt: Date
}

export interface ReconciliationRow {
  id: string
  metricDefinitionId: string
  periodStart: Date
  periodEnd: Date
  divisionId: string | null
  platformValue: string
  sourceValue: string
  variance: string
  variancePct: string
  tolerancePct: string
  passed: boolean
  performedBy: string | null
  note: string | null
  createdAt: Date
}

export interface DailyBriefRow {
  id: string
  briefDate: Date
  status: E.BriefStatus
  generatedAt: Date | null
  payload: unknown | null
  htmlBody: string | null
  textBody: string | null
  subject: string | null
  dataWarnings: string[]
  generationMs: number | null
  errorMessage: string | null
  createdAt: Date
  updatedAt: Date
}

export interface BriefDeliveryRow {
  id: string
  dailyBriefId: string
  recipient: string
  status: E.DeliveryStatus
  attempts: number
  providerMessageId: string | null
  sentAt: Date | null
  failedAt: Date | null
  errorMessage: string | null
  createdAt: Date
  updatedAt: Date
}

export interface BriefRecipientRow {
  id: string
  email: string
  name: string | null
  userId: string | null
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}

export interface AiConversationRow {
  id: string
  userId: string
  title: string
  createdAt: Date
  updatedAt: Date
}

export interface AiMessageRow {
  id: string
  conversationId: string
  role: string
  content: string
  toolCalls: unknown | null
  sources: unknown | null
  dataMode: string | null
  inputTokens: number | null
  outputTokens: number | null
  latencyMs: number | null
  model: string | null
  refusalReason: string | null
  createdAt: Date
}
