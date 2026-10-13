import * as React from 'react'
import { ArrowUp, Database, FlaskConical, RotateCcw, ShieldAlert, Sparkles } from 'lucide-react'
import { parseAnswer } from '@shared/ask'
import { cn } from '@/lib/utils'
import { api, ApiError } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Alert, LiveRegion } from '@/components/ui/feedback'
import { Avatar } from '@/components/ui/misc'
import { Badge } from '@/components/ui/badge'

/**
 * The Ask MetroLED chat console.
 *
 * Answers are rendered with their four sections (Answer, Business context,
 * Source, Data freshness) and the structured source list returned by the
 * query layer, so the provenance of a figure is visible without reading the
 * prose.
 */

interface Source {
  system: string
  period?: string
  recordCount?: number
  metricDefinition?: string
  note?: string
}

interface Turn {
  id: string
  role: 'user' | 'assistant'
  content: string
  sources?: Source[]
  toolCalls?: { name: string; ok: boolean; refusal?: string }[]
  dataMode?: string
  error?: string
  pending?: boolean
}

export function AskConsole({
  suggestions,
  initialQuestion,
  enabled,
  dataMode,
  userName,
}: {
  suggestions: string[]
  initialQuestion: string | null
  enabled: boolean
  dataMode: string
  userName: string
}) {
  const [turns, setTurns] = React.useState<Turn[]>([])
  const [input, setInput] = React.useState(initialQuestion ?? '')
  const [busy, setBusy] = React.useState(false)
  const [conversationId, setConversationId] = React.useState<string | null>(null)
  const [announcement, setAnnouncement] = React.useState<string | null>(null)

  const endRef = React.useRef<HTMLDivElement>(null)
  const inputRef = React.useRef<HTMLTextAreaElement>(null)
  const askedInitial = React.useRef(false)

  const submit = React.useCallback(
    async (question: string) => {
      const trimmed = question.trim()
      if (!trimmed || busy || !enabled) return

      const userTurn: Turn = { id: `u-${Date.now()}`, role: 'user', content: trimmed }
      const pendingTurn: Turn = {
        id: `a-${Date.now()}`,
        role: 'assistant',
        content: '',
        pending: true,
      }

      setTurns((prev) => [...prev, userTurn, pendingTurn])
      setInput('')
      setBusy(true)
      setAnnouncement('Looking that up…')

      // Prior turns give the assistant context for follow-up questions.
      const history = turns
        .filter((t) => !t.pending && !t.error)
        .slice(-6)
        .map((t) => ({ role: t.role, content: t.content }))

      try {
        const payload = await postJson<{
          ok?: boolean
          answer?: string
          sources?: Source[]
          toolCalls?: { name: string; ok: boolean; refusal?: string }[]
          dataMode?: string
          conversationId?: string | null
          message?: string
          error?: string
        }>('/api/ask', { question: trimmed, conversationId, history })

        if (!payload.ok) {
          setTurns((prev) =>
            prev.map((turn) =>
              turn.id === pendingTurn.id
                ? {
                    ...turn,
                    pending: false,
                    content:
                      payload.message ??
                      'The assistant could not answer that. Please try again in a moment.',
                    error: payload.error ?? 'REQUEST_FAILED',
                  }
                : turn,
            ),
          )
          setAnnouncement('The assistant could not answer that question.')
          return
        }

        if (payload.conversationId) setConversationId(payload.conversationId)

        setTurns((prev) =>
          prev.map((turn) =>
            turn.id === pendingTurn.id
              ? {
                  ...turn,
                  pending: false,
                  content: payload.answer ?? '',
                  sources: payload.sources ?? [],
                  toolCalls: payload.toolCalls ?? [],
                  dataMode: payload.dataMode,
                  error: payload.error,
                }
              : turn,
          ),
        )
        setAnnouncement('Answer ready.')
      } catch {
        setTurns((prev) =>
          prev.map((turn) =>
            turn.id === pendingTurn.id
              ? {
                  ...turn,
                  pending: false,
                  content:
                    'I could not reach the server. Check your connection and ask again.',
                  error: 'NETWORK',
                }
              : turn,
          ),
        )
        setAnnouncement('Could not reach the server.')
      } finally {
        setBusy(false)
      }
    },
    [busy, conversationId, enabled, turns],
  )

  // A question passed in the URL (from a dashboard "Ask a question" button)
  // is asked once on arrival.
  React.useEffect(() => {
    if (initialQuestion && enabled && !askedInitial.current) {
      askedInitial.current = true
      void submit(initialQuestion)
    }
  }, [initialQuestion, enabled, submit])

  React.useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [turns])

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void submit(input)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <LiveRegion message={announcement} />

      {turns.length === 0 ? (
        <Card>
          <CardContent className="py-8">
            <div className="mx-auto max-w-2xl text-center">
              <span className="mx-auto mb-3.5 flex size-11 items-center justify-center rounded-full bg-brand-50">
                <Sparkles className="size-5 text-brand-600" aria-hidden />
              </span>
              <h2 className="text-[16px] font-semibold text-ink-900">What would you like to know, {userName}?</h2>
              <p className="mx-auto mt-1.5 max-w-lg text-[13.5px] leading-5 text-ink-600">
                Ask about revenue, receivables, the sales pipeline, the Shopify store or how fresh the data is.
                Every answer cites its source.
              </p>

              <div className="mt-5 grid gap-2 text-left sm:grid-cols-2">
                {suggestions.map((question) => (
                  <button
                    key={question}
                    type="button"
                    disabled={!enabled}
                    onClick={() => void submit(question)}
                    className="rounded-lg border border-ink-200 bg-white px-3.5 py-2.5 text-left text-[13px] text-ink-800 shadow-card transition-colors hover:border-brand-300 hover:bg-brand-50/40 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {question}
                  </button>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {turns.map((turn) =>
            turn.role === 'user' ? (
              <div key={turn.id} className="flex justify-end">
                <div className="flex max-w-[min(42rem,90%)] items-start gap-2.5">
                  <div className="rounded-xl rounded-tr-sm bg-brand-600 px-3.5 py-2.5 text-[13.5px] leading-5 text-white">
                    {turn.content}
                  </div>
                  <Avatar name={userName} size="sm" className="mt-0.5 bg-ink-200 text-ink-700" />
                </div>
              </div>
            ) : (
              <AssistantTurn key={turn.id} turn={turn} />
            ),
          )}
          <div ref={endRef} />
        </div>
      )}

      {/* --- Composer ------------------------------------------------------ */}
      <Card className="sticky bottom-4 z-10">
        <CardContent className="py-3">
          <form
            onSubmit={(event) => {
              event.preventDefault()
              void submit(input)
            }}
          >
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={onKeyDown}
                rows={1}
                disabled={!enabled || busy}
                aria-label="Ask a question about company data"
                placeholder={
                  enabled ? 'Ask about revenue, overdue invoices, the pipeline…' : 'The assistant is not configured'
                }
                className="max-h-40 min-h-9 flex-1 resize-none rounded-lg border border-ink-300 bg-white px-3 py-2 text-sm text-ink-900 shadow-card transition-colors placeholder:text-ink-400 hover:border-ink-400 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20 disabled:cursor-not-allowed disabled:bg-ink-100"
              />
              <Button
                type="submit"
                variant="primary"
                size="icon"
                loading={busy}
                disabled={!enabled || !input.trim()}
                aria-label="Send question"
              >
                {busy ? null : <ArrowUp aria-hidden />}
              </Button>
            </div>
            <div className="mt-2 flex items-center justify-between gap-3">
              <p className="text-[11.5px] text-ink-500">
                Press Enter to send, Shift+Enter for a new line. Answers come only from approved company data
                queries.
              </p>
              {turns.length > 0 ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setTurns([])
                    setConversationId(null)
                    inputRef.current?.focus()
                  }}
                >
                  <RotateCcw aria-hidden />
                  Start over
                </Button>
              ) : null}
            </div>
          </form>
        </CardContent>
      </Card>

      {dataMode === 'demo' ? (
        <p className="flex items-center justify-center gap-1.5 text-[12px] text-warning-800">
          <FlaskConical className="size-3.5" aria-hidden />
          The assistant is answering from the demo dataset and will say so in every answer.
        </p>
      ) : null}
    </div>
  )
}

