import { addMonths, endOfMonth, startOfMonth, toIsoDate, type DateRange } from '../dates'
import { round2, sumRevenue } from './revenue'
import type { CostRecord, DivisionRef, InvoiceRecord } from '../types'

/**
 * Gross margin analytics (section 10).
 *
 * Formula approved by Farida:
 *   Gross Profit     = Revenue − Cost of Goods Sold
 *   Gross Margin %   = (Gross Profit / Revenue) × 100
 *
 * Two rules are enforced here rather than left to the view:
 *
 *  1. A margin is only reported when an APPROVED cost figure covers the whole
 *     period. If any month in the period has no approved cost, the result is
 *     marked unavailable and carries the reason. A partial cost base would
 *     overstate margin, which is worse than showing nothing.
 *
 *  2. Operating expenses are never included. Only the QuickBooks accounts
 *     flagged as direct cost feed `DivisionCost`.
 *
 * Phase 1 reports margin by division only. Profit per project is out of scope.
 */

export type MarginAvailability = 'available' | 'unavailable'

export interface MarginResult {
  availability: MarginAvailability
  revenue: number
  cogs: number | null
  grossProfit: number | null
  grossMarginPercent: number | null
  /** Why the figure is unavailable, in plain language. */
  reason?: string
  /** Months inside the period that have no approved cost figure. */
  missingCostMonths: string[]
  costBasis: string | null
}

const NO_REVENUE_REASON =
  'There is no revenue in this period, so a margin percentage cannot be calculated.'

function monthsInRange(range: DateRange): Date[] {
  const months: Date[] = []
  let cursor = startOfMonth(range.start)
  const last = startOfMonth(range.end)
  let guard = 0
  while (cursor <= last && guard++ < 240) {
    months.push(cursor)
    cursor = startOfMonth(addMonths(cursor, 1))
  }
  return months
}

function monthLabel(date: Date): string {
  return new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date)
}

/**
 * Approved cost for a division over a period. Returns the total plus the list
 * of months with no approved figure.
 */
export function approvedCostFor(
  costs: CostRecord[],
  range: DateRange,
  divisionId: string | null,
): { total: number; missingMonths: string[]; basis: string | null } {
  const months = monthsInRange(range)
  const missingMonths: string[] = []
  let total = 0
  let basis: string | null = null

  for (const month of months) {
    const monthStart = toIsoDate(month)
    const matching = costs.filter(
      (c) =>
        toIsoDate(startOfMonth(c.periodStart)) === monthStart &&
        (divisionId === null || c.divisionId === divisionId) &&
        c.isApproved,
    )
    if (matching.length === 0) {
      missingMonths.push(monthLabel(month))
      continue
    }
    for (const cost of matching) {
      total += cost.cogsAmount
      basis = basis ?? cost.basis
    }
  }

  return { total: round2(total), missingMonths, basis }
}

export function marginFor(
  invoices: InvoiceRecord[],
  costs: CostRecord[],
  range: DateRange,
  divisionId: string | null,
): MarginResult {
  const scopedInvoices = divisionId === null ? invoices : invoices.filter((i) => i.divisionId === divisionId)
  const revenue = sumRevenue(scopedInvoices, range)
  const { total: cogs, missingMonths, basis } = approvedCostFor(costs, range, divisionId)

  if (missingMonths.length > 0) {
    return {
      availability: 'unavailable',
      revenue,
      cogs: null,
      grossProfit: null,
      grossMarginPercent: null,
      reason: `Cost of goods sold has not been approved for ${missingMonths.join(', ')}. Gross margin is not reported until Finance approves the cost figure for every month in the period.`,
      missingCostMonths: missingMonths,
      costBasis: basis,
    }
  }

  if (revenue <= 0) {
    return {
      availability: 'unavailable',
      revenue,
      cogs,
      grossProfit: round2(-cogs),
      grossMarginPercent: null,
      reason: NO_REVENUE_REASON,
      missingCostMonths: [],
      costBasis: basis,
    }
  }

  const grossProfit = round2(revenue - cogs)
  return {
    availability: 'available',
    revenue,
    cogs,
    grossProfit,
    grossMarginPercent: round2((grossProfit / revenue) * 100),
    missingCostMonths: [],
    costBasis: basis,
  }
}

export interface DivisionMargin extends MarginResult {
  divisionId: string
  divisionCode: string
  divisionName: string
}

export function marginByDivision(
  invoices: InvoiceRecord[],
  costs: CostRecord[],
  range: DateRange,
  divisions: DivisionRef[],
): DivisionMargin[] {
  return divisions
    .map((division) => ({
      divisionId: division.id,
      divisionCode: division.code,
      divisionName: division.name,
      ...marginFor(invoices, costs, range, division.id),
    }))
    .sort((a, b) => b.revenue - a.revenue)
}

export interface MarginTrendPoint {
  date: string
  label: string
  revenue: number
  cogs: number | null
  grossProfit: number | null
  marginPercent: number | null
  available: boolean
}

/** Monthly margin trend. Months without an approved cost are gaps, not zeros. */
export function marginTrend(
  invoices: InvoiceRecord[],
  costs: CostRecord[],
  range: DateRange,
  divisionId: string | null,
): MarginTrendPoint[] {
  return monthsInRange(range).map((month) => {
    const monthRange: DateRange = { start: month, end: endOfMonth(month) }
    const result = marginFor(invoices, costs, monthRange, divisionId)
    return {
      date: toIsoDate(month),
      label: monthLabel(month),
      revenue: result.revenue,
      cogs: result.cogs,
      grossProfit: result.grossProfit,
      // A gap keeps the line honest: nothing is drawn for an unapproved month.
      marginPercent: result.availability === 'available' ? result.grossMarginPercent : null,
      available: result.availability === 'available',
    }
  })
}

/** True when at least one month in the period has an approved cost figure. */
export function anyApprovedCost(costs: CostRecord[], range: DateRange): boolean {
  return costs.some((c) => c.isApproved && c.periodStart <= range.end && c.periodEnd >= range.start)
}
