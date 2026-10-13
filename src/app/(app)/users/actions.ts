'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import type { RoleName } from '@prisma/client'
import { prisma, databaseReachable } from '@/lib/db'
import { PERMISSIONS, ALL_PERMISSIONS, DEFAULT_ROLE_PERMISSIONS } from '@/lib/auth/permissions'
import { getSession, revokeAllSessions } from '@/lib/auth/session'
import { checkPasswordPolicy, hashPassword } from '@/lib/auth/password'
import { randomToken } from '@/lib/crypto'
import { AUDIT_ACTIONS, recordAudit } from '@/lib/auth/audit'

/**
 * User administration server actions.
 *
 * Every action re-checks the caller's permission on the server. The forms that
 * invoke them are already hidden from unauthorised users, but that is
 * presentation - these checks are the control.
 */

export interface ActionResult {
  ok: boolean
  message: string
  /** Shown once, for a generated password that is not stored in plain text. */
  secret?: string
}

async function requireAdmin(): Promise<
  { ok: true; user: NonNullable<Awaited<ReturnType<typeof getSession>>> } | { ok: false; result: ActionResult }
> {
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

const createUserSchema = z.object({
  name: z.string().trim().min(2, 'Enter the person’s full name.').max(120),
  email: z.string().trim().toLowerCase().email('Enter a valid email address.').max(320),
  roles: z.array(z.enum(ROLE_VALUES)).min(1, 'Choose at least one role.'),
  salesRepId: z.string().optional().nullable(),
  divisionIds: z.array(z.string()).optional(),
})

export async function createUser(formData: FormData): Promise<ActionResult> {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.result

  const parsed = createUserSchema.safeParse({
    name: formData.get('name'),
    email: formData.get('email'),
    roles: formData.getAll('roles'),
    salesRepId: formData.get('salesRepId') || null,
    divisionIds: formData.getAll('divisionIds').filter((v) => typeof v === 'string' && v.length > 0),
  })

  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Check the details and try again.' }
  }

  const existing = await prisma.user.findUnique({ where: { email: parsed.data.email } })
  if (existing) {
    return { ok: false, message: `An account already exists for ${parsed.data.email}.` }
  }

  // A one-time password is generated rather than chosen by the administrator,
  // so it is never guessable and never reused from another system.
  const temporaryPassword = `${randomToken(9).slice(0, 14)}Aa1!`
  const passwordHash = await hashPassword(temporaryPassword)

  const roles = await prisma.role.findMany({ where: { name: { in: parsed.data.roles as RoleName[] } } })

  const user = await prisma.user.create({
    data: {
      name: parsed.data.name,
      email: parsed.data.email,
      passwordHash,
      mustChangePassword: true,
      salesRepId: parsed.data.salesRepId || null,
      roles: { create: roles.map((role) => ({ roleId: role.id, assignedBy: auth.user.email })) },
      divisionAccess: {
        create: (parsed.data.divisionIds ?? []).map((divisionId) => ({ divisionId })),
      },
    },
    select: { id: true },
  })

  await recordAudit({
    action: AUDIT_ACTIONS.USER_CREATED,
    summary: `${auth.user.name} created the account for ${parsed.data.name} (${parsed.data.email}) with role(s) ${parsed.data.roles.join(', ')}.`,
    actor: auth.user,
    entityType: 'User',
    entityId: user.id,
    metadata: { roles: parsed.data.roles, divisionIds: parsed.data.divisionIds ?? [] },
  })

  revalidatePath('/users')

  return {
    ok: true,
    message: `Account created for ${parsed.data.name}. Give them this one-time password; they must change it at first sign-in.`,
    secret: temporaryPassword,
  }
}

const updateRolesSchema = z.object({
  userId: z.string().min(1),
  roles: z.array(z.enum(ROLE_VALUES)).min(1, 'Every user must hold at least one role.'),
})

