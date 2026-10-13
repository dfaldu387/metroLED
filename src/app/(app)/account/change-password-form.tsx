'use client'

import * as React from 'react'
import { KeyRound } from 'lucide-react'
import { checkPasswordPolicy } from '@/lib/auth/password'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert } from '@/components/ui/feedback'
import { Field, Input } from '@/components/ui/form'
import { changeOwnPassword, type ActionResult } from '../users/actions'

/**
 * Change your own password.
 *
 * The policy is shown live as the user types, so they are never told after
 * submitting that a password they already chose is unacceptable.
 */
export function ChangePasswordForm({ mustChange }: { mustChange: boolean }) {
  const [busy, setBusy] = React.useState(false)
  const [result, setResult] = React.useState<ActionResult | null>(null)
  const [newPassword, setNewPassword] = React.useState('')
  const [confirmPassword, setConfirmPassword] = React.useState('')

  const policy = checkPasswordPolicy(newPassword)
  const touched = newPassword.length > 0
  const mismatch = confirmPassword.length > 0 && newPassword !== confirmPassword

  return (
    <Card id="change-password">
      <CardHeader>
        <div>
          <CardTitle>Change your password</CardTitle>
          <CardDescription>
            Changing your password signs you out of every other session.
          </CardDescription>
        </div>
      </CardHeader>

      <form
        action={async (formData) => {
          setBusy(true)
          setResult(null)
          try {
            const outcome = await changeOwnPassword(formData)
            setResult(outcome)
            if (outcome.ok) {
              setNewPassword('')
              setConfirmPassword('')
            }
          } catch {
            setResult({ ok: false, message: 'Something went wrong. Please try again.' })
          } finally {
            setBusy(false)
          }
        }}
      >
        <CardContent className="space-y-4">
          {mustChange ? (
            <Alert tone="warning" title="You must change your password">
              This account is using a one-time password issued by an administrator. Choose your own before
              continuing.
            </Alert>
          ) : null}

          {result ? (
            <Alert tone={result.ok ? 'positive' : 'negative'} title={result.ok ? 'Password changed' : 'Not changed'}>
              {result.message}
            </Alert>
          ) : null}

          <Field label="Current password" htmlFor="currentPassword" required>
            <Input
              id="currentPassword"
              name="currentPassword"
              type="password"
              autoComplete="current-password"
              required
            />
          </Field>

          <Field
            label="New password"
            htmlFor="newPassword"
            required
            help={
              touched ? undefined : 'At least 12 characters, with an upper-case letter, a lower-case letter and a number.'
            }
            error={touched && !policy.ok ? policy.problems.join(' ') : null}
          >
            <Input
              id="newPassword"
              name="newPassword"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              aria-invalid={touched && !policy.ok}
              required
            />
          </Field>

          <Field
            label="Confirm new password"
            htmlFor="confirmPassword"
            required
            error={mismatch ? 'The two passwords do not match.' : null}
          >
            <Input
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              aria-invalid={mismatch}
              required
            />
          </Field>
        </CardContent>

        <CardFooter className="justify-end">
          <Button
            type="submit"
            variant="primary"
            size="md"
            loading={busy}
            disabled={!policy.ok || mismatch || confirmPassword.length === 0}
          >
            <KeyRound aria-hidden />
            Change password
          </Button>
        </CardFooter>
      </form>
    </Card>
  )
}
