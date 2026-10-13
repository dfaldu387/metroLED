import { prisma, databaseReachable } from '../db'
import { demoDataAllowed } from '../env'
import { loadDataset, loadSettings } from '../data/dataset'
import {
  addDays,
  endOfDayInZone,
  previousBusinessDate,
  startOfDayInZone,
  toIsoDate,
  formatRelativeTime,
} from '../dates'
import { sumRevenue } from '../analytics/revenue'
import { newlyOverdue, receivablesSummary } from '../analytics/receivables'
import { staleQuotes, pipelineSummary } from '../analytics/pipeline'
import { ecommerceSummary } from '../analytics/ecommerce'
import { describeFreshness } from '../analytics/overview'
import type { AccessScope } from '../auth/guards'

/**
 * Daily executive brief generation (section 12).
 *
 * The brief is generated ONCE per business date and stored as a structured
 * payload. The Daily Brief page and the email both render that same payload,
 * which is what guarantees the two can never disagree about a number.
 *
 * Missing or stale data is reported explicitly in `warnings` rather than being
 * silently rendered as zero.
 */

export interface BriefDivisionLine {
  divisionId: string
  name: string
  code: string
  revenue: number
  invoiceCount: number
}

export interface BriefOverdueLine {
  invoiceId: string
  docNumber: string
  customerName: string
  divisionName: string | null
  balance: number
  dueOn: string
  daysOverdue: number
}

export interface BriefQuoteLine {
  quoteId: string
  docNumber: string
  customerName: string
  ownerName: string | null
  amount: number
  daysIdle: number
}

export interface BriefSyncLine {
  provider: string
  displayName: string
  status: string
  lastSuccessLabel: string
  isStale: boolean
  errorMessage: string | null
}

export interface BriefPayload {
  briefDate: string
  generatedAt: string
  timezone: string
  dataMode: 'live' | 'demo' | 'unavailable'

  revenue: {
    total: number
    invoiceCount: number
    byDivision: BriefDivisionLine[]
    previousBusinessDayTotal: number | null
  }

  cash: {
    collected: number
    paymentCount: number
  }

  receivables: {
    totalOutstanding: number
    overdueAmount: number
    overdueCount: number
    newlyOverdue: BriefOverdueLine[]
    newlyOverdueTotal: number
  }

  pipeline: {
    openValue: number
    openCount: number
    newlyStale: BriefQuoteLine[]
    newlyStaleTotal: number
    staleThresholdDays: number
  }

  ecommerce: {
    netSales: number
    orderCount: number
    averageOrderValue: number | null
    available: boolean
  }

  sync: {
    healthy: boolean
    summary: string
    sources: BriefSyncLine[]
  }

  warnings: string[]
}

/**
 * The brief reports the whole business, so it is generated with an
 * unrestricted scope. Per-recipient filtering is NOT applied: the recipient
 * list is controlled by an administrator and contains executives only.
 */
const FULL_SCOPE: AccessScope = {
  userId: 'system',
  isDemo: false,
  divisionIds: null,
  restrictToSalesRepId: null,
  canSeeMargin: true,
  canSeeAllReps: true,
  canSeeCustomers: true,
  canSeeReceivables: true,
  canSeeEcommerce: true,
  canSeePipeline: true,
  canSeeRevenue: true,
}

