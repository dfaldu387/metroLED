import crypto from 'node:crypto'
import { cookies, headers } from 'next/headers'
import type { RoleName } from '@prisma/client'
import { prisma, databaseReachable } from '../db'
import { env, demoDataAllowed } from '../env'
import { hashToken, randomToken, safeEqual } from '../crypto'
import {
  DEFAULT_ROLE_PERMISSIONS,
  ROLE_LABELS,
  sanitizePermissions,
  type Permission,
} from './permissions'

export const SESSION_COOKIE = 'metroled_session'
export const DEMO_COOKIE = 'metroled_demo'

export interface SessionUser {
  id: string
  email: string
  name: string
  roles: RoleName[]
  roleLabel: string
  permissions: Set<Permission>
  /** Set when the user's data must be scoped to one sales representative. */
  salesRepId: string | null
  /** Empty array means "all divisions". */
  divisionIds: string[]
  mustChangePassword: boolean
  timezone: string
  /**
   * True when this identity comes from the labelled demo mode rather than a
   * database-backed user account. Demo identities can never be created in
   * production and are shown with a persistent banner.
   */
  isDemo: boolean
}

export function hasPermission(user: SessionUser | null, permission: Permission): boolean {
  return Boolean(user?.permissions.has(permission))
}

export function hasAnyPermission(user: SessionUser | null, permissions: Permission[]): boolean {
  if (!user) return false
  return permissions.some((p) => user.permissions.has(p))
}

// ---------------------------------------------------------------------------
// Demo identities
// ---------------------------------------------------------------------------

export const DEMO_PERSONAS: { role: RoleName; name: string; email: string; description: string }[] = [
  {
    role: 'OWNER',
    name: 'Ali Jooma',
    email: 'ali@metroled.demo',
    description: 'Full access, including gross margin and administration.',
  },
  {
    role: 'FINANCE',
    name: 'Farida',
    email: 'farida@metroled.demo',
    description: 'Revenue, accounts receivable and approved gross margin.',
  },
  {
    role: 'ECOMMERCE',
    name: 'Sabir',
    email: 'sabir@metroled.demo',
    description: 'Eco LED Mart reporting only.',
  },
  {
    role: 'SALES_REP',
    name: 'Sales Representative',
    email: 'rep@metroled.demo',
    description: 'Own sales data only. No profit or gross margin.',
  },
  {
    role: 'OPERATIONS',
    name: 'Operations',
    email: 'ops@metroled.demo',
    description: 'Integration health and operational reporting.',
  },
]

function signDemoValue(role: string): string {
  return crypto.createHmac('sha256', env().SESSION_SECRET).update(`demo:${role}`).digest('hex')
}

function demoCookieValue(role: RoleName): string {
  return `${role}.${signDemoValue(role)}`
}

function parseDemoCookie(value: string | undefined): RoleName | null {
  if (!value) return null
  const dot = value.lastIndexOf('.')
  if (dot <= 0) return null
  const role = value.slice(0, dot)
  const signature = value.slice(dot + 1)
  if (!DEMO_PERSONAS.some((p) => p.role === role)) return null
  if (!safeEqual(signature, signDemoValue(role))) return null
  return role as RoleName
}

function buildDemoUser(role: RoleName): SessionUser {
  const persona = DEMO_PERSONAS.find((p) => p.role === role) ?? DEMO_PERSONAS[0]!
  const permissions = sanitizePermissions([role], DEFAULT_ROLE_PERMISSIONS[role])
  return {
    id: `demo-${role.toLowerCase()}`,
    email: persona.email,
    name: persona.name,
    roles: [role],
    roleLabel: ROLE_LABELS[role],
    permissions,
    // The demo sales rep is scoped to a single rep from the demo dataset so the
    // restriction is visible when reviewing the interface.
    salesRepId: role === 'SALES_REP' ? 'demo-rep-1' : null,
    divisionIds: role === 'ECOMMERCE' ? ['demo-division-eco'] : [],
    mustChangePassword: false,
    timezone: 'America/New_York',
    isDemo: true,
  }
}

// ---------------------------------------------------------------------------
// Session lifecycle
// ---------------------------------------------------------------------------

async function requestMeta(): Promise<{ ip: string | null; userAgent: string | null }> {
  try {
    const h = await headers()
    const forwarded = h.get('x-forwarded-for')
    const ip = forwarded ? (forwarded.split(',')[0] ?? '').trim() || null : h.get('x-real-ip')
    return { ip, userAgent: h.get('user-agent') }
  } catch {
    return { ip: null, userAgent: null }
  }
}

