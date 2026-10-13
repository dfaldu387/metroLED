import { db, sql, databaseReachable, toNumber, toNullableNumber, type SqlFragment } from '../db'
import type {
  CompanySettingRow,
  DivisionCostRow,
  DivisionRow,
  IntegrationRow,
  InvoiceRow,
  QuoteRow,
  ShopifyOrderLineRow,
  ShopifyOrderRow,
} from '../db-rows'
import type { CustomerClassification, IntegrationProvider } from '@shared/enums'
import { demoDataAllowed, env, integrationEnv } from '../env'
import { addMonths, minutesSince, startOfDayInZone, startOfMonth } from '@shared/dates'
import { getDemoDataset, DEMO_UNMATCHED_COUNT } from '../demo/dataset'
import type { AccessScope } from '../auth/guards'
import type {
  CostRecord,
  Dataset,
  DataFreshness,
  DataMode,
  DivisionRef,
  IntegrationHealth,
  InvoiceRecord,
  OrderRecord,
  QuoteRecord,
} from '@shared/types'

/**
 * The single entry point every analytics page uses to get data.
 *
 * Resolution order:
 *   1. Database reachable and holding imported records  -> mode "live"
 *   2. Database unreachable (or empty) and demo allowed  -> mode "demo"
 *   3. Otherwise                                         -> mode "unavailable"
 *
 * The access scope is applied here, in the query, so a page or a component
 * cannot accidentally render a record the signed-in user is not allowed to
 * see. Demo data is filtered through the same scope so the sales
 * representative restriction is demonstrable before go-live.
 */

export interface LoadOptions {
  /** How far back to load. Defaults to 24 months, the Phase 1 import window. */
  months?: number
  now?: Date
  /** Division filter chosen in the UI, on top of the user's own restriction. */
  divisionId?: string | null
}

export interface LoadedDataset extends Dataset {
  /** Count of source records awaiting manual customer matching. */
  unmatchedCount: number
  /**
   * Every division the signed-in user may choose between, regardless of the
   * division currently selected in the UI.
   *
   * `divisions` is narrowed to the current selection, which is what the
   * charts and tables should reflect. The filter control must NOT use that
   * list: once one division is selected it would be the only option left, so
   * the control would vanish and the selection could never be changed or
   * cleared.
   */
  availableDivisions: DivisionRef[]
}

export async function loadDataset(scope: AccessScope, options: LoadOptions = {}): Promise<LoadedDataset> {
  const now = options.now ?? new Date()
  const months = options.months ?? 24
  const today = startOfDayInZone(now)
  const rangeStart = startOfMonth(addMonths(today, -(months - 1)))

  if (await databaseReachable()) {
    const live = await loadLiveDataset(scope, rangeStart, now, options.divisionId ?? null)
    // An empty database is not an error, but it is also not "live figures".
    const hasRecords = live.invoices.length > 0 || live.quotes.length > 0 || live.orders.length > 0
    if (hasRecords) return live

    if (demoDataAllowed()) {
      return applyScope(getDemoDataset(now), scope, options.divisionId ?? null, DEMO_UNMATCHED_COUNT)
    }
    return { ...live, mode: 'unavailable', freshness: { ...live.freshness, mode: 'unavailable' } }
  }

  if (demoDataAllowed()) {
    return applyScope(getDemoDataset(now), scope, options.divisionId ?? null, DEMO_UNMATCHED_COUNT)
  }

  return emptyDataset('unavailable', rangeStart, today, [
    'The reporting database could not be reached. No figures can be shown.',
  ])
}

// ---------------------------------------------------------------------------
// Live loading
// ---------------------------------------------------------------------------

