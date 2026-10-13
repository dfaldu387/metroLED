import type { Metadata } from 'next'
import { PERMISSIONS } from '@/lib/auth/permissions'
import { requirePermission } from '@/lib/auth/guards'
import { prisma, databaseReachable, toNumber } from '@/lib/db'
import { METRIC_DEFINITIONS } from '@/lib/metrics/definitions'
import { Alert } from '@/components/ui/feedback'
import { MetricSettings } from './metric-settings'

export const metadata: Metadata = { title: 'Metric definitions' }

/**
 * Metric definitions, cost mappings and approvals (sections 15 and 17).
 *
 * Every formula the platform reports is documented here with its source, date
 * basis and exclusions, and carries an explicit approval state. A metric that
 * has not been approved is never presented as verified financial reporting.
 */
export default async function MetricsSettingsPage() {
  const user = await requirePermission(PERMISSIONS.SETTINGS_VIEW, '/settings/metrics')
  const canApprove = user.permissions.has(PERMISSIONS.METRICS_APPROVE)
  const canManage = user.permissions.has(PERMISSIONS.SETTINGS_MANAGE)
  const dbReady = await databaseReachable()

  const [stored, cogsAccounts, costPeriods, reconciliations] = dbReady
    ? await Promise.all([
        prisma.metricDefinition.findMany(),
        prisma.cogsAccountMapping.findMany({ orderBy: [{ includeInCogs: 'desc' }, { accountName: 'asc' }] }),
        prisma.divisionCost.findMany({
          orderBy: { periodStart: 'desc' },
          take: 24,
          include: { division: { select: { name: true, code: true } } },
        }),
        prisma.reconciliation.findMany({
          orderBy: { periodStart: 'desc' },
          take: 12,
          include: { metricDefinition: { select: { name: true } } },
        }),
      ])
    : [[], [], [], []]

  const storedByKey = new Map(stored.map((s) => [s.key, s]))

  return (
    <div className="space-y-4">
      {!dbReady ? (
        <Alert tone="warning" title="The reporting database is not reachable">
          The definitions below are the canonical formulas shipped with the application. Approval state, cost
          mappings and reconciliations are stored in the database and cannot be read or changed right now.
        </Alert>
      ) : null}

      <MetricSettings
        canApprove={canApprove && dbReady}
        canManage={canManage && dbReady}
        definitions={METRIC_DEFINITIONS.map((spec) => {
          const row = storedByKey.get(spec.key)
          return {
            key: spec.key,
            name: spec.name,
            shortDescription: spec.shortDescription,
            formula: spec.formula,
            sourceSystems: spec.sourceSystems,
            dateBasis: spec.dateBasis,
            includedRecords: spec.includedRecords,
            excludedRecords: spec.excludedRecords,
            currencyHandling: spec.currencyHandling,
            divisionMapping: spec.divisionMapping,
            notes: spec.notes ?? null,
            approver: spec.approver,
            approvalStatus: row?.approvalStatus ?? spec.defaultApproval,
            approvedBy: row?.approvedBy ?? null,
            approvedAt: row?.approvedAt ? row.approvedAt.toISOString() : null,
          }
        })}
        cogsAccounts={cogsAccounts.map((account) => ({
          id: account.id,
          sourceAccountId: account.sourceAccountId,
          accountName: account.accountName,
          accountType: account.accountType,
          includeInCogs: account.includeInCogs,
          note: account.note,
        }))}
        costPeriods={costPeriods.map((period) => ({
          id: period.id,
          divisionName: period.division.name,
          divisionCode: period.division.code,
          periodStart: period.periodStart.toISOString(),
          cogsAmount: toNumber(period.cogsAmount),
          isApproved: period.isApproved,
          approvedBy: period.approvedBy,
          basis: period.basis,
        }))}
        reconciliations={reconciliations.map((rec) => ({
          id: rec.id,
          metricName: rec.metricDefinition.name,
          periodStart: rec.periodStart.toISOString(),
          platformValue: toNumber(rec.platformValue),
          sourceValue: toNumber(rec.sourceValue),
          variance: toNumber(rec.variance),
          variancePct: toNumber(rec.variancePct),
          passed: rec.passed,
          performedBy: rec.performedBy,
        }))}
      />
    </div>
  )
}

export const dynamic = 'force-dynamic'
