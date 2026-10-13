/**
 * Name of the short-lived cookie that carries the OAuth `state` value.
 *
 * It lives in its own module because a Next.js route file may only export
 * HTTP method handlers and a small set of known config values - exporting a
 * constant from one fails the production build.
 */
export const OAUTH_STATE_COOKIE = 'metroled_qbo_state'
