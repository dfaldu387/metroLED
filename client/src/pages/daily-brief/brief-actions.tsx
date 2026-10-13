import * as React from 'react'
import { Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/dialog'
import { Alert } from '@/components/ui/feedback'
import { api, ApiError } from '@/lib/api'
import { useRouter } from '@/lib/navigation'

/**
 * Administrative actions for the Daily Brief.
 *
 * Sending is a consequential, outward-facing action - it puts email in
 * executives' inboxes - so it always goes through a confirmation dialog that
 * states exactly what will happen and to whom.
 */
export function BriefActions({ briefDate }: { briefDate: string }) {
  const router = useRouter()
  const [confirmOpen, setConfirmOpen] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [result, setResult] = React.useState<{ tone: 'positive' | 'negative'; message: string } | null>(null)

  const send = async () => {
    setBusy(true)
    setResult(null)
    try {
      const payload = await postJson<{
        ok?: boolean
        message?: string
        sent?: number
        skipped?: number
        failed?: number
        simulated?: boolean
      }>('/api/brief/send', { briefDate })

      if (!payload.ok) {
        setResult({ tone: 'negative', message: payload.message ?? 'The brief could not be sent.' })
        return
      }

      const parts: string[] = []
      if (payload.sent) parts.push(`${payload.sent} sent`)
      if (payload.skipped) parts.push(`${payload.skipped} already delivered and skipped`)
      if (payload.failed) parts.push(`${payload.failed} failed`)

      setResult({
        tone: payload.failed && payload.failed > 0 ? 'negative' : 'positive',
        message: `${parts.join(', ') || 'Nothing to send'}.${payload.simulated ? ' Emails were written to the server log because EMAIL_PROVIDER is set to "console".' : ''}`,
      })
      router.refresh()
    } catch {
      setResult({
        tone: 'negative',
        message: 'Could not reach the server. Check your connection and try again.',
      })
    } finally {
      setBusy(false)
      setConfirmOpen(false)
    }
  }

  return (
    <>
      <div className="flex flex-col items-end gap-2">
        <Button variant="primary" size="md" onClick={() => setConfirmOpen(true)} loading={busy}>
          <Send aria-hidden />
          Send brief now
        </Button>
      </div>

      {result ? (
        <Alert
          tone={result.tone}
          title={result.tone === 'positive' ? 'Daily brief sent' : 'Daily brief could not be sent'}
          className="mt-3 w-full"
        >
          {result.message}
        </Alert>
      ) : null}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Send the daily brief now?"
        description={
          <>
            <p>
              This generates the brief for <strong>{briefDate}</strong> and emails it to every active recipient
              configured in Settings.
            </p>
            <p className="mt-2">
              Recipients who have already received this brief are skipped, so nobody gets it twice.
            </p>
          </>
        }
        confirmLabel="Send the brief"
        loading={busy}
        onConfirm={send}
      />
    </>
  )
}

/**
 * POST JSON and read the JSON reply. A non-2xx reply with a JSON body is
 * returned like a 2xx one (with `ok: false`), as the old `fetch` +
 * `response.json()` code read it; a network failure or non-JSON reply throws.
 */
async function postJson<T extends { ok?: boolean }>(path: string, body: unknown): Promise<T> {
  try {
    return await api.post<T>(path, body)
  } catch (error) {
    if (error instanceof ApiError && error.status > 0 && Object.keys(error.body).length > 0) {
      return { ok: false, ...error.body } as unknown as T
    }
    throw error
  }
}
