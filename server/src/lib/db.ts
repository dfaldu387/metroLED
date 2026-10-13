import pg from 'pg'
import { env } from './env'

/**
 * PostgreSQL access through node-postgres (`pg`).
 *
 * Queries are written as SQL with the `sql` tagged template, which turns every
 * interpolated value into a bind parameter - nothing user-supplied is ever
 * concatenated into SQL text:
 *
 *   const user = await db.maybeOne<UserRow>(sql`SELECT * FROM "User" WHERE "email" = ${email}`)
 *
 * Table and column names keep the quoted camelCase names of the original
 * schema (`"User"."passwordHash"`), so rows come back with the same property
 * names the rest of the code already uses. `id` and `updatedAt` columns are
 * filled by database defaults (see db/migrations/002_defaults.sql).
 */

// ---------------------------------------------------------------------------
// Type parsing
// ---------------------------------------------------------------------------

// TIMESTAMP(3) columns hold UTC wall-clock time. pg would otherwise read them
// as server-local time, and write JS Dates in local time.
pg.types.setTypeParser(1114, (v) => new Date(v.replace(' ', 'T') + 'Z'))
pg.types.setTypeParser(1082, (v) => new Date(`${v}T00:00:00.000Z`)) // DATE
pg.types.setTypeParser(20, (v) => Number(v)) // BIGINT, e.g. COUNT(*)
// NUMERIC stays a string so no cent is lost; convert with `toNumber`.
pg.defaults.parseInputDatesAsUTC = true

// ---------------------------------------------------------------------------
// SQL builder
// ---------------------------------------------------------------------------

const SQL = Symbol('sql')

export interface SqlFragment {
  readonly [SQL]: true
  readonly strings: readonly string[]
  readonly values: readonly unknown[]
}

function isFragment(v: unknown): v is SqlFragment {
  return typeof v === 'object' && v !== null && (v as SqlFragment)[SQL] === true
}

function fragment(strings: readonly string[], values: readonly unknown[]): SqlFragment {
  return { [SQL]: true, strings, values }
}

/** Tagged template: values become $n parameters; nested `sql` fragments are inlined. */
export function sql(strings: TemplateStringsArray, ...values: unknown[]): SqlFragment {
  return fragment(strings, values)
}

/** Trusted SQL text (identifiers, keywords). NEVER pass user input. */
sql.raw = (text: string): SqlFragment => fragment([text], [])

/** Quoted identifier, e.g. sql.id('User') -> "User", sql.id('u', 'email') -> "u"."email". */
sql.id = (...parts: string[]): SqlFragment =>
  sql.raw(parts.map((p) => `"${p.replace(/"/g, '""')}"`).join('.'))

/** Joins fragments/values with a separator: sql.join([sql`a`, sql`b`], sql`, `). */
sql.join = (items: readonly unknown[], separator: SqlFragment = sql`, `): SqlFragment => {
  if (items.length === 0) return sql.raw('')
  const strings: string[] = ['']
  const values: unknown[] = []
  items.forEach((item, i) => {
    if (i > 0) {
      values.push(separator)
      strings.push('')
    }
    values.push(item)
    strings.push('')
  })
  return fragment(strings, values)
}

/** Empty fragment, handy for optional clauses: ${cond ? sql`AND x = ${y}` : sql.empty}. */
sql.empty = fragment([''], [])

/** AND-joins non-null conditions into a WHERE clause (or nothing). */
sql.where = (conditions: (SqlFragment | null | undefined | false)[]): SqlFragment => {
  const present = conditions.filter(isFragment)
  return present.length === 0 ? sql.empty : sql`WHERE ${sql.join(present, sql` AND `)}`
}

export interface CompiledQuery {
  text: string
  values: unknown[]
}

export function compile(query: SqlFragment): CompiledQuery {
  const values: unknown[] = []
  const walk = (f: SqlFragment): string => {
    let text = f.strings[0] ?? ''
    for (let i = 0; i < f.values.length; i++) {
      const v = f.values[i]
      if (isFragment(v)) {
        text += walk(v)
      } else {
        values.push(normaliseParam(v))
        text += `$${values.length}`
      }
      text += f.strings[i + 1] ?? ''
    }
    return text
  }
  return { text: walk(query), values }
}

/**
 * Plain objects (JSON columns) are serialised explicitly; arrays are passed
 * through as Postgres arrays (use `${ids}::text[]` / `= ANY(${ids})`).
 * For a JSONB column holding an array, pass `json(value)`.
 */
function normaliseParam(v: unknown): unknown {
  if (v === undefined) return null
  if (v instanceof JsonParam) return JSON.stringify(v.value)
  if (v !== null && typeof v === 'object' && !(v instanceof Date) && !Array.isArray(v) && !Buffer.isBuffer(v)) {
    return JSON.stringify(v)
  }
  return v
}

