import { prisma, databaseReachable, toNumber, toNullableNumber } from '../db'
import { demoDataAllowed, env, integrationEnv } from '../env'
import { addMonths, minutesSince, startOfDayInZone, startOfMonth } from '../dates'
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
} from '../types'

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

  const repFilter = scope.restrictToSalesRepId ? { salesRepId: scope.restrictToSalesRepId } : {}
  const divisionWhere = divisionFilter === null ? {} : { divisionId: { in: divisionFilter } }

  const [divisionRows, invoiceRows, quoteRows, orderRows, costRows, integrationRows, repRows, unmatchedCount, settings] =
    await Promise.all([
      prisma.division.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } }),

      prisma.invoice.findMany({
        where: {
          issuedOn: { gte: rangeStart },
          status: { notIn: ['DRAFT', 'VOID', 'WRITTEN_OFF'] },
          ...repFilter,
          ...divisionWhere,
        },
        select: {
          id: true,
          sourceId: true,
          sourceDocNumber: true,
          status: true,
          issuedOn: true,
          dueOn: true,
          divisionId: true,
          customerId: true,
          salesRepId: true,
          currency: true,
          revenueAmount: true,
          total: true,
          amountPaid: true,
          balance: true,
          costAmount: true,
          syncedAt: true,
          division: { select: { code: true, name: true } },
          customer: { select: { name: true, classification: true } },
          salesRep: { select: { name: true } },
          integration: { select: { provider: true } },
        },
        orderBy: { issuedOn: 'desc' },
      }),

      prisma.quote.findMany({
        where: { issuedOn: { gte: rangeStart }, ...repFilter, ...divisionWhere },
        select: {
          id: true,
          sourceId: true,
          sourceDocNumber: true,
          status: true,
          stage: true,
          stageNormalized: true,
          issuedOn: true,
          expiresOn: true,
          closedOn: true,
          lastActivityAt: true,
          divisionId: true,
          customerId: true,
          salesRepId: true,
          currency: true,
          amount: true,
          syncedAt: true,
          division: { select: { code: true, name: true } },
          customer: { select: { name: true } },
          salesRep: { select: { name: true } },
          integration: { select: { provider: true } },
        },
        orderBy: { issuedOn: 'desc' },
      }),

      // E-commerce orders are only loaded for roles that may see them.
      scope.canSeeEcommerce
        ? prisma.shopifyOrder.findMany({
            where: { placedAt: { gte: rangeStart }, ...divisionWhere },
            select: {
              id: true,
              sourceId: true,
              orderNumber: true,
              financialStatus: true,
              fulfillmentStatus: true,
              placedAt: true,
              cancelledAt: true,
              divisionId: true,
              email: true,
              currency: true,
              subtotalPrice: true,
              totalDiscounts: true,
              totalTax: true,
              totalShipping: true,
              totalRefunded: true,
              totalPrice: true,
              netSalesAmount: true,
              syncedAt: true,
              division: { select: { code: true } },
              customer: { select: { name: true } },
              integration: { select: { provider: true } },
              lines: {
                select: { sku: true, title: true, quantity: true, amount: true, productSourceId: true },
              },
            },
            orderBy: { placedAt: 'desc' },
          })
        : Promise.resolve([]),

      // Cost records are only loaded for roles that may see margin.
      scope.canSeeMargin
        ? prisma.divisionCost.findMany({ where: { periodStart: { gte: rangeStart } } })
        : Promise.resolve([]),

      prisma.integration.findMany({ orderBy: { provider: 'asc' } }),

      scope.canSeeAllReps
        ? prisma.salesRep.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } })
        : scope.restrictToSalesRepId
          ? prisma.salesRep.findMany({
              where: { id: scope.restrictToSalesRepId },
              select: { id: true, name: true },
            })
          : Promise.resolve([]),

      prisma.unmatchedRecord.count({ where: { status: 'UNMATCHED' } }),

      prisma.companySetting.findUnique({ where: { id: 'company' } }),
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
    provider: row.integration.provider,
    status: row.status,
    issuedOn: row.issuedOn,
    dueOn: row.dueOn,
    divisionId: row.divisionId,
    divisionCode: row.division?.code ?? null,
    divisionName: row.division?.name ?? null,
    customerId: row.customerId,
    customerName: row.customer?.name ?? null,
    customerClassification: row.customer?.classification ?? 'UNCLASSIFIED',
    salesRepId: row.salesRepId,
    salesRepName: row.salesRep?.name ?? null,
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
    provider: row.integration.provider,
    status: row.status,
    stage: row.stage,
    stageNormalized: row.stageNormalized,
    issuedOn: row.issuedOn,
    expiresOn: row.expiresOn,
    closedOn: row.closedOn,
    lastActivityAt: row.lastActivityAt,
    divisionId: row.divisionId,
    divisionCode: row.division?.code ?? null,
    divisionName: row.division?.name ?? null,
    customerId: row.customerId,
    customerName: row.customer?.name ?? null,
    salesRepId: row.salesRepId,
    salesRepName: row.salesRep?.name ?? null,
    currency: row.currency,
    amount: toNumber(row.amount),
    syncedAt: row.syncedAt,
  }))

  const orders: OrderRecord[] = orderRows.map((row) => ({
    id: row.id,
    sourceId: row.sourceId,
    orderNumber: row.orderNumber,
    provider: row.integration.provider,
    financialStatus: row.financialStatus,
    fulfillmentStatus: row.fulfillmentStatus,
    placedAt: row.placedAt,
    cancelledAt: row.cancelledAt,
    divisionId: row.divisionId,
    divisionCode: row.division?.code ?? null,
    customerName: row.customer?.name ?? null,
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
    const row = await prisma.companySetting.findUnique({ where: { id: 'company' } })
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
export function describeDataMode(mode: DataMode): { title: string; detail: string } | null {
  switch (mode) {
    case 'demo':
      return {
        title: 'Demo data — not live business figures',
        detail:
          'Every number on this screen comes from a generated sample dataset so the interface can be reviewed before the QuickBooks, Method CRM and Shopify connections are live. Nothing here reflects actual MetroLED performance.',
      }
    case 'unavailable':
      return {
        title: 'Business data is not available',
        detail:
          'The reporting database is reachable but holds no imported records, or it could not be reached. Connect the data sources on the Data Health page, then run a sync.',
      }
    default:
      return null
  }
}

export function appEnvLabel(): string {
  return env().APP_ENV
}
