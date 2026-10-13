import * as React from 'react'
import type { ArInvoiceRow } from '@shared/api/analytics'
import { ExternalLink, Search } from 'lucide-react'
import { formatCurrency, formatDate, humanizeEnum } from '@shared/format'
import { AR_AGING_BUCKETS } from '@shared/metric-definitions'
import { agingColor } from '@shared/palette'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/feedback'
import { Dialog, DialogBody, DialogHeader, DialogTitle, DialogDescription, DrawerContent } from '@/components/ui/dialog'
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

/**
 * Outstanding invoice table with a detail drawer (section 7).
 *
 * The drawer shows the invoice detail plus its source reference, which is what
 * makes a figure on this page auditable: the reader can see exactly which
 * QuickBooks record produced it.
 */

const PAGE_SIZE = 25

export function InvoiceTable({
  invoices,
  initialFilter = 'all',
  initialBucket = null,
}: {
  invoices: ArInvoiceRow[]
  initialFilter?: 'all' | 'overdue'
  initialBucket?: string | null
}) {
  const [query, setQuery] = React.useState('')
  const [statusFilter, setStatusFilter] = React.useState<'all' | 'overdue' | 'current'>(initialFilter)
  const [bucketFilter, setBucketFilter] = React.useState<string>(initialBucket ?? 'all')
  const [sortKey, setSortKey] = React.useState(initialFilter === 'overdue' ? 'daysOverdue' : 'balance')
  const [direction, setDirection] = React.useState<SortDirection>('desc')
  const [page, setPage] = React.useState(0)
  const [selected, setSelected] = React.useState<ArInvoiceRow | null>(null)

  const onSort = (key: string) => {
    if (key === sortKey) setDirection((d) => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSortKey(key)
      setDirection(key === 'docNumber' || key === 'customerName' ? 'asc' : 'desc')
    }
    setPage(0)
  }

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    return invoices.filter((i) => {
      if (statusFilter === 'overdue' && !(i.daysOverdue !== null && i.daysOverdue > 0)) return false
      if (statusFilter === 'current' && !(i.daysOverdue === null || i.daysOverdue <= 0)) return false
      if (bucketFilter !== 'all') {
        const key = i.bucketKey
        if (key !== bucketFilter) return false
      }
      if (!q) return true
      return (
        i.docNumber.toLowerCase().includes(q) ||
        (i.customerName ?? '').toLowerCase().includes(q) ||
        (i.divisionName ?? '').toLowerCase().includes(q)
      )
    })
  }, [invoices, query, statusFilter, bucketFilter])

  const sorted = React.useMemo(
    () =>
      sortRows(filtered, sortKey, direction, (row, key) => {
        switch (key) {
          case 'issuedOn':
            return new Date(row.issuedOn)
          case 'dueOn':
            return row.dueOn ? new Date(row.dueOn) : null
          case 'daysOverdue':
            return row.daysOverdue
          case 'balance':
            return row.balance
          case 'customerName':
            return row.customerName ?? null
          case 'divisionName':
            return row.divisionName ?? null
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
  const filteredTotal = sorted.reduce((acc, r) => acc + r.balance, 0)

  if (invoices.length === 0) {
    return (
      <EmptyState
        title="Nothing is outstanding"
        description="Every invoice in the system has been paid in full. This table fills itself in as new invoices are issued."
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
              placeholder="Search invoice number or customer"
              aria-label="Search outstanding invoices"
              className="h-9 w-full rounded-lg border border-ink-300 bg-surface pl-8 pr-3 text-sm text-ink-900 shadow-card transition-colors placeholder:text-ink-400 hover:border-ink-400 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20 sm:w-72"
            />
          </div>

          <Select
            value={statusFilter}
            onValueChange={(v) => {
              setStatusFilter(v as 'all' | 'overdue' | 'current')
              setPage(0)
            }}
          >
            <SelectTrigger className="w-[9.5rem]" aria-label="Filter by due status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All outstanding</SelectItem>
              <SelectItem value="overdue">Overdue only</SelectItem>
              <SelectItem value="current">Not yet due</SelectItem>
            </SelectContent>
          </Select>

          <Select
            value={bucketFilter}
            onValueChange={(v) => {
              setBucketFilter(v)
              setPage(0)
            }}
          >
            <SelectTrigger className="w-[13rem]" aria-label="Filter by aging bucket">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Every aging bucket</SelectItem>
              {AR_AGING_BUCKETS.map((b) => (
                <SelectItem key={b.key} value={b.key}>
                  {b.label}
                </SelectItem>
              ))}
              <SelectItem value="no_due_date">No due date recorded</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <p className="tabular shrink-0 text-[12.5px] text-ink-600" role="status">
          {sorted.length} of {invoices.length} &middot;{' '}
          <span className="font-semibold text-ink-900">{formatCurrency(filteredTotal)}</span>
        </p>
      </div>

      {sorted.length === 0 ? (
        <EmptyState
          title="No invoices match these filters"
          description="Nothing in the current selection has an outstanding balance. Clear the filters to see every unpaid invoice."
          action={
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setQuery('')
                setStatusFilter('all')
                setBucketFilter('all')
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
                  <SortableTH label="Invoice" columnKey="docNumber" activeKey={sortKey} direction={direction} onSort={onSort} />
                  <SortableTH label="Customer" columnKey="customerName" activeKey={sortKey} direction={direction} onSort={onSort} />
                  <SortableTH label="Division" columnKey="divisionName" activeKey={sortKey} direction={direction} onSort={onSort} />
                  <SortableTH label="Invoice date" columnKey="issuedOn" activeKey={sortKey} direction={direction} onSort={onSort} />
                  <SortableTH label="Due date" columnKey="dueOn" activeKey={sortKey} direction={direction} onSort={onSort} />
                  <SortableTH
                    label="Days overdue"
                    columnKey="daysOverdue"
                    activeKey={sortKey}
                    direction={direction}
                    onSort={onSort}
                    numeric
                    tooltip="Today minus the due date. Blank when no due date is recorded."
                  />
                  <SortableTH label="Balance" columnKey="balance" activeKey={sortKey} direction={direction} onSort={onSort} numeric />
                  <SortableTH label="Status" columnKey="status" activeKey={sortKey} direction={direction} onSort={onSort} />
                  <THeadActions />
                </TR>
              </THead>
              <TBody>
                {pageRows.map((row) => {
                  const overdue = row.daysOverdue !== null && row.daysOverdue > 0
                  const bucketKey = row.bucketKey
                  return (
                    <TR key={row.id} className="hover:bg-ink-50">
                      <TD className="whitespace-nowrap font-medium text-ink-900">{row.docNumber}</TD>
                      <TD className="max-w-[15rem] truncate" title={row.customerName ?? undefined}>
                        {row.customerName ?? <span className="italic text-ink-500">Unknown customer</span>}
                      </TD>
                      <TD className="whitespace-nowrap">
                        {row.divisionName ?? <span className="italic text-ink-500">Unassigned</span>}
                      </TD>
                      <TD className="whitespace-nowrap text-ink-700">{formatDate(row.issuedOn)}</TD>
                      <TD className="whitespace-nowrap text-ink-700">
                        {row.dueOn ? formatDate(row.dueOn) : <span className="italic text-ink-500">Not recorded</span>}
                      </TD>
                      <TD numeric>
                        {row.daysOverdue === null ? (
                          <span className="italic text-ink-500">&mdash;</span>
                        ) : overdue ? (
                          <span className="inline-flex items-center gap-1.5 font-medium">
                            <span
                              className="size-2 rounded-full"
                              style={{ backgroundColor: agingColor(bucketKey) }}
                              aria-hidden
                            />
                            {row.daysOverdue}
                          </span>
                        ) : (
                          <span className="text-ink-500">{row.daysOverdue}</span>
                        )}
                      </TD>
                      <TD numeric className="font-semibold">
                        {formatCurrency(row.balance, { decimals: true })}
                      </TD>
                      <TD>
                        <Badge variant={overdue ? 'negative' : 'neutral'} size="sm">
                          {overdue ? 'Overdue' : humanizeEnum(row.status)}
                        </Badge>
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
        {selected ? <InvoiceDetail invoice={selected} /> : null}
      </Dialog>
    </>
  )
}

function THeadActions() {
  return (
    <th scope="col" className="border-b border-ink-200 px-3 py-2.5 text-right">
      <span className="sr-only">Actions</span>
    </th>
  )
}

function InvoiceDetail({ invoice }: { invoice: ArInvoiceRow }) {
  const overdue = invoice.daysOverdue !== null && invoice.daysOverdue > 0
  const providerName =
    invoice.provider === 'QUICKBOOKS'
      ? 'QuickBooks Online'
      : invoice.provider === 'METHOD_CRM'
        ? 'Method CRM'
        : invoice.provider

  return (
    <DrawerContent aria-describedby="invoice-detail-description">
      <DialogHeader>
        <DialogTitle>Invoice {invoice.docNumber}</DialogTitle>
        <DialogDescription id="invoice-detail-description">
          {invoice.customerName ?? 'Unknown customer'}
          {invoice.divisionName ? ` · ${invoice.divisionName}` : ''}
        </DialogDescription>
      </DialogHeader>

      <DialogBody className="space-y-5">
        <div className="rounded-lg border border-ink-200 bg-ink-50 px-3.5 py-3">
          <p className="text-[12px] font-medium text-ink-600">Outstanding balance</p>
          <p className={`tabular mt-0.5 text-[24px] font-semibold leading-none ${overdue ? 'text-negative-700' : 'text-ink-900'}`}>
            {formatCurrency(invoice.balance, { decimals: true })}
          </p>
          <p className="mt-1.5 text-[12px] text-ink-600">
            {invoice.daysOverdue === null
              ? 'No due date is recorded on this invoice, so it cannot be aged.'
              : overdue
                ? `${invoice.daysOverdue} days past due.`
                : `Due in ${Math.abs(invoice.daysOverdue)} days.`}
          </p>
        </div>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-3.5">
          <DetailRow label="Invoice date" value={formatDate(invoice.issuedOn)} />
          <DetailRow label="Due date" value={invoice.dueOn ? formatDate(invoice.dueOn) : 'Not recorded'} />
          <DetailRow label="Invoice total" value={formatCurrency(invoice.total, { decimals: true })} />
          <DetailRow label="Amount paid" value={formatCurrency(invoice.amountPaid, { decimals: true })} />
          <DetailRow
            label="Revenue (excluding tax)"
            value={formatCurrency(invoice.revenueAmount, { decimals: true })}
          />
          <DetailRow label="Currency" value={invoice.currency} />
          <DetailRow label="Division" value={invoice.divisionName ?? 'Unassigned'} />
          <DetailRow label="Representative" value={invoice.salesRepName ?? 'Not recorded'} />
          <DetailRow label="Status in QuickBooks" value={humanizeEnum(invoice.status)} />
        </dl>

        <div className="rounded-lg border border-ink-200 px-3.5 py-3">
          <p className="flex items-center gap-1.5 text-[12.5px] font-semibold text-ink-900">
            <ExternalLink className="size-3.5 text-ink-500" aria-hidden />
            Source record
          </p>
          <dl className="mt-2 space-y-1.5">
            <div className="flex justify-between gap-3 text-[12.5px]">
              <dt className="text-ink-600">Source system</dt>
              <dd className="font-medium text-ink-900">{providerName}</dd>
            </div>
            <div className="flex justify-between gap-3 text-[12.5px]">
              <dt className="text-ink-600">Document number</dt>
              <dd className="font-mono font-medium text-ink-900">{invoice.docNumber}</dd>
            </div>
            <div className="flex justify-between gap-3 text-[12.5px]">
              <dt className="text-ink-600">Source identifier</dt>
              <dd className="font-mono font-medium text-ink-900">{invoice.sourceId}</dd>
            </div>
          </dl>
          <p className="mt-2.5 text-[11.5px] leading-4 text-ink-500">
            Use this identifier to find the original record in {providerName}. MetroLED Intelligence never modifies
            it.
          </p>
        </div>
      </DialogBody>
    </DrawerContent>
  )
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11.5px] text-ink-500">{label}</dt>
      <dd className="tabular mt-0.5 text-[13.5px] font-medium text-ink-900">{value}</dd>
    </div>
  )
}
