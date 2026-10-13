# MetroLED Intelligence

Business intelligence for MetroLED. It consolidates QuickBooks Online, Method CRM
and Shopify into one PostgreSQL database and reports revenue, accounts
receivable, sales pipeline, e-commerce performance and gross margin for three
divisions: **MetroLED** (lighting and signage), **Pixel LED Displays** (LED
display systems) and **Eco LED Mart** (the Shopify store).

It is **read-only** with respect to the source systems. Nothing is ever written
back to QuickBooks, Method CRM or Shopify.

---

> **Migration in progress: React + Node.js API + PostgreSQL (no Prisma).**
> The app has been ported to `client/` (Vite + React 19 + React Router + TanStack Query),
> `server/` (Express 5 + node-postgres, plain SQL) and `shared/` (types, permissions, formatting).
> The Next.js + Prisma app in `src/` and `prisma/` remains for reference until it is retired.
> Conventions: [docs/migration-conventions.md](docs/migration-conventions.md).
>
> ```bash
> npm run app:install            # install server/ and client/ dependencies
> npm run app:migrate            # apply server/db/migrations/*.sql (an existing Prisma-created DB is detected and baselined)
> npm run app:seed               # idempotent: roles, divisions, owner account
> npm run app:dev:api            # API on http://localhost:4000      (terminal 1)
> npm run app:dev:web            # client on http://localhost:5173   (terminal 2; proxies /api to :4000)
> npm run app:worker             # background jobs                  (optional)
>
> npm run app:build && npm run app:start   # production: one Node process serves API + built client on PORT
> npm run app:test               # unit tests (vitest)
> npm run app:typecheck
> ```
>
> Set `APP_URL=http://localhost:5173` in `.env` for development (OAuth callbacks and email links use it).

## Contents

| Document | What it covers |
|---|---|
| This file | Local development, architecture, commands |
| [`docs/user-guide.md`](docs/user-guide.md) | How to use each screen (written for Ali) |
| [`docs/admin-guide.md`](docs/admin-guide.md) | Users, roles, integrations, metric approvals |
| [`docs/runbook.md`](docs/runbook.md) | Deployment and day-to-day operations |
| [`docs/client-decisions.md`](docs/client-decisions.md) | **Open items requiring client approval** |
| [`docs/metrics.md`](docs/metrics.md) | Every formula, its source and its date basis |

---

## Quick start

```bash
# 1. Install
npm install

# 2. Configure
cp .env.example .env
#    Then generate the two secrets the application needs:
node -e "console.log('SESSION_SECRET='+require('crypto').randomBytes(48).toString('base64'))"
node -e "console.log('CREDENTIAL_ENCRYPTION_KEY='+require('crypto').randomBytes(32).toString('base64'))"

# 3. Database (PostgreSQL 14 or newer)
npm run db:deploy      # apply migrations
npm run db:seed        # roles, divisions, metric definitions, first owner

# 4. Run
npm run dev            # http://localhost:3000
npm run worker         # background jobs, in a second terminal
```

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

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build and server |
| `npm run worker` | Background job worker (syncs, daily brief) |
| `npm run worker -- --schedule` | Enqueue the recurring jobs once and exit |
| `npm run sync` | Run a synchronisation from the command line |
| `npm run brief` | Generate and send the daily brief now |
| `npm run db:migrate` | Create a migration from schema changes |
| `npm run db:deploy` | Apply migrations (use this in deployment) |
| `npm run db:seed` | Seed reference data and the first owner |
| `npm run db:studio` | Browse the database |
| `npm test` | Unit tests |
| `npm run test:e2e` | End-to-end tests (desktop, tablet, iPhone, Android) |
| `npm run typecheck` | TypeScript, no emit |

---

## Architecture

