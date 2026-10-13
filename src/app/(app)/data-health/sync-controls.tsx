'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { PlugZap, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/dialog'
import { Alert } from '@/components/ui/feedback'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/misc'

/**
 * Sync controls for the Data Health page.
 *
 * A full backfill re-reads up to 24 months from every provider, which is slow
 * and consumes a large share of the API rate limit, so it is behind a
 * confirmation dialog that says so.
 */

interface ProviderOption {
  provider: string
  displayName: string
  isEnabled: boolean
}

export function SyncControls({ providers }: { providers: ProviderOption[] }) {
  const router = useRouter()
  const [busy, setBusy] = React.useState<string | null>(null)
  const [confirmBackfill, setConfirmBackfill] = React.useState<ProviderOption | 'all' | null>(null)
  const [result, setResult] = React.useState<{ tone: 'positive' | 'negative'; message: string } | null>(null)

  const call = async (body: Record<string, unknown>, label: string) => {
    setBusy(label)
    setResult(null)
    try {
      const response = await fetch('/api/sync/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const payload = (await response.json()) as { ok?: boolean; message?: string }

      setResult({
        tone: payload.ok ? 'positive' : 'negative',
        message: payload.message ?? (payload.ok ? 'Done.' : 'The request failed.'),
      })
      router.refresh()
    } catch {
      setResult({
        tone: 'negative',
        message: 'Could not reach the server. Check your connection and try again.',
      })
    } finally {
      setBusy(null)
      setConfirmBackfill(null)
    }
  }

  const enabled = providers.filter((p) => p.isEnabled)

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary" size="md">
              <PlugZap aria-hidden />
              Test a connection
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>
              <p className="text-[12px] text-ink-500">Checks the credentials without importing anything.</p>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {providers.map((provider) => (
              <DropdownMenuItem
                key={provider.provider}
                onSelect={() => void call({ action: 'test', provider: provider.provider }, `test-${provider.provider}`)}
              >
                {provider.displayName}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary" size="md" disabled={enabled.length === 0}>
              Run one source
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>
              <p className="text-[12px] text-ink-500">Incremental sync of a single source.</p>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {enabled.map((provider) => (
              <DropdownMenuItem
                key={provider.provider}
                onSelect={() => void call({ action: 'sync', provider: provider.provider }, `sync-${provider.provider}`)}
              >
                {provider.displayName}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuLabel>
              <p className="text-[12px] text-ink-500">Full backfill (slow)</p>
            </DropdownMenuLabel>
            {enabled.map((provider) => (
              <DropdownMenuItem
                key={`backfill-${provider.provider}`}
                onSelect={() => setConfirmBackfill(provider)}
              >
                Backfill {provider.displayName}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <Button
          variant="primary"
          size="md"
          loading={busy === 'sync-all'}
          disabled={enabled.length === 0}
          onClick={() => void call({ action: 'sync' }, 'sync-all')}
        >
          <RefreshCw aria-hidden />
          Run sync now
        </Button>
      </div>

      {result ? (
        <Alert
          tone={result.tone}
          title={result.tone === 'positive' ? 'Finished' : 'That did not work'}
          className="mt-3 w-full max-w-xl"
        >
          {result.message}
        </Alert>
      ) : null}

      <ConfirmDialog
        open={confirmBackfill !== null}
        onOpenChange={(open) => !open && setConfirmBackfill(null)}
        title="Run a full historical backfill?"
        description={
          <>
            <p>
              This re-reads up to 24 months of history from{' '}
              <strong>
                {confirmBackfill === 'all' ? 'every connected source' : (confirmBackfill?.displayName ?? '')}
              </strong>
              , ignoring the saved checkpoint.
            </p>
            <p className="mt-2">
              It can take several minutes and uses a large share of the provider&apos;s API rate limit, which may
              slow the regular sync while it runs. Existing records are updated in place, so nothing is duplicated
              and nothing is lost.
            </p>
          </>
        }
        confirmLabel="Start the backfill"
        loading={busy !== null}
        onConfirm={() =>
          call(
            confirmBackfill === 'all' || confirmBackfill === null
              ? { action: 'backfill' }
              : { action: 'backfill', provider: confirmBackfill.provider },
            'backfill',
          )
        }
      />
    </>
  )
}
