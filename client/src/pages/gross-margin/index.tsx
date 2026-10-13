import { MessageSquare, ShieldCheck } from 'lucide-react'
import { Link, useDocumentTitle } from '@/lib/navigation'
import { usePageData } from '@/lib/query'
import { PageQuery } from '@/components/layout/page-error'
import { AnalyticsSkeleton } from '@/components/layout/page-skeleton'
import { getMetricDefinition } from '@shared/metric-definitions'
import { formatCurrency, formatPercent } from '@shared/format'
import { divisionColor } from '@shared/palette'
import type { GrossMarginPageData } from '@shared/api/analytics'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Alert, EmptyState } from '@/components/ui/feedback'
import { DataModeBanner, MetaFact, PageHeader } from '@/components/layout/page-header'
import { FilterBar } from '@/components/layout/filters'
import { Stat } from '@/components/metrics/kpi-card'
import { MarginTrendChart } from '@/components/charts/trend-chart'
import { TBody, TD, TH, THead, TR, Table, TableScroll } from '@/components/ui/table'

/**
 * Gross margin by division (section 10).
 *
 * Uses the formula approved by Farida:
 *   Gross Profit   = Revenue − Cost of Goods Sold
 *   Gross Margin % = (Gross Profit / Revenue) × 100
 *
 * The page refuses to report a margin for any period whose cost figure has not
 * been approved by Finance. An unapproved or partial cost base would overstate
 * margin, and a wrong profit number is worse than a missing one - so the
 * unavailable state names the months that are blocking it.
 *
 * Phase 1 covers margin by division only. Profit per project is out of scope.
 */
export default function GrossMarginPage() {
  useDocumentTitle('Gross Margin')
  const query = usePageData<GrossMarginPageData>('gross-margin')
  return (
    <PageQuery query={query} skeleton={<AnalyticsSkeleton charts={1} filters={2} />}>
      {(data) => <GrossMargin data={data} />}
    </PageQuery>
  )
}