export async function buildBriefPayload(options: { briefDate?: Date; now?: Date } = {}): Promise<BriefPayload> {
  const now = options.now ?? new Date()
  const settings = await loadSettings()
  const briefDate = options.briefDate ?? previousBusinessDate(now, settings.timezone)

  const dayStart = startOfDayInZone(briefDate, settings.timezone)
  const dayEnd = endOfDayInZone(briefDate, settings.timezone)
  const dayRange = { start: dayStart, end: dayEnd }

  const previousDay = previousBusinessDate(addDays(briefDate, 1) > now ? briefDate : briefDate, settings.timezone)
  const priorBusinessDay = previousBusinessDate(briefDate, settings.timezone)
  const priorRange = {
    start: startOfDayInZone(priorBusinessDay, settings.timezone),
    end: endOfDayInZone(priorBusinessDay, settings.timezone),
  }
  void previousDay

  const dataset = await loadDataset(FULL_SCOPE, { now, months: 24 })
  const warnings: string[] = []

  if (dataset.mode === 'demo') {
    warnings.push(
      'This brief was generated from the labelled demo dataset, not from live business data. Do not act on these figures.',
    )
  }
  if (dataset.mode === 'unavailable') {
    warnings.push('No business data could be loaded, so every figure in this brief is unavailable.')
  }
  if (dataset.freshness.isStale) {
    warnings.push(
      `Figures may be incomplete: ${dataset.freshness.staleSources.join(', ')} ${dataset.freshness.staleSources.length === 1 ? 'has' : 'have'} not synced recently.`,
    )
  }

  // --- Revenue -------------------------------------------------------------
  const dayInvoices = dataset.invoices.filter(
    (i) => i.issuedOn >= dayStart && i.issuedOn <= dayEnd && ['OPEN', 'PARTIALLY_PAID', 'PAID'].includes(i.status),
  )
  const revenueTotal = sumRevenue(dataset.invoices, dayRange)
  const priorTotal = sumRevenue(dataset.invoices, priorRange)

  const divisionTotals = new Map<string, BriefDivisionLine>()
  for (const invoice of dayInvoices) {
    const key = invoice.divisionId ?? '__unassigned__'
    const entry = divisionTotals.get(key) ?? {
      divisionId: key,
      name: invoice.divisionName ?? 'Unassigned',
      code: invoice.divisionCode ?? 'UNASSIGNED',
      revenue: 0,
      invoiceCount: 0,
    }
    entry.revenue += invoice.revenueAmount
    entry.invoiceCount++
    divisionTotals.set(key, entry)
  }

  // --- Cash collected ------------------------------------------------------
  let collected = 0
  let paymentCount = 0
  if (await databaseReachable()) {
    try {
      const payments = await prisma.payment.aggregate({
        where: { receivedOn: { gte: dayStart, lte: dayEnd } },
        _sum: { amount: true },
        _count: { _all: true },
      })
      collected = Number(payments._sum.amount ?? 0)
      paymentCount = payments._count._all
    } catch {
      warnings.push('Cash collected could not be read from the database for this date.')
    }
  } else if (dataset.mode === 'demo') {
    // In demo mode, approximate collections from the day's paid invoices so
    // the brief has a plausible figure. Clearly labelled as demo above.
    const paid = dayInvoices.filter((i) => i.status === 'PAID')
    collected = paid.reduce((acc, i) => acc + i.total, 0)
    paymentCount = paid.length
  }

  // --- Receivables ---------------------------------------------------------
  const ar = receivablesSummary(dataset.invoices, dayEnd)
  const newOverdue = newlyOverdue(dataset.invoices, dayStart, dayEnd)

  // --- Pipeline ------------------------------------------------------------
  const pipeline = pipelineSummary(dataset.quotes, dayEnd, {
    staleThresholdDays: settings.staleQuoteDays,
    largeQuoteAmount: settings.largeQuoteAmount,
  })
  // "Newly stale" means it crossed the threshold on this date, so the brief
  // reports a change rather than repeating the same list every morning.
  const newlyStale = staleQuotes(dataset.quotes, dayEnd, settings.staleQuoteDays).filter(
    (q) => q.daysIdle === settings.staleQuoteDays || q.amount >= settings.largeQuoteAmount,
  )

  // --- E-commerce ----------------------------------------------------------
  const shopify = dataset.integrations.find((i) => i.provider === 'SHOPIFY')
  const ecommerceAvailable = Boolean(shopify?.isEnabled) || dataset.orders.length > 0
  const ecommerce = ecommerceSummary(dataset.orders, dayRange)
  if (!ecommerceAvailable) {
    warnings.push('Shopify is not connected, so Eco LED Mart figures are unavailable.')
  }

  // --- Sync health ---------------------------------------------------------
  const syncLines: BriefSyncLine[] = dataset.integrations.map((integration) => ({
    provider: integration.provider,
    displayName: integration.displayName,
    status: integration.status,
    lastSuccessLabel: formatRelativeTime(integration.lastSuccessAt, now),
    isStale: integration.isStale,
    errorMessage: integration.lastErrorMessage,
  }))
  const syncHealthy = syncLines.every((s) => !s.isStale && s.status !== 'ERROR')

  return {
    briefDate: toIsoDate(dayStart),
    generatedAt: now.toISOString(),
    timezone: settings.timezone,
    dataMode: dataset.mode,

    revenue: {
      total: revenueTotal,
      invoiceCount: dayInvoices.length,
      byDivision: [...divisionTotals.values()]
        .map((d) => ({ ...d, revenue: Math.round(d.revenue * 100) / 100 }))
        .sort((a, b) => b.revenue - a.revenue),
      previousBusinessDayTotal: priorTotal > 0 ? priorTotal : null,
    },

    cash: {
      collected: Math.round(collected * 100) / 100,
      paymentCount,
    },

    receivables: {
      totalOutstanding: ar.totalOutstanding,
      overdueAmount: ar.overdueAmount,
      overdueCount: ar.overdueInvoiceCount,
      newlyOverdue: newOverdue.slice(0, 10).map((invoice) => ({
        invoiceId: invoice.id,
        docNumber: invoice.docNumber,
        customerName: invoice.customerName ?? 'Unknown customer',
        divisionName: invoice.divisionName,
        balance: invoice.balance,
        dueOn: invoice.dueOn ? toIsoDate(invoice.dueOn) : '',
        daysOverdue: invoice.dueOn
          ? Math.max(0, Math.round((dayEnd.getTime() - invoice.dueOn.getTime()) / 86400000))
          : 0,
      })),
      newlyOverdueTotal: Math.round(newOverdue.reduce((acc, i) => acc + i.balance, 0) * 100) / 100,
    },

    pipeline: {
      openValue: pipeline.openValue,
      openCount: pipeline.openCount,
      newlyStale: newlyStale.slice(0, 10).map((quote) => ({
        quoteId: quote.id,
        docNumber: quote.docNumber,
        customerName: quote.customerName ?? 'Unknown customer',
        ownerName: quote.salesRepName,
        amount: quote.amount,
        daysIdle: quote.daysIdle,
      })),
      newlyStaleTotal: Math.round(newlyStale.reduce((acc, q) => acc + q.amount, 0) * 100) / 100,
      staleThresholdDays: settings.staleQuoteDays,
    },

    ecommerce: {
      netSales: ecommerce.netSales,
      orderCount: ecommerce.orderCount,
      averageOrderValue: ecommerce.averageOrderValue,
      available: ecommerceAvailable,
    },

    sync: {
      healthy: syncHealthy,
      summary: describeFreshness(dataset, now),
      sources: syncLines,
    },

    warnings,
  }
}

