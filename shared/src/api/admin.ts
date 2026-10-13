import type { IntegrationProvider, IntegrationStatus, RoleName } from '../enums'

/**
 * API contracts for the administration area: Users & Permissions
 * (/api/users) and Settings (/api/settings).
 *
 * Mutations return `ActionResult` from './session' (the former Server Action
 * result, including the one-time `secret`).
 */

// ---------------------------------------------------------------------------
// Users & Permissions - GET /api/users/page
// ---------------------------------------------------------------------------

export interface UserListItem {
  id: string
  name: string
  email: string
  isActive: boolean
  mustChangePassword: boolean
  lastLoginAt: string | null
  lockedUntil: string | null
  roles: string[]
  divisionNames: string[]
  salesRepName: string | null
  activeSessions: number
}

export interface UserAuditEntry {
  id: string
  summary: string
  createdAt: string
  actorEmail: string | null
  ipAddress: string | null
}

export type UsersPageData =
  | { dbReady: false }
  | {
      dbReady: true
      currentUserId: string
      canViewAudit: boolean
      users: UserListItem[]
      divisions: { id: string; name: string }[]
      salesReps: { id: string; name: string }[]
      /** Granted permissions per role (stored rows, or the proposed defaults when the role row is missing). */
      rolePermissions: Record<RoleName, string[]>
      /** Last 20 `user.*` audit entries; empty unless `canViewAudit`. */
      auditEntries: UserAuditEntry[]
    }

/** POST /api/users */
export interface CreateUserBody {
  name: string
  email: string
  roles: string[]
  salesRepId?: string | null
  divisionIds?: string[]
}

/** PUT /api/users/:userId/roles */
export interface UpdateUserRolesBody {
  roles: string[]
}

/** PUT /api/users/:userId/active */
export interface SetUserActiveBody {
  isActive: boolean | 'true' | 'false'
}

/** PUT /api/users/roles/:roleName/permissions */
export interface UpdateRolePermissionsBody {
  permissions: string[]
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/** GET /api/settings/page */
export interface CompanySettingsPageData {
  dbReady: boolean
  /** SETTINGS_MANAGE and the database is reachable. */
  canManage: boolean
  timezones: string[]
  environment: string
  settings: {
    displayName: string
    timezone: string
    currency: string
    staleDataHours: number
    staleQuoteDays: number
    largeQuoteAmount: number
  }
}

/** GET /api/settings/brief/page */
export interface BriefSettingsPageData {
  dbReady: boolean
  canManage: boolean
  emailConfigured: boolean
  emailProvider: string
  providerLabel: string
  isConsoleProvider: boolean
  appUrl: string
  settings: { briefEnabled: boolean; briefSendHour: number; briefSendMinute: number; timezone: string }
  recipients: { id: string; email: string; name: string | null }[]
  recentBriefs: {
    id: string
    briefDate: string
    status: string
    generatedAt: string | null
    sent: number
    failed: number
    total: number
  }[]
}

/** GET /api/settings/divisions/page */
export type DivisionsSettingsPageData =
  | { dbReady: false }
  | {
      dbReady: true
      canManage: boolean
      divisions: { id: string; code: string; name: string; description: string | null; isActive: boolean }[]
      rules: {
        id: string
        provider: string
        field: string
        matchType: string
        matchValue: string
        priority: number
        divisionName: string
        divisionCode: string
      }[]
      mappableFields: Record<string, { field: string; label: string; hint: string }[]>
      unassigned: { invoices: number; quotes: number }
    }

/** GET /api/settings/metrics/page */
export interface MetricsSettingsPageData {
  dbReady: boolean
  canApprove: boolean
  canManage: boolean
  definitions: {
    key: string
    name: string
    shortDescription: string
    formula: string
    sourceSystems: string[]
    dateBasis: string
    includedRecords: string
    excludedRecords: string
    currencyHandling: string
    divisionMapping: string
    notes: string | null
    approver: string
    approvalStatus: string
    approvedBy: string | null
    approvedAt: string | null
  }[]
  cogsAccounts: {
    id: string
    sourceAccountId: string
    accountName: string
    accountType: string | null
    includeInCogs: boolean
    note: string | null
  }[]
  costPeriods: {
    id: string
    divisionName: string
    divisionCode: string
    periodStart: string
    cogsAmount: number
    isApproved: boolean
    approvedBy: string | null
    basis: string
    /** Set by the sync when a figure changed after it was approved. */
    note: string | null
  }[]
  reconciliations: {
    id: string
    metricName: string
    periodStart: string
    platformValue: number
    sourceValue: number
    variance: number
    variancePct: number
    passed: boolean
    performedBy: string | null
  }[]
}

/**
 * GET /api/settings/integrations/page
 *
 * Whether a credential exists and whether it works - never the credential.
 */
export interface IntegrationsSettingsPageData {
  dbReady: boolean
  canManage: boolean
  encryptionConfigured: boolean
  mondayEnabled: boolean
  providers: {
    provider: IntegrationProvider
    name: string
    what: string
    auth: string
    envVars: string[]
    envReady: boolean
    docsUrl: string
    connectUrl: string | null
    extra: string
    row: {
      status: IntegrationStatus
      isEnabled: boolean
      credentialStored: boolean
      lastSuccessAt: string | null
      syncIntervalMin: number
      historyMonths: number
      lastErrorMessage: string | null
    } | null
  }[]
}
