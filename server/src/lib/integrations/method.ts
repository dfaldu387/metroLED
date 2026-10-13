import { integrationEnv } from '../env'
import { ProviderAuthError, providerJson, RateLimiter } from './http'
import { readCredentials, type MethodCredentials } from './credentials'
import type {
  NormalizedCustomer,
  NormalizedInvoiceLine,
  NormalizedQuote,
  Page,
  ProviderAdapter,
  SyncContext,
} from './types'

/**
 * Method CRM adapter.
 *
 * API: Method REST API v1 (`https://rest.method.me/api/v1`), authenticated
 * with an API key in the `Authorization: APIKey <key>` header.
 *
 * Pagination: OData-style `$top` / `$skip`, with `$filter` for incremental
 * pulls on the record's modified timestamp.
 *
 * Method's tables are configurable per account, so the field names below are
 * the stock Estimate / Customer table columns. Where a column may be absent or
 * renamed in the client's account, the adapter reads a list of candidates and
 * records the record as unmapped rather than inventing a value. The exact
 * table and field names MUST be confirmed against MetroLED's Method account
 * before go-live - this is flagged in the client-decisions document.
 */

const PAGE_SIZE = 100

// Method's documented limit is 60 requests per minute; 1100ms spacing keeps a
// margin for the occasional retry.
const limiter = new RateLimiter(1100)

interface MethodListResponse<T> {
  value?: T[]
  '@odata.count'?: number
}

interface MethodEstimate {
  RecordID?: number | string
  EstimateNumber?: string
  DocNumber?: string
  Customer?: string
  Customer_RecordID?: number | string
  SalesRep?: string
  SalesRep_RecordID?: number | string
  Status?: string
  EstimateStatus?: string
  TotalAmount?: number
  Total?: number
  TxnDate?: string
  EstimateDate?: string
  ExpirationDate?: string
  ClosedDate?: string
  LastActivityDate?: string
  LastModified?: string
  CreatedDate?: string
  Class?: string
  Memo?: string
  IsActive?: boolean
  Currency?: string
}

interface MethodCustomer {
  RecordID?: number | string
  Name?: string
  CompanyName?: string
  Email?: string
  Phone?: string
  BillingAddressCity?: string
  BillingAddressState?: string
  BillingAddressCountry?: string
  CustomerType?: string
  LastModified?: string
  IsActive?: boolean
}

async function apiKeyFor(context: SyncContext): Promise<string> {
  const stored = await readCredentials<MethodCredentials>(context.integrationId)
  const key = stored?.apiKey ?? integrationEnv.method().apiKey
  if (!key) {
    throw new ProviderAuthError(
      'Method CRM is not connected. Add the API key on the Data Health page.',
      401,
      '',
      'Method CRM',
    )
  }
  return key
}

function firstString(...values: (string | number | undefined | null)[]): string | null {
  for (const value of values) {
    if (value === undefined || value === null) continue
    const s = String(value).trim()
    if (s.length > 0) return s
  }
  return null
}

function firstNumber(...values: (number | undefined | null)[]): number {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return 0
}

