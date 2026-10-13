import Link from 'next/link'
import { PERMISSIONS } from '@/lib/auth/permissions'
import { requirePermission } from '@/lib/auth/guards'
import { PageHeader } from '@/components/layout/page-header'
import { SettingsNav } from './settings-nav'

/**
 * Settings shell (section 17).
 *
 * Settings are split into focused sections rather than one long form, so an
 * ordinary user is never faced with every technical option at once.
 */
export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePermission(PERMISSIONS.SETTINGS_VIEW, '/settings')
  const canManage = user.permissions.has(PERMISSIONS.SETTINGS_MANAGE)
  const canApproveMetrics = user.permissions.has(PERMISSIONS.METRICS_APPROVE)

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
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </>
  )
}
