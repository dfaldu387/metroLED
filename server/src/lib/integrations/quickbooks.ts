import { db, sql, upsert } from '../db'
import { env } from '../env'
import { ProviderAuthError, providerJson, RateLimiter, type RequestCounter } from './http'
import { readCredentials, writeCredentials, type QuickBooksCredentials } from './credentials'
import { quickBooksApp, quickBooksRedirectUri } from './quickbooks-app'
import type {
  NormalizedCostPeriod,
  NormalizedCustomer,
  NormalizedInvoice,
  NormalizedInvoiceLine,
  NormalizedPayment,
  NormalizedQuote,
  Page,
  ProviderAdapter,
  SyncContext,
} from './types'
import { accountAmountsByClass, type PlReport } from './quickbooks-reports'
import { addMonths, endOfMonth, startOfMonth, toIsoDate } from '@shared/dates'

/**
 * QuickBooks Online adapter.
 *
 * API: Accounting API v3, queried through the SQL-like `query` endpoint.
 * Auth: OAuth 2.0 authorisation code flow; the access token lasts an hour and
 * is refreshed automatically here, with the new refresh token persisted
 * because Intuit rotates it.
 *
 * Pagination: `STARTPOSITION` / `MAXRESULTS`, 1-indexed, max 1000 per page.
 * We use 200 and resume with a cursor so an interrupted sync continues where
 * it stopped rather than re-reading the whole history.
 *
 * Incremental sync keys off `MetaData.LastUpdatedTime`, so an invoice edited
 * in QuickBooks months after it was issued is still picked up.
 *
 * READ ONLY. This adapter issues no POST to QuickBooks other than the token
 * refresh. Nothing is ever written back to the client's accounting system.
 */

const PAGE_SIZE = 200
const TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer'

async function apiBase(): Promise<string> {
  const { environment } = await quickBooksApp()
  return environment === 'production'
    ? 'https://quickbooks.api.intuit.com'
    : 'https://sandbox-quickbooks.api.intuit.com'
}

// QuickBooks allows 500 requests per minute per realm; 150ms spacing keeps us
// comfortably inside it without a throttle round trip.
const limiter = new RateLimiter(150)

interface QboQueryResponse<T> {
  QueryResponse?: Record<string, T[] | number | undefined> & {
    startPosition?: number
    maxResults?: number
    totalCount?: number
  }
  Fault?: { Error?: { Message?: string; Detail?: string; code?: string }[] }
}

interface QboRef {
  value?: string
  name?: string
}

interface QboInvoice {
  Id: string
  DocNumber?: string
  TxnDate?: string
  DueDate?: string
  CustomerRef?: QboRef
  ClassRef?: QboRef
  DepartmentRef?: QboRef
  SalesRepRef?: QboRef
  CurrencyRef?: QboRef
  ExchangeRate?: number
  TotalAmt?: number
  Balance?: number
  PrivateNote?: string
  CustomerMemo?: { value?: string }
  TxnTaxDetail?: { TotalTax?: number }
  Line?: QboLine[]
  CustomField?: { Name?: string; StringValue?: string }[]
  MetaData?: { CreateTime?: string; LastUpdatedTime?: string }
  EmailStatus?: string
  /** Present and true when the invoice is a void/deleted shell. */
  void?: boolean
}

interface QboLine {
  Id?: string
  LineNum?: number
  Description?: string
  Amount?: number
  DetailType?: string
  SalesItemLineDetail?: {
    ItemRef?: QboRef
    Qty?: number
    UnitPrice?: number
    ClassRef?: QboRef
  }
}

/** An estimate is the QuickBooks quote: an invoice shape plus its acceptance state. */
interface QboEstimate extends QboInvoice {
  TxnStatus?: string
  ExpirationDate?: string
  AcceptedDate?: string
  LinkedTxn?: { TxnId?: string; TxnType?: string }[]
}