```
src/
  app/
    (app)/            Authenticated pages; the layout holds the nav shell
    api/              Route handlers: auth, ask, sync, brief, webhooks, cron
    sign-in/          Credential and demo sign-in
  components/
    ui/               Design-system primitives (button, card, table, dialog…)
    layout/           Sidebar, mobile drawer, page header, filter rail
    charts/           Recharts wrappers with the validated palette
    metrics/          KPI cards and stat blocks
  lib/
    analytics/        PURE figure calculations - the financial core
    ai/               Approved query tools and the assistant loop
    auth/             Sessions, permissions, guards, audit
    brief/            Daily brief generation, rendering, delivery
    data/             Loads a scoped dataset (live or demo)
    integrations/     Provider adapters, matching, sync orchestration
    jobs/             PostgreSQL-backed queue and handlers
    metrics/          Canonical metric definitions
prisma/               Schema, migrations, seed
tests/unit/           Vitest: calculations, permissions, integrations, brief
tests/e2e/            Playwright: four device profiles
```

### Two constraints that will bite if you do not know them

**1. Do not add a `loading.tsx` to a page that has a `FilterBar`.**
In Next.js 15.5, a route with a `loading.tsx` never commits a navigation to the
*same* route with different search params: the RSC request is sent and returns
200, but the router drops it and the URL never changes, so every filter on that
page silently does nothing. Verified by A/B - with the file removed the period
and division filters apply 3/3; with it present, 0/3, including with a trivial
`<div>Loading…</div>` fallback, so it is the boundary and not the skeleton.
Filter-free pages keep their skeleton; filtered pages rely on the sidebar's
per-link spinner and the filter's own pending state instead.

**2. Do not run `next dev` and `next start` from the same checkout at once.**
They share the build directory, so the dev server overwrites the production
build underneath the running server - which shows up as missing CSS and routes
that intermittently stop responding. Set `NEXT_DIST_DIR` to give a run its own
directory; the end-to-end suite already does.

### Three decisions worth knowing

**1. The figure calculations are pure functions.**
Everything in `src/lib/analytics` takes plain records and returns numbers. The
live database and the demo dataset are both projected into the same record
types, so the two can never drift apart, and every financial rule is directly
unit-testable without a database.

**2. Permission is enforced in the query layer, not the view.**
`buildAccessScope()` turns a session into a scope, and the scope is applied in
the database query. Hiding a navigation item is presentation only; each page
and route handler re-checks its own permission. The AI assistant goes through
the same layer: its tools check permission *before* producing a figure, so the
model is never relied upon to withhold data.

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
npm test                 # 119 unit tests
npm run test:e2e         # 197 end-to-end tests across 4 device profiles
```

The e2e suite runs against the demo dataset, so it needs no provider
credentials. It covers authentication, every role's access (including that a
sales representative cannot reach gross margin by URL **or** through the AI
API), that every filter actually applies on every page, responsive layout on
phone and tablet, navigation feedback, PWA installability, and that unsigned
webhooks and unauthenticated cron calls are refused.

To run against a server you started yourself:

```bash
# The suite signs in with the demo dataset, so that server must allow it.
NEXT_DIST_DIR=.next-e2e npm run build
PORT=3100 NEXT_DIST_DIR=.next-e2e ALLOW_DEMO_DATA=true APP_ENV=development npm start

E2E_BASE_URL=http://127.0.0.1:3100 npx playwright test
```

Without `E2E_BASE_URL`, Playwright starts its own server with those settings
already applied.

---

## Status

Built and verified: the application shell, design system, all eleven pages,
database schema and migrations, authentication and the permissions model,
provider adapters and the sync service, the AI assistant with its approved
query tools, the daily brief with email delivery, the job queue and worker, and
the test suites.

**Requires client input before go-live** — see
[`docs/client-decisions.md`](docs/client-decisions.md). The main items are API
credentials, confirmation of the division mapping rules against the real
QuickBooks classes and Method CRM fields, Finance approval of the metric
definitions, the final permissions matrix, and the daily brief recipients and
send time.

No integration is live. The adapters are written against the documented APIs
but have not been run against MetroLED's accounts, because no credentials have
been supplied. Nothing in this repository claims otherwise.
