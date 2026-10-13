import { daysBetween } from '../dates'
import { AR_AGING_BUCKETS, type ArBucketKey } from '../metrics/definitions'
import { round2 } from './revenue'
import type { BreakdownRow, InvoiceRecord } from '../types'

/**
 * Accounts receivable analytics.
 *
 * The system is read-only: nothing here edits an invoice, records a payment or
 * contacts a customer. It reports what QuickBooks says is outstanding.
 *
 * `balance` is taken from the source system rather than recalculated, so
 * partial payments and credits applied in QuickBooks are always reflected.
 */

const OUTSTANDING_STATUSES = new Set(['OPEN', 'PARTIALLY_PAID'])

export function isOutstanding(invoice: InvoiceRecord): boolean {
  return OUTSTANDING_STATUSES.has(invoice.status) && invoice.balance > 0.005
}

export function outstandingInvoices(invoices: InvoiceRecord[]): InvoiceRecord[] {
  return invoices.filter(isOutstanding)
}

/**
 * Days overdue. Positive means past due; zero or negative means not yet due.
 * Returns null when the source invoice carries no due date - those are
 * reported separately rather than assumed to be current.
 */
export function daysOverdue(invoice: InvoiceRecord, asOf: Date): number | null {
  if (!invoice.dueOn) return null
  return daysBetween(invoice.dueOn, asOf)
}

export function isOverdue(invoice: InvoiceRecord, asOf: Date): boolean {
  const days = daysOverdue(invoice, asOf)
  return days !== null && days > 0
}

export interface ReceivablesSummary {
  totalOutstanding: number
  currentAmount: number
  overdueAmount: number
  noDueDateAmount: number
  invoiceCount: number
  overdueInvoiceCount: number
  noDueDateCount: number
  /** Weighted average days overdue across overdue balance. */
  averageDaysOverdue: number | null
  largestOverdue: InvoiceRecord | null
}

export function receivablesSummary(invoices: InvoiceRecord[], asOf: Date): ReceivablesSummary {
  const outstanding = outstandingInvoices(invoices)

  let current = 0
  let overdue = 0
  let noDueDate = 0
  let overdueCount = 0
  let noDueDateCount = 0
  let weightedDays = 0
  let largestOverdue: InvoiceRecord | null = null

  for (const invoice of outstanding) {
    const days = daysOverdue(invoice, asOf)
    if (days === null) {
      noDueDate += invoice.balance
      noDueDateCount++
      continue
    }
    if (days > 0) {
      overdue += invoice.balance
      overdueCount++
      weightedDays += days * invoice.balance
      if (!largestOverdue || invoice.balance > largestOverdue.balance) largestOverdue = invoice
    } else {
      current += invoice.balance
    }
  }

  return {
    totalOutstanding: round2(current + overdue + noDueDate),
    currentAmount: round2(current),
    overdueAmount: round2(overdue),
    noDueDateAmount: round2(noDueDate),
    invoiceCount: outstanding.length,
    overdueInvoiceCount: overdueCount,
    noDueDateCount,
    averageDaysOverdue: overdue > 0 ? Math.round(weightedDays / overdue) : null,
    largestOverdue,
  }
}

export interface AgingBucket {
  key: ArBucketKey | 'no_due_date'
  label: string
  amount: number
  invoiceCount: number
  share: number
}

export function agingBuckets(invoices: InvoiceRecord[], asOf: Date): AgingBucket[] {
  const outstanding = outstandingInvoices(invoices)
  const totals = new Map<string, { amount: number; count: number }>()

  const bump = (key: string, amount: number) => {
    const existing = totals.get(key)
    if (existing) {
      existing.amount += amount
      existing.count++
    } else {
      totals.set(key, { amount, count: 1 })
    }
  }

  for (const invoice of outstanding) {
    const days = daysOverdue(invoice, asOf)
    if (days === null) {
      bump('no_due_date', invoice.balance)
      continue
    }
    bump(bucketFor(days), invoice.balance)
  }

  const grandTotal = [...totals.values()].reduce((acc, t) => acc + t.amount, 0)

  const rows: AgingBucket[] = AR_AGING_BUCKETS.map((bucket) => {
    const t = totals.get(bucket.key) ?? { amount: 0, count: 0 }
    return {
      key: bucket.key,
      label: bucket.label,
      amount: round2(t.amount),
      invoiceCount: t.count,
      share: grandTotal > 0 ? round2((t.amount / grandTotal) * 100) : 0,
    }
  })

  const noDue = totals.get('no_due_date')
  if (noDue) {
    rows.push({
      key: 'no_due_date',
      label: 'No due date recorded',
      amount: round2(noDue.amount),
      invoiceCount: noDue.count,
      share: grandTotal > 0 ? round2((noDue.amount / grandTotal) * 100) : 0,
    })
  }

  return rows
}

