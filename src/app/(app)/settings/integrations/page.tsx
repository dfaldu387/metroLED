import type { Metadata } from 'next'
import Link from 'next/link'
import { ExternalLink, KeyRound, ShieldCheck } from 'lucide-react'
import { PERMISSIONS } from '@/lib/auth/permissions'
import { requirePermission } from '@/lib/auth/guards'
import { prisma, databaseReachable } from '@/lib/db'
import { env, integrationEnv } from '@/lib/env'
import { credentialEncryptionConfigured } from '@/lib/crypto'
import { formatRelativeTime } from '@/lib/dates'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge, StatusDot } from '@/components/ui/badge'
import { Alert } from '@/components/ui/feedback'

export const metadata: Metadata = { title: 'Integrations' }

/**
 * Integration status and connection management (section 17).
 *
 * This page shows WHETHER a credential exists and whether it works. It never
 * shows the credential itself: no access token, API key or webhook secret is
 * rendered here or returned by any route that feeds it.
 */
export default async function IntegrationsSettingsPage() {
  const user = await requirePermission(PERMISSIONS.SETTINGS_VIEW, '/settings/integrations')
  const canManage = user.permissions.has(PERMISSIONS.SETTINGS_MANAGE)
  const dbReady = await databaseReachable()
  const now = new Date()

  const rows = dbReady ? await prisma.integration.findMany({ orderBy: { provider: 'asc' } }) : []

  const qbo = integrationEnv.quickbooks()
  const method = integrationEnv.method()
  const shopify = integrationEnv.shopify()
  const monday = integrationEnv.monday()

  const providers = [
    {
      provider: 'QUICKBOOKS' as const,
      name: 'QuickBooks Online',
      what: 'Invoices, payments, customers and the chart of accounts. The source of revenue, receivables and cost of goods sold.',
      auth: 'OAuth 2.0. Connect through Intuit; the access token refreshes automatically and the rotated refresh token is stored encrypted.',
      envVars: ['QBO_CLIENT_ID', 'QBO_CLIENT_SECRET', 'QBO_ENVIRONMENT'],
      envReady: qbo.configured,
      docsUrl: 'https://developer.intuit.com',
      connectUrl: '/api/integrations/quickbooks/connect',
      extra: `Environment: ${env().QBO_ENVIRONMENT}. Redirect URI must be ${env().APP_URL}/api/integrations/quickbooks/callback`,
    },
    {
      provider: 'METHOD_CRM' as const,
      name: 'Method CRM',
      what: 'Estimates and customers. The source of the sales pipeline, quote aging and win rate.',
      auth: 'API key, sent in an Authorization header. Stored encrypted.',
      envVars: ['METHOD_API_KEY', 'METHOD_API_BASE_URL'],
      envReady: method.configured,
      docsUrl: 'https://www.method.me/api/',
      connectUrl: null,
      extra:
        'Method tables are configurable per account, so the Estimate and Customer field names must be confirmed against the MetroLED account before go-live.',
    },
    {
      provider: 'SHOPIFY' as const,
      name: 'Shopify — Eco LED Mart',
      what: 'Orders, line items, refunds and customers. The source of e-commerce sales.',
      auth: 'Custom app Admin API access token, plus a webhook signing secret for near-real-time order updates. Both stored encrypted.',
      envVars: ['SHOPIFY_SHOP_DOMAIN', 'SHOPIFY_ADMIN_ACCESS_TOKEN', 'SHOPIFY_API_VERSION', 'SHOPIFY_WEBHOOK_SECRET'],
      envReady: shopify.configured,
      docsUrl: 'https://shopify.dev/docs/api/admin-rest',
      connectUrl: null,
      extra: `API version ${shopify.apiVersion}. Webhook endpoint: ${env().APP_URL}/api/webhooks/shopify (topics: orders/create, orders/updated, orders/cancelled, orders/paid, refunds/create)`,
    },
  ]

  return (
    <div className="space-y-4">
      {!credentialEncryptionConfigured() ? (
        <Alert tone="negative" title="Credentials cannot be stored on this deployment">
          <code className="font-mono text-[12px]">CREDENTIAL_ENCRYPTION_KEY</code> is missing or is not exactly 32
          bytes when base64-decoded. No integration can be connected until it is set.
        </Alert>
      ) : (
        <Alert tone="info" title="How credentials are handled">
          Access tokens, API keys and webhook secrets are encrypted at rest with AES-256-GCM and decrypted only
          inside the synchronisation service. They are never returned by an API route and never rendered on a
          screen, including this one.
        </Alert>
      )}

      {monday.enabled ? (
        <Alert tone="warning" title="Monday.com is enabled">
          Monday.com is conditional in the Phase 1 scope. It is enabled on this deployment via{' '}
          <code className="font-mono text-[12px]">MONDAY_ENABLED</code>. Confirm with the client that it is in
          scope, and that the change went through the change log.
        </Alert>
      ) : null}

      {providers.map((definition) => {
        const row = rows.find((r) => r.provider === definition.provider)
        const status = row?.status ?? 'NOT_CONFIGURED'
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

              {dbReady && row ? (
                <dl className="grid grid-cols-2 gap-3 border-t border-ink-200 pt-3 sm:grid-cols-4">
                  <div>
                    <dt className="text-[11.5px] text-ink-500">Credential stored</dt>
                    <dd className="text-[13px] font-medium text-ink-900">{row.credentials ? 'Yes' : 'No'}</dd>
                  </div>
                  <div>
                    <dt className="text-[11.5px] text-ink-500">Last success</dt>
                    <dd className="text-[13px] font-medium text-ink-900">
                      {formatRelativeTime(row.lastSuccessAt, now)}
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
              {definition.connectUrl && canManage && definition.envReady ? (
                <Button asChild variant="secondary" size="sm">
                  <a href={definition.connectUrl}>Connect {definition.name}</a>
                </Button>
              ) : null}
              <Button asChild variant="ghost" size="sm" className="ml-auto">
                <Link href="/data-health">Test connection and run a sync</Link>
              </Button>
            </CardFooter>
          </Card>
        )
      })}

      <p className="text-[12px] leading-5 text-ink-500">
        MetroLED Intelligence reads from these systems and never writes to them. It does not create, update or
        cancel an invoice, a quote or an order.
      </p>
    </div>
  )
}

export const dynamic = 'force-dynamic'
