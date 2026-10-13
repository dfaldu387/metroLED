import { Router, type Request } from 'express'
import { z } from 'zod'
import { db, sql, transaction, insert, insertMany, databaseReachable } from '../lib/db'
import type { AuditLogRow, RoleRow, UserRow } from '../lib/db-rows'
import { getSession, revokeAllSessions, type SessionUser } from '../lib/auth/session'
import { currentUser, requireAuth } from '../lib/auth/guards'
import { hashPassword } from '../lib/auth/password'
import { randomToken } from '../lib/crypto'
import { AUDIT_ACTIONS, recordAudit } from '../lib/auth/audit'
import { handler } from '../lib/http/errors'
import { PERMISSIONS, ALL_PERMISSIONS, DEFAULT_ROLE_PERMISSIONS, ROLE_LABELS } from '@shared/permissions'
import type { RoleName } from '@shared/enums'
import type { ActionResult } from '@shared/api/session'
import type { UsersPageData, UserListItem } from '@shared/api/admin'

/**
 * Users & Permissions (section 16): the page data and the user administration
 * endpoints (the former `users/actions.ts` Server Actions).
 *
 * Every endpoint re-checks the caller's permission on the server. The forms
 * that invoke them are already hidden from unauthorised users, but that is
 * presentation - these checks are the control. Expected refusals come back as
 * HTTP 200 `{ ok: false, message }`, exactly as the actions returned them.
 */
export const usersRouter = Router()

// ---------------------------------------------------------------------------
// Request body helpers (the JSON body carries the former FormData fields)
// ---------------------------------------------------------------------------

type Body = Record<string, unknown>

function body(req: Request): Body {
  return req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? (req.body as Body) : {}
}

/** `formData.get(name)`: the value, or null when absent. */
function field(b: Body, name: string): unknown {
  const v = b[name]
  return v === undefined ? null : v
}

/** `formData.getAll(name)`: always an array. */
function fieldAll(b: Body, name: string): unknown[] {
  const v = b[name]
  if (v === undefined || v === null) return []
  return Array.isArray(v) ? v : [v]
}

// ---------------------------------------------------------------------------
// Authorisation
// ---------------------------------------------------------------------------

async function requireAdmin(): Promise<{ ok: true; user: SessionUser } | { ok: false; result: ActionResult }> {
  const user = await getSession()
  if (!user) {
    return { ok: false, result: { ok: false, message: 'Your session has expired. Sign in and try again.' } }
  }
  if (!user.permissions.has(PERMISSIONS.USERS_MANAGE)) {
    return { ok: false, result: { ok: false, message: 'Your role does not include user administration.' } }
  }
  if (user.isDemo) {
    return {
      ok: false,
      result: {
        ok: false,
        message: 'A demo session cannot change user accounts. Sign in with a real account.',
      },
    }
  }
  if (!(await databaseReachable())) {
    return { ok: false, result: { ok: false, message: 'The database is unreachable, so nothing can be changed.' } }
  }
  return { ok: true, user }
}

const ROLE_VALUES = ['OWNER', 'FINANCE', 'ECOMMERCE', 'SALES_REP', 'OPERATIONS'] as const

/** Active users holding the Owner role (the last-owner lockout guard). */
async function activeOwnerCount(): Promise<number> {
  return (
    (await db.value<number>(sql`
      SELECT COUNT(*)
      FROM "UserRole" ur
      JOIN "Role" r ON r."id" = ur."roleId"
      JOIN "User" u ON u."id" = ur."userId"
      WHERE r."name" = ${'OWNER'} AND u."isActive" = true`)) ?? 0
  )
}

async function roleNamesOf(userId: string): Promise<RoleName[]> {
  const rows = await db.many<{ name: RoleName }>(sql`
    SELECT r."name" FROM "UserRole" ur JOIN "Role" r ON r."id" = ur."roleId"
    WHERE ur."userId" = ${userId}`)
  return rows.map((r) => r.name)
}

// ---------------------------------------------------------------------------
// GET /api/users/page
// ---------------------------------------------------------------------------

