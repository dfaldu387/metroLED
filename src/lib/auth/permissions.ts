import type { RoleName } from '@prisma/client'

/**
 * The permission vocabulary.
 *
 * Authorisation is checked server-side on every protected page and API route.
 * Hiding a navigation item is presentation only and is never treated as a
 * security control.
 */
export const PERMISSIONS = {
  OVERVIEW_VIEW: 'overview.view',

  REVENUE_VIEW: 'revenue.view',
  /** Without this, revenue is scoped to the signed-in user's own rep record. */
  REVENUE_VIEW_ALL_REPS: 'revenue.view_all_reps',
  REVENUE_VIEW_CUSTOMERS: 'revenue.view_customers',

  RECEIVABLES_VIEW: 'receivables.view',

  PIPELINE_VIEW: 'pipeline.view',
  PIPELINE_VIEW_ALL_REPS: 'pipeline.view_all_reps',

  ECOMMERCE_VIEW: 'ecommerce.view',

  /** Gross margin, gross profit and any cost figure. Never granted to a sales rep. */
  MARGIN_VIEW: 'margin.view',

  AI_USE: 'ai.use',
  BRIEF_VIEW: 'brief.view',

  DATA_HEALTH_VIEW: 'datahealth.view',
  /** Run a sync, retry failed records, resolve unmatched customers. */
  DATA_HEALTH_MANAGE: 'datahealth.manage',

  USERS_MANAGE: 'users.manage',
  SETTINGS_VIEW: 'settings.view',
  SETTINGS_MANAGE: 'settings.manage',
  METRICS_APPROVE: 'metrics.approve',
  AUDIT_VIEW: 'audit.view',
} as const

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS]

export const ALL_PERMISSIONS: Permission[] = Object.values(PERMISSIONS)

/**
 * Default permissions matrix.
 *
 * PENDING CLIENT CONFIRMATION - section 16 of the Phase 1 scope requires Ali to
 * confirm the final matrix. This is the proposed starting point; it is seeded
 * into `RolePermission` so it can be adjusted in Users & Permissions without a
 * code change, and every change is written to the audit log.
 *
 * Two restrictions are treated as non-negotiable and are additionally enforced
 * in code (see `assertNoMarginForSalesRep` and the query scoping in
 * `buildAccessScope`), so a mis-configuration in the table cannot leak them:
 *   - A sales representative never receives MARGIN_VIEW.
 *   - A sales representative without *_VIEW_ALL_REPS only ever sees their own
 *     records.
 */
export const DEFAULT_ROLE_PERMISSIONS: Record<RoleName, Permission[]> = {
  OWNER: ALL_PERMISSIONS,

  FINANCE: [
    PERMISSIONS.OVERVIEW_VIEW,
    PERMISSIONS.REVENUE_VIEW,
    PERMISSIONS.REVENUE_VIEW_ALL_REPS,
    PERMISSIONS.REVENUE_VIEW_CUSTOMERS,
    PERMISSIONS.RECEIVABLES_VIEW,
    PERMISSIONS.PIPELINE_VIEW,
    PERMISSIONS.PIPELINE_VIEW_ALL_REPS,
    PERMISSIONS.ECOMMERCE_VIEW,
    PERMISSIONS.MARGIN_VIEW,
    PERMISSIONS.AI_USE,
    PERMISSIONS.BRIEF_VIEW,
    PERMISSIONS.DATA_HEALTH_VIEW,
    PERMISSIONS.SETTINGS_VIEW,
    PERMISSIONS.METRICS_APPROVE,
    PERMISSIONS.AUDIT_VIEW,
  ],

  ECOMMERCE: [
    PERMISSIONS.OVERVIEW_VIEW,
    PERMISSIONS.ECOMMERCE_VIEW,
    PERMISSIONS.AI_USE,
    PERMISSIONS.BRIEF_VIEW,
    PERMISSIONS.DATA_HEALTH_VIEW,
  ],

  SALES_REP: [
    PERMISSIONS.OVERVIEW_VIEW,
    PERMISSIONS.REVENUE_VIEW,
    PERMISSIONS.PIPELINE_VIEW,
    PERMISSIONS.AI_USE,
    PERMISSIONS.BRIEF_VIEW,
  ],

  OPERATIONS: [
    PERMISSIONS.OVERVIEW_VIEW,
    PERMISSIONS.PIPELINE_VIEW,
    PERMISSIONS.PIPELINE_VIEW_ALL_REPS,
    PERMISSIONS.ECOMMERCE_VIEW,
    PERMISSIONS.AI_USE,
    PERMISSIONS.BRIEF_VIEW,
    PERMISSIONS.DATA_HEALTH_VIEW,
    PERMISSIONS.DATA_HEALTH_MANAGE,
  ],
}

