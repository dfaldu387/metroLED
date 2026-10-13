import { AlertTriangle, CheckCircle2, Clock, Mail, XCircle } from 'lucide-react'
import type { DailyBriefPageData } from '@shared/api/operations'
import { formatRelativeTime } from '@shared/dates'
import { formatCurrency, formatDateTime, formatInteger } from '@shared/format'
import { divisionColor } from '@shared/palette'
import { Link, useDocumentTitle } from '@/lib/navigation'
import { usePageData } from '@/lib/query'
import { PageQuery } from '@/components/layout/page-error'
import { DocumentSkeleton } from '@/components/layout/page-skeleton'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge, StatusDot } from '@/components/ui/badge'
import { Alert, EmptyState } from '@/components/ui/feedback'
import { DataModeBanner, MetaFact, PageHeader, SectionHeading } from '@/components/layout/page-header'
import { Stat } from '@/components/metrics/kpi-card'
import { TBody, TD, TH, THead, TR, Table, TableScroll } from '@/components/ui/table'
import { BriefActions } from './brief-actions'

/**
 * Daily executive brief (section 12).
 *
 * The page renders the stored brief payload when one exists, so what is shown
 * here is byte-for-byte the same set of figures that went out by email. If no
 * brief has been generated yet it previews what today's brief would contain,
 * clearly labelled as a preview.
 */
export default function DailyBriefPage() {
  useDocumentTitle('Daily Brief')
  const query = usePageData<DailyBriefPageData>('daily-brief')
  return (
    <PageQuery query={query} skeleton={<DocumentSkeleton />}>
      {(data) => <DailyBrief data={data} />}
    </PageQuery>
  )
}

