import { ArrowRight, MessageSquare, RefreshCw } from 'lucide-react'
import { Link, useDocumentTitle } from '@/lib/navigation'
import { usePageData } from '@/lib/query'
import { PageQuery } from '@/components/layout/page-error'
import { OverviewSkeleton } from '@/components/layout/page-skeleton'
import { formatCurrency, formatDeltaPercent, formatInteger, formatPercent } from '@shared/format'
import { divisionColor } from '@shared/palette'
import type { OverviewPageData } from '@shared/api/analytics'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge, StatusDot } from '@/components/ui/badge'
import { Alert, EmptyState, StaleDataNotice } from '@/components/ui/feedback'
import { DataModeBanner, MetaFact, PageHeader, SectionHeading } from '@/components/layout/page-header'
import { FilterBar } from '@/components/layout/filters'
import { KpiCard } from '@/components/metrics/kpi-card'
import { DivisionStackChart, TrendChart } from '@/components/charts/trend-chart'
import { AttentionList } from './attention-list'

/**
 * Overview dashboard (section 5).
 *
 * An executive command centre: the five KPIs, the revenue trend, how each
 * division is doing, what needs attention, and whether the data can be
 * trusted - in that order, because that is the order the question gets asked.
 */
export default function OverviewPage() {
  useDocumentTitle('Overview')
  const query = usePageData<OverviewPageData>('overview')
  return (
    <PageQuery query={query} skeleton={<OverviewSkeleton />}>
      {(data) => <Overview data={data} />}
    </PageQuery>
  )
}

