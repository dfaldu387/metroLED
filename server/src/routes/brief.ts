import { Router } from 'express'
import { z } from 'zod'
import { PERMISSIONS } from '@shared/permissions'
import { parseIsoDate } from '@shared/dates'
import { currentUser, requireAuth } from '../lib/auth/guards'
import { sendDailyBrief } from '../lib/brief/send'
import { AUDIT_ACTIONS, recordAudit } from '../lib/auth/audit'
import { handler } from '../lib/http/errors'

export const briefRouter = Router()

/**
 * Manually send (or re-send) the daily brief: POST /api/brief/send
 *
 * Restricted to SETTINGS_MANAGE because it puts email in executives' inboxes.
 * Recipients who already received this brief are skipped by the delivery
 * records, so a second press cannot send a duplicate.
 */
const bodySchema = z.object({ briefDate: z.string().optional() })

briefRouter.post(
  '/send',
  requireAuth(PERMISSIONS.SETTINGS_MANAGE),
  handler(async (req, res) => {
    const user = currentUser(res)

    if (user.isDemo) {
      res.status(403).json({
        error: 'DEMO_SESSION',
        message: 'A demo session cannot send email. Sign in with a real account to send the brief.',
      })
      return undefined
    }

    let briefDate: Date | undefined
    // An empty body is treated as `{}`, as the old `request.json().catch(() => ({}))` did.
    const body = bodySchema.safeParse(req.body ?? {})
    if (!body.success) {
      res.status(400).json({ error: 'INVALID_REQUEST', message: 'The request body could not be read.' })
      return undefined
    }
    if (body.data.briefDate) {
      const parsed = parseIsoDate(body.data.briefDate)
      if (!parsed) {
        res.status(400).json({ error: 'INVALID_REQUEST', message: 'The brief date must be in YYYY-MM-DD format.' })
        return undefined
      }
      briefDate = parsed
    }

    try {
      const result = await sendDailyBrief({ briefDate })

      await recordAudit({
        action: AUDIT_ACTIONS.BRIEF_SENT,
        summary: `${user.name} sent the daily brief for ${result.briefDate}: ${result.sent} sent, ${result.failed} failed, ${result.skipped} skipped.`,
        actor: user,
        entityType: 'DailyBrief',
        entityId: result.briefId,
        metadata: { sent: result.sent, failed: result.failed, skipped: result.skipped },
      })

      return {
        ok: true,
        briefDate: result.briefDate,
        sent: result.sent,
        failed: result.failed,
        skipped: result.skipped,
        simulated: result.simulated,
        outcomes: result.outcomes,
      }
    } catch (error) {
      res.status(500).json({
        error: 'SEND_FAILED',
        message: error instanceof Error ? error.message : 'The brief could not be sent.',
      })
      return undefined
    }
  }),
)
