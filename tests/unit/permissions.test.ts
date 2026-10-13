import { describe, expect, it } from 'vitest'
import {
  ALL_PERMISSIONS,
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSIONS,
  sanitizePermissions,
} from '@/lib/auth/permissions'
import { buildAccessScope } from '@/lib/auth/guards'
import { executeTool, toolDefinitionsFor } from '@/lib/ai/tools'
import { getDemoDataset } from '@/lib/demo/dataset'
import type { SessionUser } from '@/lib/auth/session'
import type { LoadedDataset } from '@/lib/data/dataset'

/**
 * Role access control (sections 16 and 19).
 *
 * The two restrictions the scope calls non-negotiable get the most attention:
 * a sales representative must never obtain profit or gross margin, and must
 * never see another representative's data - including through the assistant.
 */

function user(role: Parameters<typeof sanitizePermissions>[0][number], overrides: Partial<SessionUser> = {}): SessionUser {
  const permissions = sanitizePermissions([role], DEFAULT_ROLE_PERMISSIONS[role])
  return {
    id: `user-${role}`,
    email: `${role.toLowerCase()}@metroled.test`,
    name: role,
    roles: [role],
    roleLabel: role,
    permissions,
    salesRepId: role === 'SALES_REP' ? 'demo-rep-1' : null,
    divisionIds: [],
    mustChangePassword: false,
    timezone: 'America/New_York',
    isDemo: false,
    ...overrides,
  }
}

describe('permission sanitisation', () => {
  it('never grants a sales representative gross margin, however the table is configured', () => {
    // Simulate a mis-configured database row granting everything.
    const sanitized = sanitizePermissions(['SALES_REP'], ALL_PERMISSIONS)
    expect(sanitized.has(PERMISSIONS.MARGIN_VIEW)).toBe(false)
  })

  it('never grants a sales representative cross-representative access', () => {
    const sanitized = sanitizePermissions(['SALES_REP'], ALL_PERMISSIONS)
    expect(sanitized.has(PERMISSIONS.REVENUE_VIEW_ALL_REPS)).toBe(false)
    expect(sanitized.has(PERMISSIONS.PIPELINE_VIEW_ALL_REPS)).toBe(false)
  })

  it('never grants a sales representative administration', () => {
    const sanitized = sanitizePermissions(['SALES_REP'], ALL_PERMISSIONS)
    expect(sanitized.has(PERMISSIONS.USERS_MANAGE)).toBe(false)
    expect(sanitized.has(PERMISSIONS.SETTINGS_MANAGE)).toBe(false)
    expect(sanitized.has(PERMISSIONS.AUDIT_VIEW)).toBe(false)
    expect(sanitized.has(PERMISSIONS.METRICS_APPROVE)).toBe(false)
  })

  it('applies the restriction only when every role is sales representative', () => {
    // Someone holding both Finance and Sales Rep is a finance user who also
    // sells; the finance grant is the broader one and wins.
    const both = sanitizePermissions(['FINANCE', 'SALES_REP'], [...DEFAULT_ROLE_PERMISSIONS.FINANCE])
    expect(both.has(PERMISSIONS.MARGIN_VIEW)).toBe(true)
  })

  it('discards permission strings it does not recognise', () => {
    const sanitized = sanitizePermissions(['OWNER'], ['overview.view', 'totally.made.up', 'DROP TABLE users'])
    expect(sanitized.has(PERMISSIONS.OVERVIEW_VIEW)).toBe(true)
    expect(sanitized.size).toBe(1)
  })

  it('gives the owner every permission by default', () => {
    expect(DEFAULT_ROLE_PERMISSIONS.OWNER).toHaveLength(ALL_PERMISSIONS.length)
  })

  it('does not give an e-commerce user financial access by default', () => {
    const permissions = DEFAULT_ROLE_PERMISSIONS.ECOMMERCE
    expect(permissions).not.toContain(PERMISSIONS.MARGIN_VIEW)
    expect(permissions).not.toContain(PERMISSIONS.RECEIVABLES_VIEW)
    expect(permissions).not.toContain(PERMISSIONS.USERS_MANAGE)
  })
})

describe('access scope', () => {
  it('restricts a sales representative to their own linked record', () => {
    const scope = buildAccessScope(user('SALES_REP'))
    expect(scope.restrictToSalesRepId).toBe('demo-rep-1')
    expect(scope.canSeeAllReps).toBe(false)
    expect(scope.canSeeMargin).toBe(false)
  })

  it('fails closed when a restricted user has no linked rep record', () => {
    const scope = buildAccessScope(user('SALES_REP', { salesRepId: null }))
    // A sentinel that matches no record - showing everything would be the bug.
    expect(scope.restrictToSalesRepId).toBe('__no_linked_sales_rep__')
  })

  it('leaves an owner unrestricted', () => {
    const scope = buildAccessScope(user('OWNER'))
    expect(scope.restrictToSalesRepId).toBeNull()
    expect(scope.divisionIds).toBeNull()
    expect(scope.canSeeMargin).toBe(true)
  })

  it('honours a division restriction', () => {
    const scope = buildAccessScope(user('ECOMMERCE', { divisionIds: ['div-eco'] }))
    expect(scope.divisionIds).toEqual(['div-eco'])
  })
})

