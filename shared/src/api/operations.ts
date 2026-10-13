import type { IntegrationProvider, RoleName } from '../enums'
import type { Permission } from '../permissions'
import type { DataMode } from '../types'

/**
 * View models for the operations pages: Ask, Daily Brief, Data Health and
 * Account. Served by GET /api/pages/<route> (server/src/routes/pages/operations.ts).
 *
 * Dates are ISO strings. `now` is the server's clock when the page was built,
 * so relative times ("3 hours ago") read exactly as the server-rendered page did.
 */

// ---------------------------------------------------------------------------
// GET /api/pages/ask
// ---------------------------------------------------------------------------

export interface AskPageData {
  now: string
  dataMode: DataMode
  lastRefreshAt: string | null
  isStale: boolean
  user: { name: string; roleLabel: string }
  /** `?q=` from the URL, asked once on arrival. */
  initialQuestion: string | null
  /** False when ANTHROPIC_API_KEY is not set on the deployment. */
  configured: boolean
  canSeeMargin: boolean
  /** Suggested questions this role can actually have answered. */
  suggestions: string[]
}

// ---------------------------------------------------------------------------
// GET /api/pages/daily-brief
// ---------------------------------------------------------------------------

/** Same shape as `BriefPayload` (server/src/lib/brief/generate.ts); already JSON. */
export interface DailyBriefPayload {
  briefDate: string
  generatedAt: string
  timezone: string
  dataMode: DataMode
  revenue: {
    total: number
    invoiceCount: number
    byDivision: { divisionId: string; name: string; code: string; revenue: number; invoiceCount: number }[]
    previousBusinessDayTotal: number | null
  }
  cash: { collected: number; paymentCount: number }
  receivables: {
    totalOutstanding: number
    overdueAmount: number
    overdueCount: number
    newlyOverdue: {
      invoiceId: string
      docNumber: string
      customerName: string
      divisionName: string | null
      balance: number
      dueOn: string
      daysOverdue: number
    }[]
    newlyOverdueTotal: number
  }
  pipeline: {
    openValue: number
    openCount: number
    newlyStale: {
      quoteId: string
      docNumber: string
      customerName: string
      ownerName: string | null
      amount: number
      daysIdle: number
    }[]
    newlyStaleTotal: number
    staleThresholdDays: number
  }
  ecommerce: { netSales: number; orderCount: number; averageOrderValue: number | null; available: boolean }
  sync: {
    healthy: boolean
    summary: string
    sources: {
      provider: string
      displayName: string
      status: string
      lastSuccessLabel: string
      isStale: boolean
      errorMessage: string | null
    }[]
  }
  warnings: string[]
}

export interface DailyBriefDelivery {
  recipient: string
  status: string
  sentAt: string | null
  errorMessage: string | null
  attempts: number
}

export interface DailyBriefPageData {
  now: string
  payload: DailyBriefPayload
  /** True when no stored brief exists and the payload is a live preview. */
  isPreview: boolean
  /** When the stored brief was generated (null for a preview). */
  generatedAt: string | null
  /** e.g. "Tuesday, March 17, 2026" for the payload's brief date. */
  briefDateLabel: string
  /** The brief date a stored brief was expected for (shown in the preview notice). */
  expectedDateLabel: string
  schedule: { briefEnabled: boolean; briefSendHour: number; briefSendMinute: number; timezone: string }
  canManage: boolean
  canSeeReceivables: boolean
  canSeePipeline: boolean
  canSeeEcommerce: boolean
  /** Delivery section; only sent to users who may manage the brief (it lists recipient addresses). */
  email: { configured: boolean; providerLabel: string; deliveries: DailyBriefDelivery[] } | null
}

// ---------------------------------------------------------------------------
// GET /api/pages/data-health
// ---------------------------------------------------------------------------

export interface DataHealthSourceRow {
  provider: 'QUICKBOOKS' | 'METHOD_CRM' | 'SHOPIFY' | 'MONDAY'
  displayName: string
  required: boolean
  envConfigured: boolean
  status: string
  isEnabled: boolean
  lastSuccessAt: string | null
  lastAttemptAt: string | null
  lastErrorAt: string | null
  lastErrorMessage: string | null
  consecutiveFailures: number
  syncIntervalMin: number
  historyMonths: number
  /** Only whether a credential exists; the credential itself never leaves the server. */
  hasStoredCredentials: boolean
  isStale: boolean
  minutesSinceSuccess: number | null
  /** Whether a usable credential exists right now (stored, or for key-based sources, in the environment). */
  configuredNow: boolean
  /**
   * How the credential is held: stored encrypted in the database, read from
   * the deployment environment, or absent. Decides which actions make sense.
   */
  credentialSource: 'stored' | 'environment' | 'none'
  /** Non-secret description of what is connected (shop domain, QuickBooks realm). */
  connectionDetail: string | null
  /** Where the "Connect" action goes: OAuth redirect, an in-page form, or nothing. */
  connectMethod: 'oauth' | 'form' | 'none'
  /** For OAuth providers: whether the app's own client id/secret are set, without which the flow cannot start. */
  oauthAppConfigured: boolean
  /** Where those app keys come from. */
  oauthAppSource: 'stored' | 'environment' | 'none'
  /** Intuit environment the keys belong to (QuickBooks only). */
  oauthEnvironment: 'sandbox' | 'production' | null
  /** The redirect URI that must be registered with the provider (QuickBooks only). */
  oauthRedirectUri: string | null
}

