import { Router } from 'express'
import { ALL_PERMISSIONS, PERMISSIONS } from '@shared/permissions'
import { minutesSince, previousBusinessDate } from '@shared/dates'
import type {
  AccountPageData,
  AskPageData,
  DailyBriefPageData,
  DataHealthPageData,
  DataHealthSourceRow,
} from '@shared/api/operations'
import { buildAccessScope, requirePermission, requireUser } from '../../lib/auth/guards'
import { getPageContext, type SearchParams } from '../../lib/page-context'
import { assistantConfigured } from '../../lib/ai/assistant'
import { SUGGESTED_QUESTIONS } from '../../lib/ai/tools'
import { loadSettings } from '../../lib/data/dataset'
import { buildBriefPayload } from '../../lib/brief/generate'
import { loadStoredBrief } from '../../lib/brief/send'
import { formatBriefDate } from '../../lib/brief/render'
import { emailConfigured, emailProviderLabel } from '../../lib/email/provider'
import { db, sql, databaseReachable } from '../../lib/db'
import type { IntegrationRow, SessionRow } from '../../lib/db-rows'
import { demoDataAllowed, integrationEnv } from '../../lib/env'
import { providerConfigured } from '../../lib/integrations/sync-service'
import { credentialEncryptionConfigured } from '../../lib/crypto'
import { DEMO_UNMATCHED_RECORDS } from '../../lib/demo/dataset'
import { handler } from '../../lib/http/errors'

/**
 * Page data for the operations pages (Ask, Daily Brief, Data Health, Account).
 *
 * Each handler runs the same server-side code the former server-rendered page
 * ran - permission check first - and returns the view model the page renders.
 */
export const operationsPagesRouter = Router()

const iso = (date: Date | null | undefined): string | null => (date ? date.toISOString() : null)

// ---------------------------------------------------------------------------
// Ask MetroLED (section 11)
// ---------------------------------------------------------------------------

/**
 * The assistant answers only from a fixed set of approved business queries and
 * attaches the source of every figure. It cannot write SQL and cannot reach a
 * record the signed-in role is not allowed to see - that is enforced in the
 * query layer, not by the model.
 */
operationsPagesRouter.get(
  '/ask',
  handler(async (req): Promise<AskPageData> => {
    const params = req.query as SearchParams
    const context = await getPageContext(PERMISSIONS.AI_USE, '/ask', params, { months: 24 })
    const { dataset, scope, user, now } = context

    const initialQuestion = typeof params.q === 'string' ? params.q : null
    const configured = assistantConfigured()

    // Only suggest questions this role can actually have answered.
    const suggestions = SUGGESTED_QUESTIONS.filter((question) => {
      const lower = question.toLowerCase()
      if ((lower.includes('margin') || lower.includes('profit')) && !scope.canSeeMargin) return false
      if (lower.includes('overdue') && !scope.canSeeReceivables) return false
      if (lower.includes('eco led mart') && !scope.canSeeEcommerce) return false
      return true
    })

    return {
      now: now.toISOString(),
      dataMode: dataset.mode,
      lastRefreshAt: iso(dataset.freshness.lastRefreshAt),
      isStale: dataset.freshness.isStale,
      user: { name: user.name, roleLabel: user.roleLabel },
      initialQuestion,
      configured,
      canSeeMargin: scope.canSeeMargin,
      suggestions,
    }
  }),
)

// ---------------------------------------------------------------------------
// Daily executive brief (section 12)
// ---------------------------------------------------------------------------

/**
 * The page renders the stored brief payload when one exists, so what is shown
 * is byte-for-byte the same set of figures that went out by email. If no brief
 * has been generated yet it previews what today's brief would contain, clearly
 * labelled as a preview.
 */
operationsPagesRouter.get(
  '/daily-brief',
  handler(async (): Promise<DailyBriefPageData> => {
    const user = await requirePermission(PERMISSIONS.BRIEF_VIEW, '/daily-brief')
    const scope = buildAccessScope(user)
    const settings = await loadSettings()
    const now = new Date()

    const stored = await loadStoredBrief()
    const payload = stored?.payload ?? (await buildBriefPayload({ now }))
    const isPreview = !stored

    const canManage = user.permissions.has(PERMISSIONS.SETTINGS_MANAGE)
    const expectedDate = previousBusinessDate(now, settings.timezone)

    return {
      now: now.toISOString(),
      payload,
      isPreview,
      generatedAt: iso(stored?.generatedAt),
      briefDateLabel: formatBriefDate(payload.briefDate),
      expectedDateLabel: formatBriefDate(expectedDate.toISOString().slice(0, 10)),
      schedule: {
        briefEnabled: settings.briefEnabled,
        briefSendHour: settings.briefSendHour,
        briefSendMinute: settings.briefSendMinute,
        timezone: settings.timezone,
      },
      canManage,
      canSeeReceivables: scope.canSeeReceivables,
      canSeePipeline: scope.canSeePipeline,
      canSeeEcommerce: scope.canSeeEcommerce,
      email: canManage
        ? {
            configured: emailConfigured(),
            providerLabel: emailProviderLabel(),
            deliveries: (stored?.deliveries ?? []).map((d) => ({
              recipient: d.recipient,
              status: d.status,
              sentAt: iso(d.sentAt),
              errorMessage: d.errorMessage,
              attempts: d.attempts,
            })),
          }
        : null,
    }
  }),
)

