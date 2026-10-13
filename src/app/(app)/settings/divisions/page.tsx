import type { Metadata } from 'next'
import { PERMISSIONS } from '@/lib/auth/permissions'
import { requirePermission } from '@/lib/auth/guards'
import { prisma, databaseReachable } from '@/lib/db'
import { MAPPABLE_FIELDS } from '@/lib/integrations/division-mapping'
import { Alert } from '@/components/ui/feedback'
import { DivisionSettings } from './division-settings'

export const metadata: Metadata = { title: 'Divisions & mappings' }

/**
 * Divisions and their source mappings (section 17).
 *
 * A mapping rule decides which division a record is reported under. Getting it
 * wrong moves revenue onto the wrong division, so every change is audited and
 * the page explains that a rule only applies to records imported after it.
 */
export default async function DivisionsSettingsPage() {
  const user = await requirePermission(PERMISSIONS.SETTINGS_VIEW, '/settings/divisions')
  const canManage = user.permissions.has(PERMISSIONS.SETTINGS_MANAGE)
  const dbReady = await databaseReachable()

  if (!dbReady) {
    return (
      <Alert tone="negative" title="The reporting database is not reachable">
        Divisions and mapping rules are stored in the database. Set{' '}
        <code className="font-mono text-[12px]">DATABASE_URL</code> and run{' '}
        <code className="font-mono text-[12px]">npm run db:deploy</code>.
      </Alert>
    )
  }

  const [divisions, rules, unassignedInvoices, unassignedQuotes] = await Promise.all([
    prisma.division.findMany({ orderBy: { sortOrder: 'asc' } }),
    prisma.divisionMappingRule.findMany({
      where: { isActive: true },
      include: { division: { select: { name: true, code: true } } },
      orderBy: [{ provider: 'asc' }, { priority: 'asc' }],
    }),
    prisma.invoice.count({ where: { divisionId: null, status: { notIn: ['DRAFT', 'VOID'] } } }),
    prisma.quote.count({ where: { divisionId: null, status: 'OPEN' } }),
  ])

  return (
    <DivisionSettings
      canManage={canManage}
      divisions={divisions.map((d) => ({
        id: d.id,
        code: d.code,
        name: d.name,
        description: d.description,
        isActive: d.isActive,
      }))}
      rules={rules.map((rule) => ({
        id: rule.id,
        provider: rule.provider,
        field: rule.field,
        matchType: rule.matchType,
        matchValue: rule.matchValue,
        priority: rule.priority,
        divisionName: rule.division.name,
        divisionCode: rule.division.code,
      }))}
      mappableFields={MAPPABLE_FIELDS}
      unassigned={{ invoices: unassignedInvoices, quotes: unassignedQuotes }}
    />
  )
}

export const dynamic = 'force-dynamic'
