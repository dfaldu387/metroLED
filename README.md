# MetroLED Intelligence

Business intelligence for MetroLED. It consolidates QuickBooks Online, Method CRM
and Shopify into one PostgreSQL database and reports revenue, accounts
receivable, sales pipeline, e-commerce performance and gross margin for three
divisions: **MetroLED** (lighting and signage), **Pixel LED Displays** (LED
display systems) and **Eco LED Mart** (the Shopify store).

It is **read-only** with respect to the source systems. Nothing is ever written
back to QuickBooks, Method CRM or Shopify.

---

## Stack

**React (Vite) client + Node (Express) API + PostgreSQL.** No Next.js, no Prisma.

| Directory | What it is |
|---|---|
| `client/` | Vite + React 19 + React Router 7 + TanStack Query (the UI) |
| `server/` | Express 5 + node-postgres (`pg`), plain SQL (the API, background worker, jobs) |
| `shared/` | Pure TypeScript used by both sides: types, permissions, formatting, API contracts |

In development the Vite dev server runs the UI on **http://localhost:3000** and
proxies `/api` to the Express API on **:4000**, so the browser only ever talks to
one origin (the session cookie stays `SameSite=Lax`, no CORS). In production one
Node process serves the built client *and* the API on a single `PORT`.

---

## Quick start

```bash
# 1. Install client/ and server/ dependencies
npm run install:all

# 2. Configure
cp .env.example .env
#    Then generate the two secrets the application needs:
node -e "console.log('SESSION_SECRET='+require('crypto').randomBytes(48).toString('base64'))"
node -e "console.log('CREDENTIAL_ENCRYPTION_KEY='+require('crypto').randomBytes(32).toString('base64'))"

# 3. Database (PostgreSQL 14 or newer)
npm run db:migrate     # apply server/db/migrations/*.sql
npm run db:seed        # roles, divisions, metric definitions, first owner

# 4. Run everything (client + API together)
npm run dev            # client http://localhost:3000, API http://localhost:4000
npm run worker         # background jobs, in a second terminal (optional)
```

Open **http://localhost:3000**.

> **Port note:** the client binds `:3000` with `strictPort`, so free that port
> first (`npm run dev` will fail fast if something else holds it). The API uses
> `PORT` (default `4000`). `APP_URL` in `.env` must match the URL you open
> (`http://localhost:3000` in development) — OAuth redirect URIs and daily-brief
> email links are built from it.

### Reviewing the interface without a database

If `DATABASE_URL` is unset or unreachable **and** `ALLOW_DEMO_DATA=true`, the
application serves a generated demo dataset so the whole interface can be
reviewed before the integrations are live. Sign in with **Continue with demo
data** and pick a role to preview.

Demo mode is impossible in production: `APP_ENV=production` disables it
regardless of `ALLOW_DEMO_DATA`. Every screen served from it carries a
permanent banner, and the AI assistant states in each answer that it queried
the demo dataset.

---

## Commands

All commands are run from the repository root.

| Command | What it does |
|---|---|
| `npm run dev` | Run the client (`:3000`) and the API (`:4000`) together |
| `npm run dev:api` / `npm run dev:web` | Run just the API or just the client |
| `npm run build` | Production build: the Vite client, then the esbuild server bundle |
| `npm start` | Production: one Node process serving the built client + API on `PORT` |
| `npm run install:all` | Install `server/` and `client/` dependencies |
| `npm run db:migrate` | Apply `server/db/migrations/*.sql` |
| `npm run db:status` | Show which migrations have been applied |
| `npm run db:seed` | Seed reference data and the first owner |
| `npm run worker` | Background job worker (syncs, daily brief) |
| `npm run sync` | Run a synchronisation from the command line |
| `npm run brief` | Generate and send the daily brief now |
| `npm test` | Unit tests (vitest, in `server/`) |
| `npm run typecheck` | TypeScript (no emit) for both `server/` and `client/` |

---

## Architecture

