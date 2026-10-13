import { Router } from 'express'
import { z } from 'zod'
import { PERMISSIONS } from '@shared/permissions'
import { buildAccessScope, currentUser, requireAuth } from '../lib/auth/guards'
import { loadDataset, loadSettings } from '../lib/data/dataset'
import { ask, assistantConfigured, recordExchange } from '../lib/ai/assistant'
import { AUDIT_ACTIONS, recordAudit } from '../lib/auth/audit'
import { handler } from '../lib/http/errors'

export const askRouter = Router()

/**
 * Ask MetroLED endpoint: POST /api/ask
 *
 * Authorisation happens here before anything else, and the access scope built
 * from the session is what the tool layer enforces against. A request that
 * reaches this handler without AI_USE never gets a dataset loaded.
 */

const bodySchema = z.object({
  question: z.string().trim().min(3, 'Ask a question of at least three characters.').max(1000),
  conversationId: z.string().optional().nullable(),
  history: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(10_000) }))
    .max(10)
    .optional(),
})

askRouter.post(
  '/',
  requireAuth(PERMISSIONS.AI_USE),
  handler(async (req, res) => {
    if (!assistantConfigured()) {
      res.status(503).json({
        error: 'NOT_CONFIGURED',
        message:
          'The AI assistant is not configured on this deployment. An administrator needs to set ANTHROPIC_API_KEY. The dashboards still show live figures.',
      })
      return undefined
    }

    // A missing body is "could not be read", as `request.json()` failing was.
    const parsedBody = req.body === undefined ? null : bodySchema.safeParse(req.body)
    if (!parsedBody?.success) {
      const message = parsedBody?.error.issues[0]?.message ?? 'That question could not be read.'
      res.status(400).json({ error: 'INVALID_REQUEST', message })
      return undefined
    }
    const parsed = parsedBody.data

    const user = currentUser(res)
    const scope = buildAccessScope(user)
    const settings = await loadSettings()
    const now = new Date()

    // 24 months so questions about last year can be answered.
    const dataset = await loadDataset(scope, { now, months: 24 })

    const answer = await ask({
      user,
      scope,
      dataset,
      settings: {
        staleQuoteDays: settings.staleQuoteDays,
        largeQuoteAmount: settings.largeQuoteAmount,
        timezone: settings.timezone,
      },
      question: parsed.question,
      history: parsed.history,
      now,
    })

    const conversationId = await recordExchange({
      userId: user.id,
      isDemo: user.isDemo,
      conversationId: parsed.conversationId ?? null,
      question: parsed.question,
      answer,
    })

    await recordAudit({
      action: AUDIT_ACTIONS.AI_QUERY,
      summary: `${user.name} asked: "${parsed.question.slice(0, 160)}"`,
      actor: user,
      entityType: 'AiConversation',
      entityId: conversationId ?? undefined,
      metadata: {
        tools: answer.toolCalls.map((t) => ({ name: t.name, ok: t.ok })),
        dataMode: answer.dataMode,
        model: answer.model,
        latencyMs: answer.latencyMs,
      },
    })

    return {
      ok: true,
      conversationId,
      answer: answer.answer,
      sources: answer.sources,
      toolCalls: answer.toolCalls.map((t) => ({ name: t.name, ok: t.ok, refusal: t.refusal })),
      dataMode: answer.dataMode,
      error: answer.error,
    }
  }),
)
