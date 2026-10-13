import { prisma } from '../db'
import { env, integrationEnv } from '../env'
import { ProviderAuthError, providerJson, RateLimiter, type RequestCounter } from './http'
import { readCredentials, writeCredentials, type QuickBooksCredentials } from './credentials'
import type {
  NormalizedCustomer,
  NormalizedInvoice,
  NormalizedInvoiceLine,
  NormalizedPayment,
  Page,
  ProviderAdapter,
  SyncContext,
} from './types'

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

function apiBase(): string {
  return env().QBO_ENVIRONMENT === 'production'
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

  const { clientId, clientSecret } = integrationEnv.quickbooks()
  if (!clientId || !clientSecret) {
    throw new ProviderAuthError(
      'QBO_CLIENT_ID and QBO_CLIENT_SECRET are not configured on this deployment.',
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
    cache: 'no-store',
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
  await prisma.integration.update({
    where: { id: integrationId },
    data: { tokenExpiresAt: new Date(refreshed.accessTokenExpiresAt) },
  })

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
    `${apiBase()}/v3/company/${encodeURIComponent(credentials.realmId)}/query` +
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
  entities: ['customers', 'accounts', 'invoices', 'payments'],
  minRequestIntervalMs: 150,

  async testConnection(context) {
    const credentials = await accessTokenFor(context.integrationId, context.counter)
    const url =
      `${apiBase()}/v3/company/${encodeURIComponent(credentials.realmId)}/companyinfo/${encodeURIComponent(credentials.realmId)}` +
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
   * Chart of accounts.
   *
   * Imported so Finance can decide which accounts count as direct cost on the
   * Settings screen. Accounts QuickBooks already types as "Cost of Goods Sold"
   * are pre-flagged as a starting point, but the flag remains editable and
   * every change is written to the audit log - the classification is a
   * financial decision, not an automatic one.
   */
  async fetchCogs(context) {
    const start = parseCursor(context.cursor)
    const { rows, hasMore } = await runQuery<QboAccount>(
      context,
      'Account',
      "AccountType IN ('Cost of Goods Sold', 'Expense', 'Other Expense')",
      start,
    )

    for (const account of rows) {
      const isCogsByType = account.AccountType === 'Cost of Goods Sold'
      await prisma.cogsAccountMapping.upsert({
        where: { sourceAccountId: account.Id },
        create: {
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
        update: {
          accountName: account.Name ?? `Account ${account.Id}`,
          accountType: account.AccountType ?? null,
        },
      })
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

/** Builds the OAuth authorisation URL for connecting QuickBooks. */
export function quickBooksAuthorizeUrl(state: string): string {
  const { clientId } = integrationEnv.quickbooks()
  const params = new URLSearchParams({
    client_id: clientId ?? '',
    response_type: 'code',
    scope: 'com.intuit.quickbooks.accounting',
    redirect_uri: `${env().APP_URL}/api/integrations/quickbooks/callback`,
    state,
  })
  return `https://appcenter.intuit.com/connect/oauth2?${params.toString()}`
}

/** Exchanges the authorisation code for tokens during the OAuth callback. */
export async function exchangeQuickBooksCode(
  code: string,
  realmId: string,
): Promise<QuickBooksCredentials> {
  const { clientId, clientSecret } = integrationEnv.quickbooks()
  if (!clientId || !clientSecret) {
    throw new Error('QBO_CLIENT_ID and QBO_CLIENT_SECRET must be configured before connecting QuickBooks.')
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
      redirect_uri: `${env().APP_URL}/api/integrations/quickbooks/callback`,
    }).toString(),
    cache: 'no-store',
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
