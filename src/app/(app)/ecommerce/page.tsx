import type { Metadata } from 'next'
import Link from 'next/link'
import { MessageSquare, Package } from 'lucide-react'
import { PERMISSIONS } from '@/lib/auth/permissions'
import { getPageContext } from '@/lib/page-context'
import {
  bestSellers,
  ecommerceSummary,
  ecommerceTrend,
  hasOrderLines,
  ordersByFinancialStatus,
  ordersByFulfillmentStatus,
  recentOrders,
  billableOrders,
} from '@/lib/analytics/ecommerce'
import { percentChange } from '@/lib/analytics/revenue'
import { getMetricDefinition } from '@/lib/metrics/definitions'
import { formatCurrency, formatDateTime, formatInteger, humanizeEnum } from '@/lib/format'
import { formatRelativeTime } from '@/lib/dates'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Alert, EmptyState, StaleDataNotice } from '@/components/ui/feedback'
import { DataModeBanner, MetaFact, PageHeader } from '@/components/layout/page-header'
import { FilterBar } from '@/components/layout/filters'
import { Stat } from '@/components/metrics/kpi-card'
import { CountTrendChart, TrendChart } from '@/components/charts/trend-chart'
import { BreakdownBars } from '@/components/charts/breakdown-bars'
import { TBody, TD, TH, THead, TR, Table, TableScroll } from '@/components/ui/table'

export const metadata: Metadata = { title: 'E-commerce' }

/**
 * Eco LED Mart e-commerce analytics (section 9).
 *
 * The most important thing this page does is keep two different things apart:
 * Shopify's operational sales and QuickBooks accounting revenue. They are
 * never added together and the page says so explicitly, because the two will
 * not match for the same period and a reader who assumes they should will
 * draw the wrong conclusion.
 *
 * The system never creates, updates or cancels a Shopify order.
 */
