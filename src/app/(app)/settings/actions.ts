'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { prisma, databaseReachable } from '@/lib/db'
import { PERMISSIONS } from '@/lib/auth/permissions'
import { getSession } from '@/lib/auth/session'
import { AUDIT_ACTIONS, recordAudit } from '@/lib/auth/audit'
import { METRIC_DEFINITIONS } from '@/lib/metrics/definitions'

/**
 * Settings server actions.
 *
 * Sensitive changes - division mappings, cost classifications and metric
 * approvals - are restricted to administrators and are all written to the
 * audit log, because each one silently changes what every reported figure
 * means.
 */

export interface SettingsResult {
  ok: boolean
  message: string
}

async function requireSettingsManager(): Promise<
  { ok: true; user: NonNullable<Awaited<ReturnType<typeof getSession>>> } | { ok: false; result: SettingsResult }
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

// ---------------------------------------------------------------------------
// Company settings
// ---------------------------------------------------------------------------

const companySchema = z.object({
  displayName: z.string().trim().min(1, 'Enter the company name.').max(120),
  timezone: z.string().trim().min(1).max(64),
  currency: z.string().trim().length(3, 'Use a three-letter currency code, such as CAD.').toUpperCase(),
  staleDataHours: z.coerce.number().int().min(1).max(168),
  staleQuoteDays: z.coerce.number().int().min(1).max(365),
  largeQuoteAmount: z.coerce.number().min(0).max(100_000_000),
})

export async function updateCompanySettings(formData: FormData): Promise<SettingsResult> {
  const auth = await requireSettingsManager()
  if (!auth.ok) return auth.result

  const parsed = companySchema.safeParse({
    displayName: formData.get('displayName'),
    timezone: formData.get('timezone'),
    currency: formData.get('currency'),
    staleDataHours: formData.get('staleDataHours'),
    staleQuoteDays: formData.get('staleQuoteDays'),
    largeQuoteAmount: formData.get('largeQuoteAmount'),
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

  const previous = await prisma.companySetting.findUnique({ where: { id: 'company' } })

  await prisma.companySetting.upsert({
    where: { id: 'company' },
    create: { id: 'company', ...parsed.data, updatedBy: auth.user.email },
    update: { ...parsed.data, updatedBy: auth.user.email },
  })

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
            largeQuoteAmount: previous.largeQuoteAmount.toString(),
          }
        : null,
      to: parsed.data,
    },
  })

  revalidatePath('/settings')
  revalidatePath('/overview')
  return { ok: true, message: 'Company settings saved. Every page picks up the change on its next load.' }
}

// ---------------------------------------------------------------------------
// Daily brief schedule and recipients
// ---------------------------------------------------------------------------

const briefSchema = z.object({
  briefEnabled: z.coerce.boolean(),
  briefSendHour: z.coerce.number().int().min(0).max(23),
  briefSendMinute: z.coerce.number().int().min(0).max(59),
})

export async function updateBriefSchedule(formData: FormData): Promise<SettingsResult> {
  const auth = await requireSettingsManager()
  if (!auth.ok) return auth.result

  const parsed = briefSchema.safeParse({
    briefEnabled: formData.get('briefEnabled') === 'on' || formData.get('briefEnabled') === 'true',
    briefSendHour: formData.get('briefSendHour'),
    briefSendMinute: formData.get('briefSendMinute'),
  })
  if (!parsed.success) {
    return { ok: false, message: 'Choose a valid send time.' }
  }

  await prisma.companySetting.upsert({
    where: { id: 'company' },
    create: { id: 'company', ...parsed.data, updatedBy: auth.user.email },
    update: { ...parsed.data, updatedBy: auth.user.email },
  })

  await recordAudit({
    action: AUDIT_ACTIONS.SETTINGS_UPDATED,
    summary: `${auth.user.name} ${parsed.data.briefEnabled ? 'enabled' : 'disabled'} the daily brief, scheduled for ${String(parsed.data.briefSendHour).padStart(2, '0')}:${String(parsed.data.briefSendMinute).padStart(2, '0')}.`,
    actor: auth.user,
    entityType: 'CompanySetting',
    entityId: 'company',
    metadata: parsed.data,
  })

  revalidatePath('/settings/brief')
  revalidatePath('/daily-brief')
  return {
    ok: true,
    message: parsed.data.briefEnabled
      ? 'Daily brief schedule saved. The scheduler must be configured to call /api/cron/brief at this time.'
      : 'Automatic sending of the daily brief is now turned off.',
  }
}

const recipientSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address.').max(320),
  name: z.string().trim().max(120).optional(),
})

