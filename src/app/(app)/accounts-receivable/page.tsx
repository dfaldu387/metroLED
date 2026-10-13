import type { Metadata } from 'next'
import Link from 'next/link'
import { MessageSquare } from 'lucide-react'
import { PERMISSIONS } from '@/lib/auth/permissions'
import { getPageContext, scopeNoteForUser } from '@/lib/page-context'
import {
  agingBuckets,
  daysOverdue,
  outstandingInvoices,
  receivablesByCustomer,
  receivablesByDivision,
  receivablesSummary,
  daysSalesOutstanding,
} from '@/lib/analytics/receivables'
import { sumRevenue } from '@/lib/analytics/revenue'
import { AR_AGING_BUCKETS, getMetricDefinition } from '@/lib/metrics/definitions'
import { formatCurrency, formatInteger } from '@/lib/format'
import { daysBetween, formatRelativeTime } from '@/lib/dates'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Alert, StaleDataNotice } from '@/components/ui/feedback'
import { DataModeBanner, MetaFact, PageHeader } from '@/components/layout/page-header'
import { FilterBar } from '@/components/layout/filters'
import { Stat } from '@/components/metrics/kpi-card'
import { BreakdownBars } from '@/components/charts/breakdown-bars'
import { InvoiceTable } from './invoice-table'

export const metadata: Metadata = { title: 'Accounts Receivable' }

/**
 * Accounts receivable (section 7).
 *
 * Read-only by design: there is no control here that edits an invoice, records
 * a payment or contacts a customer. Those actions belong in QuickBooks, and
 * Phase 1 explicitly excludes writing back to client systems.
 */
