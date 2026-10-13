import { AsyncLocalStorage } from 'node:async_hooks'
import type { CookieOptions, NextFunction, Request, Response } from 'express'

/**
 * Per-request context.
 *
 * Library code (sessions, the audit log) needs the current request's cookies
 * and client IP without every caller threading `req`/`res` through. An
 * AsyncLocalStorage set by `requestContextMiddleware` provides them, the same
 * role `cookies()` / `headers()` played under Next.js.
 *
 * Outside a request (worker, scripts) `cookieJar` reads nothing and writes are
 * ignored, and `requestMeta` returns nulls.
 */

interface Ctx {
  req: Request
  res: Response
}

const storage = new AsyncLocalStorage<Ctx>()

export function requestContextMiddleware(req: Request, res: Response, next: NextFunction): void {
  storage.run({ req, res }, next)
}

export function currentRequest(): Ctx | undefined {
  return storage.getStore()
}

export const cookieJar = {
  get(name: string): string | undefined {
    const value = storage.getStore()?.req.cookies?.[name]
    return typeof value === 'string' ? value : undefined
  },
  set(name: string, value: string, options: CookieOptions): void {
    storage.getStore()?.res.cookie(name, value, options)
  },
  delete(name: string): void {
    storage.getStore()?.res.clearCookie(name, { path: '/' })
  },
}

export function requestMeta(): { ip: string | null; userAgent: string | null } {
  const ctx = storage.getStore()
  if (!ctx) return { ip: null, userAgent: null }
  const forwarded = ctx.req.get('x-forwarded-for')
  const ip = forwarded
    ? (forwarded.split(',')[0] ?? '').trim() || null
    : (ctx.req.get('x-real-ip') ?? ctx.req.socket.remoteAddress ?? null)
  return { ip, userAgent: ctx.req.get('user-agent') ?? null }
}
