/**
 * Database seed.
 *
 * Creates the reference data the application needs before anyone can sign in:
 * roles with their proposed permissions, the three divisions, starter division
 * mapping rules, the metric definitions, the integration rows, and the first
 * owner account.
 *
 * Safe to re-run: everything is an upsert, and the owner's password is only
 * set when the account is first created, so a re-seed never resets a password
 * someone has already changed.
 *
 *   npm run db:seed
 */

import 'dotenv/config'
import { PrismaClient, type RoleName } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

// These are duplicated from src/lib rather than imported, so the seed can run
// with plain tsx without pulling in the Next.js module graph.
const ROLE_DEFINITIONS: { name: RoleName; label: string; description: string; permissions: string[] }[] = [
  {
    name: 'OWNER',
    label: 'Owner',
    description:
      'Full access to all authorised company data, financial reporting, the AI assistant, administration and audit views.',
    permissions: [
      'overview.view',
      'revenue.view',
      'revenue.view_all_reps',
      'revenue.view_customers',
      'receivables.view',
      'pipeline.view',
      'pipeline.view_all_reps',
      'ecommerce.view',
      'margin.view',
      'ai.use',
      'brief.view',
      'datahealth.view',
      'datahealth.manage',
      'users.manage',
      'settings.view',
      'settings.manage',
      'metrics.approve',
      'audit.view',
    ],
  },
  {
    name: 'FINANCE',
    label: 'Finance',
    description:
      'Financial reporting: revenue, accounts receivable and approved gross margin. Can approve metric definitions.',
    permissions: [
      'overview.view',
      'revenue.view',
      'revenue.view_all_reps',
      'revenue.view_customers',
      'receivables.view',
      'pipeline.view',
      'pipeline.view_all_reps',
      'ecommerce.view',
      'margin.view',
      'ai.use',
      'brief.view',
      'datahealth.view',
      'settings.view',
      'metrics.approve',
      'audit.view',
    ],
  },
  {
    name: 'ECOMMERCE',
    label: 'E-commerce',
    description: 'Eco LED Mart e-commerce reporting and related operational data.',
    permissions: ['overview.view', 'ecommerce.view', 'ai.use', 'brief.view', 'datahealth.view'],
  },
  {
    name: 'SALES_REP',
    label: 'Sales Representative',
    description:
      'Own sales data only. No profit or gross margin, and no access to other representatives’ records.',
    permissions: ['overview.view', 'revenue.view', 'pipeline.view', 'ai.use', 'brief.view'],
  },
  {
    name: 'OPERATIONS',
    label: 'Operations',
    description:
      'Operational reporting and integration health, including running and retrying synchronisations.',
    permissions: [
      'overview.view',
      'pipeline.view',
      'pipeline.view_all_reps',
      'ecommerce.view',
      'ai.use',
      'brief.view',
      'datahealth.view',
      'datahealth.manage',
    ],
  },
]

const DIVISIONS = [
  {
    code: 'METROLED',
    name: 'MetroLED',
    description: 'Lighting and signage.',
    sortOrder: 1,
  },
  {
    code: 'PIXEL',
    name: 'Pixel LED Displays',
    description: 'LED display systems.',
    sortOrder: 2,
  },
  {
    code: 'ECO',
    name: 'Eco LED Mart',
    description: 'Shopify e-commerce store.',
    sortOrder: 3,
  },
]

/**
 * Starter mapping rules.
 *
 * These are a STARTING POINT and need confirming against the client's actual
 * QuickBooks classes and Method CRM fields. A record matching none of them
 * stays unassigned rather than being attributed to a default division.
 */
const MAPPING_RULES = [
  { provider: 'QUICKBOOKS' as const, field: 'class', matchType: 'contains', matchValue: 'Pixel', divisionCode: 'PIXEL', priority: 10 },
  { provider: 'QUICKBOOKS' as const, field: 'class', matchType: 'contains', matchValue: 'Eco', divisionCode: 'ECO', priority: 20 },
  { provider: 'QUICKBOOKS' as const, field: 'class', matchType: 'contains', matchValue: 'MetroLED', divisionCode: 'METROLED', priority: 30 },
  { provider: 'METHOD_CRM' as const, field: 'class', matchType: 'contains', matchValue: 'Pixel', divisionCode: 'PIXEL', priority: 10 },
  { provider: 'METHOD_CRM' as const, field: 'class', matchType: 'contains', matchValue: 'MetroLED', divisionCode: 'METROLED', priority: 30 },
]

const INTEGRATIONS = [
  { provider: 'QUICKBOOKS' as const, displayName: 'QuickBooks Online', syncIntervalMin: 180 },
  { provider: 'METHOD_CRM' as const, displayName: 'Method CRM', syncIntervalMin: 180 },
  { provider: 'SHOPIFY' as const, displayName: 'Shopify — Eco LED Mart', syncIntervalMin: 120 },
]

