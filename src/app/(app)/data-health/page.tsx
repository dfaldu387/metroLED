import type { Metadata } from 'next'
import { Database, Link2Off } from 'lucide-react'
import { PERMISSIONS } from '@/lib/auth/permissions'
import { requirePermission } from '@/lib/auth/guards'
import { prisma, databaseReachable, toNumber } from '@/lib/db'
import { demoDataAllowed, integrationEnv } from '@/lib/env'
import { providerConfigured } from '@/lib/integrations/sync-service'
import { credentialEncryptionConfigured } from '@/lib/crypto'
import { DEMO_UNMATCHED_RECORDS } from '@/lib/demo/dataset'
import { formatRelativeTime, minutesSince } from '@/lib/dates'
import { formatDateTime, formatDuration, formatInteger, humanizeEnum } from '@/lib/format'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge, StatusDot } from '@/components/ui/badge'
import { Alert, EmptyState } from '@/components/ui/feedback'
import { DataModeBanner, MetaFact, PageHeader } from '@/components/layout/page-header'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/misc'
import { TBody, TD, TH, THead, TR, Table, TableScroll } from '@/components/ui/table'
import { SyncControls } from './sync-controls'

export const metadata: Metadata = { title: 'Data Health' }

/**
 * Data Health (section 13).
 *
 * Shows connection status, synchronisation history, failures and records
 * awaiting manual review. Credentials and access tokens are never displayed:
 * only whether a credential exists and whether it works.
 */