function Overview({ data }: { data: OverviewPageData }) {
  const { range, can } = data

  return (
    <>
      <DataModeBanner mode={data.mode} />

      <PageHeader
        title={`${data.greeting}, ${data.firstName}`}
        meta={
          <>
            <MetaFact label="Period" value={range.label} />
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
          can.revenue || can.pipeline ? (
            <Button asChild variant="primary" size="md">
              <Link href="/ask">
                <MessageSquare aria-hidden />
                Ask a question
              </Link>
            </Button>
          ) : undefined
        }
        secondaryActions={
          can.receivables ? (
            <Button asChild variant="secondary" size="md">
              <Link href="/daily-brief">View daily brief</Link>
            </Button>
          ) : undefined
        }
      />

      <FilterBar divisions={data.availableDivisions} showSalesRep={false} />

      {data.scopeNote ? (
        <Alert tone="info" title="What you are seeing" className="mb-5">
          {data.scopeNote}
        </Alert>
      ) : null}

      {data.isStale ? <StaleDataNotice sources={data.staleSources} className="mb-5" /> : null}

      {/* --- KPI cards ----------------------------------------------------- */}
      <section aria-label="Key performance indicators" className="mb-7">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {data.kpis.map((metric) => (
            <KpiCard key={metric.key} metric={metric} comparisonLabel={range.comparisonText} />
          ))}
        </div>
      </section>

      {/* --- Attention required -------------------------------------------- */}
      <section aria-label="Attention required" className="mb-7">
        <SectionHeading
          title="Attention required"
          description="Problems worth acting on today, most urgent first."
        />
        <Card>
          {data.attention.length === 0 ? (
            <EmptyState
              title="Nothing needs attention right now"
              description="Nothing needs attention right now."
            />
          ) : (
            <AttentionList items={data.attention} />
          )}
        </Card>
      </section>

      {/* --- Revenue trend ------------------------------------------------- */}
      {data.revenue ? (
        <section aria-label="Revenue trend" className="mb-7 grid gap-4 xl:grid-cols-5">
          <Card className="xl:col-span-3">
            <CardHeader>
              <div>
                <CardTitle>Revenue over time</CardTitle>
                <CardDescription>
                  Invoiced sales excluding tax, by invoice date, compared with {range.comparisonLabel.toLowerCase()}.
                </CardDescription>
              </div>
              <Button asChild variant="ghost" size="sm">
                <Link href="/revenue">
                  View details
                  <ArrowRight aria-hidden />
                </Link>
              </Button>
            </CardHeader>
            <CardContent>
              <TrendChart
                data={data.revenue.trend}
                currentLabel={range.label}
                comparisonLabel={range.comparisonLabel}
                footnote="Source: QuickBooks Online, excluding tax and voided invoices."
              />
            </CardContent>
          </Card>

          <Card className="xl:col-span-2">
            <CardHeader>
              <div>
                <CardTitle>Revenue by division</CardTitle>
                <CardDescription>How the total splits across the three business divisions.</CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <DivisionStackChart
                data={data.revenue.divisionTrend}
                divisions={data.revenue.divisions}
                includeUnassigned={data.revenue.hasUnassigned}
                height={280}
                footnote={
                  data.revenue.hasUnassigned
                    ? 'Unassigned covers invoices that match no division mapping rule.'
                    : 'Source: QuickBooks Online, mapped to divisions by the rules in Settings.'
                }
              />
            </CardContent>
          </Card>
        </section>
      ) : null}

      {/* --- Division performance ------------------------------------------ */}
      <section aria-label="Division performance" className="mb-7">
        <SectionHeading
          title="Division performance"
          description={`MetroLED, Pixel LED Displays and Eco LED Mart over ${range.label.toLowerCase()}.`}
        />
        {data.divisionPerformance.length === 0 ? (
          <Card>
            <EmptyState
              title="No divisions to compare"
              description="No division has records in this period, or your account is restricted to a division with no activity."
              action={{ label: 'Review division mappings', href: '/settings/divisions' }}
            />
          </Card>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {data.divisionPerformance.map((division) => (
              <Card key={division.divisionId}>
                <CardHeader className="sm:items-center">
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className="size-2.5 shrink-0 rounded-sm"
                      style={{ backgroundColor: divisionColor(division.code) }}
                      aria-hidden
                    />
                    <CardTitle className="truncate">{division.name}</CardTitle>
                  </div>
                  {division.revenueDeltaPercent !== null ? (
                    <Badge variant={division.revenueDeltaPercent >= 0 ? 'positive' : 'negative'} size="sm">
                      {formatDeltaPercent(division.revenueDeltaPercent)}
                    </Badge>
                  ) : null}
                </CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <p className="text-[12.5px] font-medium text-ink-600">Revenue</p>
                    <p className="tabular mt-0.5 text-[22px] font-semibold leading-none text-ink-900">
                      {formatCurrency(division.revenue)}
                    </p>
                    <p className="mt-1 text-[11.5px] text-ink-500">
                      {formatInteger(division.invoiceCount)} {division.invoiceCount === 1 ? 'invoice' : 'invoices'} in
                      this period
                    </p>
                  </div>

                  <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 border-t border-ink-200 pt-3">
                    {can.pipeline && division.openPipeline !== null ? (
                      <div>
                        <dt className="text-[11.5px] text-ink-500">Open pipeline</dt>
                        <dd className="tabular text-[14px] font-semibold text-ink-900">
                          {formatCurrency(division.openPipeline)}
                        </dd>
                      </div>
                    ) : null}
                    {can.receivables && division.overdueReceivables !== null ? (
                      <div>
                        <dt className="text-[11.5px] text-ink-500">Overdue A/R</dt>
                        <dd
                          className={`tabular text-[14px] font-semibold ${
                            division.overdueReceivables > 0 ? 'text-negative-700' : 'text-ink-900'
                          }`}
                        >
                          {formatCurrency(division.overdueReceivables)}
                        </dd>
                      </div>
                    ) : null}
                    {can.margin ? (
                      <div className="col-span-2">
                        <dt className="text-[11.5px] text-ink-500">Gross margin</dt>
                        <dd className="tabular text-[14px] font-semibold text-ink-900">
                          {division.grossMarginPercent !== null ? (
                            formatPercent(division.grossMarginPercent)
                          ) : (
                            <span className="text-[12.5px] font-normal text-ink-500">Not available</span>
                          )}
                        </dd>
                        {division.grossMarginPercent === null && division.marginNote ? (
                          <p className="mt-0.5 text-[11px] leading-4 text-ink-500">{division.marginNote}</p>
                        ) : null}
                      </div>
                    ) : null}
                  </dl>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* --- Data freshness ------------------------------------------------ */}
      <section aria-label="Data freshness">
        <SectionHeading
          title="Data freshness"
          description="Where these numbers come from, and when each source last synced."
          action={
            can.receivables || data.integrations.length > 0 ? (
              <Button asChild variant="ghost" size="sm">
                <Link href="/data-health">
                  <RefreshCw aria-hidden />
                  View sync history
                </Link>
              </Button>
            ) : undefined
          }
        />
        <Card>
          {data.integrations.length === 0 ? (
            <EmptyState
              title="No data sources are connected"
              description="QuickBooks Online, Method CRM and Shopify have not been connected yet, so there is nothing to report. An owner or operations user can connect them."
              action={{ label: 'Go to Data Health', href: '/data-health' }}
            />
          ) : (
            <ul className="divide-y divide-ink-200">
              {data.integrations.map((integration) => {
                const tone =
                  integration.status === 'ERROR'
                    ? 'negative'
                    : integration.isStale || integration.status === 'DEGRADED'
                      ? 'warning'
                      : integration.status === 'CONNECTED'
                        ? 'positive'
                        : 'neutral'
                return (
                  <li
                    key={integration.provider}
                    className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5"
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      <StatusDot tone={tone} />
                      <div className="min-w-0">
                        <p className="truncate text-[13.5px] font-medium text-ink-900">{integration.displayName}</p>
                        <p className="truncate text-[12px] text-ink-500">
                          {integration.isEnabled
                            ? `Syncs every ${integration.syncIntervalMin} minutes`
                            : 'Not enabled'}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 pl-6 sm:pl-0">
                      <p className="text-[12.5px] text-ink-600">
                        Last success:{' '}
                        <span className="font-medium text-ink-800">{integration.lastSuccessLabel}</span>
                      </p>
                      <Badge variant={tone === 'positive' ? 'positive' : tone === 'negative' ? 'negative' : tone === 'warning' ? 'warning' : 'neutral'} size="sm">
                        {statusLabel(integration.status, integration.isStale)}
                      </Badge>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>
      </section>
    </>
  )
}

function statusLabel(status: string, isStale: boolean): string {
  if (status === 'ERROR') return 'Failing'
  if (status === 'DEGRADED') return 'Degraded'
  if (status === 'DISCONNECTED') return 'Disconnected'
  if (status === 'NOT_CONFIGURED') return 'Not connected'
  return isStale ? 'Stale' : 'Healthy'
}
