import type { IntegrationProvider } from '@shared/enums'
import { insert, sql, upsert, type Queryable } from '../db'
import type { NormalizedCustomer } from './types'

/**
 * Cross-system customer matching (section 14).
 *
 * The same business appears in QuickBooks, Method CRM and Shopify under
 * slightly different names. This resolves them to one unified `Customer` so a
 * revenue figure and a pipeline figure can be attributed to the same company.
 *
 * The rule that matters: a match is only made automatically when the evidence
 * is strong. Anything weaker is written to `UnmatchedRecord` for a human to
 * resolve on the Data Health page. A wrong automatic match silently corrupts
 * every per-customer figure, which is far worse than an item on a review list.
 *
 * Confidence scale:
 *   100  exact email match
 *    95  identical normalised name
 *    85  normalised name match after removing legal suffixes
 *    70+ high token overlap (accepted)
 *   <70  recorded as unmatched for review
 */

/** A match at or above this confidence is accepted automatically. */
export const AUTO_MATCH_THRESHOLD = 70

/**
 * A candidate at or above this confidence is offered to a human as a
 * suggestion, even though it is too weak to accept automatically. Below it,
 * the resemblance is so slight that proposing it would waste the reviewer's
 * time more than help them.
 */
export const SUGGESTION_THRESHOLD = 30

const LEGAL_SUFFIXES = [
  'inc',
  'incorporated',
  'llc',
  'ltd',
  'limited',
  'corp',
  'corporation',
  'co',
  'company',
  'plc',
  'lp',
  'llp',
  'gmbh',
  'pty',
  'sa',
  'nv',
  'bv',
]

const NOISE_TOKENS = new Set(['the', 'and', 'of', 'for', 'a', 'an'])

/**
 * Normalises a company name for comparison:
 * lower-cased, accents stripped, punctuation removed, whitespace collapsed.
 */
