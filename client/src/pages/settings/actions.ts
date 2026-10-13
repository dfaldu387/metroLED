import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query'
import type { ActionResult } from '@shared/api/session'
import { api, type ApiError } from '@/lib/api'
import { ADMIN_KEYS, formBody } from '@/pages/users/admin-client'

export type SettingsResult = ActionResult

interface SettingsCall {
  method: 'post' | 'put' | 'delete'
  path: string
  body?: Record<string, unknown>
  /** Other pages whose figures depend on the change (the old extra `revalidatePath` calls). */
  alsoInvalidate?: QueryKey[]
}

const seg = (formData: FormData, name: string) => encodeURIComponent(String(formData.get(name) ?? ''))

/**
 * Settings actions (the former `settings/actions.ts` Server Actions), with the
 * same `(formData) => Promise<SettingsResult>` shape the forms call. One
 * `useMutation` backs them all; on success every settings query is re-fetched,
 * plus the pages the old action revalidated.
 */
export function useSettingsActions() {
  const queryClient = useQueryClient()

  const mutation = useMutation<SettingsResult, ApiError, SettingsCall>({
    mutationFn: ({ method, path, body }) => api[method]<SettingsResult>(path, body ?? {}),
    onSuccess: async (result, call) => {
      if (!result.ok) return
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ADMIN_KEYS.settings }),
        ...(call.alsoInvalidate ?? []).map((queryKey) => queryClient.invalidateQueries({ queryKey })),
      ])
    },
  })

  const run = (call: SettingsCall) => mutation.mutateAsync(call)

  return {
    isPending: mutation.isPending,
    // Company settings change thresholds every analytics page uses (was revalidatePath('/overview')).
    updateCompanySettings: (formData: FormData) =>
      run({ method: 'put', path: '/api/settings/company', body: formBody(formData), alsoInvalidate: [['page']] }),
    updateBriefSchedule: (formData: FormData) =>
      run({
        method: 'put',
        path: '/api/settings/brief/schedule',
        body: formBody(formData),
        alsoInvalidate: [['page', 'daily-brief']],
      }),
    addBriefRecipient: (formData: FormData) =>
      run({ method: 'post', path: '/api/settings/brief/recipients', body: formBody(formData) }),
    removeBriefRecipient: (formData: FormData) =>
      run({ method: 'delete', path: `/api/settings/brief/recipients/${seg(formData, 'recipientId')}` }),
    createDivision: (formData: FormData) =>
      run({ method: 'post', path: '/api/settings/divisions', body: formBody(formData) }),
    createMappingRule: (formData: FormData) =>
      run({ method: 'post', path: '/api/settings/mapping-rules', body: formBody(formData) }),
    deleteMappingRule: (formData: FormData) =>
      run({ method: 'delete', path: `/api/settings/mapping-rules/${seg(formData, 'ruleId')}` }),
    setCogsAccountIncluded: (formData: FormData) =>
      run({
        method: 'put',
        path: `/api/settings/cogs-accounts/${seg(formData, 'mappingId')}`,
        body: formBody(formData),
        alsoInvalidate: [['page', 'gross-margin']],
      }),
    approveMetricDefinition: (formData: FormData) =>
      run({
        method: 'post',
        path: `/api/settings/metrics/${seg(formData, 'metricKey')}/approval`,
        body: formBody(formData),
        alsoInvalidate: [['page', 'gross-margin']],
      }),
  }
}
