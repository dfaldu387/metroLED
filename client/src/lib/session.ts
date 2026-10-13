import { useQuery } from '@tanstack/react-query'
import type { SessionInfo, SessionUserInfo } from '@shared/api/session'
import type { Permission } from '@shared/permissions'
import { api } from './api'
import { queryClient } from './query'

/**
 * The signed-in user, from GET /api/auth/session.
 *
 * This drives presentation only (which links to show). Every API endpoint
 * re-checks the session and permission itself.
 */
export const SESSION_KEY = ['session'] as const

export function useSessionInfo() {
  return useQuery({
    queryKey: SESSION_KEY,
    queryFn: () => api.get<SessionInfo>('/api/auth/session'),
    staleTime: 60_000,
  })
}

/** The signed-in user. Only call below <RequireAuth>, where it is guaranteed. */
export function useCurrentUser(): SessionUserInfo {
  const { data } = useSessionInfo()
  if (!data?.user) throw new Error('useCurrentUser() used outside <RequireAuth>')
  return data.user
}

export function hasPermission(user: Pick<SessionUserInfo, 'permissions'> | null | undefined, permission: Permission) {
  return Boolean(user?.permissions.includes(permission))
}

/** After sign-in / sign-out / password change: drop all cached data and the session. */
export async function resetSession(): Promise<void> {
  queryClient.clear()
  await queryClient.invalidateQueries({ queryKey: SESSION_KEY })
}
