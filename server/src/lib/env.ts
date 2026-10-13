import { z } from 'zod'

/**
 * Validated environment configuration.
 *
 * Parsing happens lazily on first access so that a build or script does not fail on
 * a machine without integration credentials. Anything genuinely required for
 * the process to boot is validated here; anything optional is surfaced through
 * a `configured` flag so the UI can show an honest "not connected" state
 * instead of failing at request time.
 */

const booleanish = z
  .string()
  .optional()
  .transform((v) => v === 'true' || v === '1')

const schema = z.object({
  APP_ENV: z.enum(['development', 'staging', 'production', 'test']).default('development'),
  /** Public base URL users open (the React client). Used in emails and OAuth redirect URIs. */
  APP_URL: z.string().url().default('http://localhost:5173'),
  /** Port the Express API listens on. */
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),

  DATABASE_URL: z.string().optional(),

  SESSION_SECRET: z.string().min(16).default('dev-only-insecure-session-secret-change-me'),
  CREDENTIAL_ENCRYPTION_KEY: z.string().optional(),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(12),

  ALLOW_DEMO_DATA: booleanish,

  QBO_CLIENT_ID: z.string().optional(),
  QBO_CLIENT_SECRET: z.string().optional(),
  QBO_ENVIRONMENT: z.enum(['sandbox', 'production']).default('sandbox'),
  QBO_MINOR_VERSION: z.string().default('75'),

  METHOD_API_KEY: z.string().optional(),
  METHOD_API_BASE_URL: z.string().default('https://rest.method.me/api/v1'),

  SHOPIFY_SHOP_DOMAIN: z.string().optional(),
  SHOPIFY_ADMIN_ACCESS_TOKEN: z.string().optional(),
  SHOPIFY_API_VERSION: z.string().default('2025-07'),
  SHOPIFY_WEBHOOK_SECRET: z.string().optional(),

  MONDAY_API_TOKEN: z.string().optional(),
  MONDAY_ENABLED: booleanish,

  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default('claude-opus-5-5'),

  EMAIL_PROVIDER: z.enum(['resend', 'ses', 'console']).default('console'),
  EMAIL_FROM: z.string().default('MetroLED Intelligence <intelligence@metroled.example>'),
  EMAIL_REPLY_TO: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  AWS_REGION: z.string().default('us-east-1'),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),

  CRON_SECRET: z.string().optional(),

  SEED_OWNER_EMAIL: z.string().optional(),
  SEED_OWNER_NAME: z.string().optional(),
  SEED_OWNER_PASSWORD: z.string().optional(),
})

export type AppEnv = z.infer<typeof schema>

let cached: AppEnv | null = null

function emptyToUndefined(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const trimmed = value.trim()
  return trimmed.length === 0 ? undefined : trimmed
}

export function env(): AppEnv {
  if (cached) return cached

  const raw: Record<string, string | undefined> = {}
  for (const key of Object.keys(schema.shape)) {
    raw[key] = emptyToUndefined(process.env[key])
  }

  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n')
    throw new Error(`Invalid environment configuration:\n${issues}`)
  }

  cached = parsed.data
  return cached
}

/** Reset the cache. Used by tests only. */
export function resetEnvCache(): void {
  cached = null
}

export function isProduction(): boolean {
  return env().APP_ENV === 'production'
}

/**
 * Whether the deployment is permitted to fall back to the labelled demo
 * dataset. Production never falls back silently: a missing database is an
 * error, and an empty database shows an explicit "data unavailable" state.
 */
export function demoDataAllowed(): boolean {
  const e = env()
  if (e.APP_ENV === 'production') return false
  return e.ALLOW_DEMO_DATA
}

export const integrationEnv = {
  quickbooks(): { configured: boolean; clientId?: string; clientSecret?: string } {
    const e = env()
    return {
      configured: Boolean(e.QBO_CLIENT_ID && e.QBO_CLIENT_SECRET),
      clientId: e.QBO_CLIENT_ID,
      clientSecret: e.QBO_CLIENT_SECRET,
    }
  },
  method(): { configured: boolean; apiKey?: string; baseUrl: string } {
    const e = env()
    return { configured: Boolean(e.METHOD_API_KEY), apiKey: e.METHOD_API_KEY, baseUrl: e.METHOD_API_BASE_URL }
  },
  shopify(): { configured: boolean; shopDomain?: string; token?: string; apiVersion: string } {
    const e = env()
    return {
      configured: Boolean(e.SHOPIFY_SHOP_DOMAIN && e.SHOPIFY_ADMIN_ACCESS_TOKEN),
      shopDomain: e.SHOPIFY_SHOP_DOMAIN,
      token: e.SHOPIFY_ADMIN_ACCESS_TOKEN,
      apiVersion: e.SHOPIFY_API_VERSION,
    }
  },
  monday(): { configured: boolean; enabled: boolean; token?: string } {
    const e = env()
    return { configured: Boolean(e.MONDAY_API_TOKEN), enabled: e.MONDAY_ENABLED, token: e.MONDAY_API_TOKEN }
  },
}
