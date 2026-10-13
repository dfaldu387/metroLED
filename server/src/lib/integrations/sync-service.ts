import type { IntegrationProvider, SyncTrigger } from '@shared/enums'
import { db, insert, insertMany, json, sql, transaction, upsert, type Queryable } from '../db'
import type { DivisionCostRow, IntegrationRow, SyncCheckpointRow } from '../db-rows'
import { addMonths, startOfDayInZone, toIsoDate } from '@shared/dates'
import { integrationEnv } from '../env'
import { describeError, ProviderAuthError, ProviderHttpError, type RequestCounter } from './http'
import { ecoLedMartDivisionId, loadDivisionRules, resolveDivision, type DivisionRule } from './division-mapping'
import { linkedCustomerId, resolveCustomer, resolveSalesRep } from './matching'
import { quickBooksAdapter } from './quickbooks'
import { methodAdapter } from './method'
import { shopifyAdapter } from './shopify'
import type { EntityResult, ProviderAdapter, SyncContext, SyncEntity } from './types'

/**
 * Central synchronisation service (section 13).
 *
 * Responsibilities, all in one place so every provider behaves identically:
 *   - run each entity in order, page by page, honouring the resume cursor;
 *   - upsert on (integrationId, sourceId) so a re-run is idempotent;
 *   - record every page's progress in the checkpoint, so an interrupted run
 *     resumes instead of re-reading the full history;
 *   - record the run outcome ONLY after it actually happened;
 *   - keep one provider's failure from stopping the others.
 *
 * Nothing here writes to a source system. Every call is a read.
 */

const ADAPTERS: Record<string, ProviderAdapter> = {
  QUICKBOOKS: quickBooksAdapter,
  METHOD_CRM: methodAdapter,
  SHOPIFY: shopifyAdapter,
}

/** Hard ceiling per entity per run, so one run cannot loop forever. */
const MAX_PAGES_PER_ENTITY = 400

export interface SyncOptions {
  trigger: SyncTrigger
  /** Ignore the checkpoint and re-read the full history window. */
  fullBackfill?: boolean
  /** Limit the run to specific entities. */
  entities?: SyncEntity[]
  triggeredByUserId?: string
  signal?: AbortSignal
}

export interface ProviderSyncResult {
  provider: IntegrationProvider
  displayName: string
  ok: boolean
  entities: EntityResult[]
  totalRead: number
  totalCreated: number
  totalUpdated: number
  totalFailed: number
  apiRequests: number
  durationMs: number
  error: string | null
}

export function adapterFor(provider: IntegrationProvider): ProviderAdapter | null {
  return ADAPTERS[provider] ?? null
}

