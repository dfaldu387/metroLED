import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { PERMISSIONS } from '@/lib/auth/permissions'
import { requireApiPermission } from '@/lib/auth/guards'
import { integrationEnv, env } from '@/lib/env'
import { credentialEncryptionConfigured, randomToken } from '@/lib/crypto'
import { quickBooksAuthorizeUrl } from '@/lib/integrations/quickbooks'
import { OAUTH_STATE_COOKIE } from '@/lib/oauth-state'

/**
 * Starts the QuickBooks Online OAuth flow.
 *
 * A random `state` value is generated and stored in a short-lived httpOnly
 * cookie. The callback compares it to the value Intuit returns, which is what
 * prevents an attacker from completing the connection with their own
 * authorisation code (CSRF on the OAuth callback).
 */
export async function GET() {
  const auth = await requireApiPermission(PERMISSIONS.SETTINGS_MANAGE)
  if (!auth.ok) return auth.response

  if (auth.user.isDemo) {
    return NextResponse.json(
      { error: 'DEMO_SESSION', message: 'A demo session cannot connect an integration.' },
      { status: 403 },
    )
  }

  if (!credentialEncryptionConfigured()) {
    return NextResponse.json(
      {
        error: 'NOT_CONFIGURED',
        message:
          'CREDENTIAL_ENCRYPTION_KEY is not set, so the QuickBooks tokens could not be stored. Set it and restart before connecting.',
      },
      { status: 503 },
    )
  }

  if (!integrationEnv.quickbooks().configured) {
    return NextResponse.json(
      {
        error: 'NOT_CONFIGURED',
        message: 'QBO_CLIENT_ID and QBO_CLIENT_SECRET must be set before QuickBooks can be connected.',
      },
      { status: 503 },
    )
  }

  const state = randomToken(16)
  const jar = await cookies()
  jar.set(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: env().APP_URL.startsWith('https://'),
    path: '/',
    maxAge: 600,
  })

  return NextResponse.redirect(quickBooksAuthorizeUrl(state))
}
