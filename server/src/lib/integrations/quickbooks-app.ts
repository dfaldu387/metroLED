import type { SessionUser } from '../auth/session'
import { db, sql } from '../db'
import { env, integrationEnv } from '../env'
import { credentialEncryptionConfigured, open, seal } from '../crypto'
import { AUDIT_ACTIONS, recordAudit } from '../auth/audit'
import { ensureIntegration } from './credentials'

/**
 * The Intuit *app* registration behind the QuickBooks connection.
 *
 * Intuit only shows its sign-in page to a registered app, so before anyone
 * can "log in with QuickBooks" the deployment needs that app's Client ID and
 * Client Secret. Historically they came from `QBO_CLIENT_ID` /
 * `QBO_CLIENT_SECRET`; an owner can now paste them into the Data Health page
 * instead, in which case they are stored encrypted on the QuickBooks
 * integration row and take precedence over the environment.
 *
 * These are distinct from the OAuth *tokens* in `Integration.credentials`,
 * which identify the connected company and are issued by the sign-in itself.
 */

export type QuickBooksEnvironment = 'sandbox' | 'production'

export interface QuickBooksAppConfig {
  clientId: string
  clientSecret: string
  environment: QuickBooksEnvironment
}

export interface ResolvedQuickBooksApp {
  configured: boolean
  source: 'stored' | 'environment' | 'none'
  clientId?: string
  clientSecret?: string
  environment: QuickBooksEnvironment
}

/** Where Intuit sends the browser back to. Must match the app's registered redirect URI exactly. */
export function quickBooksRedirectUri(): string {
  return `${env().APP_URL}/api/integrations/quickbooks/callback`
}

// The adapter asks for this on every API call, so the stored value is cached
// briefly; writes below drop the cache so a new key is used at once.
const CACHE_TTL_MS = 30_000
let cache: { value: ResolvedQuickBooksApp; at: number } | null = null

function fromEnvironment(): ResolvedQuickBooksApp {
  const e = integrationEnv.quickbooks()
  return {
    configured: e.configured,
    source: e.configured ? 'environment' : 'none',
    clientId: e.clientId,
    clientSecret: e.clientSecret,
    environment: env().QBO_ENVIRONMENT,
  }
}

export async function quickBooksApp(): Promise<ResolvedQuickBooksApp> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.value

  let resolved: ResolvedQuickBooksApp
  try {
    const row = credentialEncryptionConfigured()
      ? await db.maybeOne<{ appCredentials: unknown }>(
          sql`SELECT "appCredentials" FROM "Integration" WHERE "provider" = ${'QUICKBOOKS'}`,
        )
      : null
    if (row?.appCredentials) {
      const stored = open<QuickBooksAppConfig>(row.appCredentials)
      resolved = {
        configured: Boolean(stored.clientId && stored.clientSecret),
        source: 'stored',
        clientId: stored.clientId,
        clientSecret: stored.clientSecret,
        environment: stored.environment === 'production' ? 'production' : 'sandbox',
      }
    } else {
      resolved = fromEnvironment()
    }
  } catch {
    // Database unreachable or envelope unreadable: fall back to the
    // environment rather than failing every QuickBooks call outright.
    resolved = fromEnvironment()
  }

  cache = { value: resolved, at: Date.now() }
  return resolved
}

export function invalidateQuickBooksAppCache(): void {
  cache = null
}

/** Stores the Intuit app keys encrypted. The OAuth tokens, if any, are left alone. */
export async function storeQuickBooksApp(config: QuickBooksAppConfig, actor: SessionUser): Promise<void> {
  if (!credentialEncryptionConfigured()) {
    throw new Error('CREDENTIAL_ENCRYPTION_KEY is not configured, so the Intuit app keys cannot be stored.')
  }
  const integrationId = await ensureIntegration('QUICKBOOKS', 'QuickBooks Online')
  await db.exec(sql`
    UPDATE "Integration" SET "appCredentials" = ${seal(config)} WHERE "id" = ${integrationId}`)
  invalidateQuickBooksAppCache()

  await recordAudit({
    action: AUDIT_ACTIONS.INTEGRATION_UPDATED,
    summary: `${actor.name} saved the Intuit app keys for QuickBooks Online (${config.environment}).`,
    actor,
    entityType: 'Integration',
    entityId: integrationId,
    metadata: { environment: config.environment, clientIdSuffix: config.clientId.slice(-4) },
  })
}

/**
 * Removes the stored app keys. The OAuth tokens are removed with them: they
 * cannot be refreshed without the app that issued them.
 */
export async function clearQuickBooksApp(actor: SessionUser): Promise<boolean> {
  const row = await db.maybeOne<{ id: string; appCredentials: unknown }>(
    sql`SELECT "id", "appCredentials" FROM "Integration" WHERE "provider" = ${'QUICKBOOKS'}`,
  )
  if (!row?.appCredentials) return false

  await db.exec(sql`
    UPDATE "Integration" SET
      "appCredentials" = NULL,
      "credentials" = NULL,
      "config" = NULL,
      "tokenExpiresAt" = NULL,
      "status" = ${'NOT_CONFIGURED'},
      "isEnabled" = false,
      "consecutiveFailures" = 0,
      "lastErrorAt" = NULL,
      "lastErrorMessage" = NULL
    WHERE "id" = ${row.id}`)
  invalidateQuickBooksAppCache()

  await recordAudit({
    action: AUDIT_ACTIONS.INTEGRATION_UPDATED,
    summary: `${actor.name} removed the stored Intuit app keys for QuickBooks Online and disconnected it.`,
    actor,
    entityType: 'Integration',
    entityId: row.id,
  })
  return true
}
