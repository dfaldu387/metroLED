import type { IntegrationProvider } from '@shared/enums'
import { sql, type Queryable } from '../db'

/**
 * Division assignment (section 14).
 *
 * A source record is assigned to a division by the rules configured in
 * Settings. Rules are evaluated in `priority` order, lowest first, and the
 * first match wins.
 *
 * The important rule: a record that matches nothing stays UNASSIGNED. It is
 * never attributed to a default division, because that would quietly move
 * revenue onto the wrong division's figures. Unassigned records are counted
 * and surfaced on the Overview page so the gap is visible.
 */

export type MatchType = 'equals' | 'contains' | 'starts_with' | 'ends_with' | 'regex'

export interface DivisionRule {
  id: string
  field: string
  matchType: string
  matchValue: string
  divisionId: string
  priority: number
}

/** Evaluates one rule against one field value. */
export function ruleMatches(rule: DivisionRule, value: string | null | undefined): boolean {
  if (value === null || value === undefined) return false
  const haystack = value.trim().toLowerCase()
  const needle = rule.matchValue.trim().toLowerCase()
  if (!haystack || !needle) return false

  switch (rule.matchType as MatchType) {
    case 'equals':
      return haystack === needle
    case 'contains':
      return haystack.includes(needle)
    case 'starts_with':
      return haystack.startsWith(needle)
    case 'ends_with':
      return haystack.endsWith(needle)
    case 'regex':
      try {
        // A bad regular expression in configuration must not break a sync.
        return new RegExp(rule.matchValue, 'i').test(value)
      } catch {
        return false
      }
    default:
      return false
  }
}

/**
 * Returns the division id for a record, or null when nothing matches.
 * `fields` is the provider-specific map built by each adapter.
 */
export function resolveDivision(
  rules: DivisionRule[],
  fields: Record<string, string | null>,
): string | null {
  const ordered = [...rules].sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id))
  for (const rule of ordered) {
    if (ruleMatches(rule, fields[rule.field])) return rule.divisionId
  }
  return null
}

export async function loadDivisionRules(
  db: Queryable,
  provider: IntegrationProvider,
): Promise<DivisionRule[]> {
  const rows = await db.many<DivisionRule>(sql`
    SELECT "id", "field", "matchType", "matchValue", "divisionId", "priority"
    FROM "DivisionMappingRule"
    WHERE "provider" = ${provider} AND "isActive" = true
    ORDER BY "priority" ASC`)
  return rows
}

/**
 * The Shopify store is a division in its own right, so every Shopify record
 * belongs to Eco LED Mart without needing a rule.
 */
export async function ecoLedMartDivisionId(db: Queryable): Promise<string | null> {
  const division = await db.maybeOne<{ id: string }>(sql`SELECT "id" FROM "Division" WHERE "code" = ${'ECO'}`)
  return division?.id ?? null
}

export const MAPPABLE_FIELDS: Record<IntegrationProvider, { field: string; label: string; hint: string }[]> = {
  QUICKBOOKS: [
    { field: 'class', label: 'Class', hint: 'The QuickBooks class on the invoice. Usually the cleanest signal.' },
    { field: 'department', label: 'Department / Location', hint: 'The QuickBooks department or location.' },
    { field: 'customer', label: 'Customer name', hint: 'Matches against the customer name on the invoice.' },
    { field: 'item', label: 'First line item', hint: 'The product or service on the first invoice line.' },
    { field: 'docNumber', label: 'Invoice number', hint: 'Useful when invoice numbers carry a division prefix.' },
  ],
  METHOD_CRM: [
    { field: 'class', label: 'Class', hint: 'The class field on the Method estimate.' },
    { field: 'customer', label: 'Customer name', hint: 'Matches against the customer name on the quote.' },
    { field: 'memo', label: 'Memo', hint: 'Free-text memo on the quote.' },
    { field: 'docNumber', label: 'Quote number', hint: 'Useful when quote numbers carry a division prefix.' },
  ],
  SHOPIFY: [],
  MONDAY: [{ field: 'board', label: 'Board name', hint: 'The Monday.com board the item belongs to.' }],
}
