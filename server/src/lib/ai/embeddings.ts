import { env } from '../env'

/**
 * Text embeddings via Voyage AI (Anthropic's recommended embeddings partner).
 *
 * Anthropic does not provide an embeddings endpoint, so retrieval for Ask
 * MetroLED is embedded with Voyage. The same model must be used to index the
 * corpus and to embed a query, or the vectors are not comparable — re-run
 * `npm run ai:index` after changing VOYAGE_MODEL.
 */

const VOYAGE_URL = 'https://api.voyageai.com/v1/embeddings'

export function embeddingsConfigured(): boolean {
  return Boolean(env().VOYAGE_API_KEY)
}

export function embeddingModel(): string {
  return env().VOYAGE_MODEL
}

interface VoyageEmbeddingResponse {
  data: { embedding: number[]; index: number }[]
  model: string
  usage?: { total_tokens: number }
}

/**
 * Embed a batch of texts. `inputType` is 'document' when indexing the corpus
 * and 'query' when embedding a search query; Voyage uses it to improve
 * retrieval. Returns one vector per input, in the same order as `texts`.
 */
export async function embed(texts: string[], inputType: 'document' | 'query'): Promise<number[][]> {
  const apiKey = env().VOYAGE_API_KEY
  if (!apiKey) {
    throw new Error('VOYAGE_API_KEY is not configured, so embeddings cannot be produced.')
  }
  if (texts.length === 0) return []

  const model = env().VOYAGE_MODEL
  const out: number[][] = []

  // Voyage accepts many inputs per request; stay comfortably under the limit.
  const BATCH = 96
  for (let i = 0; i < texts.length; i += BATCH) {
    const batch = texts.slice(i, i + BATCH)
    const response = await fetch(VOYAGE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ input: batch, model, input_type: inputType }),
    })

    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new Error(
        `Voyage embeddings request failed (HTTP ${response.status}).${detail ? ` ${detail.slice(0, 300)}` : ''}`,
      )
    }

    const body = (await response.json()) as VoyageEmbeddingResponse
    // The API returns results tagged with their index; order defensively.
    for (const item of [...body.data].sort((a, b) => a.index - b.index)) {
      out.push(item.embedding)
    }
  }

  return out
}

/** Cosine similarity between two vectors. Returns 0 if either has no magnitude. */
export function cosineSimilarity(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length)
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < n; i++) {
    const x = a[i]!
    const y = b[i]!
    dot += x * y
    normA += x * x
    normB += y * y
  }
  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}
