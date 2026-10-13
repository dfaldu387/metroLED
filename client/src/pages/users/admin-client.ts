import { useQuery, type QueryKey } from '@tanstack/react-query'
import { api, type ApiError } from '@/lib/api'

/**
 * Client plumbing shared by the administration pages (Users & Permissions and
 * Settings).
 */

/** Query keys. Every admin mutation invalidates its area's prefix. */
export const ADMIN_KEYS = {
  users: ['admin', 'users'] as const,
  settings: ['admin', 'settings'] as const,
  settingsCompany: ['admin', 'settings', 'company'] as const,
  settingsBrief: ['admin', 'settings', 'brief'] as const,
  settingsDivisions: ['admin', 'settings', 'divisions'] as const,
  settingsMetrics: ['admin', 'settings', 'metrics'] as const,
  settingsIntegrations: ['admin', 'settings', 'integrations'] as const,
}

/**
 * Page data for an admin page. `meta.page` makes the query client send a 401
 * to sign-in and a 403 to /no-access, as the server-rendered page did.
 */
export function useAdminPage<T>(queryKey: QueryKey, path: string) {
  return useQuery<T, ApiError>({
    queryKey,
    queryFn: () => api.get<T>(path),
    meta: { page: true },
  })
}

/**
 * The JSON body for a former Server Action: the form's fields under the same
 * names. Fields listed in `arrays` are read with `getAll` (checkbox groups such
 * as `roles`), everything else with `get`.
 */
export function formBody(formData: FormData, arrays: string[] = []): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of new Set(formData.keys())) {
    if (arrays.includes(key)) out[key] = formData.getAll(key).filter((v) => typeof v === 'string')
    else {
      const v = formData.get(key)
      out[key] = typeof v === 'string' ? v : null
    }
  }
  for (const key of arrays) if (!(key in out)) out[key] = []
  return out
}