usersRouter.get(
  '/page',
  requireAuth(PERMISSIONS.USERS_MANAGE),
  handler(async (_req, res): Promise<UsersPageData> => {
    const admin = currentUser(res)
    const dbReady = await databaseReachable()
    const now = new Date()

    if (!dbReady) return { dbReady: false }

    const canViewAudit = admin.permissions.has(PERMISSIONS.AUDIT_VIEW)

    const [users, userRoles, userDivisions, roles, divisions, salesReps, auditEntries] = await Promise.all([
      db.many<
        Pick<UserRow, 'id' | 'name' | 'email' | 'isActive' | 'mustChangePassword' | 'lastLoginAt' | 'lockedUntil'> & {
          salesRepName: string | null
          activeSessions: number
        }
      >(sql`
        SELECT u."id", u."name", u."email", u."isActive", u."mustChangePassword", u."lastLoginAt", u."lockedUntil",
               sr."name" AS "salesRepName",
               (SELECT COUNT(*) FROM "Session" s
                 WHERE s."userId" = u."id" AND s."revokedAt" IS NULL AND s."expiresAt" > ${now}) AS "activeSessions"
        FROM "User" u
        LEFT JOIN "SalesRep" sr ON sr."id" = u."salesRepId"
        ORDER BY u."isActive" DESC, u."name" ASC`),
      db.many<{ userId: string; name: RoleName }>(sql`
        SELECT ur."userId", r."name" FROM "UserRole" ur JOIN "Role" r ON r."id" = ur."roleId"`),
      db.many<{ userId: string; name: string }>(sql`
        SELECT ud."userId", d."name" FROM "UserDivision" ud JOIN "Division" d ON d."id" = ud."divisionId"`),
      db.many<{ name: RoleName; permission: string | null }>(sql`
        SELECT r."name", rp."permission"
        FROM "Role" r LEFT JOIN "RolePermission" rp ON rp."roleId" = r."id"
        ORDER BY r."name" ASC`),
      db.many<{ id: string; name: string }>(sql`
        SELECT "id", "name" FROM "Division" WHERE "isActive" = true ORDER BY "sortOrder" ASC`),
      db.many<{ id: string; name: string }>(sql`
        SELECT "id", "name" FROM "SalesRep" WHERE "isActive" = true ORDER BY "name" ASC`),
      canViewAudit
        ? db.many<Pick<AuditLogRow, 'id' | 'summary' | 'createdAt' | 'actorEmail' | 'ipAddress'>>(sql`
            SELECT "id", "summary", "createdAt", "actorEmail", "ipAddress"
            FROM "AuditLog"
            WHERE "action" LIKE ${'user.%'}
            ORDER BY "createdAt" DESC
            LIMIT 20`)
        : Promise.resolve([]),
    ])

    const rolesByUser = new Map<string, string[]>()
    for (const r of userRoles) rolesByUser.set(r.userId, [...(rolesByUser.get(r.userId) ?? []), r.name])
    const divisionsByUser = new Map<string, string[]>()
    for (const d of userDivisions) divisionsByUser.set(d.userId, [...(divisionsByUser.get(d.userId) ?? []), d.name])

    // A role row with no permission rows grants nothing; only a role missing
    // from the Role table falls back to its proposed defaults.
    const stored = new Map<string, string[]>()
    for (const row of roles) {
      const list = stored.get(row.name) ?? []
      if (row.permission) list.push(row.permission)
      stored.set(row.name, list)
    }
    const rolePermissions = Object.fromEntries(
      (Object.keys(ROLE_LABELS) as RoleName[]).map((roleName) => [
        roleName,
        stored.get(roleName) ?? DEFAULT_ROLE_PERMISSIONS[roleName],
      ]),
    ) as Record<RoleName, string[]>

    return {
      dbReady: true,
      currentUserId: admin.id,
      canViewAudit,
      users: users.map(
        (user): UserListItem => ({
          id: user.id,
          name: user.name,
          email: user.email,
          isActive: user.isActive,
          mustChangePassword: user.mustChangePassword,
          lastLoginAt: user.lastLoginAt ? user.lastLoginAt.toISOString() : null,
          lockedUntil: user.lockedUntil ? user.lockedUntil.toISOString() : null,
          roles: rolesByUser.get(user.id) ?? [],
          divisionNames: divisionsByUser.get(user.id) ?? [],
          salesRepName: user.salesRepName,
          activeSessions: user.activeSessions,
        }),
      ),
      divisions,
      salesReps,
      rolePermissions,
      auditEntries: auditEntries.map((entry) => ({
        id: entry.id,
        summary: entry.summary,
        createdAt: entry.createdAt.toISOString(),
        actorEmail: entry.actorEmail,
        ipAddress: entry.ipAddress,
      })),
    }
  }),
)