export function providerConfigured(provider: IntegrationProvider): boolean {
  switch (provider) {
    case 'QUICKBOOKS':
      return integrationEnv.quickbooks().configured
    case 'METHOD_CRM':
      return integrationEnv.method().configured
    case 'SHOPIFY':
      return integrationEnv.shopify().configured
    case 'MONDAY':
      return integrationEnv.monday().configured && integrationEnv.monday().enabled
    default:
      return false
  }
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

/**
 * Syncs every enabled provider.
 *
 * Providers run sequentially and independently: a QuickBooks failure must not
 * prevent Shopify from syncing, so each one is wrapped and its outcome
 * recorded on its own.
 */
export async function syncAllProviders(options: SyncOptions): Promise<ProviderSyncResult[]> {
  const integrations = await db.many<IntegrationRow>(sql`
    SELECT * FROM "Integration" WHERE "isEnabled" = true ORDER BY "provider" ASC`)

  const results: ProviderSyncResult[] = []
  for (const integration of integrations) {
    if (options.signal?.aborted) break
    results.push(await syncProvider(integration.provider, options))
  }
  return results
}

export async function syncProvider(
  provider: IntegrationProvider,
  options: SyncOptions,
): Promise<ProviderSyncResult> {
  const started = Date.now()
  const adapter = adapterFor(provider)

  const integration = await findIntegration(provider)
  if (!integration) {
    return failure(provider, provider, 'This integration has not been configured yet.', started)
  }

  if (!adapter) {
    return failure(
      provider,
      integration.displayName,
      `No adapter is implemented for ${provider}.`,
      started,
    )
  }

  await db.exec(sql`UPDATE "Integration" SET "lastAttemptAt" = ${new Date()} WHERE "id" = ${integration.id}`)

  const counter: RequestCounter = { count: 0 }
  const entityResults: EntityResult[] = []
  let fatalError: string | null = null

  const entities = options.entities
    ? adapter.entities.filter((e) => options.entities!.includes(e))
    : adapter.entities

  const divisionRules = await loadDivisionRules(db, provider)

  for (const entity of entities) {
    if (options.signal?.aborted) break

    const runRow = await insert<{ id: string }>('SyncRun', {
      integrationId: integration.id,
      entity,
      trigger: options.trigger,
      status: 'RUNNING',
      triggeredByUserId: options.triggeredByUserId ?? null,
    })

    const entityStarted = Date.now()

    try {
      const result = await syncEntity(adapter, integration.id, entity, {
        ...options,
        counter,
        divisionRules,
        historyMonths: integration.historyMonths,
      })
      entityResults.push(result)

      const status = result.failed > 0 ? 'PARTIAL' : 'SUCCEEDED'
      await db.exec(sql`
        UPDATE "SyncRun" SET
          "status" = ${status},
          "finishedAt" = ${new Date()},
          "durationMs" = ${Date.now() - entityStarted},
          "recordsRead" = ${result.read},
          "recordsCreated" = ${result.created},
          "recordsUpdated" = ${result.updated},
          "recordsSkipped" = ${result.skipped},
          "recordsFailed" = ${result.failed},
          "apiRequests" = ${counter.count},
          "errorSummary" = ${
            result.failed > 0
              ? `${result.failed} of ${result.read} records could not be imported. See the error list.`
              : null
          }
        WHERE "id" = ${runRow.id}`)

      if (result.errors.length > 0) {
        await insertMany(
          'SyncError',
          result.errors.slice(0, 200).map((error) => ({
            syncRunId: runRow.id,
            entity,
            sourceId: error.sourceId,
            errorCode: error.code ?? null,
            message: error.message,
            isRetryable: error.retryable,
          })),
        )
      }
    } catch (error) {
      const message = describeError(error)
      fatalError = message

      await db.exec(sql`
        UPDATE "SyncRun" SET
          "status" = ${'FAILED'},
          "finishedAt" = ${new Date()},
          "durationMs" = ${Date.now() - entityStarted},
          "apiRequests" = ${counter.count},
          "errorSummary" = ${message}
        WHERE "id" = ${runRow.id}`)
      await insert('SyncError', {
        syncRunId: runRow.id,
        entity,
        message,
        isRetryable: !(error instanceof ProviderAuthError),
        errorCode: error instanceof ProviderHttpError ? String(error.status) : null,
      })

      // An auth failure will repeat for every remaining entity, so stop here
      // rather than burning the rate limit on calls that cannot succeed.
      if (error instanceof ProviderAuthError) break
    }
  }

  const totals = entityResults.reduce(
    (acc, r) => ({
      read: acc.read + r.read,
      created: acc.created + r.created,
      updated: acc.updated + r.updated,
      failed: acc.failed + r.failed,
    }),
    { read: 0, created: 0, updated: 0, failed: 0 },
  )

  const ok = fatalError === null
  const now = new Date()

  // A sync is only marked successful once its outcome is known. A run that
  // threw never updates `lastSuccessAt`.
  await db.exec(
    ok
      ? sql`
          UPDATE "Integration" SET
            "status" = ${totals.failed > 0 ? 'DEGRADED' : 'CONNECTED'},
            "lastSuccessAt" = ${now},
            "lastErrorAt" = ${totals.failed > 0 ? now : integration.lastErrorAt},
            "lastErrorMessage" = ${
              totals.failed > 0 ? `${totals.failed} records could not be imported in the last run.` : null
            },
            "consecutiveFailures" = 0
          WHERE "id" = ${integration.id}`
      : sql`
          UPDATE "Integration" SET
            "status" = ${'ERROR'},
            "lastErrorAt" = ${now},
            "lastErrorMessage" = ${fatalError},
            "consecutiveFailures" = "consecutiveFailures" + 1
          WHERE "id" = ${integration.id}`,
  )

  return {
    provider,
    displayName: integration.displayName,
    ok,
    entities: entityResults,
    totalRead: totals.read,
    totalCreated: totals.created,
    totalUpdated: totals.updated,
    totalFailed: totals.failed,
    apiRequests: counter.count,
    durationMs: Date.now() - started,
    error: fatalError,
  }
}

function findIntegration(provider: IntegrationProvider): Promise<IntegrationRow | null> {
  return db.maybeOne<IntegrationRow>(sql`SELECT * FROM "Integration" WHERE "provider" = ${provider}`)
}

function failure(
  provider: IntegrationProvider,
  displayName: string,
  message: string,
  started: number,
): ProviderSyncResult {
  return {
    provider,
    displayName,
    ok: false,
    entities: [],
    totalRead: 0,
    totalCreated: 0,
    totalUpdated: 0,
    totalFailed: 0,
    apiRequests: 0,
    durationMs: Date.now() - started,
    error: message,
  }
}

// ---------------------------------------------------------------------------
// Entity loop
// ---------------------------------------------------------------------------

interface EntityOptions extends SyncOptions {
  counter: RequestCounter
  divisionRules: DivisionRule[]
  historyMonths: number
}

async function syncEntity(
  adapter: ProviderAdapter,
  integrationId: string,
  entity: SyncEntity,
  options: EntityOptions,
): Promise<EntityResult> {
  const checkpoint = await db.maybeOne<SyncCheckpointRow>(sql`
    SELECT * FROM "SyncCheckpoint" WHERE "integrationId" = ${integrationId} AND "entity" = ${entity}`)

  const now = new Date()
  const historyStart = startOfDayInZone(addMonths(now, -options.historyMonths))

  // Incremental by default; a backfill re-reads the configured window. A small
  // overlap avoids missing a record written while the previous run was going.
  const since = options.fullBackfill
    ? historyStart
    : checkpoint?.lastRecordAt
      ? new Date(checkpoint.lastRecordAt.getTime() - 5 * 60 * 1000)
      : historyStart

  const result: EntityResult = {
    entity,
    read: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    errors: [],
    nextCursor: null,
    lastRecordAt: checkpoint?.lastRecordAt ?? null,
  }

  let cursor = options.fullBackfill ? null : (checkpoint?.cursor ?? null)
  let pages = 0

  while (pages < MAX_PAGES_PER_ENTITY) {
    if (options.signal?.aborted) break
    pages++

    const context: SyncContext = {
      integrationId,
      provider: adapter.provider,
      since,
      until: now,
      cursor,
      counter: options.counter,
      signal: options.signal,
      log: (message) => console.info(`[sync:${adapter.provider}:${entity}] ${message}`),
      onRetry: ({ attempt, delayMs, reason }) =>
        console.warn(
          `[sync:${adapter.provider}:${entity}] attempt ${attempt} failed (${reason}); retrying in ${delayMs}ms`,
        ),
    }

    const page = await fetchPage(adapter, entity, context)
    if (!page) break

    for (const item of page.items) {
      result.read++
      try {
        const outcome = await persist(adapter, integrationId, entity, item, options)
        if (outcome === 'created') result.created++
        else if (outcome === 'updated') result.updated++
        else result.skipped++

        const updatedAt = recordTimestamp(item)
        if (updatedAt && (!result.lastRecordAt || updatedAt > result.lastRecordAt)) {
          result.lastRecordAt = updatedAt
        }
      } catch (error) {
        result.failed++
        result.errors.push({
          sourceId: typeof item === 'object' && item && 'sourceId' in item ? String(item.sourceId) : null,
          message: describeError(error),
          retryable: !(error instanceof ProviderAuthError),
        })
      }
    }

    // Persist progress after every page, so an interrupted run resumes here.
    cursor = page.nextCursor
    await upsert(
      'SyncCheckpoint',
      ['integrationId', 'entity'],
      { integrationId, entity, cursor, lastRecordAt: result.lastRecordAt },
      { cursor, lastRecordAt: result.lastRecordAt },
    )

    if (!cursor) break
  }

  if (pages >= MAX_PAGES_PER_ENTITY && cursor) {
    result.errors.push({
      sourceId: null,
      message: `Stopped after ${MAX_PAGES_PER_ENTITY} pages to avoid an unbounded run. The next scheduled sync will resume from the saved checkpoint.`,
      retryable: true,
    })
  }

  // The cursor is cleared once the entity is fully walked, so the next
  // incremental run starts from `lastRecordAt` rather than mid-history.
  if (!cursor) {
    await upsert(
      'SyncCheckpoint',
      ['integrationId', 'entity'],
      { integrationId, entity, cursor: null, lastRecordAt: result.lastRecordAt, backfillDoneTo: now },
      { cursor: null, lastRecordAt: result.lastRecordAt, backfillDoneTo: now },
    )
  }

  result.nextCursor = cursor
  return result
}

async function fetchPage(adapter: ProviderAdapter, entity: SyncEntity, context: SyncContext) {
  switch (entity) {
    case 'customers':
      return adapter.fetchCustomers ? adapter.fetchCustomers(context) : null
    case 'invoices':
      return adapter.fetchInvoices ? adapter.fetchInvoices(context) : null
    case 'payments':
      return adapter.fetchPayments ? adapter.fetchPayments(context) : null
    case 'quotes':
      return adapter.fetchQuotes ? adapter.fetchQuotes(context) : null
    case 'orders':
      return adapter.fetchOrders ? adapter.fetchOrders(context) : null
    case 'accounts':
      return adapter.fetchAccounts ? adapter.fetchAccounts(context) : null
    case 'cogs':
      return adapter.fetchCogs ? adapter.fetchCogs(context) : null
    default:
      return null
  }
}

function recordTimestamp(item: unknown): Date | null {
  if (typeof item !== 'object' || item === null) return null
  const record = item as Record<string, unknown>
  for (const key of ['sourceUpdatedAt', 'placedAt', 'issuedOn', 'receivedOn']) {
    const value = record[key]
    if (value instanceof Date) return value
  }
  return null
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

type PersistOutcome = 'created' | 'updated' | 'skipped'

async function persist(
  adapter: ProviderAdapter,
  integrationId: string,
  entity: SyncEntity,
  item: unknown,
  options: EntityOptions,
): Promise<PersistOutcome> {
  switch (entity) {
    case 'customers':
      return persistCustomer(integrationId, adapter.provider, item as never)
    case 'invoices':
      return persistInvoice(integrationId, item as never, options.divisionRules)
    case 'payments':
      return persistPayment(integrationId, item as never)
    case 'quotes':
      return persistQuote(integrationId, item as never, options.divisionRules)
    case 'orders':
      return persistOrder(integrationId, item as never)
    case 'cogs':
      return persistCostPeriod(item as never, options.divisionRules)
    default:
      return 'skipped'
  }
}

/**
 * One month of direct cost, attributed to divisions with the same mapping
 * rules as invoices. Every active division gets a row for the month, so an
 * approved month with no cost still counts as covered rather than missing.
 *
 * A changed figure withdraws an existing approval: Finance approved the old
 * number, not the new one.
 */
async function persistCostPeriod(
  period: import('./types').NormalizedCostPeriod,
  rules: DivisionRule[],
): Promise<PersistOutcome> {
  const totals = new Map<string, { amount: number; sources: unknown[] }>()
  const unassigned: string[] = []
  for (const group of period.groups) {
    const divisionId = resolveDivision(rules, group.mappingFields)
    if (!divisionId) {
      if (group.amount !== 0) unassigned.push(`${group.label} (${group.amount.toFixed(2)})`)
      continue
    }
    const total = totals.get(divisionId) ?? { amount: 0, sources: [] }
    total.amount = Math.round((total.amount + group.amount) * 100) / 100
    total.sources.push({ group: group.label, amount: group.amount, accounts: group.accounts })
    totals.set(divisionId, total)
  }
  if (unassigned.length > 0) {
    console.warn(
      `[sync:cogs] ${toIsoDate(period.periodStart)}: direct cost matched no division and was left out: ${unassigned.join(', ')}. Add a division mapping rule for it.`,
    )
  }

  const divisions = await db.many<{ id: string }>(sql`SELECT "id" FROM "Division" WHERE "isActive" = true`)
  const periodStart = toIsoDate(period.periodStart)
  const periodEnd = toIsoDate(period.periodEnd)
  let outcome: PersistOutcome = 'skipped'

  for (const division of divisions) {
    const total = totals.get(division.id) ?? { amount: 0, sources: [] }
    const existing = await db.maybeOne<DivisionCostRow>(sql`
      SELECT * FROM "DivisionCost" WHERE "divisionId" = ${division.id} AND "periodStart" = ${periodStart}`)

    if (!existing) {
      await insert('DivisionCost', {
        divisionId: division.id,
        periodStart,
        periodEnd,
        cogsAmount: total.amount,
        currency: period.currency,
        sourceAccounts: json(total.sources),
        basis: period.basis,
        isApproved: false,
      })
      outcome = 'created'
      continue
    }

    if (Math.abs(Number(existing.cogsAmount) - total.amount) <= 0.005) continue

    const note = existing.isApproved
      ? `Figure changed from ${Number(existing.cogsAmount).toFixed(2)} to ${total.amount.toFixed(2)} on sync; the approval was withdrawn.`
      : null
    await db.exec(sql`
      UPDATE "DivisionCost" SET
        "cogsAmount" = ${total.amount},
        "currency" = ${period.currency},
        "sourceAccounts" = ${json(total.sources)},
        "basis" = ${period.basis},
        "isApproved" = false,
        "approvedBy" = NULL,
        "approvedAt" = NULL,
        "note" = ${note},
        "updatedAt" = ${new Date()}
      WHERE "id" = ${existing.id}`)
    outcome = 'updated'
  }
  return outcome
}

async function persistCustomer(
  integrationId: string,
  provider: IntegrationProvider,
  source: import('./types').NormalizedCustomer,
): Promise<PersistOutcome> {
  const { created } = await resolveCustomer(db, integrationId, provider, source)
  return created ? 'created' : 'updated'
}

async function persistInvoice(
  integrationId: string,
  invoice: import('./types').NormalizedInvoice,
  rules: DivisionRule[],
): Promise<PersistOutcome> {
  const customerId = await linkedCustomerId(db, integrationId, invoice.customerSourceId)
  const salesRepId = await resolveSalesRep(
    db,
    integrationId,
    invoice.salesRepSourceId,
    invoice.salesRepName,
  )
  const divisionId = resolveDivision(rules, invoice.mappingFields)

  const existing = await findBySourceId(db, 'Invoice', integrationId, invoice.sourceId)

  // The whole invoice plus its lines is written in one transaction, so a
  // partially-written invoice can never be read by the analytics layer.
  await transaction(async (tx) => {
    const data = {
      sourceDocNumber: invoice.docNumber,
      customerId,
      divisionId,
      salesRepId,
      status: invoice.status,
      issuedOn: invoice.issuedOn,
      dueOn: invoice.dueOn,
      currency: invoice.currency,
      exchangeRate: invoice.exchangeRate,
      subtotal: invoice.subtotal,
      taxTotal: invoice.taxTotal,
      total: invoice.total,
      amountPaid: invoice.amountPaid,
      balance: invoice.balance,
      revenueAmount: invoice.revenueAmount,
      memo: invoice.memo,
      sourceCreatedAt: invoice.sourceCreatedAt,
      sourceUpdatedAt: invoice.sourceUpdatedAt,
      syncedAt: new Date(),
    }

    const row = await upsert<{ id: string }>(
      'Invoice',
      ['integrationId', 'sourceId'],
      { integrationId, sourceId: invoice.sourceId, ...data },
      data,
      tx,
    )

    // Lines are replaced wholesale: a line removed upstream must disappear
    // here too, and matching them individually would be more fragile.
    await tx.exec(sql`DELETE FROM "InvoiceLine" WHERE "invoiceId" = ${row.id}`)
    if (invoice.lines.length > 0) {
      await insertMany(
        'InvoiceLine',
        invoice.lines.map((line) => ({
          invoiceId: row.id,
          sourceLineId: line.sourceLineId,
          lineNumber: line.lineNumber,
          description: line.description,
          itemSourceId: line.itemSourceId,
          itemName: line.itemName,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          amount: line.amount,
          divisionId,
        })),
        tx,
      )
    }
  })

  return existing ? 'updated' : 'created'
}

async function persistPayment(
  integrationId: string,
  payment: import('./types').NormalizedPayment,
): Promise<PersistOutcome> {
  const customerId = await linkedCustomerId(db, integrationId, payment.customerSourceId)

  const existing = await findBySourceId(db, 'Payment', integrationId, payment.sourceId)

  await transaction(async (tx) => {
    const data = {
      customerId,
      receivedOn: payment.receivedOn,
      currency: payment.currency,
      amount: payment.amount,
      method: payment.method,
      reference: payment.reference,
      sourceUpdatedAt: payment.sourceUpdatedAt,
      syncedAt: new Date(),
    }

    const row = await upsert<{ id: string }>(
      'Payment',
      ['integrationId', 'sourceId'],
      { integrationId, sourceId: payment.sourceId, ...data },
      data,
      tx,
    )

    await tx.exec(sql`DELETE FROM "PaymentApplication" WHERE "paymentId" = ${row.id}`)

    for (const application of payment.applications) {
      const invoice = await findBySourceId(tx, 'Invoice', integrationId, application.invoiceSourceId)
      // A payment can arrive before its invoice has been imported. Skipping
      // the link is correct: the next sync picks it up once the invoice
      // exists, and the invoice balance comes from QuickBooks regardless.
      if (!invoice) continue
      await insert('PaymentApplication', { paymentId: row.id, invoiceId: invoice.id, amount: application.amount }, tx)
    }
  })

  return existing ? 'updated' : 'created'
}

async function persistQuote(
  integrationId: string,
  quote: import('./types').NormalizedQuote,
  rules: DivisionRule[],
): Promise<PersistOutcome> {
  const customerId = await linkedCustomerId(db, integrationId, quote.customerSourceId)
  const salesRepId = await resolveSalesRep(db, integrationId, quote.salesRepSourceId, quote.salesRepName)
  const divisionId = resolveDivision(rules, quote.mappingFields)

  const existing = await findBySourceId(db, 'Quote', integrationId, quote.sourceId)

  await transaction(async (tx) => {
    const data = {
      sourceDocNumber: quote.docNumber,
      customerId,
      divisionId,
      salesRepId,
      status: quote.status,
      stage: quote.stage,
      stageNormalized: quote.stageNormalized,
      currency: quote.currency,
      amount: quote.amount,
      issuedOn: quote.issuedOn,
      expiresOn: quote.expiresOn,
      closedOn: quote.closedOn,
      lastActivityAt: quote.lastActivityAt,
      sourceCreatedAt: quote.sourceCreatedAt,
      sourceUpdatedAt: quote.sourceUpdatedAt,
      syncedAt: new Date(),
    }

    const row = await upsert<{ id: string }>(
      'Quote',
      ['integrationId', 'sourceId'],
      { integrationId, sourceId: quote.sourceId, ...data },
      data,
      tx,
    )

    await tx.exec(sql`DELETE FROM "QuoteLine" WHERE "quoteId" = ${row.id}`)
    if (quote.lines.length > 0) {
      await insertMany(
        'QuoteLine',
        quote.lines.map((line) => ({
          quoteId: row.id,
          sourceLineId: line.sourceLineId,
          lineNumber: line.lineNumber,
          description: line.description,
          itemName: line.itemName,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          amount: line.amount,
        })),
        tx,
      )
    }
  })

  return existing ? 'updated' : 'created'
}

export async function persistOrder(
  integrationId: string,
  order: import('./types').NormalizedOrder,
): Promise<PersistOutcome> {
  const customerId = await linkedCustomerId(db, integrationId, order.customerSourceId)
  const divisionId = await ecoLedMartDivisionId(db)

  const existing = await findBySourceId(db, 'ShopifyOrder', integrationId, order.sourceId)

  await transaction(async (tx) => {
    const data = {
      orderNumber: order.orderNumber,
      customerId,
      divisionId,
      email: order.email,
      financialStatus: order.financialStatus,
      fulfillmentStatus: order.fulfillmentStatus,
      currency: order.currency,
      subtotalPrice: order.subtotalPrice,
      totalDiscounts: order.totalDiscounts,
      totalTax: order.totalTax,
      totalShipping: order.totalShipping,
      totalRefunded: order.totalRefunded,
      totalPrice: order.totalPrice,
      netSalesAmount: order.netSalesAmount,
      placedAt: order.placedAt,
      cancelledAt: order.cancelledAt,
      closedAt: order.closedAt,
      sourceUpdatedAt: order.sourceUpdatedAt,
      syncedAt: new Date(),
    }

    const row = await upsert<{ id: string }>(
      'ShopifyOrder',
      ['integrationId', 'sourceId'],
      { integrationId, sourceId: order.sourceId, ...data },
      data,
      tx,
    )

    await tx.exec(sql`DELETE FROM "ShopifyOrderLine" WHERE "orderId" = ${row.id}`)
    if (order.lines.length > 0) {
      await insertMany(
        'ShopifyOrderLine',
        order.lines.map((line) => ({
          orderId: row.id,
          sourceLineId: line.sourceLineId,
          lineNumber: line.lineNumber,
          productSourceId: line.productSourceId,
          variantSourceId: line.variantSourceId,
          sku: line.sku,
          title: line.title,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          discount: line.discount,
          amount: line.amount,
        })),
        tx,
      )
    }
  })

  return existing ? 'updated' : 'created'
}

/**
 * Id of a synced record by its composite unique key (integrationId, sourceId).
 * `table` is always a literal from this file, never input.
 */
function findBySourceId(
  q: Queryable,
  table: 'Invoice' | 'Payment' | 'Quote' | 'ShopifyOrder',
  integrationId: string,
  sourceId: string,
): Promise<{ id: string } | null> {
  return q.maybeOne<{ id: string }>(sql`
    SELECT "id" FROM ${sql.id(table)} WHERE "integrationId" = ${integrationId} AND "sourceId" = ${sourceId}`)
}

/** Verifies credentials without importing anything. */
export async function testProviderConnection(
  provider: IntegrationProvider,
): Promise<{ ok: boolean; detail: string }> {
  const adapter = adapterFor(provider)
  const integration = await findIntegration(provider)

  if (!adapter || !integration) {
    return { ok: false, detail: 'This integration has not been set up yet.' }
  }

  const counter: RequestCounter = { count: 0 }
  try {
    return await adapter.testConnection({
      integrationId: integration.id,
      provider,
      since: null,
      until: new Date(),
      cursor: null,
      counter,
      log: () => undefined,
      onRetry: () => undefined,
    })
  } catch (error) {
    return { ok: false, detail: describeError(error) }
  }
}
