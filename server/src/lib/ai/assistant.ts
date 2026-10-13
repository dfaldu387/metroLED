import Anthropic from '@anthropic-ai/sdk'
import { env } from '../env'
import { db, sql, insert, json, databaseReachable } from '../db'
import type { AccessScope } from '../auth/guards'
import type { SessionUser } from '../auth/session'
import type { LoadedDataset } from '../data/dataset'
import {
  executeTool,
  toolDefinitionsFor,
  type ToolContext,
  type ToolExecution,
  type ToolSource,
} from './tools'

/**
 * Ask MetroLED - the AI business analyst (section 11).
 *
 * Execution workflow, in order:
 *   1. the caller authenticates the user and builds the access scope;
 *   2. the tool list is filtered to what that scope allows;
 *   3. the model selects an approved tool and supplies parameters;
 *   4. parameters are validated with Zod;
 *   5. a parameterised, read-only query runs against the scoped dataset;
 *   6. the result is checked and returned to the model as data;
 *   7. the model writes a grounded explanation;
 *   8. sources, period and metric definitions are attached;
 *   9. the exchange is written to the audit trail.
 *
 * The model has no database access and cannot write SQL. Permission is
 * enforced in `executeTool` before any figure is produced, so the model is
 * never relied upon to withhold data.
 */

const MAX_TOOL_ROUNDS = 5

export interface AssistantAnswer {
  answer: string
  toolCalls: { name: string; input: unknown; ok: boolean; refusal?: string; durationMs: number }[]
  sources: ToolSource[]
  dataMode: string
  model: string
  inputTokens: number
  outputTokens: number
  latencyMs: number
  /** Set when the assistant could not answer at all. */
  error?: string
}

function systemPrompt(user: SessionUser, scope: AccessScope, dataset: LoadedDataset): string {
  const restrictions: string[] = []

  if (!scope.canSeeMargin) {
    restrictions.push(
      '- This user may NOT see profit, cost of goods sold or gross margin figures. If asked, say plainly that the figure is not available to their role. Never estimate or derive it from revenue and another number.',
    )
  }
  if (!scope.canSeeAllReps) {
    restrictions.push(
      '- This user may only see their OWN sales records. Every figure you receive is already filtered to them. Never present a figure as a company-wide total, and never discuss another representative’s performance.',
    )
  }
  if (!scope.canSeeReceivables) {
    restrictions.push('- This user may NOT see accounts receivable.')
  }
  if (!scope.canSeeEcommerce) {
    restrictions.push('- This user may NOT see e-commerce reporting.')
  }
  if (scope.divisionIds) {
    restrictions.push('- This user is restricted to specific divisions. Figures cover those divisions only.')
  }

  const demoWarning =
    dataset.mode === 'demo'
      ? `
CRITICAL - DEMO DATA
This deployment is serving a labelled DEMO dataset, not live business data.
Begin every answer that contains a figure with: "Using demo data (not live business figures):".
Never claim that a live source was queried.`
      : dataset.mode === 'unavailable'
        ? `
CRITICAL - NO DATA
No business data is available. The database holds no imported records. Say so plainly and do not produce any figure.`
        : ''

  return `You are the MetroLED Intelligence business analyst. You answer questions about MetroLED's business data for ${user.name}, whose role is ${user.roleLabel}.

MetroLED has three divisions:
- MetroLED: lighting and signage
- Pixel LED Displays: LED display systems
- Eco LED Mart: a Shopify e-commerce store

HOW YOU WORK
You have no database access. You answer only by calling the approved business-query tools provided to you. If no tool can answer the question, say so - do not guess, estimate, or calculate a figure from numbers that were not returned by a tool.
${demoWarning}

ANSWER FORMAT
Structure every answer that contains a figure with these four headings, in this order:

**Answer:** The direct answer, with the figure, in one or two sentences.

**Business context:** What the result means in practice. Two or three sentences. Point out a trend, a concentration, or a risk the figure implies. Do not pad this.

**Source:** The source system, the reporting period, the number of records behind the figure, and the metric definition, taken from the tool's source information. Never invent a source.

**Data freshness:** When the relevant source last synced successfully. If anything is stale or failing, say so here and warn that the figure may be out of date.

For a question that needs no figure (for example "how is revenue defined?"), answer plainly without the headings.

RULES YOU MUST NOT BREAK
1. Never state a number a tool did not return. Never do arithmetic on tool results to produce a new figure that was not returned - if a tool reports a margin is unavailable, the margin is unavailable, full stop.
2. When data is missing, stale, conflicting or insufficient, say so and explain the limitation. If you cannot establish an accurate answer, say "I don't know" and explain what is missing.
3. When a tool refuses because of the user's permissions, relay that plainly and do not attempt another route to the same figure.
4. Never present the Shopify store sales figure as accounting revenue, and never add the two together. They are different bases.
5. Never state a probability-weighted pipeline figure. The pipeline total is unweighted; no weighting formula has been approved.
6. Format currency as the tools return it. Do not re-round or convert.
7. Be concise and plain. The reader is a business owner, not an analyst. No jargon, no hedging, no filler.

ACCESS RESTRICTIONS FOR THIS USER
${restrictions.length > 0 ? restrictions.join('\n') : '- This user may see all company data.'}

Today is ${new Date().toISOString().slice(0, 10)}. The company timezone is US Eastern.`
}

