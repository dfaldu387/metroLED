import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import cookieParser from 'cookie-parser'
import { requestContextMiddleware } from './lib/http/context'
import { errorHandler } from './lib/http/errors'
import { authRouter } from './routes/auth'
import { analyticsPagesRouter } from './routes/pages/analytics'
import { operationsPagesRouter } from './routes/pages/operations'
import { settingsRouter } from './routes/settings'
import { usersRouter } from './routes/users'
import { accountRouter } from './routes/account'
import { askRouter } from './routes/ask'
import { briefRouter } from './routes/brief'
import { syncRouter } from './routes/sync'
import { cronRouter } from './routes/cron'
import { integrationsRouter } from './routes/integrations'
import { notificationsRouter } from './routes/notifications'
import { webhooksRouter } from './routes/webhooks'

/**
 * Express application: the JSON API under /api and, in production, the built
 * React client (client/dist) with an index.html fallback for client routes.
 *
 * Client and API are served from one origin, so the session cookie stays
 * SameSite=Lax/httpOnly and no CORS is needed. In development Vite proxies
 * /api to this server for the same effect.
 */
export function createApp(): express.Express {
  const app = express()
  app.disable('x-powered-by')
  app.set('trust proxy', 1)

  app.use((_req, res, next) => {
    res.set({
      'X-Frame-Options': 'DENY',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    })
    next()
  })

  app.use(cookieParser())
  app.use(requestContextMiddleware)

  // Webhooks verify an HMAC over the exact bytes received, so they get the
  // raw body (req.body is a Buffer) and are mounted before the JSON parser.
  app.use('/api/webhooks', express.raw({ type: '*/*', limit: '2mb' }), webhooksRouter)

  app.use(express.json({ limit: '1mb' }))
  app.use(express.urlencoded({ extended: false, limit: '1mb' }))

  // API responses carry business figures; never let a cache serve them stale.
  app.use('/api', (_req, res, next) => {
    res.set('Cache-Control', 'no-store')
    next()
  })

  app.use('/api/auth', authRouter)
  app.use('/api/pages', analyticsPagesRouter)
  app.use('/api/pages', operationsPagesRouter)
  app.use('/api/settings', settingsRouter)
  app.use('/api/users', usersRouter)
  app.use('/api/account', accountRouter)
  app.use('/api/ask', askRouter)
  app.use('/api/brief', briefRouter)
  app.use('/api/sync', syncRouter)
  app.use('/api/cron', cronRouter)
  app.use('/api/integrations', integrationsRouter)
  app.use('/api/notifications', notificationsRouter)

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'NOT_FOUND', message: 'No such API endpoint.' })
  })

  // Built client (production). `npm run build` writes it to client/dist.
  // Resolved from this file, which is server/src/app.ts in development and
  // server/dist/src/index.js once bundled; CLIENT_DIST overrides both.
  const here = path.dirname(fileURLToPath(import.meta.url))
  const clientDist =
    process.env.CLIENT_DIST ??
    [path.resolve(here, '../../client/dist'), path.resolve(here, '../../../client/dist')].find((dir) =>
      fs.existsSync(path.join(dir, 'index.html')),
    )
  if (clientDist) {
    app.get('/sw.js', (_req, res, next) => {
      res.set('Cache-Control', 'public, max-age=0, must-revalidate')
      next()
    })
    app.use(
      express.static(clientDist, {
        index: false,
        setHeaders(res, file) {
          // Vite emits content-hashed assets; everything else revalidates.
          if (file.includes(`${path.sep}assets${path.sep}`)) {
            res.set('Cache-Control', 'public, max-age=31536000, immutable')
          }
        },
      }),
    )
    app.get(/^(?!\/api\/).*/, (_req, res) => {
      res.set('Cache-Control', 'no-cache')
      res.sendFile(path.join(clientDist, 'index.html'))
    })
  }

  app.use(errorHandler)
  return app
}
