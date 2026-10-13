/**
 * Run a synchronisation from the command line.
 *
 *   npm run sync                    incremental sync of every enabled provider
 *   npm run sync -- --backfill      full 24-month re-read
 *   npm run sync -- --provider SHOPIFY
 *   npm run sync -- --test          test connections only, import nothing
 */
import '../src/load-env'
import { closePool, databaseReachable } from '../src/lib/db'
import { syncAllProviders, syncProvider, testProviderConnection } from '../src/lib/integrations/sync-service'
import type { IntegrationProvider } from '@shared/enums'

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : undefined
}
const has = (name: string) => process.argv.includes(`--${name}`)

async function main(): Promise<void> {
  if (!(await databaseReachable(true))) {
    console.error('The database is unreachable. Set DATABASE_URL and run `npm run db:deploy` first.')
    process.exit(1)
  }

  const provider = arg('provider')?.toUpperCase() as IntegrationProvider | undefined
  const backfill = has('backfill')

  if (has('test')) {
    const providers: IntegrationProvider[] = provider ? [provider] : ['QUICKBOOKS', 'METHOD_CRM', 'SHOPIFY']
    for (const p of providers) {
      const result = await testProviderConnection(p)
      console.log(`${result.ok ? 'OK  ' : 'FAIL'}  ${p.padEnd(12)} ${result.detail}`)
    }
    return
  }

  const started = Date.now()
  console.log(`Starting ${backfill ? 'full backfill' : 'incremental sync'}${provider ? ` of ${provider}` : ''}\n`)

  const results = provider
    ? [await syncProvider(provider, { trigger: backfill ? 'BACKFILL' : 'MANUAL', fullBackfill: backfill })]
    : await syncAllProviders({ trigger: backfill ? 'BACKFILL' : 'MANUAL', fullBackfill: backfill })

  console.log('')
  for (const result of results) {
    console.log(
      `${result.ok ? 'OK  ' : 'FAIL'}  ${result.displayName.padEnd(26)} ` +
        `read ${String(result.totalRead).padStart(6)}  ` +
        `created ${String(result.totalCreated).padStart(6)}  ` +
        `updated ${String(result.totalUpdated).padStart(6)}  ` +
        `failed ${String(result.totalFailed).padStart(5)}  ` +
        `${Math.round(result.durationMs / 1000)}s`,
    )
    if (result.error) console.log(`      ${result.error}`)
  }

  const failed = results.filter((r) => !r.ok)
  console.log(`\nFinished in ${Math.round((Date.now() - started) / 1000)}s. ${failed.length} of ${results.length} failed.`)
  if (results.length === 0) console.log('No integrations are enabled.')
  process.exitCode = failed.length > 0 ? 1 : 0
}

main()
  .catch((error) => {
    console.error('Sync failed:', error)
    process.exitCode = 1
  })
  .finally(async () => {
    await closePool()
  })
