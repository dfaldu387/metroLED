import * as React from 'react'
import { ExternalLink, KeyRound, ShieldCheck } from 'lucide-react'
import { formatRelativeTime } from '@shared/dates'
import type { IntegrationsSettingsPageData } from '@shared/api/admin'
import { Link, useDocumentTitle, usePathname, useRouter, useSearchParams } from '@/lib/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge, StatusDot } from '@/components/ui/badge'
import { Alert } from '@/components/ui/feedback'
import { notify } from '@/lib/toast'
import { PageQuery } from '@/components/layout/page-error'
import { FormPageSkeleton } from '@/components/layout/page-skeleton'
import { ADMIN_KEYS, useAdminPage } from '@/pages/users/admin-client'
import { ConnectSourceActions, type ConnectableSource } from '@/pages/data-health/connect-source'

/**
 * Integration status and connection management (section 17).
 *
 * This page shows WHETHER a credential exists and whether it works. It never
 * shows the credential itself: no access token, API key or webhook secret is
 * rendered here or returned by the endpoint that feeds it.
 *
 * "Connect" is a plain link (full navigation) to the OAuth start endpoint on
 * the API, not a client route.
 */
export default function IntegrationsSettingsPage() {
  useDocumentTitle('Integrations')
  const query = useAdminPage<IntegrationsSettingsPageData>(
    ADMIN_KEYS.settingsIntegrations,
    '/api/settings/integrations/page',
  )

  return (
    <PageQuery query={query} skeleton={<FormPageSkeleton />}>
      {(data) => <IntegrationsView data={data} />}
    </PageQuery>
  )
}

