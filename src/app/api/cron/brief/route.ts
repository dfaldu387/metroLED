import { NextResponse } from 'next/server'
import { authorizeCron } from '@/lib/cron-auth'
import { sendDailyBrief, briefJobKey, todaysBriefDate } from '@/lib/brief/send'
import { loadSettings } from '@/lib/data/dataset'
import { isBusinessDay } from '@/lib/dates'

export const maxDuration = 120

/**
 * Scheduled daily brief.
 *
 * Call once each business morning at the configured time:
 *
 *   curl -X POST https://<host>/api/cron/brief \
 *        -H "Authorization: Bearer $CRON_SECRET"
 *
 * Duplicate protection: the brief is keyed on its business date, and a
 * recipient who already received it is skipped. Calling this twice in one
 * morning sends nothing the second time.
 */
export async function POST(request: Request) {
  const denied = authorizeCron(request)
  if (denied) return denied

  const settings = await loadSettings()
  const now = new Date()
  const url = new URL(request.url)
  const force = url.searchParams.get('force') === 'true'

  if (!settings.briefEnabled && !force) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: 'Automatic sending of the daily brief is turned off in Settings.',
    })
  }

  // Do not send on a weekend: the brief reports on business days only.
  if (!isBusinessDay(now) && !force) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: 'Today is not a business day, so no brief was sent.',
    })
  }

  const briefDate = todaysBriefDate(now, settings.timezone)

  try {
    const result = await sendDailyBrief({ briefDate, now })
    return NextResponse.json(
      {
        ok: result.failed === 0,
        idempotencyKey: briefJobKey(briefDate),
        briefDate: result.briefDate,
        attempted: result.attempted,
        sent: result.sent,
        skipped: result.skipped,
        failed: result.failed,
        simulated: result.simulated,
        outcomes: result.outcomes,
      },
      { status: result.failed === 0 ? 200 : 207 },
    )
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: 'BRIEF_FAILED',
        message: error instanceof Error ? error.message : 'The daily brief could not be sent.',
      },
      { status: 500 },
    )
  }
}
