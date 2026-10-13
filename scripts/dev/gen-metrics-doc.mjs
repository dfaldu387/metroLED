/**
 * Generates docs/metrics.md from the canonical definitions in code, so the
 * document can never drift from what the application actually calculates.
 *
 *   npx tsx scripts/dev/gen-metrics-doc.mjs
 */
import fs from 'node:fs'

const { METRIC_DEFINITIONS } = await import('../../src/lib/metrics/definitions.ts')

const lines = []
lines.push('# Metric definitions')
lines.push('')
lines.push('**Generated from `src/lib/metrics/definitions.ts`. Do not edit by hand** —')
lines.push('run `node scripts/dev/gen-metrics-doc.mjs` instead, so this document and the')
lines.push('application can never disagree about a formula.')
lines.push('')
lines.push('Each definition is also shown in the application at')
lines.push('**Settings → Metric definitions**, where it is approved.')
lines.push('')
lines.push('| Metric | Formula | Source | Approval needed from |')
lines.push('|---|---|---|---|')
for (const d of METRIC_DEFINITIONS) {
  lines.push(`| [${d.name}](#${d.key.replace(/_/g, '-')}) | \`${d.formula.replace(/\|/g, '\|')}\` | ${d.sourceSystems.join(', ')} | ${d.approver} |`)
}
lines.push('')
lines.push('---')
lines.push('')

for (const d of METRIC_DEFINITIONS) {
  lines.push(`## ${d.name}`)
  lines.push('')
  lines.push(`<a id="${d.key.replace(/_/g, '-')}"></a>`)
  lines.push('')
  lines.push(d.shortDescription)
  lines.push('')
  lines.push('```')
  lines.push(d.formula)
  lines.push('```')
  lines.push('')
  lines.push(`- **Key:** \`${d.key}\``)
  lines.push(`- **Source systems:** ${d.sourceSystems.join(', ')}`)
  lines.push(`- **Date basis:** ${d.dateBasis}`)
  lines.push(`- **Includes:** ${d.includedRecords}`)
  lines.push(`- **Excludes:** ${d.excludedRecords}`)
  lines.push(`- **Currency:** ${d.currencyHandling}`)
  lines.push(`- **Division mapping:** ${d.divisionMapping}`)
  lines.push(`- **Approval status:** ${d.defaultApproval === 'APPROVED' ? 'Approved' : 'Awaiting approval'}`)
  lines.push(`- **Approver:** ${d.approver}`)
  if (d.notes) {
    lines.push('')
    lines.push(`> **Note:** ${d.notes}`)
  }
  lines.push('')
}

lines.push('---')
lines.push('')
lines.push('## Deliberately not implemented')
lines.push('')
lines.push('**Probability-weighted pipeline.** Method CRM records no probability per')
lines.push('stage and no weighting formula has been approved, so the pipeline total is')
lines.push('the unweighted sum of open quotes and every screen says so. Inventing a')
lines.push('weighting would make the pipeline look more certain than the data supports.')
lines.push('')
lines.push('**Profit per project.** Out of scope for Phase 1. Gross margin is reported by')
lines.push('division only.')
lines.push('')
lines.push('## Why a figure can read "Not available"')
lines.push('')
lines.push('A metric reports as unavailable rather than zero when zero would be a claim')
lines.push('the data does not support:')
lines.push('')
lines.push('| Metric | Unavailable when |')
lines.push('|---|---|')
lines.push('| Gross margin | Any month in the period has no Finance-approved cost figure |')
lines.push('| Gross margin | The period has no revenue, so the percentage is undefined |')
lines.push('| Average order value | There were no orders to average |')
lines.push('| Win rate | No quote was won or lost in the period |')
lines.push('| Days Sales Outstanding | There was no revenue in the period |')
lines.push('| Any period comparison | The previous period has no data, so a percentage change is meaningless |')
lines.push('')

fs.mkdirSync('docs', { recursive: true })
fs.writeFileSync('docs/metrics.md', lines.join('\n'))
console.log(`docs/metrics.md written (${METRIC_DEFINITIONS.length} definitions)`)
