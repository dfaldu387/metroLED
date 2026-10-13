import { Router, type Request } from 'express'
import { z } from 'zod'
import { db, sql, insert, upsert, databaseReachable, toNumber } from '../lib/db'
import type {
  BriefRecipientRow,
  CogsAccountMappingRow,
  CompanySettingRow,
  DivisionMappingRuleRow,
  DivisionRow,
  IntegrationRow,
  MetricDefinitionRow,
} from '../lib/db-rows'
import { getSession, type SessionUser } from '../lib/auth/session'
import { currentUser, requireAuth } from '../lib/auth/guards'
import { AUDIT_ACTIONS, recordAudit } from '../lib/auth/audit'
import { handler } from '../lib/http/errors'
import { loadSettings } from '../lib/data/dataset'
import { emailConfigured, emailProviderLabel } from '../lib/email/provider'
import { env, integrationEnv } from '../lib/env'
import { credentialEncryptionConfigured } from '../lib/crypto'
import { MAPPABLE_FIELDS } from '../lib/integrations/division-mapping'
import { PERMISSIONS } from '@shared/permissions'
import { METRIC_DEFINITIONS } from '@shared/metric-definitions'
import type { ActionResult } from '@shared/api/session'
import type {
  BriefSettingsPageData,
  CompanySettingsPageData,
  DivisionsSettingsPageData,
  IntegrationsSettingsPageData,
  MetricsSettingsPageData,
} from '@shared/api/admin'

/**
 * Settings (section 17): page data for every settings section, and the
 * settings endpoints (the former `settings/actions.ts` Server Actions).
 *
 * Sensitive changes - division mappings, cost classifications and metric
 * approvals - are restricted to administrators and are all written to the
 * audit log, because each one silently changes what every reported figure
 * means. Expected refusals come back as HTTP 200 `{ ok: false, message }`.
 */
export const settingsRouter = Router()

type SettingsResult = ActionResult

// ---------------------------------------------------------------------------
// Request body helpers (the JSON body carries the former FormData fields)
// ---------------------------------------------------------------------------

type Body = Record<string, unknown>

function body(req: Request): Body {
  return req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? (req.body as Body) : {}
}

/** `formData.get(name)`: the value, or null when absent. */
function field(b: Body, name: string): unknown {
  const v = b[name]
  return v === undefined ? null : v
}

/** A boolean posted either as JSON `true` or as the form string 'true'. */
function isTrue(v: unknown): boolean {
  return v === true || v === 'true'
}

// ---------------------------------------------------------------------------
// Authorisation
// ---------------------------------------------------------------------------

async function requireSettingsManager(): Promise<
  { ok: true; user: SessionUser } | { ok: false; result: SettingsResult }
> {
  const user = await getSession()
  if (!user) return { ok: false, result: { ok: false, message: 'Your session has expired. Sign in and try again.' } }
  if (!user.permissions.has(PERMISSIONS.SETTINGS_MANAGE)) {
    return { ok: false, result: { ok: false, message: 'Your role does not include changing settings.' } }
  }
  if (user.isDemo) {
    return {
      ok: false,
      result: { ok: false, message: 'A demo session cannot change settings. Sign in with a real account.' },
    }
  }
  if (!(await databaseReachable())) {
    return { ok: false, result: { ok: false, message: 'The database is unreachable, so nothing can be saved.' } }
  }
  return { ok: true, user }
}

// ===========================================================================
// Page data
// ===========================================================================

const TIMEZONES = [
  'America/New_York',
  'America/Toronto',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Vancouver',
  'UTC',
]

/** GET /api/settings/page - Company settings. */
settingsRouter.get(
  '/page',
  requireAuth(PERMISSIONS.SETTINGS_VIEW),
  handler(async (_req, res): Promise<CompanySettingsPageData> => {
    const user = currentUser(res)
    const canManage = user.permissions.has(PERMISSIONS.SETTINGS_MANAGE)
    const settings = await loadSettings()
    const dbReady = await databaseReachable()

    return {
      dbReady,
      canManage: canManage && dbReady,
      timezones: TIMEZONES,
      environment: env().APP_ENV,
      settings: {
        displayName: settings.displayName,
        timezone: settings.timezone,
        currency: settings.currency,
        staleDataHours: settings.staleDataHours,
        staleQuoteDays: settings.staleQuoteDays,
        largeQuoteAmount: settings.largeQuoteAmount,
      },
    }
  }),
)

