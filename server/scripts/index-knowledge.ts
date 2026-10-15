/**
 * Builds the Ask MetroLED knowledge base (RAG index).
 *
 * Reads the business documentation (docs/*.md) and the canonical metric
 * definitions, splits them into chunks, embeds each chunk with Voyage, and
 * rebuilds the KnowledgeChunk table from scratch (a full, idempotent rebuild).
 *
 * Run with:  npm run ai:index   (needs VOYAGE_API_KEY and a reachable database)
 */

import '../src/load-env'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { METRIC_DEFINITIONS, type MetricDefinitionSpec } from '@shared/metric-definitions'
import { closePool, databaseReachable, insertMany, json, sql, transaction } from '../src/lib/db'
import { embed, embeddingModel, embeddingsConfigured } from '../src/lib/ai/embeddings'

const here = path.dirname(fileURLToPath(import.meta.url))
const DOCS_DIR = path.resolve(here, '../../docs')

// Business-facing documentation only. Engineering docs (migration-conventions)
// are deliberately excluded — the assistant answers business questions.
const DOC_FILES: { file: string; title: string }[] = [
  { file: 'metrics.md', title: 'Metric definitions' },
  { file: 'user-guide.md', title: 'User guide' },
  { file: 'admin-guide.md', title: 'Admin guide' },
  { file: 'runbook.md', title: 'Operations runbook' },
  { file: 'client-decisions.md', title: 'Client decisions' },
]

const MAX_CHUNK_CHARS = 1400

interface Chunk {
  docId: string
  title: string
  section: string
  ordinal: number
  content: string
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

/**
 * Markdown-aware chunker: split a document at its headings into sections, then
 * split any section longer than MAX_CHUNK_CHARS at paragraph boundaries.
 */
function chunkMarkdown(docId: string, title: string, markdown: string): Chunk[] {
  const chunks: Chunk[] = []
  let section = ''
  let buffer: string[] = []
  let ordinal = 0

  const flush = () => {
    const text = buffer.join('\n').trim()
    buffer = []
    if (!text) return

    const paragraphs = text.split(/\n{2,}/)
    let acc = ''
    const push = (body: string) => {
      const trimmed = body.trim()
      if (trimmed) chunks.push({ docId, title, section, ordinal: ordinal++, content: trimmed })
    }
    for (const paragraph of paragraphs) {
      if (acc && (acc.length + paragraph.length + 2) > MAX_CHUNK_CHARS) {
        push(acc)
        acc = paragraph
      } else {
        acc = acc ? `${acc}\n\n${paragraph}` : paragraph
      }
    }
    push(acc)
  }

  for (const line of markdown.split(/\r?\n/)) {
    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      flush()
      section = heading[2]!.trim()
      continue
    }
    buffer.push(line)
  }
  flush()

  return chunks
}

function renderMetricDefinition(metric: MetricDefinitionSpec): string {
  return [
    `Metric: ${metric.name}`,
    metric.shortDescription,
    `Formula: ${metric.formula}`,
    `Source systems: ${metric.sourceSystems.join(', ')}`,
    `Date basis: ${metric.dateBasis}`,
    `Included records: ${metric.includedRecords}`,
    `Excluded records: ${metric.excludedRecords}`,
    `Currency handling: ${metric.currencyHandling}`,
    `Division mapping: ${metric.divisionMapping}`,
    metric.notes ? `Notes: ${metric.notes}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

function metricChunks(): Chunk[] {
  return METRIC_DEFINITIONS.map((metric, index) => ({
    docId: 'metric-definitions',
    title: 'Canonical metric definitions',
    section: metric.name,
    ordinal: index,
    content: renderMetricDefinition(metric),
  }))
}

function gatherCorpus(): Chunk[] {
  const chunks: Chunk[] = [...metricChunks()]
  for (const { file, title } of DOC_FILES) {
    const full = path.join(DOCS_DIR, file)
    if (!fs.existsSync(full)) {
      console.warn(`[ai:index] skipping ${file} (not found at ${full})`)
      continue
    }
    const markdown = fs.readFileSync(full, 'utf8')
    chunks.push(...chunkMarkdown(`docs/${file}`, title, markdown))
  }
  return chunks
}

async function main(): Promise<void> {
  if (!embeddingsConfigured()) {
    console.error(
      '[ai:index] VOYAGE_API_KEY is not set, so the knowledge base cannot be built. Add it to .env and retry.',
    )
    process.exitCode = 1
    return
  }
  if (!(await databaseReachable())) {
    console.error('[ai:index] the database is not reachable. Set DATABASE_URL and run "npm run db:migrate" first.')
    process.exitCode = 1
    return
  }

  const chunks = gatherCorpus()
  if (chunks.length === 0) {
    console.error('[ai:index] no source content was found to index.')
    process.exitCode = 1
    return
  }

  const model = embeddingModel()
  console.log(`[ai:index] embedding ${chunks.length} chunks with ${model}…`)

  // Embed the heading context together with the body so the vector reflects
  // which section a passage belongs to.
  const embedTexts = chunks.map((chunk) =>
    chunk.section ? `${chunk.title} — ${chunk.section}\n${chunk.content}` : `${chunk.title}\n${chunk.content}`,
  )
  const vectors = await embed(embedTexts, 'document')
  if (vectors.length !== chunks.length) {
    console.error(`[ai:index] embedding count mismatch (${vectors.length} vs ${chunks.length}).`)
    process.exitCode = 1
    return
  }

  const rows = chunks.map((chunk, index) => ({
    docId: chunk.docId,
    title: chunk.title,
    section: chunk.section,
    ordinal: chunk.ordinal,
    content: chunk.content,
    tokensEstimate: estimateTokens(chunk.content),
    embedding: json(vectors[index]!),
    embeddingModel: model,
    contentHash: crypto.createHash('sha256').update(chunk.content).digest('hex'),
  }))

  await transaction(async (tx) => {
    await tx.exec(sql`DELETE FROM "KnowledgeChunk"`)
    await insertMany('KnowledgeChunk', rows, tx)
  })

  const byDoc = new Map<string, number>()
  for (const chunk of chunks) byDoc.set(chunk.docId, (byDoc.get(chunk.docId) ?? 0) + 1)
  console.log('[ai:index] indexed:')
  for (const [docId, count] of byDoc) console.log(`  ${docId.padEnd(28)} ${count} chunks`)
  console.log(`[ai:index] done — ${chunks.length} chunks embedded and stored.`)
}

main()
  .catch((error) => {
    console.error('[ai:index] failed:', error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(() => {
    void closePool()
  })
