import { NextResponse } from 'next/server'
import { getSession, destroySession } from '@/lib/auth/session'
import { AUDIT_ACTIONS, recordAudit } from '@/lib/auth/audit'

/**
 * Sign out.
 *
 * POST only: a sign-out changes server state, so it must not be reachable by a
 * prefetched link or an image tag. The session row is revoked, not just the
 * cookie cleared, so the token cannot be replayed.
 */
export async function POST(request: Request) {
  const user = await getSession()
  await destroySession()

  if (user) {
    await recordAudit({
      action: AUDIT_ACTIONS.SIGN_OUT,
      summary: `${user.name} signed out.`,
      actor: user,
      entityType: 'User',
      entityId: user.id,
    })
  }

  // Redirect relative to the request, not to a hard-coded APP_URL. The same
  // deployment can be reached on more than one hostname (a proxy, a staging
  // alias, a different port), and sending the user to a fixed origin would
  // bounce them off the host they were actually using.
  return NextResponse.redirect(new URL('/sign-in', request.url), { status: 303 })
}
