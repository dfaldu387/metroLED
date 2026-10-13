import { NextResponse } from 'next/server'
import { env } from './env'
import { safeEqual } from './crypto'

/**
 * Shared-secret authentication for the scheduler endpoints.
 *
 * The scheduler (Vercel Cron, a Kubernetes CronJob, or any HTTP scheduler)
 * sends `Authorization: Bearer <CRON_SECRET>`. The comparison is constant-time,
 * and a deployment with no CRON_SECRET refuses every request rather than
 * leaving the endpoints open.
 */
export function authorizeCron(request: Request): NextResponse | null {
  const secret = env().CRON_SECRET

  if (!secret) {
    return NextResponse.json(
      {
        error: 'NOT_CONFIGURED',
        message: 'CRON_SECRET is not set on this deployment, so scheduled endpoints are disabled.',
      },
      { status: 503 },
    )
  }

  const header = request.headers.get('authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''

  if (!token || !safeEqual(token, secret)) {
    return NextResponse.json({ error: 'UNAUTHORIZED', message: 'Invalid scheduler credentials.' }, { status: 401 })
  }

  return null
}
