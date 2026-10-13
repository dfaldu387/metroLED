import { requirePermission } from './auth/guards'
import { buildAccessScope, type AccessScope } from './auth/guards'
import type { SessionUser } from './auth/session'
import type { Permission } from './auth/permissions'
import { loadDataset, loadSettings, type LoadedDataset, type ResolvedSettings } from './data/dataset'
import { daysBetween, resolveRange, type RangePreset, type ResolvedRange } from './dates'

/**
 * Shared page setup.
 *
 * Every analytics page needs the same five things in the same order:
 *   1. an authorisation check for its permission (server-side, always),
 *   2. the access scope derived from the session,
 *   3. company settings (timezone, thresholds),
 *   4. the resolved reporting period from the URL,
 *   5. the scoped dataset.
 *
 * Doing it in one place means a page cannot accidentally skip step 1 or
 * forget to pass the scope into step 5.
 */

export type SearchParams = Record<string, string | string[] | undefined>

export interface PageContext {
  user: SessionUser
  scope: AccessScope
  settings: ResolvedSettings
  range: ResolvedRange
  dataset: LoadedDataset
  /** The division filter chosen in the URL, if any. */
  selectedDivisionId: string | null
  /** The sales-rep filter chosen in the URL, if any. */
  selectedSalesRepId: string | null
  now: Date
}

function readParam(params: SearchParams, key: string): string | null {
  const value = params[key]
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

const VALID_PRESETS = new Set<RangePreset>([
  'today',
  'yesterday',
  'last_7_days',
  'last_30_days',
  'this_month',
  'last_month',
  'this_quarter',
  'last_quarter',
  'this_year',
  'last_12_months',
  'custom',
])

export async function getPageContext(
  permission: Permission,
  returnTo: string,
  searchParams: SearchParams,
  options: { defaultRange?: RangePreset; months?: number } = {},
): Promise<PageContext> {
  const user = await requirePermission(permission, returnTo)
  const scope = buildAccessScope(user)
  const settings = await loadSettings()
  const now = new Date()

  const rawPreset = readParam(searchParams, 'range')
  const preset: RangePreset =
    rawPreset && VALID_PRESETS.has(rawPreset as RangePreset)
      ? (rawPreset as RangePreset)
      : (options.defaultRange ?? 'last_30_days')

  const range = resolveRange(preset, {
    now,
    timeZone: settings.timezone,
    start: readParam(searchParams, 'start'),
    end: readParam(searchParams, 'end'),
  })

  const selectedDivisionId = readParam(searchParams, 'division')
  const selectedSalesRepId = readParam(searchParams, 'rep')

  // Load enough history to cover the comparison period and a 12-month trend,
  // whichever is wider, without pulling the whole 24 months every time.
  const months = options.months ?? monthsNeeded(range)

  const dataset = await loadDataset(scope, {
    now,
    months,
    divisionId: selectedDivisionId && selectedDivisionId !== 'all' ? selectedDivisionId : null,
  })

  // A rep filter chosen in the UI narrows further, but can never widen beyond
  // the user's own restriction.
  const effectiveRepFilter =
    scope.restrictToSalesRepId ??
    (selectedSalesRepId && selectedSalesRepId !== 'all' ? selectedSalesRepId : null)

  if (effectiveRepFilter && effectiveRepFilter !== scope.restrictToSalesRepId) {
    dataset.invoices = dataset.invoices.filter((i) => i.salesRepId === effectiveRepFilter)
    dataset.quotes = dataset.quotes.filter((q) => q.salesRepId === effectiveRepFilter)
  }

  return {
    user,
    scope,
    settings,
    range,
    dataset,
    selectedDivisionId: selectedDivisionId === 'all' ? null : selectedDivisionId,
    selectedSalesRepId: effectiveRepFilter,
    now,
  }
}

function monthsNeeded(range: ResolvedRange): number {
  const spanDays = daysBetween(range.comparison.start, range.end) + 1
  const spanMonths = Math.ceil(spanDays / 30) + 1
  return Math.min(24, Math.max(13, spanMonths))
}

/** Label for the comparison line on a KPI card, e.g. "vs. previous 30 days". */
export function comparisonLabel(range: ResolvedRange): string {
  return `vs. ${range.comparisonLabel.toLowerCase()}`
}

export function scopeNoteForUser(context: PageContext): string | null {
  const notes: string[] = []
  if (context.scope.restrictToSalesRepId === '__no_linked_sales_rep__') {
    notes.push(
      'Your account is not linked to a sales representative record, so no sales data can be shown. Ask an owner to link it in Users & Permissions.',
    )
  } else if (context.scope.restrictToSalesRepId) {
    notes.push('Showing your own records only.')
  }
  if (context.scope.divisionIds) {
    notes.push('Restricted to the divisions assigned to your account.')
  }
  return notes.length > 0 ? notes.join(' ') : null
}
