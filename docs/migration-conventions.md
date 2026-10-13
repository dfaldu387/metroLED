# Migration conventions: Next.js + Prisma → React (Vite) + Express + node-postgres

The original app (`src/`, `prisma/`) is kept read-only as the reference until the migration is signed off.
A backup of the pre-migration tree is at `C:\xampp\htdocs\metroLED_backup_before_pg_migration.zip`.

## Layout

```
shared/src/     Pure TS used by both sides (no npm deps): enums, permissions, navigation, dates, format,
                palette, types, metric-definitions, data-mode, and API contracts in shared/src/api/*.ts
server/         Express 5 + pg API (ESM, run with tsx). Aliases: @/* -> server/src/*, @shared/* -> shared/src/*
  src/lib/      Ported from src/lib (same file names/exports)
  src/routes/   Express routers (one file per area, already mounted in src/app.ts)
  db/migrations NNN_name.sql, applied by `npm run db:migrate` (db/migrate.ts)
  scripts/      worker, run-sync, send-daily-brief
client/         Vite + React 19 + react-router 7 + TanStack Query. Aliases: @/* -> client/src/*, @shared/*
  src/pages/<route>/index.tsx   one default-exported page per former Next.js route
  src/components/               ported from src/components (unchanged except imports)
```

## Database access (server)

- `import { db, sql, transaction, insert, upsert, updateById, insertMany, json, toNumber } from '@/lib/db'`
  (or relative `../db`). Row types: `import type { InvoiceRow, ... } from '@/lib/db-rows'`.
- Write SQL with the `sql` tag. Every `${value}` becomes a bind parameter. Never build SQL text from input.
  - `db.many<T>(sql\`...\`)`, `db.one<T>`, `db.maybeOne<T>`, `db.exec` (returns rowCount), `db.value<T>` (first column).
  - Identifiers are quoted camelCase exactly as in the schema: `SELECT "issuedOn" FROM "Invoice" WHERE "divisionId" = ${id}`.
  - Optional clauses: `${cond ? sql\`AND "x" = ${v}\` : sql.empty}`; `sql.where([cond1, cond2 && sql\`...\`])`; `sql.join(list, sql\`, \`)`.
  - Arrays: `WHERE "id" = ANY(${ids})` (pg sends a JS array as a Postgres array). Empty arrays are fine with ANY.
  - Enums: compare to string literals (`"status" = ${'OPEN'}`); add a cast only when Postgres asks (`${s}::"InvoiceStatus"`).
  - JSONB: objects are serialised automatically; for an array value use `json(arr)`.
- `id` and `updatedAt` have DB defaults (migration 002), and `createdAt` already had one. Omit them on insert.
- NUMERIC comes back as a **string**; `toNumber(row.amount)` as before. COUNT(*) / BIGINT come back as numbers.
- TIMESTAMP / DATE come back as `Date` (UTC). Pass `Date` objects as params. Connections run with TimeZone=UTC.
- Prisma `include` → explicit JOINs, or a second query keyed by `= ANY(${ids})` and stitched in JS (preferred for one-to-many
  to keep row shapes simple). Prisma `_count` → `COUNT(*)` subquery. `upsert` on a unique key → `upsert(table, ['integrationId','sourceId'], create, update)`
  or a hand-written `INSERT ... ON CONFLICT`. `$transaction` → `transaction(async (tx) => { ... tx.exec(...) })`, and pass `tx` into helpers (`insert(table, data, tx)`).
- Where a function used to take a `PrismaClient` (or a tx) parameter, take a `Queryable` (`import type { Queryable } from '@/lib/db'`) instead.
- Keep behaviour identical: same filters, ordering, limits, rounding, same error messages. Keep the comments that explain *why*.
- **Preserve every exported function name, signature and return type** in `server/src/lib/**`. Other people are porting the callers in parallel.

## HTTP (server)

- Routers live in `server/src/routes/*.ts` and are already mounted in `server/src/app.ts`:
  `/api/auth` auth.ts · `/api/pages` pages/analytics.ts + pages/operations.ts · `/api/settings` settings.ts · `/api/users` users.ts ·
  `/api/account` account.ts · `/api/ask` ask.ts · `/api/brief` brief.ts · `/api/sync` sync.ts · `/api/cron` cron.ts ·
  `/api/integrations` integrations.ts · `/api/webhooks` webhooks.ts (raw body: `req.body` is a Buffer).
  Only edit the router files you own; don't touch app.ts.