export default async function EcommercePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const context = await getPageContext(PERMISSIONS.ECOMMERCE_VIEW, '/ecommerce', params, {
    defaultRange: 'last_30_days',
  })
  const { dataset, range, now } = context

  const summary = ecommerceSummary(dataset.orders, range)
  const previous = ecommerceSummary(dataset.orders, range.comparison)
  const trend = ecommerceTrend(dataset.orders, range, range.granularity, range.comparison)
  const byFinancial = ordersByFinancialStatus(dataset.orders, range)
  const byFulfillment = ordersByFulfillmentStatus(dataset.orders, range)
  const topProducts = bestSellers(dataset.orders, range, 10)
  const latest = recentOrders(billableOrders(dataset.orders, range), 10)
  const linesAvailable = hasOrderLines(dataset.orders)

  const salesDefinition = getMetricDefinition('shopify_sales')!
  const aovDefinition = getMetricDefinition('average_order_value')!

  const salesChange = percentChange(summary.netSales, previous.netSales > 0 ? previous.netSales : null)
  const shopifyIntegration = dataset.integrations.find((i) => i.provider === 'SHOPIFY')

  return (
    <>
      <DataModeBanner mode={dataset.mode} />

      <PageHeader
        title="E-commerce — Eco LED Mart"
        description="How the Shopify store is performing: net sales, orders, order status and best sellers."
        meta={
          <>
            <MetaFact label="Period" value={range.label} />
            <MetaFact label="Compared with" value={range.comparisonLabel} />
            <MetaFact
              label="Shopify last synced"
              value={formatRelativeTime(shopifyIntegration?.lastSuccessAt ?? null, now)}
              tone={shopifyIntegration?.isStale ? 'warning' : 'default'}
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
            <Link href="/ask?q=How%20is%20Eco%20LED%20Mart%20performing%3F">
              <MessageSquare aria-hidden />
              Ask a question
            </Link>
          </Button>
        }
      />

      <FilterBar divisions={[]} showDivision={false} showSalesRep={false} />

      <Alert tone="info" title="These are store sales, not accounting revenue" className="mb-5">
        Net sales here is the Shopify order subtotal after discounts, less refunds. It <strong>excludes</strong> sales
        tax and shipping. It will not equal the QuickBooks revenue for the same period, because of timing differences
        and because not every order has been invoiced. The two figures are reported separately and are never added
        together.
      </Alert>

      {shopifyIntegration?.isStale ? (
        <StaleDataNotice
          sources={[
            {
              name: shopifyIntegration.displayName,
              lastSuccessLabel: formatRelativeTime(shopifyIntegration.lastSuccessAt, now),
            },
          ]}
          className="mb-5"
        />
      ) : null}

      {/* --- Headline figures ---------------------------------------------- */}
      <Card className="mb-5">
        <CardContent className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="Net sales"
            value={summary.orderCount === 0 ? 'Not available' : formatCurrency(summary.netSales)}
            help={`${salesDefinition.formula}\n\nExcludes: ${salesDefinition.excludedRecords}`}
            note={
              summary.orderCount === 0
                ? 'No orders in this period'
                : salesChange !== null
                  ? `${salesChange >= 0 ? '+' : '−'}${Math.abs(salesChange).toFixed(1)}% vs. ${range.comparisonLabel.toLowerCase()}`
                  : 'No comparable figure for the previous period'
            }
            tone={summary.orderCount === 0 ? 'muted' : 'default'}
          />
          <Stat
            label="Orders"
            value={formatInteger(summary.orderCount)}
            help="Count of orders placed in the period that were not cancelled."
            note={
              summary.cancelledOrderCount > 0
                ? `${formatInteger(summary.cancelledOrderCount)} cancelled orders excluded`
                : 'No cancelled orders in this period'
            }
          />
          <Stat
            label="Average order value"
            value={summary.averageOrderValue === null ? 'Not available' : formatCurrency(summary.averageOrderValue, { decimals: true })}
            help={`${aovDefinition.formula}\n\n${aovDefinition.excludedRecords}`}
            note={summary.averageOrderValue === null ? 'An average of no orders is not zero' : undefined}
            tone={summary.averageOrderValue === null ? 'muted' : 'default'}
          />
          <Stat
            label="Refunds"
            value={formatCurrency(summary.totalRefunds)}
            help="Refunds issued against orders placed in this period. Already deducted from net sales above."
            note={
              summary.refundedOrderCount > 0
                ? `${formatInteger(summary.refundedOrderCount)} orders refunded in part or full`
                : 'No refunds in this period'
            }
            tone={summary.totalRefunds > 0 ? 'warning' : 'positive'}
          />
        </CardContent>
      </Card>

      {/* --- What the figure includes -------------------------------------- */}
      <Card className="mb-5">
        <CardHeader>
          <div>
            <CardTitle>What is included in net sales</CardTitle>
            <CardDescription>
              Every adjustment, shown explicitly, so the basis of the headline figure is never in doubt.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <TableScroll>
            <Table>
              <THead>
                <TR>
                  <TH>Component</TH>
                  <TH numeric>Amount</TH>
                  <TH>Included in net sales?</TH>
                </TR>
              </THead>
              <TBody>
                <TR>
                  <TD>Order subtotal, before discounts</TD>
                  <TD numeric>{formatCurrency(summary.grossSubtotal, { decimals: true })}</TD>
                  <TD>
                    <Badge variant="positive" size="sm">
                      Yes
                    </Badge>
                  </TD>
                </TR>
                <TR>
                  <TD>Discounts</TD>
                  <TD numeric>{formatCurrency(-summary.totalDiscounts, { decimals: true })}</TD>
                  <TD>
                    <Badge variant="positive" size="sm">
                      Yes, deducted
                    </Badge>
                  </TD>
                </TR>
                <TR>
                  <TD>Refunds</TD>
                  <TD numeric>{formatCurrency(-summary.totalRefunds, { decimals: true })}</TD>
                  <TD>
                    <Badge variant="positive" size="sm">
                      Yes, deducted
                    </Badge>
                  </TD>
                </TR>
                <TR>
                  <TD>Sales tax</TD>
                  <TD numeric>{formatCurrency(summary.totalTax, { decimals: true })}</TD>
                  <TD>
                    <Badge variant="neutral" size="sm">
                      No, excluded
                    </Badge>
                  </TD>
                </TR>
                <TR>
                  <TD>Shipping charged</TD>
                  <TD numeric>{formatCurrency(summary.totalShipping, { decimals: true })}</TD>
                  <TD>
                    <Badge variant="neutral" size="sm">
                      No, excluded
                    </Badge>
                  </TD>
                </TR>
                <TR className="bg-ink-50">
                  <TD className="font-semibold text-ink-900">Net sales</TD>
                  <TD numeric className="font-semibold text-ink-900">
                    {formatCurrency(summary.netSales, { decimals: true })}
                  </TD>
                  <TD />
                </TR>
              </TBody>
            </Table>
          </TableScroll>
        </CardContent>
      </Card>

      {/* --- Trends -------------------------------------------------------- */}
      <div className="mb-5 grid gap-4">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Net sales over time</CardTitle>
              <CardDescription>
                {range.label}, compared with {range.comparisonLabel.toLowerCase()}.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            <TrendChart
              data={trend}
              currentLabel={range.label}
              comparisonLabel={range.comparisonLabel}
              height={280}
              footnote="Source: Shopify Admin API, by order placed date in the company timezone."
            />

            {/*
              Order count is a count, not a currency, so it gets its own chart
              with its own axis. Putting both on one plot with two y-scales
              would imply a relationship the alignment of the scales invented.
            */}
            <div className="border-t border-ink-200 pt-5">
              <p className="mb-2.5 text-[13px] font-medium text-ink-800">Orders over the same period</p>
              <CountTrendChart data={trend} dataKey="orders" seriesLabel="Orders" height={160} />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* --- Status breakdowns --------------------------------------------- */}
      <div className="mb-5 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Orders by payment status</CardTitle>
              <CardDescription>Counts of orders, with the net sales they represent.</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <BreakdownBars
              rows={byFinancial}
              valueFormat="integer"
              emptyTitle="No orders in this period"
              emptyDescription="No Shopify orders were placed in the selected date range."
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Orders by fulfilment status</CardTitle>
              <CardDescription>What has shipped and what is still waiting.</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <BreakdownBars
              rows={byFulfillment}
              valueFormat="integer"
              emptyTitle="No orders in this period"
              emptyDescription="No Shopify orders were placed in the selected date range."
            />
          </CardContent>
        </Card>
      </div>

      {/* --- Best sellers -------------------------------------------------- */}
      <Card className="mb-5">
        <CardHeader>
          <div>
            <CardTitle>Best-selling products</CardTitle>
            <CardDescription>By net sales in this period. Requires order line detail from Shopify.</CardDescription>
          </div>
        </CardHeader>
        {!linesAvailable ? (
          <EmptyState
            icon={Package}
            title="Product detail is not available"
            description="Order line items have not been imported, so best sellers cannot be calculated. Run a full Shopify sync to import line detail."
            action={{ label: 'Go to Data Health', href: '/data-health' }}
          />
        ) : topProducts.length === 0 ? (
          <EmptyState
            icon={Package}
            title="No products sold in this period"
            description="No order lines fall inside the selected date range."
          />
        ) : (
          <TableScroll>
            <Table>
              <THead>
                <TR>
                  <TH>Product</TH>
                  <TH>SKU</TH>
                  <TH numeric>Units sold</TH>
                  <TH numeric>Net sales</TH>
                </TR>
              </THead>
              <TBody>
                {topProducts.map((product) => (
                  <TR key={product.key} className="hover:bg-ink-50">
                    <TD className="max-w-[22rem] truncate" title={product.title}>
                      {product.title}
                    </TD>
                    <TD className="whitespace-nowrap font-mono text-[12px] text-ink-600">{product.sku ?? '—'}</TD>
                    <TD numeric>{formatInteger(product.unitsSold)}</TD>
                    <TD numeric className="font-semibold">
                      {formatCurrency(product.netSales)}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableScroll>
        )}
      </Card>

      {/* --- Recent orders -------------------------------------------------- */}
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Recent orders</CardTitle>
            <CardDescription>The ten most recent orders in this period. Read-only.</CardDescription>
          </div>
        </CardHeader>
        {latest.length === 0 ? (
          <EmptyState
            title="No orders in this period"
            description="No Shopify orders were placed in the selected date range. Widen the range, or check that Shopify has finished syncing."
            action={{ label: 'View sync history', href: '/data-health' }}
          />
        ) : (
          <TableScroll>
            <Table>
              <THead>
                <TR>
                  <TH>Order</TH>
                  <TH>Placed</TH>
                  <TH>Customer</TH>
                  <TH>Payment</TH>
                  <TH>Fulfilment</TH>
                  <TH numeric>Net sales</TH>
                  <TH numeric>Order total</TH>
                </TR>
              </THead>
              <TBody>
                {latest.map((order) => (
                  <TR key={order.id} className="hover:bg-ink-50">
                    <TD className="whitespace-nowrap font-medium text-ink-900">{order.orderNumber}</TD>
                    <TD className="whitespace-nowrap text-ink-700">{formatDateTime(order.placedAt)}</TD>
                    <TD className="max-w-[12rem] truncate">
                      {order.customerName ?? <span className="italic text-ink-500">Guest</span>}
                    </TD>
                    <TD>
                      <Badge
                        variant={
                          order.financialStatus === 'PAID'
                            ? 'positive'
                            : order.financialStatus === 'REFUNDED' || order.financialStatus === 'PARTIALLY_REFUNDED'
                              ? 'warning'
                              : 'neutral'
                        }
                        size="sm"
                      >
                        {humanizeEnum(order.financialStatus)}
                      </Badge>
                    </TD>
                    <TD>
                      <Badge variant={order.fulfillmentStatus === 'FULFILLED' ? 'positive' : 'neutral'} size="sm">
                        {humanizeEnum(order.fulfillmentStatus)}
                      </Badge>
                    </TD>
                    <TD numeric className="font-semibold">
                      {formatCurrency(order.netSalesAmount, { decimals: true })}
                    </TD>
                    <TD numeric className="text-ink-600">
                      {formatCurrency(order.totalPrice, { decimals: true })}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableScroll>
        )}
      </Card>
    </>
  )
}
