import { db, sql, databaseReachable } from '../db'
import { requestMeta } from '../http/context'
import type { SessionUser } from './session'

/**
 * Audit log.
 *
 * Writes are best-effort: a failure to record an audit entry must never break
 * the action the user asked for, but it is logged loudly on the server so the
 * gap is visible in the operations runbook.
 */

export const AUDIT_ACTIONS = {
  SIGN_IN: 'auth.sign_in',
  SIGN_IN_FAILED: 'auth.sign_in_failed',
  SIGN_OUT: 'auth.sign_out',
  PASSWORD_CHANGED: 'auth.password_changed',

  USER_CREATED: 'user.created',
  USER_UPDATED: 'user.updated',
  USER_DEACTIVATED: 'user.deactivated',
  USER_REACTIVATED: 'user.reactivated',
  USER_ROLES_CHANGED: 'user.roles_changed',
  USER_PASSWORD_RESET: 'user.password_reset',
  ROLE_PERMISSIONS_CHANGED: 'role.permissions_changed',

  SETTINGS_UPDATED: 'settings.updated',
  DIVISION_CREATED: 'division.created',
  DIVISION_UPDATED: 'division.updated',
  MAPPING_RULE_CHANGED: 'mapping_rule.changed',
  COGS_MAPPING_CHANGED: 'cogs_mapping.changed',

  METRIC_DEFINITION_UPDATED: 'metric.definition_updated',
  METRIC_APPROVED: 'metric.approved',
  METRIC_REJECTED: 'metric.rejected',
  COST_PERIOD_APPROVED: 'cost_period.approved',
  COST_PERIOD_APPROVAL_WITHDRAWN: 'cost_period.approval_withdrawn',
  RECONCILIATION_RECORDED: 'metric.reconciliation_recorded',

  INTEGRATION_CONNECTED: 'integration.connected',
  INTEGRATION_DISCONNECTED: 'integration.disconnected',
  INTEGRATION_UPDATED: 'integration.updated',
  SYNC_TRIGGERED: 'sync.triggered',
  SYNC_RETRIED: 'sync.retried',
  UNMATCHED_RESOLVED: 'unmatched.resolved',

  BRIEF_RECIPIENTS_CHANGED: 'brief.recipients_changed',
  BRIEF_SENT: 'brief.sent',
  BRIEF_RESENT: 'brief.resent',

  AI_QUERY: 'ai.query',
} as const

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS]

export interface AuditInput {
  action: AuditAction
  summary: string
  actor?: Pick<SessionUser, 'id' | 'email' | 'isDemo'> | null
  actorEmail?: string
  entityType?: string
  entityId?: string
  metadata?: Record<string, unknown>
}

export async function recordAudit(input: AuditInput): Promise<void> {
  // Demo identities are not database users, so there is no row to reference and
  // nothing of record to keep.
  if (input.actor?.isDemo) return
  if (!(await databaseReachable())) return

  try {
    await db.exec(sql`
      INSERT INTO "AuditLog" ("userId", "actorEmail", "action", "entityType", "entityId", "summary", "metadata", "ipAddress")
      VALUES (
        ${input.actor?.id ?? null},
        ${input.actor?.email ?? input.actorEmail ?? null},
        ${input.action},
        ${input.entityType ?? null},
        ${input.entityId ?? null},
        ${input.summary},
        ${input.metadata ?? null},
        ${requestMeta().ip}
      )`)
  } catch (error) {
    console.error('[audit] failed to record entry', { action: input.action, error })
  }
}