/**
 * GET /api/settings/brief/page - Daily Brief schedule and recipients
 * (sections 12 and 17). The exact delivery time and the recipient list
 * require client confirmation, so both are configurable rather than hard-coded.
 */
settingsRouter.get(
  '/brief/page',
  requireAuth(PERMISSIONS.SETTINGS_VIEW),
  handler(async (_req, res): Promise<BriefSettingsPageData> => {
    const user = currentUser(res)
    const canManage = user.permissions.has(PERMISSIONS.SETTINGS_MANAGE)
    const dbReady = await databaseReachable()
    const settings = await loadSettings()

    const [recipients, recentBriefs] = dbReady
      ? await Promise.all([
          db.many<Pick<BriefRecipientRow, 'id' | 'email' | 'name'>>(sql`
            SELECT "id", "email", "name" FROM "BriefRecipient" WHERE "isActive" = true ORDER BY "email" ASC`),
          db.many<{
            id: string
            briefDate: Date
            status: string
            generatedAt: Date | null
            sent: number
            failed: number
            total: number
          }>(sql`
            SELECT b."id", b."briefDate", b."status", b."generatedAt",
                   COUNT(d."id") FILTER (WHERE d."status" IN ('SENT', 'DELIVERED')) AS "sent",
                   COUNT(d."id") FILTER (WHERE d."status" IN ('FAILED', 'BOUNCED')) AS "failed",
                   COUNT(d."id") AS "total"
            FROM "DailyBrief" b
            LEFT JOIN "BriefDelivery" d ON d."dailyBriefId" = b."id"
            GROUP BY b."id"
            ORDER BY b."briefDate" DESC
            LIMIT 10`),
        ])
      : [[], []]

    return {
      dbReady,
      canManage: canManage && dbReady,
      emailConfigured: emailConfigured(),
      emailProvider: env().EMAIL_PROVIDER,
      providerLabel: emailProviderLabel(),
      isConsoleProvider: env().EMAIL_PROVIDER === 'console',
      appUrl: env().APP_URL,
      settings: {
        briefEnabled: settings.briefEnabled,
        briefSendHour: settings.briefSendHour,
        briefSendMinute: settings.briefSendMinute,
        timezone: settings.timezone,
      },
      recipients: recipients.map((r) => ({ id: r.id, email: r.email, name: r.name })),
      recentBriefs: recentBriefs.map((brief) => ({
        id: brief.id,
        briefDate: brief.briefDate.toISOString(),
        status: brief.status,
        generatedAt: brief.generatedAt ? brief.generatedAt.toISOString() : null,
        sent: brief.sent,
        failed: brief.failed,
        total: brief.total,
      })),
    }
  }),
)

/**
 * GET /api/settings/divisions/page - Divisions and their source mappings.
 *
 * A mapping rule decides which division a record is reported under. Getting it
 * wrong moves revenue onto the wrong division, so every change is audited and
 * the page explains that a rule only applies to records imported after it.
 */
settingsRouter.get(
  '/divisions/page',
  requireAuth(PERMISSIONS.SETTINGS_VIEW),
  handler(async (_req, res): Promise<DivisionsSettingsPageData> => {
    const user = currentUser(res)
    const canManage = user.permissions.has(PERMISSIONS.SETTINGS_MANAGE)
    const dbReady = await databaseReachable()

    if (!dbReady) return { dbReady: false }

    const [divisions, rules, unassignedInvoices, unassignedQuotes] = await Promise.all([
      db.many<DivisionRow>(sql`SELECT * FROM "Division" ORDER BY "sortOrder" ASC`),
      db.many<DivisionMappingRuleRow & { divisionName: string; divisionCode: string }>(sql`
        SELECT r.*, d."name" AS "divisionName", d."code" AS "divisionCode"
        FROM "DivisionMappingRule" r
        JOIN "Division" d ON d."id" = r."divisionId"
        WHERE r."isActive" = true
        ORDER BY r."provider" ASC, r."priority" ASC`),
      db.value<number>(sql`
        SELECT COUNT(*) FROM "Invoice"
        WHERE "divisionId" IS NULL AND "status" NOT IN ('DRAFT', 'VOID')`),
      db.value<number>(sql`
        SELECT COUNT(*) FROM "Quote" WHERE "divisionId" IS NULL AND "status" = ${'OPEN'}`),
    ])

    return {
      dbReady: true,
      canManage,
      divisions: divisions.map((d) => ({
        id: d.id,
        code: d.code,
        name: d.name,
        description: d.description,
        isActive: d.isActive,
      })),
      rules: rules.map((rule) => ({
        id: rule.id,
        provider: rule.provider,
        field: rule.field,
        matchType: rule.matchType,
        matchValue: rule.matchValue,
        priority: rule.priority,
        divisionName: rule.divisionName,
        divisionCode: rule.divisionCode,
      })),
      mappableFields: MAPPABLE_FIELDS,
      unassigned: { invoices: unassignedInvoices ?? 0, quotes: unassignedQuotes ?? 0 },
    }
  }),
)

