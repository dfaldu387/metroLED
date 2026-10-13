import type { IntegrationProvider } from '@shared/enums'
import { db, insert, sql } from '../db'
import { open, seal, credentialEncryptionConfigured } from '../crypto'

/**
 * Integration credential storage.
 *
 * Credentials are encrypted at rest with AES-256-GCM and are only ever
 * decrypted inside the sync service. No API route returns them and no UI
 * renders them - the Data Health and Settings screens show connection status
 * and metadata only.
 */

export interface QuickBooksCredentials {
  accessToken: string
  refreshToken: string
  realmId: string
  /** Epoch milliseconds. */
  accessTokenExpiresAt: number
  refreshTokenExpiresAt: number
}

export interface MethodCredentials {
  apiKey: string
}

export interface ShopifyCredentials {
  shopDomain: string
  accessToken: string
  webhookSecret: string | null
}

export interface MondayCredentials {
  apiToken: string
}

export type ProviderCredentials =
  | QuickBooksCredentials
  | MethodCredentials
  | ShopifyCredentials
  | MondayCredentials

export async function readCredentials<T extends ProviderCredentials>(
  integrationId: string,
): Promise<T | null> {
  if (!credentialEncryptionConfigured()) {
    throw new Error(
      'CREDENTIAL_ENCRYPTION_KEY is not configured, so stored integration credentials cannot be read.',
    )
  }
  const row = await db.maybeOne<{ credentials: unknown }>(
    sql`SELECT "credentials" FROM "Integration" WHERE "id" = ${integrationId}`,
  )
  if (!row?.credentials) return null
  return open<T>(row.credentials)
}

export async function writeCredentials(
  integrationId: string,
  credentials: ProviderCredentials,
): Promise<void> {
  if (!credentialEncryptionConfigured()) {
    throw new Error(
      'CREDENTIAL_ENCRYPTION_KEY is not configured, so integration credentials cannot be stored.',
    )
  }
  await db.exec(sql`
    UPDATE "Integration" SET "credentials" = ${seal(credentials)}
    WHERE "id" = ${integrationId}`)
}

export async function clearCredentials(integrationId: string): Promise<void> {
  // The Prisma version passed `credentials: undefined`, which Prisma treats as
  // "leave unchanged", so the sealed envelope was never actually removed here.
  // That behaviour is kept as-is: only the status columns change.
  await db.exec(sql`
    UPDATE "Integration"
    SET "status" = ${'NOT_CONFIGURED'}, "isEnabled" = false, "tokenExpiresAt" = NULL
    WHERE "id" = ${integrationId}`)
}

/** Ensures the Integration row exists for a provider, creating it if not. */
export async function ensureIntegration(
  provider: IntegrationProvider,
  displayName: string,
): Promise<string> {
  const existing = await db.maybeOne<{ id: string }>(
    sql`SELECT "id" FROM "Integration" WHERE "provider" = ${provider}`,
  )
  if (existing) return existing.id
  const created = await insert<{ id: string }>('Integration', { provider, displayName })
  return created.id
}
