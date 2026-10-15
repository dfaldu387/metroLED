import type Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { searchKnowledge } from './retrieval'
import type { ToolExecution, ToolResult } from './tools'

/**
 * The retrieval tool (RAG) for Ask MetroLED.
 *
 * Unlike the data tools in `tools.ts`, which are pure and synchronous, this one
 * does I/O (embeds the query and reads the knowledge base), so the assistant
 * runs it on its own async path and builds the same `ToolExecution` shape the
 * data tools produce. It only ever returns documentation text — never a
 * business figure.
 */

export const KNOWLEDGE_TOOL_NAME = 'search_knowledge'

const inputSchema = z.object({
  query: z.string().min(3).max(500),
})

export function knowledgeToolDefinition(): Anthropic.Tool {
  return {
    name: KNOWLEDGE_TOOL_NAME,
    description:
      "Search MetroLED's internal documentation and canonical metric definitions for explanations, definitions, methodology and policy — for example how a figure is defined or calculated, what a term means, how division mapping works, or operational policy. Use this to EXPLAIN; never to obtain a business figure (every number comes from the data tools). Returns the most relevant passages with their source document and section so you can cite them.",
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'What to look up, in natural language (a question or a topic).',
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
  }
}

export async function runKnowledgeTool(rawInput: unknown): Promise<ToolExecution> {
  const started = Date.now()

  const parsed = inputSchema.safeParse(rawInput ?? {})
  if (!parsed.success) {
    return {
      name: KNOWLEDGE_TOOL_NAME,
      input: rawInput,
      durationMs: Date.now() - started,
      result: { ok: false, data: {}, sources: [], refusal: 'The documentation search query was not valid.' },
    }
  }

  const search = await searchKnowledge(parsed.data.query)

  let result: ToolResult
  if (!search.ok) {
    result = { ok: false, data: {}, sources: [], refusal: search.note ?? 'The knowledge base could not be searched.' }
  } else if (search.passages.length === 0) {
    result = {
      ok: true,
      data: { passages: [], note: search.note ?? 'No relevant passage was found.' },
      sources: [],
    }
  } else {
    result = {
      ok: true,
      data: {
        passages: search.passages.map((passage) => ({
          document: passage.title,
          section: passage.section,
          content: passage.content,
        })),
      },
      sources: search.passages.map((passage) => ({
        system: 'MetroLED documentation',
        note: passage.section ? `${passage.title} — ${passage.section}` : passage.title,
      })),
    }
  }

  return { name: KNOWLEDGE_TOOL_NAME, input: parsed.data, result, durationMs: Date.now() - started }
}
