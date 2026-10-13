
import * as React from 'react'
import { Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert } from '@/components/ui/feedback'
import { Field, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/form'
import { Badge } from '@/components/ui/badge'
import { useSettingsActions, type SettingsResult } from './actions'

/**
 * Company settings.
 *
 * Each threshold explains what it actually changes, because these values
 * silently alter what the dashboards flag as a problem.
 */
export function CompanyForm({
  settings,
  timezones,
  canManage,
  environment,
}: {
  settings: {
    displayName: string
    timezone: string
    currency: string
    staleDataHours: number
    staleQuoteDays: number
    largeQuoteAmount: number
  }
  timezones: string[]
  canManage: boolean
  environment: string
}) {
  const { updateCompanySettings } = useSettingsActions()
  const [busy, setBusy] = React.useState(false)
  const [result, setResult] = React.useState<SettingsResult | null>(null)
  const [timezone, setTimezone] = React.useState(settings.timezone)

  return (
    <form
      action={async (formData) => {
        setBusy(true)
        setResult(null)
        try {
          setResult(await updateCompanySettings(formData))
        } catch {
          setResult({ ok: false, message: 'Something went wrong saving these settings.' })
        } finally {
          setBusy(false)
        }
      }}
    >
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Company information</CardTitle>
            <CardDescription>
              Used across the application, in the daily brief email, and to decide what counts as a business day.
            </CardDescription>
          </div>
          <Badge variant="neutral" size="sm">
            {environment}
          </Badge>
        </CardHeader>

        <CardContent className="space-y-5">
          {result ? (
            <Alert tone={result.ok ? 'positive' : 'negative'} title={result.ok ? 'Saved' : 'Not saved'}>
              {result.message}
            </Alert>
          ) : null}

          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Company name" htmlFor="displayName" help="Shown in the application and in email.">
              <Input
                id="displayName"
                name="displayName"
                defaultValue={settings.displayName}
                disabled={!canManage}
                required
              />
            </Field>

            <Field
              label="Reporting timezone"
              htmlFor="timezone"
              help="Every reporting period and the daily brief date are calculated in this timezone."
            >
              <Select value={timezone} onValueChange={setTimezone} disabled={!canManage}>
                <SelectTrigger aria-label="Reporting timezone">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {timezones.map((zone) => (
                    <SelectItem key={zone} value={zone}>
                      {zone}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <input type="hidden" name="timezone" value={timezone} />
            </Field>

            <Field
              label="Base currency"
              htmlFor="currency"
              help="Three-letter code. Amounts recorded in another currency are converted using the rate on the source document."
            >
              <Input
                id="currency"
                name="currency"
                defaultValue={settings.currency}
                maxLength={3}
                disabled={!canManage}
                required
                className="uppercase"
              />
            </Field>
          </div>
        </CardContent>

        <CardContent className="border-t border-ink-200">
          <h3 className="mb-1 text-[14px] font-semibold text-ink-900">Thresholds</h3>
          <p className="mb-4 text-[13px] leading-5 text-ink-600">
            These decide what the Overview page flags as needing attention, and what the daily brief reports.
          </p>

          <div className="grid gap-5 sm:grid-cols-3">
            <Field
              label="Data is stale after"
              htmlFor="staleDataHours"
              help="Hours without a successful sync before a source is flagged as stale."
            >
              <div className="flex items-center gap-2">
                <Input
                  id="staleDataHours"
                  name="staleDataHours"
                  type="number"
                  min={1}
                  max={168}
                  defaultValue={settings.staleDataHours}
                  disabled={!canManage}
                  required
                />
                <span className="shrink-0 text-[13px] text-ink-600">hours</span>
              </div>
            </Field>

            <Field
              label="A quote is stale after"
              htmlFor="staleQuoteDays"
              help="Days without activity before an open quote is flagged as having gone quiet."
            >
              <div className="flex items-center gap-2">
                <Input
                  id="staleQuoteDays"
                  name="staleQuoteDays"
                  type="number"
                  min={1}
                  max={365}
                  defaultValue={settings.staleQuoteDays}
                  disabled={!canManage}
                  required
                />
                <span className="shrink-0 text-[13px] text-ink-600">days</span>
              </div>
            </Field>

            <Field
              label="A quote is large at"
              htmlFor="largeQuoteAmount"
              help="Quotes at or above this value are called out separately when they go quiet."
            >
              <div className="flex items-center gap-2">
                <span className="shrink-0 text-[13px] text-ink-600">{settings.currency}</span>
                <Input
                  id="largeQuoteAmount"
                  name="largeQuoteAmount"
                  type="number"
                  min={0}
                  step={100}
                  defaultValue={settings.largeQuoteAmount}
                  disabled={!canManage}
                  required
                />
              </div>
            </Field>
          </div>
        </CardContent>

        {canManage ? (
          <CardFooter className="justify-end">
            <Button type="submit" variant="primary" size="md" loading={busy}>
              <Save aria-hidden />
              Save company settings
            </Button>
          </CardFooter>
        ) : null}
      </Card>
    </form>
  )
}
