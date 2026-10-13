import type { MetricsSettingsPageData } from '@shared/api/admin'
import { useDocumentTitle } from '@/lib/navigation'
import { Alert } from '@/components/ui/feedback'
import { PageQuery } from '@/components/layout/page-error'
import { FormPageSkeleton } from '@/components/layout/page-skeleton'
import { ADMIN_KEYS, useAdminPage } from '@/pages/users/admin-client'
import { MetricSettings } from './metric-settings'

/**
 * Metric definitions, cost mappings and approvals (sections 15 and 17).
 *
 * Every formula the platform reports is documented here with its source, date
 * basis and exclusions, and carries an explicit approval state. A metric that
 * has not been approved is never presented as verified financial reporting.
 */
export default function MetricsSettingsPage() {
  useDocumentTitle('Metric definitions')
  const query = useAdminPage<MetricsSettingsPageData>(ADMIN_KEYS.settingsMetrics, '/api/settings/metrics/page')

  return (
    <PageQuery query={query} skeleton={<FormPageSkeleton />}>
      {(data) => (
        <div className="space-y-4">
          {!data.dbReady ? (
            <Alert tone="warning" title="The reporting database is not reachable">
              The definitions below are the canonical formulas shipped with the application. Approval state, cost
              mappings and reconciliations are stored in the database and cannot be read or changed right now.
            </Alert>
          ) : null}

          <MetricSettings
            canApprove={data.canApprove}
            canManage={data.canManage}
            definitions={data.definitions}
            cogsAccounts={data.cogsAccounts}
            costPeriods={data.costPeriods}
            reconciliations={data.reconciliations}
          />
        </div>
      )}
    </PageQuery>
  )
}
