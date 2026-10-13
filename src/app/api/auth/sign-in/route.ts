import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma, databaseReachable } from '@/lib/db'
import { verifyPassword } from '@/lib/auth/password'
import { createSession } from '@/lib/auth/session'
import { AUDIT_ACTIONS, recordAudit } from '@/lib/auth/audit'
import { DEFAULT_ROLE_PERMISSIONS, sanitizePermissions } from '@/lib/auth/permissions'
import { defaultLandingPage } from '@/lib/navigation'

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

const bodySchema = z.object({
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

export async function POST(request: Request) {
  if (!(await databaseReachable())) {
    return NextResponse.json(
      {
        ok: false,
        message:
          'The reporting database is not reachable, so sign-in is unavailable. Contact your administrator.',
      },
      { status: 503 },
    )
  }

  let parsed: z.infer<typeof bodySchema>
  try {
    parsed = bodySchema.parse(await request.json())
  } catch {
    return NextResponse.json(
      { ok: false, message: 'Enter a valid email address and your password.' },
      { status: 400 },
    )
  }

  const email = parsed.email.trim().toLowerCase()

  const user = await prisma.user.findUnique({
    where: { email },
    include: { roles: { include: { role: { include: { permissions: true } } } } },
  })

  const now = new Date()

  if (!user) {
    await verifyPassword(parsed.password, DUMMY_HASH)
    await recordAudit({
      action: AUDIT_ACTIONS.SIGN_IN_FAILED,
      summary: `Sign-in attempt for an unknown email address (${email}).`,
      actorEmail: email,
    })
    return NextResponse.json({ ok: false, message: GENERIC_FAILURE }, { status: 401 })
  }

  if (user.lockedUntil && user.lockedUntil > now) {
    const minutes = Math.max(1, Math.ceil((user.lockedUntil.getTime() - now.getTime()) / 60000))
    return NextResponse.json(
      {
        ok: false,
        message: `This account is temporarily locked after repeated failed attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}, or ask an owner to reset your password.`,
      },
      { status: 423 },
    )
  }

  const valid = await verifyPassword(parsed.password, user.passwordHash)

  if (!valid) {
    const failedCount = user.failedLoginCount + 1
    const shouldLock = failedCount >= MAX_FAILED_ATTEMPTS
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount: failedCount,
        lockedUntil: shouldLock ? new Date(now.getTime() + LOCK_MINUTES * 60 * 1000) : null,
      },
    })
    await recordAudit({
      action: AUDIT_ACTIONS.SIGN_IN_FAILED,
      summary: shouldLock
        ? `Incorrect password for ${user.email}. Account locked for ${LOCK_MINUTES} minutes after ${failedCount} failed attempts.`
        : `Incorrect password for ${user.email} (attempt ${failedCount}).`,
      actorEmail: user.email,
      entityType: 'User',
      entityId: user.id,
    })
    return NextResponse.json({ ok: false, message: GENERIC_FAILURE }, { status: 401 })
  }

  if (!user.isActive) {
    await recordAudit({
      action: AUDIT_ACTIONS.SIGN_IN_FAILED,
      summary: `Correct password supplied for deactivated account ${user.email}.`,
      actorEmail: user.email,
      entityType: 'User',
      entityId: user.id,
    })
    return NextResponse.json(
      {
        ok: false,
        message: 'This account has been deactivated. Ask an account owner to reactivate it.',
      },
      { status: 403 },
    )
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: now },
  })

  await createSession(user.id)

  await recordAudit({
    action: AUDIT_ACTIONS.SIGN_IN,
    summary: `${user.name} signed in.`,
    actor: { id: user.id, email: user.email, isDemo: false },
    entityType: 'User',
    entityId: user.id,
  })

  // Land the user on the first page their role can actually open.
  const roles = user.roles.map((r) => r.role.name)
  const granted = user.roles.flatMap((r) =>
    r.role.permissions.length > 0
      ? r.role.permissions.map((p) => p.permission)
      : DEFAULT_ROLE_PERMISSIONS[r.role.name],
  )
  const redirectTo = defaultLandingPage(sanitizePermissions(roles, granted))

  return NextResponse.json({
    ok: true,
    redirectTo,
    mustChangePassword: user.mustChangePassword,
  })
}