/**
 * GET /api/settings/metrics/page - Metric definitions, cost mappings and
 * approvals (sections 15 and 17).
 *
 * Every formula the platform reports is documented with its source, date
 * basis and exclusions, and carries an explicit approval state. A metric that
 * has not been approved is never presented as verified financial reporting.
 */
settingsRouter.get(
  '/metrics/page',
  requireAuth(PERMISSIONS.SETTINGS_VIEW),
  handler(async (_req, res): Promise<MetricsSettingsPageData> => {
    const user = currentUser(res)
    const canApprove = user.permissions.has(PERMISSIONS.METRICS_APPROVE)
    const canManage = user.permissions.has(PERMISSIONS.SETTINGS_MANAGE)
    const dbReady = await databaseReachable()

    const [stored, cogsAccounts, costPeriods, reconciliations] = dbReady
      ? await Promise.all([
          db.many<MetricDefinitionRow>(sql`SELECT * FROM "MetricDefinition"`),
          db.many<CogsAccountMappingRow>(sql`
            SELECT * FROM "CogsAccountMapping" ORDER BY "includeInCogs" DESC, "accountName" ASC`),
          db.many<{
            id: string
            divisionName: string
            divisionCode: string
            periodStart: Date
            cogsAmount: string
            isApproved: boolean
            approvedBy: string | null
            basis: string
          }>(sql`
            SELECT c."id", d."name" AS "divisionName", d."code" AS "divisionCode", c."periodStart",
                   c."cogsAmount", c."isApproved", c."approvedBy", c."basis"
            FROM "DivisionCost" c
            JOIN "Division" d ON d."id" = c."divisionId"
            ORDER BY c."periodStart" DESC
            LIMIT 24`),
          db.many<{
            id: string
            metricName: string
            periodStart: Date
            platformValue: string
            sourceValue: string
            variance: string
            variancePct: string
            passed: boolean
            performedBy: string | null
          }>(sql`
            SELECT r."id", m."name" AS "metricName", r."periodStart", r."platformValue", r."sourceValue",
                   r."variance", r."variancePct", r."passed", r."performedBy"
            FROM "Reconciliation" r
            JOIN "MetricDefinition" m ON m."id" = r."metricDefinitionId"
            ORDER BY r."periodStart" DESC
            LIMIT 12`),
        ])
      : [[], [], [], []]

    const storedByKey = new Map(stored.map((s) => [s.key, s]))

    return {
      dbReady,
      canApprove: canApprove && dbReady,
      canManage: canManage && dbReady,
      definitions: METRIC_DEFINITIONS.map((spec) => {
        const row = storedByKey.get(spec.key)
        return {
          key: spec.key,
          name: spec.name,
          shortDescription: spec.shortDescription,
          formula: spec.formula,
          sourceSystems: spec.sourceSystems,
          dateBasis: spec.dateBasis,
          includedRecords: spec.includedRecords,
          excludedRecords: spec.excludedRecords,
          currencyHandling: spec.currencyHandling,
          divisionMapping: spec.divisionMapping,
          notes: spec.notes ?? null,
          approver: spec.approver,
          approvalStatus: row?.approvalStatus ?? spec.defaultApproval,
          approvedBy: row?.approvedBy ?? null,
          approvedAt: row?.approvedAt ? row.approvedAt.toISOString() : null,
        }
      }),
      cogsAccounts: cogsAccounts.map((account) => ({
        id: account.id,
        sourceAccountId: account.sourceAccountId,
        accountName: account.accountName,
        accountType: account.accountType,
        includeInCogs: account.includeInCogs,
        note: account.note,
      })),
      costPeriods: costPeriods.map((period) => ({
        id: period.id,
        divisionName: period.divisionName,
        divisionCode: period.divisionCode,
        periodStart: period.periodStart.toISOString(),
        cogsAmount: toNumber(period.cogsAmount),
        isApproved: period.isApproved,
        approvedBy: period.approvedBy,
        basis: period.basis,
      })),
      reconciliations: reconciliations.map((rec) => ({
        id: rec.id,
        metricName: rec.metricName,
        periodStart: rec.periodStart.toISOString(),
        platformValue: toNumber(rec.platformValue),
        sourceValue: toNumber(rec.sourceValue),
        variance: toNumber(rec.variance),
        variancePct: toNumber(rec.variancePct),
        passed: rec.passed,
        performedBy: rec.performedBy,
      })),
    }
  }),
)

