import { Navigate, Outlet } from 'react-router'
import { PERMISSIONS } from '@shared/permissions'
import { Link } from '@/lib/navigation'
import { hasPermission, useCurrentUser } from '@/lib/session'
import { PageHeader } from '@/components/layout/page-header'
import { SettingsNav } from './settings-nav'

/**
 * Settings shell (section 17).
 *
 * Settings are split into focused sections rather than one long form, so an
 * ordinary user is never faced with every technical option at once.
 *
 * The SETTINGS_VIEW check here only decides what to render; every settings
 * endpoint re-checks the permission on the server.
 */
export default function SettingsLayout() {
  const user = useCurrentUser()

  if (!hasPermission(user, PERMISSIONS.SETTINGS_VIEW)) {
    return <Navigate to={`/no-access?permission=${encodeURIComponent(PERMISSIONS.SETTINGS_VIEW)}`} replace />
  }

  const canManage = hasPermission(user, PERMISSIONS.SETTINGS_MANAGE)
  const canApproveMetrics = hasPermission(user, PERMISSIONS.METRICS_APPROVE)

  return (
    <>
      <PageHeader
        title="Settings"
        description="Company details, divisions and mappings, approved metric definitions, and the daily brief schedule."
        meta={
          !canManage ? (
            <p className="text-[12.5px] text-ink-600">
              You can view these settings. Changing them requires an owner.{' '}
              <Link href="/users" className="font-medium text-brand-700 underline">
                See who can
              </Link>
              .
            </p>
          ) : undefined
        }
      />

      <div className="flex flex-col gap-6 lg:flex-row">
        <SettingsNav canApproveMetrics={canApproveMetrics} />
        <div className="min-w-0 flex-1">
          <Outlet />
        </div>
      </div>
    </>
  )
}