// ---------------------------------------------------------------------------
// Data Health (section 13)
// ---------------------------------------------------------------------------

/**
 * Shows connection status, synchronisation history, failures and records
 * awaiting manual review. Credentials and access tokens are never returned:
 * only whether a credential exists and whether it works.
 */
operationsPagesRouter.get(
  '/data-health',
  handler(async (req): Promise<DataHealthPageData> => {
    const params = req.query as SearchParams
    const user = await requirePermission(PERMISSIONS.DATA_HEALTH_VIEW, '/data-health')
    const canManage = user.permissions.has(PERMISSIONS.DATA_HEALTH_MANAGE)
    const dbReady = await databaseReachable()
    const now = new Date()

    const tab = typeof params.tab === 'string' ? params.tab : 'overview'

    const integrations = dbReady
      ? await db.many<IntegrationRow>(sql`SELECT * FROM "Integration" ORDER BY "provider" ASC`)
      : []

    const recentRuns = dbReady
      ? await db.many<{
          id: string
          startedAt: Date
          entity: string
          trigger: string
          status: string
          errorSummary: string | null
          recordsRead: number
          recordsCreated: number
          recordsUpdated: number
          recordsFailed: number
          durationMs: number | null
          integrationDisplayName: string
        }>(sql`
          SELECT r."id", r."startedAt", r."entity", r."trigger", r."status", r."errorSummary",
                 r."recordsRead", r."recordsCreated", r."recordsUpdated", r."recordsFailed", r."durationMs",
                 i."displayName" AS "integrationDisplayName"
          FROM "SyncRun" r
          JOIN "Integration" i ON i."id" = r."integrationId"
          ORDER BY r."startedAt" DESC
          LIMIT 40`)
      : []

    const recentErrors = dbReady
      ? await db.many<{
          id: string
          createdAt: Date
          entity: string
          sourceId: string | null
          message: string
          isRetryable: boolean
          integrationDisplayName: string
        }>(sql`
          SELECT e."id", e."createdAt", e."entity", e."sourceId", e."message", e."isRetryable",
                 i."displayName" AS "integrationDisplayName"
          FROM "SyncError" e
          JOIN "SyncRun" r ON r."id" = e."syncRunId"
          JOIN "Integration" i ON i."id" = r."integrationId"
          WHERE e."resolvedAt" IS NULL
          ORDER BY e."createdAt" DESC
          LIMIT 30`)
      : []

    const unmatched = dbReady
      ? await db.many<{
          id: string
          sourceName: string
          sourceId: string
          reason: string
          createdAt: Date
          integrationDisplayName: string
        }>(sql`
          SELECT u."id", u."sourceName", u."sourceId", u."reason", u."createdAt",
                 i."displayName" AS "integrationDisplayName"
          FROM "UnmatchedRecord" u
          JOIN "Integration" i ON i."id" = u."integrationId"
          WHERE u."status" = ${'UNMATCHED'}
          ORDER BY u."createdAt" DESC
          LIMIT 50`)
      : []

    const jobStats = dbReady
      ? await db.many<{ status: string; count: number }>(
          sql`SELECT "status", COUNT(*)::int AS "count" FROM "Job" GROUP BY "status"`,
        )
      : []

    // In demo mode there are no real integration rows; show the demo health view
    // so the page can be reviewed, clearly labelled.
    const usingDemo = !dbReady && demoDataAllowed()

    const providers: {
      provider: 'QUICKBOOKS' | 'METHOD_CRM' | 'SHOPIFY' | 'MONDAY'
      displayName: string
      required: boolean
      envConfigured: boolean
    }[] = [
      { provider: 'QUICKBOOKS', displayName: 'QuickBooks Online', required: true, envConfigured: integrationEnv.quickbooks().configured },
      { provider: 'METHOD_CRM', displayName: 'Method CRM', required: true, envConfigured: integrationEnv.method().configured },
      { provider: 'SHOPIFY', displayName: 'Shopify — Eco LED Mart', required: true, envConfigured: integrationEnv.shopify().configured },
      ...(integrationEnv.monday().enabled
        ? [
            {
              provider: 'MONDAY' as const,
              displayName: 'Monday.com',
              required: false,
              envConfigured: integrationEnv.monday().configured,
            },
          ]
        : []),
    ]

    const rows: DataHealthSourceRow[] = providers.map((definition) => {
      const row = integrations.find((i) => i.provider === definition.provider)
      const mins = minutesSince(row?.lastSuccessAt ?? null, now)
      const staleHours = 6
      return {
        ...definition,
        status: row?.status ?? 'NOT_CONFIGURED',
        isEnabled: row?.isEnabled ?? false,
        lastSuccessAt: iso(row?.lastSuccessAt),
        lastAttemptAt: iso(row?.lastAttemptAt),
        lastErrorAt: iso(row?.lastErrorAt),
        lastErrorMessage: row?.lastErrorMessage ?? null,
        consecutiveFailures: row?.consecutiveFailures ?? 0,
        syncIntervalMin: row?.syncIntervalMin ?? 180,
        historyMonths: row?.historyMonths ?? 24,
        hasStoredCredentials: Boolean(row?.credentials),
        isStale: (row?.isEnabled ?? false) && (mins === null || mins > staleHours * 60),
        minutesSinceSuccess: mins,
        configuredNow: providerConfigured(definition.provider),
      }
    })

    const lastRefresh = rows
      .map((r) => (r.lastSuccessAt ? new Date(r.lastSuccessAt) : null))
      .filter((d): d is Date => d !== null)
      .sort((a, b) => b.getTime() - a.getTime())[0]

    const pendingJobs = jobStats.find((s) => s.status === 'PENDING')?.count ?? 0
    const deadJobs = jobStats.find((s) => s.status === 'DEAD')?.count ?? 0

    return {
      now: now.toISOString(),
      tab: tab === 'unmatched' ? 'unmatched' : tab === 'errors' ? 'errors' : 'runs',
      dbReady,
      usingDemo,
      canManage,
      credentialEncryptionConfigured: credentialEncryptionConfigured(),
      rows,
      lastRefreshAt: iso(lastRefresh),
      pendingJobs,
      deadJobs,
      recentRuns: recentRuns.map((run) => ({ ...run, startedAt: run.startedAt.toISOString() })),
      recentErrors: recentErrors.map((error) => ({ ...error, createdAt: error.createdAt.toISOString() })),
      unmatched: unmatched.map((record) => ({ ...record, createdAt: record.createdAt.toISOString() })),
      demoUnmatched: dbReady
        ? []
        : DEMO_UNMATCHED_RECORDS.map((record) => ({
            id: record.id,
            provider: record.provider,
            sourceName: record.sourceName,
            sourceId: record.sourceId,
            reason: record.reason,
            suggestion: record.suggestion ?? null,
          })),
    }
  }),
)

