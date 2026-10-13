/**
 * Generate and send the daily brief from the command line.
 *
 *   npm run brief                       yesterday's business day
 *   npm run brief -- --date 2026-03-17  a specific date
 *   npm run brief -- --dry-run          generate and print, send nothing
 */
import '../src/load-env'
import { closePool, databaseReachable } from '../src/lib/db'
import { buildBriefPayload, generateAndStoreBrief } from '../src/lib/brief/generate'
import { renderBrief } from '../src/lib/brief/render'
import { sendDailyBrief } from '../src/lib/brief/send'
import { parseIsoDate } from '@shared/dates'
import { emailProviderLabel } from '../src/lib/email/provider'

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : undefined
}

async function main(): Promise<void> {
  const dateArg = arg('date')
  const briefDate = dateArg ? (parseIsoDate(dateArg) ?? undefined) : undefined
  if (dateArg && !briefDate) {
    console.error(`"${dateArg}" is not a valid date. Use YYYY-MM-DD.`)
    process.exit(1)
  }

  if (process.argv.includes('--dry-run')) {
    const payload = await buildBriefPayload({ briefDate })
    const { subject, text } = renderBrief(payload)
    console.log(`Subject: ${subject}\n`)
    console.log(text)
    console.log('\n(Dry run - nothing was stored or sent.)')
    return
  }

  if (!(await databaseReachable(true))) {
    console.error('The database is unreachable, so the brief cannot be stored or sent.')
    process.exit(1)
  }

  console.log(`Email provider: ${emailProviderLabel()}\n`)

  const { payload } = await generateAndStoreBrief({ briefDate })
  console.log(`Generated the brief for ${payload.briefDate}.`)
  if (payload.warnings.length > 0) {
    console.log('\nWarnings:')
    for (const warning of payload.warnings) console.log(`  - ${warning}`)
  }

  const result = await sendDailyBrief({ briefDate })
  console.log('')
  for (const outcome of result.outcomes) {
    console.log(`${outcome.status.padEnd(8)} ${outcome.recipient}${outcome.reason ? ` - ${outcome.reason}` : ''}`)
  }
  console.log(`\n${result.sent} sent, ${result.skipped} already delivered, ${result.failed} failed.`)
  if (result.simulated) {
    console.log('EMAIL_PROVIDER is "console", so nothing reached a real inbox.')
  }
  process.exitCode = result.failed > 0 ? 1 : 0
}

main()
  .catch((error) => {
    console.error('Failed:', error)
    process.exitCode = 1
  })
  .finally(async () => {
    await closePool()
  })