interface QboCustomer {
  Id: string
  DisplayName?: string
  CompanyName?: string
  PrimaryEmailAddr?: { Address?: string }
  PrimaryPhone?: { FreeFormNumber?: string }
  BillAddr?: { City?: string; CountrySubDivisionCode?: string; Country?: string }
  CustomerTypeRef?: QboRef
  Active?: boolean
  MetaData?: { LastUpdatedTime?: string }
}

interface QboPayment {
  Id: string
  CustomerRef?: QboRef
  TxnDate?: string
  TotalAmt?: number
  CurrencyRef?: QboRef
  PaymentMethodRef?: QboRef
  PaymentRefNum?: string
  MetaData?: { LastUpdatedTime?: string }
  Line?: {
    Amount?: number
    LinkedTxn?: { TxnId?: string; TxnType?: string }[]
  }[]
}

interface QboAccount {
  Id: string
  Name?: string
  AccountType?: string
  AccountSubType?: string
  Active?: boolean
}

// ---------------------------------------------------------------------------
// Token handling
// ---------------------------------------------------------------------------

/**
 * Returns a valid access token, refreshing it when it is within five minutes
 * of expiry. The rotated refresh token is persisted immediately: losing it
 * would force the client to reconnect by hand.
 */
async function accessTokenFor(integrationId: string, counter: RequestCounter): Promise<QuickBooksCredentials> {
  const credentials = await readCredentials<QuickBooksCredentials>(integrationId)
  if (!credentials) {
    throw new ProviderAuthError(
      'QuickBooks Online is not connected. Connect it on the Data Health page.',
      401,
      '',
      'QuickBooks Online',
    )
  }

  const fiveMinutes = 5 * 60 * 1000
  if (credentials.accessTokenExpiresAt - Date.now() > fiveMinutes) return credentials

  if (credentials.refreshTokenExpiresAt < Date.now()) {
    throw new ProviderAuthError(
      'The QuickBooks Online refresh token has expired. An administrator must reconnect the integration.',
      401,
      '',
      'QuickBooks Online',
    )
  }

  const { clientId, clientSecret } = await quickBooksApp()
  if (!clientId || !clientSecret) {
    throw new ProviderAuthError(
      'The Intuit app keys (Client ID and Client Secret) are not configured. Add them on the Data Health page.',
      401,
      '',
      'QuickBooks Online',
    )
  }

  counter.count++
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: credentials.refreshToken,
    }).toString(),
    // No `cache: 'no-store'`: that was a Next.js fetch-cache hint; Node's fetch never caches.
  })

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new ProviderAuthError(
      `QuickBooks Online refused to refresh the access token (HTTP ${response.status}). The integration must be reconnected.`,
      response.status,
      body,
      'QuickBooks Online',
    )
  }

  const payload = (await response.json()) as {
    access_token: string
    refresh_token: string
    expires_in: number
    x_refresh_token_expires_in: number
  }

  const refreshed: QuickBooksCredentials = {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    realmId: credentials.realmId,
    accessTokenExpiresAt: Date.now() + payload.expires_in * 1000,
    refreshTokenExpiresAt: Date.now() + payload.x_refresh_token_expires_in * 1000,
  }

  await writeCredentials(integrationId, refreshed)
  await db.exec(sql`
    UPDATE "Integration" SET "tokenExpiresAt" = ${new Date(refreshed.accessTokenExpiresAt)}
    WHERE "id" = ${integrationId}`)

  return refreshed
}

// ---------------------------------------------------------------------------
// Query helper
// ---------------------------------------------------------------------------

