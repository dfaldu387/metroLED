import * as React from 'react'
import type { RevenueTransactionRow } from '@shared/api/analytics'
import { Search } from 'lucide-react'
import { formatCurrency, formatDate, humanizeEnum } from '@shared/format'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/feedback'
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

/**
 * Invoice transaction table for the Revenue page.
 *
 * Serialised plain data crosses the server/client boundary (dates as ISO
 * strings), so this component can own sorting, searching and paging without a
 * round trip. Read-only: there is no action here that would change an invoice.
 */

const PAGE_SIZE = 25

export function RevenueTransactions({
  invoices,
  canSeeCustomers,
}: {
  invoices: RevenueTransactionRow[]
  canSeeCustomers: boolean
}) {
  const [query, setQuery] = React.useState('')
  const [sortKey, setSortKey] = React.useState('issuedOn')
  const [direction, setDirection] = React.useState<SortDirection>('desc')
  const [page, setPage] = React.useState(0)

  const onSort = (key: string) => {
    if (key === sortKey) {
      setDirection((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      // Amounts and dates are most useful largest/newest first.
      setDirection(key === 'docNumber' || key === 'customerName' ? 'asc' : 'desc')
    }
    setPage(0)
  }

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return invoices
    return invoices.filter(
      (i) =>
        i.docNumber.toLowerCase().includes(q) ||
        (i.customerName ?? '').toLowerCase().includes(q) ||
        (i.divisionName ?? '').toLowerCase().includes(q) ||
        (i.salesRepName ?? '').toLowerCase().includes(q),
    )
  }, [invoices, query])

  const sorted = React.useMemo(
    () =>
      sortRows(filtered, sortKey, direction, (row, key) => {
        switch (key) {
          case 'issuedOn':
            return new Date(row.issuedOn)
          case 'revenueAmount':
            return row.revenueAmount
          case 'total':
            return row.total
          case 'balance':
            return row.balance
          case 'customerName':
            return row.customerName ?? null
          case 'divisionName':
            return row.divisionName ?? null
          case 'salesRepName':
            return row.salesRepName ?? null
          case 'status':
            return row.status
          default:
            return row.docNumber
        }
      }),
    [filtered, sortKey, direction],
  )

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages - 1)
  const pageRows = sorted.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE)
  const pageTotal = pageRows.reduce((acc, r) => acc + r.revenueAmount, 0)

  if (invoices.length === 0) {
    return (
      <EmptyState
        title="No invoices in this period"
        description="No invoices are dated inside the selected period for the filters you have applied. Widen the date range, or check on the Data Health page that QuickBooks has finished syncing."
        action={{ label: 'View sync history', href: '/data-health' }}
      />
    )
  }

  return (
    <>
      <div className="flex flex-col gap-2 border-b border-ink-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-400" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setPage(0)
            }}
            placeholder="Search invoice number, customer, division"
            aria-label="Search invoices"
            className="h-9 w-full rounded-lg border border-ink-300 bg-surface pl-8 pr-3 text-sm text-ink-900 shadow-card transition-colors placeholder:text-ink-400 hover:border-ink-400 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20 sm:w-80"
          />
        </div>
        <p className="text-[12.5px] text-ink-600" role="status">
          {sorted.length === invoices.length
            ? `${invoices.length} invoice${invoices.length === 1 ? '' : 's'}`
            : `${sorted.length} of ${invoices.length} invoices match`}
        </p>
      </div>

      {sorted.length === 0 ? (
        <EmptyState
          title="No invoices match your search"
          description={`Nothing matches “${query}”. Clear the search box to see every invoice in this period.`}
          action={
            <Button variant="secondary" size="sm" onClick={() => setQuery('')}>
              Clear search
            </Button>
          }
        />
      ) : (
        <>
          <TableScroll>
            <Table>
              <THead>
                <TR>
                  <SortableTH label="Invoice" columnKey="docNumber" activeKey={sortKey} direction={direction} onSort={onSort} />
                  <SortableTH label="Date" columnKey="issuedOn" activeKey={sortKey} direction={direction} onSort={onSort} />
                  {canSeeCustomers ? (
                    <SortableTH label="Customer" columnKey="customerName" activeKey={sortKey} direction={direction} onSort={onSort} />
                  ) : null}
                  <SortableTH label="Division" columnKey="divisionName" activeKey={sortKey} direction={direction} onSort={onSort} />
                  <SortableTH label="Representative" columnKey="salesRepName" activeKey={sortKey} direction={direction} onSort={onSort} />
                  <SortableTH
                    label="Revenue"
                    columnKey="revenueAmount"
                    activeKey={sortKey}
                    direction={direction}
                    onSort={onSort}
                    numeric
                    tooltip="Invoice subtotal excluding tax - the revenue basis"
                  />
                  <SortableTH label="Balance" columnKey="balance" activeKey={sortKey} direction={direction} onSort={onSort} numeric />
                  <SortableTH label="Status" columnKey="status" activeKey={sortKey} direction={direction} onSort={onSort} />
                </TR>
              </THead>
              <TBody>
                {pageRows.map((row) => (
                  <TR key={row.id} className="hover:bg-ink-50">
                    <TD className="whitespace-nowrap font-medium text-ink-900">{row.docNumber}</TD>
                    <TD className="whitespace-nowrap text-ink-700">{formatDate(row.issuedOn)}</TD>
                    {canSeeCustomers ? (
                      <TD className="max-w-[16rem] truncate" title={row.customerName ?? undefined}>
                        {row.customerName ?? <span className="italic text-ink-500">Unknown customer</span>}
                      </TD>
                    ) : null}
                    <TD className="whitespace-nowrap">
                      {row.divisionName ?? <span className="italic text-ink-500">Unassigned</span>}
                    </TD>
                    <TD className="max-w-[12rem] truncate" title={row.salesRepName ?? undefined}>
                      {row.salesRepName ?? <span className="italic text-ink-500">Not recorded</span>}
                    </TD>
                    <TD numeric className="font-medium">
                      {formatCurrency(row.revenueAmount, { decimals: true })}
                    </TD>
                    <TD numeric className={row.balance > 0 ? 'text-ink-900' : 'text-ink-500'}>
                      {formatCurrency(row.balance, { decimals: true })}
                    </TD>
                    <TD>
                      <Badge
                        variant={
                          row.status === 'PAID' ? 'positive' : row.status === 'PARTIALLY_PAID' ? 'warning' : 'neutral'
                        }
                        size="sm"
                      >
                        {humanizeEnum(row.status)}
                      </Badge>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableScroll>

          <div className="flex flex-col gap-2 border-t border-ink-200 bg-ink-50/60 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <p className="tabular text-[12.5px] text-ink-600">
              Showing {safePage * PAGE_SIZE + 1}–{Math.min((safePage + 1) * PAGE_SIZE, sorted.length)} of{' '}
              {sorted.length}. Revenue on this page: <span className="font-semibold">{formatCurrency(pageTotal)}</span>
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
    </>
  )
}
