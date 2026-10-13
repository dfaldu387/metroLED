import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { ActionResult } from '@shared/api/session'
import type { RoleName } from '@shared/enums'
import { api, type ApiError } from '@/lib/api'
import { SESSION_KEY, useCurrentUser } from '@/lib/session'
import { ADMIN_KEYS, formBody } from './admin-client'

export type { ActionResult }

interface ActionCall {
  method: 'post' | 'put'
  path: string
  body: Record<string, unknown>
  /** The change can alter the signed-in user's own roles, permissions or sessions. */
  affectsSession: boolean
}

/**
 * User administration actions (the former `users/actions.ts` Server Actions),
 * as functions with the same `(formData) => Promise<ActionResult>` shape so the
 * dialogs and tables keep their pending / inline-message behaviour.
 *
 * Each call goes through one `useMutation`; on success the page data is
 * re-fetched (the old `revalidatePath('/users')`), and the session too when the
 * change may affect the signed-in user's own access.
 */
export function useUserActions() {
  const queryClient = useQueryClient()
  const me = useCurrentUser()

  const mutation = useMutation<ActionResult, ApiError, ActionCall>({
    mutationFn: ({ method, path, body }) => api[method]<ActionResult>(path, body),
    onSuccess: async (result, call) => {
      if (!result.ok) return
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ADMIN_KEYS.users }),
        call.affectsSession ? queryClient.invalidateQueries({ queryKey: SESSION_KEY }) : undefined,
      ])
    },
  })

  const run = (call: ActionCall) => mutation.mutateAsync(call)
  const userPath = (formData: FormData, suffix: string) =>
    `/api/users/${encodeURIComponent(String(formData.get('userId') ?? ''))}/${suffix}`
  const rolePath = (formData: FormData, suffix: string) =>
    `/api/users/roles/${encodeURIComponent(String(formData.get('roleName') ?? ''))}/${suffix}`
  const isMe = (formData: FormData) => formData.get('userId') === me.id
  const holdsRole = (formData: FormData) => me.roles.includes(String(formData.get('roleName')) as RoleName)

  return {
    isPending: mutation.isPending,
    createUser: (formData: FormData) =>
      run({
        method: 'post',
        path: '/api/users',
        body: formBody(formData, ['roles', 'divisionIds']),
        affectsSession: false,
      }),
    updateUserRoles: (formData: FormData) =>
      run({
        method: 'put',
        path: userPath(formData, 'roles'),
        body: formBody(formData, ['roles']),
        affectsSession: isMe(formData),
      }),
    setUserActive: (formData: FormData) =>
      run({
        method: 'put',
        path: userPath(formData, 'active'),
        body: formBody(formData),
        affectsSession: isMe(formData),
      }),
    resetUserPassword: (formData: FormData) =>
      run({
        method: 'post',
        path: userPath(formData, 'reset-password'),
        body: formBody(formData),
        affectsSession: isMe(formData),
      }),
    updateRolePermissions: (formData: FormData) =>
      run({
        method: 'put',
        path: rolePath(formData, 'permissions'),
        body: formBody(formData, ['permissions']),
        affectsSession: holdsRole(formData),
      }),
    resetRolePermissionsToDefault: (formData: FormData) =>
      run({
        method: 'post',
        path: rolePath(formData, 'reset'),
        body: formBody(formData),
        affectsSession: holdsRole(formData),
      }),
  }
}