async function loadLiveDataset(
  scope: AccessScope,
  rangeStart: Date,
  now: Date,
  uiDivisionId: string | null,
): Promise<LoadedDataset> {
  const today = startOfDayInZone(now)

  // Division restriction: the user's own access, intersected with the filter
  // chosen in the UI. An empty intersection means "no divisions", which
  // correctly yields no rows rather than all rows.
  const divisionFilter = intersectDivisions(scope.divisionIds, uiDivisionId)

  // Both filters apply to the table aliased `t` in each query below.
  const repWhere = scope.restrictToSalesRepId ? sql`AND t."salesRepId" = ${scope.restrictToSalesRepId}` : sql.empty
  const divisionWhere =
    divisionFilter === null ? sql.empty : sql`AND t."divisionId" = ANY(${divisionFilter}::text[])`

  const [divisionRows, invoiceRows, quoteRows, orderRows, costRows, integrationRows, repRows, unmatchedCount, settings] =
    await Promise.all([
      db.many<DivisionRow>(sql`SELECT * FROM "Division" WHERE "isActive" = true ORDER BY "sortOrder" ASC`),

      db.many<InvoiceSelectRow>(sql`
        SELECT t."id", t."sourceId", t."sourceDocNumber", t."status", t."issuedOn", t."dueOn", t."divisionId",
               t."customerId", t."salesRepId", t."currency", t."revenueAmount", t."total", t."amountPaid",
               t."balance", t."costAmount", t."syncedAt",
               d."code" AS "divisionCode", d."name" AS "divisionName",
               c."name" AS "customerName", c."classification" AS "customerClassification",
               r."name" AS "salesRepName", i."provider"
        FROM "Invoice" t
        JOIN "Integration" i ON i."id" = t."integrationId"
        LEFT JOIN "Division" d ON d."id" = t."divisionId"
        LEFT JOIN "Customer" c ON c."id" = t."customerId"
        LEFT JOIN "SalesRep" r ON r."id" = t."salesRepId"
        WHERE t."issuedOn" >= ${rangeStart}
          AND t."status" <> ALL(${['DRAFT', 'VOID', 'WRITTEN_OFF']}::"InvoiceStatus"[])
          ${repWhere}
          ${divisionWhere}
        ORDER BY t."issuedOn" DESC`),

      db.many<QuoteSelectRow>(sql`
        SELECT t."id", t."sourceId", t."sourceDocNumber", t."status", t."stage", t."stageNormalized", t."issuedOn",
               t."expiresOn", t."closedOn", t."lastActivityAt", t."divisionId", t."customerId", t."salesRepId",
               t."currency", t."amount", t."syncedAt",
               d."code" AS "divisionCode", d."name" AS "divisionName",
               c."name" AS "customerName", r."name" AS "salesRepName", i."provider"
        FROM "Quote" t
        JOIN "Integration" i ON i."id" = t."integrationId"
        LEFT JOIN "Division" d ON d."id" = t."divisionId"
        LEFT JOIN "Customer" c ON c."id" = t."customerId"
        LEFT JOIN "SalesRep" r ON r."id" = t."salesRepId"
        WHERE t."issuedOn" >= ${rangeStart}
          ${repWhere}
          ${divisionWhere}
        ORDER BY t."issuedOn" DESC`),

      // E-commerce orders are only loaded for roles that may see them.
      scope.canSeeEcommerce ? loadOrders(rangeStart, divisionWhere) : Promise.resolve([] as OrderSelectRow[]),

      // Cost records are only loaded for roles that may see margin.
      scope.canSeeMargin
        ? db.many<DivisionCostRow>(sql`SELECT * FROM "DivisionCost" WHERE "periodStart" >= ${rangeStart}`)
        : Promise.resolve([] as DivisionCostRow[]),

      db.many<IntegrationRow>(sql`SELECT * FROM "Integration" ORDER BY "provider" ASC`),

      scope.canSeeAllReps
        ? db.many<{ id: string; name: string }>(
            sql`SELECT "id", "name" FROM "SalesRep" WHERE "isActive" = true ORDER BY "name" ASC`,
          )
        : scope.restrictToSalesRepId
          ? db.many<{ id: string; name: string }>(
              sql`SELECT "id", "name" FROM "SalesRep" WHERE "id" = ${scope.restrictToSalesRepId}`,
            )
          : Promise.resolve([] as { id: string; name: string }[]),

      db
        .value<number>(sql`SELECT COUNT(*) FROM "UnmatchedRecord" WHERE "status" = ${'UNMATCHED'}`)
        .then((n) => Number(n ?? 0)),

      db.maybeOne<CompanySettingRow>(sql`SELECT * FROM "CompanySetting" WHERE "id" = ${'company'}`),
    ])

  const staleHours = settings?.staleDataHours ?? 6

  const divisions: DivisionRef[] = divisionRows.map((d) => ({
    id: d.id,
    code: d.code,
    name: d.name,
    sortOrder: d.sortOrder,
  }))

  const invoices: InvoiceRecord[] = invoiceRows.map((row) => ({
    id: row.id,
    sourceId: row.sourceId,
    docNumber: row.sourceDocNumber,
    provider: row.provider,
    status: row.status,
    issuedOn: row.issuedOn,
    dueOn: row.dueOn,
    divisionId: row.divisionId,
    divisionCode: row.divisionCode ?? null,
    divisionName: row.divisionName ?? null,
    customerId: row.customerId,
    customerName: row.customerName ?? null,
    customerClassification: row.customerClassification ?? 'UNCLASSIFIED',
    salesRepId: row.salesRepId,
    salesRepName: row.salesRepName ?? null,
    currency: row.currency,
    revenueAmount: toNumber(row.revenueAmount),
    total: toNumber(row.total),
    amountPaid: toNumber(row.amountPaid),
    balance: toNumber(row.balance),
    costAmount: scope.canSeeMargin ? toNullableNumber(row.costAmount) : null,
    syncedAt: row.syncedAt,
  }))

  const quotes: QuoteRecord[] = quoteRows.map((row) => ({
    id: row.id,
    sourceId: row.sourceId,
    docNumber: row.sourceDocNumber,
    provider: row.provider,
    status: row.status,
    stage: row.stage,
    stageNormalized: row.stageNormalized,
    issuedOn: row.issuedOn,
    expiresOn: row.expiresOn,
    closedOn: row.closedOn,
    lastActivityAt: row.lastActivityAt,
    divisionId: row.divisionId,
    divisionCode: row.divisionCode ?? null,
    divisionName: row.divisionName ?? null,
    customerId: row.customerId,
    customerName: row.customerName ?? null,
    salesRepId: row.salesRepId,
    salesRepName: row.salesRepName ?? null,
    currency: row.currency,
    amount: toNumber(row.amount),
    syncedAt: row.syncedAt,
  }))

  const orders: OrderRecord[] = orderRows.map((row) => ({
    id: row.id,
    sourceId: row.sourceId,
    orderNumber: row.orderNumber,
    provider: row.provider,
    financialStatus: row.financialStatus,
    fulfillmentStatus: row.fulfillmentStatus,
    placedAt: row.placedAt,
    cancelledAt: row.cancelledAt,
    divisionId: row.divisionId,
    divisionCode: row.divisionCode ?? null,
    customerName: row.customerName ?? null,
    email: row.email,
    currency: row.currency,
    subtotalPrice: toNumber(row.subtotalPrice),
    totalDiscounts: toNumber(row.totalDiscounts),
    totalTax: toNumber(row.totalTax),
    totalShipping: toNumber(row.totalShipping),
    totalRefunded: toNumber(row.totalRefunded),
    totalPrice: toNumber(row.totalPrice),
    netSalesAmount: toNumber(row.netSalesAmount),
    lines: row.lines.map((l) => ({
      sku: l.sku,
      title: l.title,
      quantity: l.quantity,
      amount: toNumber(l.amount),
      productSourceId: l.productSourceId,
    })),
    syncedAt: row.syncedAt,
  }))

  const costs: CostRecord[] = costRows.map((row) => ({
    divisionId: row.divisionId,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    cogsAmount: toNumber(row.cogsAmount),
    isApproved: row.isApproved,
    basis: row.basis,
  }))

  const configured: Record<string, boolean> = {
    QUICKBOOKS: integrationEnv.quickbooks().configured,
    METHOD_CRM: integrationEnv.method().configured,
    SHOPIFY: integrationEnv.shopify().configured,
    MONDAY: integrationEnv.monday().configured,
  }

  const integrations: IntegrationHealth[] = integrationRows
    // Monday.com is conditional: hidden entirely until the client confirms it.
    .filter((row) => row.provider !== 'MONDAY' || integrationEnv.monday().enabled)
    .map((row) => {
      const mins = minutesSince(row.lastSuccessAt, now)
      return {
        provider: row.provider,
        displayName: row.displayName,
        status: row.status,
        isEnabled: row.isEnabled,
        isConfigured: configured[row.provider] ?? false,
        lastSuccessAt: row.lastSuccessAt,
        lastAttemptAt: row.lastAttemptAt,
        lastErrorAt: row.lastErrorAt,
        lastErrorMessage: row.lastErrorMessage,
        consecutiveFailures: row.consecutiveFailures,
        syncIntervalMin: row.syncIntervalMin,
        isStale: row.isEnabled && (mins === null || mins > staleHours * 60),
        minutesSinceSuccess: mins,
      }
    })

  return {
    mode: 'live',
    divisions,
    invoices,
    quotes,
    orders,
    costs,
    integrations,
    salesReps: repRows,
    freshness: buildFreshness('live', integrations),
    loadedRange: { start: rangeStart, end: today },
    unmatchedCount,
    // The query already restricts rows to the selected division; the chooser
    // still needs every division this user is allowed to pick.
    availableDivisions: divisions.filter(
      (d) => scope.divisionIds === null || scope.divisionIds.includes(d.id),
    ),
  }
}

