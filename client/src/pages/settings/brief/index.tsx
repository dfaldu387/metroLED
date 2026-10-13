import type { BriefSettingsPageData } from '@shared/api/admin'
import { useDocumentTitle } from '@/lib/navigation'
import { Alert } from '@/components/ui/feedback'
import { PageQuery } from '@/components/layout/page-error'
import { FormPageSkeleton } from '@/components/layout/page-skeleton'
import { ADMIN_KEYS, useAdminPage } from '@/pages/users/admin-client'
import { BriefSettings } from './brief-settings'

/**
 * Daily Brief schedule and recipients (sections 12 and 17).
 *
 * The exact delivery time and the recipient list require client confirmation,
 * so both are configurable here rather than hard-coded.
 */
export default function BriefSettingsPage() {
  useDocumentTitle('Daily Brief settings')
  const query = useAdminPage<BriefSettingsPageData>(ADMIN_KEYS.settingsBrief, '/api/settings/brief/page')

  return (
    <PageQuery query={query} skeleton={<FormPageSkeleton />}>
      {(data) => (
        <div className="space-y-4">
          {!data.dbReady ? (
            <Alert tone="negative" title="The reporting database is not reachable">
              The schedule and the recipient list are stored in the database and cannot be changed right now.
            </Alert>
          ) : null}

          {!data.emailConfigured ? (
            <Alert tone="warning" title="Email sending is not configured">
              <code className="font-mono text-[12px]">EMAIL_PROVIDER</code> is set to{' '}
              <strong>{data.emailProvider}</strong> but its credentials are missing, so no brief can be delivered.
              Acceptance requires five consecutive business days of successful delivery, so configure this before the
              acceptance run.
            </Alert>
          ) : null}

          <BriefSettings
            canManage={data.canManage}
            providerLabel={data.providerLabel}
            isConsoleProvider={data.isConsoleProvider}
            appUrl={data.appUrl}
            settings={data.settings}
            recipients={data.recipients}
            recentBriefs={data.recentBriefs}
          />
        </div>
      )}
    </PageQuery>
  )
}