function client(): Anthropic {
  const apiKey = env().ANTHROPIC_API_KEY
  if (!apiKey) {
    throw new Error(
      'ANTHROPIC_API_KEY is not configured, so the assistant cannot run. Add it to the environment and restart.',
    )
  }
  return new Anthropic({ apiKey })
}

export function assistantConfigured(): boolean {
  return Boolean(env().ANTHROPIC_API_KEY)
}

export interface AskOptions {
  user: SessionUser
  scope: AccessScope
  dataset: LoadedDataset
  settings: { staleQuoteDays: number; largeQuoteAmount: number; timezone: string }
  question: string
  /** Prior turns, oldest first, for follow-up questions. */
  history?: { role: 'user' | 'assistant'; content: string }[]
  now?: Date
}

export async function ask(options: AskOptions): Promise<AssistantAnswer> {
  const started = Date.now()
  const model = env().ANTHROPIC_MODEL
  const now = options.now ?? new Date()

  const toolContext: ToolContext = {
    scope: options.scope,
    dataset: options.dataset,
    settings: options.settings,
    now,
  }

  const tools = toolDefinitionsFor(options.scope)
  const executions: ToolExecution[] = []

  const messages: Anthropic.Beta.BetaMessageParam[] = [
    ...(options.history ?? []).map((turn) => ({
      role: turn.role,
      content: turn.content,
    })),
    { role: 'user', content: options.question },
  ]

  let inputTokens = 0
  let outputTokens = 0
  let answer = ''

  try {
    const anthropic = client()

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const response = await anthropic.beta.messages.create({
        model,
        max_tokens: 4096,
        system: systemPrompt(options.user, options.scope, options.dataset),
        tools,
        messages,
        // Keep the reasoning depth proportionate: these are bounded lookups
        // over a fixed tool surface, not open-ended research.
        output_config: { effort: 'medium' },
        // Server-side fallback so a safety-classifier refusal on an innocuous
        // business question still returns an answer rather than an error.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
      })

      inputTokens += response.usage.input_tokens
      outputTokens += response.usage.output_tokens

      if (response.stop_reason === 'refusal') {
        return {
          answer:
            'I was not able to answer that question. Please rephrase it, or ask about a specific figure such as revenue, receivables or pipeline.',
          toolCalls: summarize(executions),
          sources: [],
          dataMode: options.dataset.mode,
          model,
          inputTokens,
          outputTokens,
          latencyMs: Date.now() - started,
          error: 'The request was declined by a safety classifier.',
        }
      }

      const toolUses = response.content.filter(
        (block): block is Anthropic.Beta.BetaToolUseBlock => block.type === 'tool_use',
      )

      if (response.stop_reason !== 'tool_use' || toolUses.length === 0) {
        answer = response.content
          .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === 'text')
          .map((block) => block.text)
          .join('\n')
          .trim()
        break
      }

      messages.push({ role: 'assistant', content: response.content })

      const toolResults: Anthropic.Beta.BetaToolResultBlockParam[] = []
      for (const toolUse of toolUses) {
        const execution = executeTool(toolUse.name, toolUse.input, toolContext)
        executions.push(execution)

        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          is_error: !execution.result.ok,
          content: JSON.stringify(
            execution.result.ok
              ? { data: execution.result.data, sources: execution.result.sources }
              : { refused: true, reason: execution.result.refusal },
          ),
        })
      }

      // Every tool result goes back in ONE user message, which is what keeps
      // parallel tool use working on later turns.
      messages.push({ role: 'user', content: toolResults })
    }

    if (!answer) {
      answer =
        'I could not complete that question within the allowed number of steps. Try asking about one figure at a time.'
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error.'
    return {
      answer:
        'The assistant is unavailable right now, so I cannot answer that question. The dashboards still show live figures.',
      toolCalls: summarize(executions),
      sources: [],
      dataMode: options.dataset.mode,
      model,
      inputTokens,
      outputTokens,
      latencyMs: Date.now() - started,
      error: message,
    }
  }

  // Deduplicate the provenance collected across every tool that ran.
  const sources: ToolSource[] = []
  const seen = new Set<string>()
  for (const execution of executions) {
    for (const source of execution.result.sources) {
      const key = `${source.system}|${source.period ?? ''}|${source.note ?? ''}`
      if (seen.has(key)) continue
      seen.add(key)
      sources.push(source)
    }
  }

  return {
    answer,
    toolCalls: summarize(executions),
    sources,
    dataMode: options.dataset.mode,
    model,
    inputTokens,
    outputTokens,
    latencyMs: Date.now() - started,
  }
}