function AssistantTurn({ turn }: { turn: Turn }) {
  if (turn.pending) {
    return (
      <div className="flex max-w-[min(48rem,95%)] gap-2.5">
        <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-100">
          <Sparkles className="size-3.5 text-brand-700" aria-hidden />
        </span>
        <div className="flex-1 rounded-xl rounded-tl-sm border border-ink-200 bg-white px-3.5 py-3 shadow-card">
          <div className="flex items-center gap-2 text-[13px] text-ink-600">
            <span className="flex gap-1" aria-hidden>
              <span className="size-1.5 animate-pulse rounded-full bg-ink-400" />
              <span className="size-1.5 animate-pulse rounded-full bg-ink-400 [animation-delay:150ms]" />
              <span className="size-1.5 animate-pulse rounded-full bg-ink-400 [animation-delay:300ms]" />
            </span>
            Checking the company data&hellip;
          </div>
        </div>
      </div>
    )
  }

  const refusals = (turn.toolCalls ?? []).filter((t) => !t.ok && t.refusal)

  return (
    <div className="flex max-w-[min(48rem,95%)] gap-2.5">
      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-100">
        <Sparkles className="size-3.5 text-brand-700" aria-hidden />
      </span>

      <div className="min-w-0 flex-1 space-y-2.5">
        <div className="rounded-xl rounded-tl-sm border border-ink-200 bg-white px-4 py-3 shadow-card">
          {turn.error ? (
            <Alert tone="negative" title="The assistant could not answer">
              {turn.content}
            </Alert>
          ) : (
            <AnswerBody content={turn.content} />
          )}
        </div>

        {refusals.length > 0 ? (
          <div className="flex items-start gap-2 rounded-lg border border-ink-200 bg-ink-50 px-3 py-2 text-[12px] leading-5 text-ink-600">
            <ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-ink-500" aria-hidden />
            <span>
              Some information was withheld by your permissions:{' '}
              {refusals.map((r) => r.refusal).join(' ')}
            </span>
          </div>
        ) : null}

        {turn.sources && turn.sources.length > 0 ? (
          <details className="group rounded-lg border border-ink-200 bg-ink-50/60 px-3 py-2">
            <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[12px] font-medium text-ink-700">
              <Database className="size-3.5 text-ink-500" aria-hidden />
              View source
              <span className="text-ink-500">
                ({turn.sources.length} {turn.sources.length === 1 ? 'source' : 'sources'})
              </span>
            </summary>
            <ul className="mt-2 space-y-2 border-t border-ink-200 pt-2">
              {turn.sources.map((source, index) => (
                <li key={index} className="text-[12px] leading-5">
                  <p className="font-medium text-ink-900">{source.system}</p>
                  {source.period ? <p className="text-ink-600">Period: {source.period}</p> : null}
                  {source.recordCount !== undefined ? (
                    <p className="text-ink-600">Records: {source.recordCount}</p>
                  ) : null}
                  {source.metricDefinition ? (
                    <p className="mt-0.5 font-mono text-[11px] text-ink-600">{source.metricDefinition}</p>
                  ) : null}
                  {source.note ? <p className="mt-0.5 text-ink-500">{source.note}</p> : null}
                </li>
              ))}
            </ul>
            {turn.toolCalls && turn.toolCalls.length > 0 ? (
              <p className="mt-2 border-t border-ink-200 pt-2 text-[11px] text-ink-500">
                Queries run: {turn.toolCalls.map((t) => t.name).join(', ')}
              </p>
            ) : null}
          </details>
        ) : null}

        {turn.dataMode === 'demo' ? (
          <Badge variant="demo" size="sm">
            Answered from demo data
          </Badge>
        ) : null}
      </div>
    </div>
  )
}