describe('AI assistant access control', () => {
  const now = new Date()
  const settings = { staleQuoteDays: 21, largeQuoteAmount: 10_000, timezone: 'America/New_York' }

  function datasetFor(scope: ReturnType<typeof buildAccessScope>): LoadedDataset {
    const base = getDemoDataset(now)
    // Mirror what loadDataset does for a scoped user.
    return {
      ...base,
      invoices:
        scope.restrictToSalesRepId === null
          ? base.invoices
          : base.invoices.filter((i) => i.salesRepId === scope.restrictToSalesRepId),
      quotes:
        scope.restrictToSalesRepId === null
          ? base.quotes
          : base.quotes.filter((q) => q.salesRepId === scope.restrictToSalesRepId),
      costs: scope.canSeeMargin ? base.costs : [],
      orders: scope.canSeeEcommerce ? base.orders : [],
      unmatchedCount: 0,
      availableDivisions: base.divisions,
    }
  }

  it('does not even offer the margin tool to a sales representative', () => {
    const scope = buildAccessScope(user('SALES_REP'))
    const names = toolDefinitionsFor(scope).map((t) => t.name)
    expect(names).not.toContain('get_gross_margin')
    expect(names).not.toContain('get_accounts_receivable')
    expect(names).toContain('get_revenue')
  })

  it('refuses the margin tool even when it is called directly', () => {
    // This is the important one: the model is never trusted to withhold data,
    // so calling the tool by name must still be refused.
    const scope = buildAccessScope(user('SALES_REP'))
    const execution = executeTool('get_gross_margin', { period: 'last_month' }, {
      scope,
      dataset: datasetFor(scope),
      settings,
      now,
    })
    expect(execution.result.ok).toBe(false)
    expect(execution.result.refusal).toContain('does not include access to profit')
    expect(execution.result.data).toEqual({})
  })

  it('refuses receivables for a sales representative', () => {
    const scope = buildAccessScope(user('SALES_REP'))
    const execution = executeTool('get_accounts_receivable', {}, {
      scope,
      dataset: datasetFor(scope),
      settings,
      now,
    })
    expect(execution.result.ok).toBe(false)
  })

  it('returns only the representative’s own revenue', () => {
    const repScope = buildAccessScope(user('SALES_REP'))
    const ownerScope = buildAccessScope(user('OWNER'))

    const repResult = executeTool('get_revenue', { period: 'last_12_months' }, {
      scope: repScope,
      dataset: datasetFor(repScope),
      settings,
      now,
    })
    const ownerResult = executeTool('get_revenue', { period: 'last_12_months' }, {
      scope: ownerScope,
      dataset: datasetFor(ownerScope),
      settings,
      now,
    })

    const repTotal = repResult.result.data.total_revenue_number as number
    const ownerTotal = ownerResult.result.data.total_revenue_number as number

    expect(repResult.result.ok).toBe(true)
    expect(repTotal).toBeGreaterThan(0)
    // A single representative cannot see the company total.
    expect(repTotal).toBeLessThan(ownerTotal)
  })

  it('refuses a customer breakdown to a role without that permission', () => {
    const scope = buildAccessScope(user('SALES_REP'))
    const execution = executeTool('get_revenue', { period: 'last_month', group_by: 'customer' }, {
      scope,
      dataset: datasetFor(scope),
      settings,
      now,
    })
    expect(execution.result.ok).toBe(false)
    expect(execution.result.refusal).toContain('customer')
  })

  it('rejects a tool name that is not approved', () => {
    const scope = buildAccessScope(user('OWNER'))
    const execution = executeTool('run_raw_sql', { query: 'SELECT 1' }, {
      scope,
      dataset: datasetFor(scope),
      settings,
      now,
    })
    expect(execution.result.ok).toBe(false)
    expect(execution.result.refusal).toContain('not an approved business query')
  })

  it('rejects parameters that fail validation', () => {
    const scope = buildAccessScope(user('OWNER'))
    const bad = executeTool('list_overdue_invoices', { min_days_overdue: -1, limit: 99999 }, {
      scope,
      dataset: datasetFor(scope),
      settings,
      now,
    })
    expect(bad.result.ok).toBe(false)
    expect(bad.result.refusal).toContain('not valid')
  })

  it('rejects an unknown period value', () => {
    const scope = buildAccessScope(user('OWNER'))
    const bad = executeTool('get_revenue', { period: 'since_the_dawn_of_time' }, {
      scope,
      dataset: datasetFor(scope),
      settings,
      now,
    })
    expect(bad.result.ok).toBe(false)
  })

  it('explains the margin definition without revealing a figure', () => {
    const scope = buildAccessScope(user('SALES_REP'))
    const execution = executeTool('get_metric_definition', { metric: 'gross_margin_pct' }, {
      scope,
      dataset: datasetFor(scope),
      settings,
      now,
    })
    expect(execution.result.ok).toBe(true)
    expect(execution.result.data.formula).toBeTruthy()
    // No actual margin number is present.
    expect(JSON.stringify(execution.result.data)).not.toMatch(/\$[\d,]+/)
  })

  it('labels demo data in every tool result', () => {
    const scope = buildAccessScope(user('OWNER'))
    const execution = executeTool('get_revenue', { period: 'last_month' }, {
      scope,
      dataset: datasetFor(scope),
      settings,
      now,
    })
    const note = execution.result.sources.find((s) => s.note?.includes('DEMO'))
    expect(note).toBeDefined()
  })
})