function parseDate(value: string | undefined): Date | null {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

function parseCursor(cursor: string | null): number {
  const n = cursor ? Number(cursor) : 0
  return Number.isFinite(n) && n >= 0 ? n : 0
}

async function listTable<T>(
  context: SyncContext,
  table: string,
  skip: number,
  modifiedField = 'LastModified',
): Promise<{ rows: T[]; hasMore: boolean }> {
  const apiKey = await apiKeyFor(context)
  const base = integrationEnv.method().baseUrl.replace(/\/+$/, '')

  const params = new URLSearchParams({
    $top: String(PAGE_SIZE),
    $skip: String(skip),
    $orderby: `${modifiedField} asc`,
  })
  if (context.since) {
    params.set('$filter', `${modifiedField} ge ${context.since.toISOString()}`)
  }

  await limiter.acquire()
  const payload = await providerJson<MethodListResponse<T>>(
    `${base}/tables/${encodeURIComponent(table)}?${params.toString()}`,
    {
      provider: 'Method CRM',
      headers: { Authorization: `APIKey ${apiKey}` },
      counter: context.counter,
      onRetry: context.onRetry,
      signal: context.signal,
    },
  )

  const rows = payload.value ?? []
  return { rows, hasMore: rows.length === PAGE_SIZE }
}

/**
 * Maps a Method stage label onto a normalised key for grouping.
 *
 * The raw label is always preserved on the quote so the pipeline page can show
 * exactly what the CRM says. Any label that does not match a known pattern is
 * kept as an open stage with a slugified key, never silently dropped.
 */
export function normalizeStage(stage: string | null): {
  status: NormalizedQuote['status']
  normalized: string
} {
  const raw = (stage ?? '').trim()
  const value = raw.toLowerCase()

  if (!value) return { status: 'OPEN', normalized: 'not_recorded' }
  if (value.includes('won') || value.includes('accepted') || value.includes('approved') || value.includes('closed - w')) {
    return { status: 'WON', normalized: 'closed_won' }
  }
  if (value.includes('lost') || value.includes('declined') || value.includes('rejected')) {
    return { status: 'LOST', normalized: 'closed_lost' }
  }
  if (value.includes('expired')) return { status: 'EXPIRED', normalized: 'expired' }
  if (value.includes('cancel')) return { status: 'CANCELLED', normalized: 'cancelled' }

  return { status: 'OPEN', normalized: value.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') }
}

export const methodAdapter: ProviderAdapter = {
  provider: 'METHOD_CRM',
  displayName: 'Method CRM',
  entities: ['customers', 'quotes'],
  minRequestIntervalMs: 1100,

  async testConnection(context) {
    const apiKey = await apiKeyFor(context)
    const base = integrationEnv.method().baseUrl.replace(/\/+$/, '')

    await limiter.acquire()
    const payload = await providerJson<MethodListResponse<MethodCustomer>>(
      `${base}/tables/Customer?$top=1`,
      {
        provider: 'Method CRM',
        headers: { Authorization: `APIKey ${apiKey}` },
        counter: context.counter,
        onRetry: context.onRetry,
        signal: context.signal,
        maxAttempts: 2,
      },
    )

    return {
      ok: Array.isArray(payload.value),
      detail: Array.isArray(payload.value)
        ? 'Connected. The Customer table responded to a test query.'
        : 'Connected, but Method returned an unexpected response shape. Confirm the table names for this account.',
    }
  },

  async fetchCustomers(context): Promise<Page<NormalizedCustomer>> {
    const skip = parseCursor(context.cursor)
    const { rows, hasMore } = await listTable<MethodCustomer>(context, 'Customer', skip)

    return {
      items: rows
        .map((row): NormalizedCustomer | null => {
          const sourceId = firstString(row.RecordID)
          if (!sourceId) return null
          return {
            sourceId,
            name: firstString(row.Name, row.CompanyName) ?? `Customer ${sourceId}`,
            email: firstString(row.Email),
            phone: firstString(row.Phone),
            city: firstString(row.BillingAddressCity),
            region: firstString(row.BillingAddressState),
            country: firstString(row.BillingAddressCountry),
            classificationHint: inferClassification(row.CustomerType),
            raw: { customerType: row.CustomerType ?? null, isActive: row.IsActive ?? true },
          }
        })
        .filter((c): c is NormalizedCustomer => c !== null),
      nextCursor: hasMore ? String(skip + rows.length) : null,
    }
  },

  async fetchQuotes(context): Promise<Page<NormalizedQuote>> {
    const skip = parseCursor(context.cursor)
    const { rows, hasMore } = await listTable<MethodEstimate>(context, 'Estimate', skip)

    const items = rows
      .map((row): NormalizedQuote | null => {
        const sourceId = firstString(row.RecordID)
        if (!sourceId) return null

        const rawStage = firstString(row.Status, row.EstimateStatus)
        const { status, normalized } = normalizeStage(rawStage)
        const issuedOn = parseDate(row.TxnDate ?? row.EstimateDate) ?? parseDate(row.CreatedDate)
        if (!issuedOn) return null

        const closedOn = parseDate(row.ClosedDate)
        const lines: NormalizedInvoiceLine[] = []

        return {
          sourceId,
          docNumber: firstString(row.EstimateNumber, row.DocNumber, row.RecordID) ?? sourceId,
          customerSourceId: firstString(row.Customer_RecordID),
          customerName: firstString(row.Customer),
          salesRepSourceId: firstString(row.SalesRep_RecordID),
          salesRepName: firstString(row.SalesRep),
          status,
          // The raw label is preserved exactly as Method holds it.
          stage: rawStage ?? 'Not recorded',
          stageNormalized: normalized,
          currency: firstString(row.Currency) ?? 'CAD',
          amount: firstNumber(row.TotalAmount, row.Total),
          issuedOn,
          expiresOn: parseDate(row.ExpirationDate),
          // Only a genuinely closed quote carries a close date; an open one
          // must not inherit "today" or the win-rate period would be wrong.
          closedOn: status === 'WON' || status === 'LOST' ? (closedOn ?? parseDate(row.LastModified)) : null,
          lastActivityAt: parseDate(row.LastActivityDate ?? row.LastModified),
          sourceCreatedAt: parseDate(row.CreatedDate),
          sourceUpdatedAt: parseDate(row.LastModified),
          lines,
          mappingFields: {
            class: firstString(row.Class),
            customer: firstString(row.Customer),
            memo: firstString(row.Memo),
            docNumber: firstString(row.EstimateNumber, row.DocNumber),
          },
        }
      })
      .filter((q): q is NormalizedQuote => q !== null)

    return { items, nextCursor: hasMore ? String(skip + rows.length) : null }
  },
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
