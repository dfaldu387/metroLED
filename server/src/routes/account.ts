import { Router } from 'express'
import { z } from 'zod'
import type { ActionResult } from '@shared/api/session'
import { db, sql, databaseReachable } from '../lib/db'
import { getSession } from '../lib/auth/session'
import { checkPasswordPolicy, hashPassword, verifyPassword } from '../lib/auth/password'
import { AUDIT_ACTIONS, recordAudit } from '../lib/auth/audit'
import { handler } from '../lib/http/errors'

/**
 * The signed-in user's own account (former `changeOwnPassword` server action
 * in src/app/(app)/users/actions.ts).
 *
 * Expected refusals come back as HTTP 200 with `ok: false`, exactly as the
 * action returned them, so the form can show the message inline.
 */
export const accountRouter = Router()

const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password.'),
    newPassword: z.string().min(1, 'Enter a new password.'),
    confirmPassword: z.string().min(1, 'Confirm the new password.'),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'The two new passwords do not match.',
    path: ['confirmPassword'],
  })

/** Change your own password. Available to every signed-in user. */
accountRouter.post(
  '/password',
  handler(async (req): Promise<ActionResult> => {
    const user = await getSession()
    if (!user) return { ok: false, message: 'Your session has expired. Sign in and try again.' }
    if (user.isDemo) return { ok: false, message: 'A demo session has no password to change.' }
    if (!(await databaseReachable())) {
      return { ok: false, message: 'The database is unreachable, so the password cannot be changed.' }
    }

    // FormData.get() returned null for a missing field; mirror that so a
    // missing field fails the schema the same way.
    const body = (req.body ?? {}) as Record<string, unknown>
    const parsed = changePasswordSchema.safeParse({
      currentPassword: body.currentPassword ?? null,
      newPassword: body.newPassword ?? null,
      confirmPassword: body.confirmPassword ?? null,
    })
    if (!parsed.success) {
      return { ok: false, message: parsed.error.issues[0]?.message ?? 'Check the details and try again.' }
    }

    const policy = checkPasswordPolicy(parsed.data.newPassword)
    if (!policy.ok) {
      return { ok: false, message: `That password is not strong enough. ${policy.problems.join(' ')}` }
    }

    const record = await db.maybeOne<{ passwordHash: string }>(
      sql`SELECT "passwordHash" FROM "User" WHERE "id" = ${user.id}`,
    )
    if (!record) return { ok: false, message: 'Your account no longer exists.' }

    if (!(await verifyPassword(parsed.data.currentPassword, record.passwordHash))) {
      return { ok: false, message: 'Your current password is not correct.' }
    }

    await db.exec(sql`
      UPDATE "User"
      SET "passwordHash" = ${await hashPassword(parsed.data.newPassword)}, "mustChangePassword" = false
      WHERE "id" = ${user.id}`)

    await recordAudit({
      action: AUDIT_ACTIONS.PASSWORD_CHANGED,
      summary: `${user.name} changed their own password.`,
      actor: user,
      entityType: 'User',
      entityId: user.id,
    })

    return { ok: true, message: 'Your password has been changed.' }
  }),
)
