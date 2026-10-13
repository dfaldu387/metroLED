'use client'

import * as React from 'react'
import { CheckCircle2, ChevronDown, ShieldCheck, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatCurrency, formatDate, formatPercent } from '@/lib/format'
import { divisionColor } from '@/lib/charts/palette'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Alert, EmptyState } from '@/components/ui/feedback'
import { ConfirmDialog } from '@/components/ui/dialog'
import { Switch, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/misc'
import { TBody, TD, TH, THead, TR, Table, TableScroll } from '@/components/ui/table'
import { approveMetricDefinition, setCogsAccountIncluded, type SettingsResult } from '../actions'

interface DefinitionRow {
  key: string
  name: string
  shortDescription: string
  formula: string
  sourceSystems: string[]
  dateBasis: string
  includedRecords: string
  excludedRecords: string
  currencyHandling: string
  divisionMapping: string
  notes: string | null
  approver: string
  approvalStatus: string
  approvedBy: string | null
  approvedAt: string | null
}

export function MetricSettings({
  definitions,
  cogsAccounts,
  costPeriods,
  reconciliations,
  canApprove,
  canManage,
}: {
  definitions: DefinitionRow[]
  cogsAccounts: {
    id: string
    sourceAccountId: string
    accountName: string
    accountType: string | null
    includeInCogs: boolean
    note: string | null
  }[]
  costPeriods: {
    id: string
    divisionName: string
    divisionCode: string
    periodStart: string
    cogsAmount: number
    isApproved: boolean
    approvedBy: string | null
    basis: string
  }[]
  reconciliations: {
    id: string
    metricName: string
    periodStart: string
    platformValue: number
    sourceValue: number
    variance: number
    variancePct: number
    passed: boolean
    performedBy: string | null
  }[]
  canApprove: boolean
  canManage: boolean
}) {
  const [result, setResult] = React.useState<SettingsResult | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [confirmApproval, setConfirmApproval] = React.useState<{ definition: DefinitionRow; approve: boolean } | null>(
    null,
  )

  const run = async (action: (formData: FormData) => Promise<SettingsResult>, formData: FormData) => {
    setBusy(true)
    setResult(null)
    try {
      setResult(await action(formData))
    } catch {
      setResult({ ok: false, message: 'Something went wrong. Please try again.' })
    } finally {
      setBusy(false)
      setConfirmApproval(null)
    }
  }

  const pending = definitions.filter((d) => d.approvalStatus !== 'APPROVED').length

  return (
    <>
      {result ? (
        <Alert
          tone={result.ok ? 'positive' : 'negative'}
          title={result.ok ? 'Saved' : 'Not saved'}
          className="mb-4"
        >
          {result.message}
        </Alert>
      ) : null}

      {pending > 0 ? (
        <Alert tone="warning" title={`${pending} metric definitions are not yet approved`} className="mb-4">
          Figures derived from an unapproved definition are reported, but they are never labelled as verified
          financial reporting. The financial definitions need Farida&apos;s sign-off before go-live.
        </Alert>
      ) : null}

      <Tabs defaultValue="definitions">
        <TabsList>
          <TabsTrigger value="definitions">Definitions ({definitions.length})</TabsTrigger>
          <TabsTrigger value="cogs">Cost mappings ({cogsAccounts.length})</TabsTrigger>
          <TabsTrigger value="periods">Approved cost periods</TabsTrigger>
          <TabsTrigger value="reconciliation">Reconciliation</TabsTrigger>
        </TabsList>

        {/* --- Definitions ------------------------------------------------ */}
        <TabsContent value="definitions">
          <div className="space-y-3">
            {definitions.map((definition) => (
              <Card key={definition.key}>
                <details className="group">
                  <summary className="flex cursor-pointer list-none items-start justify-between gap-4 px-4 py-3.5 sm:px-5">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-[14.5px] font-semibold text-ink-900">{definition.name}</h3>
                        <Badge
                          variant={
                            definition.approvalStatus === 'APPROVED'
                              ? 'positive'
                              : definition.approvalStatus === 'REJECTED'
                                ? 'negative'
                                : 'warning'
                          }
                          size="sm"
                        >
                          {definition.approvalStatus === 'APPROVED'
                            ? 'Approved'
                            : definition.approvalStatus === 'REJECTED'
                              ? 'Rejected'
                              : 'Awaiting approval'}
                        </Badge>
                      </div>
                      <p className="mt-1 text-[13px] leading-5 text-ink-600">{definition.shortDescription}</p>
                      <p className="mt-1.5 font-mono text-[12px] text-ink-700">{definition.formula}</p>
                    </div>
                    <ChevronDown
                      className="mt-1 size-4 shrink-0 text-ink-400 transition-transform group-open:rotate-180"
                      aria-hidden
                    />
                  </summary>

                  <CardContent className="border-t border-ink-200">
                    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                      <Detail label="Source systems" value={definition.sourceSystems.join(', ')} />
                      <Detail label="Date basis" value={definition.dateBasis} />
                      <Detail label="Includes" value={definition.includedRecords} />
                      <Detail label="Excludes" value={definition.excludedRecords} />
                      <Detail label="Currency handling" value={definition.currencyHandling} />
                      <Detail label="Division mapping" value={definition.divisionMapping} />
                      {definition.notes ? <Detail label="Notes" value={definition.notes} wide /> : null}
                      <Detail label="Approver" value={definition.approver} />
                      {definition.approvedAt ? (
                        <Detail
                          label="Approval recorded"
                          value={`${definition.approvedBy ?? 'unknown'} on ${formatDate(definition.approvedAt)}`}
                        />
                      ) : null}
                    </dl>

                    {canApprove ? (
                      <div className="mt-4 flex flex-wrap gap-2 border-t border-ink-200 pt-4">
                        <Button
                          variant="primary"
                          size="sm"
                          disabled={definition.approvalStatus === 'APPROVED'}
                          onClick={() => setConfirmApproval({ definition, approve: true })}
                        >
                          <CheckCircle2 aria-hidden />
                          Approve this definition
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={definition.approvalStatus === 'REJECTED'}
                          onClick={() => setConfirmApproval({ definition, approve: false })}
                        >
                          <XCircle aria-hidden />
                          Mark as needing changes
                        </Button>
                      </div>
                    ) : null}
                  </CardContent>
                </details>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* --- COGS account mappings -------------------------------------- */}
        <TabsContent value="cogs">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Which accounts count as direct cost</CardTitle>
                <CardDescription>
                  Only accounts ticked here feed cost of goods sold. Operating expenses &mdash; rent, overhead
                  salaries, marketing, software, professional fees &mdash; must never be included.
                </CardDescription>
              </div>
            </CardHeader>

            {cogsAccounts.length === 0 ? (
              <EmptyState
                title="No chart of accounts imported yet"
                description="Run a QuickBooks sync to import the chart of accounts. Accounts QuickBooks types as Cost of Goods Sold are pre-ticked as a starting point, and Finance confirms each one here."
                action={{ label: 'Go to Data Health', href: '/data-health' }}
              />
            ) : (
              <TableScroll>
                <Table>
                  <THead>
                    <TR>
                      <TH>Account</TH>
                      <TH>QuickBooks type</TH>
                      <TH>Include in cost of goods sold</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {cogsAccounts.map((account) => (
                      <TR key={account.id} className="hover:bg-ink-50">
                        <TD>
                          <span className="block font-medium text-ink-900">{account.accountName}</span>
                          <span className="block font-mono text-[11.5px] text-ink-500">
                            {account.sourceAccountId}
                          </span>
                          {account.note ? (
                            <span className="mt-0.5 block max-w-[28rem] text-[11.5px] leading-4 text-ink-500">
                              {account.note}
                            </span>
                          ) : null}
                        </TD>
                        <TD className="whitespace-nowrap">
                          <Badge
                            variant={account.accountType === 'Cost of Goods Sold' ? 'brand' : 'neutral'}
                            size="sm"
                          >
                            {account.accountType ?? 'Unknown'}
                          </Badge>
                        </TD>
                        <TD>
                          <form
                            action={(formData) => {
                              formData.set('mappingId', account.id)
                              formData.set('includeInCogs', String(!account.includeInCogs))
                              void run(setCogsAccountIncluded, formData)
                            }}
                          >
                            <label className="flex items-center gap-2.5">
                              <Switch
                                checked={account.includeInCogs}
                                disabled={!canManage || busy}
                                onCheckedChange={(checked) => {
                                  const formData = new FormData()
                                  formData.set('mappingId', account.id)
                                  formData.set('includeInCogs', String(checked))
                                  void run(setCogsAccountIncluded, formData)
                                }}
                                aria-label={`Include ${account.accountName} in cost of goods sold`}
                              />
                              <span
                                className={cn(
                                  'text-[12.5px]',
                                  account.includeInCogs ? 'font-medium text-ink-900' : 'text-ink-500',
                                )}
                              >
                                {account.includeInCogs ? 'Included' : 'Excluded'}
                              </span>
                            </label>
                          </form>
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableScroll>
            )}
          </Card>
        </TabsContent>

        {/* --- Cost periods ------------------------------------------------ */}
        <TabsContent value="periods">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Approved cost of goods sold by month</CardTitle>
                <CardDescription>
                  Gross margin is only reported for a period once every month inside it has an approved cost
                  figure. Unapproved months show as unavailable rather than being estimated.
                </CardDescription>
              </div>
            </CardHeader>

            {costPeriods.length === 0 ? (
              <EmptyState
                icon={ShieldCheck}
                title="No cost periods recorded yet"
                description="Monthly direct-cost totals are built from the accounts ticked on the Cost mappings tab. Run a QuickBooks sync, then Finance approves each month here."
              />
            ) : (
              <TableScroll>
                <Table>
                  <THead>
                    <TR>
                      <TH>Month</TH>
                      <TH>Division</TH>
                      <TH numeric>Cost of goods sold</TH>
                      <TH>Basis</TH>
                      <TH>Approval</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {costPeriods.map((period) => (
                      <TR key={period.id} className="hover:bg-ink-50">
                        <TD className="whitespace-nowrap font-medium text-ink-900">
                          {new Intl.DateTimeFormat('en-US', {
                            month: 'long',
                            year: 'numeric',
                            timeZone: 'UTC',
                          }).format(new Date(period.periodStart))}
                        </TD>
                        <TD>
                          <span className="flex items-center gap-2">
                            <span
                              className="size-2.5 shrink-0 rounded-sm"
                              style={{ backgroundColor: divisionColor(period.divisionCode) }}
                              aria-hidden
                            />
                            {period.divisionName}
                          </span>
                        </TD>
                        <TD numeric>{formatCurrency(period.cogsAmount)}</TD>
                        <TD className="text-[12px] text-ink-600">{period.basis}</TD>
                        <TD>
                          <Badge variant={period.isApproved ? 'positive' : 'warning'} size="sm">
                            {period.isApproved ? `Approved${period.approvedBy ? ` by ${period.approvedBy}` : ''}` : 'Not approved'}
                          </Badge>
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableScroll>
            )}
          </Card>
        </TabsContent>

        {/* --- Reconciliation ---------------------------------------------- */}
        <TabsContent value="reconciliation">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Reconciliation against QuickBooks</CardTitle>
                <CardDescription>
                  Revenue and accounts receivable are compared against QuickBooks for agreed closed months. A
                  metric is not released as verified while its reconciliation has failed.
                </CardDescription>
              </div>
            </CardHeader>

            {reconciliations.length === 0 ? (
              <EmptyState
                title="No reconciliation has been recorded"
                description="For each agreed closed month, compare the platform figure against the QuickBooks report and record the result. Acceptance requires a passing reconciliation before a financial metric is reported as verified."
              />
            ) : (
              <TableScroll>
                <Table>
                  <THead>
                    <TR>
                      <TH>Metric</TH>
                      <TH>Period</TH>
                      <TH numeric>Platform</TH>
                      <TH numeric>QuickBooks</TH>
                      <TH numeric>Variance</TH>
                      <TH>Result</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {reconciliations.map((rec) => (
                      <TR key={rec.id} className="hover:bg-ink-50">
                        <TD className="font-medium text-ink-900">{rec.metricName}</TD>
                        <TD className="whitespace-nowrap">
                          {new Intl.DateTimeFormat('en-US', {
                            month: 'short',
                            year: 'numeric',
                            timeZone: 'UTC',
                          }).format(new Date(rec.periodStart))}
                        </TD>
                        <TD numeric>{formatCurrency(rec.platformValue)}</TD>
                        <TD numeric>{formatCurrency(rec.sourceValue)}</TD>
                        <TD numeric className={rec.passed ? 'text-ink-700' : 'font-semibold text-negative-700'}>
                          {formatCurrency(rec.variance)} ({formatPercent(rec.variancePct, 2)})
                        </TD>
                        <TD>
                          <Badge variant={rec.passed ? 'positive' : 'negative'} size="sm">
                            {rec.passed ? 'Passed' : 'Failed'}
                          </Badge>
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableScroll>
            )}
          </Card>
        </TabsContent>
      </Tabs>

      <ConfirmDialog
        open={confirmApproval !== null}
        onOpenChange={(open) => !open && setConfirmApproval(null)}
        title={
          confirmApproval?.approve
            ? `Approve the definition of "${confirmApproval.definition.name}"?`
            : `Mark "${confirmApproval?.definition.name}" as needing changes?`
        }
        description={
          confirmApproval?.approve ? (
            <>
              <p>You are confirming that this formula is correct for MetroLED:</p>
              <p className="mt-2 rounded bg-ink-100 px-2.5 py-2 font-mono text-[12px] text-ink-900">
                {confirmApproval.definition.formula}
              </p>
              <p className="mt-2">
                Figures using it will be reported as verified. Your name and the time are recorded in the audit
                log.
              </p>
            </>
          ) : (
            <p>
              Figures using this definition will continue to be shown, but will remain labelled as unverified until
              the definition is corrected and approved.
            </p>
          )
        }
        confirmLabel={confirmApproval?.approve ? 'Approve definition' : 'Mark as needing changes'}
        loading={busy}
        onConfirm={() => {
          if (!confirmApproval) return
          const formData = new FormData()
          formData.set('metricKey', confirmApproval.definition.key)
          formData.set('approve', String(confirmApproval.approve))
          void run(approveMetricDefinition, formData)
        }}
      />
    </>
  )
}

function Detail({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={wide ? 'sm:col-span-2' : undefined}>
      <dt className="text-[11.5px] font-medium uppercase tracking-wide text-ink-500">{label}</dt>
      <dd className="mt-0.5 text-[12.5px] leading-5 text-ink-700">{value}</dd>
    </div>
  )
}
