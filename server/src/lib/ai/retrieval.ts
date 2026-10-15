import { db, sql, databaseReachable } from '../db'
import { cosineSimilarity, embed, embeddingsConfigured } from './embeddings'

/**
 * Retrieval over the indexed knowledge base (RAG) for Ask MetroLED.
 *
 * The query is embedded with the same model that indexed the corpus and ranked
 * against every stored chunk by cosine similarity. The corpus is small, so the
 * ranking runs in the application rather than in the database. Only text is
 * ever returned to the model — never a business figure; figures come from the
 * approved data tools.
 */

export interface KnowledgePassage {
  docId: string
  title: string
  section: string
  content: string
  similarity: number
}

export interface KnowledgeSearchResult {
  ok: boolean
  passages: KnowledgePassage[]
  /** Explanation when nothing is returned (not configured, empty, no match). */
  note?: string
}

interface KnowledgeChunkRow {
  docId: string
  title: string
  section: string
  content: string
  embedding: number[]
}

/** Whether retrieval can run at all (an embeddings key is present). */
export function knowledgeConfigured(): boolean {
  return embeddingsConfigured()
}

/** Minimum similarity for a passage to be considered relevant. */
const MIN_SIMILARITY = 0.3

export async function searchKnowledge(query: string, limit = 5): Promise<KnowledgeSearchResult> {
  if (!embeddingsConfigured()) {
    return {
      ok: false,
      passages: [],
      note: 'The knowledge base is not configured (no embeddings key is set), so documentation cannot be searched.',
    }
  }
  if (!(await databaseReachable())) {
    return { ok: false, passages: [], note: 'The database is not reachable, so documentation cannot be searched.' }
  }

  try {
    const rows = await db.many<KnowledgeChunkRow>(sql`
      SELECT "docId", "title", "section", "content", "embedding" FROM "KnowledgeChunk"`)
    if (rows.length === 0) {
      return {
        ok: false,
        passages: [],
        note: 'No documentation has been indexed yet. An administrator can run "npm run ai:index".',
      }
    }

    const [queryVector] = await embed([query], 'query')
    if (!queryVector) {
      return { ok: false, passages: [], note: 'The question could not be embedded for search.' }
    }

    const ranked = rows
      .map((row) => ({
        docId: row.docId,
        title: row.title,
        section: row.section,
        content: row.content,
        similarity: cosineSimilarity(queryVector, row.embedding),
      }))
      .sort((a, b) => b.similarity - a.similarity)
      .filter((passage) => passage.similarity >= MIN_SIMILARITY)
      .slice(0, limit)

    if (ranked.length === 0) {
      return { ok: true, passages: [], note: 'No documentation passage closely matched that question.' }
    }

    return { ok: true, passages: ranked }
  } catch (error) {
    // A missing table (migration not applied) or an embeddings-API failure must
    // not sink the whole answer — the agent can still answer figure questions.
    const detail = error instanceof Error ? error.message : 'unknown error'
    return { ok: false, passages: [], note: `The knowledge base could not be searched (${detail}).` }
  }
}
