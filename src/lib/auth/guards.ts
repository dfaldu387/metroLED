import { redirect } from 'next/navigation'
import { NextResponse } from 'next/server'
import { getSession, type SessionUser } from './session'
import { PERMISSIONS, type Permission } from './permissions'

/**
 * Server-side authorisation helpers.
 *
 * Every protected page calls `requirePermission` before rendering, and every
 * protected route handler calls `requireApiPermission`. The navigation sidebar
 * also filters items, but that is cosmetic - removing a link does not remove
 * access, so the check always runs here as well.
 */

export class AuthorizationError extends Error {
  constructor(
    public readonly code: 'UNAUTHENTICATED' | 'FORBIDDEN',
    message: string,
  ) {
    super(message)
    this.name = 'AuthorizationError'
  }
}

/** For pages: redirects to sign-in, preserving the requested path. */
export async function requireUser(returnTo?: string): Promise<SessionUser> {
  const user = await getSession()
  if (!user) {
    const target = returnTo ? `/sign-in?next=${encodeURIComponent(returnTo)}` : '/sign-in'
    redirect(target)
  }
  return user
}

/** For pages: redirects unauthenticated users, 403s authenticated-but-denied. */
export async function requirePermission(permission: Permission, returnTo?: string): Promise<SessionUser> {
  const user = await requireUser(returnTo)
  if (!user.permissions.has(permission)) {
    redirect(`/no-access?permission=${encodeURIComponent(permission)}`)
  }
  return user
}

export interface ApiAuthSuccess {
  ok: true
  user: SessionUser
}
export interface ApiAuthFailure {
  ok: false
  response: NextResponse
}

/**
 * For route handlers. Returns a ready-made JSON response on failure so the
 * handler can `if (!auth.ok) return auth.response`.
 */
export async function requireApiPermission(
  permission: Permission | null,
): Promise<ApiAuthSuccess | ApiAuthFailure> {
  const user = await getSession()
  if (!user) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: 'UNAUTHENTICATED',
          message: 'You are not signed in. Sign in and try again.',
        },
        { status: 401 },
      ),
    }
  }
  if (permission && !user.permissions.has(permission)) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: 'FORBIDDEN',
          message: 'Your role does not include access to this data. Ask an owner to review your permissions.',
          requiredPermission: permission,
        },
        { status: 403 },
      ),
    }
  }
  return { ok: true, user }
}

/**
 * The data-access scope derived from a session.
 *
 * Passed into every analytics query so filtering happens in the database /
 * aggregation layer, not in the view. `null` on a list field means "no
 * restriction".
 */
export interface AccessScope {
  userId: string
  isDemo: boolean
  /** null = every division. */
  divisionIds: string[] | null
  /** Non-null = restrict records to this sales representative only. */
  restrictToSalesRepId: string | null
  canSeeMargin: boolean
  canSeeAllReps: boolean
  canSeeCustomers: boolean
  canSeeReceivables: boolean
  canSeeEcommerce: boolean
  canSeePipeline: boolean
  canSeeRevenue: boolean
}

export function buildAccessScope(user: SessionUser): AccessScope {
  const canSeeAllReps =
    user.permissions.has(PERMISSIONS.REVENUE_VIEW_ALL_REPS) ||
    user.permissions.has(PERMISSIONS.PIPELINE_VIEW_ALL_REPS)

  // A user without "all reps" is restricted to their own linked rep record.
  // If no rep record is linked, the restriction resolves to a sentinel that
  // matches nothing - failing closed rather than showing everything.
  const restrictToSalesRepId = canSeeAllReps ? null : (user.salesRepId ?? '__no_linked_sales_rep__')

  return {
    userId: user.id,
    isDemo: user.isDemo,
    divisionIds: user.divisionIds.length > 0 ? user.divisionIds : null,
    restrictToSalesRepId,
    canSeeMargin: user.permissions.has(PERMISSIONS.MARGIN_VIEW),
    canSeeAllReps,
    canSeeCustomers: user.permissions.has(PERMISSIONS.REVENUE_VIEW_CUSTOMERS),
    canSeeReceivables: user.permissions.has(PERMISSIONS.RECEIVABLES_VIEW),
    canSeeEcommerce: user.permissions.has(PERMISSIONS.ECOMMERCE_VIEW),
    canSeePipeline: user.permissions.has(PERMISSIONS.PIPELINE_VIEW),
    canSeeRevenue: user.permissions.has(PERMISSIONS.REVENUE_VIEW),
  }
}

/**
 * Belt-and-braces check used by the margin page, the margin AI tool and the
 * daily brief. Throws rather than returning a figure.
 */
export function assertMarginAccess(scope: AccessScope): void {
  if (!scope.canSeeMargin) {
    throw new AuthorizationError('FORBIDDEN', 'Gross margin and cost figures are not available to your role.')
  }
}
