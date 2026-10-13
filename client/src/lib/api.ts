import type { ApiErrorBody } from '@shared/api/session'

/**
 * Thin fetch wrapper for the Express API.
 *
 * Same-origin, cookie-authenticated (`credentials: 'same-origin'`). A non-2xx
 * response throws `ApiError`, which carries the server's `error` code and the
 * user-facing `message`. 401/403 handling (redirect to sign-in / no-access)
 * lives in the query client (lib/query.ts) so every query gets it.
 */

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly body: Partial<ApiErrorBody> & Record<string, unknown> = {},
  ) {
    super(message)
    this.name = 'ApiError'
  }

  get requiredPermission(): string | undefined {
    return typeof this.body.requiredPermission === 'string' ? this.body.requiredPermission : undefined
  }
}

type Query = Record<string, string | number | boolean | null | undefined>

function withQuery(path: string, query?: Query | URLSearchParams | string): string {
  if (!query) return path
  let qs: string
  if (typeof query === 'string') qs = query.replace(/^\?/, '')
  else if (query instanceof URLSearchParams) qs = query.toString()
  else {
    const params = new URLSearchParams()
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') params.set(k, String(v))
    qs = params.toString()
  }
  return qs ? `${path}${path.includes('?') ? '&' : '?'}${qs}` : path
}

async function request<T>(method: string, path: string, body?: unknown, query?: Query | URLSearchParams | string): Promise<T> {
  let response: Response
  try {
    response = await fetch(withQuery(path, query), {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? { Accept: 'application/json' } : { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiError(0, 'NETWORK', 'The server could not be reached. Check your connection and try again.')
  }

  const text = await response.text()
  let data: unknown = undefined
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = undefined
    }
  }

  if (!response.ok) {
    const b = (data && typeof data === 'object' ? data : {}) as Partial<ApiErrorBody> & Record<string, unknown>
    throw new ApiError(
      response.status,
      typeof b.error === 'string' ? b.error : `HTTP_${response.status}`,
      typeof b.message === 'string' ? b.message : `The request failed (${response.status}).`,
      b,
    )
  }
  return data as T
}

export const api = {
  get: <T>(path: string, query?: Query | URLSearchParams | string) => request<T>('GET', path, undefined, query),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body ?? {}),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body ?? {}),
  delete: <T>(path: string, body?: unknown) => request<T>('DELETE', path, body),
}

/**
 * For endpoints that answer a user-facing refusal with a non-2xx status but a
 * `{ ok: false, message }` body (sign-in, demo). Returns the body either way.
 */
export async function postForResult<T extends { ok: boolean; message?: string }>(path: string, body?: unknown): Promise<T> {
  try {
    return await api.post<T>(path, body)
  } catch (error) {
    if (error instanceof ApiError && typeof error.body.ok === 'boolean') return error.body as unknown as T
    if (error instanceof ApiError) return { ok: false, message: error.message } as T
    throw error
  }
}
