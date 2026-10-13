import type { RequestHandler } from 'express'
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
export const authorizeCron: RequestHandler = (req, res, next) => {
  const secret = env().CRON_SECRET

  if (!secret) {
    res.status(503).json({
      error: 'NOT_CONFIGURED',
      message: 'CRON_SECRET is not set on this deployment, so scheduled endpoints are disabled.',
    })
    return
  }

  const header = req.get('authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''

  if (!token || !safeEqual(token, secret)) {
    res.status(401).json({ error: 'UNAUTHORIZED', message: 'Invalid scheduler credentials.' })
    return
  }

  next()
}
