import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { PERMISSIONS } from '@/lib/auth/permissions'
import { requireApiPermission } from '@/lib/auth/guards'
import { env } from '@/lib/env'
import { safeEqual } from '@/lib/crypto'
import { prisma } from '@/lib/db'
import { exchangeQuickBooksCode } from '@/lib/integrations/quickbooks'
import { ensureIntegration, writeCredentials } from '@/lib/integrations/credentials'
import { testProviderConnection } from '@/lib/integrations/sync-service'
import { AUDIT_ACTIONS, recordAudit } from '@/lib/auth/audit'
import { OAUTH_STATE_COOKIE } from '@/lib/oauth-state'

/**
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
export async function GET(request: Request) {
  const auth = await requireApiPermission(PERMISSIONS.SETTINGS_MANAGE)
  if (!auth.ok) return auth.response

  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const realmId = url.searchParams.get('realmId')
  const state = url.searchParams.get('state')
  const error = url.searchParams.get('error')

  const jar = await cookies()
  const expectedState = jar.get(OAUTH_STATE_COOKIE)?.value
  jar.delete(OAUTH_STATE_COOKIE)

  const back = (message: string, ok: boolean) =>
    NextResponse.redirect(
      `${env().APP_URL}/settings/integrations?${new URLSearchParams({
        connected: ok ? 'quickbooks' : '',
        message,
      }).toString()}`,
    )

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

    await prisma.integration.update({
      where: { id: integrationId },
      data: {
        config: { realmId, environment: env().QBO_ENVIRONMENT, minorVersion: env().QBO_MINOR_VERSION },
        tokenExpiresAt: new Date(credentials.accessTokenExpiresAt),
        status: 'CONNECTED',
        isEnabled: true,
        consecutiveFailures: 0,
        lastErrorMessage: null,
      },
    })

    // Only claim the connection works after it has actually answered.
    const test = await testProviderConnection('QUICKBOOKS')
    if (!test.ok) {
      await prisma.integration.update({
        where: { id: integrationId },
        data: { status: 'ERROR', lastErrorAt: new Date(), lastErrorMessage: test.detail },
      })
    }

    await recordAudit({
      action: AUDIT_ACTIONS.INTEGRATION_CONNECTED,
      summary: `${auth.user.name} connected QuickBooks Online (realm ${realmId}). ${test.ok ? 'Connection verified.' : `Connection test failed: ${test.detail}`}`,
      actor: auth.user,
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
      summary: `${auth.user.name} attempted to connect QuickBooks Online and it failed: ${message}`,
      actor: auth.user,
      entityType: 'Integration',
      entityId: 'QUICKBOOKS',
    })
    return back(`QuickBooks could not be connected: ${message}`, false)
  }
}
