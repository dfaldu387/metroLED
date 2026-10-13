import { Router, type Response } from 'express'
import { z } from 'zod'
import { PERMISSIONS } from '@shared/permissions'
import { currentUser, requireAuth } from '../lib/auth/guards'
import { env } from '../lib/env'
import { credentialEncryptionConfigured, randomToken, safeEqual } from '../lib/crypto'
import { db, sql } from '../lib/db'
import { exchangeQuickBooksCode, quickBooksAuthorizeUrl } from '../lib/integrations/quickbooks'
import { ensureIntegration, writeCredentials } from '../lib/integrations/credentials'
import { testProviderConnection } from '../lib/integrations/sync-service'
import { AUDIT_ACTIONS, recordAudit } from '../lib/auth/audit'
import { OAUTH_RETURN_COOKIE, OAUTH_STATE_COOKIE, oauthReturnPath } from '../lib/oauth-state'
import { connectMethod, connectShopify, disconnectProvider, normalizeShopDomain } from '../lib/integrations/connect'
import { clearQuickBooksApp, quickBooksApp, quickBooksRedirectUri, storeQuickBooksApp } from '../lib/integrations/quickbooks-app'
import { cookieJar } from '../lib/http/context'
import { handler } from '../lib/http/errors'

export const integrationsRouter = Router()

/** Query-string value as a string, or null (mirrors URLSearchParams.get). */
function param(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0]
  return null
}

/**
 * GET /api/integrations/quickbooks/connect
 *
 * Starts the QuickBooks Online OAuth flow.
 *
 * A random `state` value is generated and stored in a short-lived httpOnly
 * cookie. The callback compares it to the value Intuit returns, which is what
 * prevents an attacker from completing the connection with their own
 * authorisation code (CSRF on the OAuth callback).
 */
integrationsRouter.get(
  '/quickbooks/connect',
  requireAuth(PERMISSIONS.SETTINGS_MANAGE),
  handler(async (req, res) => {
    const user = currentUser(res)

    if (user.isDemo) {
      res.status(403)
      return { error: 'DEMO_SESSION', message: 'A demo session cannot connect an integration.' }
    }

    if (!credentialEncryptionConfigured()) {
      res.status(503)
      return {
        error: 'NOT_CONFIGURED',
        message:
          'CREDENTIAL_ENCRYPTION_KEY is not set, so the QuickBooks tokens could not be stored. Set it and restart before connecting.',
      }
    }

    const app = await quickBooksApp()
    if (!app.configured) {
      res.status(503)
      return {
        error: 'NOT_CONFIGURED',
        message:
          'The Intuit app keys (Client ID and Client Secret) are not set. Save them from the Connect QuickBooks dialog on Data Health first.',
      }
    }

    const state = randomToken(16)
    const cookieOptions = {
      httpOnly: true,
      sameSite: 'lax' as const,
      secure: env().APP_URL.startsWith('https://'),
      path: '/',
      maxAge: 600 * 1000, // Express takes milliseconds (Next took seconds).
    }
    cookieJar.set(OAUTH_STATE_COOKIE, state, cookieOptions)
    // Where to land afterwards: the Data Health page by default, or Settings
    // when the flow was started from there. Only known paths are accepted.
    cookieJar.set(OAUTH_RETURN_COOKIE, oauthReturnPath(param(req.query.returnTo)), cookieOptions)

    res.redirect(303, await quickBooksAuthorizeUrl(state))
    return undefined
  }),
)

/**
 * GET /api/integrations/quickbooks/callback
 *
 * Completes the QuickBooks Online OAuth flow.
 *
 * Order matters here:
 *   1. re-check the caller's permission (the redirect came from Intuit, not
 *      from our own UI, so nothing about it can be trusted);
 *   2. verify the `state` against the cookie, constant-time;
 *   3. exchange the code for tokens;
 *   4. store the tokens encrypted and verify the connection actually works
 *      before marking the integration connected.
 */
