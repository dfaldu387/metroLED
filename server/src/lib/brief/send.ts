import { db, sql, databaseReachable } from '../db'
import type { BriefDeliveryRow, BriefRecipientRow, DailyBriefRow } from '../db-rows'
import { sendEmail } from '../email/provider'
import { renderBrief } from './render'
import { generateAndStoreBrief, type BriefPayload } from './generate'
import { previousBusinessDate, toIsoDate } from '@shared/dates'

/**
 * Daily brief delivery (section 12).
 *
 * Duplicate prevention is the central concern. Three mechanisms stack:
 *   1. `DailyBrief.briefDate` is unique, so one brief exists per business day.
 *   2. `BriefDelivery(dailyBriefId, recipient)` is unique, so a recipient can
 *      only have one delivery record per brief.
 *   3. A delivery already in SENT or DELIVERED is skipped, so a retried job
 *      re-sends only to the recipients that genuinely failed.
 *
 * A send is only recorded as successful after the provider accepts it.
 */

export interface DeliveryOutcome {
  recipient: string
  status: 'SENT' | 'FAILED' | 'SKIPPED'
  reason: string | null
  providerMessageId: string | null
}

export interface SendBriefResult {
  briefId: string
  briefDate: string
  attempted: number
  sent: number
  failed: number
  skipped: number
  outcomes: DeliveryOutcome[]
  simulated: boolean
}

export async function sendDailyBrief(options: { briefDate?: Date; now?: Date; force?: boolean } = {}): Promise<SendBriefResult> {
  const now = options.now ?? new Date()

  if (!(await databaseReachable())) {
    throw new Error('The database is unreachable, so the daily brief cannot be sent or recorded.')
  }

  const { briefId, payload } = await generateAndStoreBrief({ briefDate: options.briefDate, now })
  const briefDate = new Date(`${payload.briefDate}T00:00:00.000Z`)
  const { subject, html, text } = renderBrief(payload)

  const recipients = await db.many<BriefRecipientRow>(
    sql`SELECT * FROM "BriefRecipient" WHERE "isActive" = true ORDER BY "email" ASC`,
  )

  if (recipients.length === 0) {
    await db.exec(sql`
      UPDATE "DailyBrief"
      SET "status" = ${'FAILED'},
          "errorMessage" = ${'No active recipients are configured, so the brief was generated but not sent. Add recipients in Settings.'}
      WHERE "id" = ${briefId}`)
    return {
      briefId,
      briefDate: toIsoDate(briefDate),
      attempted: 0,
      sent: 0,
      failed: 0,
      skipped: 0,
      outcomes: [],
      simulated: false,
    }
  }

  const outcomes: DeliveryOutcome[] = []
  let simulated = false

  for (const recipient of recipients) {
    const existing = await db.maybeOne<BriefDeliveryRow>(sql`
      SELECT * FROM "BriefDelivery" WHERE "dailyBriefId" = ${briefId} AND "recipient" = ${recipient.email}`)

    // Already delivered: never send twice, even if the job is retried.
    if (existing && (existing.status === 'SENT' || existing.status === 'DELIVERED') && !options.force) {
      outcomes.push({
        recipient: recipient.email,
        status: 'SKIPPED',
        reason: `Already sent at ${existing.sentAt?.toISOString() ?? 'an earlier time'}.`,
        providerMessageId: existing.providerMessageId,
      })
      continue
    }

    const delivery = await db.one<{ id: string }>(sql`
      INSERT INTO "BriefDelivery" ("dailyBriefId", "recipient", "status", "attempts")
      VALUES (${briefId}, ${recipient.email}, ${'QUEUED'}, 1)
      ON CONFLICT ("dailyBriefId", "recipient")
      DO UPDATE SET "status" = ${'QUEUED'}, "attempts" = "BriefDelivery"."attempts" + 1
      RETURNING "id"`)

    const result = await sendEmail({ to: recipient.email, subject, html, text })
    if (result.simulated) simulated = true

    if (result.ok) {
      await db.exec(sql`
        UPDATE "BriefDelivery"
        SET "status" = ${'SENT'}, "sentAt" = ${new Date()}, "providerMessageId" = ${result.providerMessageId},
            "errorMessage" = NULL, "failedAt" = NULL
        WHERE "id" = ${delivery.id}`)
      outcomes.push({
        recipient: recipient.email,
        status: 'SENT',
        reason: result.simulated ? 'Logged to the server console; EMAIL_PROVIDER is "console".' : null,
        providerMessageId: result.providerMessageId,
      })
    } else {
      await db.exec(sql`
        UPDATE "BriefDelivery"
        SET "status" = ${'FAILED'}, "failedAt" = ${new Date()}, "errorMessage" = ${result.error}
        WHERE "id" = ${delivery.id}`)
      outcomes.push({
        recipient: recipient.email,
        status: 'FAILED',
        reason: result.error,
        providerMessageId: null,
      })
      console.error(`[brief] delivery to ${recipient.email} failed: ${result.error}`)
    }
  }

  const sent = outcomes.filter((o) => o.status === 'SENT').length
  const failed = outcomes.filter((o) => o.status === 'FAILED').length
  const skipped = outcomes.filter((o) => o.status === 'SKIPPED').length

  await db.exec(sql`
    UPDATE "DailyBrief"
    SET "status" = ${failed === 0 ? 'SENT' : sent > 0 ? 'PARTIALLY_SENT' : 'FAILED'},
        "errorMessage" = ${
          failed > 0
            ? `${failed} of ${outcomes.length} deliveries failed. See the delivery list for detail.`
            : null
        }
    WHERE "id" = ${briefId}`)

  return {
    briefId,
    briefDate: toIsoDate(briefDate),
    attempted: outcomes.length,
    sent,
    failed,
    skipped,
    outcomes,
    simulated,
  }
}

/** The brief for a date, or the most recent one. Used by the Daily Brief page. */
export async function loadStoredBrief(briefDate?: Date): Promise<{
  id: string
  payload: BriefPayload
  status: string
  generatedAt: Date | null
  deliveries: {
    recipient: string
    status: string
    sentAt: Date | null
    errorMessage: string | null
    attempts: number
  }[]
} | null> {
  if (!(await databaseReachable())) return null

  const row = briefDate
    ? await db.maybeOne<DailyBriefRow>(sql`SELECT * FROM "DailyBrief" WHERE "briefDate" = ${briefDate}`)
    : await db.maybeOne<DailyBriefRow>(sql`SELECT * FROM "DailyBrief" ORDER BY "briefDate" DESC LIMIT 1`)

  if (!row?.payload) return null

  const deliveries = await db.many<BriefDeliveryRow>(
    sql`SELECT * FROM "BriefDelivery" WHERE "dailyBriefId" = ${row.id} ORDER BY "recipient" ASC`,
  )

  return {
    id: row.id,
    payload: row.payload as unknown as BriefPayload,
    status: row.status,
    generatedAt: row.generatedAt,
    deliveries: deliveries.map((d) => ({
      recipient: d.recipient,
      status: d.status,
      sentAt: d.sentAt,
      errorMessage: d.errorMessage,
      attempts: d.attempts,
    })),
  }
}

/** The idempotency key that guarantees one send job per business date. */
export function briefJobKey(date: Date): string {
  return `brief:${toIsoDate(date)}`
}

export function todaysBriefDate(now: Date = new Date(), timeZone?: string): Date {
  return previousBusinessDate(now, timeZone)
}
