import { Router } from 'express'
import { PERMISSIONS } from '@shared/permissions'
import { currentUser, requireAuth } from '../lib/auth/guards'
import { env, integrationEnv } from '../lib/env'
import { credentialEncryptionConfigured, randomToken, safeEqual } from '../lib/crypto'
import { db, sql } from '../lib/db'
import { exchangeQuickBooksCode, quickBooksAuthorizeUrl } from '../lib/integrations/quickbooks'
import { ensureIntegration, writeCredentials } from '../lib/integrations/credentials'
import { testProviderConnection } from '../lib/integrations/sync-service'
import { AUDIT_ACTIONS, recordAudit } from '../lib/auth/audit'
import { OAUTH_STATE_COOKIE } from '../lib/oauth-state'
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
  handler(async (_req, res) => {
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

    if (!integrationEnv.quickbooks().configured) {
      res.status(503)
      return {
        error: 'NOT_CONFIGURED',
        message: 'QBO_CLIENT_ID and QBO_CLIENT_SECRET must be set before QuickBooks can be connected.',
      }
    }

    const state = randomToken(16)
    cookieJar.set(OAUTH_STATE_COOKIE, state, {
      httpOnly: true,
      sameSite: 'lax',
      secure: env().APP_URL.startsWith('https://'),
      path: '/',
      maxAge: 600 * 1000, // Express takes milliseconds (Next took seconds).
    })

    res.redirect(303, quickBooksAuthorizeUrl(state))
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
    cookieJar.delete(OAUTH_STATE_COOKIE)

    const back = (message: string, ok: boolean) => {
      res.redirect(
        303,
        `${env().APP_URL}/settings/integrations?${new URLSearchParams({
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
      const credentials = await exchangeQuickBooksCode(code, realmId)
      const integrationId = await ensureIntegration('QUICKBOOKS', 'QuickBooks Online')
      await writeCredentials(integrationId, credentials)

      await db.exec(sql`
        UPDATE "Integration" SET
          "config" = ${{ realmId, environment: env().QBO_ENVIRONMENT, minorVersion: env().QBO_MINOR_VERSION }},
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
        metadata: { realmId, environment: env().QBO_ENVIRONMENT, verified: test.ok },
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