integrationsRouter.get(
  '/quickbooks/callback',
  requireAuth(PERMISSIONS.SETTINGS_MANAGE),
  handler(async (req, res) => {
    const user = currentUser(res)

    const code = param(req.query.code)
    const realmId = param(req.query.realmId)
    const state = param(req.query.state)
    const error = param(req.query.error)

    const expectedState = cookieJar.get(OAUTH_STATE_COOKIE)
    const returnPath = oauthReturnPath(cookieJar.get(OAUTH_RETURN_COOKIE) ?? null)
    cookieJar.delete(OAUTH_STATE_COOKIE)
    cookieJar.delete(OAUTH_RETURN_COOKIE)

    const back = (message: string, ok: boolean) => {
      res.redirect(
        303,
        `${env().APP_URL}${returnPath}?${new URLSearchParams({
          connected: ok ? 'quickbooks' : '',
          message,
        }).toString()}`,
      )
      return undefined
    }

    if (error) {
      return back(`QuickBooks returned an error: ${error}. Nothing was changed.`, false)
    }

    if (!state || !expectedState || !safeEqual(state, expectedState)) {
      // Either the flow did not start here, or it was tampered with.
      return back(
        'The QuickBooks connection could not be verified and was refused. Start the connection again from this page.',
        false,
      )
    }

    if (!code || !realmId) {
      return back('QuickBooks did not return an authorisation code. Nothing was changed.', false)
    }

    try {
      const app = await quickBooksApp()
      const credentials = await exchangeQuickBooksCode(code, realmId)
      const integrationId = await ensureIntegration('QUICKBOOKS', 'QuickBooks Online')
      await writeCredentials(integrationId, credentials)

      await db.exec(sql`
        UPDATE "Integration" SET
          "config" = ${{ realmId, environment: app.environment, minorVersion: env().QBO_MINOR_VERSION }},
          "tokenExpiresAt" = ${new Date(credentials.accessTokenExpiresAt)},
          "status" = ${'CONNECTED'},
          "isEnabled" = true,
          "consecutiveFailures" = 0,
          "lastErrorMessage" = NULL
        WHERE "id" = ${integrationId}`)

      // Only claim the connection works after it has actually answered.
      const test = await testProviderConnection('QUICKBOOKS')
      if (!test.ok) {
        await db.exec(sql`
          UPDATE "Integration"
          SET "status" = ${'ERROR'}, "lastErrorAt" = ${new Date()}, "lastErrorMessage" = ${test.detail}
          WHERE "id" = ${integrationId}`)
      }

      await recordAudit({
        action: AUDIT_ACTIONS.INTEGRATION_CONNECTED,
        summary: `${user.name} connected QuickBooks Online (realm ${realmId}). ${test.ok ? 'Connection verified.' : `Connection test failed: ${test.detail}`}`,
        actor: user,
        entityType: 'Integration',
        entityId: integrationId,
        metadata: { realmId, environment: app.environment, verified: test.ok },
      })

      return back(
        test.ok
          ? `QuickBooks Online connected. ${test.detail} Run a backfill from Data Health to import the history.`
          : `QuickBooks tokens were stored, but the connection test failed: ${test.detail}`,
        test.ok,
      )
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Unknown error.'
      await recordAudit({
        action: AUDIT_ACTIONS.INTEGRATION_CONNECTED,
        summary: `${user.name} attempted to connect QuickBooks Online and it failed: ${message}`,
        actor: user,
        entityType: 'Integration',
        entityId: 'QUICKBOOKS',
      })
      return back(`QuickBooks could not be connected: ${message}`, false)
    }
  }),
)

// ---------------------------------------------------------------------------
// Method CRM and Shopify: key / token entered on the Data Health page
// ---------------------------------------------------------------------------

/**
 * Shared preconditions for storing a credential. Returns an error body (and
 * sets the status) when the request must be refused, or null to proceed.
 */
function refuseIfCannotStore(res: Response): Record<string, unknown> | null {
  const user = currentUser(res)
  if (user.isDemo) {
    res.status(403)
    return { ok: false, error: 'DEMO_SESSION', message: 'A demo session cannot connect an integration.' }
  }
  if (!credentialEncryptionConfigured()) {
    res.status(503)
    return {
      ok: false,
      error: 'NOT_CONFIGURED',
      message:
        'CREDENTIAL_ENCRYPTION_KEY is not set, so the credential could not be stored. Set it and restart before connecting.',
    }
  }
  return null
}

const methodBody = z.object({
  apiKey: z.string().trim().min(8, 'Paste the full Method CRM API key.').max(512),
})

/**
 * POST /api/integrations/method/connect  { apiKey }
 *
 * Stores the key encrypted, calls Method once to prove it works, and only
 * then marks the integration connected. The key is never echoed back.
 */
integrationsRouter.post(
  '/method/connect',
  requireAuth(PERMISSIONS.SETTINGS_MANAGE),
  handler(async (req, res) => {
    const refused = refuseIfCannotStore(res)
    if (refused) return refused

    const parsed = methodBody.safeParse(req.body ?? {})
    if (!parsed.success) {
      res.status(400)
      return { ok: false, error: 'INVALID_REQUEST', message: parsed.error.issues[0]?.message ?? 'Check the API key.' }
    }

    const result = await connectMethod(parsed.data.apiKey, currentUser(res))
    if (!result.ok) res.status(422)
    return {
      ok: result.ok,
      provider: 'METHOD_CRM',
      message: result.ok
        ? `Method CRM connected. ${result.detail} Run a backfill from Data Health to import the history.`
        : `Method CRM could not be connected: ${result.detail}`,
    }
  }),
)

const shopifyBody = z.object({
  shopDomain: z.string().trim().min(3, 'Enter the shop domain, for example eco-led-mart.myshopify.com.').max(255),
  accessToken: z.string().trim().min(8, 'Paste the full Admin API access token.').max(512),
  webhookSecret: z.string().trim().max(512).optional().or(z.literal('')),
})

/**
 * POST /api/integrations/shopify/connect  { shopDomain, accessToken, webhookSecret? }
 *
 * Same contract as Method: store encrypted, test, then mark connected. The
 * webhook signing secret is optional; without it webhooks are rejected and
 * orders arrive on the scheduled sync only.
 */
