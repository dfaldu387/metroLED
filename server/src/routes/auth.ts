import { Router } from 'express'
import { z } from 'zod'
import { db, sql, databaseReachable } from '../lib/db'
import type { UserRow } from '../lib/db-rows'
import { verifyPassword } from '../lib/auth/password'
import {
  createDemoSession,
  createSession,
  DEMO_PERSONAS,
  destroySession,
  getSession,
  loadRoleGrants,
} from '../lib/auth/session'
import { AUDIT_ACTIONS, recordAudit } from '../lib/auth/audit'
import { DEFAULT_ROLE_PERMISSIONS, sanitizePermissions, type Permission } from '@shared/permissions'
import { ALL_NAV_ITEMS, defaultLandingPage } from '@shared/navigation'
import { demoDataAllowed, env } from '../lib/env'
import { handler } from '../lib/http/errors'
import type { SessionInfo } from '@shared/api/session'

export const authRouter = Router()

/**
 * GET /api/auth/session
 *
 * Who is signed in, what they may open, and what the sign-in page needs to
 * know. Never 401s: a signed-out visitor gets `user: null`.
 */
authRouter.get(
  '/session',
  handler(async (): Promise<SessionInfo> => {
    const user = await getSession()
    const base = {
      databaseReady: await databaseReachable(),
      demoAvailable: demoDataAllowed(),
      environment: env().APP_ENV,
      demoPersonas: demoDataAllowed() ? DEMO_PERSONAS : [],
    }
    if (!user) return { ...base, user: null }
    return {
      ...base,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        roles: user.roles,
        roleLabel: user.roleLabel,
        permissions: [...user.permissions],
        salesRepId: user.salesRepId,
        divisionIds: user.divisionIds,
        mustChangePassword: user.mustChangePassword,
        timezone: user.timezone,
        isDemo: user.isDemo,
        landingPage: defaultLandingPage(user.permissions),
        allowedHrefs: ALL_NAV_ITEMS.filter((item) => user.permissions.has(item.permission)).map((i) => i.href),
      },
    }
  }),
)

/**
 * Credential sign-in.
 *
 * Security behaviours:
 *   - The same message is returned for an unknown email and a wrong password,
 *     so the endpoint cannot be used to enumerate accounts.
 *   - A password hash comparison runs even for an unknown email, so response
 *     timing does not reveal whether the account exists.
 *   - Repeated failures lock the account temporarily, and every attempt -
 *     successful or not - is written to the audit log.
 */
const signInSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(1).max(200),
})

const GENERIC_FAILURE =
  'That email address and password do not match an active account. Check both and try again.'

const MAX_FAILED_ATTEMPTS = 8
const LOCK_MINUTES = 15

// A real bcrypt hash of a random string, used to equalise timing when the
// account does not exist. It can never match a user-supplied password.
const DUMMY_HASH = '$2a$12$C6UzMDM.H6dfI/f/IKcEe.NJzKE1dCqfKmHxjdHwFqU9jGBFOGZ4u'

