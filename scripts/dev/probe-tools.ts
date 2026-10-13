import { toolDefinitionsFor, executeTool, TOOLS } from '@/lib/ai/tools'
import { getDemoDataset } from '@/lib/demo/dataset'
import type { AccessScope } from '@/lib/auth/guards'

const ownerScope: AccessScope = {
  userId: 'owner', isDemo: true, divisionIds: null, restrictToSalesRepId: null,
  canSeeMargin: true, canSeeAllReps: true, canSeeCustomers: true, canSeeReceivables: true,
  canSeeEcommerce: true, canSeePipeline: true, canSeeRevenue: true,
}
const repScope: AccessScope = {
  userId: 'rep', isDemo: true, divisionIds: null, restrictToSalesRepId: 'demo-rep-1',
  canSeeMargin: false, canSeeAllReps: false, canSeeCustomers: false, canSeeReceivables: false,
  canSeeEcommerce: false, canSeePipeline: true, canSeeRevenue: true,
}

console.log('TOTAL TOOLS:', TOOLS.length)
const ownerTools = toolDefinitionsFor(ownerScope)
const repTools = toolDefinitionsFor(repScope)
console.log('owner sees:', ownerTools.length, '| rep sees:', repTools.length)
console.log('rep tool names:', repTools.map(t => t.name).join(', '))

console.log('\n--- JSON schema sample (get_revenue) ---')
console.log(JSON.stringify(ownerTools.find(t => t.name === 'get_revenue')!.input_schema, null, 2))

console.log('\n--- JSON schema sample (list_overdue_invoices) ---')
console.log(JSON.stringify(ownerTools.find(t => t.name === 'list_overdue_invoices')!.input_schema, null, 2))

const now = new Date()
const dataset: any = { ...getDemoDataset(now), unmatchedCount: 3 }
const settings = { staleQuoteDays: 21, largeQuoteAmount: 10000, timezone: 'America/New_York' }

console.log('\n=== OWNER: get_revenue last_month by division ===')
const r1 = executeTool('get_revenue', { period: 'last_month', group_by: 'division' }, { scope: ownerScope, dataset, settings, now })
console.log(JSON.stringify(r1.result.data, null, 2).slice(0, 900))

console.log('\n=== SALES REP: get_gross_margin (MUST REFUSE) ===')
const scoped: any = {
  ...dataset,
  invoices: dataset.invoices.filter((i: any) => i.salesRepId === 'demo-rep-1'),
  quotes: dataset.quotes.filter((q: any) => q.salesRepId === 'demo-rep-1'),
}
const r2 = executeTool('get_gross_margin', { period: 'last_month' }, { scope: repScope, dataset: scoped, settings, now })
console.log('ok:', r2.result.ok, '| refusal:', r2.result.refusal)

console.log('\n=== SALES REP: get_accounts_receivable (MUST REFUSE) ===')
const r3 = executeTool('get_accounts_receivable', {}, { scope: repScope, dataset: scoped, settings, now })
console.log('ok:', r3.result.ok, '| refusal:', r3.result.refusal)

console.log('\n=== SALES REP: get_revenue (allowed, own data only) ===')
const r4 = executeTool('get_revenue', { period: 'last_month' }, { scope: repScope, dataset: scoped, settings, now })
console.log('ok:', r4.result.ok, '| total:', (r4.result.data as any).total_revenue, '| invoices:', (r4.result.data as any).invoice_count)
const ownerTotal = (executeTool('get_revenue', { period: 'last_month' }, { scope: ownerScope, dataset, settings, now }).result.data as any).total_revenue
console.log('owner total for same period:', ownerTotal, '(rep must be lower)')

console.log('\n=== Invalid params rejected ===')
const r5 = executeTool('list_overdue_invoices', { min_days_overdue: -5 }, { scope: ownerScope, dataset, settings, now })
console.log('ok:', r5.result.ok, '| refusal:', r5.result.refusal)

console.log('\n=== Unknown tool rejected ===')
const r6 = executeTool('drop_tables', {}, { scope: ownerScope, dataset, settings, now })
console.log('ok:', r6.result.ok, '| refusal:', r6.result.refusal)