integrationsRouter.post(
  '/shopify/connect',
  requireAuth(PERMISSIONS.SETTINGS_MANAGE),
  handler(async (req, res) => {
    const refused = refuseIfCannotStore(res)
    if (refused) return refused

    const parsed = shopifyBody.safeParse(req.body ?? {})
    if (!parsed.success) {
      res.status(400)
      return { ok: false, error: 'INVALID_REQUEST', message: parsed.error.issues[0]?.message ?? 'Check the details.' }
    }

    const shopDomain = normalizeShopDomain(parsed.data.shopDomain)
    if (!shopDomain) {
      res.status(400)
      return {
        ok: false,
        error: 'INVALID_REQUEST',
        message: 'The shop domain must be the store’s myshopify.com address, for example eco-led-mart.myshopify.com.',
      }
    }

    const result = await connectShopify(
      {
        shopDomain,
        accessToken: parsed.data.accessToken,
        webhookSecret: parsed.data.webhookSecret ? parsed.data.webhookSecret : null,
      },
      currentUser(res),
    )
    if (!result.ok) res.status(422)
    return {
      ok: result.ok,
      provider: 'SHOPIFY',
      message: result.ok
        ? `Shopify connected. ${result.detail} Run a backfill from Data Health to import the history.`
        : `Shopify could not be connected: ${result.detail}`,
    }
  }),
)

const disconnectParams = z.object({ provider: z.enum(['QUICKBOOKS', 'METHOD_CRM', 'SHOPIFY', 'MONDAY']) })

/**
 * POST /api/integrations/:provider/disconnect
 *
 * Removes the stored credential and stops the scheduled sync. Imported
 * history stays in the reporting database.
 */
integrationsRouter.post(
  '/:provider/disconnect',
  requireAuth(PERMISSIONS.SETTINGS_MANAGE),
  handler(async (req, res) => {
    const user = currentUser(res)
    if (user.isDemo) {
      res.status(403)
      return { ok: false, error: 'DEMO_SESSION', message: 'A demo session cannot change an integration.' }
    }

    const parsed = disconnectParams.safeParse(req.params)
    if (!parsed.success) {
      res.status(400)
      return { ok: false, error: 'INVALID_REQUEST', message: 'Unknown source system.' }
    }

    const result = await disconnectProvider(parsed.data.provider, user)
    if (!result.ok) res.status(404)
    return { ok: result.ok, provider: parsed.data.provider, message: result.detail }
  }),
)

// ---------------------------------------------------------------------------
// QuickBooks: the Intuit app keys that make the sign-in possible
// ---------------------------------------------------------------------------

const quickBooksAppBody = z.object({
  clientId: z.string().trim().min(10, 'Paste the full Client ID from the Intuit developer portal.').max(255),
  clientSecret: z.string().trim().min(10, 'Paste the full Client Secret from the Intuit developer portal.').max(255),
  environment: z.enum(['sandbox', 'production']).default('sandbox'),
})

/**
 * POST /api/integrations/quickbooks/app  { clientId, clientSecret, environment }
 *
 * Saves the Intuit app registration encrypted so the OAuth sign-in can start
 * without touching the server environment. Replies with the URL that starts
 * the sign-in; the client navigates there straight away.
 */
integrationsRouter.post(
  '/quickbooks/app',
  requireAuth(PERMISSIONS.SETTINGS_MANAGE),
  handler(async (req, res) => {
    const refused = refuseIfCannotStore(res)
    if (refused) return refused

    const parsed = quickBooksAppBody.safeParse(req.body ?? {})
    if (!parsed.success) {
      res.status(400)
      return { ok: false, error: 'INVALID_REQUEST', message: parsed.error.issues[0]?.message ?? 'Check the keys.' }
    }

    await storeQuickBooksApp(parsed.data, currentUser(res))
    const returnTo = param(req.query.returnTo) ?? 'data-health'
    return {
      ok: true,
      provider: 'QUICKBOOKS',
      message: `Intuit app keys saved (${parsed.data.environment}). Continue with the Intuit sign-in to connect the company.`,
      connectUrl: `/api/integrations/quickbooks/connect?returnTo=${encodeURIComponent(returnTo)}`,
      redirectUri: quickBooksRedirectUri(),
    }
  }),
)

/** POST /api/integrations/quickbooks/app/clear - forget the stored app keys and the tokens they issued. */
integrationsRouter.post(
  '/quickbooks/app/clear',
  requireAuth(PERMISSIONS.SETTINGS_MANAGE),
  handler(async (_req, res) => {
    const user = currentUser(res)
    if (user.isDemo) {
      res.status(403)
      return { ok: false, error: 'DEMO_SESSION', message: 'A demo session cannot change an integration.' }
    }
    const removed = await clearQuickBooksApp(user)
    if (!removed) res.status(404)
    return {
      ok: removed,
      provider: 'QUICKBOOKS',
      message: removed
        ? 'The stored Intuit app keys were removed and QuickBooks is disconnected.'
        : 'No Intuit app keys are stored; the server environment, if set, is still in use.',
    }
  }),
)