class JsonParam {
  constructor(readonly value: unknown) {}
}

/** Marks a value for a JSON/JSONB column (needed for arrays; objects are detected automatically). */
export function json(value: unknown): JsonParam | null {
  return value === null || value === undefined ? null : new JsonParam(value)
}

// ---------------------------------------------------------------------------
// Pool, query helpers, transactions
// ---------------------------------------------------------------------------

const globalForDb = globalThis as unknown as {
  pgPool: pg.Pool | undefined
  dbProbe: { checkedAt: number; reachable: boolean } | undefined
}

function connectionString(): string | undefined {
  const url = env().DATABASE_URL
  if (!url) return undefined
  // `?schema=public` was a Prisma-specific parameter; pg does not understand it.
  try {
    const parsed = new URL(url)
    parsed.searchParams.delete('schema')
    return parsed.toString()
  } catch {
    return url
  }
}

export function pool(): pg.Pool {
  if (!globalForDb.pgPool) {
    globalForDb.pgPool = new pg.Pool({
      connectionString: connectionString(),
      // Columns are TIMESTAMP WITHOUT TIME ZONE holding UTC. Pin the session
      // zone so database defaults (CURRENT_TIMESTAMP, now()) are UTC too,
      // whatever the server's local zone is.
      options: '-c TimeZone=UTC',
      max: Number(process.env.DATABASE_POOL_MAX ?? 10),
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
    })
    globalForDb.pgPool.on('error', (error) => console.error('[db] idle client error', error))
  }
  return globalForDb.pgPool
}

export async function closePool(): Promise<void> {
  const p = globalForDb.pgPool
  globalForDb.pgPool = undefined
  if (p) await p.end()
}

type Row = Record<string, unknown>

export interface Queryable {
  /** All rows. */
  many<T = Row>(query: SqlFragment): Promise<T[]>
  /** Exactly one row; throws if none. */
  one<T = Row>(query: SqlFragment): Promise<T>
  /** First row or null. */
  maybeOne<T = Row>(query: SqlFragment): Promise<T | null>
  /** Executes and returns the affected row count. */
  exec(query: SqlFragment): Promise<number>
  /** Single scalar value from the first column of the first row. */
  value<T = unknown>(query: SqlFragment): Promise<T | null>
}

function makeQueryable(run: (q: CompiledQuery) => Promise<pg.QueryResult>): Queryable {
  return {
    async many<T>(query: SqlFragment) {
      return (await run(compile(query))).rows as T[]
    },
    async one<T>(query: SqlFragment) {
      const rows = (await run(compile(query))).rows
      if (rows.length === 0) throw new NotFoundError('Expected one row, found none.')
      return rows[0] as T
    },
    async maybeOne<T>(query: SqlFragment) {
      return ((await run(compile(query))).rows[0] as T | undefined) ?? null
    },
    async exec(query: SqlFragment) {
      return (await run(compile(query))).rowCount ?? 0
    },
    async value<T>(query: SqlFragment) {
      const result = await run(compile(query))
      const row = result.rows[0] as Row | undefined
      if (!row) return null
      const first = result.fields[0]?.name
      return (first ? row[first] : null) as T | null
    },
  }
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NotFoundError'
  }
}

/** Pool-backed queries. Use `transaction` for multi-statement atomic work. */
export const db: Queryable = makeQueryable((q) => pool().query(q.text, q.values))

/**
 * Runs `work` inside BEGIN/COMMIT on one connection; rolls back on throw.
 * Pass the provided `tx` to every query that must be part of the transaction.
 */
