import type { DivisionsSettingsPageData } from '@shared/api/admin'
import { useDocumentTitle } from '@/lib/navigation'
import { Alert } from '@/components/ui/feedback'
import { PageQuery } from '@/components/layout/page-error'
import { FormPageSkeleton } from '@/components/layout/page-skeleton'
import { ADMIN_KEYS, useAdminPage } from '@/pages/users/admin-client'
import { DivisionSettings } from './division-settings'

/**
 * Divisions and their source mappings (section 17).
 *
 * A mapping rule decides which division a record is reported under. Getting it
 * wrong moves revenue onto the wrong division, so every change is audited and
 * the page explains that a rule only applies to records imported after it.
 */
export default function DivisionsSettingsPage() {
  useDocumentTitle('Divisions & mappings')
  const query = useAdminPage<DivisionsSettingsPageData>(ADMIN_KEYS.settingsDivisions, '/api/settings/divisions/page')

  return (
    <PageQuery query={query} skeleton={<FormPageSkeleton />}>
      {(data) =>
        !data.dbReady ? (
          <Alert tone="negative" title="The reporting database is not reachable">
            Divisions and mapping rules are stored in the database. Set{' '}
            <code className="font-mono text-[12px]">DATABASE_URL</code> and run{' '}
            <code className="font-mono text-[12px]">npm run db:deploy</code>.
          </Alert>
        ) : (
          <DivisionSettings
            canManage={data.canManage}
            divisions={data.divisions}
            rules={data.rules}
            mappableFields={data.mappableFields}
            unassigned={data.unassigned}
          />
        )
      }
    </PageQuery>
  )
}
