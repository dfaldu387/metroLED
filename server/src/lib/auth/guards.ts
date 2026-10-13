import type { RequestHandler, Response } from 'express'
import { getSession, type SessionUser } from './session'
import { PERMISSIONS, type Permission } from '@shared/permissions'

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
    public readonly requiredPermission?: string,
  ) {
    super(message)
    this.name = 'AuthorizationError'
  }
}

const UNAUTHENTICATED_MESSAGE = 'You are not signed in. Sign in and try again.'
const FORBIDDEN_MESSAGE =
  'Your role does not include access to this data. Ask an owner to review your permissions.'

/**
 * Resolves the signed-in user or throws `AuthorizationError('UNAUTHENTICATED')`,
 * which the API error handler turns into a 401. The client redirects a 401 to
 * the sign-in page (preserving the path), replacing the server-side redirect
 * the Next.js pages used to do.
 */
export async function requireUser(_returnTo?: string): Promise<SessionUser> {
  const user = await getSession()
  if (!user) throw new AuthorizationError('UNAUTHENTICATED', UNAUTHENTICATED_MESSAGE)
  return user
}

/** 401 when signed out, 403 (with `requiredPermission`) when the role lacks `permission`. */
export async function requirePermission(permission: Permission, returnTo?: string): Promise<SessionUser> {
  const user = await requireUser(returnTo)
  if (!user.permissions.has(permission)) {
    throw new AuthorizationError('FORBIDDEN', FORBIDDEN_MESSAGE, permission)
  }
  return user
}

/**
 * Express middleware form: `router.get('/x', requireAuth(PERMISSIONS.X), handler(...))`.
 * Pass `null` to require only a signed-in user. The user is stored on
 * `res.locals.user`; read it with `currentUser(res)`.
 */
export function requireAuth(permission: Permission | null): RequestHandler {
  return (_req, res, next) => {
    ;(permission ? requirePermission(permission) : requireUser()).then((user) => {
      res.locals.user = user
      next()
    }, next)
  }
}

export function currentUser(res: Response): SessionUser {
  const user = res.locals.user as SessionUser | undefined
  if (!user) throw new AuthorizationError('UNAUTHENTICATED', UNAUTHENTICATED_MESSAGE)
  return user
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