export default async function DataHealthPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const user = await requirePermission(PERMISSIONS.DATA_HEALTH_VIEW, '/data-health')
  const canManage = user.permissions.has(PERMISSIONS.DATA_HEALTH_MANAGE)
  const dbReady = await databaseReachable()
  const now = new Date()

  const tab = typeof params.tab === 'string' ? params.tab : 'overview'

  const integrations = dbReady
    ? await prisma.integration.findMany({ orderBy: { provider: 'asc' } })
    : []

  const recentRuns = dbReady
    ? await prisma.syncRun.findMany({
        orderBy: { startedAt: 'desc' },
        take: 40,
        include: { integration: { select: { displayName: true, provider: true } } },
      })
    : []

  const recentErrors = dbReady
    ? await prisma.syncError.findMany({
        where: { resolvedAt: null },
        orderBy: { createdAt: 'desc' },
        take: 30,
        include: { syncRun: { include: { integration: { select: { displayName: true } } } } },
      })
    : []

  const unmatched = dbReady
    ? await prisma.unmatchedRecord.findMany({
        where: { status: 'UNMATCHED' },
        orderBy: { createdAt: 'desc' },
        take: 50,
        include: { integration: { select: { displayName: true } } },
      })
    : []

  const jobStats = dbReady
    ? await prisma.job.groupBy({ by: ['status'], _count: { _all: true } })
    : []

  // In demo mode there are no real integration rows; show the demo health view
  // so the page can be reviewed, clearly labelled.
  const usingDemo = !dbReady && demoDataAllowed()

  const providers: {
    provider: 'QUICKBOOKS' | 'METHOD_CRM' | 'SHOPIFY' | 'MONDAY'
    displayName: string
    required: boolean
    envConfigured: boolean
  }[] = [
    { provider: 'QUICKBOOKS', displayName: 'QuickBooks Online', required: true, envConfigured: integrationEnv.quickbooks().configured },
    { provider: 'METHOD_CRM', displayName: 'Method CRM', required: true, envConfigured: integrationEnv.method().configured },
    { provider: 'SHOPIFY', displayName: 'Shopify — Eco LED Mart', required: true, envConfigured: integrationEnv.shopify().configured },
    ...(integrationEnv.monday().enabled
      ? [
          {
            provider: 'MONDAY' as const,
            displayName: 'Monday.com',
            required: false,
            envConfigured: integrationEnv.monday().configured,
          },
        ]
      : []),
  ]

  const rows = providers.map((definition) => {
    const row = integrations.find((i) => i.provider === definition.provider)
    const mins = minutesSince(row?.lastSuccessAt ?? null, now)
    const staleHours = 6
    return {
      ...definition,
      status: row?.status ?? 'NOT_CONFIGURED',
      isEnabled: row?.isEnabled ?? false,
      lastSuccessAt: row?.lastSuccessAt ?? null,
      lastAttemptAt: row?.lastAttemptAt ?? null,
      lastErrorAt: row?.lastErrorAt ?? null,
      lastErrorMessage: row?.lastErrorMessage ?? null,
      consecutiveFailures: row?.consecutiveFailures ?? 0,
      syncIntervalMin: row?.syncIntervalMin ?? 180,
      historyMonths: row?.historyMonths ?? 24,
      hasStoredCredentials: Boolean(row?.credentials),
      isStale: (row?.isEnabled ?? false) && (mins === null || mins > staleHours * 60),
      minutesSinceSuccess: mins,
      configuredNow: providerConfigured(definition.provider),
    }
  })

  const lastRefresh = rows
    .map((r) => r.lastSuccessAt)
    .filter((d): d is Date => d !== null)
    .sort((a, b) => b.getTime() - a.getTime())[0]

  const pendingJobs = jobStats.find((s) => s.status === 'PENDING')?._count._all ?? 0
  const deadJobs = jobStats.find((s) => s.status === 'DEAD')?._count._all ?? 0

  return (
    <>
      <DataModeBanner mode={usingDemo ? 'demo' : dbReady ? 'live' : 'unavailable'} />

      <PageHeader
        title="Data Health"
        description="Whether each source system is connected, when it last synced, and which records need attention."
        meta={
          <>
            <MetaFact
              label="Most recent successful sync"
              value={formatRelativeTime(lastRefresh ?? null, now)}
              tone={rows.some((r) => r.isStale) ? 'warning' : 'default'}
            />
            {dbReady ? (
              <MetaFact
                label="Background jobs"
                value={`${formatInteger(pendingJobs)} pending${deadJobs > 0 ? `, ${formatInteger(deadJobs)} failed permanently` : ''}`}
                tone={deadJobs > 0 ? 'negative' : 'default'}
              />
            ) : null}
          </>
        }
        primaryAction={canManage && dbReady ? <SyncControls providers={rows.map((r) => ({ provider: r.provider, displayName: r.displayName, isEnabled: r.isEnabled }))} /> : undefined}
      />

      {!dbReady ? (
        <Alert tone="negative" title="The reporting database is not reachable" className="mb-5">
          Integration status, sync history and unmatched records all live in the database. Set{' '}
          <code className="font-mono text-[12px]">DATABASE_URL</code> and run{' '}
          <code className="font-mono text-[12px]">npm run db:deploy</code>.
          {usingDemo ? ' The demo dataset below shows what this page looks like once connected.' : ''}
        </Alert>
      ) : null}

      {!credentialEncryptionConfigured() ? (
        <Alert tone="warning" title="Integration credentials cannot be stored" className="mb-5">
          <code className="font-mono text-[12px]">CREDENTIAL_ENCRYPTION_KEY</code> is not set or is not exactly 32
          bytes, so no integration can be connected. Generate one with{' '}
          <code className="font-mono text-[12px]">
            node -e &quot;console.log(require(&apos;crypto&apos;).randomBytes(32).toString(&apos;base64&apos;))&quot;
          </code>
          .
        </Alert>
      ) : null}

      {deadJobs > 0 ? (
        <Alert tone="negative" title={`${deadJobs} background jobs failed permanently`} className="mb-5">
          These jobs exhausted their retries and will not run again on their own. Review the sync errors below and
          re-run the affected integration once the cause is fixed.
        </Alert>
      ) : null}

      {/* --- Connection status ---------------------------------------------- */}
      <Card className="mb-5">
        <CardHeader>
          <div>
            <CardTitle>Source systems</CardTitle>
            <CardDescription>
              Connection status and sync cadence. Credentials and access tokens are never displayed here.
            </CardDescription>
          </div>
        </CardHeader>
        <TableScroll>
          <Table>
            <THead>
              <TR>
                <TH>Source</TH>
                <TH>Status</TH>
                <TH>Last successful sync</TH>
                <TH>Last attempt</TH>
                <TH>Cadence</TH>
                <TH>History</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((row) => {
                const tone =
                  row.status === 'ERROR'
                    ? 'negative'
                    : row.isStale || row.status === 'DEGRADED'
                      ? 'warning'
                      : row.status === 'CONNECTED'
                        ? 'positive'
                        : 'neutral'
                return (
                  <TR key={row.provider} className="align-top hover:bg-ink-50">
                    <TD>
                      <span className="flex items-center gap-2.5">
                        <StatusDot tone={tone} />
                        <span>
                          <span className="block font-medium text-ink-900">{row.displayName}</span>
                          {!row.required ? (
                            <span className="block text-[11.5px] text-ink-500">
                              Conditional &mdash; included only on client confirmation
                            </span>
                          ) : null}
                        </span>
                      </span>
                    </TD>
                    <TD>
                      <Badge variant={tone === 'positive' ? 'positive' : tone === 'negative' ? 'negative' : tone === 'warning' ? 'warning' : 'neutral'} size="sm">
                        {row.status === 'NOT_CONFIGURED'
                          ? 'Not connected'
                          : row.status === 'ERROR'
                            ? 'Failing'
                            : row.isStale
                              ? 'Stale'
                              : humanizeEnum(row.status)}
                      </Badge>
                      {row.consecutiveFailures > 0 ? (
                        <span className="mt-1 block text-[11.5px] text-negative-700">
                          {row.consecutiveFailures} consecutive failures
                        </span>
                      ) : null}
                      {row.lastErrorMessage ? (
                        <span className="mt-1 block max-w-[20rem] text-[11.5px] leading-4 text-ink-600">
                          {row.lastErrorMessage}
                        </span>
                      ) : null}
                      {!row.configuredNow && row.status === 'NOT_CONFIGURED' ? (
                        <span className="mt-1 block text-[11.5px] text-ink-500">
                          Credentials are not present in this deployment&apos;s environment.
                        </span>
                      ) : null}
                    </TD>
                    <TD className="whitespace-nowrap text-ink-700">
                      {formatRelativeTime(row.lastSuccessAt, now)}
                      {row.lastSuccessAt ? (
                        <span className="mt-0.5 block text-[11.5px] text-ink-500">
                          {formatDateTime(row.lastSuccessAt)}
                        </span>
                      ) : null}
                    </TD>
                    <TD className="whitespace-nowrap text-ink-700">
                      {formatRelativeTime(row.lastAttemptAt, now)}
                    </TD>
                    <TD className="whitespace-nowrap text-ink-700">Every {row.syncIntervalMin} min</TD>
                    <TD className="whitespace-nowrap text-ink-700">{row.historyMonths} months</TD>
                  </TR>
                )
              })}
            </TBody>
          </Table>
        </TableScroll>
      </Card>

      {/* --- Tabs ------------------------------------------------------------ */}
      <Tabs defaultValue={tab === 'unmatched' ? 'unmatched' : tab === 'errors' ? 'errors' : 'runs'}>
        <TabsList>
          <TabsTrigger value="runs">Sync history</TabsTrigger>
          <TabsTrigger value="errors">
            Failed records{recentErrors.length > 0 ? ` (${recentErrors.length})` : ''}
          </TabsTrigger>
          <TabsTrigger value="unmatched">
            Unmatched customers
            {(dbReady ? unmatched.length : DEMO_UNMATCHED_RECORDS.length) > 0
              ? ` (${dbReady ? unmatched.length : DEMO_UNMATCHED_RECORDS.length})`
              : ''}
          </TabsTrigger>
        </TabsList>

        {/* --- Sync runs --------------------------------------------------- */}
        <TabsContent value="runs">
          <Card>
            {recentRuns.length === 0 ? (
              <EmptyState
                icon={Database}
                title="No synchronisation has run yet"
                description={
                  canManage
                    ? 'Connect a source system and run a sync to populate the reporting database. The history of every run appears here.'
                    : 'No sync has run yet. An operations user or owner can start one.'
                }
              />
            ) : (
              <TableScroll>
                <Table>
                  <THead>
                    <TR>
                      <TH>Started</TH>
                      <TH>Source</TH>
                      <TH>Entity</TH>
                      <TH>Trigger</TH>
                      <TH>Status</TH>
                      <TH numeric>Read</TH>
                      <TH numeric>Created</TH>
                      <TH numeric>Updated</TH>
                      <TH numeric>Failed</TH>
                      <TH numeric>Duration</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {recentRuns.map((run) => (
                      <TR key={run.id} className="hover:bg-ink-50">
                        <TD className="whitespace-nowrap text-ink-700">
                          {formatDateTime(run.startedAt)}
                          <span className="mt-0.5 block text-[11.5px] text-ink-500">
                            {formatRelativeTime(run.startedAt, now)}
                          </span>
                        </TD>
                        <TD className="whitespace-nowrap font-medium text-ink-900">
                          {run.integration.displayName}
                        </TD>
                        <TD className="whitespace-nowrap">{humanizeEnum(run.entity)}</TD>
                        <TD className="whitespace-nowrap text-ink-600">{humanizeEnum(run.trigger)}</TD>
                        <TD>
                          <Badge
                            variant={
                              run.status === 'SUCCEEDED'
                                ? 'positive'
                                : run.status === 'PARTIAL'
                                  ? 'warning'
                                  : run.status === 'FAILED'
                                    ? 'negative'
                                    : 'neutral'
                            }
                            size="sm"
                          >
                            {humanizeEnum(run.status)}
                          </Badge>
                          {run.errorSummary ? (
                            <span className="mt-1 block max-w-[18rem] text-[11.5px] leading-4 text-negative-700">
                              {run.errorSummary}
                            </span>
                          ) : null}
                        </TD>
                        <TD numeric>{formatInteger(run.recordsRead)}</TD>
                        <TD numeric>{formatInteger(run.recordsCreated)}</TD>
                        <TD numeric>{formatInteger(run.recordsUpdated)}</TD>
                        <TD numeric className={run.recordsFailed > 0 ? 'font-semibold text-negative-700' : ''}>
                          {formatInteger(run.recordsFailed)}
                        </TD>
                        <TD numeric className="text-ink-600">
                          {formatDuration(run.durationMs)}
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableScroll>
            )}
          </Card>
        </TabsContent>

        {/* --- Errors ------------------------------------------------------ */}
        <TabsContent value="errors">
          <Card>
            {recentErrors.length === 0 ? (
              <EmptyState
                title="No unresolved record failures"
                description="Every record imported by the most recent syncs was accepted. Individual records that fail to import are listed here with the reason."
              />
            ) : (
              <TableScroll>
                <Table>
                  <THead>
                    <TR>
                      <TH>When</TH>
                      <TH>Source</TH>
                      <TH>Entity</TH>
                      <TH>Record</TH>
                      <TH>Problem</TH>
                      <TH>Retryable</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {recentErrors.map((error) => (
                      <TR key={error.id} className="align-top hover:bg-ink-50">
                        <TD className="whitespace-nowrap text-ink-700">
                          {formatRelativeTime(error.createdAt, now)}
                        </TD>
                        <TD className="whitespace-nowrap font-medium text-ink-900">
                          {error.syncRun.integration.displayName}
                        </TD>
                        <TD className="whitespace-nowrap">{humanizeEnum(error.entity)}</TD>
                        <TD className="whitespace-nowrap font-mono text-[12px] text-ink-600">
                          {error.sourceId ?? '—'}
                        </TD>
                        <TD className="max-w-[26rem] text-[12.5px] leading-5">{error.message}</TD>
                        <TD>
                          <Badge variant={error.isRetryable ? 'warning' : 'negative'} size="sm">
                            {error.isRetryable ? 'Will retry' : 'Needs a fix'}
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

        {/* --- Unmatched --------------------------------------------------- */}
        <TabsContent value="unmatched">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Customers awaiting review</CardTitle>
                <CardDescription>
                  Source records that resemble an existing customer but not closely enough to match automatically.
                  Until they are resolved, their revenue is reported under &ldquo;Unknown customer&rdquo;.
                </CardDescription>
              </div>
            </CardHeader>

            {dbReady ? (
              unmatched.length === 0 ? (
                <EmptyState
                  icon={Link2Off}
                  title="Every source record is matched"
                  description="No customer record is waiting for a decision. Records appear here when the automatic match confidence is below 70%."
                />
              ) : (
                <TableScroll>
                  <Table>
                    <THead>
                      <TR>
                        <TH>Source</TH>
                        <TH>Name in source system</TH>
                        <TH>Why it was not matched</TH>
                        <TH>Found</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {unmatched.map((record) => (
                        <TR key={record.id} className="align-top hover:bg-ink-50">
                          <TD className="whitespace-nowrap font-medium text-ink-900">
                            {record.integration.displayName}
                          </TD>
                          <TD>
                            <span className="font-medium text-ink-900">{record.sourceName}</span>
                            <span className="mt-0.5 block font-mono text-[11.5px] text-ink-500">
                              {record.sourceId}
                            </span>
                          </TD>
                          <TD className="max-w-[28rem] text-[12.5px] leading-5">{record.reason}</TD>
                          <TD className="whitespace-nowrap text-ink-600">
                            {formatRelativeTime(record.createdAt, now)}
                          </TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                </TableScroll>
              )
            ) : (
              <TableScroll>
                <Table>
                  <THead>
                    <TR>
                      <TH>Source</TH>
                      <TH>Name in source system</TH>
                      <TH>Why it was not matched</TH>
                      <TH>Suggested match</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {DEMO_UNMATCHED_RECORDS.map((record) => (
                      <TR key={record.id} className="align-top">
                        <TD className="whitespace-nowrap font-medium text-ink-900">
                          {humanizeEnum(record.provider)}
                        </TD>
                        <TD>
                          <span className="font-medium text-ink-900">{record.sourceName}</span>
                          <span className="mt-0.5 block font-mono text-[11.5px] text-ink-500">
                            {record.sourceId}
                          </span>
                        </TD>
                        <TD className="max-w-[26rem] text-[12.5px] leading-5">{record.reason}</TD>
                        <TD className="text-[12.5px]">
                          {record.suggestion ?? <span className="italic text-ink-500">None</span>}
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

      <p className="mt-5 text-[12px] leading-5 text-ink-500">
        MetroLED Intelligence reads from QuickBooks Online, Method CRM and Shopify. It never writes to them. Access
        tokens are encrypted at rest and are never returned by any API or shown on any screen.
      </p>
    </>
  )
}

export const dynamic = 'force-dynamic'

void toNumber