export default async function AccountsReceivablePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const context = await getPageContext(PERMISSIONS.RECEIVABLES_VIEW, '/accounts-receivable', params, {
    defaultRange: 'last_30_days',
  })
  const { dataset, range, now } = context

  const summary = receivablesSummary(dataset.invoices, now)
  const buckets = agingBuckets(dataset.invoices, now)
  const byDivision = receivablesByDivision(dataset.invoices, now)
  const byCustomer = receivablesByCustomer(dataset.invoices, now, 10)

  const revenueInPeriod = sumRevenue(dataset.invoices, range)
  const daysInPeriod = daysBetween(range.start, range.end) + 1
  const dso = daysSalesOutstanding(summary.totalOutstanding, revenueInPeriod, daysInPeriod)

  const arDefinition = getMetricDefinition('accounts_receivable')!
  const agingDefinition = getMetricDefinition('ar_aging_buckets')!
  const dsoDefinition = getMetricDefinition('dso')!
  const scopeNote = scopeNoteForUser(context)

  const initialFilter = typeof params.filter === 'string' ? params.filter : undefined
  const initialBucket = typeof params.bucket === 'string' ? params.bucket : undefined

  const outstanding = outstandingInvoices(dataset.invoices)

  return (
    <>
      <DataModeBanner mode={dataset.mode} />

      <PageHeader
        title="Accounts Receivable"
        description="What customers owe right now, how overdue it is, and which invoices to look at first."
        meta={
          <>
            <MetaFact label="Balances as at" value="now" />
            <MetaFact
              label="Last data refresh"
              value={formatRelativeTime(dataset.freshness.lastRefreshAt, now)}
              tone={dataset.freshness.isStale ? 'warning' : 'default'}
            />
            {dataset.mode === 'demo' ? (
              <Badge variant="demo" size="sm">
                Demo data
              </Badge>
            ) : null}
          </>
        }
        primaryAction={
          <Button asChild variant="primary" size="md">
            <Link href="/ask?q=How%20much%20money%20is%20overdue%3F">
              <MessageSquare aria-hidden />
              Ask a question
            </Link>
          </Button>
        }
      />

      <FilterBar divisions={dataset.availableDivisions} showDateRange showSalesRep={false} />

      <Alert tone="info" title="This is a reporting view only" className="mb-5">
        MetroLED Intelligence reads from QuickBooks and never writes back to it. Invoices cannot be edited here,
        payments cannot be recorded, and no reminder is ever sent to a customer from this system.
      </Alert>

      {scopeNote ? (
        <Alert tone="info" title="What you are seeing" className="mb-5">
          {scopeNote}
        </Alert>
      ) : null}

      {dataset.freshness.isStale ? (
        <StaleDataNotice
          sources={dataset.integrations
            .filter((integration) => integration.isStale)
            .map((integration) => ({
              name: integration.displayName,
              lastSuccessLabel: formatRelativeTime(integration.lastSuccessAt, now),
            }))}
          className="mb-5"
        />
      ) : null}

      {/* --- Headline figures ---------------------------------------------- */}
      <Card className="mb-5">
        <CardContent className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="Total outstanding"
            value={formatCurrency(summary.totalOutstanding)}
            help={`${arDefinition.formula}\n\n${arDefinition.includedRecords}`}
            note={`${formatInteger(summary.invoiceCount)} open ${summary.invoiceCount === 1 ? 'invoice' : 'invoices'}`}
          />
          <Stat
            label="Current (not yet due)"
            value={formatCurrency(summary.currentAmount)}
            help="Outstanding invoices whose due date has not passed yet."
            note={`${((summary.currentAmount / Math.max(summary.totalOutstanding, 1)) * 100).toFixed(0)}% of outstanding`}
            tone="positive"
          />
          <Stat
            label="Overdue"
            value={formatCurrency(summary.overdueAmount)}
            help="Outstanding invoices whose due date has passed. Compared against today in the company timezone."
            note={
              summary.overdueInvoiceCount > 0
                ? `${formatInteger(summary.overdueInvoiceCount)} invoices, averaging ${summary.averageDaysOverdue ?? 0} days past due`
                : 'Nothing is past its due date'
            }
            tone={summary.overdueAmount > 0 ? 'negative' : 'positive'}
          />
          <Stat
            label="Days Sales Outstanding"
            value={dso === null ? 'Not available' : `${dso} days`}
            help={`${dsoDefinition.formula}\n\n${dsoDefinition.notes ?? ''}`}
            note={
              dso === null
                ? 'No revenue in the selected period, so DSO cannot be calculated'
                : `Based on ${range.label.toLowerCase()} revenue`
            }
            tone={dso === null ? 'muted' : 'default'}
          />
        </CardContent>
      </Card>

      {summary.noDueDateCount > 0 ? (
        <Alert tone="warning" title={`${summary.noDueDateCount} outstanding invoices have no due date recorded`} className="mb-5">
          {formatCurrency(summary.noDueDateAmount)} cannot be aged, because QuickBooks holds no due date for these
          invoices. They are listed in their own aging row and are excluded from the overdue total rather than being
          assumed current.
        </Alert>
      ) : null}

      {/* --- Aging --------------------------------------------------------- */}
      <div className="mb-5 grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader>
            <div>
              <CardTitle>Receivables by aging bucket</CardTitle>
              <CardDescription>
                Days overdue is today minus the invoice due date. Buckets:{' '}
                {AR_AGING_BUCKETS.map((b) => b.label).join(', ')}.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <BreakdownBars
              rows={buckets.map((b) => ({
                key: b.key,
                label: b.label,
                value: b.amount,
                share: b.share,
                secondaryValue: b.invoiceCount,
                secondaryLabel: 'Invoices',
              }))}
              colorMode="aging"
              secondaryFormat="integer"
              emptyTitle="Nothing is outstanding"
              emptyDescription="Every invoice in the system has been paid in full. There is nothing to age."
              footnote={`${agingDefinition.notes ?? ''} Source: QuickBooks Online invoice balances.`}
            />
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <div>
              <CardTitle>Outstanding by division</CardTitle>
              <CardDescription>Total owed, with the overdue portion alongside.</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <BreakdownBars
              rows={byDivision}
              colorMode="division"
              emptyTitle="Nothing is outstanding"
              emptyDescription="No division has an unpaid balance."
            />
          </CardContent>
        </Card>
      </div>

      <Card className="mb-5">
        <CardHeader>
          <div>
            <CardTitle>Customers who owe the most</CardTitle>
            <CardDescription>The ten largest outstanding balances, with the overdue portion.</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <BreakdownBars
            rows={byCustomer}
            emptyTitle="Nothing is outstanding"
            emptyDescription="No customer has an unpaid balance."
          />
        </CardContent>
      </Card>

      {/* --- Invoice table ------------------------------------------------- */}
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Outstanding invoices</CardTitle>
            <CardDescription>
              Search and sort every unpaid invoice. Open one to see its full detail and source reference.
            </CardDescription>
          </div>
        </CardHeader>
        <InvoiceTable
          initialFilter={initialFilter === 'overdue' ? 'overdue' : 'all'}
          initialBucket={initialBucket ?? null}
          invoices={outstanding.map((i) => ({
            id: i.id,
            docNumber: i.docNumber,
            sourceId: i.sourceId,
            provider: i.provider,
            customerName: i.customerName,
            divisionName: i.divisionName,
            salesRepName: i.salesRepName,
            issuedOn: i.issuedOn.toISOString(),
            dueOn: i.dueOn ? i.dueOn.toISOString() : null,
            daysOverdue: daysOverdue(i, now),
            balance: i.balance,
            total: i.total,
            amountPaid: i.amountPaid,
            revenueAmount: i.revenueAmount,
            status: i.status,
            currency: i.currency,
          }))}
        />
      </Card>
    </>
  )
}
