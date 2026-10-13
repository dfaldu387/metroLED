import * as React from 'react'
import { Copy, ExternalLink, KeyRound, Link2, Unplug } from 'lucide-react'
import type { DataHealthSourceRow, IntegrationActionResult } from '@shared/api/operations'
import { api, ApiError } from '@/lib/api'
import { useRouter } from '@/lib/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  ConfirmDialog,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Alert } from '@/components/ui/feedback'
import { Field, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/form'

/**
 * Connect / reconnect / disconnect controls for one source system.
 *
 * - QuickBooks Online goes through Intuit's OAuth consent: the button is a
 *   plain link (full navigation) to the API's connect endpoint.
 * - Method CRM and Shopify take a key or token typed into a dialog. The value
 *   is sent once, stored encrypted on the server and never shown again; the
 *   server tests the connection before it reports success.
 *
 * Nothing here ever receives a credential back from the API.
 */

type Outcome = { tone: 'positive' | 'negative'; message: string }

/** What the controls need to know about a source. `DataHealthSourceRow` satisfies it. */
export type ConnectableSource = Pick<
  DataHealthSourceRow,
  | 'provider'
  | 'displayName'
  | 'credentialSource'
  | 'connectMethod'
  | 'oauthAppConfigured'
  | 'oauthAppSource'
  | 'oauthEnvironment'
  | 'oauthRedirectUri'
>

export function ConnectSourceActions({
  row,
  encryptionReady,
  onOutcome,
  returnTo = 'data-health',
}: {
  row: ConnectableSource
  encryptionReady: boolean
  onOutcome: (outcome: Outcome) => void
  /** Which page the QuickBooks OAuth callback should come back to. */
  returnTo?: 'data-health' | 'settings'
}) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [confirmDisconnect, setConfirmDisconnect] = React.useState(false)
  const [busy, setBusy] = React.useState(false)

  const stored = row.credentialSource === 'stored'
  const connectLabel = stored ? 'Reconnect' : 'Connect'

  const disconnect = async () => {
    setBusy(true)
    try {
      const result = await postForResult(`/api/integrations/${row.provider}/disconnect`, {})
      onOutcome({ tone: result.ok ? 'positive' : 'negative', message: result.message })
      if (result.ok) router.refresh()
    } finally {
      setBusy(false)
      setConfirmDisconnect(false)
    }
  }

  if (row.connectMethod === 'none') return null

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {row.connectMethod === 'oauth' ? (
        <Button variant={stored ? 'ghost' : 'secondary'} size="sm" onClick={() => setOpen(true)}>
          <Link2 aria-hidden />
          {stored ? 'Reconnect' : 'Sign in with QuickBooks'}
        </Button>
      ) : (
        <Button variant={stored ? 'ghost' : 'secondary'} size="sm" onClick={() => setOpen(true)} disabled={!encryptionReady}>
          <KeyRound aria-hidden />
          {connectLabel}
        </Button>
      )}

      {stored ? (
        <Button variant="ghost" size="sm" className="text-ink-600" onClick={() => setConfirmDisconnect(true)}>
          <Unplug aria-hidden />
          Disconnect
        </Button>
      ) : null}

      {row.connectMethod === 'oauth' ? (
        <QuickBooksConnectDialog
          open={open}
          onOpenChange={setOpen}
          row={row}
          encryptionReady={encryptionReady}
          returnTo={returnTo}
          onOutcome={(outcome) => {
            onOutcome(outcome)
            if (outcome.tone === 'positive') router.refresh()
          }}
        />
      ) : row.provider === 'METHOD_CRM' ? (
        <MethodDialog
          open={open}
          onOpenChange={setOpen}
          row={row}
          onOutcome={(outcome) => {
            onOutcome(outcome)
            if (outcome.tone === 'positive') router.refresh()
          }}
        />
      ) : (
        <ShopifyDialog
          open={open}
          onOpenChange={setOpen}
          row={row}
          onOutcome={(outcome) => {
            onOutcome(outcome)
            if (outcome.tone === 'positive') router.refresh()
          }}
        />
      )}

      <ConfirmDialog
        open={confirmDisconnect}
        onOpenChange={(next) => !next && setConfirmDisconnect(false)}
        title={`Disconnect ${row.displayName}?`}
        description={
          <>
            <p>
              The stored credential is deleted and the scheduled sync stops. Nothing is written to{' '}
              {row.displayName} itself.
            </p>
            <p className="mt-2">
              Everything already imported stays in the reports. Connect it again at any time to resume syncing.
            </p>
          </>
        }
        confirmLabel={`Disconnect ${row.displayName}`}
        tone="danger"
        loading={busy}
        onConfirm={disconnect}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Method CRM
// ---------------------------------------------------------------------------

function MethodDialog({
  open,
  onOpenChange,
  row,
  onOutcome,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  row: ConnectableSource
  onOutcome: (outcome: Outcome) => void
}) {
  const [apiKey, setApiKey] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)

  const reset = () => {
    setApiKey('')
    setError(null)
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (apiKey.trim().length < 8) {
      setError('Paste the full API key from Method. It is longer than this.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const result = await postForResult('/api/integrations/method/connect', { apiKey: apiKey.trim() })
      if (result.ok) {
        onOutcome({ tone: 'positive', message: result.message })
        onOpenChange(false)
        reset()
      } else {
        setError(result.message)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) reset()
      }}
    >
      <DialogContent>
        <form onSubmit={(event) => void submit(event)} className="contents">
          <DialogHeader>
            <DialogTitle>Connect Method CRM</DialogTitle>
            <DialogDescription>
              Paste the API key for the MetroLED Method account. It is stored encrypted, checked once against
              Method, and never shown again.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4">
            {row.credentialSource === 'environment' ? (
              <Alert tone="info" title="A key from the server environment is in use">
                Saving a key here takes precedence over <code className="font-mono text-[12px]">METHOD_API_KEY</code>{' '}
                and survives a redeploy.
              </Alert>
            ) : null}

            <Field
              label="Method API key"
              htmlFor="method-api-key"
              required
              error={error}
              help={
                <>
                  In Method, open <strong>Integrations → API</strong> and generate a key with read access. Method
                  is only ever read; the key is never used to change a record.
                </>
              }
            >
              <Input
                id="method-api-key"
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                aria-invalid={error ? true : undefined}
                disabled={busy}
                placeholder="Paste the key"
              />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="secondary" size="sm" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" size="sm" loading={busy}>
              {busy ? 'Checking the connection…' : 'Save and test connection'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Shopify
// ---------------------------------------------------------------------------

function ShopifyDialog({
  open,
  onOpenChange,
  row,
  onOutcome,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  row: ConnectableSource
  onOutcome: (outcome: Outcome) => void
}) {
  const [shopDomain, setShopDomain] = React.useState('')
  const [accessToken, setAccessToken] = React.useState('')
  const [webhookSecret, setWebhookSecret] = React.useState('')
  const [errors, setErrors] = React.useState<{ shopDomain?: string; accessToken?: string; form?: string }>({})
  const [busy, setBusy] = React.useState(false)

  const reset = () => {
    setShopDomain('')
    setAccessToken('')
    setWebhookSecret('')
    setErrors({})
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    const next: typeof errors = {}
    if (!/[a-z0-9]/i.test(shopDomain)) next.shopDomain = 'Enter the store’s myshopify.com address.'
    if (accessToken.trim().length < 8) next.accessToken = 'Paste the full Admin API access token (it starts with shpat_).'
    if (Object.keys(next).length > 0) {
      setErrors(next)
      return
    }

    setBusy(true)
    setErrors({})
    try {
      const result = await postForResult('/api/integrations/shopify/connect', {
        shopDomain: shopDomain.trim(),
        accessToken: accessToken.trim(),
        webhookSecret: webhookSecret.trim(),
      })
      if (result.ok) {
        onOutcome({ tone: 'positive', message: result.message })
        onOpenChange(false)
        reset()
      } else {
        setErrors({ form: result.message })
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) reset()
      }}
    >
      <DialogContent>
        <form onSubmit={(event) => void submit(event)} className="contents">
          <DialogHeader>
            <DialogTitle>Connect Shopify — Eco LED Mart</DialogTitle>
            <DialogDescription>
              Use a custom app’s Admin API access token with read-only scopes. It is stored encrypted, checked once
              against the store, and never shown again.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4">
            {row.credentialSource === 'environment' ? (
              <Alert tone="info" title="Credentials from the server environment are in use">
                Saving them here takes precedence over the <code className="font-mono text-[12px]">SHOPIFY_*</code>{' '}
                variables and survives a redeploy.
              </Alert>
            ) : null}

            {errors.form ? (
              <Alert tone="negative" title="Shopify did not accept the connection">
                {errors.form}
              </Alert>
            ) : null}

            <Field
              label="Shop domain"
              htmlFor="shopify-domain"
              required
              error={errors.shopDomain}
              help="The store’s permanent address, for example eco-led-mart.myshopify.com."
            >
              <Input
                id="shopify-domain"
                autoComplete="off"
                spellCheck={false}
                value={shopDomain}
                onChange={(event) => setShopDomain(event.target.value)}
                aria-invalid={errors.shopDomain ? true : undefined}
                disabled={busy}
                placeholder="eco-led-mart.myshopify.com"
              />
            </Field>

            <Field
              label="Admin API access token"
              htmlFor="shopify-token"
              required
              error={errors.accessToken}
              help={
                <>
                  In Shopify admin, open <strong>Settings → Apps and sales channels → Develop apps</strong>, create
                  an app with <code className="font-mono text-[11.5px]">read_orders</code> and{' '}
                  <code className="font-mono text-[11.5px]">read_customers</code>, install it and reveal the token
                  once.
                </>
              }
            >
              <Input
                id="shopify-token"
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={accessToken}
                onChange={(event) => setAccessToken(event.target.value)}
                aria-invalid={errors.accessToken ? true : undefined}
                disabled={busy}
                placeholder="shpat_…"
              />
            </Field>

            <Field
              label="Webhook signing secret"
              htmlFor="shopify-webhook-secret"
              help="Optional. Found under the app’s API credentials. Needed for near-real-time order updates; without it, orders still arrive on the scheduled sync."
            >
              <Input
                id="shopify-webhook-secret"
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={webhookSecret}
                onChange={(event) => setWebhookSecret(event.target.value)}
                disabled={busy}
                placeholder="Leave empty to skip webhooks"
              />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="secondary" size="sm" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" size="sm" loading={busy}>
              {busy ? 'Checking the connection…' : 'Save and test connection'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// QuickBooks: Intuit app keys, then the Intuit sign-in
// ---------------------------------------------------------------------------

/**
 * Two steps, because Intuit only shows its sign-in page to a registered app:
 *
 *   1. the Client ID and Client Secret of the Intuit developer app (saved
 *      encrypted, once; also accepted from the server environment);
 *   2. "Sign in with Intuit", a full-page redirect to Intuit's consent screen.
 *
 * When the keys are already in place the dialog opens straight on step 2.
 */
function QuickBooksConnectDialog({
  open,
  onOpenChange,
  row,
  encryptionReady,
  returnTo,
  onOutcome,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  row: ConnectableSource
  encryptionReady: boolean
  returnTo: 'data-health' | 'settings'
  onOutcome: (outcome: Outcome) => void
}) {
  const [editingKeys, setEditingKeys] = React.useState(!row.oauthAppConfigured)
  const [clientId, setClientId] = React.useState('')
  const [clientSecret, setClientSecret] = React.useState('')
  const [environment, setEnvironment] = React.useState<'sandbox' | 'production'>(row.oauthEnvironment ?? 'sandbox')
  const [errors, setErrors] = React.useState<{ clientId?: string; clientSecret?: string; form?: string }>({})
  const [busy, setBusy] = React.useState(false)
  const [confirmClear, setConfirmClear] = React.useState(false)
  const [copied, setCopied] = React.useState(false)

  const connectUrl = `/api/integrations/quickbooks/connect?returnTo=${returnTo}`
  const origin = typeof window === 'undefined' ? '' : window.location.origin
  const redirectUri = row.oauthRedirectUri ?? `${origin}/api/integrations/quickbooks/callback`
  const redirectMismatch = Boolean(row.oauthRedirectUri && origin && !row.oauthRedirectUri.startsWith(origin))

  React.useEffect(() => {
    if (open) {
      setEditingKeys(!row.oauthAppConfigured)
      setEnvironment(row.oauthEnvironment ?? 'sandbox')
      setErrors({})
    }
  }, [open, row.oauthAppConfigured, row.oauthEnvironment])

  const reset = () => {
    setClientId('')
    setClientSecret('')
    setErrors({})
    setCopied(false)
  }

  const copyRedirect = async () => {
    try {
      await navigator.clipboard.writeText(redirectUri)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      setCopied(false)
    }
  }

  const saveKeys = async (event: React.FormEvent) => {
    event.preventDefault()
    const next: typeof errors = {}
    if (clientId.trim().length < 10) next.clientId = 'Paste the full Client ID from the Intuit developer portal.'
    if (clientSecret.trim().length < 10) next.clientSecret = 'Paste the full Client Secret from the Intuit developer portal.'
    if (Object.keys(next).length > 0) {
      setErrors(next)
      return
    }
    setBusy(true)
    setErrors({})
    try {
      const result = await postForResult(`/api/integrations/quickbooks/app?returnTo=${returnTo}`, {
        clientId: clientId.trim(),
        clientSecret: clientSecret.trim(),
        environment,
      })
      if (result.ok && result.connectUrl) {
        // Straight on to Intuit: the keys are saved, the sign-in is the next step.
        window.location.assign(result.connectUrl)
        return
      }
      if (result.ok) {
        onOutcome({ tone: 'positive', message: result.message })
        onOpenChange(false)
        reset()
      } else {
        setErrors({ form: result.message })
      }
    } finally {
      setBusy(false)
    }
  }

  const clearKeys = async () => {
    setBusy(true)
    try {
      const result = await postForResult('/api/integrations/quickbooks/app/clear', {})
      onOutcome({ tone: result.ok ? 'positive' : 'negative', message: result.message })
      if (result.ok) onOpenChange(false)
    } finally {
      setBusy(false)
      setConfirmClear(false)
    }
  }

  const keysReady = row.oauthAppConfigured && !editingKeys

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) reset()
      }}
    >
      <DialogContent>
        <form onSubmit={(event) => void saveKeys(event)} className="contents">
          <DialogHeader>
            <DialogTitle>Connect QuickBooks Online</DialogTitle>
            <DialogDescription>
              {keysReady
                ? 'Sign in with the Intuit account that owns the MetroLED QuickBooks company and approve read-only access.'
                : 'QuickBooks connects through Intuit’s sign-in. Intuit only shows that sign-in to a registered app, so the app’s keys come first.'}
            </DialogDescription>
          </DialogHeader>

          <DialogBody className="space-y-4">
            {!encryptionReady ? (
              <Alert tone="negative" title="Credentials cannot be stored yet">
                Set <code className="font-mono text-[12px]">CREDENTIAL_ENCRYPTION_KEY</code> on the server and restart
                it. Neither the app keys nor the tokens Intuit returns can be kept safely until then.
              </Alert>
            ) : null}

            {errors.form ? (
              <Alert tone="negative" title="The keys could not be saved">
                {errors.form}
              </Alert>
            ) : null}

            {keysReady ? (
              <>
                <div className="rounded-lg border border-ink-200 bg-ink-50 px-3.5 py-3 text-[13px] leading-5 text-ink-700">
                  <p className="flex items-center justify-between gap-3">
                    <span className="font-medium text-ink-900">Intuit app keys</span>
                    <Badge variant={row.oauthEnvironment === 'production' ? 'brand' : 'warning'} size="sm">
                      {row.oauthEnvironment === 'production' ? 'Production' : 'Sandbox'}
                    </Badge>
                  </p>
                  <p className="mt-0.5 text-ink-600">
                    {row.oauthAppSource === 'stored'
                      ? 'Saved from this screen and stored encrypted.'
                      : 'Read from the server environment (QBO_CLIENT_ID / QBO_CLIENT_SECRET).'}
                  </p>
                  <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
                    <button type="button" onClick={() => setEditingKeys(true)} className="font-medium text-brand-600 hover:underline">
                      Use different keys
                    </button>
                    {row.oauthAppSource === 'stored' ? (
                      <button type="button" onClick={() => setConfirmClear(true)} className="font-medium text-negative-700 hover:underline">
                        Remove stored keys
                      </button>
                    ) : null}
                  </p>
                </div>

                {redirectMismatch ? (
                  <Alert tone="warning" title="This page is not served from the configured APP_URL">
                    Intuit will redirect to <code className="font-mono text-[12px]">{redirectUri}</code>, not to this
                    address. Set <code className="font-mono text-[12px]">APP_URL</code> to{' '}
                    <code className="font-mono text-[12px]">{origin}</code> on the server (and register that redirect
                    URI with Intuit) or the sign-in will land in the wrong place.
                  </Alert>
                ) : null}

                <p className="text-[13px] leading-5 text-ink-700">
                  After you approve, the tokens are stored encrypted, the connection is tested, and you return to this
                  page. MetroLED Intelligence only ever reads from QuickBooks.
                </p>
              </>
            ) : (
              <>
                <ol className="list-decimal space-y-1.5 pl-5 text-[13px] leading-5 text-ink-700">
                  <li>
                    Sign in at{' '}
                    <a href="https://developer.intuit.com" target="_blank" rel="noopener noreferrer" className="font-medium text-brand-600 hover:underline">
                      developer.intuit.com
                    </a>{' '}
                    with the Intuit account that owns the QuickBooks company and create an app with the{' '}
                    <strong>Accounting</strong> scope.
                  </li>
                  <li>
                    Under <strong>Keys &amp; credentials</strong>, copy the Client ID and Client Secret for the
                    environment you are connecting.
                  </li>
                  <li>
                    Add this redirect URI to the app, exactly:
                    <span className="mt-1 flex items-center gap-2">
                      <code className="min-w-0 flex-1 truncate rounded bg-ink-100 px-2 py-1 font-mono text-[11.5px] text-ink-800">
                        {redirectUri}
                      </code>
                      <button
                        type="button"
                        onClick={() => void copyRedirect()}
                        className="flex h-7 shrink-0 items-center gap-1 rounded-md border border-ink-200 bg-surface px-2 text-[11.5px] font-medium text-ink-700 hover:bg-ink-50"
                      >
                        <Copy className="size-3.5" aria-hidden />
                        {copied ? 'Copied' : 'Copy'}
                      </button>
                    </span>
                  </li>
                </ol>

                {redirectMismatch ? (
                  <Alert tone="warning" title="APP_URL points somewhere else">
                    The server will tell Intuit to come back to the address above, which is not this page’s origin (
                    <code className="font-mono text-[12px]">{origin}</code>). Set{' '}
                    <code className="font-mono text-[12px]">APP_URL</code> on the server to match before signing in.
                  </Alert>
                ) : null}

                <Field label="Client ID" htmlFor="qbo-client-id" required error={errors.clientId}>
                  <Input
                    id="qbo-client-id"
                    autoComplete="off"
                    spellCheck={false}
                    value={clientId}
                    onChange={(event) => setClientId(event.target.value)}
                    aria-invalid={errors.clientId ? true : undefined}
                    disabled={busy}
                    placeholder="AB…"
                  />
                </Field>

                <Field label="Client Secret" htmlFor="qbo-client-secret" required error={errors.clientSecret}>
                  <Input
                    id="qbo-client-secret"
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    value={clientSecret}
                    onChange={(event) => setClientSecret(event.target.value)}
                    aria-invalid={errors.clientSecret ? true : undefined}
                    disabled={busy}
                    placeholder="Paste the secret"
                  />
                </Field>

                <Field
                  label="Environment"
                  htmlFor="qbo-environment"
                  help="Sandbox keys only open sandbox companies. Use Production for the real MetroLED books."
                >
                  <Select value={environment} onValueChange={(value) => setEnvironment(value === 'production' ? 'production' : 'sandbox')} disabled={busy}>
                    <SelectTrigger id="qbo-environment">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="sandbox">Sandbox (testing)</SelectItem>
                      <SelectItem value="production">Production (live company)</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              </>
            )}
          </DialogBody>

          <DialogFooter>
            {keysReady ? (
              <>
                <Button type="button" variant="secondary" size="sm" onClick={() => onOpenChange(false)} disabled={busy}>
                  Cancel
                </Button>
                <Button asChild variant="primary" size="sm">
                  <a href={encryptionReady ? connectUrl : undefined} aria-disabled={!encryptionReady}>
                    <ExternalLink aria-hidden />
                    Sign in with Intuit
                  </a>
                </Button>
              </>
            ) : (
              <>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => (row.oauthAppConfigured ? setEditingKeys(false) : onOpenChange(false))}
                  disabled={busy}
                >
                  {row.oauthAppConfigured ? 'Back' : 'Cancel'}
                </Button>
                <Button type="submit" variant="primary" size="sm" loading={busy} disabled={!encryptionReady}>
                  {busy ? 'Saving…' : 'Save keys and sign in with Intuit'}
                </Button>
              </>
            )}
          </DialogFooter>
        </form>
      </DialogContent>

      <ConfirmDialog
        open={confirmClear}
        onOpenChange={(next) => !next && setConfirmClear(false)}
        title="Remove the stored Intuit app keys?"
        description={
          <p>
            QuickBooks is disconnected at the same time, because its tokens cannot be refreshed without the app that
            issued them. Imported history is kept. You can enter new keys and sign in again at any time.
          </p>
        }
        confirmLabel="Remove keys and disconnect"
        tone="danger"
        loading={busy}
        onConfirm={clearKeys}
      />
    </Dialog>
  )
}

/** POST and read `{ ok, message }` whether the status was 2xx or not. */
async function postForResult(path: string, body: unknown): Promise<IntegrationActionResult> {
  try {
    return await api.post<IntegrationActionResult>(path, body)
  } catch (error) {
    if (error instanceof ApiError) {
      return { ok: false, message: error.message, error: error.code }
    }
    return { ok: false, message: 'The server could not be reached. Check your connection and try again.' }
  }
}
