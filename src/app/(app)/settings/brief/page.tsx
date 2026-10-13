import type { Metadata } from 'next'
import { PERMISSIONS } from '@/lib/auth/permissions'
import { requirePermission } from '@/lib/auth/guards'
import { prisma, databaseReachable } from '@/lib/db'
import { loadSettings } from '@/lib/data/dataset'
import { emailConfigured, emailProviderLabel } from '@/lib/email/provider'
import { env } from '@/lib/env'
import { Alert } from '@/components/ui/feedback'
import { BriefSettings } from './brief-settings'

export const metadata: Metadata = { title: 'Daily Brief settings' }

/**
 * Daily Brief schedule and recipients (sections 12 and 17).
 *
 * The exact delivery time and the recipient list require client confirmation,
 * so both are configurable here rather than hard-coded.
 */
export default async function BriefSettingsPage() {
  const user = await requirePermission(PERMISSIONS.SETTINGS_VIEW, '/settings/brief')
  const canManage = user.permissions.has(PERMISSIONS.SETTINGS_MANAGE)
  const dbReady = await databaseReachable()
  const settings = await loadSettings()

  const [recipients, recentBriefs] = dbReady
    ? await Promise.all([
        prisma.briefRecipient.findMany({ where: { isActive: true }, orderBy: { email: 'asc' } }),
        prisma.dailyBrief.findMany({
          orderBy: { briefDate: 'desc' },
          take: 10,
          include: { deliveries: { select: { status: true } } },
        }),
      ])
    : [[], []]

  return (
    <div className="space-y-4">
      {!dbReady ? (
        <Alert tone="negative" title="The reporting database is not reachable">
          The schedule and the recipient list are stored in the database and cannot be changed right now.
        </Alert>
      ) : null}

      {!emailConfigured() ? (
        <Alert tone="warning" title="Email sending is not configured">
          <code className="font-mono text-[12px]">EMAIL_PROVIDER</code> is set to{' '}
          <strong>{env().EMAIL_PROVIDER}</strong> but its credentials are missing, so no brief can be delivered.
          Acceptance requires five consecutive business days of successful delivery, so configure this before the
          acceptance run.
        </Alert>
      ) : null}

      <BriefSettings
        canManage={canManage && dbReady}
        providerLabel={emailProviderLabel()}
        isConsoleProvider={env().EMAIL_PROVIDER === 'console'}
        appUrl={env().APP_URL}
        settings={{
          briefEnabled: settings.briefEnabled,
          briefSendHour: settings.briefSendHour,
          briefSendMinute: settings.briefSendMinute,
          timezone: settings.timezone,
        }}
        recipients={recipients.map((r) => ({ id: r.id, email: r.email, name: r.name }))}
        recentBriefs={recentBriefs.map((brief) => ({
          id: brief.id,
          briefDate: brief.briefDate.toISOString(),
          status: brief.status,
          generatedAt: brief.generatedAt ? brief.generatedAt.toISOString() : null,
          sent: brief.deliveries.filter((d) => d.status === 'SENT' || d.status === 'DELIVERED').length,
          failed: brief.deliveries.filter((d) => d.status === 'FAILED' || d.status === 'BOUNCED').length,
          total: brief.deliveries.length,
        }))}
      />
    </div>
  )
}

export const dynamic = 'force-dynamic'