// Row shapes of the joined SELECTs above (the former Prisma `select` + relations).
type InvoiceSelectRow = Pick<
  InvoiceRow,
  | 'id'
  | 'sourceId'
  | 'sourceDocNumber'
  | 'status'
  | 'issuedOn'
  | 'dueOn'
  | 'divisionId'
  | 'customerId'
  | 'salesRepId'
  | 'currency'
  | 'revenueAmount'
  | 'total'
  | 'amountPaid'
  | 'balance'
  | 'costAmount'
  | 'syncedAt'
> & {
  divisionCode: string | null
  divisionName: string | null
  customerName: string | null
  customerClassification: CustomerClassification | null
  salesRepName: string | null
  provider: IntegrationProvider
}

type QuoteSelectRow = Pick<
  QuoteRow,
  | 'id'
  | 'sourceId'
  | 'sourceDocNumber'
  | 'status'
  | 'stage'
  | 'stageNormalized'
  | 'issuedOn'
  | 'expiresOn'
  | 'closedOn'
  | 'lastActivityAt'
  | 'divisionId'
  | 'customerId'
  | 'salesRepId'
  | 'currency'
  | 'amount'
  | 'syncedAt'
> & {
  divisionCode: string | null
  divisionName: string | null
  customerName: string | null
  salesRepName: string | null
  provider: IntegrationProvider
}