function IntegrationsView({ data }: { data: IntegrationsSettingsPageData }) {
  const now = new Date()
  const params = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const oauthMessage = params.get('message')
  const oauthOk = Boolean(params.get('connected'))

  const onOutcome = React.useCallback((o: { tone: 'positive' | 'negative'; message: string }) => {
    if (o.tone === 'positive') notify.success('Connection updated', o.message)
    else notify.error('The connection could not be made', o.message)
  }, [])

  // The QuickBooks OAuth callback returns here with ?connected=&message=. Show
  // it once as a toast, then strip the params so a refresh does not repeat it.
  React.useEffect(() => {
    if (!oauthMessage) return
    if (oauthOk) notify.success('Connection updated', oauthMessage)
    else notify.error('The connection could not be made', oauthMessage)
    const rest = new URLSearchParams(params)
    rest.delete('message')
    rest.delete('connected')
    const qs = rest.toString()
    router.replace(`${pathname}${qs ? `?${qs}` : ''}`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oauthMessage, oauthOk])

  return (
    <div className="space-y-4">
      {!data.encryptionConfigured ? (
        <Alert tone="negative" title="Credentials cannot be stored on this deployment">
          <code className="font-mono text-[12px]">CREDENTIAL_ENCRYPTION_KEY</code> is missing or is not exactly 32
          bytes when base64-decoded. No integration can be connected until it is set.
        </Alert>
      ) : (
        <Alert tone="info" title="How credentials are handled">
          Keys and tokens are encrypted at rest and never shown again after you enter them.
        </Alert>
      )}

      {data.mondayEnabled ? (
        <Alert tone="warning" title="Monday.com is enabled">
          Monday.com is conditional in the Phase 1 scope. It is enabled on this deployment via{' '}
          <code className="font-mono text-[12px]">MONDAY_ENABLED</code>. Confirm with the client that it is in
          scope, and that the change went through the change log.
        </Alert>
      ) : null}

      {data.providers.map((definition) => {
        const row = definition.row
        const status = row?.status ?? 'NOT_CONFIGURED'
        const isOAuth = definition.connectUrl !== null
        const source: ConnectableSource = {
          provider: definition.provider as ConnectableSource['provider'],
          displayName: definition.name,
          credentialSource: row?.credentialStored ? 'stored' : !isOAuth && definition.envReady ? 'environment' : 'none',
          connectMethod: isOAuth ? 'oauth' : definition.provider === 'MONDAY' ? 'none' : 'form',
          oauthAppConfigured: isOAuth ? definition.envReady : true,
          oauthAppSource: isOAuth ? (definition.envReady ? 'environment' : 'none') : 'none',
          oauthEnvironment: null,
          oauthRedirectUri: null,
        }
        const tone =
          status === 'ERROR'
            ? 'negative'
            : status === 'DEGRADED'
              ? 'warning'
              : status === 'CONNECTED'
                ? 'positive'
                : 'neutral'

        return (
          <Card key={definition.provider}>
            <CardHeader>
              <div className="min-w-0">
                <CardTitle className="flex items-center gap-2">
                  <StatusDot tone={tone} />
                  {definition.name}
                </CardTitle>
                <CardDescription>{definition.what}</CardDescription>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <Badge variant={tone === 'positive' ? 'positive' : tone === 'negative' ? 'negative' : tone === 'warning' ? 'warning' : 'neutral'} size="sm">
                  {status === 'NOT_CONFIGURED' ? 'Not connected' : status === 'ERROR' ? 'Failing' : status}
                </Badge>
                {row?.isEnabled ? (
                  <Badge variant="brand" size="sm">
                    Syncing
                  </Badge>
                ) : null}
              </div>
            </CardHeader>

            <CardContent className="space-y-3.5">
              <div>
                <p className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-ink-500">
                  <KeyRound className="size-3.5" aria-hidden />
                  Authentication
                </p>
                <p className="mt-1 text-[13px] leading-5 text-ink-700">{definition.auth}</p>
              </div>

              <div>
                <p className="text-[12px] font-semibold uppercase tracking-wide text-ink-500">
                  Environment variables
                </p>
                <ul className="mt-1.5 flex flex-wrap gap-1.5">
                  {definition.envVars.map((name) => (
                    <li key={name}>
                      <code className="rounded bg-ink-100 px-1.5 py-0.5 font-mono text-[11.5px] text-ink-800">
                        {name}
                      </code>
                    </li>
                  ))}
                </ul>
                <p className="mt-1.5 text-[12.5px] text-ink-600">
                  {definition.envReady ? (
                    <span className="flex items-center gap-1.5 text-positive-700">
                      <ShieldCheck className="size-3.5" aria-hidden />
                      Present in this deployment&apos;s environment.
                    </span>
                  ) : (
                    <span className="text-warning-800">
                      Not fully present in this deployment&apos;s environment.
                    </span>
                  )}
                </p>
              </div>

              <div>
                <p className="text-[12px] font-semibold uppercase tracking-wide text-ink-500">Configuration</p>
                <p className="mt-1 break-words text-[12.5px] leading-5 text-ink-600">{definition.extra}</p>
              </div>

              {data.dbReady && row ? (
                <dl className="grid grid-cols-2 gap-3 border-t border-ink-200 pt-3 sm:grid-cols-4">
                  <div>
                    <dt className="text-[11.5px] text-ink-500">Credential stored</dt>
                    <dd className="text-[13px] font-medium text-ink-900">{row.credentialStored ? 'Yes' : 'No'}</dd>
                  </div>
                  <div>
                    <dt className="text-[11.5px] text-ink-500">Last success</dt>
                    <dd className="text-[13px] font-medium text-ink-900">
                      {formatRelativeTime(row.lastSuccessAt ? new Date(row.lastSuccessAt) : null, now)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[11.5px] text-ink-500">Sync interval</dt>
                    <dd className="text-[13px] font-medium text-ink-900">{row.syncIntervalMin} min</dd>
                  </div>
                  <div>
                    <dt className="text-[11.5px] text-ink-500">History window</dt>
                    <dd className="text-[13px] font-medium text-ink-900">{row.historyMonths} months</dd>
                  </div>
                </dl>
              ) : null}

              {row?.lastErrorMessage ? (
                <Alert tone="negative" title="Last error">
                  {row.lastErrorMessage}
                </Alert>
              ) : null}
            </CardContent>

            <CardFooter>
              <Button asChild variant="ghost" size="sm">
                <a href={definition.docsUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink aria-hidden />
                  Provider documentation
                </a>
              </Button>
              {data.canManage && data.dbReady ? (
                <ConnectSourceActions
                  row={source}
                  encryptionReady={data.encryptionConfigured}
                  onOutcome={onOutcome}
                  returnTo="settings"
                />
              ) : null}
              <Button asChild variant="ghost" size="sm" className="ml-auto">
                <Link href="/data-health">Test connection and run a sync</Link>
              </Button>
            </CardFooter>
          </Card>
        )
      })}

      <p className="text-[12px] leading-5 text-ink-500">
        MetroLED Intelligence only reads from these systems. It never writes back to them.
      </p>
    </div>
  )
}