export async function transaction<T>(work: (tx: Queryable) => Promise<T>): Promise<T> {
  const client = await pool().connect()
  try {
    await client.query('BEGIN')
    const result = await work(makeQueryable((q) => client.query(q.text, q.values)))
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}

// ---------------------------------------------------------------------------
// CRUD helpers (column names are trusted keys from code, never user input)
// ---------------------------------------------------------------------------

function columns(data: Row): string[] {
  return Object.keys(data).filter((k) => data[k] !== undefined)
}

/** INSERT ... RETURNING *. Omit `id`/`updatedAt`/`createdAt` to use database defaults. */
export async function insert<T = Row>(table: string, data: Row, q: Queryable = db): Promise<T> {
  const cols = columns(data)
  return q.one<T>(sql`
    INSERT INTO ${sql.id(table)} (${sql.join(cols.map((c) => sql.id(c)))})
    VALUES (${sql.join(cols.map((c) => data[c]))})
    RETURNING *`)
}

/** Multi-row INSERT; every row must have the same keys. Returns the inserted count. */
export async function insertMany(table: string, rows: Row[], q: Queryable = db): Promise<number> {
  if (rows.length === 0) return 0
  const cols = columns(rows[0]!)
  return q.exec(sql`
    INSERT INTO ${sql.id(table)} (${sql.join(cols.map((c) => sql.id(c)))})
    VALUES ${sql.join(rows.map((r) => sql`(${sql.join(cols.map((c) => r[c]))})`))}`)
}

/** UPDATE ... SET data WHERE id = $id RETURNING * (null if no such row). */
export async function updateById<T = Row>(table: string, id: string, data: Row, q: Queryable = db): Promise<T | null> {
  const cols = columns(data)
  if (cols.length === 0) return q.maybeOne<T>(sql`SELECT * FROM ${sql.id(table)} WHERE "id" = ${id}`)
  return q.maybeOne<T>(sql`
    UPDATE ${sql.id(table)} SET ${sql.join(cols.map((c) => sql`${sql.id(c)} = ${data[c]}`))}
    WHERE "id" = ${id}
    RETURNING *`)
}

/**
 * INSERT ... ON CONFLICT (conflictColumns) DO UPDATE SET update RETURNING *.
 * The Prisma `upsert` equivalent. `update` defaults to every non-key column of `create`.
 */
export async function upsert<T = Row>(
  table: string,
  conflictColumns: string[],
  create: Row,
  update?: Row,
  q: Queryable = db,
): Promise<T> {
  const cols = columns(create)
  const upd = update ?? Object.fromEntries(cols.filter((c) => !conflictColumns.includes(c)).map((c) => [c, create[c]]))
  const updCols = columns(upd)
  const action =
    updCols.length === 0
      ? sql`DO UPDATE SET ${sql.id(conflictColumns[0]!)} = EXCLUDED.${sql.id(conflictColumns[0]!)}`
      : sql`DO UPDATE SET ${sql.join(updCols.map((c) => sql`${sql.id(c)} = ${upd[c]}`))}`
  return q.one<T>(sql`
    INSERT INTO ${sql.id(table)} (${sql.join(cols.map((c) => sql.id(c)))})
    VALUES (${sql.join(cols.map((c) => create[c]))})
    ON CONFLICT (${sql.join(conflictColumns.map((c) => sql.id(c)))}) ${action}
    RETURNING *`)
}

// ---------------------------------------------------------------------------
// Connectivity probe and numeric conversion (unchanged behaviour)
// ---------------------------------------------------------------------------

/**
 * How long a probe result is trusted.
 *
 * A success is re-checked often, because a database that goes down should be
 * noticed quickly. A FAILURE is cached for longer: a database that is down
 * stays down for more than a few seconds, and re-attempting the connection on
 * practically every request adds its full timeout to every page load for no
 * benefit. `force` bypasses both, which is what the manual retry paths use.
 */
const PROBE_TTL_OK_MS = 15_000
const PROBE_TTL_FAILED_MS = 60_000

/**
 * Cheap connectivity probe, cached.
 *
 * The result decides whether the application serves live figures or falls back
 * to the labelled demo dataset, so it must never throw and must not add a
 * round trip to every query.
 */
export async function databaseReachable(force = false): Promise<boolean> {
  if (!env().DATABASE_URL) return false

  const cachedProbe = globalForDb.dbProbe
  const now = Date.now()
  if (!force && cachedProbe) {
    const ttl = cachedProbe.reachable ? PROBE_TTL_OK_MS : PROBE_TTL_FAILED_MS
    if (now - cachedProbe.checkedAt < ttl) return cachedProbe.reachable
  }

  let reachable = false
  try {
    await db.value(sql`SELECT 1`)
    reachable = true
  } catch {
    reachable = false
  }

  globalForDb.dbProbe = { checkedAt: now, reachable }
  return reachable
}

/** Invalidate the cached connectivity probe (after a migration, for example). */
export function resetDatabaseProbe(): void {
  globalForDb.dbProbe = undefined
}

/**
 * Converts a NUMERIC value (returned by pg as a string) or null to a number.
 *
 * NUMERIC is used for storage so no cent is lost to binary floating point.
 * Aggregation and presentation happen in `number`, which is exact for every
 * value this business will ever report (well under 2^53 cents).
 */
export function toNumber(value: { toString(): string } | null | undefined): number {
  if (value === null || value === undefined) return 0
  const n = Number(value.toString())
  return Number.isFinite(n) ? n : 0
}

export function toNullableNumber(value: { toString(): string } | null | undefined): number | null {
  if (value === null || value === undefined) return null
  const n = Number(value.toString())
  return Number.isFinite(n) ? n : null
}
