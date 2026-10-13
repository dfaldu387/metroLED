import type { IntegrationProvider } from '@shared/enums'
import type { SessionUser } from '../auth/session'
import { db, sql } from '../db'
import { AUDIT_ACTIONS, recordAudit } from '../auth/audit'
import {
  ensureIntegration,
  writeCredentials,
  type MethodCredentials,
  type ProviderCredentials,
  type ShopifyCredentials,
} from './credentials'
import { testProviderConnection } from './sync-service'

/**
 * Connecting a source system from the Data Health page.
 *
 * Method CRM and Shopify authenticate with a key or token the administrator
 * pastes in. The flow is the same for both and mirrors the QuickBooks OAuth
 * callback:
 *
 *   1. store the credential encrypted (the adapters only read credentials
 *      through `readCredentials`, so a live test needs it stored first);
 *   2. call the provider once, without importing anything;
 *   3. only claim "Connected" when the provider actually answered.
 *
 * If the test fails the previous credential (if any) is put back, so a typo
 * never knocks out a working connection, and the status row says why.
 *
 * Nothing here is ever returned to the client: the routes that call these
 * functions answer with `ok` and a human-readable `detail` only.
 */

export const CONNECTABLE_DISPLAY_NAMES: Record<'METHOD_CRM' | 'SHOPIFY', string> = {
  METHOD_CRM: 'Method CRM',
  SHOPIFY: 'Shopify — Eco LED Mart',
}

export interface ConnectResult {
  ok: boolean
  detail: string
}

/**
 * Normalises whatever the administrator pasted for the shop domain.
 *
 * Accepts `eco-led-mart`, `eco-led-mart.myshopify.com`,
 * `https://eco-led-mart.myshopify.com/admin` and friends. Returns null when
 * the value cannot be a `*.myshopify.com` host.
 */