export async function addBriefRecipient(formData: FormData): Promise<SettingsResult> {
  const auth = await requireSettingsManager()
  if (!auth.ok) return auth.result

  const parsed = recipientSchema.safeParse({
    email: formData.get('email'),
    name: formData.get('name') || undefined,
  })
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Enter a valid email address.' }
  }

  const existing = await prisma.briefRecipient.findUnique({ where: { email: parsed.data.email } })
  if (existing) {
    if (existing.isActive) {
      return { ok: false, message: `${parsed.data.email} already receives the daily brief.` }
    }
    await prisma.briefRecipient.update({ where: { id: existing.id }, data: { isActive: true } })
  } else {
    await prisma.briefRecipient.create({
      data: { email: parsed.data.email, name: parsed.data.name ?? null },
    })
  }

  await recordAudit({
    action: AUDIT_ACTIONS.BRIEF_RECIPIENTS_CHANGED,
    summary: `${auth.user.name} added ${parsed.data.email} to the daily brief recipients.`,
    actor: auth.user,
    entityType: 'BriefRecipient',
    metadata: { email: parsed.data.email },
  })

  revalidatePath('/settings/brief')
  return { ok: true, message: `${parsed.data.email} will receive the daily brief.` }
}

export async function removeBriefRecipient(formData: FormData): Promise<SettingsResult> {
  const auth = await requireSettingsManager()
  if (!auth.ok) return auth.result

  const id = String(formData.get('recipientId') ?? '')
  const recipient = await prisma.briefRecipient.findUnique({ where: { id } })
  if (!recipient) return { ok: false, message: 'That recipient no longer exists.' }

  // Deactivated rather than deleted, so the historical delivery records stay
  // meaningful and the acceptance evidence is preserved.
  await prisma.briefRecipient.update({ where: { id }, data: { isActive: false } })

  await recordAudit({
    action: AUDIT_ACTIONS.BRIEF_RECIPIENTS_CHANGED,
    summary: `${auth.user.name} removed ${recipient.email} from the daily brief recipients.`,
    actor: auth.user,
    entityType: 'BriefRecipient',
    entityId: id,
    metadata: { email: recipient.email },
  })

  revalidatePath('/settings/brief')
  return { ok: true, message: `${recipient.email} no longer receives the daily brief.` }
}

// ---------------------------------------------------------------------------
// Divisions and mapping rules
// ---------------------------------------------------------------------------

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

export async function createDivision(formData: FormData): Promise<SettingsResult> {
  const auth = await requireSettingsManager()
  if (!auth.ok) return auth.result

  const parsed = divisionSchema.safeParse({
    code: formData.get('code'),
    name: formData.get('name'),
    description: formData.get('description') || undefined,
  })
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Check the division details.' }
  }

  const existing = await prisma.division.findUnique({ where: { code: parsed.data.code } })
  if (existing) return { ok: false, message: `A division with the code ${parsed.data.code} already exists.` }

  const count = await prisma.division.count()
  const division = await prisma.division.create({
    data: { ...parsed.data, description: parsed.data.description ?? null, sortOrder: count + 1 },
    select: { id: true },
  })

  await recordAudit({
    action: AUDIT_ACTIONS.DIVISION_CREATED,
    summary: `${auth.user.name} created the division "${parsed.data.name}" (${parsed.data.code}).`,
    actor: auth.user,
    entityType: 'Division',
    entityId: division.id,
    metadata: parsed.data,
  })

  revalidatePath('/settings/divisions')
  return { ok: true, message: `Division "${parsed.data.name}" created.` }
}

const ruleSchema = z.object({
  provider: z.enum(['QUICKBOOKS', 'METHOD_CRM', 'SHOPIFY', 'MONDAY']),
  field: z.string().trim().min(1, 'Choose a field to match on.').max(60),
  matchType: z.enum(['equals', 'contains', 'starts_with', 'ends_with', 'regex']),
  matchValue: z.string().trim().min(1, 'Enter the value to match.').max(200),
  divisionId: z.string().min(1, 'Choose the division to assign.'),
  priority: z.coerce.number().int().min(1).max(10_000).default(100),
})

