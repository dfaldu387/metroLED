'use client'

import * as React from 'react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { Building2, CalendarDays, Check, ChevronDown, Loader2, RotateCcw, UserRound } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/misc'
import { RANGE_PRESET_LABELS, type RangePreset } from '@/lib/dates'
import type { DivisionRef } from '@/lib/types'

/**
 * Filter rail.
 *
 * All filters sit in one row above the content and write to the URL, so a
 * filtered view can be bookmarked, shared and reloaded.
 *
 * Each option is a real link rather than a form control driving `router.push`.
 * That is deliberate and load-bearing:
 *
 *   Changing a filter IS a navigation - it changes the URL and re-renders the
 *   page on the server. Doing that with `router.push` from inside the page does
 *   not survive, because every page has a `loading.tsx` boundary: React swaps
 *   the page subtree for the loading skeleton, the component that started the
 *   transition unmounts, and the navigation is discarded. The RSC request goes
 *   out and returns 200, but the route never commits and the URL never
 *   changes - so the filter silently does nothing.
 *
 *   A `<Link>` is handled by the router itself rather than by the unmounting
 *   subtree, so it always commits. It also makes the filters work without
 *   JavaScript, middle-clickable, and able to show their destination on hover.
 *
 * Colour never changes with a filter: a division keeps its hue when another
 * division is filtered out, so a reader's learned mapping holds.
 */

const PRESET_ORDER: RangePreset[] = [
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
]

export interface FilterBarProps {
  divisions?: DivisionRef[]
  salesReps?: { id: string; name: string }[]
  showDivision?: boolean
  showSalesRep?: boolean
  showDateRange?: boolean
  /**
   * The period the page uses when the URL carries none. It must match the
   * page's own default, or the control would name a different period from the
   * one the figures are actually for.
   */
  defaultRange?: RangePreset
  /** Extra controls rendered at the end of the rail. */
  children?: React.ReactNode
}

const triggerClasses =
  'flex h-9 items-center justify-between gap-2 rounded-lg border border-ink-300 bg-white px-3 text-sm text-ink-900 shadow-card transition-colors hover:border-ink-400 focus-visible:border-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/20'

interface FilterOption {
  value: string
  label: string
}

/**
 * One filter: a trigger showing the current value, and a menu of links.
 *
 * Every link preserves the other filters and clears `page`, which would
 * otherwise point past the end of the new result set.
 */
function FilterMenu({
  icon: Icon,
  label,
  value,
  options,
  paramName,
  width,
}: {
  icon: typeof CalendarDays
  label: string
  value: string
  options: FilterOption[]
  paramName: string
  width: string
}) {
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const hrefFor = React.useCallback(
    (optionValue: string) => {
      const params = new URLSearchParams(searchParams.toString())
      if (optionValue === 'all') params.delete(paramName)
      else params.set(paramName, optionValue)
      params.delete('page')
      const query = params.toString()
      return query ? `${pathname}?${query}` : pathname
    },
    [pathname, searchParams, paramName],
  )

  const current = options.find((option) => option.value === value) ?? options[0]

  /*
    Applying a filter is a server round trip, so the trigger shows which option
    is being applied until the new page arrives. Filtered pages deliberately
    have no loading.tsx (see the note in this file), so this is the feedback
    that tells the reader the click registered.
  */
  const [applying, setApplying] = React.useState<string | null>(null)

  React.useEffect(() => {
    setApplying(null)
  }, [searchParams])

  const pendingLabel = applying ? options.find((o) => o.value === applying)?.label : null

  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <Icon className="size-4 shrink-0 text-ink-500" aria-hidden />
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={label}
          aria-busy={applying !== null || undefined}
          className={cn(triggerClasses, width)}
        >
          <span className="truncate">{pendingLabel ?? current?.label}</span>
          {applying !== null ? (
            <Loader2 className="size-4 shrink-0 animate-spin text-brand-600" aria-hidden />
          ) : (
            <ChevronDown className="size-4 shrink-0 text-ink-500" aria-hidden />
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-80 overflow-y-auto">
          <DropdownMenuLabel>
            <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">{label}</span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {options.map((option) => {
            const active = option.value === value
            return (
              <DropdownMenuItem key={option.value} asChild>
                <Link
                  href={hrefFor(option.value)}
                  scroll={false}
                  aria-current={active ? 'true' : undefined}
                  onClick={() => setApplying(option.value)}
                >
                  <Check className={cn('size-4', active ? 'text-brand-600' : 'invisible')} aria-hidden />
                  <span className={cn('truncate', active && 'font-medium text-ink-900')}>{option.label}</span>
                </Link>
              </DropdownMenuItem>
            )
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

export function FilterBar({
  divisions = [],
  salesReps = [],
  showDivision = true,
  showSalesRep = false,
  showDateRange = true,
  defaultRange = 'last_30_days',
  children,
}: FilterBarProps) {
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const range = (searchParams.get('range') as RangePreset | null) ?? defaultRange
  const division = searchParams.get('division') ?? 'all'
  const rep = searchParams.get('rep') ?? 'all'

  const hasFilters = searchParams.has('range') || searchParams.has('division') || searchParams.has('rep')

  return (
    <div className="mb-5 flex flex-wrap items-center gap-2 print-hidden">
      {showDateRange ? (
        <FilterMenu
          icon={CalendarDays}
          label="Reporting period"
          paramName="range"
          value={range}
          width="w-[11.5rem]"
          options={PRESET_ORDER.map((preset) => ({
            value: preset,
            label: RANGE_PRESET_LABELS[preset as Exclude<RangePreset, 'custom'>],
          }))}
        />
      ) : null}

      {showDivision && divisions.length > 1 ? (
        <FilterMenu
          icon={Building2}
          label="Division"
          paramName="division"
          value={division}
          width="w-[11.5rem]"
          options={[
            { value: 'all', label: 'All divisions' },
            ...divisions.map((d) => ({ value: d.id, label: d.name })),
          ]}
        />
      ) : null}

      {showSalesRep && salesReps.length > 1 ? (
        <FilterMenu
          icon={UserRound}
          label="Sales representative"
          paramName="rep"
          value={rep}
          width="w-[12rem]"
          options={[
            { value: 'all', label: 'All representatives' },
            ...salesReps.map((r) => ({ value: r.id, label: r.name })),
          ]}
        />
      ) : null}

      {children}

      {hasFilters ? (
        <Link
          href={pathname}
          scroll={false}
          className="inline-flex h-8 items-center gap-2 rounded-lg px-3 text-[13px] font-medium text-ink-700 transition-colors hover:bg-ink-100 hover:text-ink-900"
        >
          <RotateCcw className="size-4" aria-hidden />
          Reset filters
        </Link>
      ) : null}
    </div>
  )
}