// ---------------------------------------------------------------------------
// POST /api/users - create a user
// ---------------------------------------------------------------------------

const createUserSchema = z.object({
  name: z.string().trim().min(2, 'Enter the person’s full name.').max(120),
  email: z.string().trim().toLowerCase().email('Enter a valid email address.').max(320),
  roles: z.array(z.enum(ROLE_VALUES)).min(1, 'Choose at least one role.'),
  salesRepId: z.string().optional().nullable(),
  divisionIds: z.array(z.string()).optional(),
})

usersRouter.post(
  '/',
  handler(async (req): Promise<ActionResult> => {
    const auth = await requireAdmin()
    if (!auth.ok) return auth.result
    const b = body(req)

    const parsed = createUserSchema.safeParse({
      name: field(b, 'name'),
      email: field(b, 'email'),
      roles: fieldAll(b, 'roles'),
      salesRepId: field(b, 'salesRepId') || null,
      divisionIds: fieldAll(b, 'divisionIds').filter((v) => typeof v === 'string' && v.length > 0),
    })

    if (!parsed.success) {
      return { ok: false, message: parsed.error.issues[0]?.message ?? 'Check the details and try again.' }
    }

    const existing = await db.maybeOne(sql`SELECT "id" FROM "User" WHERE "email" = ${parsed.data.email}`)
    if (existing) {
      return { ok: false, message: `An account already exists for ${parsed.data.email}.` }
    }

    // A one-time password is generated rather than chosen by the administrator,
    // so it is never guessable and never reused from another system.
    const temporaryPassword = `${randomToken(9).slice(0, 14)}Aa1!`
    const passwordHash = await hashPassword(temporaryPassword)

    const roles = await db.many<RoleRow>(sql`SELECT * FROM "Role" WHERE "name" = ANY(${parsed.data.roles})`)

    const user = await transaction(async (tx) => {
      const created = await insert<UserRow>(
        'User',
        {
          name: parsed.data.name,
          email: parsed.data.email,
          passwordHash,
          mustChangePassword: true,
          salesRepId: parsed.data.salesRepId || null,
        },
        tx,
      )
      await insertMany(
        'UserRole',
        roles.map((role) => ({ userId: created.id, roleId: role.id, assignedBy: auth.user.email })),
        tx,
      )
      await insertMany(
        'UserDivision',
        (parsed.data.divisionIds ?? []).map((divisionId) => ({ userId: created.id, divisionId })),
        tx,
      )
      return created
    })

    await recordAudit({
      action: AUDIT_ACTIONS.USER_CREATED,
      summary: `${auth.user.name} created the account for ${parsed.data.name} (${parsed.data.email}) with role(s) ${parsed.data.roles.join(', ')}.`,
      actor: auth.user,
      entityType: 'User',
      entityId: user.id,
      metadata: { roles: parsed.data.roles, divisionIds: parsed.data.divisionIds ?? [] },
    })

    return {
      ok: true,
      message: `Account created for ${parsed.data.name}. Give them this one-time password; they must change it at first sign-in.`,
      secret: temporaryPassword,
    }
  }),
)

// ---------------------------------------------------------------------------
// PUT /api/users/roles/:roleName/permissions, POST /api/users/roles/:roleName/reset
// (registered before the /:userId routes so "roles" is never read as a user id)
// ---------------------------------------------------------------------------

const permissionsSchema = z.object({
  roleName: z.enum(ROLE_VALUES),
  permissions: z.array(z.string()),
})