/**
 * GET /api/settings/integrations/page - Integration status (section 17).
 *
 * Returns WHETHER a credential exists and whether it works. It never returns
 * the credential itself: no access token, API key or webhook secret leaves
 * this handler.
 */
settingsRouter.get(
  '/integrations/page',
  requireAuth(PERMISSIONS.SETTINGS_VIEW),
  handler(async (_req, res): Promise<IntegrationsSettingsPageData> => {
    const user = currentUser(res)
    const canManage = user.permissions.has(PERMISSIONS.SETTINGS_MANAGE)
    const dbReady = await databaseReachable()

    const rows = dbReady
      ? await db.many<
          Pick<
            IntegrationRow,
            'provider' | 'status' | 'isEnabled' | 'lastSuccessAt' | 'syncIntervalMin' | 'historyMonths' | 'lastErrorMessage'
          > & { credentialStored: boolean }
        >(sql`
          SELECT "provider", "status", "isEnabled", ("credentials" IS NOT NULL) AS "credentialStored",
                 "lastSuccessAt", "syncIntervalMin", "historyMonths", "lastErrorMessage"
          FROM "Integration"
          ORDER BY "provider" ASC`)
      : []

    const qbo = integrationEnv.quickbooks()
    const method = integrationEnv.method()
    const shopify = integrationEnv.shopify()
    const monday = integrationEnv.monday()

    const providers = [
      {
        provider: 'QUICKBOOKS' as const,
        name: 'QuickBooks Online',
        what: 'Invoices, payments, customers and the chart of accounts. The source of revenue, receivables and cost of goods sold.',
        auth: 'OAuth 2.0. Connect through Intuit; the access token refreshes automatically and the rotated refresh token is stored encrypted.',
        envVars: ['QBO_CLIENT_ID', 'QBO_CLIENT_SECRET', 'QBO_ENVIRONMENT'],
        envReady: qbo.configured,
        docsUrl: 'https://developer.intuit.com',
        connectUrl: '/api/integrations/quickbooks/connect' as string | null,
        extra: `Environment: ${env().QBO_ENVIRONMENT}. Redirect URI must be ${env().APP_URL}/api/integrations/quickbooks/callback`,
      },
      {
        provider: 'METHOD_CRM' as const,
        name: 'Method CRM',
        what: 'Estimates and customers. The source of the sales pipeline, quote aging and win rate.',
        auth: 'API key, sent in an Authorization header. Stored encrypted.',
        envVars: ['METHOD_API_KEY', 'METHOD_API_BASE_URL'],
        envReady: method.configured,
        docsUrl: 'https://www.method.me/api/',
        connectUrl: null,
        extra:
          'Method tables are configurable per account, so the Estimate and Customer field names must be confirmed against the MetroLED account before go-live.',
      },
      {
        provider: 'SHOPIFY' as const,
        name: 'Shopify — Eco LED Mart',
        what: 'Orders, line items, refunds and customers. The source of e-commerce sales.',
        auth: 'Custom app Admin API access token, plus a webhook signing secret for near-real-time order updates. Both stored encrypted.',
        envVars: ['SHOPIFY_SHOP_DOMAIN', 'SHOPIFY_ADMIN_ACCESS_TOKEN', 'SHOPIFY_API_VERSION', 'SHOPIFY_WEBHOOK_SECRET'],
        envReady: shopify.configured,
        docsUrl: 'https://shopify.dev/docs/api/admin-rest',
        connectUrl: null,
        extra: `API version ${shopify.apiVersion}. Webhook endpoint: ${env().APP_URL}/api/webhooks/shopify (topics: orders/create, orders/updated, orders/cancelled, orders/paid, refunds/create)`,
      },
    ]

    return {
      dbReady,
      canManage,
      encryptionConfigured: credentialEncryptionConfigured(),
      mondayEnabled: monday.enabled,
      providers: providers.map((definition) => {
        const row = rows.find((r) => r.provider === definition.provider)
        return {
          ...definition,
          row: row
            ? {
                status: row.status,
                isEnabled: row.isEnabled,
                credentialStored: row.credentialStored,
                lastSuccessAt: row.lastSuccessAt ? row.lastSuccessAt.toISOString() : null,
                syncIntervalMin: row.syncIntervalMin,
                historyMonths: row.historyMonths,
                lastErrorMessage: row.lastErrorMessage,
              }
            : null,
        }
      }),
    }
  }),
)