function summarize(executions: ToolExecution[]): AssistantAnswer['toolCalls'] {
  return executions.map((execution) => ({
    name: execution.name,
    input: execution.input,
    ok: execution.result.ok,
    refusal: execution.result.refusal,
    durationMs: execution.durationMs,
  }))
}

/**
 * Persists the exchange for audit.
 *
 * Every question, the tools that ran with their validated parameters, the
 * sources cited and the token usage are recorded, so any answer the business
 * acted on can be reconstructed later.
 */
export async function recordExchange(options: {
  userId: string
  isDemo: boolean
  conversationId: string | null
  question: string
  answer: AssistantAnswer
}): Promise<string | null> {
  if (options.isDemo) return null
  if (!(await databaseReachable())) return null

  try {
    const conversationId =
      options.conversationId ??
      (
        await db.one<{ id: string }>(sql`
          INSERT INTO "AiConversation" ("userId", "title")
          VALUES (${options.userId}, ${options.question.slice(0, 120)})
          RETURNING "id"`)
      ).id

    await insert('AiMessage', { conversationId, role: 'user', content: options.question })

    await insert('AiMessage', {
      conversationId,
      role: 'assistant',
      content: options.answer.answer,
      // JSONB columns holding arrays must be marked explicitly.
      toolCalls: json(options.answer.toolCalls),
      sources: json(options.answer.sources),
      dataMode: options.answer.dataMode,
      inputTokens: options.answer.inputTokens,
      outputTokens: options.answer.outputTokens,
      latencyMs: options.answer.latencyMs,
      model: options.answer.model,
      refusalReason: options.answer.error ?? null,
    })

    await db.exec(sql`UPDATE "AiConversation" SET "updatedAt" = ${new Date()} WHERE "id" = ${conversationId}`)

    return conversationId
  } catch (error) {
    console.error('[ai] failed to record the exchange', error)
    return null
  }
}