usersRouter.put(
  '/roles/:roleName/permissions',
  handler(async (req): Promise<ActionResult> => {
    const auth = await requireAdmin()
    if (!auth.ok) return auth.result

    const parsed = permissionsSchema.safeParse({
      roleName: req.params.roleName,
      permissions: fieldAll(body(req), 'permissions'),
    })
    if (!parsed.success) return { ok: false, message: 'Those permissions could not be read.' }

    const known = new Set<string>(ALL_PERMISSIONS)
    const requested = parsed.data.permissions.filter((p) => known.has(p))

    const role = await db.maybeOne<RoleRow>(sql`SELECT * FROM "Role" WHERE "name" = ${parsed.data.roleName}`)
    if (!role) return { ok: false, message: 'That role no longer exists.' }

    // The owner role must keep administration, or the system becomes
    // unadministrable with no route back.
    if (parsed.data.roleName === 'OWNER' && !requested.includes(PERMISSIONS.USERS_MANAGE)) {
      return {
        ok: false,
        message: 'The Owner role must keep "Manage users, roles and permissions". Without it nobody could undo this.',
      }
    }

    const previous = await db.many<{ permission: string }>(
      sql`SELECT "permission" FROM "RolePermission" WHERE "roleId" = ${role.id}`,
    )

    await transaction(async (tx) => {
      await tx.exec(sql`DELETE FROM "RolePermission" WHERE "roleId" = ${role.id}`)
      await insertMany(
        'RolePermission',
        requested.map((permission) => ({ roleId: role.id, permission })),
        tx,
      )
    })

    await recordAudit({
      action: AUDIT_ACTIONS.ROLE_PERMISSIONS_CHANGED,
      summary: `${auth.user.name} changed the permissions for the ${parsed.data.roleName} role.`,
      actor: auth.user,
      entityType: 'Role',
      entityId: role.id,
      metadata: {
        from: previous.map((p) => p.permission),
        to: requested,
        note: 'Sales representatives are additionally prevented in code from ever holding margin or cross-rep access.',
      },
    })

    return {
      ok: true,
      message: `Permissions updated for ${parsed.data.roleName}. Users holding this role see the change at their next request.`,
    }
  }),
)

usersRouter.post(
  '/roles/:roleName/reset',
  handler(async (req): Promise<ActionResult> => {
    const auth = await requireAdmin()
    if (!auth.ok) return auth.result

    const roleName = String(req.params.roleName ?? '') as RoleName
    if (!ROLE_VALUES.includes(roleName as (typeof ROLE_VALUES)[number])) {
      return { ok: false, message: 'Unknown role.' }
    }

    const role = await db.maybeOne<RoleRow>(sql`SELECT * FROM "Role" WHERE "name" = ${roleName}`)
    if (!role) return { ok: false, message: 'That role no longer exists.' }

    const defaults = DEFAULT_ROLE_PERMISSIONS[roleName]

    await transaction(async (tx) => {
      await tx.exec(sql`DELETE FROM "RolePermission" WHERE "roleId" = ${role.id}`)
      await insertMany(
        'RolePermission',
        defaults.map((permission) => ({ roleId: role.id, permission })),
        tx,
      )
    })

    await recordAudit({
      action: AUDIT_ACTIONS.ROLE_PERMISSIONS_CHANGED,
      summary: `${auth.user.name} reset the ${roleName} role to its proposed default permissions.`,
      actor: auth.user,
      entityType: 'Role',
      entityId: role.id,
      metadata: { to: defaults },
    })

    return { ok: true, message: `${roleName} reset to the proposed defaults.` }
  }),
)

// ---------------------------------------------------------------------------
// PUT /api/users/:userId/roles
// ---------------------------------------------------------------------------

const updateRolesSchema = z.object({
  userId: z.string().min(1),
  roles: z.array(z.enum(ROLE_VALUES)).min(1, 'Every user must hold at least one role.'),
})

usersRouter.put(
  '/:userId/roles',
  handler(async (req): Promise<ActionResult> => {
    const auth = await requireAdmin()
    if (!auth.ok) return auth.result

    const parsed = updateRolesSchema.safeParse({
      userId: req.params.userId,
      roles: fieldAll(body(req), 'roles'),
    })
    if (!parsed.success) {
      return { ok: false, message: parsed.error.issues[0]?.message ?? 'Choose at least one role.' }
    }

    const target = await db.maybeOne<UserRow>(sql`SELECT * FROM "User" WHERE "id" = ${parsed.data.userId}`)
    if (!target) return { ok: false, message: 'That user no longer exists.' }

    const previousRoles = await roleNamesOf(target.id)

    // Guard against removing the last owner, which would lock everyone out of
    // administration with no way back in.
    if (previousRoles.includes('OWNER') && !parsed.data.roles.includes('OWNER')) {
      const ownerCount = await activeOwnerCount()
      if (ownerCount <= 1) {
        return {
          ok: false,
          message:
            'This is the only active owner. Give another user the Owner role first, or nobody will be able to administer the system.',
        }
      }
    }

    const roles = await db.many<RoleRow>(sql`SELECT * FROM "Role" WHERE "name" = ANY(${parsed.data.roles})`)

    await transaction(async (tx) => {
      await tx.exec(sql`DELETE FROM "UserRole" WHERE "userId" = ${target.id}`)
      await insertMany(
        'UserRole',
        roles.map((role) => ({ userId: target.id, roleId: role.id, assignedBy: auth.user.email })),
        tx,
      )
    })

    // A role change must take effect immediately, so existing sessions are
    // revoked rather than carrying the old permissions until they expire.
    const revoked = await revokeAllSessions(target.id)

    await recordAudit({
      action: AUDIT_ACTIONS.USER_ROLES_CHANGED,
      summary: `${auth.user.name} changed ${target.name}'s roles from ${previousRoles.join(', ') || 'none'} to ${parsed.data.roles.join(', ')}.`,
      actor: auth.user,
      entityType: 'User',
      entityId: target.id,
      metadata: { from: previousRoles, to: parsed.data.roles, sessionsRevoked: revoked },
    })

    return {
      ok: true,
      message: `${target.name}'s roles updated. ${revoked > 0 ? `${revoked} active ${revoked === 1 ? 'session was' : 'sessions were'} signed out so the change takes effect now.` : ''}`,
    }
  }),
)