// ===========================================================================
// Company settings - PUT /api/settings/company
// ===========================================================================

const companySchema = z.object({
  displayName: z.string().trim().min(1, 'Enter the company name.').max(120),
  timezone: z.string().trim().min(1).max(64),
  currency: z.string().trim().length(3, 'Use a three-letter currency code, such as CAD.').toUpperCase(),
  staleDataHours: z.coerce.number().int().min(1).max(168),
  staleQuoteDays: z.coerce.number().int().min(1).max(365),
  largeQuoteAmount: z.coerce.number().min(0).max(100_000_000),
})

settingsRouter.put(
  '/company',
  handler(async (req): Promise<SettingsResult> => {
    const auth = await requireSettingsManager()
    if (!auth.ok) return auth.result
    const b = body(req)

    const parsed = companySchema.safeParse({
      displayName: field(b, 'displayName'),
      timezone: field(b, 'timezone'),
      currency: field(b, 'currency'),
      staleDataHours: field(b, 'staleDataHours'),
      staleQuoteDays: field(b, 'staleQuoteDays'),
      largeQuoteAmount: field(b, 'largeQuoteAmount'),
    })
    if (!parsed.success) {
      return { ok: false, message: parsed.error.issues[0]?.message ?? 'Check the values and try again.' }
    }

    // An unknown timezone would silently shift every reporting period.
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: parsed.data.timezone })
    } catch {
      return { ok: false, message: `"${parsed.data.timezone}" is not a timezone this system recognises.` }
    }

    const previous = await db.maybeOne<CompanySettingRow>(sql`SELECT * FROM "CompanySetting" WHERE "id" = ${'company'}`)

    await upsert('CompanySetting', ['id'], { id: 'company', ...parsed.data, updatedBy: auth.user.email })

    await recordAudit({
      action: AUDIT_ACTIONS.SETTINGS_UPDATED,
      summary: `${auth.user.name} updated the company settings.`,
      actor: auth.user,
      entityType: 'CompanySetting',
      entityId: 'company',
      metadata: {
        from: previous
          ? {
              timezone: previous.timezone,
              staleQuoteDays: previous.staleQuoteDays,
              // NUMERIC is read as a string; Prisma's Decimal#toString() never had trailing zeros.
              largeQuoteAmount: String(toNumber(previous.largeQuoteAmount)),
            }
          : null,
        to: parsed.data,
      },
    })

    return { ok: true, message: 'Company settings saved. Every page picks up the change on its next load.' }
  }),
)

// ===========================================================================
// Daily brief schedule and recipients
// ===========================================================================

const briefSchema = z.object({
  briefEnabled: z.coerce.boolean(),
  briefSendHour: z.coerce.number().int().min(0).max(23),
  briefSendMinute: z.coerce.number().int().min(0).max(59),
})

/** PUT /api/settings/brief/schedule */
settingsRouter.put(
  '/brief/schedule',
  handler(async (req): Promise<SettingsResult> => {
    const auth = await requireSettingsManager()
    if (!auth.ok) return auth.result
    const b = body(req)

    const parsed = briefSchema.safeParse({
      briefEnabled: field(b, 'briefEnabled') === 'on' || isTrue(field(b, 'briefEnabled')),
      briefSendHour: field(b, 'briefSendHour'),
      briefSendMinute: field(b, 'briefSendMinute'),
    })
    if (!parsed.success) {
      return { ok: false, message: 'Choose a valid send time.' }
    }

    await upsert('CompanySetting', ['id'], { id: 'company', ...parsed.data, updatedBy: auth.user.email })

    await recordAudit({
      action: AUDIT_ACTIONS.SETTINGS_UPDATED,
      summary: `${auth.user.name} ${parsed.data.briefEnabled ? 'enabled' : 'disabled'} the daily brief, scheduled for ${String(parsed.data.briefSendHour).padStart(2, '0')}:${String(parsed.data.briefSendMinute).padStart(2, '0')}.`,
      actor: auth.user,
      entityType: 'CompanySetting',
      entityId: 'company',
      metadata: parsed.data,
    })

    return {
      ok: true,
      message: parsed.data.briefEnabled
        ? 'Daily brief schedule saved. The scheduler must be configured to call /api/cron/brief at this time.'
        : 'Automatic sending of the daily brief is now turned off.',
    }
  }),
)

const recipientSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address.').max(320),
  name: z.string().trim().max(120).optional(),
})

/** POST /api/settings/brief/recipients */
settingsRouter.post(
  '/brief/recipients',
  handler(async (req): Promise<SettingsResult> => {
    const auth = await requireSettingsManager()
    if (!auth.ok) return auth.result
    const b = body(req)

    const parsed = recipientSchema.safeParse({
      email: field(b, 'email'),
      name: field(b, 'name') || undefined,
    })
    if (!parsed.success) {
      return { ok: false, message: parsed.error.issues[0]?.message ?? 'Enter a valid email address.' }
    }

    const existing = await db.maybeOne<BriefRecipientRow>(
      sql`SELECT * FROM "BriefRecipient" WHERE "email" = ${parsed.data.email}`,
    )
    if (existing) {
      if (existing.isActive) {
        return { ok: false, message: `${parsed.data.email} already receives the daily brief.` }
      }
      await db.exec(sql`UPDATE "BriefRecipient" SET "isActive" = true WHERE "id" = ${existing.id}`)
    } else {
      await insert('BriefRecipient', { email: parsed.data.email, name: parsed.data.name ?? null })
    }

    await recordAudit({
      action: AUDIT_ACTIONS.BRIEF_RECIPIENTS_CHANGED,
      summary: `${auth.user.name} added ${parsed.data.email} to the daily brief recipients.`,
      actor: auth.user,
      entityType: 'BriefRecipient',
      metadata: { email: parsed.data.email },
    })

    return { ok: true, message: `${parsed.data.email} will receive the daily brief.` }
  }),
)

/** DELETE /api/settings/brief/recipients/:recipientId */
settingsRouter.delete(
  '/brief/recipients/:recipientId',
  handler(async (req): Promise<SettingsResult> => {
    const auth = await requireSettingsManager()
    if (!auth.ok) return auth.result

    const id = String(req.params.recipientId ?? '')
    const recipient = await db.maybeOne<BriefRecipientRow>(sql`SELECT * FROM "BriefRecipient" WHERE "id" = ${id}`)
    if (!recipient) return { ok: false, message: 'That recipient no longer exists.' }

    // Deactivated rather than deleted, so the historical delivery records stay
    // meaningful and the acceptance evidence is preserved.
    await db.exec(sql`UPDATE "BriefRecipient" SET "isActive" = false WHERE "id" = ${id}`)

    await recordAudit({
      action: AUDIT_ACTIONS.BRIEF_RECIPIENTS_CHANGED,
      summary: `${auth.user.name} removed ${recipient.email} from the daily brief recipients.`,
      actor: auth.user,
      entityType: 'BriefRecipient',
      entityId: id,
      metadata: { email: recipient.email },
    })

    return { ok: true, message: `${recipient.email} no longer receives the daily brief.` }
  }),
)

// ===========================================================================
// Divisions and mapping rules
// ===========================================================================

const divisionSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .min(2, 'Use a short code of at least two characters.')
    .max(24)
    .regex(/^[A-Z0-9_]+$/, 'Use capital letters, numbers and underscores only.'),
  name: z.string().trim().min(2, 'Enter the division name.').max(120),
  description: z.string().trim().max(500).optional(),
})

