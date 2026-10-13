import { MessageSquare } from 'lucide-react'
import { Link, useDocumentTitle } from '@/lib/navigation'
import { usePageData } from '@/lib/query'
import { PageQuery } from '@/components/layout/page-error'
import { AnalyticsSkeleton } from '@/components/layout/page-skeleton'
import { getMetricDefinition } from '@shared/metric-definitions'
import { formatCurrency, formatInteger, formatPercent } from '@shared/format'
import type { SalesPipelinePageData } from '@shared/api/analytics'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Alert, StaleDataNotice } from '@/components/ui/feedback'
import { DataModeBanner, MetaFact, PageHeader } from '@/components/layout/page-header'
import { FilterBar } from '@/components/layout/filters'
import { Stat } from '@/components/metrics/kpi-card'
import { BreakdownBars } from '@/components/charts/breakdown-bars'
import { QuoteTable } from './quote-table'

/**
 * Sales pipeline (section 8).
 *
 * Note what is deliberately absent: there is no probability-weighted pipeline
 * figure anywhere on this page. Method CRM supplies no probability per stage
 * and no weighting formula has been approved, so inventing one would make the
 * pipeline look more certain than the data supports.
 *
 * Phase 1 also excludes automated customer follow-ups: this page helps a human
 * decide who to call, and does not contact anyone.
 */
export default function SalesPipelinePage() {
  useDocumentTitle('Sales Pipeline')
  const query = usePageData<SalesPipelinePageData>('sales-pipeline')
  return (
    <PageQuery query={query} skeleton={<AnalyticsSkeleton />}>
      {(data) => <SalesPipeline data={data} />}
    </PageQuery>
  )
}

function SalesPipeline({ data }: { data: SalesPipelinePageData }) {
  const { range, summary, wins, staleQuoteDays } = data
  const pipelineDefinition = getMetricDefinition('pipeline_value')!
  const agingDefinition = getMetricDefinition('quote_aging')!
  const winRateDefinition = getMetricDefinition('win_rate')!

  return (
    <>
      <DataModeBanner mode={data.mode} />

      <PageHeader
        title="Sales Pipeline"
        description="Open quotes by value and stage, and which ones have gone quiet."
        meta={
          <>
            <MetaFact label="Pipeline as at" value="now" />
            <MetaFact label="Win rate period" value={range.label} />
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
            <Link href="/ask?q=Which%20large%20quotes%20have%20gone%20cold%3F">
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
            label="Open pipeline value"
            value={formatCurrency(summary.openValue)}
            help={`${pipelineDefinition.formula}\n\n${pipelineDefinition.notes ?? ''}`}
            note={`${formatInteger(summary.openCount)} open ${summary.openCount === 1 ? 'quote' : 'quotes'}, unweighted`}
          />
          <Stat
            label="Average quote value"
            value={summary.averageQuoteValue === null ? 'Not available' : formatCurrency(summary.averageQuoteValue)}
            help="Open pipeline value divided by the number of open quotes."
            note={summary.averageQuoteValue === null ? 'No open quotes' : undefined}
            tone={summary.averageQuoteValue === null ? 'muted' : 'default'}
          />
          <Stat
            label={`Stale (${staleQuoteDays}+ days idle)`}
            value={formatCurrency(summary.staleValue)}
            help={`${agingDefinition.formula}\n\nThe threshold is set in Settings and is currently ${staleQuoteDays} days.`}
            note={
              summary.staleCount > 0
                ? `${formatInteger(summary.staleCount)} quotes, ${formatInteger(summary.largeStaleCount)} of them large`
                : 'Every open quote has recent activity'
            }
            tone={summary.staleValue > 0 ? 'warning' : 'positive'}
          />
          <Stat
            label="Win rate"
            value={wins.winRatePercent === null ? 'Not available' : formatPercent(wins.winRatePercent)}
            help={`${winRateDefinition.formula}\n\n${winRateDefinition.excludedRecords}`}
            note={
              wins.winRatePercent === null
                ? 'No quote was won or lost in this period'
                : `${formatInteger(wins.wonCount)} won, ${formatInteger(wins.lostCount)} lost in ${range.label.toLowerCase()}`
            }
            tone={wins.winRatePercent === null ? 'muted' : 'default'}
          />
        </CardContent>
      </Card>

      <Alert tone="info" title="Pipeline figures are unweighted totals" className="mb-5">
        The open pipeline above is the full value of every open quote. It is not adjusted by a probability of
        closing, because Method CRM does not record one and no weighting formula has been approved. Treat it as the
        maximum, not the forecast.
      </Alert>

      {/* --- Breakdowns ---------------------------------------------------- */}
      <div className="mb-5 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Open quotes by stage</CardTitle>
              <CardDescription>Stage labels come straight from Method CRM and are not renamed here.</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <BreakdownBars
              rows={data.byStage}
              secondaryFormat="integer"
              emptyTitle="No open quotes"
              emptyDescription="There are no open quotes for the filters you have applied."
              footnote="Source: Method CRM. Won, lost, expired and cancelled quotes are excluded."
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Quote aging</CardTitle>
              <CardDescription>
                Open pipeline grouped by days since the last recorded activity on the quote.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <BreakdownBars
              rows={data.aging}
              secondaryFormat="integer"
              emptyTitle="No open quotes to age"
              emptyDescription="There are no open quotes for the filters you have applied."
              footnote={`A quote with no recorded activity is aged from its quote date. The stale threshold is ${staleQuoteDays} days.`}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Open quotes by representative</CardTitle>
              <CardDescription>
                {data.canSeeAllReps ? 'All representatives.' : 'Your own quotes only.'}
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <BreakdownBars
              rows={data.byRep}
              secondaryFormat="integer"
              emptyTitle="No open quotes"
              emptyDescription="No open quote has a sales representative recorded."
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Open quotes by division</CardTitle>
              <CardDescription>Where the pipeline sits across the business.</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <BreakdownBars
              rows={data.byDivision}
              colorMode="division"
              secondaryFormat="integer"
              emptyTitle="No open quotes"
              emptyDescription="No open quote carries a division."
            />
          </CardContent>
        </Card>
      </div>

      {/* --- Quote table --------------------------------------------------- */}
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Open quotes</CardTitle>
            <CardDescription>
              Search and sort every open quote. Stale quotes are flagged so they are easy to find.
            </CardDescription>
          </div>
        </CardHeader>
        <QuoteTable
          staleThresholdDays={staleQuoteDays}
          largeQuoteAmount={data.largeQuoteAmount}
          initialFilter={data.initialFilter}
          quotes={data.quotes}
        />
      </Card>
    </>
  )
}
