/**
 * Measures where server-side page time goes.
 *
 *   npx tsx scripts/dev/probe-timing.ts
 */
import 'dotenv/config'
import { databaseReachable, resetDatabaseProbe } from '@/lib/db'
import { loadDataset, loadSettings } from '@/lib/data/dataset'
import { getDemoDataset } from '@/lib/demo/dataset'
import type { AccessScope } from '@/lib/auth/guards'

const scope: AccessScope = {
  userId: 'demo-owner',
  isDemo: true,
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

async function time<T>(label: string, fn: () => Promise<T> | T): Promise<T> {
  const started = performance.now()
  const result = await fn()
  console.log(`${label.padEnd(44)} ${(performance.now() - started).toFixed(0).padStart(6)} ms`)
  return result
}

async function main() {
  console.log('--- cold ---')
  resetDatabaseProbe()
  await time('databaseReachable() (cold, probe uncached)', () => databaseReachable())
  await time('databaseReachable() (warm, cached)', () => databaseReachable())

  console.log('\n--- probe with cache cleared each time (worst case) ---')
  for (let i = 0; i < 3; i++) {
    resetDatabaseProbe()
    await time(`databaseReachable() attempt ${i + 1}`, () => databaseReachable())
  }

  console.log('\n--- demo dataset ---')
  await time('getDemoDataset() (cold, generates)', () => getDemoDataset())
  await time('getDemoDataset() (warm, cached)', () => getDemoDataset())

  console.log('\n--- full page data load ---')
  await time('loadSettings()', () => loadSettings())
  const ds = await time('loadDataset() 13 months', () => loadDataset(scope, { months: 13 }))
  await time('loadDataset() 24 months', () => loadDataset(scope, { months: 24 }))
  console.log(
    `\nrecords in scope: ${ds.invoices.length} invoices, ${ds.quotes.length} quotes, ${ds.orders.length} orders`,
  )
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error)
    process.exit(1)
  },
)