export const ROLE_LABELS: Record<RoleName, string> = {
  OWNER: 'Owner',
  FINANCE: 'Finance',
  ECOMMERCE: 'E-commerce',
  SALES_REP: 'Sales Representative',
  OPERATIONS: 'Operations',
}

export const ROLE_DESCRIPTIONS: Record<RoleName, string> = {
  OWNER: 'Full access to all authorised company data, financial reporting, the AI assistant, administration and audit views.',
  FINANCE: 'Financial reporting: revenue, accounts receivable and approved gross margin. Can approve metric definitions.',
  ECOMMERCE: 'Eco LED Mart e-commerce reporting and related operational data.',
  SALES_REP: 'Own sales data only. No profit or gross margin, and no access to other representatives’ records.',
  OPERATIONS: 'Operational reporting and integration health, including running and retrying synchronisations.',
}

export const PERMISSION_LABELS: Record<Permission, string> = {
  [PERMISSIONS.OVERVIEW_VIEW]: 'View the Overview dashboard',
  [PERMISSIONS.REVENUE_VIEW]: 'View revenue analytics',
  [PERMISSIONS.REVENUE_VIEW_ALL_REPS]: 'View revenue for all sales representatives',
  [PERMISSIONS.REVENUE_VIEW_CUSTOMERS]: 'View revenue broken down by customer',
  [PERMISSIONS.RECEIVABLES_VIEW]: 'View accounts receivable',
  [PERMISSIONS.PIPELINE_VIEW]: 'View the sales pipeline',
  [PERMISSIONS.PIPELINE_VIEW_ALL_REPS]: 'View pipeline for all sales representatives',
  [PERMISSIONS.ECOMMERCE_VIEW]: 'View e-commerce analytics',
  [PERMISSIONS.MARGIN_VIEW]: 'View gross margin, gross profit and cost figures',
  [PERMISSIONS.AI_USE]: 'Use the Ask MetroLED assistant',
  [PERMISSIONS.BRIEF_VIEW]: 'View the Daily Brief',
  [PERMISSIONS.DATA_HEALTH_VIEW]: 'View Data Health and synchronisation history',
  [PERMISSIONS.DATA_HEALTH_MANAGE]: 'Run syncs, retry failures and resolve unmatched records',
  [PERMISSIONS.USERS_MANAGE]: 'Manage users, roles and permissions',
  [PERMISSIONS.SETTINGS_VIEW]: 'View settings',
  [PERMISSIONS.SETTINGS_MANAGE]: 'Change settings, divisions and mappings',
  [PERMISSIONS.METRICS_APPROVE]: 'Approve metric definitions',
  [PERMISSIONS.AUDIT_VIEW]: 'View the audit log',
}

/**
 * Hard-coded safety net: strip any permission a role must never hold,
 * regardless of what the database says.
 */
export function sanitizePermissions(roles: RoleName[], permissions: Iterable<string>): Set<Permission> {
  const set = new Set<Permission>()
  const known = new Set<string>(ALL_PERMISSIONS)
  for (const p of permissions) {
    if (known.has(p)) set.add(p as Permission)
  }

  const isOnlySalesRep = roles.length > 0 && roles.every((r) => r === 'SALES_REP')
  if (isOnlySalesRep) {
    // Section 16: a sales representative never sees profit or gross margin and
    // never sees another representative's restricted data.
    set.delete(PERMISSIONS.MARGIN_VIEW)
    set.delete(PERMISSIONS.REVENUE_VIEW_ALL_REPS)
    set.delete(PERMISSIONS.PIPELINE_VIEW_ALL_REPS)
    set.delete(PERMISSIONS.USERS_MANAGE)
    set.delete(PERMISSIONS.SETTINGS_MANAGE)
    set.delete(PERMISSIONS.METRICS_APPROVE)
    set.delete(PERMISSIONS.AUDIT_VIEW)
    set.delete(PERMISSIONS.DATA_HEALTH_MANAGE)
  }

  return set
}
