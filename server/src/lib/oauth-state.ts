/**
 * Name of the short-lived cookie that carries the OAuth `state` value.
 *
 * It lives in its own module because a Next.js route file may only export
 * HTTP method handlers and a small set of known config values - exporting a
 * constant from one fails the production build.
 */
export const OAUTH_STATE_COOKIE = 'metroled_qbo_state'

/** Companion cookie: which page to return to once Intuit redirects back. */
export const OAUTH_RETURN_COOKIE = 'metroled_qbo_return'

const RETURN_PATHS: Record<string, string> = {
  'data-health': '/data-health',
  settings: '/settings/integrations',
  '/data-health': '/data-health',
  '/settings/integrations': '/settings/integrations',
}

/** Maps a `returnTo` hint to one of the two known pages; anything else goes to Data Health. */
export function oauthReturnPath(hint: string | null | undefined): string {
  return (hint && RETURN_PATHS[hint]) || '/data-health'
}