function DailyBrief({ data }: { data: DailyBriefPageData }) {
  const now = new Date(data.now)
  const { payload, isPreview, canManage, briefDateLabel } = data
  const settings = data.schedule
  const scope = {
    canSeeReceivables: data.canSeeReceivables,
    canSeePipeline: data.canSeePipeline,
    canSeeEcommerce: data.canSeeEcommerce,
  }
  const stored = data.generatedAt ? { generatedAt: new Date(data.generatedAt) } : null

  const deliveries = data.email?.deliveries ?? []
  const sentCount = deliveries.filter((d) => d.status === 'SENT' || d.status === 'DELIVERED').length
  const failedCount = deliveries.filter((d) => d.status === 'FAILED' || d.status === 'BOUNCED').length

  return (
    <>
      <DataModeBanner mode={payload.dataMode} />

      <PageHeader
        title="Daily Brief"
        description={`Yesterday in one page: revenue and cash, newly overdue invoices, stale quotes, Shopify highlights and sync health.`}
        meta={
          <>
            <MetaFact label="Reporting on" value={briefDateLabel} />
            <MetaFact
              label="Generated"
              value={
                stored?.generatedAt
                  ? `${formatDateTime(stored.generatedAt, payload.timezone)} (${formatRelativeTime(stored.generatedAt, now)})`
                  : 'Live preview, not yet generated'
              }
            />
            {isPreview ? (
              <Badge variant="neutral" size="sm">
                Preview
              </Badge>
            ) : null}
            {payload.dataMode === 'demo' ? (
              <Badge variant="demo" size="sm">
                Demo data
              </Badge>
            ) : null}
          </>
        }
        primaryAction={canManage ? <BriefActions briefDate={payload.briefDate} /> : undefined}
        secondaryActions={
          canManage ? (
            <Button asChild variant="secondary" size="md">
              <Link href="/settings/brief">
                <Mail aria-hidden />
                Manage recipients
              </Link>
            </Button>
          ) : undefined
        }
      />

      {isPreview ? (
        <Alert tone="info" title="This is a live preview, not the sent brief" className="mb-5">
          No brief has been generated and stored for {data.expectedDateLabel} yet.
          The figures below are calculated now from current data.{' '}
          {settings.briefEnabled
            ? `The scheduled brief runs at ${String(settings.briefSendHour).padStart(2, '0')}:${String(settings.briefSendMinute).padStart(2, '0')} ${settings.timezone}.`
            : 'Automatic sending is currently turned off in Settings.'}
        </Alert>
      ) : null}

      {payload.warnings.length > 0 ? (
        <Alert tone="warning" title="Please read before acting on these figures" className="mb-5">
          <ul className="list-disc space-y-1 pl-4">
            {payload.warnings.map((warning, index) => (
              <li key={index}>{warning}</li>
            ))}
          </ul>
        </Alert>
      ) : null}

      {/* --- 1. Revenue and cash -------------------------------------------- */}
      <Card className="mb-5">
        <CardHeader>
          <div>
            <CardTitle>Yesterday: revenue and cash by division</CardTitle>
            <CardDescription>
              Invoiced sales excluding tax, by invoice date, and cash received on {briefDateLabel}.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-5 sm:grid-cols-3">
            <Stat
              label="Revenue invoiced"
              value={formatCurrency(payload.revenue.total)}
              note={
                payload.revenue.previousBusinessDayTotal !== null
                  ? `Previous business day: ${formatCurrency(payload.revenue.previousBusinessDayTotal)}`
                  : 'No comparable previous business day'
              }
            />
            <Stat
              label="Invoices issued"
              value={formatInteger(payload.revenue.invoiceCount)}
              note={payload.revenue.invoiceCount === 0 ? 'No invoices were issued' : undefined}
            />
            <Stat
              label="Cash collected"
              value={formatCurrency(payload.cash.collected)}
              tone="positive"
              note={`${formatInteger(payload.cash.paymentCount)} ${payload.cash.paymentCount === 1 ? 'payment' : 'payments'} received`}
            />
          </div>

          {payload.revenue.byDivision.length > 0 ? (
            <TableScroll className="rounded-lg border border-ink-200">
              <Table>
                <THead>
                  <TR>
                    <TH>Division</TH>
                    <TH numeric>Invoices</TH>
                    <TH numeric>Revenue</TH>
                  </TR>
                </THead>
                <TBody>
                  {payload.revenue.byDivision.map((division) => (
                    <TR key={division.divisionId}>
                      <TD>
                        <span className="flex items-center gap-2">
                          <span
                            className="size-2.5 shrink-0 rounded-sm"
                            style={{ backgroundColor: divisionColor(division.code) }}
                            aria-hidden
                          />
                          {division.name}
                        </span>
                      </TD>
                      <TD numeric>{formatInteger(division.invoiceCount)}</TD>
                      <TD numeric className="font-semibold">
                        {formatCurrency(division.revenue)}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableScroll>
          ) : (
            <p className="rounded-lg bg-ink-50 px-3.5 py-3 text-[13px] text-ink-600">
              No invoices were issued on {briefDateLabel}.
            </p>
          )}
        </CardContent>
      </Card>

      {/* --- 2. Newly overdue ----------------------------------------------- */}
      <Card className="mb-5">
        <CardHeader>
          <div>
            <CardTitle>Newly overdue invoices</CardTitle>
            <CardDescription>Invoices that passed their due date on {briefDateLabel}.</CardDescription>
          </div>
          {scope.canSeeReceivables ? (
            <Button asChild variant="ghost" size="sm">
              <Link href="/accounts-receivable?filter=overdue">Review overdue invoices</Link>
            </Button>
          ) : null}
        </CardHeader>
        {payload.receivables.newlyOverdue.length === 0 ? (
          <CardContent>
            <p className="text-[13px] text-ink-600">
              Nothing became overdue on this date. Total overdue stands at{' '}
              <strong className="text-ink-900">{formatCurrency(payload.receivables.overdueAmount)}</strong> across{' '}
              {formatInteger(payload.receivables.overdueCount)} invoices.
            </p>
          </CardContent>
        ) : (
          <>
            <div className="border-b border-ink-200 px-4 py-3 sm:px-5">
              <p className="text-[13px] text-ink-700">
                <strong className="text-negative-700">{formatCurrency(payload.receivables.newlyOverdueTotal)}</strong>{' '}
                became overdue. Total overdue is now {formatCurrency(payload.receivables.overdueAmount)} across{' '}
                {formatInteger(payload.receivables.overdueCount)} invoices.
              </p>
            </div>
            <TableScroll>
              <Table>
                <THead>
                  <TR>
                    <TH>Customer</TH>
                    <TH>Invoice</TH>
                    <TH>Division</TH>
                    <TH numeric>Days overdue</TH>
                    <TH numeric>Balance</TH>
                  </TR>
                </THead>
                <TBody>
                  {payload.receivables.newlyOverdue.map((invoice) => (
                    <TR key={invoice.invoiceId} className="hover:bg-ink-50">
                      <TD className="max-w-[16rem] truncate">{invoice.customerName}</TD>
                      <TD className="font-medium text-ink-900">{invoice.docNumber}</TD>
                      <TD>{invoice.divisionName ?? <span className="italic text-ink-500">Unassigned</span>}</TD>
                      <TD numeric>{invoice.daysOverdue}</TD>
                      <TD numeric className="font-semibold text-negative-700">
                        {formatCurrency(invoice.balance, { decimals: true })}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableScroll>
          </>
        )}
      </Card>

      {/* --- 3. Stale quotes ------------------------------------------------ */}
      <Card className="mb-5">
        <CardHeader>
          <div>
            <CardTitle>Large quotes becoming stale</CardTitle>
            <CardDescription>
              Open quotes with no activity for {payload.pipeline.staleThresholdDays}+ days.
            </CardDescription>
          </div>
          {scope.canSeePipeline ? (
            <Button asChild variant="ghost" size="sm">
              <Link href="/sales-pipeline?filter=stale">Review stale quotes</Link>
            </Button>
          ) : null}
        </CardHeader>
        {payload.pipeline.newlyStale.length === 0 ? (
          <CardContent>
            <p className="text-[13px] text-ink-600">
              No large quote has gone quiet. Open pipeline is{' '}
              <strong className="text-ink-900">{formatCurrency(payload.pipeline.openValue)}</strong> across{' '}
              {formatInteger(payload.pipeline.openCount)} quotes.
            </p>
          </CardContent>
        ) : (
          <>
            <div className="border-b border-ink-200 px-4 py-3 sm:px-5">
              <p className="text-[13px] text-ink-700">
                <strong className="text-warning-800">{formatCurrency(payload.pipeline.newlyStaleTotal)}</strong> of
                pipeline has gone quiet. Open pipeline is {formatCurrency(payload.pipeline.openValue)} in total
                (unweighted).
              </p>
            </div>
            <TableScroll>
              <Table>
                <THead>
                  <TR>
                    <TH>Customer</TH>
                    <TH>Quote</TH>
                    <TH>Owner</TH>
                    <TH numeric>Days idle</TH>
                    <TH numeric>Value</TH>
                  </TR>
                </THead>
                <TBody>
                  {payload.pipeline.newlyStale.map((quote) => (
                    <TR key={quote.quoteId} className="hover:bg-ink-50">
                      <TD className="max-w-[16rem] truncate">{quote.customerName}</TD>
                      <TD className="font-medium text-ink-900">{quote.docNumber}</TD>
                      <TD>{quote.ownerName ?? <span className="italic text-ink-500">Not recorded</span>}</TD>
                      <TD numeric className="font-medium text-warning-800">
                        {quote.daysIdle}
                      </TD>
                      <TD numeric className="font-semibold">
                        {formatCurrency(quote.amount)}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableScroll>
          </>
        )}
      </Card>

      {/* --- 4. Shopify ------------------------------------------------------ */}
      <Card className="mb-5">
        <CardHeader>
          <div>
            <CardTitle>Eco LED Mart highlights</CardTitle>
            <CardDescription>
              Shopify store sales after discounts and refunds, excluding tax and shipping.
            </CardDescription>
          </div>
          {scope.canSeeEcommerce ? (
            <Button asChild variant="ghost" size="sm">
              <Link href="/ecommerce">View e-commerce</Link>
            </Button>
          ) : null}
        </CardHeader>
        <CardContent>
          {payload.ecommerce.available ? (
            <div className="grid gap-5 sm:grid-cols-3">
              <Stat label="Net sales" value={formatCurrency(payload.ecommerce.netSales)} />
              <Stat label="Orders" value={formatInteger(payload.ecommerce.orderCount)} />
              <Stat
                label="Average order value"
                value={
                  payload.ecommerce.averageOrderValue === null
                    ? 'Not available'
                    : formatCurrency(payload.ecommerce.averageOrderValue, { decimals: true })
                }
                tone={payload.ecommerce.averageOrderValue === null ? 'muted' : 'default'}
                note={payload.ecommerce.averageOrderValue === null ? 'No orders on this date' : undefined}
              />
            </div>
          ) : (
            <p className="text-[13px] text-ink-600">
              Shopify is not connected, so Eco LED Mart figures are unavailable.
            </p>
          )}
        </CardContent>
      </Card>

      {/* --- 5. Sync health --------------------------------------------------- */}
      <Card className="mb-5">
        <CardHeader>
          <div>
            <CardTitle>Synchronisation health</CardTitle>
            <CardDescription>Whether the figures above can be trusted.</CardDescription>
          </div>
          <Button asChild variant="ghost" size="sm">
            <Link href="/data-health">View data health</Link>
          </Button>
        </CardHeader>
        <CardContent>
          <p
            className={`mb-3 flex items-start gap-2 text-[13px] font-medium ${
              payload.sync.healthy ? 'text-positive-700' : 'text-warning-800'
            }`}
          >
            {payload.sync.healthy ? (
              <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />
            ) : (
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            )}
            {payload.sync.summary}
          </p>

          {payload.sync.sources.length > 0 ? (
            <ul className="divide-y divide-ink-200 rounded-lg border border-ink-200">
              {payload.sync.sources.map((source) => (
                <li key={source.provider} className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                  <span className="flex min-w-0 items-center gap-2.5">
                    <StatusDot
                      tone={source.status === 'ERROR' ? 'negative' : source.isStale ? 'warning' : 'positive'}
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-medium text-ink-900">
                        {source.displayName}
                      </span>
                      {source.errorMessage ? (
                        <span className="block truncate text-[11.5px] text-negative-700">
                          {source.errorMessage}
                        </span>
                      ) : null}
                    </span>
                  </span>
                  <span className="shrink-0 text-[12px] text-ink-600">
                    Last success: <span className="font-medium text-ink-800">{source.lastSuccessLabel}</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-ink-600">No data sources are connected.</p>
          )}
        </CardContent>
      </Card>

      {/* --- Delivery record -------------------------------------------------- */}
      {canManage ? (
        <section aria-label="Email delivery">
          <SectionHeading
            title="Email delivery"
            description={`Sent through ${data.email?.providerLabel ?? ''}.`}
          />
          <Card>
            {!data.email?.configured ? (
              <CardContent>
                <Alert tone="warning" title="Email is not configured for sending">
                  <code className="font-mono text-[12px]">EMAIL_PROVIDER</code> is set to a provider whose
                  credentials are missing, so briefs cannot be delivered. Configure it before the acceptance run of
                  five consecutive business days.
                </Alert>
              </CardContent>
            ) : deliveries.length === 0 ? (
              <EmptyState
                icon={Mail}
                title="This brief has not been sent"
                description={
                  isPreview
                    ? 'No brief has been generated for this date yet, so there is nothing to deliver.'
                    : 'The brief was generated but no delivery has been attempted. Check that recipients are configured.'
                }
                action={{ label: 'Manage recipients', href: '/settings/brief' }}
              />
            ) : (
              <>
                <div className="border-b border-ink-200 px-4 py-3 sm:px-5">
                  <p className="text-[13px] text-ink-700">
                    {formatInteger(sentCount)} delivered
                    {failedCount > 0 ? (
                      <>
                        ,{' '}
                        <strong className="text-negative-700">{formatInteger(failedCount)} failed</strong>
                      </>
                    ) : null}
                    {' of '}
                    {formatInteger(deliveries.length)} recipients.
                  </p>
                </div>
                <TableScroll>
                  <Table>
                    <THead>
                      <TR>
                        <TH>Recipient</TH>
                        <TH>Status</TH>
                        <TH>Sent</TH>
                        <TH numeric>Attempts</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {deliveries.map((delivery) => (
                        <TR key={delivery.recipient}>
                          <TD className="font-medium text-ink-900">{delivery.recipient}</TD>
                          <TD>
                            <Badge
                              variant={
                                delivery.status === 'SENT' || delivery.status === 'DELIVERED'
                                  ? 'positive'
                                  : delivery.status === 'QUEUED'
                                    ? 'neutral'
                                    : 'negative'
                              }
                              size="sm"
                            >
                              {delivery.status === 'SENT' || delivery.status === 'DELIVERED' ? (
                                <CheckCircle2 className="size-3" aria-hidden />
                              ) : delivery.status === 'QUEUED' ? (
                                <Clock className="size-3" aria-hidden />
                              ) : (
                                <XCircle className="size-3" aria-hidden />
                              )}
                              {delivery.status}
                            </Badge>
                            {delivery.errorMessage ? (
                              <span className="mt-0.5 block text-[11.5px] text-negative-700">
                                {delivery.errorMessage}
                              </span>
                            ) : null}
                          </TD>
                          <TD className="whitespace-nowrap text-ink-700">
                            {delivery.sentAt ? formatDateTime(delivery.sentAt, payload.timezone) : '—'}
                          </TD>
                          <TD numeric>{delivery.attempts}</TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                </TableScroll>
              </>
            )}
          </Card>
        </section>
      ) : null}
    </>
  )
}