authRouter.post(
  '/sign-in',
  handler(async (req, res) => {
    if (!(await databaseReachable())) {
      res.status(503)
      return {
        ok: false,
        message: 'The reporting database is not reachable, so sign-in is unavailable. Contact your administrator.',
      }
    }

    const parsed = signInSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400)
      return { ok: false, message: 'Enter a valid email address and your password.' }
    }

    const email = parsed.data.email.trim().toLowerCase()
    const user = await db.maybeOne<UserRow>(sql`SELECT * FROM "User" WHERE "email" = ${email}`)
    const now = new Date()

    if (!user) {
      await verifyPassword(parsed.data.password, DUMMY_HASH)
      await recordAudit({
        action: AUDIT_ACTIONS.SIGN_IN_FAILED,
        summary: `Sign-in attempt for an unknown email address (${email}).`,
        actorEmail: email,
      })
      res.status(401)
      return { ok: false, message: GENERIC_FAILURE }
    }

    if (user.lockedUntil && user.lockedUntil > now) {
      const minutes = Math.max(1, Math.ceil((user.lockedUntil.getTime() - now.getTime()) / 60000))
      res.status(423)
      return {
        ok: false,
        message: `This account is temporarily locked after repeated failed attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}, or ask an owner to reset your password.`,
      }
    }

    const valid = await verifyPassword(parsed.data.password, user.passwordHash)

    if (!valid) {
      const failedCount = user.failedLoginCount + 1
      const shouldLock = failedCount >= MAX_FAILED_ATTEMPTS
      await db.exec(sql`
        UPDATE "User"
        SET "failedLoginCount" = ${failedCount},
            "lockedUntil" = ${shouldLock ? new Date(now.getTime() + LOCK_MINUTES * 60 * 1000) : null}
        WHERE "id" = ${user.id}`)
      await recordAudit({
        action: AUDIT_ACTIONS.SIGN_IN_FAILED,
        summary: shouldLock
          ? `Incorrect password for ${user.email}. Account locked for ${LOCK_MINUTES} minutes after ${failedCount} failed attempts.`
          : `Incorrect password for ${user.email} (attempt ${failedCount}).`,
        actorEmail: user.email,
        entityType: 'User',
        entityId: user.id,
      })
      res.status(401)
      return { ok: false, message: GENERIC_FAILURE }
    }

    if (!user.isActive) {
      await recordAudit({
        action: AUDIT_ACTIONS.SIGN_IN_FAILED,
        summary: `Correct password supplied for deactivated account ${user.email}.`,
        actorEmail: user.email,
        entityType: 'User',
        entityId: user.id,
      })
      res.status(403)
      return { ok: false, message: 'This account has been deactivated. Ask an account owner to reactivate it.' }
    }

    await db.exec(sql`
      UPDATE "User" SET "failedLoginCount" = 0, "lockedUntil" = NULL, "lastLoginAt" = ${now}
      WHERE "id" = ${user.id}`)

    await createSession(user.id)

    await recordAudit({
      action: AUDIT_ACTIONS.SIGN_IN,
      summary: `${user.name} signed in.`,
      actor: { id: user.id, email: user.email, isDemo: false },
      entityType: 'User',
      entityId: user.id,
    })

    // Land the user on the first page their role can actually open. A role
    // with no RolePermission rows falls back to its defaults, as before.
    const { roles, granted, rolesWithoutRows } = await loadRoleGrants(user.id)
    const allGranted = [...granted, ...rolesWithoutRows.flatMap((r) => DEFAULT_ROLE_PERMISSIONS[r])]
    const redirectTo = defaultLandingPage(sanitizePermissions(roles, allGranted as Permission[]))

    return { ok: true, redirectTo, mustChangePassword: user.mustChangePassword }
  }),
)

/**
 * Start a labelled demo session.
 *
 * Refused outright when demo data is not allowed (always the case in
 * production), so there is no code path that creates a demo identity on a
 * production deployment.
 */
const demoSchema = z.object({
  role: z.enum(['OWNER', 'FINANCE', 'ECOMMERCE', 'SALES_REP', 'OPERATIONS']),
})

authRouter.post(
  '/demo',
  handler(async (req, res) => {
    if (!demoDataAllowed()) {
      res.status(403)
      return {
        ok: false,
        message: 'Demo sign-in is disabled on this deployment. Sign in with your account credentials.',
      }
    }
    const parsed = demoSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400)
      return { ok: false, message: 'Choose a role to preview.' }
    }
    await createDemoSession(parsed.data.role)
    return { ok: true, redirectTo: '/overview' }
  }),
)

/**
 * Sign out.
 *
 * POST only: a sign-out changes server state, so it must not be reachable by a
 * prefetched link or an image tag. The session row is revoked, not just the
 * cookie cleared, so the token cannot be replayed.
 */
authRouter.post(
  '/sign-out',
  handler(async () => {
    const user = await getSession()
    await destroySession()
    if (user) {
      await recordAudit({
        action: AUDIT_ACTIONS.SIGN_OUT,
        summary: `${user.name} signed out.`,
        actor: user,
        entityType: 'User',
        entityId: user.id,
      })
    }
    return { ok: true, redirectTo: '/sign-in' }
  }),
)