/** POST /api/settings/divisions */
settingsRouter.post(
  '/divisions',
  handler(async (req): Promise<SettingsResult> => {
    const auth = await requireSettingsManager()
    if (!auth.ok) return auth.result
    const b = body(req)

    const parsed = divisionSchema.safeParse({
      code: field(b, 'code'),
      name: field(b, 'name'),
      description: field(b, 'description') || undefined,
    })
    if (!parsed.success) {
      return { ok: false, message: parsed.error.issues[0]?.message ?? 'Check the division details.' }
    }

    const existing = await db.maybeOne(sql`SELECT "id" FROM "Division" WHERE "code" = ${parsed.data.code}`)
    if (existing) return { ok: false, message: `A division with the code ${parsed.data.code} already exists.` }

    const count = (await db.value<number>(sql`SELECT COUNT(*) FROM "Division"`)) ?? 0
    const division = await insert<DivisionRow>('Division', {
      ...parsed.data,
      description: parsed.data.description ?? null,
      sortOrder: count + 1,
    })

    await recordAudit({
      action: AUDIT_ACTIONS.DIVISION_CREATED,
      summary: `${auth.user.name} created the division "${parsed.data.name}" (${parsed.data.code}).`,
      actor: auth.user,
      entityType: 'Division',
      entityId: division.id,
      metadata: parsed.data,
    })

    return { ok: true, message: `Division "${parsed.data.name}" created.` }
  }),
)

const ruleSchema = z.object({
  provider: z.enum(['QUICKBOOKS', 'METHOD_CRM', 'SHOPIFY', 'MONDAY']),
  field: z.string().trim().min(1, 'Choose a field to match on.').max(60),
  matchType: z.enum(['equals', 'contains', 'starts_with', 'ends_with', 'regex']),
  matchValue: z.string().trim().min(1, 'Enter the value to match.').max(200),
  divisionId: z.string().min(1, 'Choose the division to assign.'),
  priority: z.coerce.number().int().min(1).max(10_000).default(100),
})

/** POST /api/settings/mapping-rules */
settingsRouter.post(
  '/mapping-rules',
  handler(async (req): Promise<SettingsResult> => {
    const auth = await requireSettingsManager()
    if (!auth.ok) return auth.result
    const b = body(req)

    const parsed = ruleSchema.safeParse({
      provider: field(b, 'provider'),
      field: field(b, 'field'),
      matchType: field(b, 'matchType'),
      matchValue: field(b, 'matchValue'),
      divisionId: field(b, 'divisionId'),
      priority: field(b, 'priority') || 100,
    })
    if (!parsed.success) {
      return { ok: false, message: parsed.error.issues[0]?.message ?? 'Check the rule details.' }
    }

    // A bad regular expression would silently match nothing, so it is validated
    // before it can be saved.
    if (parsed.data.matchType === 'regex') {
      try {
        new RegExp(parsed.data.matchValue)
      } catch {
        return { ok: false, message: 'That is not a valid regular expression.' }
      }
    }

    const division = await db.maybeOne<DivisionRow>(sql`SELECT * FROM "Division" WHERE "id" = ${parsed.data.divisionId}`)
    if (!division) return { ok: false, message: 'That division no longer exists.' }

    const rule = await insert<DivisionMappingRuleRow>('DivisionMappingRule', {
      ...parsed.data,
      createdBy: auth.user.email,
    })

    await recordAudit({
      action: AUDIT_ACTIONS.MAPPING_RULE_CHANGED,
      summary: `${auth.user.name} added a division mapping rule: ${parsed.data.provider} ${parsed.data.field} ${parsed.data.matchType} "${parsed.data.matchValue}" to ${division.name}.`,
      actor: auth.user,
      entityType: 'DivisionMappingRule',
      entityId: rule.id,
      metadata: { ...parsed.data, divisionName: division.name },
    })

    return {
      ok: true,
      message: `Rule saved. It applies to records imported from the next sync onward; run a backfill to re-apply it to existing records.`,
    }
  }),
)

/** DELETE /api/settings/mapping-rules/:ruleId */
settingsRouter.delete(
  '/mapping-rules/:ruleId',
  handler(async (req): Promise<SettingsResult> => {
    const auth = await requireSettingsManager()
    if (!auth.ok) return auth.result

    const id = String(req.params.ruleId ?? '')
    const rule = await db.maybeOne<DivisionMappingRuleRow & { divisionName: string }>(sql`
      SELECT r.*, d."name" AS "divisionName"
      FROM "DivisionMappingRule" r JOIN "Division" d ON d."id" = r."divisionId"
      WHERE r."id" = ${id}`)
    if (!rule) return { ok: false, message: 'That rule no longer exists.' }

    await db.exec(sql`DELETE FROM "DivisionMappingRule" WHERE "id" = ${id}`)

    await recordAudit({
      action: AUDIT_ACTIONS.MAPPING_RULE_CHANGED,
      summary: `${auth.user.name} deleted the division mapping rule ${rule.provider} ${rule.field} ${rule.matchType} "${rule.matchValue}" to ${rule.divisionName}.`,
      actor: auth.user,
      entityType: 'DivisionMappingRule',
      entityId: id,
    })

    return { ok: true, message: 'Rule deleted. Existing records keep their current division until the next backfill.' }
  }),
)

