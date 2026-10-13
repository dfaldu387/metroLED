import type { NextFunction, Request, RequestHandler, Response } from 'express'
import { ZodError } from 'zod'

/**
 * HTTP error plumbing for route handlers.
 *
 * Handlers throw `HttpError` (or an `AuthorizationError` from the guards) and
 * the central `errorHandler` turns it into the JSON body the client expects:
 *
 *   { error: 'UNAUTHENTICATED' | 'FORBIDDEN' | 'NOT_FOUND' | 'BAD_REQUEST' | ..., message, ...extra }
 */

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly extra: Record<string, unknown> = {},
  ) {
    super(message)
    this.name = 'HttpError'
  }
}

export const badRequest = (message: string, extra?: Record<string, unknown>) =>
  new HttpError(400, 'BAD_REQUEST', message, extra)
export const notFound = (message = 'Not found.') => new HttpError(404, 'NOT_FOUND', message)
export const serviceUnavailable = (message: string) => new HttpError(503, 'UNAVAILABLE', message)

/**
 * Wraps an async handler. A returned value is sent as JSON; return `undefined`
 * after writing the response yourself (redirects, raw bodies).
 */
export function handler<T>(fn: (req: Request, res: Response) => Promise<T>): RequestHandler {
  return (req, res, next) => {
    fn(req, res).then(
      (body) => {
        if (body !== undefined && !res.headersSent) res.json(body)
      },
      next,
    )
  }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(error: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (res.headersSent) return
  if (error instanceof HttpError) {
    res.status(error.status).json({ error: error.code, message: error.message, ...error.extra })
    return
  }
  if (error instanceof Error && error.name === 'AuthorizationError') {
    const e = error as Error & { code: 'UNAUTHENTICATED' | 'FORBIDDEN'; requiredPermission?: string }
    res.status(e.code === 'UNAUTHENTICATED' ? 401 : 403).json({
      error: e.code,
      message: e.message,
      ...(e.requiredPermission ? { requiredPermission: e.requiredPermission } : {}),
    })
    return
  }
  if (error instanceof ZodError) {
    res.status(400).json({
      error: 'BAD_REQUEST',
      message: error.issues[0]?.message ?? 'The request was not valid.',
      issues: error.issues,
    })
    return
  }
  if (error instanceof SyntaxError && 'body' in error) {
    res.status(400).json({ error: 'BAD_REQUEST', message: 'The request body is not valid JSON.' })
    return
  }
  console.error(`[api] ${req.method} ${req.originalUrl} failed`, error)
  res.status(500).json({
    error: 'INTERNAL',
    message: 'Something went wrong on the server. Try again, and contact your administrator if it continues.',
  })
}
