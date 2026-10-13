import { QueryCache, QueryClient, MutationCache, useQuery, type UseQueryOptions } from '@tanstack/react-query'
import { useLocation } from 'react-router'
import { api, ApiError } from './api'

/**
 * TanStack Query setup.
 *
 * Business figures are always fetched fresh when a page is opened
 * (`staleTime: 0`), matching the old server-rendered pages, but a cached
 * result is shown instantly while revalidating. A 401 anywhere sends the user
 * to sign-in (keeping the path); a 403 on a page query goes to /no-access.
 */

function redirect(to: string) {
  // A hard navigation clears every cached figure from memory, which is what
  // should happen when the session has ended.
  if (window.location.pathname + window.location.search !== to) window.location.assign(to)
}

function onAuthError(error: unknown) {
  if (!(error instanceof ApiError)) return
  if (error.status === 401 && !window.location.pathname.startsWith('/sign-in')) {
    const next = window.location.pathname + window.location.search
    redirect(`/sign-in?next=${encodeURIComponent(next)}`)
  }
}

export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error, query) => {
      onAuthError(error)
      if (error instanceof ApiError && error.status === 403 && query.meta?.page) {
        const permission = error.requiredPermission
        redirect(permission ? `/no-access?permission=${encodeURIComponent(permission)}` : '/no-access')
      }
    },
  }),
  mutationCache: new MutationCache({ onError: onAuthError }),
  defaultOptions: {
    queries: {
      staleTime: 0,
      gcTime: 5 * 60 * 1000,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => {
        if (error instanceof ApiError && error.status > 0 && error.status < 500) return false
        return failureCount < 2
      },
    },
  },
})

/**
 * Data for an analytics/admin page: GET /api/pages/<name><current ?search>.
 *
 * The URL query string (range, division, rep, ...) is forwarded verbatim, so
 * the server resolves filters exactly as the server-rendered page did, and
 * each filter combination is its own cache entry.
 */
export function usePageData<T>(
  name: string,
  options: Omit<UseQueryOptions<T, ApiError>, 'queryKey' | 'queryFn'> = {},
) {
  const { search } = useLocation()
  return useQuery<T, ApiError>({
    queryKey: ['page', name, search],
    queryFn: () => api.get<T>(`/api/pages/${name}`, search),
    meta: { page: true },
    placeholderData: (previous) => previous,
    ...options,
  })
}

/** Re-fetch everything on screen (the old `router.refresh()`). */
export function refreshAll(): Promise<void> {
  return queryClient.invalidateQueries()
}
