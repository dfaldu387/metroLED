import type { Metadata } from 'next'
import Link from 'next/link'
import { MessageSquare } from 'lucide-react'
import { PERMISSIONS } from '@/lib/auth/permissions'
import { comparisonLabel, getPageContext, scopeNoteForUser } from '@/lib/page-context'
import {
  countRevenueInvoices,
  percentChange,
  revenueByClassification,
  revenueByCustomer,
  revenueByDivision,
  revenueBySalesRep,
  revenueTrend,
  revenueTrendByDivision,
  sumRevenue,
} from '@/lib/analytics/revenue'
import { getMetricDefinition } from '@/lib/metrics/definitions'
import { formatCurrency, formatInteger } from '@/lib/format'
import { formatRelativeTime } from '@/lib/dates'
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

export const metadata: Metadata = { title: 'Revenue' }

/**
 * Revenue analytics (section 6).
 *
 * Every figure here is invoiced sales excluding tax, by invoice date. The
 * calculation is documented once in `metrics/definitions.ts` and surfaced in
 * the tooltip on each heading, so a reader never has to guess what a number
 * includes.
 */
export default async function RevenuePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const context = await getPageContext(PERMISSIONS.REVENUE_VIEW, '/revenue', params, {
    defaultRange: 'last_30_days',
  })
  const { dataset, range, scope, now } = context

  const total = sumRevenue(dataset.invoices, range)
  const previous = sumRevenue(dataset.invoices, range.comparison)
  const invoiceCount = countRevenueInvoices(dataset.invoices, range)
  const averageInvoice = invoiceCount > 0 ? total / invoiceCount : null
  const change = percentChange(total, previous > 0 ? previous : null)

  const breakdownOptions = { range, comparison: range.comparison }
  const byDivision = revenueByDivision(dataset.invoices, breakdownOptions)
  const byCustomer = revenueByCustomer(dataset.invoices, breakdownOptions)
  const byRep = revenueBySalesRep(dataset.invoices, breakdownOptions)
  const byClassification = revenueByClassification(dataset.invoices, breakdownOptions)

  const trend = revenueTrend(dataset.invoices, range, range.granularity, range.comparison)
  const divisionTrend = revenueTrendByDivision(dataset.invoices, range, range.granularity, dataset.divisions)
  const hasUnassigned = dataset.invoices.some((i) => !i.divisionId && i.revenueAmount > 0)

  const definition = getMetricDefinition('revenue')!
  const scopeNote = scopeNoteForUser(context)

  return (
    <>
      <DataModeBanner mode={dataset.mode} />

      <PageHeader
        title="Revenue"
        description="Invoiced sales excluding tax, by invoice date. Every figure traces back to a QuickBooks invoice."
        meta={
          <>
            <MetaFact label="Period" value={range.label} />
            <MetaFact label="Compared with" value={range.comparisonLabel} />
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
            <Link href="/ask?q=What%20was%20our%20revenue%20last%20month%3F">
              <MessageSquare aria-hidden />
              Ask a question
            </Link>
          </Button>
        }
      />

      <FilterBar
        divisions={dataset.availableDivisions}
        salesReps={dataset.salesReps}
        showSalesRep={scope.canSeeAllReps}
      />

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
            label="Total revenue"
            value={formatCurrency(total)}
            help={`${definition.formula}\n\nDate basis: ${definition.dateBasis}\n\nExcludes: ${definition.excludedRecords}`}
            note={
              change !== null
                ? `${change >= 0 ? '+' : '−'}${Math.abs(change).toFixed(1)}% ${comparisonLabel(range)}`
                : 'No comparable figure for the previous period'
            }
            tone="default"
          />
          <Stat
            label="Invoices issued"
            value={formatInteger(invoiceCount)}
            help="Count of invoices dated inside the period, excluding draft and voided invoices."
            note={`Across ${formatInteger(byCustomer.filter((r) => r.key !== '__other__').length)} customers`}
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
              data={trend}
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
              data={divisionTrend}
              divisions={dataset.availableDivisions}
              includeUnassigned={hasUnassigned}
              height={300}
              footnote={
                hasUnassigned
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
              rows={byDivision}
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
              rows={byClassification}
              showDelta
              emptyTitle="No classified revenue"
              emptyDescription="No invoices in this period are linked to a customer with a distributor or direct classification."
              footnote="Set a customer's classification in the source system; it is imported, not edited here."
            />
          </CardContent>
        </Card>

        {scope.canSeeCustomers ? (
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Top customers</CardTitle>
                <CardDescription>The ten largest customers in this period; the rest are grouped.</CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <BreakdownBars
                rows={byCustomer}
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
                {scope.canSeeAllReps
                  ? 'All representatives. Invoices with no representative recorded are shown separately.'
                  : 'Your own records only.'}
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <BreakdownBars
              rows={byRep}
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
        <RevenueTransactions
          invoices={dataset.invoices
            .filter(
              (i) =>
                i.issuedOn >= range.start &&
                i.issuedOn <= range.end &&
                ['OPEN', 'PARTIALLY_PAID', 'PAID'].includes(i.status),
            )
            .map((i) => ({
              id: i.id,
              docNumber: i.docNumber,
              sourceId: i.sourceId,
              provider: i.provider,
              issuedOn: i.issuedOn.toISOString(),
              customerName: i.customerName,
              divisionName: i.divisionName,
              salesRepName: i.salesRepName,
              classification: i.customerClassification,
              revenueAmount: i.revenueAmount,
              total: i.total,
              balance: i.balance,
              status: i.status,
            }))}
          canSeeCustomers={scope.canSeeCustomers}
        />
      </Card>
    </>
  )
}
