import { Router } from 'express'
import { PERMISSIONS } from '@shared/permissions'
import type { NotificationItem, NotificationsResponse } from '@shared/api/operations'
import { buildAccessScope, currentUser, requireAuth } from '../lib/auth/guards'
import { loadDataset, loadSettings } from '../lib/data/dataset'
import { buildAttentionItems } from '../lib/analytics/overview'
import { loadStoredBrief } from '../lib/brief/send'
import { formatBriefDate } from '../lib/brief/render'
import { db, databaseReachable, sql } from '../lib/db'
import { handler } from '../lib/http/errors'

export const notificationsRouter = Router()

/**
 * GET /api/notifications
 *
 * The bell in the top bar. Notifications are derived, not stored: each one is
 * a condition that is true right now for the signed-in user, built from the
 * same permission-scoped dataset the Overview uses. A user never sees a
 * notification about a figure their role cannot open.
 *
 * Read state lives in the browser (per user), because "seen" is a presentation
 * concern and the conditions themselves resolve on their own: an overdue
 * invoice stops being a notification when it is paid, not when it is clicked.
 */
notificationsRouter.get(
  '/',
  requireAuth(null),
  handler(async (_req, res): Promise<NotificationsResponse> => {
    // requireAuth(null) only checks for a session; everything below is scoped
    // to what this user's role may see.
    const user = currentUser(res)
    const now = new Date()
    const scope = buildAccessScope(user)
    const settings = await loadSettings()
    const dataset = await loadDataset(scope, { now, months: 13 })

    const items: NotificationItem[] = []

    // 1. Everything the Overview's "Attention required" list would show.
    const attention = buildAttentionItems(
      dataset,
      {
        canSeeMargin: scope.canSeeMargin,
        canSeeReceivables: scope.canSeeReceivables,
        canSeePipeline: scope.canSeePipeline,
        canSeeEcommerce: scope.canSeeEcommerce,
        canSeeRevenue: scope.canSeeRevenue,
      },
      { staleQuoteDays: settings.staleQuoteDays, largeQuoteAmount: settings.largeQuoteAmount },
      { asOf: now, unmatchedCount: dataset.unmatchedCount },
    )
    for (const item of attention) {
      // Integration and unmatched-record items only make sense to someone who can open Data Health.
      if (item.href.startsWith('/data-health') && !user.permissions.has(PERMISSIONS.DATA_HEALTH_VIEW)) continue
      if (item.href.startsWith('/settings') && !user.permissions.has(PERMISSIONS.SETTINGS_VIEW)) continue
      items.push({
        id: item.id,
        severity: item.severity,
        title: item.title,
        detail: item.detail,
        amountLabel: item.amountLabel ?? null,
        actionLabel: item.actionLabel,
        href: item.href,
        at: null,
      })
    }

    const dbReady = !user.isDemo && (await databaseReachable())

    // 2. Background jobs that will not run again on their own.
    if (dbReady && user.permissions.has(PERMISSIONS.DATA_HEALTH_VIEW)) {
      const dead = await db.maybeOne<{ count: number }>(
        sql`SELECT COUNT(*)::int AS "count" FROM "Job" WHERE "status" = ${'DEAD'}`,
      )
      if (dead && dead.count > 0) {
        items.push({
          id: 'dead-jobs',
          severity: 'urgent',
          title: `${dead.count} background ${dead.count === 1 ? 'job' : 'jobs'} failed permanently`,
          detail: 'These jobs exhausted their retries. Review the sync errors and re-run the affected integration.',
          amountLabel: null,
          actionLabel: 'Open Data Health',
          href: '/data-health',
          at: null,
        })
      }
    }

    // 3. The latest Daily Brief, while it is still today's news.
    if (dbReady && user.permissions.has(PERMISSIONS.BRIEF_VIEW)) {
      const brief = await loadStoredBrief()
      const generatedAt = brief?.generatedAt ?? null
      if (brief && generatedAt && now.getTime() - generatedAt.getTime() < 36 * 60 * 60 * 1000) {
        items.push({
          id: `brief-${brief.id}`,
          severity: 'info',
          title: `Daily Brief for ${formatBriefDate(brief.payload.briefDate)} is ready`,
          detail: 'Yesterday in one page: revenue, new overdue invoices, stale quotes and sync health.',
          amountLabel: null,
          actionLabel: 'Read the brief',
          href: '/daily-brief',
          at: generatedAt.toISOString(),
        })
      }
    }

    // 4. Account housekeeping.
    if (user.mustChangePassword) {
      items.push({
        id: 'must-change-password',
        severity: 'warning',
        title: 'Choose your own password',
        detail: 'This account is using a one-time password issued by an administrator.',
        amountLabel: null,
        actionLabel: 'Change password',
        href: '/account',
        at: null,
      })
    }

    const order: Record<string, number> = { urgent: 0, warning: 1, info: 2 }
    items.sort((a, b) => (order[a.severity] ?? 3) - (order[b.severity] ?? 3))

    return { now: now.toISOString(), mode: dataset.mode, items }
  }),
)
