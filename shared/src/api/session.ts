import type { RoleName } from '../enums'
import type { Permission } from '../permissions'

/** GET /api/auth/session */
export interface SessionInfo {
  databaseReady: boolean
  demoAvailable: boolean
  environment: 'development' | 'staging' | 'production' | 'test'
  demoPersonas: { role: RoleName; name: string; email: string; description: string }[]
  user: SessionUserInfo | null
}

export interface SessionUserInfo {
  id: string
  name: string
  email: string
  roles: RoleName[]
  roleLabel: string
  permissions: Permission[]
  salesRepId: string | null
  divisionIds: string[]
  mustChangePassword: boolean
  timezone: string
  isDemo: boolean
  /** First page this user's role can open (or '/no-access'). */
  landingPage: string
  /** Navigation hrefs the role may open; the sidebar filters by this. */
  allowedHrefs: string[]
}

/** Body of every non-2xx JSON response from the API. */
export interface ApiErrorBody {
  error: 'UNAUTHENTICATED' | 'FORBIDDEN' | 'NOT_FOUND' | 'BAD_REQUEST' | 'UNAVAILABLE' | 'INTERNAL' | string
  message: string
  requiredPermission?: string
}

/**
 * Result shape for mutations (the former Server Actions). `ok: false` comes
 * back with HTTP 200 when it is an expected, user-facing refusal (validation,
 * demo session, etc.) so forms can show `message` inline.
 */
export interface ActionResult {
  ok: boolean
  message: string
  /** Shown once, e.g. a generated password that is not stored in plain text. */
  secret?: string
}