export function normalizeName(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Normalised name with legal suffixes and noise words removed. */
export function nameKey(value: string): string {
  const tokens = normalizeName(value)
    .split(' ')
    .filter((t) => t.length > 0 && !NOISE_TOKENS.has(t) && !LEGAL_SUFFIXES.includes(t))
  return tokens.join(' ')
}

export function normalizeEmail(value: string | null | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim().toLowerCase()
  return trimmed.includes('@') ? trimmed : null
}

/** Jaccard similarity over name tokens, as a 0-100 score. */
export function tokenSimilarity(a: string, b: string): number {
  const left = new Set(nameKey(a).split(' ').filter(Boolean))
  const right = new Set(nameKey(b).split(' ').filter(Boolean))
  if (left.size === 0 || right.size === 0) return 0

  let intersection = 0
  for (const token of left) if (right.has(token)) intersection++
  const union = left.size + right.size - intersection
  return union === 0 ? 0 : Math.round((intersection / union) * 100)
}

export interface MatchCandidate {
  id: string
  name: string
  normalizedName: string
  email: string | null
}

export interface MatchResult {
  customerId: string | null
  confidence: number
  reason: string
  /** Best candidate even when below the threshold, to suggest on review. */
  suggestedCustomerId: string | null
  suggestedCustomerName: string | null
}

/**
 * Scores a source customer against the existing unified customers.
 * Pure, so the matching rules are directly testable.
 */
export function scoreMatch(source: NormalizedCustomer, candidates: MatchCandidate[]): MatchResult {
  const sourceEmail = normalizeEmail(source.email)
  const sourceKey = nameKey(source.name)
  const sourceNormalized = normalizeName(source.name)

  let best: { candidate: MatchCandidate; score: number; reason: string } | null = null

  for (const candidate of candidates) {
    let score = 0
    let reason = ''

    if (sourceEmail && candidate.email && normalizeEmail(candidate.email) === sourceEmail) {
      score = 100
      reason = `Email address matches exactly (${sourceEmail}).`
    } else if (sourceNormalized && sourceNormalized === candidate.normalizedName) {
      score = 95
      reason = 'Normalised company name is identical.'
    } else if (sourceKey && sourceKey === nameKey(candidate.name)) {
      score = 85
      reason = 'Company names match once legal suffixes are removed.'
    } else {
      const similarity = tokenSimilarity(source.name, candidate.name)
      // Scored, but not necessarily accepted. An automatic match still needs
      // AUTO_MATCH_THRESHOLD, so "Metro Transit Authority" is never silently
      // merged into "Metro Signs" on one shared word. A weaker resemblance is
      // kept so it can be OFFERED to a reviewer rather than discarded.
      if (similarity >= SUGGESTION_THRESHOLD) {
        score = similarity
        reason = `Company names share ${similarity}% of their words.`
      }
    }

    if (score > 0 && (!best || score > best.score)) {
      best = { candidate, score, reason }
    }
  }

  if (!best) {
    return {
      customerId: null,
      confidence: 0,
      reason: 'No existing customer resembles this record closely enough to suggest.',
      suggestedCustomerId: null,
      suggestedCustomerName: null,
    }
  }

  if (best.score >= AUTO_MATCH_THRESHOLD) {
    return {
      customerId: best.candidate.id,
      confidence: best.score,
      reason: best.reason,
      suggestedCustomerId: best.candidate.id,
      suggestedCustomerName: best.candidate.name,
    }
  }

  return {
    customerId: null,
    confidence: best.score,
    reason: `Closest existing customer is "${best.candidate.name}" at ${best.score}% confidence, which is below the ${AUTO_MATCH_THRESHOLD}% threshold for an automatic match.`,
    suggestedCustomerId: best.candidate.id,
    suggestedCustomerName: best.candidate.name,
  }
}

/**
 * Resolves a source customer to a unified customer id, creating one when the
 * record is genuinely new, and recording an unmatched entry when the best
 * candidate is too weak to accept automatically.
 */
export async function resolveCustomer(
  db: Queryable,
  integrationId: string,
  provider: IntegrationProvider,
  source: NormalizedCustomer,
): Promise<{ customerId: string; created: boolean; confidence: number }> {
  // An existing link is authoritative: a human may have corrected it.
  const existing = await db.maybeOne<{ customerId: string; matchStatus: string }>(sql`
    SELECT "customerId", "matchStatus" FROM "CustomerSourceLink"
    WHERE "integrationId" = ${integrationId} AND "sourceId" = ${source.sourceId}`)

  if (existing) {
    await db.exec(sql`
      UPDATE "CustomerSourceLink"
      SET "sourceName" = ${source.name}, "sourceEmail" = ${normalizeEmail(source.email)}
      WHERE "integrationId" = ${integrationId} AND "sourceId" = ${source.sourceId}`)
    return { customerId: existing.customerId, created: false, confidence: 100 }
  }

  const sourceEmail = normalizeEmail(source.email)
  const key = nameKey(source.name)

  // Narrow the candidate set before scoring, so this stays cheap as the
  // customer list grows.
  // `strpos(...) > 0` is a literal, case-sensitive substring test, the same
  // semantics as Prisma's `contains` (no LIKE wildcards to escape).
  const conditions = [
    ...(sourceEmail ? [sql`"email" = ${sourceEmail}`] : []),
    sql`"normalizedName" = ${normalizeName(source.name)}`,
    ...(key ? [sql`strpos("normalizedName", ${key.split(' ')[0] ?? ''}) > 0`] : []),
  ]
  const candidates = await db.many<MatchCandidate>(sql`
    SELECT "id", "name", "normalizedName", "email" FROM "Customer"
    WHERE ${sql.join(conditions, sql` OR `)}
    LIMIT 50`)

  const result = scoreMatch(source, candidates)

  if (result.customerId) {
    await insert(
      'CustomerSourceLink',
      {
        customerId: result.customerId,
        integrationId,
        sourceId: source.sourceId,
        sourceName: source.name,
        sourceEmail,
        matchStatus: 'AUTO_MATCHED',
        matchConfidence: result.confidence,
      },
      db,
    )
    return { customerId: result.customerId, created: false, confidence: result.confidence }
  }

  // A weak-but-plausible candidate is surfaced for review rather than guessed.
  if (result.suggestedCustomerId) {
    await upsert(
      'UnmatchedRecord',
      ['integrationId', 'entity', 'sourceId'],
      {
        integrationId,
        entity: 'customer',
        sourceId: source.sourceId,
        sourceName: source.name,
        reason: result.reason,
        suggestedCustomerId: result.suggestedCustomerId,
        payload: { email: sourceEmail, provider },
      },
      { reason: result.reason, suggestedCustomerId: result.suggestedCustomerId },
      db,
    )
  }

  // No usable candidate: this is a genuinely new customer.
  const created = await insert<{ id: string }>(
    'Customer',
    {
      name: source.name,
      normalizedName: normalizeName(source.name),
      email: sourceEmail,
      phone: source.phone,
      city: source.city,
      region: source.region,
      country: source.country,
      classification: source.classificationHint ?? 'UNCLASSIFIED',
    },
    db,
  )

  await insert(
    'CustomerSourceLink',
    {
      customerId: created.id,
      integrationId,
      sourceId: source.sourceId,
      sourceName: source.name,
      sourceEmail,
      matchStatus: 'AUTO_MATCHED',
      matchConfidence: result.suggestedCustomerId ? result.confidence : 100,
    },
    db,
  )

  return { customerId: created.id, created: true, confidence: 100 }
}

/** Looks up the unified customer id for a source record, if one is linked. */
export async function linkedCustomerId(
  db: Queryable,
  integrationId: string,
  sourceId: string | null,
): Promise<string | null> {
  if (!sourceId) return null
  const link = await db.maybeOne<{ customerId: string }>(sql`
    SELECT "customerId" FROM "CustomerSourceLink"
    WHERE "integrationId" = ${integrationId} AND "sourceId" = ${sourceId}`)
  return link?.customerId ?? null
}

/** Resolves (and creates if needed) a sales representative by source id/name. */
export async function resolveSalesRep(
  db: Queryable,
  integrationId: string,
  sourceId: string | null,
  name: string | null,
): Promise<string | null> {
  if (!sourceId && !name) return null

  if (sourceId) {
    const link = await db.maybeOne<{ salesRepId: string }>(sql`
      SELECT "salesRepId" FROM "SalesRepSourceLink"
      WHERE "integrationId" = ${integrationId} AND "sourceId" = ${sourceId}`)
    if (link) return link.salesRepId
  }

  if (!name) return null
  const normalized = normalizeName(name)
  if (!normalized) return null

  const existing = await db.maybeOne<{ id: string }>(sql`
    SELECT "id" FROM "SalesRep" WHERE "normalizedName" = ${normalized} LIMIT 1`)

  const salesRepId =
    existing?.id ?? (await insert<{ id: string }>('SalesRep', { name, normalizedName: normalized }, db)).id

  if (sourceId) {
    await upsert(
      'SalesRepSourceLink',
      ['integrationId', 'sourceId'],
      { salesRepId, integrationId, sourceId, sourceName: name },
      { sourceName: name },
      db,
    )
  }

  return salesRepId
}