export function bucketFor(days: number): ArBucketKey {
  if (days <= 0) return 'current'
  if (days <= 30) return '1_30'
  if (days <= 60) return '31_60'
  if (days <= 90) return '61_90'
  return 'over_90'
}

export function receivablesByDivision(invoices: InvoiceRecord[], asOf: Date): BreakdownRow[] {
  const outstanding = outstandingInvoices(invoices)
  const totals = new Map<string, { label: string; amount: number; overdue: number; code: string | null }>()

  for (const invoice of outstanding) {
    const key = invoice.divisionId ?? '__unassigned__'
    const label = invoice.divisionName ?? 'Unassigned'
    const entry = totals.get(key) ?? { label, amount: 0, overdue: 0, code: invoice.divisionCode }
    entry.amount += invoice.balance
    if (isOverdue(invoice, asOf)) entry.overdue += invoice.balance
    totals.set(key, entry)
  }

  const grand = [...totals.values()].reduce((acc, t) => acc + t.amount, 0)

  return [...totals.entries()]
    .map(([key, t]) => ({
      key,
      label: t.label,
      divisionCode: t.code,
      value: round2(t.amount),
      share: grand > 0 ? round2((t.amount / grand) * 100) : 0,
      secondaryValue: round2(t.overdue),
      secondaryLabel: 'Overdue',
    }))
    .sort((a, b) => b.value - a.value)
}

export function receivablesByCustomer(invoices: InvoiceRecord[], asOf: Date, limit = 10): BreakdownRow[] {
  const outstanding = outstandingInvoices(invoices)
  const totals = new Map<string, { label: string; amount: number; overdue: number }>()

  for (const invoice of outstanding) {
    const key = invoice.customerId ?? '__unknown__'
    const label = invoice.customerName ?? 'Unknown customer'
    const entry = totals.get(key) ?? { label, amount: 0, overdue: 0 }
    entry.amount += invoice.balance
    if (isOverdue(invoice, asOf)) entry.overdue += invoice.balance
    totals.set(key, entry)
  }

  const grand = [...totals.values()].reduce((acc, t) => acc + t.amount, 0)

  return [...totals.entries()]
    .map(([key, t]) => ({
      key,
      label: t.label,
      value: round2(t.amount),
      share: grand > 0 ? round2((t.amount / grand) * 100) : 0,
      secondaryValue: round2(t.overdue),
      secondaryLabel: 'Overdue',
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, limit)
}

/**
 * Days Sales Outstanding, simple method.
 * Returns null when there is no revenue in the period - the ratio is
 * undefined, and reporting zero would be misleading.
 */
export function daysSalesOutstanding(
  outstandingAmount: number,
  revenueInPeriod: number,
  daysInPeriod: number,
): number | null {
  if (revenueInPeriod <= 0 || daysInPeriod <= 0) return null
  return Math.round((outstandingAmount / revenueInPeriod) * daysInPeriod)
}

/** Invoices that became overdue on or after the given date. */
export function newlyOverdue(invoices: InvoiceRecord[], since: Date, asOf: Date): InvoiceRecord[] {
  return outstandingInvoices(invoices)
    .filter((invoice) => {
      if (!invoice.dueOn) return false
      // Became overdue the day after the due date.
      const overdueFrom = new Date(invoice.dueOn.getTime() + 24 * 60 * 60 * 1000)
      return overdueFrom >= since && overdueFrom <= asOf
    })
    .sort((a, b) => b.balance - a.balance)
}
