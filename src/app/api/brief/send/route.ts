import { NextResponse } from 'next/server'
import { z } from 'zod'
import { PERMISSIONS } from '@/lib/auth/permissions'
import { requireApiPermission } from '@/lib/auth/guards'
import { sendDailyBrief } from '@/lib/brief/send'
import { AUDIT_ACTIONS, recordAudit } from '@/lib/auth/audit'
import { parseIsoDate } from '@/lib/dates'

export const maxDuration = 60

/**
 * Manually send (or re-send) the daily brief.
 *
 * Restricted to SETTINGS_MANAGE because it puts email in executives' inboxes.
 * Recipients who already received this brief are skipped by the delivery
 * records, so a second press cannot send a duplicate.
 */
const bodySchema = z.object({ briefDate: z.string().optional() })

export async function POST(request: Request) {
  const auth = await requireApiPermission(PERMISSIONS.SETTINGS_MANAGE)
  if (!auth.ok) return auth.response

  if (auth.user.isDemo) {
    return NextResponse.json(
      {
        error: 'DEMO_SESSION',
        message: 'A demo session cannot send email. Sign in with a real account to send the brief.',
      },
      { status: 403 },
    )
  }

  let briefDate: Date | undefined
  try {
    const body = bodySchema.parse(await request.json().catch(() => ({})))
    if (body.briefDate) {
      const parsed = parseIsoDate(body.briefDate)
      if (!parsed) {
        return NextResponse.json(
          { error: 'INVALID_REQUEST', message: 'The brief date must be in YYYY-MM-DD format.' },
          { status: 400 },
        )
      }
      briefDate = parsed
    }
  } catch {
    return NextResponse.json({ error: 'INVALID_REQUEST', message: 'The request body could not be read.' }, { status: 400 })
  }

  try {
    const result = await sendDailyBrief({ briefDate })

    await recordAudit({
      action: AUDIT_ACTIONS.BRIEF_SENT,
      summary: `${auth.user.name} sent the daily brief for ${result.briefDate}: ${result.sent} sent, ${result.failed} failed, ${result.skipped} skipped.`,
      actor: auth.user,
      entityType: 'DailyBrief',
      entityId: result.briefId,
      metadata: { sent: result.sent, failed: result.failed, skipped: result.skipped },
    })

    return NextResponse.json({
      ok: true,
      briefDate: result.briefDate,
      sent: result.sent,
      failed: result.failed,
      skipped: result.skipped,
      simulated: result.simulated,
      outcomes: result.outcomes,
    })
  } catch (error) {
    return NextResponse.json(
      {
        error: 'SEND_FAILED',
        message: error instanceof Error ? error.message : 'The brief could not be sent.',
      },
      { status: 500 },
    )
  }
}