// ---------------------------------------------------------------------------
// PUT /api/users/:userId/active
// ---------------------------------------------------------------------------

usersRouter.put(
  '/:userId/active',
  handler(async (req): Promise<ActionResult> => {
    const auth = await requireAdmin()
    if (!auth.ok) return auth.result

    const userId = String(req.params.userId ?? '')
    const isActive = field(body(req), 'isActive')
    const makeActive = isActive === true || isActive === 'true'

    const target = await db.maybeOne<UserRow>(sql`SELECT * FROM "User" WHERE "id" = ${userId}`)
    if (!target) return { ok: false, message: 'That user no longer exists.' }

    if (target.id === auth.user.id && !makeActive) {
      return { ok: false, message: 'You cannot deactivate your own account.' }
    }

    if (!makeActive && (await roleNamesOf(target.id)).includes('OWNER')) {
      const ownerCount = await activeOwnerCount()
      if (ownerCount <= 1) {
        return {
          ok: false,
          message: 'This is the only active owner. Promote another user to Owner before deactivating this account.',
        }
      }
    }

    await db.exec(sql`UPDATE "User" SET "isActive" = ${makeActive} WHERE "id" = ${target.id}`)

    let revoked = 0
    if (!makeActive) revoked = await revokeAllSessions(target.id)

    await recordAudit({
      action: makeActive ? AUDIT_ACTIONS.USER_REACTIVATED : AUDIT_ACTIONS.USER_DEACTIVATED,
      summary: `${auth.user.name} ${makeActive ? 'reactivated' : 'deactivated'} the account for ${target.name} (${target.email}).`,
      actor: auth.user,
      entityType: 'User',
      entityId: target.id,
      metadata: { sessionsRevoked: revoked },
    })

    return {
      ok: true,
      message: makeActive
        ? `${target.name} can sign in again.`
        : `${target.name} has been deactivated and signed out of ${revoked} ${revoked === 1 ? 'session' : 'sessions'}.`,
    }
  }),
)

// ---------------------------------------------------------------------------
// POST /api/users/:userId/reset-password
// ---------------------------------------------------------------------------

usersRouter.post(
  '/:userId/reset-password',
  handler(async (req): Promise<ActionResult> => {
    const auth = await requireAdmin()
    if (!auth.ok) return auth.result

    const userId = String(req.params.userId ?? '')
    const target = await db.maybeOne<UserRow>(sql`SELECT * FROM "User" WHERE "id" = ${userId}`)
    if (!target) return { ok: false, message: 'That user no longer exists.' }

    const temporaryPassword = `${randomToken(9).slice(0, 14)}Aa1!`
    await db.exec(sql`
      UPDATE "User"
      SET "passwordHash" = ${await hashPassword(temporaryPassword)},
          "mustChangePassword" = true,
          "failedLoginCount" = 0,
          "lockedUntil" = NULL
      WHERE "id" = ${target.id}`)

    const revoked = await revokeAllSessions(target.id)

    await recordAudit({
      action: AUDIT_ACTIONS.USER_PASSWORD_RESET,
      summary: `${auth.user.name} reset the password for ${target.name} (${target.email}).`,
      actor: auth.user,
      entityType: 'User',
      entityId: target.id,
      metadata: { sessionsRevoked: revoked },
    })

    return {
      ok: true,
      message: `Password reset for ${target.name}. Give them this one-time password; they must change it at first sign-in.`,
      secret: temporaryPassword,
    }
  }),
)