function GrossMargin({ data }: { data: GrossMarginPageData }) {
  const { range, overall, trend, byDivision } = data

  const grossProfitDef = getMetricDefinition('gross_profit')!
  const marginDef = getMetricDefinition('gross_margin_pct')!
  const cogsDef = getMetricDefinition('cogs')!

  const approvalPending = marginDef.defaultApproval !== 'APPROVED'
  const anyDivisionAvailable = byDivision.some((d) => d.availability === 'available')

  return (
    <>
      <DataModeBanner mode={data.mode} />

      <PageHeader
        title="Gross Margin"
        description="Revenue less direct cost, by division, using the cost basis approved by Finance."
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
          <Button asChild variant="primary" size="md">
            <Link href="/ask?q=What%20is%20our%20gross%20margin%20by%20division%3F">
              <MessageSquare aria-hidden />
              Ask a question
            </Link>
          </Button>
        }
      />

      <FilterBar divisions={data.availableDivisions} showSalesRep={false} defaultRange="last_month" />

      {/* --- The formula, stated plainly ------------------------------------ */}
      <Card className="mb-5">
        <CardContent className="py-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="flex items-center gap-1.5 text-[13px] font-semibold text-ink-900">
                <ShieldCheck className="size-4 text-brand-600" aria-hidden />
                How gross margin is calculated here
              </p>
              <p className="mt-1.5 font-mono text-[12.5px] leading-5 text-ink-700">
                Gross Profit = Revenue &minus; Cost of Goods Sold
                <br />
                Gross Margin % = (Gross Profit &divide; Revenue) &times; 100
              </p>
              <p className="mt-2 max-w-2xl text-[12.5px] leading-5 text-ink-600">
                Cost of goods sold covers only the QuickBooks accounts flagged as direct cost. Operating expenses
                &mdash; rent, overhead salaries, marketing, software, professional fees &mdash; are never included.
              </p>
            </div>
            <div className="shrink-0">
              <Badge variant={approvalPending ? 'warning' : 'positive'}>
                {approvalPending ? 'Definition pending Finance approval' : 'Definition approved'}
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      {approvalPending ? (
        <Alert tone="warning" title="These figures are not yet certified" className="mb-5">
          The gross margin definition has not been formally approved by {marginDef.approver}. The arithmetic is
          correct and the cost mappings are applied as configured, but do not treat these figures as verified
          financial reporting until the definition is signed off on the{' '}
          <Link href="/settings/metrics" className="font-medium text-brand-700 underline">
            metric definitions
          </Link>{' '}
          screen.
        </Alert>
      ) : null}

      {/* --- Overall ------------------------------------------------------- */}
      <Card className="mb-5">
        <CardHeader>
          <div>
            <CardTitle>All divisions &mdash; {range.label}</CardTitle>
            <CardDescription>
              {overall.availability === 'available'
                ? `Based on an approved cost basis (${overall.costBasis ?? 'QuickBooks direct-cost accounts'}).`
                : 'A margin cannot be reported for this period.'}
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {overall.availability === 'available' ? (
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="Revenue" value={formatCurrency(overall.revenue)} help={getMetricDefinition('revenue')!.formula} />
              <Stat
                label="Cost of goods sold"
                value={formatCurrency(overall.cogs)}
                help={`${cogsDef.formula}\n\nExcludes: ${cogsDef.excludedRecords}`}
              />
              <Stat label="Gross profit" value={formatCurrency(overall.grossProfit)} help={grossProfitDef.formula} />
              <Stat
                label="Gross margin"
                value={formatPercent(overall.grossMarginPercent)}
                help={marginDef.formula}
                tone={
                  overall.grossMarginPercent !== null && overall.grossMarginPercent >= 30 ? 'positive' : 'default'
                }
              />
            </div>
          ) : (
            <Alert tone="warning" title="Gross margin is not available for this period">
              {overall.reason}
              {overall.missingCostMonths.length > 0 ? (
                <>
                  {' '}
                  Revenue for the period is {formatCurrency(overall.revenue)}, but no profit figure is shown because
                  a partial cost base would overstate margin.{' '}
                  <Link href="/settings/metrics" className="font-medium text-brand-700 underline">
                    Review cost approvals
                  </Link>
                  .
                </>
              ) : null}
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* --- Trend --------------------------------------------------------- */}
      <Card className="mb-5">
        <CardHeader>
          <div>
            <CardTitle>Gross margin over time</CardTitle>
            <CardDescription>
              Monthly margin percentage over the 12 months to {range.label}, so the trend is readable whatever
              period is selected above. A month with no approved cost figure is left as a gap, never drawn as zero.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <MarginTrendChart
            data={trend}
            footnote="A gap in the line means Finance has not yet approved the cost of goods sold for that month."
          />
        </CardContent>
      </Card>

      {/* --- By division ---------------------------------------------------- */}
      <Card>
        <CardHeader>
          <div>
            <CardTitle>By division</CardTitle>
            <CardDescription>
              Phase 1 reports margin by division only. Profit per project is out of scope.
            </CardDescription>
          </div>
        </CardHeader>
        {byDivision.length === 0 ? (
          <EmptyState
            title="No divisions to report on"
            description="No division has revenue in this period, or your account is restricted to a division with no activity."
          />
        ) : (
          <>
            <TableScroll>
              <Table>
                <THead>
                  <TR>
                    <TH>Division</TH>
                    <TH numeric>Revenue</TH>
                    <TH numeric>Cost of goods sold</TH>
                    <TH numeric>Gross profit</TH>
                    <TH numeric>Gross margin</TH>
                  </TR>
                </THead>
                <TBody>
                  {byDivision.map((division) => (
                    <TR key={division.divisionId} className="hover:bg-ink-50">
                      <TD>
                        <span className="flex items-center gap-2">
                          <span
                            className="size-2.5 shrink-0 rounded-sm"
                            style={{ backgroundColor: divisionColor(division.divisionCode) }}
                            aria-hidden
                          />
                          <span className="font-medium text-ink-900">{division.divisionName}</span>
                        </span>
                      </TD>
                      <TD numeric>{formatCurrency(division.revenue)}</TD>
                      <TD numeric>
                        {division.cogs === null ? (
                          <span className="text-[12.5px] italic text-ink-500">Not approved</span>
                        ) : (
                          formatCurrency(division.cogs)
                        )}
                      </TD>
                      <TD numeric>
                        {division.grossProfit === null || division.availability !== 'available' ? (
                          <span className="text-[12.5px] italic text-ink-500">Not available</span>
                        ) : (
                          formatCurrency(division.grossProfit)
                        )}
                      </TD>
                      <TD numeric className="font-semibold">
                        {division.availability === 'available' && division.grossMarginPercent !== null ? (
                          formatPercent(division.grossMarginPercent)
                        ) : (
                          <span className="text-[12.5px] font-normal italic text-ink-500">Not available</span>
                        )}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableScroll>

            {!anyDivisionAvailable ? (
              <div className="border-t border-ink-200 px-4 py-4 sm:px-5">
                <Alert tone="warning" title="No division has an approved cost figure for this period">
                  {byDivision[0]?.reason ??
                    'Finance must approve the cost of goods sold for every month in the period before a margin is reported.'}
                </Alert>
              </div>
            ) : (
              <div className="border-t border-ink-200 px-4 py-3 sm:px-5">
                <p className="text-[12px] leading-5 text-ink-500">
                  Rows showing &ldquo;Not available&rdquo; are periods where Finance has not approved the direct-cost
                  figure. The revenue column is still shown, because revenue does not depend on the cost approval.
                </p>
              </div>
            )}
          </>
        )}
      </Card>
    </>
  )
}
