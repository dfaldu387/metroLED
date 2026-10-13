'use client'

import * as React from 'react'
import { CheckCircle2, Mail, Plus, Save, Trash2 } from 'lucide-react'
import { formatDate, formatDateTime } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Alert, EmptyState } from '@/components/ui/feedback'
import { ConfirmDialog } from '@/components/ui/dialog'
import { Field, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/form'
import { Switch } from '@/components/ui/misc'
import { TBody, TD, TH, THead, TR, Table, TableScroll } from '@/components/ui/table'
import { addBriefRecipient, removeBriefRecipient, updateBriefSchedule, type SettingsResult } from '../actions'

/**
 * Daily brief schedule and recipients.
 *
 * The page is explicit that enabling the schedule here is only half the job:
 * an external scheduler has to call the cron endpoint. Without that, turning
 * the switch on would silently do nothing.
 */
export function BriefSettings({
  settings,
  recipients,
  recentBriefs,
  canManage,
  providerLabel,
  isConsoleProvider,
  appUrl,
}: {
  settings: { briefEnabled: boolean; briefSendHour: number; briefSendMinute: number; timezone: string }
  recipients: { id: string; email: string; name: string | null }[]
  recentBriefs: {
    id: string
    briefDate: string
    status: string
    generatedAt: string | null
    sent: number
    failed: number
    total: number
  }[]
  canManage: boolean
  providerLabel: string
  isConsoleProvider: boolean
  appUrl: string
}) {
  const [result, setResult] = React.useState<SettingsResult | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [enabled, setEnabled] = React.useState(settings.briefEnabled)
  const [hour, setHour] = React.useState(String(settings.briefSendHour))
  const [minute, setMinute] = React.useState(String(settings.briefSendMinute))
  const [confirmRemove, setConfirmRemove] = React.useState<{ id: string; email: string } | null>(null)

  const run = async (action: (formData: FormData) => Promise<SettingsResult>, formData: FormData) => {
    setBusy(true)
    setResult(null)
    try {
      setResult(await action(formData))
    } catch {
      setResult({ ok: false, message: 'Something went wrong. Please try again.' })
    } finally {
      setBusy(false)
      setConfirmRemove(null)
    }
  }

  const consecutiveDelivered = React.useMemo(() => {
    let streak = 0
    for (const brief of recentBriefs) {
      if (brief.sent > 0 && brief.failed === 0) streak++
      else break
    }
    return streak
  }, [recentBriefs])

  return (
    <div className="space-y-4">
      {result ? (
        <Alert tone={result.ok ? 'positive' : 'negative'} title={result.ok ? 'Saved' : 'Not saved'}>
          {result.message}
        </Alert>
      ) : null}

      {/* --- Schedule ------------------------------------------------------ */}
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Schedule</CardTitle>
            <CardDescription>
              The brief reports on the previous business day. Monday&apos;s brief covers Friday.
            </CardDescription>
          </div>
          <Badge variant={enabled ? 'positive' : 'neutral'} size="sm">
            {enabled ? 'Automatic sending on' : 'Automatic sending off'}
          </Badge>
        </CardHeader>

        <form
          action={(formData) => {
            formData.set('briefEnabled', String(enabled))
            formData.set('briefSendHour', hour)
            formData.set('briefSendMinute', minute)
            void run(updateBriefSchedule, formData)
          }}
        >
          <CardContent className="space-y-4">
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-ink-200 px-3.5 py-3">
              <Switch
                checked={enabled}
                onCheckedChange={setEnabled}
                disabled={!canManage}
                aria-label="Send the daily brief automatically"
                className="mt-0.5"
              />
              <span>
                <span className="block text-[13.5px] font-medium text-ink-900">
                  Send the daily brief automatically
                </span>
                <span className="block text-[12.5px] leading-5 text-ink-600">
                  When this is off, the brief can still be generated and sent by hand from the Daily Brief page.
                </span>
              </span>
            </label>

            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Send at (hour)" htmlFor="briefSendHour">
                <Select value={hour} onValueChange={setHour} disabled={!canManage}>
                  <SelectTrigger aria-label="Send hour">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 24 }).map((_, index) => (
                      <SelectItem key={index} value={String(index)}>
                        {String(index).padStart(2, '0')}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <Field label="Minute" htmlFor="briefSendMinute">
                <Select value={minute} onValueChange={setMinute} disabled={!canManage}>
                  <SelectTrigger aria-label="Send minute">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[0, 15, 30, 45].map((value) => (
                      <SelectItem key={value} value={String(value)}>
                        {String(value).padStart(2, '0')}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <Field label="Timezone" htmlFor="timezone" help="Set on the Company settings page.">
                <Input id="timezone" value={settings.timezone} disabled readOnly />
              </Field>
            </div>

            <Alert tone="info" title="The schedule needs an external trigger">
              <p>
                Saving a time here records your intent. The brief is actually sent when a scheduler calls this
                endpoint at that time:
              </p>
              <p className="mt-2 break-all rounded bg-white px-2.5 py-2 font-mono text-[11.5px] text-ink-900">
                POST {appUrl}/api/cron/brief
                <br />
                Authorization: Bearer $CRON_SECRET
              </p>
              <p className="mt-2">
                Calling it twice in one morning is safe: the brief is keyed on its business date and a recipient who
                already received it is skipped.
              </p>
            </Alert>
          </CardContent>

          {canManage ? (
            <CardFooter className="justify-end">
              <Button type="submit" variant="primary" size="md" loading={busy}>
                <Save aria-hidden />
                Save schedule
              </Button>
            </CardFooter>
          ) : null}
        </form>
      </Card>

      {/* --- Recipients ----------------------------------------------------- */}
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Recipients</CardTitle>
            <CardDescription>
              Internal recipients only. This system never sends email to a customer.
            </CardDescription>
          </div>
          <Badge variant="neutral" size="sm">
            Sent via {providerLabel}
          </Badge>
        </CardHeader>

        {recipients.length === 0 ? (
          <EmptyState
            icon={Mail}
            title="No recipients configured"
            description="The brief will be generated but delivered to nobody. Add at least Ali before the acceptance run."
          />
        ) : (
          <TableScroll>
            <Table>
              <THead>
                <TR>
                  <TH>Email address</TH>
                  <TH>Name</TH>
                  {canManage ? (
                    <TH>
                      <span className="sr-only">Actions</span>
                    </TH>
                  ) : null}
                </TR>
              </THead>
              <TBody>
                {recipients.map((recipient) => (
                  <TR key={recipient.id} className="hover:bg-ink-50">
                    <TD className="font-medium text-ink-900">{recipient.email}</TD>
                    <TD className="text-ink-700">
                      {recipient.name ?? <span className="italic text-ink-500">Not recorded</span>}
                    </TD>
                    {canManage ? (
                      <TD className="text-right">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Remove ${recipient.email}`}
                          onClick={() => setConfirmRemove({ id: recipient.id, email: recipient.email })}
                        >
                          <Trash2 aria-hidden />
                        </Button>
                      </TD>
                    ) : null}
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableScroll>
        )}

        {canManage ? (
          <CardContent className="border-t border-ink-200">
            <form
              action={(formData) => void run(addBriefRecipient, formData)}
              className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
            >
              <Field label="Email address" htmlFor="recipientEmail">
                <Input id="recipientEmail" name="email" type="email" placeholder="ali@metroled.com" required />
              </Field>
              <Field label="Name (optional)" htmlFor="recipientName">
                <Input id="recipientName" name="name" placeholder="Ali Jooma" />
              </Field>
              <Button type="submit" variant="secondary" size="md" loading={busy}>
                <Plus aria-hidden />
                Add recipient
              </Button>
            </form>
          </CardContent>
        ) : null}
      </Card>

      {/* --- Delivery history ----------------------------------------------- */}
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Recent briefs</CardTitle>
            <CardDescription>
              Acceptance requires successful delivery to Ali on five consecutive business days.
            </CardDescription>
          </div>
          {consecutiveDelivered > 0 ? (
            <Badge variant={consecutiveDelivered >= 5 ? 'positive' : 'warning'} size="sm">
              {consecutiveDelivered >= 5 ? (
                <CheckCircle2 className="size-3" aria-hidden />
              ) : null}
              {consecutiveDelivered} consecutive {consecutiveDelivered === 1 ? 'day' : 'days'} delivered
            </Badge>
          ) : null}
        </CardHeader>

        {recentBriefs.length === 0 ? (
          <EmptyState
            title="No brief has been generated yet"
            description="Once the first brief is generated, its delivery record appears here and builds the acceptance evidence."
          />
        ) : (
          <>
            <TableScroll>
              <Table>
                <THead>
                  <TR>
                    <TH>Reporting on</TH>
                    <TH>Status</TH>
                    <TH>Generated</TH>
                    <TH numeric>Delivered</TH>
                    <TH numeric>Failed</TH>
                  </TR>
                </THead>
                <TBody>
                  {recentBriefs.map((brief) => (
                    <TR key={brief.id} className="hover:bg-ink-50">
                      <TD className="whitespace-nowrap font-medium text-ink-900">{formatDate(brief.briefDate)}</TD>
                      <TD>
                        <Badge
                          variant={
                            brief.status === 'SENT'
                              ? 'positive'
                              : brief.status === 'PARTIALLY_SENT'
                                ? 'warning'
                                : brief.status === 'FAILED'
                                  ? 'negative'
                                  : 'neutral'
                          }
                          size="sm"
                        >
                          {brief.status.replace(/_/g, ' ').toLowerCase()}
                        </Badge>
                      </TD>
                      <TD className="whitespace-nowrap text-ink-700">
                        {brief.generatedAt ? formatDateTime(brief.generatedAt, settings.timezone) : '—'}
                      </TD>
                      <TD numeric>
                        {brief.sent} of {brief.total}
                      </TD>
                      <TD numeric className={brief.failed > 0 ? 'font-semibold text-negative-700' : ''}>
                        {brief.failed}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableScroll>
            {isConsoleProvider ? (
              <CardFooter>
                <p className="text-[12px] leading-5 text-warning-800">
                  Emails are currently written to the server log rather than sent, because EMAIL_PROVIDER is set to
                  &ldquo;console&rdquo;. Deliveries recorded above did not reach a real inbox.
                </p>
              </CardFooter>
            ) : null}
          </>
        )}
      </Card>

      <ConfirmDialog
        open={confirmRemove !== null}
        onOpenChange={(open) => !open && setConfirmRemove(null)}
        title={`Stop sending the daily brief to ${confirmRemove?.email ?? ''}?`}
        description={
          <p>
            They will not receive tomorrow&apos;s brief. Past delivery records are kept, so the acceptance evidence
            stays intact.
          </p>
        }
        confirmLabel="Remove recipient"
        tone="danger"
        loading={busy}
        onConfirm={() => {
          if (!confirmRemove) return
          const formData = new FormData()
          formData.set('recipientId', confirmRemove.id)
          void run(removeBriefRecipient, formData)
        }}
      />
    </div>
  )
}