/** QuickBooks query strings are single-quoted; escape embedded quotes. */
function escapeQbo(value: string): string {
  return value.replace(/'/g, "\\'")
}

function qboTimestamp(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z')
}

async function runQuery<T>(
  context: SyncContext,
  entityName: string,
  whereClause: string,
  startPosition: number,
): Promise<{ rows: T[]; hasMore: boolean }> {
  const credentials = await accessTokenFor(context.integrationId, context.counter)
  const query =
    `SELECT * FROM ${entityName}` +
    (whereClause ? ` WHERE ${whereClause}` : '') +
    ` ORDER BY MetaData.LastUpdatedTime ASC STARTPOSITION ${startPosition} MAXRESULTS ${PAGE_SIZE}`

  const url =
    `${await apiBase()}/v3/company/${encodeURIComponent(credentials.realmId)}/query` +
    `?query=${encodeURIComponent(query)}&minorversion=${env().QBO_MINOR_VERSION}`

  await limiter.acquire()
  const payload = await providerJson<QboQueryResponse<T>>(url, {
    provider: 'QuickBooks Online',
    headers: { Authorization: `Bearer ${credentials.accessToken}` },
    counter: context.counter,
    onRetry: context.onRetry,
    signal: context.signal,
  })

  if (payload.Fault?.Error?.length) {
    const first = payload.Fault.Error[0]
    throw new Error(
      `QuickBooks rejected the ${entityName} query: ${first?.Message ?? 'unknown error'}${first?.Detail ? ` - ${first.Detail}` : ''}`,
    )
  }

  const bucket = payload.QueryResponse?.[entityName]
  const rows = Array.isArray(bucket) ? (bucket as T[]) : []
  return { rows, hasMore: rows.length === PAGE_SIZE }
}

function parseCursor(cursor: string | null): number {
  const n = cursor ? Number(cursor) : 1
  return Number.isFinite(n) && n >= 1 ? n : 1
}

function parseDate(value: string | undefined): Date | null {
  if (!value) return null
  // QuickBooks date-only fields are plain YYYY-MM-DD with no timezone.
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00.000Z` : value
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function incrementalWhere(context: SyncContext): string {
  return context.since ? `MetaData.LastUpdatedTime >= '${escapeQbo(qboTimestamp(context.since))}'` : ''
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export const quickBooksAdapter: ProviderAdapter = {
  provider: 'QUICKBOOKS',
  displayName: 'QuickBooks Online',
  entities: ['customers', 'accounts', 'invoices', 'payments', 'quotes', 'cogs'],
  minRequestIntervalMs: 150,

  async testConnection(context) {
    const credentials = await accessTokenFor(context.integrationId, context.counter)
    const url =
      `${await apiBase()}/v3/company/${encodeURIComponent(credentials.realmId)}/companyinfo/${encodeURIComponent(credentials.realmId)}` +
      `?minorversion=${env().QBO_MINOR_VERSION}`

    await limiter.acquire()
    const payload = await providerJson<{ CompanyInfo?: { CompanyName?: string; Country?: string } }>(url, {
      provider: 'QuickBooks Online',
      headers: { Authorization: `Bearer ${credentials.accessToken}` },
      counter: context.counter,
      onRetry: context.onRetry,
      signal: context.signal,
      maxAttempts: 2,
    })

    const name = payload.CompanyInfo?.CompanyName
    return {
      ok: Boolean(name),
      detail: name
        ? `Connected to "${name}" (realm ${credentials.realmId}).`
        : 'Connected, but QuickBooks returned no company information.',
    }
  },

  async fetchCustomers(context): Promise<Page<NormalizedCustomer>> {
    const start = parseCursor(context.cursor)
    const { rows, hasMore } = await runQuery<QboCustomer>(context, 'Customer', incrementalWhere(context), start)

    return {
      items: rows.map((row) => ({
        sourceId: row.Id,
        name: row.DisplayName ?? row.CompanyName ?? `Customer ${row.Id}`,
        email: row.PrimaryEmailAddr?.Address ?? null,
        phone: row.PrimaryPhone?.FreeFormNumber ?? null,
        city: row.BillAddr?.City ?? null,
        region: row.BillAddr?.CountrySubDivisionCode ?? null,
        country: row.BillAddr?.Country ?? null,
        // QuickBooks "customer type" is free text set by the client, so a
        // mapping is only inferred when it says so unambiguously.
        classificationHint: inferClassification(row.CustomerTypeRef?.name),
        raw: { customerType: row.CustomerTypeRef?.name ?? null, active: row.Active ?? true },
      })),
      nextCursor: hasMore ? String(start + rows.length) : null,
    }
  },

  async fetchInvoices(context): Promise<Page<NormalizedInvoice>> {
    const start = parseCursor(context.cursor)
    const { rows, hasMore } = await runQuery<QboInvoice>(context, 'Invoice', incrementalWhere(context), start)

    const items = rows.map<NormalizedInvoice>((row) => {
      const total = row.TotalAmt ?? 0
      const balance = row.Balance ?? 0
      const taxTotal = row.TxnTaxDetail?.TotalTax ?? 0
      const subtotal = round2(total - taxTotal)
      const amountPaid = round2(total - balance)
      const issuedOn = parseDate(row.TxnDate) ?? new Date()

      const lines: NormalizedInvoiceLine[] = (row.Line ?? [])
        .filter((line) => line.DetailType === 'SalesItemLineDetail')
        .map((line, index) => ({
          sourceLineId: line.Id ?? null,
          lineNumber: line.LineNum ?? index + 1,
          description: line.Description ?? null,
          itemSourceId: line.SalesItemLineDetail?.ItemRef?.value ?? null,
          itemName: line.SalesItemLineDetail?.ItemRef?.name ?? null,
          quantity: line.SalesItemLineDetail?.Qty ?? 1,
          unitPrice: line.SalesItemLineDetail?.UnitPrice ?? 0,
          amount: round2(line.Amount ?? 0),
        }))

      return {
        sourceId: row.Id,
        docNumber: row.DocNumber ?? row.Id,
        customerSourceId: row.CustomerRef?.value ?? null,
        customerName: row.CustomerRef?.name ?? null,
        salesRepSourceId: row.SalesRepRef?.value ?? null,
        salesRepName: row.SalesRepRef?.name ?? customFieldValue(row.CustomField, 'Sales Rep'),
        status: invoiceStatus(row, balance, total),
        issuedOn,
        dueOn: parseDate(row.DueDate),
        currency: row.CurrencyRef?.value ?? 'CAD',
        exchangeRate: row.ExchangeRate ?? 1,
        subtotal,
        taxTotal: round2(taxTotal),
        total: round2(total),
        amountPaid,
        balance: round2(balance),
        // Revenue basis: subtotal excluding tax. See metrics/definitions.ts.
        revenueAmount: subtotal,
        memo: row.CustomerMemo?.value ?? row.PrivateNote ?? null,
        sourceCreatedAt: parseDate(row.MetaData?.CreateTime),
        sourceUpdatedAt: parseDate(row.MetaData?.LastUpdatedTime),
        lines,
        // Fields the division mapping rules can match on.
        mappingFields: {
          class: row.ClassRef?.name ?? null,
          department: row.DepartmentRef?.name ?? null,
          customer: row.CustomerRef?.name ?? null,
          item: lines[0]?.itemName ?? null,
          docNumber: row.DocNumber ?? null,
        },
      }
    })

    return { items, nextCursor: hasMore ? String(start + rows.length) : null }
  },

  async fetchPayments(context): Promise<Page<NormalizedPayment>> {
    const start = parseCursor(context.cursor)
    const { rows, hasMore } = await runQuery<QboPayment>(context, 'Payment', incrementalWhere(context), start)

    const items = rows.map<NormalizedPayment>((row) => {
      const applications: { invoiceSourceId: string; amount: number }[] = []
      for (const line of row.Line ?? []) {
        for (const linked of line.LinkedTxn ?? []) {
          if (linked.TxnType === 'Invoice' && linked.TxnId) {
            applications.push({ invoiceSourceId: linked.TxnId, amount: round2(line.Amount ?? 0) })
          }
        }
      }

      return {
        sourceId: row.Id,
        customerSourceId: row.CustomerRef?.value ?? null,
        receivedOn: parseDate(row.TxnDate) ?? new Date(),
        currency: row.CurrencyRef?.value ?? 'CAD',
        amount: round2(row.TotalAmt ?? 0),
        method: row.PaymentMethodRef?.name ?? null,
        reference: row.PaymentRefNum ?? null,
        sourceUpdatedAt: parseDate(row.MetaData?.LastUpdatedTime),
        applications,
      }
    })

    return { items, nextCursor: hasMore ? String(start + rows.length) : null }
  },

  /**
   * Estimates, reported in the sales pipeline alongside Method CRM quotes.
   *
   * QuickBooks keeps the acceptance state on the estimate itself: Pending,
   * Accepted, Closed (converted to an invoice or closed by hand) or Rejected.
   * A pending estimate past its expiry date is reported as expired.
   */
  async fetchQuotes(context): Promise<Page<NormalizedQuote>> {
    const start = parseCursor(context.cursor)
    const { rows, hasMore } = await runQuery<QboEstimate>(context, 'Estimate', incrementalWhere(context), start)

    const items = rows.map<NormalizedQuote>((row) => {
      const issuedOn = parseDate(row.TxnDate) ?? new Date()
      const expiresOn = parseDate(row.ExpirationDate)
      const updatedAt = parseDate(row.MetaData?.LastUpdatedTime)
      const { status, stage, normalized } = estimateStage(row, expiresOn, context.until)

      const lines: NormalizedInvoiceLine[] = (row.Line ?? [])
        .filter((line) => line.DetailType === 'SalesItemLineDetail')
        .map((line, index) => ({
          sourceLineId: line.Id ?? null,
          lineNumber: line.LineNum ?? index + 1,
          description: line.Description ?? null,
          itemSourceId: line.SalesItemLineDetail?.ItemRef?.value ?? null,
          itemName: line.SalesItemLineDetail?.ItemRef?.name ?? null,
          quantity: line.SalesItemLineDetail?.Qty ?? 1,
          unitPrice: line.SalesItemLineDetail?.UnitPrice ?? 0,
          amount: round2(line.Amount ?? 0),
        }))

      return {
        sourceId: row.Id,
        docNumber: row.DocNumber ?? row.Id,
        customerSourceId: row.CustomerRef?.value ?? null,
        customerName: row.CustomerRef?.name ?? null,
        salesRepSourceId: row.SalesRepRef?.value ?? null,
        salesRepName: row.SalesRepRef?.name ?? customFieldValue(row.CustomField, 'Sales Rep'),
        status,
        stage,
        stageNormalized: normalized,
        currency: row.CurrencyRef?.value ?? 'CAD',
        amount: round2(row.TotalAmt ?? 0),
        issuedOn,
        expiresOn,
        closedOn:
          status === 'WON' || status === 'LOST'
            ? (parseDate(row.AcceptedDate) ?? updatedAt)
            : status === 'EXPIRED'
              ? expiresOn
              : null,
        lastActivityAt: updatedAt ?? issuedOn,
        sourceCreatedAt: parseDate(row.MetaData?.CreateTime),
        sourceUpdatedAt: updatedAt,
        lines,
        mappingFields: {
          class: row.ClassRef?.name ?? null,
          department: row.DepartmentRef?.name ?? null,
          customer: row.CustomerRef?.name ?? null,
          item: lines[0]?.itemName ?? null,
          docNumber: row.DocNumber ?? null,
        },
      }
    })
    return { items, nextCursor: hasMore ? String(start + rows.length) : null }
  },

  /**
   * Monthly direct cost, from the Profit and Loss report summarised by class.
   *
   * Only the accounts Finance has ticked as direct cost are summed, so the
   * figure follows the approved cost basis and never includes operating
   * expenses. Reading the report rather than individual bills means inventory
   * cost posted automatically at the point of sale is included too. An
   * incremental run re-reads the last three months, because bills are often
   * entered after the month they belong to; a backfill re-reads the window.
   */
  async fetchCogs(context): Promise<Page<NormalizedCostPeriod>> {
    const included = await db.many<{ sourceAccountId: string }>(sql`
      SELECT "sourceAccountId" FROM "CogsAccountMapping" WHERE "includeInCogs" = true`)
    if (included.length === 0) {
      context.log('No QuickBooks account is flagged as direct cost, so no cost periods were read.')
      return { items: [], nextCursor: null }
    }
    const accountIds = new Set(included.map((row) => row.sourceAccountId))
    const credentials = await accessTokenFor(context.integrationId, context.counter)
    const base = `${await apiBase()}/v3/company/${encodeURIComponent(credentials.realmId)}/reports/ProfitAndLoss`

    const firstMonth = startOfMonth(context.since ? addMonths(context.since, -2) : addMonths(context.until, -24))
    const lastMonth = startOfMonth(context.until)
    const readAt = new Date()
    const items: NormalizedCostPeriod[] = []

    for (let month = firstMonth; month <= lastMonth; month = startOfMonth(addMonths(month, 1))) {
      if (context.signal?.aborted) break
      const periodEnd = endOfMonth(month)
      const url =
        `${base}?start_date=${toIsoDate(month)}&end_date=${toIsoDate(periodEnd)}` +
        `&accounting_method=Accrual&summarize_column_by=Classes&minorversion=${env().QBO_MINOR_VERSION}`

      await limiter.acquire()
      const report = await providerJson<PlReport>(url, {
        provider: 'QuickBooks Online',
        headers: { Authorization: `Bearer ${credentials.accessToken}` },
        counter: context.counter,
        onRetry: context.onRetry,
        signal: context.signal,
      })

      const groups = new Map<string, NormalizedCostPeriod['groups'][number]>()
      for (const row of accountAmountsByClass(report, accountIds)) {
        const key = row.classId ?? ''
        const group = groups.get(key) ?? {
          mappingFields: { class: row.classId ? row.classTitle : null },
          label: row.classTitle,
          amount: 0,
          accounts: [],
        }
        group.amount = round2(group.amount + row.amount)
        group.accounts.push({ sourceId: row.accountId, name: row.accountName, amount: row.amount })
        groups.set(key, group)
      }

      items.push({
        periodStart: month,
        periodEnd,
        currency: 'USD',
        basis: 'QuickBooks Profit and Loss (accrual) by class, direct-cost accounts only',
        groups: [...groups.values()],
        sourceUpdatedAt: readAt,
      })
    }

    return { items, nextCursor: null }
  },

  /**
   * Chart of accounts.
   *
   * Imported so Finance can decide which accounts count as direct cost on the
   * Settings screen. Accounts QuickBooks already types as "Cost of Goods Sold"
   * are pre-flagged as a starting point, but the flag remains editable and
   * every change is written to the audit log - the classification is a
   * financial decision, not an automatic one.
   */
  async fetchAccounts(context): Promise<Page<never>> {
    const start = parseCursor(context.cursor)
    const { rows, hasMore } = await runQuery<QboAccount>(
      context,
      'Account',
      "AccountType IN ('Cost of Goods Sold', 'Expense', 'Other Expense')",
      start,
    )

    for (const account of rows) {
      const isCogsByType = account.AccountType === 'Cost of Goods Sold'
      await upsert(
        'CogsAccountMapping',
        ['sourceAccountId'],
        {
          sourceAccountId: account.Id,
          accountName: account.Name ?? `Account ${account.Id}`,
          accountType: account.AccountType ?? null,
          includeInCogs: isCogsByType,
          note: isCogsByType
            ? 'Pre-flagged because QuickBooks types this account as Cost of Goods Sold. Confirm with Finance.'
            : 'Imported as a candidate. Operating expenses must NOT be included in cost of goods sold.',
        },
        // The include flag is a Finance decision, so a later sync refreshes the
        // account name but never overwrites the decision.
        {
          accountName: account.Name ?? `Account ${account.Id}`,
          accountType: account.AccountType ?? null,
        },
      )
    }

    return { items: [], nextCursor: hasMore ? String(start + rows.length) : null }
  },
}

function customFieldValue(
  fields: { Name?: string; StringValue?: string }[] | undefined,
  name: string,
): string | null {
  const match = fields?.find((f) => f.Name?.toLowerCase() === name.toLowerCase())
  return match?.StringValue?.trim() || null
}

function inferClassification(customerType: string | undefined): 'DIRECT' | 'DISTRIBUTOR' | null {
  if (!customerType) return null
  const value = customerType.toLowerCase()
  if (value.includes('distributor') || value.includes('reseller') || value.includes('wholesale')) {
    return 'DISTRIBUTOR'
  }
  if (value.includes('direct') || value.includes('retail') || value.includes('end user')) return 'DIRECT'
  return null
}

function invoiceStatus(
  row: QboInvoice,
  balance: number,
  total: number,
): NormalizedInvoice['status'] {
  if (row.void) return 'VOID'
  // QuickBooks represents a voided invoice as a zero-total shell with a
  // "Voided" memo, so both signals are checked rather than trusting one.
  if (total === 0 && (row.PrivateNote ?? '').toLowerCase().includes('voided')) return 'VOID'
  if (balance <= 0.005) return 'PAID'
  if (balance < total - 0.005) return 'PARTIALLY_PAID'
  return 'OPEN'
}

/** Maps an estimate's acceptance state to the pipeline status. */
function estimateStage(
  row: QboEstimate,
  expiresOn: Date | null,
  now: Date,
): { status: NormalizedQuote['status']; stage: string; normalized: string } {
  const value = (row.TxnStatus ?? 'Pending').trim().toLowerCase()
  const converted = (row.LinkedTxn ?? []).some((t) => t.TxnType === 'Invoice')

  if (value === 'accepted' || value === 'converted' || (value === 'closed' && converted)) {
    return { status: 'WON', stage: converted ? 'Converted to invoice' : 'Accepted', normalized: 'closed_won' }
  }
  if (value === 'rejected') return { status: 'LOST', stage: 'Rejected', normalized: 'closed_lost' }
  if (value === 'closed') return { status: 'LOST', stage: 'Closed', normalized: 'closed_lost' }
  if (expiresOn && expiresOn < now) return { status: 'EXPIRED', stage: 'Expired', normalized: 'expired' }
  return { status: 'OPEN', stage: 'Pending', normalized: 'pending' }
}

/** Builds the OAuth authorisation URL for connecting QuickBooks. */
export async function quickBooksAuthorizeUrl(state: string): Promise<string> {
  const { clientId } = await quickBooksApp()
  const params = new URLSearchParams({
    client_id: clientId ?? '',
    response_type: 'code',
    scope: 'com.intuit.quickbooks.accounting',
    redirect_uri: quickBooksRedirectUri(),
    state,
  })
  return `https://appcenter.intuit.com/connect/oauth2?${params.toString()}`
}

/** Exchanges the authorisation code for tokens during the OAuth callback. */
export async function exchangeQuickBooksCode(
  code: string,
  realmId: string,
): Promise<QuickBooksCredentials> {
  const { clientId, clientSecret } = await quickBooksApp()
  if (!clientId || !clientSecret) {
    throw new Error('The Intuit app keys (Client ID and Client Secret) must be saved before connecting QuickBooks.')
  }

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: quickBooksRedirectUri(),
    }).toString(),
    // No `cache: 'no-store'`: that was a Next.js fetch-cache hint; Node's fetch never caches.
  })

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`QuickBooks rejected the authorisation code (HTTP ${response.status}). ${body}`)
  }

  const payload = (await response.json()) as {
    access_token: string
    refresh_token: string
    expires_in: number
    x_refresh_token_expires_in: number
  }

  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    realmId,
    accessTokenExpiresAt: Date.now() + payload.expires_in * 1000,
    refreshTokenExpiresAt: Date.now() + payload.x_refresh_token_expires_in * 1000,
  }
}