export function normalizeShopDomain(input: string): string | null {
  let value = input.trim().toLowerCase()
  if (!value) return null
  value = value.replace(/^[a-z]+:\/\//, '') // scheme
  value = value.split(/[/?#]/)[0] ?? '' // path, query, fragment
  value = value.replace(/^admin\./, '') // admin.shopify.com style hosts are not API hosts
  if (!value) return null

  if (!value.includes('.')) value = `${value}.myshopify.com`
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(value)) return null
  return value
}

interface PreviousState {
  credentials: unknown
  status: string
  isEnabled: boolean
  config: unknown
}

async function snapshot(integrationId: string): Promise<PreviousState | null> {
  return db.maybeOne<PreviousState>(sql`
    SELECT "credentials", "status", "isEnabled", "config" FROM "Integration" WHERE "id" = ${integrationId}`)
}

async function restore(integrationId: string, previous: PreviousState | null, failure: string): Promise<void> {
  if (previous) {
    // Put the sealed envelope back untouched; it is never decrypted here.
    await db.exec(sql`
      UPDATE "Integration" SET
        "credentials" = ${previous.credentials},
        "config" = ${previous.config},
        "status" = ${previous.credentials ? 'ERROR' : 'NOT_CONFIGURED'},
        "isEnabled" = ${previous.credentials ? previous.isEnabled : false},
        "lastErrorAt" = ${new Date()},
        "lastErrorMessage" = ${failure}
      WHERE "id" = ${integrationId}`)
  } else {
    await db.exec(sql`
      UPDATE "Integration" SET
        "credentials" = NULL,
        "status" = ${'NOT_CONFIGURED'},
        "isEnabled" = false,
        "lastErrorAt" = ${new Date()},
        "lastErrorMessage" = ${failure}
      WHERE "id" = ${integrationId}`)
  }
}

async function connect(
  provider: 'METHOD_CRM' | 'SHOPIFY',
  credentials: ProviderCredentials,
  config: Record<string, unknown>,
  actor: SessionUser,
): Promise<ConnectResult> {
  const displayName = CONNECTABLE_DISPLAY_NAMES[provider]
  const integrationId = await ensureIntegration(provider, displayName)
  const previous = await snapshot(integrationId)

  await writeCredentials(integrationId, credentials)
  await db.exec(sql`
    UPDATE "Integration" SET "config" = ${config}, "tokenExpiresAt" = NULL WHERE "id" = ${integrationId}`)

  const test = await testProviderConnection(provider)

  if (!test.ok) {
    const failure = `Connection test failed: ${test.detail}`
    await restore(integrationId, previous, failure)
    await recordAudit({
      action: AUDIT_ACTIONS.INTEGRATION_CONNECTED,
      summary: `${actor.name} attempted to connect ${displayName} and the connection test failed: ${test.detail}`,
      actor,
      entityType: 'Integration',
      entityId: integrationId,
      metadata: { provider, verified: false, ...config },
    })
    return {
      ok: false,
      detail: previous?.credentials
        ? `${test.detail} The previously stored credential was kept.`
        : test.detail,
    }
  }

  await db.exec(sql`
    UPDATE "Integration" SET
      "status" = ${'CONNECTED'},
      "isEnabled" = true,
      "consecutiveFailures" = 0,
      "lastErrorAt" = NULL,
      "lastErrorMessage" = NULL
    WHERE "id" = ${integrationId}`)

  await recordAudit({
    action: AUDIT_ACTIONS.INTEGRATION_CONNECTED,
    summary: `${actor.name} connected ${displayName}. ${test.detail}`,
    actor,
    entityType: 'Integration',
    entityId: integrationId,
    metadata: { provider, verified: true, ...config },
  })

  return { ok: true, detail: test.detail }
}

export function connectMethod(apiKey: string, actor: SessionUser): Promise<ConnectResult> {
  const credentials: MethodCredentials = { apiKey }
  return connect('METHOD_CRM', credentials, { connectedAt: new Date().toISOString() }, actor)
}

export function connectShopify(
  input: { shopDomain: string; accessToken: string; webhookSecret: string | null },
  actor: SessionUser,
): Promise<ConnectResult> {
  const credentials: ShopifyCredentials = {
    shopDomain: input.shopDomain,
    accessToken: input.accessToken,
    webhookSecret: input.webhookSecret,
  }
  return connect(
    'SHOPIFY',
    credentials,
    {
      shopDomain: input.shopDomain,
      webhookSecretStored: Boolean(input.webhookSecret),
      connectedAt: new Date().toISOString(),
    },
    actor,
  )
}

/**
 * Removes the stored credential and stops the scheduled sync. Imported data
 * is kept: disconnecting a source does not delete history from the reports.
 */
export async function disconnectProvider(
  provider: IntegrationProvider,
  actor: SessionUser,
): Promise<ConnectResult> {
  const row = await db.maybeOne<{ id: string; displayName: string; credentials: unknown }>(sql`
    SELECT "id", "displayName", "credentials" FROM "Integration" WHERE "provider" = ${provider}`)

  if (!row) {
    return { ok: false, detail: 'This source has never been connected, so there is nothing to disconnect.' }
  }

  await db.exec(sql`
    UPDATE "Integration" SET
      "credentials" = NULL,
      "config" = NULL,
      "tokenExpiresAt" = NULL,
      "status" = ${'NOT_CONFIGURED'},
      "isEnabled" = false,
      "consecutiveFailures" = 0,
      "lastErrorAt" = NULL,
      "lastErrorMessage" = NULL
    WHERE "id" = ${row.id}`)

  await recordAudit({
    action: AUDIT_ACTIONS.INTEGRATION_DISCONNECTED,
    summary: `${actor.name} disconnected ${row.displayName}. The stored credential was removed and the scheduled sync stopped.`,
    actor,
    entityType: 'Integration',
    entityId: row.id,
    metadata: { provider, hadCredentials: Boolean(row.credentials) },
  })

  return {
    ok: true,
    detail: `${row.displayName} disconnected. Imported history is kept; connect it again to resume syncing.`,
  }
}