/**
 * Generates and stores the brief for a date.
 *
 * Idempotent on `briefDate`: calling it twice regenerates the content but
 * never creates a second brief row, which is what keeps the "one brief per
 * business day" guarantee even if the scheduler fires twice.
 */
export async function generateAndStoreBrief(options: { briefDate?: Date; now?: Date } = {}): Promise<{
  briefId: string
  payload: BriefPayload
  regenerated: boolean
}> {
  const started = Date.now()
  const payload = await buildBriefPayload(options)
  const briefDate = new Date(`${payload.briefDate}T00:00:00.000Z`)

  if (!(await databaseReachable())) {
    if (!demoDataAllowed()) {
      throw new Error('The database is unreachable, so the daily brief cannot be stored.')
    }
    return { briefId: `demo-${payload.briefDate}`, payload, regenerated: false }
  }

  const existing = await prisma.dailyBrief.findUnique({ where: { briefDate }, select: { id: true } })
  const { subject, html, text } = await import('./render').then((m) => m.renderBrief(payload))

  const row = await prisma.dailyBrief.upsert({
    where: { briefDate },
    create: {
      briefDate,
      status: 'GENERATED',
      generatedAt: new Date(),
      payload: payload as never,
      subject,
      htmlBody: html,
      textBody: text,
      dataWarnings: payload.warnings,
      generationMs: Date.now() - started,
    },
    update: {
      status: 'GENERATED',
      generatedAt: new Date(),
      payload: payload as never,
      subject,
      htmlBody: html,
      textBody: text,
      dataWarnings: payload.warnings,
      generationMs: Date.now() - started,
      errorMessage: null,
    },
    select: { id: true },
  })

  return { briefId: row.id, payload, regenerated: Boolean(existing) }
}
