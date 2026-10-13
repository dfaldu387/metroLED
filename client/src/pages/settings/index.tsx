import type { CompanySettingsPageData } from '@shared/api/admin'
import { useDocumentTitle } from '@/lib/navigation'
import { Alert } from '@/components/ui/feedback'
import { PageQuery } from '@/components/layout/page-error'
import { FormPageSkeleton } from '@/components/layout/page-skeleton'
import { ADMIN_KEYS, useAdminPage } from '@/pages/users/admin-client'
import { CompanyForm } from './company-form'

export default function CompanySettingsPage() {
  useDocumentTitle('Settings')
  const query = useAdminPage<CompanySettingsPageData>(ADMIN_KEYS.settingsCompany, '/api/settings/page')

  return (
    <PageQuery query={query} skeleton={<FormPageSkeleton />}>
      {(data) => (
        <div className="space-y-4">
          {!data.dbReady ? (
            <Alert tone="negative" title="The reporting database is not reachable">
              Settings are stored in the database. The values below are the defaults the application falls back to.
            </Alert>
          ) : null}

          <CompanyForm
            canManage={data.canManage}
            timezones={data.timezones}
            settings={data.settings}
            environment={data.environment}
          />
        </div>
      )}
    </PageQuery>
  )
}
