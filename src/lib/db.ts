import { PrismaClient } from '@prisma/client'
import { env } from './env'

/**
 * Prisma client singleton.
 *
 * Next.js hot-reloads modules in development, which would otherwise open a new
 * connection pool on every edit until PostgreSQL refuses connections.
 */

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
  dbProbe: { checkedAt: number; reachable: boolean } | undefined
}

export const prisma: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: env().APP_ENV === 'development' ? ['warn', 'error'] : ['error'],
  })

if (env().APP_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}

/**
 * How long a probe result is trusted.
 *
 * A success is re-checked often, because a database that goes down should be
 * noticed quickly. A FAILURE is cached for longer: a database that is down
 * stays down for more than a few seconds, and re-attempting the connection on
 * practically every request adds its full timeout to every page load for no
 * benefit. `force` bypasses both, which is what the manual retry paths use.
 */
const PROBE_TTL_OK_MS = 15_000
const PROBE_TTL_FAILED_MS = 60_000

/**
 * Cheap connectivity probe, cached.
 *
 * The result decides whether the application serves live figures or falls back
 * to the labelled demo dataset, so it must never throw and must not add a
 * round trip to every query.
 */
export async function databaseReachable(force = false): Promise<boolean> {
  if (!env().DATABASE_URL) return false

  const cachedProbe = globalForPrisma.dbProbe
  const now = Date.now()
  if (!force && cachedProbe) {
    const ttl = cachedProbe.reachable ? PROBE_TTL_OK_MS : PROBE_TTL_FAILED_MS
    if (now - cachedProbe.checkedAt < ttl) return cachedProbe.reachable
  }

  let reachable = false
  try {
    await prisma.$queryRaw`SELECT 1`
    reachable = true
  } catch {
    reachable = false
  }

  globalForPrisma.dbProbe = { checkedAt: now, reachable }
  return reachable
}

/** Invalidate the cached connectivity probe (after a migration, for example). */
export function resetDatabaseProbe(): void {
  globalForPrisma.dbProbe = undefined
}

/**
 * Converts a Prisma `Decimal` (or null) to a JavaScript number.
 *
 * Decimal is used for storage so no cent is lost to binary floating point.
 * Aggregation and presentation happen in `number`, which is exact for every
 * value this business will ever report (well under 2^53 cents).
 */
export function toNumber(value: { toString(): string } | null | undefined): number {
  if (value === null || value === undefined) return 0
  const n = Number(value.toString())
  return Number.isFinite(n) ? n : 0
}

export function toNullableNumber(value: { toString(): string } | null | undefined): number | null {
  if (value === null || value === undefined) return null
  const n = Number(value.toString())
  return Number.isFinite(n) ? n : null
}