export interface DataHealthSyncRun {
  id: string
  startedAt: string
  integrationDisplayName: string
  entity: string
  trigger: string
  status: string
  errorSummary: string | null
  recordsRead: number
  recordsCreated: number
  recordsUpdated: number
  recordsFailed: number
  durationMs: number | null
}

export interface DataHealthSyncError {
  id: string
  createdAt: string
  integrationDisplayName: string
  entity: string
  sourceId: string | null
  message: string
  isRetryable: boolean
}

export interface DataHealthUnmatched {
  id: string
  integrationDisplayName: string
  sourceName: string
  sourceId: string
  reason: string
  createdAt: string
}

export interface DataHealthDemoUnmatched {
  id: string
  provider: IntegrationProvider
  sourceName: string
  sourceId: string
  reason: string
  suggestion: string | null
}

export interface DataHealthPageData {
  now: string
  /** Tab selected by `?tab=`. */
  tab: 'runs' | 'errors' | 'unmatched'
  dbReady: boolean
  usingDemo: boolean
  canManage: boolean
  /** May connect or disconnect a source (settings.manage). */
  canConnect: boolean
  credentialEncryptionConfigured: boolean
  rows: DataHealthSourceRow[]
  lastRefreshAt: string | null
  pendingJobs: number
  deadJobs: number
  recentRuns: DataHealthSyncRun[]
  recentErrors: DataHealthSyncError[]
  unmatched: DataHealthUnmatched[]
  /** Shown instead of `unmatched` when the database is unreachable. */
  demoUnmatched: DataHealthDemoUnmatched[]
}

// ---------------------------------------------------------------------------
// GET /api/pages/account
// ---------------------------------------------------------------------------

export interface AccountSession {
  id: string
  userAgent: string | null
  ipAddress: string | null
  lastSeenAt: string
  expiresAt: string
}

export interface AccountPageData {
  now: string
  user: {
    name: string
    email: string
    roles: RoleName[]
    roleLabel: string
    isDemo: boolean
    timezone: string
    salesRepId: string | null
    divisionIds: string[]
    mustChangePassword: boolean
  }
  sessions: AccountSession[]
  granted: Permission[]
  denied: Permission[]
}

// ---------------------------------------------------------------------------
// POST /api/account/password  -> ActionResult (@shared/api/session)
// ---------------------------------------------------------------------------

export interface ChangePasswordBody {
  currentPassword: string
  newPassword: string
  confirmPassword: string
}

// ---------------------------------------------------------------------------
// POST /api/integrations/{method,shopify}/connect and /:provider/disconnect
// ---------------------------------------------------------------------------

export interface ConnectMethodRequest {
  apiKey: string
}

export interface ConnectShopifyRequest {
  shopDomain: string
  accessToken: string
  webhookSecret?: string
}

/** The reply never includes the credential; only whether it worked and why. */
export interface IntegrationActionResult {
  ok: boolean
  provider?: string
  message: string
  error?: string
  /** Returned after saving the Intuit app keys: where to send the browser to start the sign-in. */
  connectUrl?: string
  redirectUri?: string
}

export interface QuickBooksAppRequest {
  clientId: string
  clientSecret: string
  environment: 'sandbox' | 'production'
}

// ---------------------------------------------------------------------------
// GET /api/notifications
// ---------------------------------------------------------------------------

export type NotificationSeverity = 'urgent' | 'warning' | 'info'

/**
 * A condition that is true right now for the signed-in user. Derived on each
 * request from permission-scoped data; never a stored row.
 */
export interface NotificationItem {
  id: string
  severity: NotificationSeverity
  title: string
  detail: string
  amountLabel: string | null
  actionLabel: string
  href: string
  /** When the item came into being, if known (e.g. a brief's generation time). */
  at: string | null
}

export interface NotificationsResponse {
  now: string
  mode: DataMode
  items: NotificationItem[]
}