export async function createMappingRule(formData: FormData): Promise<SettingsResult> {
  const auth = await requireSettingsManager()
  if (!auth.ok) return auth.result

  const parsed = ruleSchema.safeParse({
    provider: formData.get('provider'),
    field: formData.get('field'),
    matchType: formData.get('matchType'),
    matchValue: formData.get('matchValue'),
    divisionId: formData.get('divisionId'),
    priority: formData.get('priority') || 100,
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

  const division = await prisma.division.findUnique({ where: { id: parsed.data.divisionId } })
  if (!division) return { ok: false, message: 'That division no longer exists.' }

  const rule = await prisma.divisionMappingRule.create({
    data: { ...parsed.data, createdBy: auth.user.email },
    select: { id: true },
  })

  await recordAudit({
    action: AUDIT_ACTIONS.MAPPING_RULE_CHANGED,
    summary: `${auth.user.name} added a division mapping rule: ${parsed.data.provider} ${parsed.data.field} ${parsed.data.matchType} "${parsed.data.matchValue}" to ${division.name}.`,
    actor: auth.user,
    entityType: 'DivisionMappingRule',
    entityId: rule.id,
    metadata: { ...parsed.data, divisionName: division.name },
  })

  revalidatePath('/settings/divisions')
  return {
    ok: true,
    message: `Rule saved. It applies to records imported from the next sync onward; run a backfill to re-apply it to existing records.`,
  }
}

export async function deleteMappingRule(formData: FormData): Promise<SettingsResult> {
  const auth = await requireSettingsManager()
  if (!auth.ok) return auth.result

  const id = String(formData.get('ruleId') ?? '')
  const rule = await prisma.divisionMappingRule.findUnique({
    where: { id },
    include: { division: { select: { name: true } } },
  })
  if (!rule) return { ok: false, message: 'That rule no longer exists.' }

  await prisma.divisionMappingRule.delete({ where: { id } })

  await recordAudit({
    action: AUDIT_ACTIONS.MAPPING_RULE_CHANGED,
    summary: `${auth.user.name} deleted the division mapping rule ${rule.provider} ${rule.field} ${rule.matchType} "${rule.matchValue}" to ${rule.division.name}.`,
    actor: auth.user,
    entityType: 'DivisionMappingRule',
    entityId: id,
  })

  revalidatePath('/settings/divisions')
  return { ok: true, message: 'Rule deleted. Existing records keep their current division until the next backfill.' }
}

// ---------------------------------------------------------------------------
// Cost mappings and metric approvals
// ---------------------------------------------------------------------------

export async function setCogsAccountIncluded(formData: FormData): Promise<SettingsResult> {
  const auth = await requireSettingsManager()
  if (!auth.ok) return auth.result

  const id = String(formData.get('mappingId') ?? '')
  const include = formData.get('includeInCogs') === 'true'

  const mapping = await prisma.cogsAccountMapping.findUnique({ where: { id } })
  if (!mapping) return { ok: false, message: 'That account no longer exists.' }

  await prisma.cogsAccountMapping.update({ where: { id }, data: { includeInCogs: include } })

  await recordAudit({
    action: AUDIT_ACTIONS.COGS_MAPPING_CHANGED,
    summary: `${auth.user.name} ${include ? 'included' : 'excluded'} the account "${mapping.accountName}" ${include ? 'in' : 'from'} cost of goods sold.`,
    actor: auth.user,
    entityType: 'CogsAccountMapping',
    entityId: id,
    metadata: { accountName: mapping.accountName, accountType: mapping.accountType, includeInCogs: include },
  })

  revalidatePath('/settings/metrics')
  revalidatePath('/gross-margin')
  return {
    ok: true,
    message: `"${mapping.accountName}" is now ${include ? 'included in' : 'excluded from'} cost of goods sold. Gross margin changes from the next recalculation.`,
  }
}

export async function approveMetricDefinition(formData: FormData): Promise<SettingsResult> {
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

  const key = String(formData.get('metricKey') ?? '')
  const approve = formData.get('approve') === 'true'
  const note = String(formData.get('note') ?? '').trim()

  const spec = METRIC_DEFINITIONS.find((d) => d.key === key)
  if (!spec) return { ok: false, message: 'Unknown metric.' }

  await prisma.metricDefinition.upsert({
    where: { key },
    create: {
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
      approvalStatus: approve ? 'APPROVED' : 'REJECTED',
      approvedBy: user.email,
      approvedAt: new Date(),
      notes: note || spec.notes || null,
    },
    update: {
      approvalStatus: approve ? 'APPROVED' : 'REJECTED',
      approvedBy: user.email,
      approvedAt: new Date(),
      notes: note || undefined,
    },
  })

  await recordAudit({
    action: approve ? AUDIT_ACTIONS.METRIC_APPROVED : AUDIT_ACTIONS.METRIC_REJECTED,
    summary: `${user.name} ${approve ? 'approved' : 'rejected'} the definition of "${spec.name}".`,
    actor: user,
    entityType: 'MetricDefinition',
    entityId: key,
    metadata: { formula: spec.formula, note: note || null },
  })

  revalidatePath('/settings/metrics')
  revalidatePath('/gross-margin')
  return {
    ok: true,
    message: approve
      ? `"${spec.name}" is approved. Figures using it are now reported as verified.`
      : `"${spec.name}" is marked as rejected and will continue to be reported as unverified.`,
  }
}
