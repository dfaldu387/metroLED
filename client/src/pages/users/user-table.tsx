
import * as React from 'react'
import { KeyRound, MoreHorizontal, ShieldCheck, UserMinus, UserPlus } from 'lucide-react'
import { ROLE_LABELS } from '@shared/permissions'
import { formatDate } from '@shared/format'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Alert } from '@/components/ui/feedback'
import { ConfirmDialog, Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Checkbox, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/misc'
import { Label } from '@/components/ui/form'
import { TBody, TD, TH, THead, TR, Table, TableScroll } from '@/components/ui/table'
import { useUserActions, type ActionResult } from './actions'

/**
 * The user list with its administrative actions.
 *
 * Every consequential action (deactivate, reset password, change roles) goes
 * through a confirmation that states exactly what will happen, including that
 * active sessions will be signed out.
 */

export interface UserRow {
  id: string
  name: string
  email: string
  isActive: boolean
  mustChangePassword: boolean
  lastLoginAt: string | null
  lockedUntil: string | null
  roles: string[]
  divisionNames: string[]
  salesRepName: string | null
  activeSessions: number
}

const ROLE_VALUES = ['OWNER', 'FINANCE', 'ECOMMERCE', 'SALES_REP', 'OPERATIONS'] as const

export function UserTable({ users, currentUserId }: { users: UserRow[]; currentUserId: string }) {
  const [result, setResult] = React.useState<ActionResult | null>(null)
  const { resetUserPassword, setUserActive, updateUserRoles } = useUserActions()
  const [busy, setBusy] = React.useState(false)
  const [confirmDeactivate, setConfirmDeactivate] = React.useState<UserRow | null>(null)
  const [confirmReset, setConfirmReset] = React.useState<UserRow | null>(null)
  const [editingRoles, setEditingRoles] = React.useState<UserRow | null>(null)

  const run = async (action: (formData: FormData) => Promise<ActionResult>, formData: FormData) => {
    setBusy(true)
    setResult(null)
    try {
      setResult(await action(formData))
    } catch {
      setResult({ ok: false, message: 'Something went wrong. Please try again.' })
    } finally {
      setBusy(false)
      setConfirmDeactivate(null)
      setConfirmReset(null)
      setEditingRoles(null)
    }
  }

  return (
    <>
      {result ? (
        <div className="border-b border-ink-200 p-4 sm:p-5">
          <Alert tone={result.ok ? 'positive' : 'negative'} title={result.ok ? 'Done' : 'That did not work'}>
            <p>{result.message}</p>
            {result.secret ? (
              <p className="mt-2">
                One-time password:{' '}
                <code className="rounded bg-surface px-1.5 py-0.5 font-mono text-[12.5px] font-semibold text-ink-900">
                  {result.secret}
                </code>
                <br />
                <span className="text-[12px] text-ink-600">
                  This is shown once and is not stored in readable form. Pass it to the user over a channel you
                  trust.
                </span>
              </p>
            ) : null}
          </Alert>
        </div>
      ) : null}

      <TableScroll>
        <Table>
          <THead>
            <TR>
              <TH>Name</TH>
              <TH>Roles</TH>
              <TH>Scope</TH>
              <TH>Status</TH>
              <TH>Last sign-in</TH>
              <TH>
                <span className="sr-only">Actions</span>
              </TH>
            </TR>
          </THead>
          <TBody>
            {users.map((user) => {
              const locked = user.lockedUntil && new Date(user.lockedUntil) > new Date()
              return (
                <TR key={user.id} className={user.isActive ? 'hover:bg-ink-50' : 'bg-ink-50/50'}>
                  <TD>
                    <span className="block font-medium text-ink-900">
                      {user.name}
                      {user.id === currentUserId ? (
                        <span className="ml-1.5 text-[11.5px] font-normal text-ink-500">(you)</span>
                      ) : null}
                    </span>
                    <span className="block text-[12px] text-ink-600">{user.email}</span>
                  </TD>
                  <TD>
                    <span className="flex flex-wrap gap-1">
                      {user.roles.length === 0 ? (
                        <Badge variant="negative" size="sm">
                          No role
                        </Badge>
                      ) : (
                        user.roles.map((role) => (
                          <Badge key={role} variant={role === 'OWNER' ? 'brand' : 'neutral'} size="sm">
                            {ROLE_LABELS[role as keyof typeof ROLE_LABELS] ?? role}
                          </Badge>
                        ))
                      )}
                    </span>
                  </TD>
                  <TD className="text-[12.5px] text-ink-600">
                    {user.salesRepName ? (
                      <span className="block">Rep: {user.salesRepName}</span>
                    ) : user.roles.includes('SALES_REP') ? (
                      <span className="block text-warning-800">No rep record linked</span>
                    ) : null}
                    {user.divisionNames.length > 0 ? (
                      <span className="block">{user.divisionNames.join(', ')}</span>
                    ) : (
                      <span className="block text-ink-500">All divisions</span>
                    )}
                  </TD>
                  <TD>
                    <span className="flex flex-col gap-1">
                      <Badge variant={user.isActive ? 'positive' : 'neutral'} size="sm">
                        {user.isActive ? 'Active' : 'Deactivated'}
                      </Badge>
                      {locked ? (
                        <Badge variant="warning" size="sm">
                          Locked
                        </Badge>
                      ) : null}
                      {user.mustChangePassword ? (
                        <Badge variant="warning" size="sm">
                          Must change password
                        </Badge>
                      ) : null}
                    </span>
                  </TD>
                  <TD className="whitespace-nowrap text-[12.5px] text-ink-700">
                    {user.lastLoginAt ? formatDate(user.lastLoginAt) : <span className="italic text-ink-500">Never</span>}
                    {user.activeSessions > 0 ? (
                      <span className="mt-0.5 block text-[11.5px] text-ink-500">
                        {user.activeSessions} active {user.activeSessions === 1 ? 'session' : 'sessions'}
                      </span>
                    ) : null}
                  </TD>
                  <TD className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${user.name}`}>
                          <MoreHorizontal aria-hidden />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => setEditingRoles(user)}>
                          <ShieldCheck aria-hidden />
                          Change roles
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setConfirmReset(user)}>
                          <KeyRound aria-hidden />
                          Reset password
                        </DropdownMenuItem>
                        {user.isActive ? (
                          <DropdownMenuItem
                            tone="danger"
                            disabled={user.id === currentUserId}
                            onSelect={() => setConfirmDeactivate(user)}
                          >
                            <UserMinus aria-hidden />
                            Deactivate account
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem
                            onSelect={() => {
                              const formData = new FormData()
                              formData.set('userId', user.id)
                              formData.set('isActive', 'true')
                              void run(setUserActive, formData)
                            }}
                          >
                            <UserPlus aria-hidden />
                            Reactivate account
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TD>
                </TR>
              )
            })}
          </TBody>
        </Table>
      </TableScroll>

      {/* --- Deactivate ---------------------------------------------------- */}
      <ConfirmDialog
        open={confirmDeactivate !== null}
        onOpenChange={(open) => !open && setConfirmDeactivate(null)}
        title={`Deactivate ${confirmDeactivate?.name ?? ''}?`}
        description={
          <>
            <p>
              They will be signed out immediately and will not be able to sign in again until an owner reactivates
              the account.
            </p>
            <p className="mt-2">
              Their historical records stay intact. Nothing they created is deleted, and the audit log keeps their
              past actions.
            </p>
          </>
        }
        confirmLabel="Deactivate account"
        tone="danger"
        loading={busy}
        onConfirm={() => {
          if (!confirmDeactivate) return
          const formData = new FormData()
          formData.set('userId', confirmDeactivate.id)
          formData.set('isActive', 'false')
          void run(setUserActive, formData)
        }}
      />

      {/* --- Reset password ------------------------------------------------- */}
      <ConfirmDialog
        open={confirmReset !== null}
        onOpenChange={(open) => !open && setConfirmReset(null)}
        title={`Reset the password for ${confirmReset?.name ?? ''}?`}
        description={
          <>
            <p>
              A new one-time password is generated and shown to you once. {confirmReset?.name} will be signed out of
              every session and must change the password at their next sign-in.
            </p>
            <p className="mt-2">Their existing password stops working immediately.</p>
          </>
        }
        confirmLabel="Reset password"
        loading={busy}
        onConfirm={() => {
          if (!confirmReset) return
          const formData = new FormData()
          formData.set('userId', confirmReset.id)
          void run(resetUserPassword, formData)
        }}
      />

      {/* --- Change roles ---------------------------------------------------- */}
      <Dialog open={editingRoles !== null} onOpenChange={(open) => !open && setEditingRoles(null)}>
        {editingRoles ? (
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Change roles for {editingRoles.name}</DialogTitle>
              <DialogDescription>
                Roles decide which pages and figures this person can reach. Changing them signs them out so the
                change takes effect immediately.
              </DialogDescription>
            </DialogHeader>
            <form
              action={(formData) => {
                formData.set('userId', editingRoles.id)
                void run(updateUserRoles, formData)
              }}
            >
              <DialogBody className="space-y-2.5">
                {ROLE_VALUES.map((role) => (
                  <label
                    key={role}
                    className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-ink-200 px-3 py-2.5 transition-colors hover:bg-ink-50"
                  >
                    <Checkbox name="roles" value={role} defaultChecked={editingRoles.roles.includes(role)} className="mt-0.5" />
                    <span>
                      <span className="block text-[13.5px] font-medium text-ink-900">
                        {ROLE_LABELS[role]}
                      </span>
                      <span className="block text-[12px] leading-5 text-ink-600">
                        {role === 'SALES_REP'
                          ? 'Own sales data only. Never receives gross margin, whatever the matrix says.'
                          : role === 'OWNER'
                            ? 'Full access, including administration and the audit log.'
                            : `See the permissions matrix for exactly what ${ROLE_LABELS[role]} includes.`}
                      </span>
                    </span>
                  </label>
                ))}
                {editingRoles.roles.includes('SALES_REP') && !editingRoles.salesRepName ? (
                  <Alert tone="warning" title="No sales representative record is linked">
                    Until this account is linked to a representative record, it will see no sales data at all. The
                    restriction fails closed rather than showing everything.
                  </Alert>
                ) : null}
              </DialogBody>
              <DialogFooter>
                <Button type="button" variant="secondary" size="sm" onClick={() => setEditingRoles(null)}>
                  Cancel
                </Button>
                <Button type="submit" variant="primary" size="sm" loading={busy}>
                  Save roles
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        ) : null}
      </Dialog>

      <span className="sr-only">
        <Label>User administration</Label>
      </span>
    </>
  )
}