- `handler(async (req, res) => body)` from `@/lib/http/errors`. Returning a value sends JSON. Throw `HttpError` / `badRequest()` / `notFound()`.
  Zod errors become 400 automatically.
- Auth: `requireAuth(PERMISSIONS.X)` middleware (or `requireAuth(null)` for any signed-in user) then `currentUser(res)`.
  Or call `requirePermission(...)` / `getSession()` directly. Both throw `AuthorizationError`, which becomes a 401 or 403 JSON response.
- `getSession()`, `recordAudit()`, `createSession()` etc. work without passing `req`, because AsyncLocalStorage supplies the request context.
- Page data: `getPageContext(PERMISSIONS.X, '/path', req.query as SearchParams, opts)` works as before.
- A former Server Action becomes a `POST`/`PUT`/`PATCH`/`DELETE` JSON endpoint returning the same `ActionResult`
  (`{ ok, message, secret? }`, from `@shared/api/session`). Expected refusals (validation, demo session, DB down) are
  returned with HTTP 200 and `ok:false`, exactly like the action did; `FormData` fields become JSON body fields.
  `revalidatePath` disappears (the client invalidates its queries).
- Next `NextResponse.redirect(url)` → `res.redirect(303, url)` and return `undefined`.

## Page data contract (server ↔ client)

- Each former server-rendered page gets `GET /api/pages/<route>` that runs **the same server-side code the page ran**
  (permission check, `getPageContext`, analytics builders, Prisma queries now SQL) and returns a JSON **view model**: the
  exact data the JSX needs. Authorisation and scoping stay on the server. Never ship figures the role may not see
  (e.g. margin) and never move scoping logic to the client.
- Put the response type in `shared/src/api/<area>.ts` (e.g. `OverviewPageData`) and import it on both sides.
- JSON has no Date: view-model date fields are ISO strings (`string`). Convert on the client where a component needs a `Date`
  (`new Date(iso)`). Prefer pre-formatting on the server only when the old page formatted on the server with the company timezone.
  Sets → arrays. Maps → objects/arrays. No functions or React nodes.
- Client page: `const query = usePageData<OverviewPageData>('overview')` (from `@/lib/query`). It forwards the current URL
  `?search` and handles 401/403 redirects. Render with
  `<PageQuery query={query} skeleton={<OverviewSkeleton />}>{(data) => ...}</PageQuery>` (from `@/components/layout/page-error`).
  Use the skeleton the old route used (`loading.tsx` or `components/layout/page-skeleton.tsx`).
- Mutations: `useMutation` + `api.post<ActionResult>(...)` (from `@/lib/api`), then `queryClient.invalidateQueries({ queryKey: ['page', '<name>'] })`
  or `refreshAll()` (`@/lib/query`). `useRouter().refresh()` from `@/lib/navigation` also works (it invalidates everything).
- Server Actions used with `useActionState` / `useTransition`: keep the same UX states (pending, inline message) using
  `useMutation`'s `isPending` / result.

## Client conventions

- Replace `next/link` → `import { Link } from '@/lib/navigation'` (same `href` prop), and `next/navigation` hooks
  (`useRouter`, `usePathname`, `useSearchParams`) → `@/lib/navigation` (same API). `redirect()` → `<Navigate to=... replace />`
  from 'react-router' or `useNavigate()`.
- `export const metadata = { title }` → call `useDocumentTitle('Title')` in the page.
- Drop `'use client'` / `'use server'`. Server-only modules must never be imported by the client (`@/lib/db`, `env`, etc.).
  The client may import only `@shared/*` and `client/src/*`.
- The current user: `useCurrentUser()` from `@/lib/session` (`permissions` is an array; use `hasPermission(user, P)`).
- Keep all markup, classes, copy and accessibility attributes identical. This is a port, not a redesign.
- Pure helpers that the old client components imported from `@/lib/...` and that are not in shared yet: move them into
  `shared/src/` if they are pure and needed on both sides. Otherwise put them next to the page under `client/src/pages/<route>/`.

## Verification

- `cd server && npx tsc --noEmit` and `cd client && npx tsc --noEmit` must pass for the files you touched.
- A test database `metroled_pgtest` (a copy of `metroled` with migrations applied) is available. Start the API against it with
  `DATABASE_URL=<.env DATABASE_URL with db name metroled_pgtest> PORT=<your port> npx tsx src/index.ts`.
  Use a port other than 4000/4100 to avoid colliding with others. Never write to the `metroled` database.
