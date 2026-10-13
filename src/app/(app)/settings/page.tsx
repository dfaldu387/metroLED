import type { Metadata } from 'next'
import { PERMISSIONS } from '@/lib/auth/permissions'
import { requirePermission } from '@/lib/auth/guards'
import { loadSettings } from '@/lib/data/dataset'
import { databaseReachable } from '@/lib/db'
import { env } from '@/lib/env'
import { Alert } from '@/components/ui/feedback'
import { CompanyForm } from './company-form'

export const metadata: Metadata = { title: 'Settings' }

const TIMEZONES = [
  'America/New_York',
  'America/Toronto',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Vancouver',
  'UTC',
]

export default async function CompanySettingsPage() {
  const user = await requirePermission(PERMISSIONS.SETTINGS_VIEW, '/settings')
  const canManage = user.permissions.has(PERMISSIONS.SETTINGS_MANAGE)
  const settings = await loadSettings()
  const dbReady = await databaseReachable()

  return (
    <div className="space-y-4">
      {!dbReady ? (
        <Alert tone="negative" title="The reporting database is not reachable">
          Settings are stored in the database. The values below are the defaults the application falls back to.
        </Alert>
      ) : null}

      <CompanyForm
        canManage={canManage && dbReady}
        timezones={TIMEZONES}
        settings={{
          displayName: settings.displayName,
          timezone: settings.timezone,
          currency: settings.currency,
          staleDataHours: settings.staleDataHours,
          staleQuoteDays: settings.staleQuoteDays,
          largeQuoteAmount: settings.largeQuoteAmount,
        }}
        environment={env().APP_ENV}
      />
    </div>
  )
}

export const dynamic = 'force-dynamic'
