import '../src/load-env'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { closePool, db, sql, transaction } from '../src/lib/db'

/**
 * Minimal SQL migration runner (replaces `prisma migrate deploy`).
 *
 * Applies every db/migrations/NNN_name.sql not yet recorded in
 * `schema_migrations`, in filename order, each in its own transaction.
 *
 * Baseline: a database created earlier by Prisma already contains the 001
 * schema. If `_prisma_migrations` shows the init migration (or the "User"
 * table exists), 001 is recorded as applied without being run.
 *
 *   npm run db:migrate            apply pending migrations
 *   npm run db:migrate -- --status   list applied / pending
 */

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations')

async function main() {
  await db.exec(sql`
    CREATE TABLE IF NOT EXISTS "schema_migrations" (
      "name" TEXT PRIMARY KEY,
      "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`)

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d+_.+\.sql$/.test(f))
    .sort()

  const applied = new Set(
    (await db.many<{ name: string }>(sql`SELECT "name" FROM "schema_migrations"`)).map((r) => r.name),
  )

  const init = files[0]
  if (init && !applied.has(init)) {
    const hasUserTable = await db.value<boolean>(sql`SELECT to_regclass('public."User"') IS NOT NULL`)
    if (hasUserTable) {
      await db.exec(sql`INSERT INTO "schema_migrations" ("name") VALUES (${init})`)
      applied.add(init)
      console.log(`[migrate] baseline: ${init} already present (created by Prisma), recorded as applied`)
    }
  }

  const pending = files.filter((f) => !applied.has(f))

  if (process.argv.includes('--status')) {
    for (const f of files) console.log(`${applied.has(f) ? 'applied ' : 'pending '} ${f}`)
    return
  }

  if (pending.length === 0) {
    console.log('[migrate] database is up to date')
    return
  }

  for (const file of pending) {
    const text = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8')
    await transaction(async (tx) => {
      await tx.exec(sql.raw(text))
      await tx.exec(sql`INSERT INTO "schema_migrations" ("name") VALUES (${file})`)
    })
    console.log(`[migrate] applied ${file}`)
  }
}

main()
  .catch((error) => {
    console.error('[migrate] failed:', error)
    process.exitCode = 1
  })
  .finally(() => closePool())