```
client/                 Vite + React 19 SPA
  src/
    pages/<route>/       One page per route (overview, revenue, ask, settings/*, …)
    components/          ui/ primitives, layout/ shell, charts/, metrics/
    lib/                 navigation, query, api client, session
server/                 Express 5 + node-postgres API
  src/
    routes/              One router per area; mounted in src/app.ts
    lib/
      analytics/         PURE figure calculations - the financial core
      ai/                Approved query tools and the assistant loop
      auth/              Sessions, permissions, guards, audit
      brief/             Daily brief generation, rendering, delivery
      data/              Loads a scoped dataset (live or demo)
      integrations/      Provider adapters, matching, sync orchestration
      jobs/              PostgreSQL-backed queue and handlers
      db.ts, db-rows.ts  SQL tag, query helpers, row types
  db/migrations/         NNN_name.sql, applied by db/migrate.ts
  scripts/               worker, run-sync, send-daily-brief
  tests/unit/            Vitest: calculations, permissions, integrations, brief
shared/src/              Types, permissions, navigation, format, palette, API contracts
```

### Three decisions worth knowing

**1. The figure calculations are pure functions.**
Everything in `server/src/lib/analytics` takes plain records and returns numbers.
The live database and the demo dataset are both projected into the same record
types, so the two can never drift apart, and every financial rule is directly
unit-testable without a database.

**2. Permission is enforced in the query layer, not the view.**
`buildAccessScope()` turns a session into a scope, and the scope is applied in
the database query. Hiding a navigation item is presentation only; each page's
`GET /api/pages/<route>` endpoint re-checks its own permission. The AI assistant
goes through the same layer: its tools check permission *before* producing a
figure, so the model is never relied upon to withhold data.

**3. A figure that cannot be supported is reported as unavailable, not as
zero.** Gross margin with an unapproved cost basis, average order value with no
orders, win rate with no decided quotes, DSO with no revenue — all return
"not available" with the reason, rather than a number that looks real.

---

## Data flow

```
QuickBooks ─┐
Method CRM ─┼─► adapter ─► normalise ─► match customer ─► map division ─┐
Shopify ────┘      ▲                                                     │
                   │                                                     ▼
            retry + backoff                                      PostgreSQL
            rate limiting                                              │
            resumable checkpoint                                       ▼
                                                        pure analytics functions
                                                                       │
                                        ┌──────────────┬───────────────┤
                                        ▼              ▼               ▼
                                   dashboards     daily brief    AI assistant
```

Shopify also pushes order webhooks for near-real-time updates. Each delivery is
signature-verified against the raw body, stored before processing, and keyed so
a duplicate delivery is a no-op.

---

## Testing

```bash
npm test                 # server unit tests (vitest): calculations, permissions, integrations, brief
```

The unit tests are pure and need no database or provider credentials.

---

## Documentation

| Document | What it covers |
|---|---|
| [`docs/user-guide.md`](docs/user-guide.md) | How to use each screen |
| [`docs/admin-guide.md`](docs/admin-guide.md) | Users, roles, integrations, metric approvals |
| [`docs/runbook.md`](docs/runbook.md) | Deployment and day-to-day operations |
| [`docs/client-decisions.md`](docs/client-decisions.md) | **Open items requiring client approval** |
| [`docs/metrics.md`](docs/metrics.md) | Every formula, its source and its date basis |
| [`docs/migration-conventions.md`](docs/migration-conventions.md) | History of the Next.js + Prisma → React + Express port |

---

## Status

No integration is live. The adapters are written against the documented APIs
but have not been run against MetroLED's accounts, because no credentials have
been supplied. Nothing in this repository claims otherwise.

**Requires client input before go-live** — see
[`docs/client-decisions.md`](docs/client-decisions.md). The main items are API
credentials, confirmation of the division mapping rules against the real
QuickBooks classes and Method CRM fields, Finance approval of the metric
definitions, the final permissions matrix, and the daily brief recipients and
send time.