export async function updateUserRoles(formData: FormData): Promise<ActionResult> {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.result

  const parsed = updateRolesSchema.safeParse({
    userId: formData.get('userId'),
    roles: formData.getAll('roles'),
  })
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Choose at least one role.' }
  }

  const target = await prisma.user.findUnique({
    where: { id: parsed.data.userId },
    include: { roles: { include: { role: true } } },
  })
  if (!target) return { ok: false, message: 'That user no longer exists.' }

  const previousRoles = target.roles.map((r) => r.role.name)

  // Guard against removing the last owner, which would lock everyone out of
  // administration with no way back in.
  if (previousRoles.includes('OWNER') && !parsed.data.roles.includes('OWNER')) {
    const ownerCount = await prisma.userRole.count({
      where: { role: { name: 'OWNER' }, user: { isActive: true } },
    })
    if (ownerCount <= 1) {
      return {
        ok: false,
        message:
          'This is the only active owner. Give another user the Owner role first, or nobody will be able to administer the system.',
      }
    }
  }

  const roles = await prisma.role.findMany({ where: { name: { in: parsed.data.roles as RoleName[] } } })

  await prisma.$transaction([
    prisma.userRole.deleteMany({ where: { userId: target.id } }),
    prisma.userRole.createMany({
      data: roles.map((role) => ({ userId: target.id, roleId: role.id, assignedBy: auth.user.email })),
    }),
  ])

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

  revalidatePath('/users')
  return {
    ok: true,
    message: `${target.name}'s roles updated. ${revoked > 0 ? `${revoked} active ${revoked === 1 ? 'session was' : 'sessions were'} signed out so the change takes effect now.` : ''}`,
  }
}

export async function setUserActive(formData: FormData): Promise<ActionResult> {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.result

  const userId = String(formData.get('userId') ?? '')
  const makeActive = formData.get('isActive') === 'true'

  const target = await prisma.user.findUnique({
    where: { id: userId },
    include: { roles: { include: { role: true } } },
  })
  if (!target) return { ok: false, message: 'That user no longer exists.' }

  if (target.id === auth.user.id && !makeActive) {
    return { ok: false, message: 'You cannot deactivate your own account.' }
  }

  if (!makeActive && target.roles.some((r) => r.role.name === 'OWNER')) {
    const ownerCount = await prisma.userRole.count({
      where: { role: { name: 'OWNER' }, user: { isActive: true } },
    })
    if (ownerCount <= 1) {
      return {
        ok: false,
        message: 'This is the only active owner. Promote another user to Owner before deactivating this account.',
      }
    }
  }

  await prisma.user.update({ where: { id: target.id }, data: { isActive: makeActive } })

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

  revalidatePath('/users')
  return {
    ok: true,
    message: makeActive
      ? `${target.name} can sign in again.`
      : `${target.name} has been deactivated and signed out of ${revoked} ${revoked === 1 ? 'session' : 'sessions'}.`,
  }
}

export async function resetUserPassword(formData: FormData): Promise<ActionResult> {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.result

  const userId = String(formData.get('userId') ?? '')
  const target = await prisma.user.findUnique({ where: { id: userId } })
  if (!target) return { ok: false, message: 'That user no longer exists.' }

  const temporaryPassword = `${randomToken(9).slice(0, 14)}Aa1!`
  await prisma.user.update({
    where: { id: target.id },
    data: {
      passwordHash: await hashPassword(temporaryPassword),
      mustChangePassword: true,
      failedLoginCount: 0,
      lockedUntil: null,
    },
  })

  const revoked = await revokeAllSessions(target.id)

  await recordAudit({
    action: AUDIT_ACTIONS.USER_PASSWORD_RESET,
    summary: `${auth.user.name} reset the password for ${target.name} (${target.email}).`,
    actor: auth.user,
    entityType: 'User',
    entityId: target.id,
    metadata: { sessionsRevoked: revoked },
  })

  revalidatePath('/users')
  return {
    ok: true,
    message: `Password reset for ${target.name}. Give them this one-time password; they must change it at first sign-in.`,
    secret: temporaryPassword,
  }
}

const permissionsSchema = z.object({
  roleName: z.enum(ROLE_VALUES),
  permissions: z.array(z.string()),
})