async function main(): Promise<void> {
  console.info('Seeding MetroLED Intelligence reference data…\n')

  // --- Company settings ----------------------------------------------------
  await prisma.companySetting.upsert({
    where: { id: 'company' },
    create: {
      id: 'company',
      legalName: 'MetroLED',
      displayName: 'MetroLED',
      timezone: 'America/New_York',
      currency: 'CAD',
      briefEnabled: false,
      staleDataHours: 6,
      staleQuoteDays: 21,
      largeQuoteAmount: 10000,
    },
    update: {},
  })
  console.info('  company settings ready')

  // --- Roles and permissions ----------------------------------------------
  for (const definition of ROLE_DEFINITIONS) {
    const role = await prisma.role.upsert({
      where: { name: definition.name },
      create: { name: definition.name, label: definition.label, description: definition.description },
      update: { label: definition.label, description: definition.description },
      select: { id: true },
    })

    // Permissions are only seeded when the role has none, so a client's
    // confirmed matrix is never overwritten by a later re-seed.
    const existing = await prisma.rolePermission.count({ where: { roleId: role.id } })
    if (existing === 0) {
      await prisma.rolePermission.createMany({
        data: definition.permissions.map((permission) => ({ roleId: role.id, permission })),
        skipDuplicates: true,
      })
    }
  }
  console.info(`  ${ROLE_DEFINITIONS.length} roles ready with their proposed permissions`)

  // --- Divisions ------------------------------------------------------------
  const divisionIds = new Map<string, string>()
  for (const division of DIVISIONS) {
    const row = await prisma.division.upsert({
      where: { code: division.code },
      create: division,
      update: { name: division.name, description: division.description, sortOrder: division.sortOrder },
      select: { id: true },
    })
    divisionIds.set(division.code, row.id)
  }
  console.info(`  ${DIVISIONS.length} divisions ready`)

  // --- Division mapping rules ----------------------------------------------
  const existingRules = await prisma.divisionMappingRule.count()
  if (existingRules === 0) {
    for (const rule of MAPPING_RULES) {
      const divisionId = divisionIds.get(rule.divisionCode)
      if (!divisionId) continue
      await prisma.divisionMappingRule.create({
        data: {
          provider: rule.provider,
          field: rule.field,
          matchType: rule.matchType,
          matchValue: rule.matchValue,
          divisionId,
          priority: rule.priority,
          note: 'Seeded starting point. Confirm against the actual QuickBooks classes and Method CRM fields.',
          createdBy: 'seed',
        },
      })
    }
    console.info(`  ${MAPPING_RULES.length} starter mapping rules created (confirm these with the client)`)
  } else {
    console.info(`  ${existingRules} mapping rules already exist; left untouched`)
  }

  // --- Integrations ---------------------------------------------------------
  for (const integration of INTEGRATIONS) {
    await prisma.integration.upsert({
      where: { provider: integration.provider },
      create: integration,
      update: { displayName: integration.displayName },
    })
  }
  console.info(`  ${INTEGRATIONS.length} integration records ready (not connected)`)

  // --- Metric definitions ---------------------------------------------------
  const { METRIC_DEFINITIONS } = await import('../src/lib/metrics/definitions')
  for (const spec of METRIC_DEFINITIONS) {
    await prisma.metricDefinition.upsert({
      where: { key: spec.key },
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
        approvalStatus: spec.defaultApproval,
        notes: spec.notes ?? null,
      },
      // The formula text is refreshed, but an approval already recorded by
      // Finance is never reset by a re-seed.
      update: {
        name: spec.name,
        shortDescription: spec.shortDescription,
        formula: spec.formula,
        sourceSystems: spec.sourceSystems,
        dateBasis: spec.dateBasis,
        includedRecords: spec.includedRecords,
        excludedRecords: spec.excludedRecords,
        currencyHandling: spec.currencyHandling,
        divisionMapping: spec.divisionMapping,
      },
    })
  }
  console.info(`  ${METRIC_DEFINITIONS.length} metric definitions ready (awaiting Finance approval)`)

  // --- First owner ----------------------------------------------------------
  const ownerEmail = (process.env.SEED_OWNER_EMAIL ?? 'owner@metroled.local').trim().toLowerCase()
  const ownerName = process.env.SEED_OWNER_NAME ?? 'Ali Jooma'
  const ownerPassword = process.env.SEED_OWNER_PASSWORD

  const existingOwner = await prisma.user.findUnique({ where: { email: ownerEmail } })

  if (existingOwner) {
    console.info(`  owner account ${ownerEmail} already exists; password left unchanged`)
  } else {
    if (!ownerPassword) {
      console.warn(
        `\n  SEED_OWNER_PASSWORD is not set, so no owner account was created.\n` +
          `  Set SEED_OWNER_EMAIL, SEED_OWNER_NAME and SEED_OWNER_PASSWORD in .env and run the seed again.\n`,
      )
    } else if (ownerPassword.length < 12) {
      console.warn('\n  SEED_OWNER_PASSWORD must be at least 12 characters. No owner account was created.\n')
    } else {
      const ownerRole = await prisma.role.findUnique({ where: { name: 'OWNER' }, select: { id: true } })
      await prisma.user.create({
        data: {
          email: ownerEmail,
          name: ownerName,
          passwordHash: await bcrypt.hash(ownerPassword, 12),
          // The seed password is a bootstrap credential, not a chosen one.
          mustChangePassword: true,
          roles: ownerRole ? { create: [{ roleId: ownerRole.id, assignedBy: 'seed' }] } : undefined,
        },
      })
      console.info(`  owner account created: ${ownerEmail} (must change password at first sign-in)`)
    }
  }

  // --- Brief recipient ------------------------------------------------------
  if (ownerEmail && !(await prisma.briefRecipient.findUnique({ where: { email: ownerEmail } }))) {
    await prisma.briefRecipient.create({ data: { email: ownerEmail, name: ownerName } })
    console.info(`  ${ownerEmail} added as a daily brief recipient`)
  }

  console.info('\nSeed complete.\n')
  console.info('Next steps:')
  console.info('  1. Sign in and change the owner password.')
  console.info('  2. Connect QuickBooks, Method CRM and Shopify on the Data Health page.')
  console.info('  3. Confirm the division mapping rules in Settings > Divisions.')
  console.info('  4. Have Finance approve the metric definitions in Settings > Metric definitions.')
  console.info('  5. Confirm the permissions matrix in Users & Permissions with the client.\n')
}

main()
  .catch((error) => {
    console.error('\nSeed failed:', error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
