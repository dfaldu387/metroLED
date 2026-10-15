
import * as React from 'react'
import { UserPlus } from 'lucide-react'
import { ROLE_LABELS } from '@shared/permissions'
import { Button } from '@/components/ui/button'
import { Alert } from '@/components/ui/feedback'
import { notifyResult } from '@/lib/toast'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Field, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/form'
import { Checkbox } from '@/components/ui/misc'
import { useUserActions, type ActionResult } from './actions'

const ROLE_VALUES = ['OWNER', 'FINANCE', 'ECOMMERCE', 'SALES_REP', 'OPERATIONS'] as const

/**
 * Create a user.
 *
 * The password is generated, never chosen here, and shown exactly once. The
 * form explains the sales-rep linkage because an unlinked rep account sees no
 * data at all - which is correct, but surprising if unexplained.
 */
export function CreateUserDialog({
  divisions,
  salesReps,
}: {
  divisions: { id: string; name: string }[]
  salesReps: { id: string; name: string }[]
}) {
  const [open, setOpen] = React.useState(false)
  const { createUser } = useUserActions()
  const [busy, setBusy] = React.useState(false)
  const [result, setResult] = React.useState<ActionResult | null>(null)
  const [selectedRoles, setSelectedRoles] = React.useState<string[]>(['FINANCE'])
  const [salesRepId, setSalesRepId] = React.useState('')

  const needsRepLink = selectedRoles.includes('SALES_REP')

  const toggleRole = (role: string, checked: boolean) => {
    setSelectedRoles((prev) => (checked ? [...new Set([...prev, role])] : prev.filter((r) => r !== role)))
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setResult(null)
      }}
    >
      <DialogTrigger asChild>
        <Button variant="primary" size="md">
          <UserPlus aria-hidden />
          Add a user
        </Button>
      </DialogTrigger>

      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Add a user</DialogTitle>
          <DialogDescription>
            They receive a one-time password and must change it when they first sign in.
          </DialogDescription>
        </DialogHeader>

        <form
          action={async (formData) => {
            setBusy(true)
            setResult(null)
            try {
              const outcome = await createUser(formData)
              setResult(outcome)
              notifyResult(outcome)
            } catch {
              const outcome: ActionResult = { ok: false, message: 'Something went wrong. Please try again.' }
              setResult(outcome)
              notifyResult(outcome)
            } finally {
              setBusy(false)
            }
          }}
        >
          <DialogBody className="space-y-4">
            {result?.secret ? (
              <Alert tone="positive" title="Account created">
                <p>{result.message}</p>
                <p className="mt-2">
                  One-time password:{' '}
                  <code className="rounded bg-surface px-1.5 py-0.5 font-mono text-[12.5px] font-semibold text-ink-900">
                    {result.secret}
                  </code>
                  <br />
                  <span className="text-[12px] text-ink-600">
                    Shown once only. Pass it on over a channel you trust.
                  </span>
                </p>
              </Alert>
            ) : null}

            <Field label="Full name" htmlFor="name" required>
              <Input id="name" name="name" required autoComplete="off" placeholder="Farida Jooma" />
            </Field>

            <Field label="Email address" htmlFor="email" required help="This is also their sign-in name.">
              <Input
                id="email"
                name="email"
                type="email"
                required
                autoComplete="off"
                placeholder="name@metroled.com"
              />
            </Field>

            <fieldset>
              <legend className="mb-1.5 block text-[13px] font-medium text-ink-800">
                Roles <span className="text-negative-600">*</span>
              </legend>
              <div className="space-y-1.5">
                {ROLE_VALUES.map((role) => (
                  <label
                    key={role}
                    className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-ink-200 px-3 py-2 transition-colors hover:bg-ink-50"
                  >
                    <Checkbox
                      name="roles"
                      value={role}
                      checked={selectedRoles.includes(role)}
                      onCheckedChange={(checked) => toggleRole(role, checked === true)}
                    />
                    <span className="text-[13.5px] text-ink-800">{ROLE_LABELS[role]}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <Field
              label="Linked sales representative"
              htmlFor="salesRepId"
              help={
                needsRepLink
                  ? 'Required for a sales representative. Their data is scoped to this record; without it they will see nothing at all.'
                  : 'Optional. Only needed when the account should be scoped to one representative.'
              }
              error={needsRepLink && !salesRepId ? 'Choose the representative this account belongs to.' : null}
            >
              <Select value={salesRepId} onValueChange={setSalesRepId}>
                <SelectTrigger aria-label="Linked sales representative">
                  <SelectValue placeholder="Not linked" />
                </SelectTrigger>
                <SelectContent>
                  {salesReps.length === 0 ? (
                    <SelectItem value="__none__" disabled>
                      No representatives have been imported yet
                    </SelectItem>
                  ) : (
                    salesReps.map((rep) => (
                      <SelectItem key={rep.id} value={rep.id}>
                        {rep.name}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
              <input type="hidden" name="salesRepId" value={salesRepId} />
            </Field>

            {divisions.length > 0 ? (
              <fieldset>
                <legend className="mb-1.5 block text-[13px] font-medium text-ink-800">
                  Restrict to divisions
                </legend>
                <p className="mb-2 text-[12.5px] text-ink-500">
                  Leave every box unticked to give access to all divisions.
                </p>
                <div className="space-y-1.5">
                  {divisions.map((division) => (
                    <label
                      key={division.id}
                      className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-ink-200 px-3 py-2 transition-colors hover:bg-ink-50"
                    >
                      <Checkbox name="divisionIds" value={division.id} />
                      <span className="text-[13.5px] text-ink-800">{division.name}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            ) : null}
          </DialogBody>

          <DialogFooter>
            <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(false)}>
              {result?.ok ? 'Close' : 'Cancel'}
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="sm"
              loading={busy}
              disabled={selectedRoles.length === 0 || (needsRepLink && !salesRepId)}
            >
              Create account
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
