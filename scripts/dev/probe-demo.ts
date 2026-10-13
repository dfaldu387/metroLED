import { getDemoDataset } from '@/lib/demo/dataset'
import { resolveRange, startOfMonth, toIsoDate, addMonths, endOfMonth } from '@/lib/dates'
import { sumRevenue, revenueInvoices } from '@/lib/analytics/revenue'
import { receivablesSummary, outstandingInvoices } from '@/lib/analytics/receivables'

const now = new Date()
const ds = getDemoDataset(now)
console.log('invoices:', ds.invoices.length, 'quotes:', ds.quotes.length, 'orders:', ds.orders.length)

console.log('\n-- revenue by month (last 14) --')
for (let i = 13; i >= 0; i--) {
  const m = startOfMonth(addMonths(now, -i))
  const r = { start: m, end: endOfMonth(m) }
  const inv = revenueInvoices(ds.invoices, r)
  console.log(toIsoDate(m), String(inv.length).padStart(4), Math.round(sumRevenue(ds.invoices, r)).toLocaleString())
}

const r30 = resolveRange('last_30_days', { now })
console.log('\nlast_30_days   ', Math.round(sumRevenue(ds.invoices, r30)).toLocaleString(), 'n=', revenueInvoices(ds.invoices, r30).length)
console.log('prev 30        ', Math.round(sumRevenue(ds.invoices, r30.comparison)).toLocaleString(), 'n=', revenueInvoices(ds.invoices, r30.comparison).length)

const ar = receivablesSummary(ds.invoices, now)
console.log('\n-- A/R --')
console.log('outstanding', Math.round(ar.totalOutstanding).toLocaleString(), 'invoices', ar.invoiceCount)
console.log('overdue    ', Math.round(ar.overdueAmount).toLocaleString(), 'count', ar.overdueInvoiceCount, 'avg days', ar.averageDaysOverdue)
const totalRev = sumRevenue(ds.invoices)
console.log('total 24mo revenue', Math.round(totalRev).toLocaleString(), '| outstanding as % of 24mo rev:', ((ar.totalOutstanding/totalRev)*100).toFixed(1)+'%')
const od = outstandingInvoices(ds.invoices).filter(i=>i.dueOn && i.dueOn < now)
console.log('oldest overdue days:', Math.max(...od.map(i => Math.round((now.getTime()-i.dueOn!.getTime())/86400000))))
