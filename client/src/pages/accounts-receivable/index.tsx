import { MessageSquare } from 'lucide-react'
import { Link, useDocumentTitle } from '@/lib/navigation'
import { usePageData } from '@/lib/query'
import { PageQuery } from '@/components/layout/page-error'
import { AnalyticsSkeleton } from '@/components/layout/page-skeleton'
import { AR_AGING_BUCKETS, getMetricDefinition } from '@shared/metric-definitions'
import { formatCurrency, formatInteger } from '@shared/format'
import type { AccountsReceivablePageData } from '@shared/api/analytics'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Alert, StaleDataNotice } from '@/components/ui/feedback'
import { DataModeBanner, MetaFact, PageHeader } from '@/components/layout/page-header'
import { FilterBar } from '@/components/layout/filters'
import { Stat } from '@/components/metrics/kpi-card'
import { BreakdownBars } from '@/components/charts/breakdown-bars'
import { InvoiceTable } from './invoice-table'

/**
 * Accounts receivable (section 7).
 *
 * Read-only by design: there is no control here that edits an invoice, records
 * a payment or contacts a customer. Those actions belong in QuickBooks, and
 * Phase 1 explicitly excludes writing back to client systems.
 */
export default function AccountsReceivablePage() {
  useDocumentTitle('Accounts Receivable')
  const query = usePageData<AccountsReceivablePageData>('accounts-receivable')
  return (
    <PageQuery query={query} skeleton={<AnalyticsSkeleton />}>
      {(data) => <AccountsReceivable data={data} />}
    </PageQuery>
  )
}

function AccountsReceivable({ data }: { data: AccountsReceivablePageData }) {
  const { range, summary, dso } = data
  const arDefinition = getMetricDefinition('accounts_receivable')!
  const agingDefinition = getMetricDefinition('ar_aging_buckets')!
  const dsoDefinition = getMetricDefinition('dso')!

  return (
    <>
      <DataModeBanner mode={data.mode} />

      <PageHeader
        title="Accounts Receivable"
        description="What customers owe right now, how overdue it is, and which invoices to look at first."
        meta={
          <>
            <MetaFact label="Balances as at" value="now" />
            <MetaFact
              label="Last data refresh"
              value={data.lastRefreshLabel}
              tone={data.isStale ? 'warning' : 'default'}
            />
            {data.mode === 'demo' ? (
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

      <FilterBar divisions={data.availableDivisions} showDateRange showSalesRep={false} />

      <Alert tone="info" title="This is a reporting view only" className="mb-5">
        MetroLED Intelligence reads from QuickBooks and never writes back to it. Invoices cannot be edited here,
        payments cannot be recorded, and no reminder is ever sent to a customer from this system.
      </Alert>

      {data.scopeNote ? (
        <Alert tone="info" title="What you are seeing" className="mb-5">
          {data.scopeNote}
        </Alert>
      ) : null}

      {data.isStale ? <StaleDataNotice sources={data.staleSources} className="mb-5" /> : null}

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
              rows={data.buckets.map((b) => ({
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
              rows={data.byDivision}
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
            rows={data.byCustomer}
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
          initialFilter={data.initialFilter}
          initialBucket={data.initialBucket}
          invoices={data.invoices}
        />
      </Card>
    </>
  )
}