// ===========================================================================
// Cost mappings and metric approvals
// ===========================================================================

/** PUT /api/settings/cogs-accounts/:mappingId */
settingsRouter.put(
  '/cogs-accounts/:mappingId',
  handler(async (req): Promise<SettingsResult> => {
    const auth = await requireSettingsManager()
    if (!auth.ok) return auth.result

    const id = String(req.params.mappingId ?? '')
    const include = isTrue(field(body(req), 'includeInCogs'))

    const mapping = await db.maybeOne<CogsAccountMappingRow>(sql`SELECT * FROM "CogsAccountMapping" WHERE "id" = ${id}`)
    if (!mapping) return { ok: false, message: 'That account no longer exists.' }

    await db.exec(sql`UPDATE "CogsAccountMapping" SET "includeInCogs" = ${include} WHERE "id" = ${id}`)

    await recordAudit({
      action: AUDIT_ACTIONS.COGS_MAPPING_CHANGED,
      summary: `${auth.user.name} ${include ? 'included' : 'excluded'} the account "${mapping.accountName}" ${include ? 'in' : 'from'} cost of goods sold.`,
      actor: auth.user,
      entityType: 'CogsAccountMapping',
      entityId: id,
      metadata: { accountName: mapping.accountName, accountType: mapping.accountType, includeInCogs: include },
    })

    return {
      ok: true,
      message: `"${mapping.accountName}" is now ${include ? 'included in' : 'excluded from'} cost of goods sold. Gross margin changes from the next recalculation.`,
    }
  }),
)

/** POST /api/settings/metrics/:metricKey/approval */
settingsRouter.post(
  '/metrics/:metricKey/approval',
  handler(async (req): Promise<SettingsResult> => {
    const user = await getSession()
    if (!user) return { ok: false, message: 'Your session has expired. Sign in and try again.' }
    if (!user.permissions.has(PERMISSIONS.METRICS_APPROVE)) {
      return { ok: false, message: 'Your role does not include approving metric definitions.' }
    }
    if (user.isDemo) {
      return { ok: false, message: 'A demo session cannot approve a metric definition.' }
    }
    if (!(await databaseReachable())) {
      return { ok: false, message: 'The database is unreachable, so the approval cannot be recorded.' }
    }

    const b = body(req)
    const key = String(req.params.metricKey ?? '')
    const approve = isTrue(field(b, 'approve'))
    const note = String(field(b, 'note') ?? '').trim()

    const spec = METRIC_DEFINITIONS.find((d) => d.key === key)
    if (!spec) return { ok: false, message: 'Unknown metric.' }

    const status = approve ? 'APPROVED' : 'REJECTED'
    const now = new Date()
    await upsert(
      'MetricDefinition',
      ['key'],
      {
        key: spec.key,
        name: spec.name,
        shortDescription: spec.shortDescription,
        formula: spec.formula,
        sourceSystems: spec.sourceSystems,
        dateBasis: spec.dateBasis,
        includedRecords: spec.includedRecords,
        excludedRecords: spec.excludedRecords,
        currencyHandling: spec.currencyHandling,
        divisionMapping: spec.divisionMapping,
        approvalStatus: status,
        approvedBy: user.email,
        approvedAt: now,
        notes: note || spec.notes || null,
      },
      {
        approvalStatus: status,
        approvedBy: user.email,
        approvedAt: now,
        // An empty note leaves the stored note unchanged.
        notes: note || undefined,
      },
    )

    await recordAudit({
      action: approve ? AUDIT_ACTIONS.METRIC_APPROVED : AUDIT_ACTIONS.METRIC_REJECTED,
      summary: `${user.name} ${approve ? 'approved' : 'rejected'} the definition of "${spec.name}".`,
      actor: user,
      entityType: 'MetricDefinition',
      entityId: key,
      metadata: { formula: spec.formula, note: note || null },
    })

    return {
      ok: true,
      message: approve
        ? `"${spec.name}" is approved. Figures using it are now reported as verified.`
        : `"${spec.name}" is marked as rejected and will continue to be reported as unverified.`,
    }
  }),
)
