import * as React from 'react'
import type { QuoteRow } from '@shared/api/analytics'
import { AlertTriangle, ExternalLink, Search } from 'lucide-react'
import { formatCurrency, formatDate } from '@shared/format'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/feedback'
import { Dialog, DialogBody, DialogDescription, DialogHeader, DialogTitle, DrawerContent } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/form'
import {
  SortableTH,
  TBody,
  TD,
  THead,
  TR,
  Table,
  TableScroll,
  sortRows,
  type SortDirection,
} from '@/components/ui/table'

/** Open quote table with a detail drawer. Read-only; no follow-up is sent. */

const PAGE_SIZE = 25

export function QuoteTable({
  quotes,
  staleThresholdDays,
  largeQuoteAmount,
  initialFilter = 'all',
}: {
  quotes: QuoteRow[]
  staleThresholdDays: number
  largeQuoteAmount: number
  initialFilter?: 'all' | 'stale' | 'large'
}) {
  const [query, setQuery] = React.useState('')
  const [filter, setFilter] = React.useState<'all' | 'stale' | 'large' | 'large_stale'>(initialFilter)
  const [sortKey, setSortKey] = React.useState(initialFilter === 'all' ? 'amount' : 'daysIdle')
  const [direction, setDirection] = React.useState<SortDirection>('desc')
  const [page, setPage] = React.useState(0)
  const [selected, setSelected] = React.useState<QuoteRow | null>(null)

  const onSort = (key: string) => {
    if (key === sortKey) setDirection((d) => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSortKey(key)
      setDirection(key === 'docNumber' || key === 'customerName' || key === 'stage' ? 'asc' : 'desc')
    }
    setPage(0)
  }

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    return quotes.filter((row) => {
      const isStale = row.daysIdle >= staleThresholdDays
      const isLarge = row.amount >= largeQuoteAmount
      if (filter === 'stale' && !isStale) return false
      if (filter === 'large' && !isLarge) return false
      if (filter === 'large_stale' && !(isStale && isLarge)) return false
      if (!q) return true
      return (
        row.docNumber.toLowerCase().includes(q) ||
        (row.customerName ?? '').toLowerCase().includes(q) ||
        (row.salesRepName ?? '').toLowerCase().includes(q) ||
        row.stage.toLowerCase().includes(q)
      )
    })
  }, [quotes, query, filter, staleThresholdDays, largeQuoteAmount])

  const sorted = React.useMemo(
    () =>
      sortRows(filtered, sortKey, direction, (row, key) => {
        switch (key) {
          case 'amount':
            return row.amount
          case 'daysIdle':
            return row.daysIdle
          case 'issuedOn':
            return new Date(row.issuedOn)
          case 'lastActivityAt':
            return row.lastActivityAt ? new Date(row.lastActivityAt) : null
          case 'customerName':
            return row.customerName ?? null
          case 'salesRepName':
            return row.salesRepName ?? null
          case 'stage':
            return row.stage
          default:
            return row.docNumber
        }
      }),
    [filtered, sortKey, direction],
  )

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages - 1)
  const pageRows = sorted.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE)
  const filteredValue = sorted.reduce((acc, r) => acc + r.amount, 0)

  if (quotes.length === 0) {
    return (
      <EmptyState
        title="No open quotes"
        description="There are no open quotes in Method CRM for the filters you have applied. This table fills itself in as quotes are raised."
        action={{ label: 'View sync history', href: '/data-health' }}
      />
    )
  }

  return (
    <>
      <div className="flex flex-col gap-2 border-b border-ink-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-400" aria-hidden />
            <input
              type="search"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setPage(0)
              }}
              placeholder="Search quote, customer, stage"
              aria-label="Search open quotes"
              className="h-9 w-full rounded-lg border border-ink-300 bg-surface pl-8 pr-3 text-sm text-ink-900 shadow-card transition-colors placeholder:text-ink-400 hover:border-ink-400 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20 sm:w-72"
            />
          </div>

          <Select
            value={filter}
            onValueChange={(v) => {
              setFilter(v as typeof filter)
              setPage(0)
            }}
          >
            <SelectTrigger className="w-[15rem]" aria-label="Filter quotes">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All open quotes</SelectItem>
              <SelectItem value="stale">Stale ({staleThresholdDays}+ days idle)</SelectItem>
              <SelectItem value="large">Large ({formatCurrency(largeQuoteAmount)}+)</SelectItem>
              <SelectItem value="large_stale">Large and stale</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <p className="tabular shrink-0 text-[12.5px] text-ink-600" role="status">
          {sorted.length} of {quotes.length} &middot;{' '}
          <span className="font-semibold text-ink-900">{formatCurrency(filteredValue)}</span>
        </p>
      </div>

      {sorted.length === 0 ? (
        <EmptyState
          title="No quotes match these filters"
          description="Nothing in the current selection is an open quote. Clear the filters to see the full pipeline."
          action={
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setQuery('')
                setFilter('all')
              }}
            >
              Clear filters
            </Button>
          }
        />
      ) : (
        <>
          <TableScroll>
            <Table>
              <THead>
                <TR>
                  <SortableTH label="Quote" columnKey="docNumber" activeKey={sortKey} direction={direction} onSort={onSort} />
                  <SortableTH label="Customer" columnKey="customerName" activeKey={sortKey} direction={direction} onSort={onSort} />
                  <SortableTH label="Owner" columnKey="salesRepName" activeKey={sortKey} direction={direction} onSort={onSort} />
                  <SortableTH label="Stage" columnKey="stage" activeKey={sortKey} direction={direction} onSort={onSort} />
                  <SortableTH label="Value" columnKey="amount" activeKey={sortKey} direction={direction} onSort={onSort} numeric />
                  <SortableTH label="Created" columnKey="issuedOn" activeKey={sortKey} direction={direction} onSort={onSort} />
                  <SortableTH
                    label="Last activity"
                    columnKey="lastActivityAt"
                    activeKey={sortKey}
                    direction={direction}
                    onSort={onSort}
                  />
                  <SortableTH
                    label="Days idle"
                    columnKey="daysIdle"
                    activeKey={sortKey}
                    direction={direction}
                    onSort={onSort}
                    numeric
                    tooltip="Days since the last recorded activity, or since the quote date when none is recorded."
                  />
                  <th scope="col" className="border-b border-ink-200 px-3 py-2.5 text-right">
                    <span className="sr-only">Actions</span>
                  </th>
                </TR>
              </THead>
              <TBody>
                {pageRows.map((row) => {
                  const isStale = row.daysIdle >= staleThresholdDays
                  const isLarge = row.amount >= largeQuoteAmount
                  return (
                    <TR key={row.id} className={isStale && isLarge ? 'bg-warning-50/50 hover:bg-warning-50' : 'hover:bg-ink-50'}>
                      <TD className="whitespace-nowrap font-medium text-ink-900">{row.docNumber}</TD>
                      <TD className="max-w-[14rem] truncate" title={row.customerName ?? undefined}>
                        {row.customerName ?? <span className="italic text-ink-500">Unknown customer</span>}
                      </TD>
                      <TD className="max-w-[10rem] truncate" title={row.salesRepName ?? undefined}>
                        {row.salesRepName ?? <span className="italic text-ink-500">Not recorded</span>}
                      </TD>
                      <TD className="whitespace-nowrap">
                        <Badge variant="outline" size="sm">
                          {row.stage}
                        </Badge>
                      </TD>
                      <TD numeric className="font-semibold">
                        {formatCurrency(row.amount)}
                        {isLarge ? <span className="sr-only"> (large quote)</span> : null}
                      </TD>
                      <TD className="whitespace-nowrap text-ink-700">{formatDate(row.issuedOn)}</TD>
                      <TD className="whitespace-nowrap text-ink-700">
                        {row.lastActivityAt ? (
                          formatDate(row.lastActivityAt)
                        ) : (
                          <span className="italic text-ink-500">None recorded</span>
                        )}
                      </TD>
                      <TD numeric>
                        {isStale ? (
                          <span className="inline-flex items-center gap-1.5 font-semibold text-warning-800">
                            <AlertTriangle className="size-3.5" aria-hidden />
                            {row.daysIdle}
                          </span>
                        ) : (
                          <span className="text-ink-700">{row.daysIdle}</span>
                        )}
                      </TD>
                      <TD className="text-right">
                        <Button variant="ghost" size="sm" onClick={() => setSelected(row)}>
                          View details
                        </Button>
                      </TD>
                    </TR>
                  )
                })}
              </TBody>
            </Table>
          </TableScroll>

          <div className="flex flex-col gap-2 border-t border-ink-200 bg-ink-50/60 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <p className="tabular text-[12.5px] text-ink-600">
              Showing {safePage * PAGE_SIZE + 1}&ndash;{Math.min((safePage + 1) * PAGE_SIZE, sorted.length)} of{' '}
              {sorted.length}
            </p>
            {totalPages > 1 ? (
              <div className="flex items-center gap-2">
                <Button variant="secondary" size="sm" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>
                  Previous
                </Button>
                <span className="tabular text-[12.5px] text-ink-600">
                  Page {safePage + 1} of {totalPages}
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={safePage >= totalPages - 1}
                  onClick={() => setPage(safePage + 1)}
                >
                  Next
                </Button>
              </div>
            ) : null}
          </div>
        </>
      )}

      <Dialog open={selected !== null} onOpenChange={(open) => !open && setSelected(null)}>
        {selected ? (
          <DrawerContent aria-describedby="quote-detail-description">
            <DialogHeader>
              <DialogTitle>Quote {selected.docNumber}</DialogTitle>
              <DialogDescription id="quote-detail-description">
                {selected.customerName ?? 'Unknown customer'}
                {selected.divisionName ? ` · ${selected.divisionName}` : ''}
              </DialogDescription>
            </DialogHeader>
            <DialogBody className="space-y-5">
              <div className="rounded-lg border border-ink-200 bg-ink-50 px-3.5 py-3">
                <p className="text-[12px] font-medium text-ink-600">Quote value</p>
                <p className="tabular mt-0.5 text-[24px] font-semibold leading-none text-ink-900">
                  {formatCurrency(selected.amount, { decimals: true })}
                </p>
                <p className="mt-1.5 text-[12px] text-ink-600">
                  {selected.daysIdle >= staleThresholdDays
                    ? `No activity for ${selected.daysIdle} days. This is past the ${staleThresholdDays}-day stale threshold.`
                    : `Last activity ${selected.daysIdle} ${selected.daysIdle === 1 ? 'day' : 'days'} ago.`}
                </p>
              </div>

              <dl className="grid grid-cols-2 gap-x-4 gap-y-3.5">
                <Detail label="Stage" value={selected.stage} />
                <Detail label="Owner" value={selected.salesRepName ?? 'Not recorded'} />
                <Detail label="Created" value={formatDate(selected.issuedOn)} />
                <Detail label="Expires" value={selected.expiresOn ? formatDate(selected.expiresOn) : 'Not recorded'} />
                <Detail
                  label="Last activity"
                  value={selected.lastActivityAt ? formatDate(selected.lastActivityAt) : 'None recorded'}
                />
                <Detail label="Division" value={selected.divisionName ?? 'Unassigned'} />
                <Detail label="Currency" value={selected.currency} />
              </dl>

              <div className="rounded-lg border border-ink-200 px-3.5 py-3">
                <p className="flex items-center gap-1.5 text-[12.5px] font-semibold text-ink-900">
                  <ExternalLink className="size-3.5 text-ink-500" aria-hidden />
                  Source record
                </p>
                <dl className="mt-2 space-y-1.5">
                  <div className="flex justify-between gap-3 text-[12.5px]">
                    <dt className="text-ink-600">Source system</dt>
                    <dd className="font-medium text-ink-900">Method CRM</dd>
                  </div>
                  <div className="flex justify-between gap-3 text-[12.5px]">
                    <dt className="text-ink-600">Source identifier</dt>
                    <dd className="font-mono font-medium text-ink-900">{selected.sourceId}</dd>
                  </div>
                </dl>
                <p className="mt-2.5 text-[11.5px] leading-4 text-ink-500">
                  Follow up in Method CRM. MetroLED Intelligence does not contact customers and never modifies a
                  quote.
                </p>
              </div>
            </DialogBody>
          </DrawerContent>
        ) : null}
      </Dialog>
    </>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11.5px] text-ink-500">{label}</dt>
      <dd className="tabular mt-0.5 text-[13.5px] font-medium text-ink-900">{value}</dd>
    </div>
  )
}