/**
 * Renders the assistant's four-part answer.
 *
 * The model is instructed to emit `**Answer:**`, `**Business context:**`,
 * `**Source:**` and `**Data freshness:**`. Those are styled as labelled
 * sections; anything else is rendered as plain paragraphs, so an answer that
 * does not use the headings still reads correctly.
 */
function AnswerBody({ content }: { content: string }) {
  const blocks = React.useMemo(() => parseAnswer(content), [content])

  return (
    <div className="space-y-3">
      {blocks.map((block, index) =>
        block.label ? (
          <div key={index}>
            <p
              className={cn(
                'mb-0.5 text-[11px] font-semibold uppercase tracking-wide',
                block.label.toLowerCase().startsWith('answer') ? 'text-brand-700' : 'text-ink-500',
              )}
            >
              {block.label}
            </p>
            <p
              className={cn(
                'whitespace-pre-line leading-6',
                block.label.toLowerCase().startsWith('answer')
                  ? 'text-[14.5px] font-medium text-ink-900'
                  : 'text-[13px] text-ink-700',
              )}
            >
              {block.text}
            </p>
          </div>
        ) : (
          <p key={index} className="whitespace-pre-line text-[13.5px] leading-6 text-ink-800">
            {block.text}
          </p>
        ),
      )}
    </div>
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
