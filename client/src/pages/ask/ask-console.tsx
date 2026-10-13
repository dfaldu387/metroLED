import * as React from 'react'
import {
  Clock,
  Database,
  FlaskConical,
  Mic,
  MicOff,
  Percent,
  RotateCcw,
  Search,
  SendHorizontal,
  ShieldAlert,
  ShoppingCart,
  Sparkles,
  Target,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react'
import { parseAnswer } from '@shared/ask'
import { cn } from '@/lib/utils'
import { api, ApiError } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Alert, LiveRegion } from '@/components/ui/feedback'
import { Avatar } from '@/components/ui/misc'
import { Badge } from '@/components/ui/badge'

/**
 * The Ask MetroLED console.
 *
 * Empty state: a centred prompt with four suggested questions, each tagged
 * with the area it explores. Conversation: the exchange scrolls in the middle
 * and the composer stays pinned to the bottom of the viewport.
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
    if (turns.length > 0) endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [turns])

  const startOver = () => {
    setTurns([])
    setConversationId(null)
    inputRef.current?.focus()
  }

  const empty = turns.length === 0

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <LiveRegion message={announcement} />

      {empty ? (
        <div className="flex flex-1 flex-col items-center justify-center px-2 py-10 sm:py-14">
          <div className="w-full max-w-2xl text-center">
            <span className="mx-auto mb-5 flex size-[52px] items-center justify-center rounded-2xl bg-brand-50 ring-1 ring-inset ring-brand-100">
              <Sparkles className="size-6 text-brand-600" aria-hidden />
            </span>
            <h2 className="mx-auto max-w-xl text-[24px] font-semibold leading-[1.25] tracking-[-0.02em] text-ink-900 sm:text-[27px]">
              What would you like to understand about MetroLED, {userName}?
            </h2>
            <p className="mx-auto mt-3 max-w-lg text-[14px] leading-6 text-ink-500">
              Ask a question in plain English. MetroLED Intelligence searches the approved sources available to you
              and explains what it finds, naming the system behind every figure.
            </p>

            <div className="mt-8 grid gap-3 text-left sm:grid-cols-2">
              {suggestions.slice(0, 4).map((question) => {
                const topic = classify(question)
                return (
                  <button
                    key={question}
                    type="button"
                    disabled={!enabled}
                    onClick={() => void submit(question)}
                    className="group flex items-start gap-3.5 rounded-xl border border-ink-200 bg-surface px-4 py-3.5 text-left shadow-card transition-all hover:-translate-y-px hover:border-brand-300 hover:shadow-raised focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/30 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
                  >
                    <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600 transition-colors group-hover:bg-brand-100">
                      <topic.icon className="size-4" aria-hidden />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">
                        {topic.label}
                      </span>
                      <span className="mt-0.5 block text-[14px] font-medium leading-5 text-ink-900">{question}</span>
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-1 pb-6 pt-2">
          <div className="mx-auto w-full max-w-3xl space-y-5">
            <div className="flex items-center justify-end">
              <Button type="button" variant="ghost" size="sm" onClick={startOver}>
                <RotateCcw aria-hidden />
                Start over
              </Button>
            </div>
            {turns.map((turn) =>
              turn.role === 'user' ? (
                <div key={turn.id} className="flex justify-end">
                  <div className="flex max-w-[min(42rem,90%)] items-start gap-2.5">
                    <div className="rounded-2xl rounded-tr-md bg-brand-600 px-4 py-2.5 text-[14px] leading-6 text-white">
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
        </div>
      )}

      {/* --- Composer -------------------------------------------------------- */}
      <div className="sticky bottom-0 z-10 -mx-4 bg-gradient-to-t from-ink-50 via-ink-50 to-ink-50/0 px-4 pb-4 pt-6 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <div className="mx-auto w-full max-w-3xl">
          <Composer
            ref={inputRef}
            value={input}
            onChange={setInput}
            onSubmit={() => void submit(input)}
            disabled={!enabled}
            busy={busy}
            placeholder={
              enabled ? 'Ask MetroLED about revenue, invoices, quotes or trends…' : 'The assistant is not configured'
            }
          />
          <p className="mt-2.5 text-center text-[12px] text-ink-500">
            Enter to send · Shift+Enter for a new line
            {dataMode === 'demo' ? (
              <span className="ml-2 inline-flex items-center gap-1 text-warning-800">
                <FlaskConical className="size-3.5" aria-hidden />
                Answering from the demo dataset
              </span>
            ) : null}
          </p>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Composer: pill input with dictation and send
// ---------------------------------------------------------------------------

const Composer = React.forwardRef<
  HTMLTextAreaElement,
  {
    value: string
    onChange: (value: string) => void
    onSubmit: () => void
    disabled: boolean
    busy: boolean
    placeholder: string
  }
