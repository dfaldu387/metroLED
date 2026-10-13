import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowRight, MessageSquare, RefreshCw } from 'lucide-react'
import { PERMISSIONS } from '@/lib/auth/permissions'
import { comparisonLabel, getPageContext, scopeNoteForUser } from '@/lib/page-context'
import {
  buildAttentionItems,
  buildDivisionPerformance,
  buildOverviewKpis,
} from '@/lib/analytics/overview'
import { revenueTrend, revenueTrendByDivision } from '@/lib/analytics/revenue'
import { formatCurrency, formatDeltaPercent, formatInteger, formatPercent } from '@/lib/format'
import { formatRelativeTime } from '@/lib/dates'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge, StatusDot } from '@/components/ui/badge'
import { Alert, EmptyState, StaleDataNotice } from '@/components/ui/feedback'
import { DataModeBanner, MetaFact, PageHeader, SectionHeading } from '@/components/layout/page-header'
import { FilterBar } from '@/components/layout/filters'
import { KpiCard } from '@/components/metrics/kpi-card'
import { DivisionStackChart, TrendChart } from '@/components/charts/trend-chart'
import { AttentionList } from './attention-list'
import { divisionColor } from '@/lib/charts/palette'

export const metadata: Metadata = { title: 'Overview' }

/**
 * Overview dashboard (section 5).
 *
 * An executive command centre: the five KPIs, the revenue trend, how each
 * division is doing, what needs attention, and whether the data can be
 * trusted - in that order, because that is the order the question gets asked.
 */
export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const context = await getPageContext(PERMISSIONS.OVERVIEW_VIEW, '/overview', params, {
    defaultRange: 'last_30_days',
  })
  const { dataset, range, scope, settings, user, now } = context

  const overviewScope = {
    canSeeMargin: scope.canSeeMargin,
    canSeeReceivables: scope.canSeeReceivables,
    canSeePipeline: scope.canSeePipeline,
    canSeeEcommerce: scope.canSeeEcommerce,
    canSeeRevenue: scope.canSeeRevenue,
  }
  const overviewSettings = {
    staleQuoteDays: settings.staleQuoteDays,
    largeQuoteAmount: settings.largeQuoteAmount,
  }

  const kpis = buildOverviewKpis(dataset, range, overviewScope, overviewSettings, now)
  const divisionPerformance = buildDivisionPerformance(dataset, range, overviewScope, now)
  const attention = buildAttentionItems(dataset, overviewScope, overviewSettings, {
    asOf: now,
    unmatchedCount: dataset.unmatchedCount,
  })

  const trend = revenueTrend(dataset.invoices, range, range.granularity, range.comparison)
  const divisionTrend = revenueTrendByDivision(dataset.invoices, range, range.granularity, dataset.divisions)
  const hasUnassigned = dataset.invoices.some((i) => !i.divisionId && i.revenueAmount > 0)

  const greeting = greetingFor(now, settings.timezone)
  const firstName = user.name.split(/\s+/)[0] ?? user.name
  const scopeNote = scopeNoteForUser(context)

  return (
    <>
      <DataModeBanner mode={dataset.mode} />

      <PageHeader
        title={`${greeting}, ${firstName}`}
        description="Here is how your business is performing."
        meta={
          <>
            <MetaFact label="Period" value={range.label} />
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
          scope.canSeeRevenue || scope.canSeePipeline ? (
            <Button asChild variant="primary" size="md">
              <Link href="/ask">
                <MessageSquare aria-hidden />
                Ask a question
              </Link>
            </Button>
          ) : undefined
        }
        secondaryActions={
          scope.canSeeReceivables ? (
            <Button asChild variant="secondary" size="md">
              <Link href="/daily-brief">View daily brief</Link>
            </Button>
          ) : undefined
        }
      />

      <FilterBar divisions={dataset.availableDivisions} showSalesRep={false} />

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

      {/* --- KPI cards ----------------------------------------------------- */}
      <section aria-label="Key performance indicators" className="mb-7">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {kpis.map((metric) => (
            <KpiCard key={metric.key} metric={metric} comparisonLabel={comparisonLabel(range)} />
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
          {attention.length === 0 ? (
            <EmptyState
              title="Nothing needs attention right now"
              description="No newly overdue invoices, no stale large quotes, no failing integrations and no unmatched records. This list fills itself in when something changes."
            />
          ) : (
            <AttentionList items={attention} />
          )}
        </Card>
      </section>

      {/* --- Revenue trend ------------------------------------------------- */}
      {scope.canSeeRevenue ? (
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
                data={trend}
                currentLabel={range.label}
                comparisonLabel={range.comparisonLabel}
                footnote="Source: QuickBooks Online. Excludes draft and voided invoices, and excludes sales tax."
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
                data={divisionTrend}
                divisions={dataset.divisions}
                includeUnassigned={hasUnassigned}
                height={280}
                footnote={
                  hasUnassigned
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
        {divisionPerformance.length === 0 ? (
          <Card>
            <EmptyState
              title="No divisions to compare"
              description="No division has records in this period, or your account is restricted to a division with no activity."
              action={{ label: 'Review division mappings', href: '/settings/divisions' }}
            />
          </Card>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {divisionPerformance.map((division) => (
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
                    {scope.canSeePipeline ? (
                      <div>
                        <dt className="text-[11.5px] text-ink-500">Open pipeline</dt>
                        <dd className="tabular text-[14px] font-semibold text-ink-900">
                          {formatCurrency(division.openPipeline)}
                        </dd>
                      </div>
                    ) : null}
                    {scope.canSeeReceivables ? (
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
                    {scope.canSeeMargin ? (
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
            scope.canSeeReceivables || dataset.integrations.length > 0 ? (
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
          {dataset.integrations.length === 0 ? (
            <EmptyState
              title="No data sources are connected"
              description="QuickBooks Online, Method CRM and Shopify have not been connected yet, so there is nothing to report. An owner or operations user can connect them."
              action={{ label: 'Go to Data Health', href: '/data-health' }}
            />
          ) : (
            <ul className="divide-y divide-ink-200">
              {dataset.integrations.map((integration) => {
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
                        <span className="font-medium text-ink-800">
                          {formatRelativeTime(integration.lastSuccessAt, now)}
                        </span>
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

function greetingFor(now: Date, timeZone: string): string {
  const hour = Number(
    new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', hour12: false }).format(now),
  )
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

function statusLabel(status: string, isStale: boolean): string {
  if (status === 'ERROR') return 'Failing'
  if (status === 'DEGRADED') return 'Degraded'
  if (status === 'DISCONNECTED') return 'Disconnected'
  if (status === 'NOT_CONFIGURED') return 'Not connected'
  return isStale ? 'Stale' : 'Healthy'
}
