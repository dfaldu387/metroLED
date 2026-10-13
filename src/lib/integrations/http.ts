/**
 * HTTP client for provider APIs.
 *
 * Every provider call goes through here so the behaviours section 13 requires
 * are implemented once, correctly:
 *   - retries with exponential backoff and full jitter,
 *   - respect for `Retry-After` on 429 and 503 rather than guessing,
 *   - a hard ceiling on attempts so a sync cannot spin forever,
 *   - a request counter per sync run, for the Data Health page,
 *   - a timeout on every request, because a hung socket would otherwise hold
 *     a sync run open indefinitely.
 *
 * Only 408, 429 and 5xx are retried. A 400 or 401 is a configuration problem
 * that retrying cannot fix, so it fails fast and is reported.
 */

export class ProviderHttpError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: string,
    public readonly retryable: boolean,
    public readonly provider: string,
  ) {
    super(message)
    this.name = 'ProviderHttpError'
  }
}

export class ProviderAuthError extends ProviderHttpError {
  constructor(message: string, status: number, body: string, provider: string) {
    super(message, status, body, false, provider)
    this.name = 'ProviderAuthError'
  }
}

export interface RequestCounter {
  count: number
}

export interface HttpOptions {
  provider: string
  method?: 'GET' | 'POST'
  headers?: Record<string, string>
  body?: string
  /** Maximum attempts including the first. Defaults to 5. */
  maxAttempts?: number
  /** Per-request timeout in milliseconds. Defaults to 30s. */
  timeoutMs?: number
  /** Incremented once per HTTP request actually sent. */
  counter?: RequestCounter
  /** Called before a retry, so a sync run can log the backoff. */
  onRetry?: (info: { attempt: number; delayMs: number; reason: string }) => void
  signal?: AbortSignal
}

const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504])

/** Exponential backoff with full jitter, capped at 30 seconds. */
export function backoffDelay(attempt: number, baseMs = 500, capMs = 30_000): number {
  const exponential = Math.min(capMs, baseMs * 2 ** (attempt - 1))
  // Full jitter avoids a thundering herd when several entities retry together.
  return Math.round(Math.random() * exponential)
}

function parseRetryAfter(value: string | null): number | null {
  if (!value) return null
  const seconds = Number(value)
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)
  const date = Date.parse(value)
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now())
  return null
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Sync was cancelled.'))
      return
    }
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(new Error('Sync was cancelled.'))
      },
      { once: true },
    )
  })
}

export async function providerFetch(url: string, options: HttpOptions): Promise<Response> {
  const maxAttempts = options.maxAttempts ?? 5
  const timeoutMs = options.timeoutMs ?? 30_000
  let lastError: unknown

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    const onOuterAbort = () => controller.abort()
    options.signal?.addEventListener('abort', onOuterAbort, { once: true })

    try {
      if (options.counter) options.counter.count++

      const response = await fetch(url, {
        method: options.method ?? 'GET',
        headers: options.headers,
        body: options.body,
        signal: controller.signal,
        // Provider APIs must never be served from a cache.
        cache: 'no-store',
      })

      if (response.ok) return response

      const bodyText = await safeText(response)

      if (response.status === 401 || response.status === 403) {
        throw new ProviderAuthError(
          `${options.provider} rejected the credentials (HTTP ${response.status}). Reconnect the integration.`,
          response.status,
          bodyText,
          options.provider,
        )
      }

      const retryable = RETRYABLE_STATUSES.has(response.status)
      if (!retryable || attempt === maxAttempts) {
        throw new ProviderHttpError(
          `${options.provider} returned HTTP ${response.status}.${bodyText ? ` ${truncate(bodyText)}` : ''}`,
          response.status,
          bodyText,
          retryable,
          options.provider,
        )
      }

      const retryAfter = parseRetryAfter(response.headers.get('retry-after'))
      const delay = retryAfter ?? backoffDelay(attempt)
      options.onRetry?.({
        attempt,
        delayMs: delay,
        reason: `HTTP ${response.status}${retryAfter !== null ? ' (honouring Retry-After)' : ''}`,
      })
      await sleep(delay, options.signal)
      continue
    } catch (error) {
      lastError = error

      // Auth and non-retryable HTTP failures must not be retried.
      if (error instanceof ProviderAuthError) throw error
      if (error instanceof ProviderHttpError && !error.retryable) throw error
      if (options.signal?.aborted) throw error

      if (attempt === maxAttempts) break

      const isTimeout = error instanceof Error && error.name === 'AbortError'
      const delay = backoffDelay(attempt)
      options.onRetry?.({
        attempt,
        delayMs: delay,
        reason: isTimeout ? `request timed out after ${timeoutMs}ms` : describeError(error),
      })
      await sleep(delay, options.signal)
    } finally {
      clearTimeout(timeout)
      options.signal?.removeEventListener('abort', onOuterAbort)
    }
  }

  if (lastError instanceof ProviderHttpError) throw lastError
  throw new ProviderHttpError(
    `${options.provider} could not be reached after ${maxAttempts} attempts. ${describeError(lastError)}`,
    0,
    '',
    true,
    options.provider,
  )
}

export async function providerJson<T>(url: string, options: HttpOptions): Promise<T> {
  const response = await providerFetch(url, {
    ...options,
    headers: { Accept: 'application/json', ...options.headers },
  })
  const text = await response.text()
  if (!text) return {} as T
  try {
    return JSON.parse(text) as T
  } catch {
    throw new ProviderHttpError(
      `${options.provider} returned a response that is not valid JSON.`,
      response.status,
      truncate(text),
      false,
      options.provider,
    )
  }
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text()
  } catch {
    return ''
  }
}

function truncate(value: string, max = 400): string {
  return value.length <= max ? value : `${value.slice(0, max)}…`
}

export function describeError(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return 'Unknown error.'
}

/**
 * Simple token-bucket limiter.
 *
 * Shopify's REST Admin API allows 2 requests/second on a standard plan and
 * QuickBooks allows 500/minute per realm, so pacing requests is cheaper than
 * being throttled and backing off.
 */
export class RateLimiter {
  private queue: Promise<void> = Promise.resolve()
  private lastRun = 0

  constructor(private readonly minIntervalMs: number) {}

  async acquire(): Promise<void> {
    const run = this.queue.then(async () => {
      const elapsed = Date.now() - this.lastRun
      const wait = this.minIntervalMs - elapsed
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
      this.lastRun = Date.now()
    })
    // Swallow rejections so one failure cannot poison the chain.
    this.queue = run.catch(() => undefined)
    return run
  }
}