>(function Composer({ value, onChange, onSubmit, disabled, busy, placeholder }, ref) {
  const innerRef = React.useRef<HTMLTextAreaElement | null>(null)
  const setRefs = (node: HTMLTextAreaElement | null) => {
    innerRef.current = node
    if (typeof ref === 'function') ref(node)
    else if (ref) ref.current = node
  }

  // Grow with the text up to a few lines, then scroll.
  React.useLayoutEffect(() => {
    const el = innerRef.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }, [value])

  const dictation = useDictation((transcript) => onChange(value ? `${value} ${transcript}` : transcript))
  const multiline = value.includes('\n') || (innerRef.current?.scrollHeight ?? 0) > 44
  const canSend = !disabled && !busy && value.trim().length > 0

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit()
      }}
      className={cn(
        'flex items-end gap-1 border bg-surface py-1.5 pl-5 pr-1.5 shadow-raised transition-[border-color,box-shadow] focus-within:border-brand-500 focus-within:shadow-[0_0_0_4px_rgb(26_86_219/0.10)]',
        multiline ? 'rounded-3xl' : 'rounded-full',
        disabled ? 'border-ink-200 bg-ink-50' : 'border-brand-200',
      )}
    >
      <textarea
        ref={setRefs}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            onSubmit()
          }
        }}
        rows={1}
        disabled={disabled || busy}
        aria-label="Ask a question about company data"
        placeholder={placeholder}
        className="max-h-40 min-h-[36px] flex-1 resize-none bg-transparent py-1.5 text-[15px] leading-6 text-ink-900 placeholder:text-ink-400 focus:outline-none disabled:cursor-not-allowed"
      />
      {dictation.supported ? (
        <button
          type="button"
          onClick={dictation.toggle}
          disabled={disabled || busy}
          aria-pressed={dictation.listening}
          aria-label={dictation.listening ? 'Stop dictation' : 'Dictate a question'}
          title={dictation.listening ? 'Stop dictation' : 'Dictate a question'}
          className={cn(
            'flex size-9 shrink-0 items-center justify-center rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-50',
            dictation.listening
              ? 'border-negative-200 bg-negative-50 text-negative-700 animate-pulse'
              : 'border-ink-200 bg-surface text-ink-600 hover:bg-ink-50 hover:text-ink-900',
          )}
        >
          {dictation.listening ? <MicOff className="size-4" aria-hidden /> : <Mic className="size-4" aria-hidden />}
        </button>
      ) : null}
      <button
        type="submit"
        disabled={!canSend}
        aria-label="Send question"
        aria-busy={busy || undefined}
        className={cn(
          'flex size-9 shrink-0 items-center justify-center rounded-full border transition-colors disabled:cursor-not-allowed',
          canSend
            ? 'border-brand-600 bg-brand-600 text-white hover:bg-brand-700'
            : 'border-ink-200 bg-brand-50 text-brand-400',
        )}
      >
        {busy ? (
          <span className="size-4 animate-spin rounded-full border-2 border-brand-300 border-t-brand-600" aria-hidden />
        ) : (
          <SendHorizontal className="size-4" aria-hidden />
        )}
      </button>
    </form>
  )
})

// ---------------------------------------------------------------------------
// Dictation (Web Speech API, where the browser has it)
// ---------------------------------------------------------------------------

type SpeechRecognitionLike = {
  lang: string
  interimResults: boolean
  continuous: boolean
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null
  onend: (() => void) | null
  onerror: (() => void) | null
  start: () => void
  stop: () => void
}

function speechRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike
    webkitSpeechRecognition?: new () => SpeechRecognitionLike
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

function useDictation(onTranscript: (text: string) => void) {
  const [listening, setListening] = React.useState(false)
  const recognitionRef = React.useRef<SpeechRecognitionLike | null>(null)
  const callbackRef = React.useRef(onTranscript)
  callbackRef.current = onTranscript
  const supported = React.useMemo(() => speechRecognitionCtor() !== null, [])

  React.useEffect(() => () => recognitionRef.current?.stop(), [])

  const toggle = () => {
    if (listening) {
      recognitionRef.current?.stop()
      setListening(false)
      return
    }
    const Ctor = speechRecognitionCtor()
    if (!Ctor) return
    const recognition = new Ctor()
    recognition.lang = navigator.language || 'en-US'
    recognition.interimResults = false
    recognition.continuous = false
    recognition.onresult = (event) => {
      const last = event.results[event.results.length - 1]
      const transcript = last?.[0]?.transcript?.trim()
      if (transcript) callbackRef.current(transcript)
    }
    recognition.onend = () => setListening(false)
    recognition.onerror = () => setListening(false)
    recognitionRef.current = recognition
    try {
      recognition.start()
      setListening(true)
    } catch {
      setListening(false)
    }
  }

  return { supported, listening, toggle }
}

// ---------------------------------------------------------------------------
// Suggestion topics
// ---------------------------------------------------------------------------

/** Labels a suggested question with the area it explores, for the card tag and icon. */
function classify(question: string): { label: string; icon: LucideIcon } {
  const q = question.toLowerCase()
  if (/margin|profit/.test(q)) return { label: 'Gross margin', icon: Percent }
  if (/overdue|invoice|receivable|owed/.test(q)) return { label: 'Receivables', icon: Clock }
  if (/quote|pipeline|estimate|win rate/.test(q)) return { label: 'Sales pipeline', icon: Target }
  if (/eco led|shopify|store|order/.test(q)) return { label: 'E-commerce', icon: ShoppingCart }
  if (/up to date|data|sync|fresh/.test(q)) return { label: 'Data health', icon: Database }
  if (/changed|compared|trend|most/.test(q)) return { label: 'Explore trends', icon: TrendingUp }
  if (/look at|today|focus/.test(q)) return { label: 'Daily focus', icon: Sparkles }
  return { label: 'Investigate', icon: Search }
}

// ---------------------------------------------------------------------------
// Assistant turn
// ---------------------------------------------------------------------------

function AssistantTurn({ turn }: { turn: Turn }) {
  if (turn.pending) {
    return (
      <div className="flex max-w-[min(48rem,95%)] gap-2.5">
        <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-100">
          <Sparkles className="size-3.5 text-brand-700" aria-hidden />
        </span>
        <div className="flex-1 rounded-2xl rounded-tl-md border border-ink-200 bg-surface px-4 py-3 shadow-card">
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
        <div className="rounded-2xl rounded-tl-md border border-ink-200 bg-surface px-4 py-3 shadow-card">
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