type OrderLineSelectRow = Pick<ShopifyOrderLineRow, 'sku' | 'title' | 'quantity' | 'amount' | 'productSourceId'>

type OrderSelectRow = Pick<
  ShopifyOrderRow,
  | 'id'
  | 'sourceId'
  | 'orderNumber'
  | 'financialStatus'
  | 'fulfillmentStatus'
  | 'placedAt'
  | 'cancelledAt'
  | 'divisionId'
  | 'email'
  | 'currency'
  | 'subtotalPrice'
  | 'totalDiscounts'
  | 'totalTax'
  | 'totalShipping'
  | 'totalRefunded'
  | 'totalPrice'
  | 'netSalesAmount'
  | 'syncedAt'
> & {
  divisionCode: string | null
  customerName: string | null
  provider: IntegrationProvider
  lines: OrderLineSelectRow[]
}

/**
 * Shopify orders with their lines. The lines are a one-to-many relation, so
 * they are loaded by a second query and stitched in JS. `divisionWhere`
 * filters the order table, aliased `t`.
 */
async function loadOrders(rangeStart: Date, divisionWhere: SqlFragment): Promise<OrderSelectRow[]> {
  const orders = await db.many<Omit<OrderSelectRow, 'lines'>>(sql`
    SELECT t."id", t."sourceId", t."orderNumber", t."financialStatus", t."fulfillmentStatus", t."placedAt",
           t."cancelledAt", t."divisionId", t."email", t."currency", t."subtotalPrice", t."totalDiscounts",
           t."totalTax", t."totalShipping", t."totalRefunded", t."totalPrice", t."netSalesAmount", t."syncedAt",
           d."code" AS "divisionCode", c."name" AS "customerName", i."provider"
    FROM "ShopifyOrder" t
    JOIN "Integration" i ON i."id" = t."integrationId"
    LEFT JOIN "Division" d ON d."id" = t."divisionId"
    LEFT JOIN "Customer" c ON c."id" = t."customerId"
    WHERE t."placedAt" >= ${rangeStart}
      ${divisionWhere}
    ORDER BY t."placedAt" DESC`)
  if (orders.length === 0) return []

  const lines = await db.many<OrderLineSelectRow & { orderId: string }>(sql`
    SELECT "orderId", "sku", "title", "quantity", "amount", "productSourceId"
    FROM "ShopifyOrderLine"
    WHERE "orderId" = ANY(${orders.map((o) => o.id)}::text[])
    ORDER BY "orderId", "lineNumber" ASC`)
  const byOrder = new Map<string, OrderLineSelectRow[]>()
  for (const { orderId, ...line } of lines) {
    const list = byOrder.get(orderId)
    if (list) list.push(line)
    else byOrder.set(orderId, [line])
  }
  return orders.map((o) => ({ ...o, lines: byOrder.get(o.id) ?? [] }))
}

// ---------------------------------------------------------------------------
// Scope application (used for demo data, which is not filtered by a query)
// ---------------------------------------------------------------------------