// ---------------------------------------------------------------------------
// Account
// ---------------------------------------------------------------------------

/**
 * The signed-in user's own account. Shows exactly what their role lets them
 * see, so a user who finds a page missing can understand why without asking
 * an administrator.
 */
operationsPagesRouter.get(
  '/account',
  handler(async (): Promise<AccountPageData> => {
    const user = await requireUser('/account')
    const dbReady = await databaseReachable()
    const now = new Date()

    const sessions =
      dbReady && !user.isDemo
        ? await db.many<Pick<SessionRow, 'id' | 'userAgent' | 'ipAddress' | 'lastSeenAt' | 'expiresAt'>>(sql`
            SELECT "id", "userAgent", "ipAddress", "lastSeenAt", "expiresAt"
            FROM "Session"
            WHERE "userId" = ${user.id} AND "revokedAt" IS NULL AND "expiresAt" > ${now}
            ORDER BY "lastSeenAt" DESC
            LIMIT 10`)
        : []

    const granted = ALL_PERMISSIONS.filter((permission) => user.permissions.has(permission))
    const denied = ALL_PERMISSIONS.filter((permission) => !user.permissions.has(permission))

    return {
      now: now.toISOString(),
      user: {
        name: user.name,
        email: user.email,
        roles: user.roles,
        roleLabel: user.roleLabel,
        isDemo: user.isDemo,
        timezone: user.timezone,
        salesRepId: user.salesRepId,
        divisionIds: user.divisionIds,
        mustChangePassword: user.mustChangePassword,
      },
      sessions: sessions.map((session) => ({
        id: session.id,
        userAgent: session.userAgent,
        ipAddress: session.ipAddress,
        lastSeenAt: session.lastSeenAt.toISOString(),
        expiresAt: session.expiresAt.toISOString(),
      })),
      granted,
      denied,
    }
  }),
)
