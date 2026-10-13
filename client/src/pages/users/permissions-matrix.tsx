
import * as React from 'react'
import { Lock, RotateCcw, Save } from 'lucide-react'
import { DEFAULT_ROLE_PERMISSIONS, PERMISSIONS } from '@shared/permissions'
import type { RoleName } from '@shared/enums'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Alert } from '@/components/ui/feedback'
import { Checkbox } from '@/components/ui/misc'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { TBody, TD, TH, THead, TR, Table, TableScroll } from '@/components/ui/table'
import { useUserActions, type ActionResult } from './actions'

/**
 * The editable permissions matrix.
 *
 * Two cells are deliberately locked: a sales representative can never be
 * granted gross margin, nor cross-representative access. Those restrictions
 * are also enforced in code (`sanitizePermissions`), so a mis-click here could
 * not leak them anyway - but showing them as locked explains why.
 */

interface RoleColumn {
  name: string
  label: string
  granted: string[]
}

const LOCKED_FOR_SALES_REP = new Set<string>([
  PERMISSIONS.MARGIN_VIEW,
  PERMISSIONS.REVENUE_VIEW_ALL_REPS,
  PERMISSIONS.PIPELINE_VIEW_ALL_REPS,
  PERMISSIONS.USERS_MANAGE,
  PERMISSIONS.SETTINGS_MANAGE,
  PERMISSIONS.METRICS_APPROVE,
  PERMISSIONS.AUDIT_VIEW,
  PERMISSIONS.DATA_HEALTH_MANAGE,
])

export function PermissionsMatrix({
  permissions,
  roles,
}: {
  permissions: { key: string; label: string }[]
  roles: RoleColumn[]
}) {
  const [state, setState] = React.useState<Record<string, Set<string>>>(() =>
    Object.fromEntries(roles.map((role) => [role.name, new Set(role.granted)])),
  )
  const { updateRolePermissions, resetRolePermissionsToDefault } = useUserActions()
  const [busy, setBusy] = React.useState<string | null>(null)
  const [result, setResult] = React.useState<ActionResult | null>(null)

  const initial = React.useRef(
    Object.fromEntries(roles.map((role) => [role.name, new Set(role.granted)])),
  )

  const toggle = (roleName: string, permission: string, checked: boolean) => {
    setState((prev) => {
      const next = new Set(prev[roleName] ?? [])
      if (checked) next.add(permission)
      else next.delete(permission)
      return { ...prev, [roleName]: next }
    })
  }

  const isDirty = (roleName: string): boolean => {
    const current = state[roleName] ?? new Set<string>()
    const original = initial.current[roleName] ?? new Set<string>()
    if (current.size !== original.size) return true
    for (const value of current) if (!original.has(value)) return true
    return false
  }

  const save = async (roleName: string) => {
    setBusy(roleName)
    setResult(null)
    const formData = new FormData()
    formData.set('roleName', roleName)
    for (const permission of state[roleName] ?? []) formData.append('permissions', permission)

    try {
      const outcome = await updateRolePermissions(formData)
      setResult(outcome)
      if (outcome.ok) {
        initial.current = { ...initial.current, [roleName]: new Set(state[roleName] ?? []) }
      }
    } catch {
      setResult({ ok: false, message: 'Something went wrong saving those permissions.' })
    } finally {
      setBusy(null)
    }
  }

  const resetToDefault = async (roleName: string) => {
    setBusy(roleName)
    setResult(null)
    const formData = new FormData()
    formData.set('roleName', roleName)
    try {
      const outcome = await resetRolePermissionsToDefault(formData)
      setResult(outcome)
      // The server now holds exactly the proposed defaults for this role (the
      // page data is re-fetched too); show them without a full page reload.
      if (outcome.ok) {
        const defaults = new Set<string>(DEFAULT_ROLE_PERMISSIONS[roleName as RoleName] ?? [])
        setState((prev) => ({ ...prev, [roleName]: defaults }))
        initial.current = { ...initial.current, [roleName]: new Set(defaults) }
      }
    } catch {
      setResult({ ok: false, message: 'Something went wrong resetting that role.' })
    } finally {
      setBusy(null)
    }
  }

  const dirtyRoles = roles.filter((role) => isDirty(role.name))

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>What each role may see</CardTitle>
          <CardDescription>
            Tick a box to grant a permission. Changes take effect at each user&apos;s next request.
          </CardDescription>
        </div>
        {dirtyRoles.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {dirtyRoles.map((role) => (
              <Button
                key={role.name}
                variant="primary"
                size="sm"
                loading={busy === role.name}
                onClick={() => void save(role.name)}
              >
                <Save aria-hidden />
                Save {role.label}
              </Button>
            ))}
          </div>
        ) : null}
      </CardHeader>

      {result ? (
        <div className="border-b border-ink-200 p-4 sm:p-5">
          <Alert tone={result.ok ? 'positive' : 'negative'} title={result.ok ? 'Saved' : 'Not saved'}>
            {result.message}
          </Alert>
        </div>
      ) : null}

      <TableScroll>
        <Table>
          <THead>
            <TR>
              <TH className="min-w-[18rem]">Permission</TH>
              {roles.map((role) => (
                <TH key={role.name} className="text-center">
                  <span className="block">{role.label}</span>
                  {isDirty(role.name) ? (
                    <span className="mt-0.5 block text-[10px] font-normal normal-case text-warning-700">
                      unsaved
                    </span>
                  ) : null}
                </TH>
              ))}
            </TR>
          </THead>
          <TBody>
            {permissions.map((permission) => (
              <TR key={permission.key} className="hover:bg-ink-50">
                <TD>
                  <span className="block text-[13px] text-ink-800">{permission.label}</span>
                  <span className="block font-mono text-[11px] text-ink-500">{permission.key}</span>
                </TD>
                {roles.map((role) => {
                  const locked = role.name === 'SALES_REP' && LOCKED_FOR_SALES_REP.has(permission.key)
                  const checked = state[role.name]?.has(permission.key) ?? false
                  return (
                    <TD key={role.name} className="text-center">
                      {locked ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="inline-flex size-6 items-center justify-center rounded text-ink-400">
                              <Lock className="size-3.5" aria-hidden />
                              <span className="sr-only">
                                Locked: a sales representative can never hold this permission
                              </span>
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>
                            Section 16 of the Phase 1 scope makes this restriction non-negotiable. It is enforced in
                            code as well as here, so it cannot be granted by mistake.
                          </TooltipContent>
                        </Tooltip>
                      ) : (
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(value) => toggle(role.name, permission.key, value === true)}
                          aria-label={`${permission.label} for ${role.label}`}
                          className="mx-auto"
                        />
                      )}
                    </TD>
                  )
                })}
              </TR>
            ))}
          </TBody>
        </Table>
      </TableScroll>

      <CardContent className="border-t border-ink-200 bg-ink-50/60">
        <div className="flex flex-wrap items-center gap-2">
          <p className="mr-auto text-[12px] text-ink-600">
            Restore a role to the proposed defaults from the Phase 1 scope:
          </p>
          {roles.map((role) => (
            <Button
              key={role.name}
              variant="ghost"
              size="sm"
              loading={busy === role.name}
              onClick={() => void resetToDefault(role.name)}
            >
              <RotateCcw aria-hidden />
              {role.label}
            </Button>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