function applyScope(
  dataset: Dataset,
  scope: AccessScope,
  uiDivisionId: string | null,
  unmatchedCount: number,
): LoadedDataset {
  const divisionFilter = intersectDivisions(scope.divisionIds, uiDivisionId)
  const allowDivision = (id: string | null) => divisionFilter === null || (id !== null && divisionFilter.includes(id))

  const invoices = dataset.invoices.filter(
    (i) =>
      allowDivision(i.divisionId) &&
      (scope.restrictToSalesRepId === null || i.salesRepId === scope.restrictToSalesRepId),
  )
  const quotes = dataset.quotes.filter(
    (q) =>
      allowDivision(q.divisionId) &&
      (scope.restrictToSalesRepId === null || q.salesRepId === scope.restrictToSalesRepId),
  )
  const orders = scope.canSeeEcommerce ? dataset.orders.filter((o) => allowDivision(o.divisionId)) : []
  const costs = scope.canSeeMargin ? dataset.costs.filter((c) => allowDivision(c.divisionId)) : []

  const divisions =
    divisionFilter === null ? dataset.divisions : dataset.divisions.filter((d) => divisionFilter.includes(d.id))

  const salesReps = scope.restrictToSalesRepId
    ? dataset.salesReps.filter((r) => r.id === scope.restrictToSalesRepId)
    : dataset.salesReps

  return {
    ...dataset,
    divisions,
    invoices,
    quotes,
    orders,
    costs,
    salesReps,
    unmatchedCount,
    // Scoped by the user's own access, but never by the UI selection.
    availableDivisions:
      scope.divisionIds === null
        ? dataset.divisions
        : dataset.divisions.filter((d) => scope.divisionIds!.includes(d.id)),
  }
}

function intersectDivisions(allowed: string[] | null, uiSelection: string | null): string[] | null {
  if (!uiSelection) return allowed
  if (allowed === null) return [uiSelection]
  return allowed.includes(uiSelection) ? [uiSelection] : []
}

function buildFreshness(mode: DataMode, integrations: IntegrationHealth[]): DataFreshness {
  const enabled = integrations.filter((i) => i.isEnabled)
  const lastRefreshAt =
    enabled
      .map((i) => i.lastSuccessAt)
      .filter((d): d is Date => d !== null)
      .sort((a, b) => b.getTime() - a.getTime())[0] ?? null

  return {
    mode,
    lastRefreshAt,
    isStale: enabled.some((i) => i.isStale),
    staleSources: enabled.filter((i) => i.isStale).map((i) => i.displayName),
    missingSources: integrations.filter((i) => !i.isConfigured).map((i) => i.displayName),
  }
}

function emptyDataset(mode: DataMode, start: Date, end: Date, notes: string[]): LoadedDataset {
  return {
    mode,
    divisions: [],
    invoices: [],
    quotes: [],
    orders: [],
    costs: [],
    integrations: [],
    salesReps: [],
    freshness: { mode, lastRefreshAt: null, isStale: true, staleSources: [], missingSources: notes },
    loadedRange: { start, end },
    unmatchedCount: 0,
    availableDivisions: [],
  }
}

// ---------------------------------------------------------------------------
// Company settings
// ---------------------------------------------------------------------------

export interface ResolvedSettings {
  timezone: string
  currency: string
  staleDataHours: number
  staleQuoteDays: number
  largeQuoteAmount: number
  displayName: string
  briefEnabled: boolean
  briefSendHour: number
  briefSendMinute: number
}

export const DEFAULT_SETTINGS: ResolvedSettings = {
  timezone: 'America/New_York',
  currency: 'CAD',
  staleDataHours: 6,
  staleQuoteDays: 21,
  largeQuoteAmount: 10000,
  displayName: 'MetroLED',
  briefEnabled: false,
  briefSendHour: 7,
  briefSendMinute: 0,
}

export async function loadSettings(): Promise<ResolvedSettings> {
  if (!(await databaseReachable())) return DEFAULT_SETTINGS
  try {
    const row = await db.maybeOne<CompanySettingRow>(sql`SELECT * FROM "CompanySetting" WHERE "id" = ${'company'}`)
    if (!row) return DEFAULT_SETTINGS
    return {
      timezone: row.timezone,
      currency: row.currency,
      staleDataHours: row.staleDataHours,
      staleQuoteDays: row.staleQuoteDays,
      largeQuoteAmount: toNumber(row.largeQuoteAmount),
      displayName: row.displayName,
      briefEnabled: row.briefEnabled,
      briefSendHour: row.briefSendHour,
      briefSendMinute: row.briefSendMinute,
    }
  } catch {
    return DEFAULT_SETTINGS
  }
}

/** Human-readable explanation of the current data mode, shown in the banner. */
export { describeDataMode } from '@shared/data-mode'

export function appEnvLabel(): string {
  return env().APP_ENV
}
