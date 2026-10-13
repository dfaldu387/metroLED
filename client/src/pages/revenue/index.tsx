import { MessageSquare } from 'lucide-react'
import { Link, useDocumentTitle } from '@/lib/navigation'
import { usePageData } from '@/lib/query'
import { PageQuery } from '@/components/layout/page-error'
import { AnalyticsSkeleton } from '@/components/layout/page-skeleton'
import { getMetricDefinition } from '@shared/metric-definitions'
import { formatCurrency, formatInteger } from '@shared/format'
import type { RevenuePageData } from '@shared/api/analytics'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Alert, RestrictedState, StaleDataNotice } from '@/components/ui/feedback'
import { DataModeBanner, MetaFact, PageHeader } from '@/components/layout/page-header'
import { FilterBar } from '@/components/layout/filters'
import { Stat } from '@/components/metrics/kpi-card'
import { InfoTip } from '@/components/ui/tooltip'
import { DivisionStackChart, TrendChart } from '@/components/charts/trend-chart'
import { BreakdownBars } from '@/components/charts/breakdown-bars'
import { RevenueTransactions } from './transactions'

/**
 * Revenue analytics (section 6).
 *
 * Every figure here is invoiced sales excluding tax, by invoice date. The
 * calculation is documented once in `metric-definitions.ts` and surfaced in
 * the tooltip on each heading, so a reader never has to guess what a number
 * includes.
 */
export default function RevenuePage() {
  useDocumentTitle('Revenue')
  const query = usePageData<RevenuePageData>('revenue')
  return (
    <PageQuery query={query} skeleton={<AnalyticsSkeleton />}>
      {(data) => <Revenue data={data} />}
    </PageQuery>
  )
}

function Revenue({ data }: { data: RevenuePageData }) {
  const { range, total, previous, invoiceCount, averageInvoice, change } = data
  const definition = getMetricDefinition('revenue')!

  return (
    <>
      <DataModeBanner mode={data.mode} />

      <PageHeader
        title="Revenue"
        description="Invoiced sales excluding tax, by invoice date. Every figure traces back to a QuickBooks invoice."
        meta={
          <>
            <MetaFact label="Period" value={range.label} />
            <MetaFact label="Compared with" value={range.comparisonLabel} />
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
            <Link href="/ask?q=What%20was%20our%20revenue%20last%20month%3F">
              <MessageSquare aria-hidden />
              Ask a question
            </Link>
          </Button>
        }
      />

      <FilterBar
        divisions={data.availableDivisions}
        salesReps={data.salesReps}
        showSalesRep={data.canSeeAllReps}
      />

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
            label="Total revenue"
            value={formatCurrency(total)}
            help={`${definition.formula}\n\nDate basis: ${definition.dateBasis}\n\nExcludes: ${definition.excludedRecords}`}
            note={
              change !== null
                ? `${change >= 0 ? '+' : '−'}${Math.abs(change).toFixed(1)}% ${range.comparisonText}`
                : 'No comparable figure for the previous period'
            }
            tone="default"
          />
          <Stat
            label="Invoices issued"
            value={formatInteger(invoiceCount)}
            help="Count of invoices dated inside the period, excluding draft and voided invoices."
            note={`Across ${formatInteger(data.customerCount)} customers`}
          />
          <Stat
            label="Average invoice"
            value={averageInvoice === null ? 'Not available' : formatCurrency(averageInvoice)}
            help="Total revenue divided by the number of invoices issued in the period."
            note={averageInvoice === null ? 'No invoices in this period' : undefined}
            tone={averageInvoice === null ? 'muted' : 'default'}
          />
          <Stat
            label="Previous period"
            value={previous > 0 ? formatCurrency(previous) : 'Not available'}
            help={`Revenue for ${range.comparisonLabel}, on the same basis.`}
            note={range.comparisonLabel}
            tone={previous > 0 ? 'default' : 'muted'}
          />
        </CardContent>
      </Card>

      {/* --- Trend --------------------------------------------------------- */}
      <div className="mb-5 grid gap-4 xl:grid-cols-5">
        <Card className="xl:col-span-3">
          <CardHeader>
            <div>
              <CardTitle className="flex items-center gap-1.5">
                Revenue trend
                <InfoTip label="About the revenue trend" content={`${definition.formula}\n\nDate basis: ${definition.dateBasis}`} />
              </CardTitle>
              <CardDescription>
                {range.label}, compared with {range.comparisonLabel.toLowerCase()}.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <TrendChart
              data={data.trend}
              currentLabel={range.label}
              comparisonLabel={range.comparisonLabel}
              height={300}
              footnote="Source: QuickBooks Online invoices, by invoice date, excluding sales tax."
            />
          </CardContent>
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader>
            <div>
              <CardTitle>Revenue by division over time</CardTitle>
              <CardDescription>Which division is driving the total in each period.</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <DivisionStackChart
              data={data.divisionTrend}
              divisions={data.availableDivisions}
              includeUnassigned={data.hasUnassigned}
              height={300}
              footnote={
                data.hasUnassigned
                  ? 'Unassigned covers invoices that match no division mapping rule in Settings.'
                  : undefined
              }
            />
          </CardContent>
        </Card>
      </div>

      {/* --- Breakdowns ---------------------------------------------------- */}
      <div className="mb-5 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Revenue by division</CardTitle>
              <CardDescription>Share of the period total, with the change on the previous period.</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <BreakdownBars
              rows={data.byDivision}
              colorMode="division"
              showDelta
              emptyTitle="No revenue by division"
              emptyDescription="No invoices in this period carry a division, or there is no revenue in the period."
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Distributor versus direct</CardTitle>
              <CardDescription>
                Classification comes from the customer record. Unclassified customers are shown separately.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <BreakdownBars
              rows={data.byClassification}
              showDelta
              emptyTitle="No classified revenue"
              emptyDescription="No invoices in this period are linked to a customer with a distributor or direct classification."
              footnote="Set a customer's classification in the source system; it is imported, not edited here."
            />
          </CardContent>
        </Card>

        {data.canSeeCustomers && data.byCustomer ? (
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Top customers</CardTitle>
                <CardDescription>The ten largest customers in this period; the rest are grouped.</CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <BreakdownBars
                rows={data.byCustomer}
                showDelta
                emptyTitle="No customer revenue"
                emptyDescription="No invoices in this period are linked to a matched customer."
                footnote="Customers that could not be matched across systems appear as “Unknown customer”. Review them on the Data Health page."
              />
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Top customers</CardTitle>
            </CardHeader>
            <RestrictedState description="Your role does not include revenue broken down by customer." />
          </Card>
        )}

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Revenue by sales representative</CardTitle>
              <CardDescription>
                {data.canSeeAllReps
                  ? 'All representatives. Invoices with no representative recorded are shown separately.'
                  : 'Your own records only.'}
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <BreakdownBars
              rows={data.byRep}
              showDelta
              emptyTitle="No revenue by representative"
              emptyDescription="No invoices in this period have a sales representative recorded."
            />
          </CardContent>
        </Card>
      </div>

      {/* --- Transactions -------------------------------------------------- */}
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Invoices in this period</CardTitle>
            <CardDescription>
              Every invoice behind the figures above. Search, sort, and open one to see its source reference.
            </CardDescription>
          </div>
        </CardHeader>
        <RevenueTransactions invoices={data.transactions} canSeeCustomers={data.canSeeCustomers} />
      </Card>
    </>
  )
}