/** Issues a database-backed session and sets the cookie. */
export async function createSession(userId: string): Promise<void> {
  const token = randomToken(32)
  const ttlHours = env().SESSION_TTL_HOURS
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000)
  const { ip, userAgent } = await requestMeta()

  await prisma.session.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt,
      ipAddress: ip,
      userAgent: userAgent?.slice(0, 500) ?? null,
    },
  })

  const jar = await cookies()
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: env().APP_URL.startsWith('https://'),
    path: '/',
    expires: expiresAt,
  })
  jar.delete(DEMO_COOKIE)
}

export async function createDemoSession(role: RoleName): Promise<void> {
  if (!demoDataAllowed()) {
    throw new Error('Demo sign-in is disabled in this environment.')
  }
  const jar = await cookies()
  jar.set(DEMO_COOKIE, demoCookieValue(role), {
    httpOnly: true,
    sameSite: 'lax',
    secure: env().APP_URL.startsWith('https://'),
    path: '/',
    maxAge: 60 * 60 * 8,
  })
  jar.delete(SESSION_COOKIE)
}

export async function destroySession(): Promise<void> {
  const jar = await cookies()
  const token = jar.get(SESSION_COOKIE)?.value
  if (token && (await databaseReachable())) {
    try {
      await prisma.session.updateMany({
        where: { tokenHash: hashToken(token), revokedAt: null },
        data: { revokedAt: new Date() },
      })
    } catch {
      // A sign-out must always clear the cookie, even if the database is down.
    }
  }
  jar.delete(SESSION_COOKIE)
  jar.delete(DEMO_COOKIE)
}

/** Revokes every session for a user. Used when a role or password changes. */
export async function revokeAllSessions(userId: string): Promise<number> {
  const result = await prisma.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  })
  return result.count
}

let lastSeenTouch = new Map<string, number>()
const TOUCH_INTERVAL_MS = 5 * 60 * 1000

/**
 * Resolves the signed-in user, or null.
 *
 * Reads the real session first so that a demo cookie can never shadow a real
 * account. The returned permission set is always passed through
 * `sanitizePermissions`, so a bad row in `RolePermission` cannot grant a sales
 * representative access to margin data.
 */
export async function getSession(): Promise<SessionUser | null> {
  const jar = await cookies()
  const token = jar.get(SESSION_COOKIE)?.value

  if (token && (await databaseReachable())) {
    const session = await prisma.session.findUnique({
      where: { tokenHash: hashToken(token) },
      include: {
        user: {
          include: {
            roles: { include: { role: { include: { permissions: true } } } },
            divisionAccess: true,
          },
        },
      },
    })

    if (
      session &&
      !session.revokedAt &&
      session.expiresAt > new Date() &&
      session.user.isActive &&
      (!session.user.lockedUntil || session.user.lockedUntil < new Date())
    ) {
      const user = session.user
      const roles = user.roles.map((r) => r.role.name)
      const granted = user.roles.flatMap((r) => r.role.permissions.map((p) => p.permission))
      const permissions = sanitizePermissions(roles, granted)

      // Refresh `lastSeenAt` at most every few minutes, not on every request.
      const now = Date.now()
      const last = lastSeenTouch.get(session.id) ?? 0
      if (now - last > TOUCH_INTERVAL_MS) {
        lastSeenTouch.set(session.id, now)
        if (lastSeenTouch.size > 500) lastSeenTouch = new Map([[session.id, now]])
        prisma.session
          .update({ where: { id: session.id }, data: { lastSeenAt: new Date() } })
          .catch(() => undefined)
      }

      return {
        id: user.id,
        email: user.email,
        name: user.name,
        roles,
        roleLabel: roles.map((r) => ROLE_LABELS[r]).join(', ') || 'No role assigned',
        permissions,
        salesRepId: user.salesRepId,
        divisionIds: user.divisionAccess.map((d) => d.divisionId),
        mustChangePassword: user.mustChangePassword,
        timezone: user.timezone,
        isDemo: false,
      }
    }
  }

  if (demoDataAllowed()) {
    const role = parseDemoCookie(jar.get(DEMO_COOKIE)?.value)
    if (role) return buildDemoUser(role)
  }

  return null
}
