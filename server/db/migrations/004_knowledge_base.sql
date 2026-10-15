-- Knowledge base for Ask MetroLED's retrieval (RAG).
--
-- Each row is one chunk of an internal document -- the docs/ guides and the
-- canonical metric definitions -- with its embedding stored as a JSON array of
-- floats. The corpus is small (a few hundred chunks), so cosine similarity is
-- computed in the application and no pgvector extension is required. The
-- ingestion script (npm run ai:index) rebuilds this table from source.
CREATE TABLE IF NOT EXISTS "KnowledgeChunk" (
  "id"             TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "docId"          TEXT NOT NULL,
  "title"          TEXT NOT NULL,
  "section"        TEXT NOT NULL DEFAULT '',
  "ordinal"        INTEGER NOT NULL DEFAULT 0,
  "content"        TEXT NOT NULL,
  "tokensEstimate" INTEGER NOT NULL DEFAULT 0,
  "embedding"      JSONB NOT NULL,
  "embeddingModel" TEXT NOT NULL,
  "contentHash"    TEXT NOT NULL,
  "createdAt"      TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "KnowledgeChunk_docId_idx" ON "KnowledgeChunk" ("docId");