export async function updateRolePermissions(formData: FormData): Promise<ActionResult> {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.result

  const parsed = permissionsSchema.safeParse({
    roleName: formData.get('roleName'),
    permissions: formData.getAll('permissions'),
  })
  if (!parsed.success) return { ok: false, message: 'Those permissions could not be read.' }

  const known = new Set<string>(ALL_PERMISSIONS)
  const requested = parsed.data.permissions.filter((p) => known.has(p))

  const role = await prisma.role.findUnique({ where: { name: parsed.data.roleName } })
  if (!role) return { ok: false, message: 'That role no longer exists.' }

  // The owner role must keep administration, or the system becomes
  // unadministrable with no route back.
  if (parsed.data.roleName === 'OWNER' && !requested.includes(PERMISSIONS.USERS_MANAGE)) {
    return {
      ok: false,
      message: 'The Owner role must keep "Manage users, roles and permissions". Without it nobody could undo this.',
    }
  }

  const previous = await prisma.rolePermission.findMany({
    where: { roleId: role.id },
    select: { permission: true },
  })

  await prisma.$transaction([
    prisma.rolePermission.deleteMany({ where: { roleId: role.id } }),
    prisma.rolePermission.createMany({
      data: requested.map((permission) => ({ roleId: role.id, permission })),
    }),
  ])

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

  revalidatePath('/users')
  return {
    ok: true,
    message: `Permissions updated for ${parsed.data.roleName}. Users holding this role see the change at their next request.`,
  }
}

export async function resetRolePermissionsToDefault(formData: FormData): Promise<ActionResult> {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.result

  const roleName = String(formData.get('roleName') ?? '') as RoleName
  if (!ROLE_VALUES.includes(roleName as (typeof ROLE_VALUES)[number])) {
    return { ok: false, message: 'Unknown role.' }
  }

  const role = await prisma.role.findUnique({ where: { name: roleName } })
  if (!role) return { ok: false, message: 'That role no longer exists.' }

  const defaults = DEFAULT_ROLE_PERMISSIONS[roleName]

  await prisma.$transaction([
    prisma.rolePermission.deleteMany({ where: { roleId: role.id } }),
    prisma.rolePermission.createMany({
      data: defaults.map((permission) => ({ roleId: role.id, permission })),
    }),
  ])

  await recordAudit({
    action: AUDIT_ACTIONS.ROLE_PERMISSIONS_CHANGED,
    summary: `${auth.user.name} reset the ${roleName} role to its proposed default permissions.`,
    actor: auth.user,
    entityType: 'Role',
    entityId: role.id,
    metadata: { to: defaults },
  })

  revalidatePath('/users')
  return { ok: true, message: `${roleName} reset to the proposed defaults.` }
}

const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password.'),
    newPassword: z.string().min(1, 'Enter a new password.'),
    confirmPassword: z.string().min(1, 'Confirm the new password.'),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'The two new passwords do not match.',
    path: ['confirmPassword'],
  })

/** Change your own password. Available to every signed-in user. */
export async function changeOwnPassword(formData: FormData): Promise<ActionResult> {
  const user = await getSession()
  if (!user) return { ok: false, message: 'Your session has expired. Sign in and try again.' }
  if (user.isDemo) return { ok: false, message: 'A demo session has no password to change.' }
  if (!(await databaseReachable())) {
    return { ok: false, message: 'The database is unreachable, so the password cannot be changed.' }
  }

  const parsed = changePasswordSchema.safeParse({
    currentPassword: formData.get('currentPassword'),
    newPassword: formData.get('newPassword'),
    confirmPassword: formData.get('confirmPassword'),
  })
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Check the details and try again.' }
  }

  const policy = checkPasswordPolicy(parsed.data.newPassword)
  if (!policy.ok) {
    return { ok: false, message: `That password is not strong enough. ${policy.problems.join(' ')}` }
  }

  const record = await prisma.user.findUnique({ where: { id: user.id }, select: { passwordHash: true } })
  if (!record) return { ok: false, message: 'Your account no longer exists.' }

  const { verifyPassword } = await import('@/lib/auth/password')
  if (!(await verifyPassword(parsed.data.currentPassword, record.passwordHash))) {
    return { ok: false, message: 'Your current password is not correct.' }
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(parsed.data.newPassword), mustChangePassword: false },
  })

  await recordAudit({
    action: AUDIT_ACTIONS.PASSWORD_CHANGED,
    summary: `${user.name} changed their own password.`,
    actor: user,
    entityType: 'User',
    entityId: user.id,
  })

  revalidatePath('/account')
  return { ok: true, message: 'Your password has been changed.' }
}
