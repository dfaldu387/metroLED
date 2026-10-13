# Administrator guide

For owners and anyone with administrative permissions.

---

## Users and access

### Roles

| Role | What it includes |
|---|---|
| **Owner** | Everything: all data, administration, the audit log |
| **Finance** | Revenue, receivables, approved gross margin; can approve metric definitions |
| **E-commerce** | Eco LED Mart reporting |
| **Sales Representative** | Own sales data only — no profit, no other representatives' records |
| **Operations** | Operational reporting and integration health; can run syncs |

A user can hold more than one role and receives the union of their permissions.

### Adding a user

**Users & Permissions → Add a user.** Give a name, an email, and at least one
role. A one-time password is generated and shown **once** — pass it on through
a channel you trust. They must change it at first sign-in.

### Sales representatives need a linked record

A Sales Representative account must be linked to a representative record so the
system knows whose data is theirs.

**If it is not linked, that account sees no sales data at all.** The restriction
fails closed rather than showing everything. The user list flags any
representative account missing its link.

### Changing roles

**Users & Permissions → ⋯ → Change roles.**

Changing a role signs that user out of every session, so the change takes effect
immediately rather than when their session happens to expire.

You cannot remove the last active owner, or deactivate your own account.

### Deactivating

Deactivating signs the user out immediately and blocks sign-in. Nothing they
created is deleted and the audit log keeps their past actions. Reactivating
restores access with the same password.

### The permissions matrix

**Users & Permissions → Roles & permissions** shows exactly what each role may
see, and lets you change it without a deploy. Every change is audited.

Two cells are locked and cannot be granted:

- A Sales Representative never receives gross margin or any cost figure.
- A Sales Representative never sees another representative's records.

These are enforced in code as well as in the table, so a mis-click cannot leak
them.

> Hiding a menu item is not security. Every page and every API call re-checks
> permission on the server. A user who types a URL directly for a page their
> role excludes is refused, and told which permission they are missing.

---

## Connecting the data sources

**Settings → Integrations** shows what each source contributes, how it
authenticates, and which environment variables it needs. Credentials are
encrypted and are never displayed — the page tells you whether one is stored,
not what it is.

### QuickBooks Online

Needs `QBO_CLIENT_ID` and `QBO_CLIENT_SECRET`, with the redirect URI registered
as `<APP_URL>/api/integrations/quickbooks/callback`.

Press **Connect QuickBooks Online** and complete the Intuit consent. The access
token refreshes automatically; the refresh token is rotated and stored
encrypted.

> The refresh token expires after 100 days without use. If the integration has
> been idle that long, reconnect it.

### Method CRM and Shopify

Both use a key or token set in the environment. After setting them, use **Test
a connection** on Data Health to confirm before running a sync.

For Shopify, also configure the webhook endpoint `<APP_URL>/api/webhooks/shopify`
on the topics `orders/create`, `orders/updated`, `orders/cancelled`,
`orders/paid` and `refunds/create`, and set `SHOPIFY_WEBHOOK_SECRET` to the
app's signing secret. Webhooks give near-real-time order updates; without them
orders still arrive on the scheduled sync.

### Importing history

From **Data Health → Run one source → Backfill**, or **Run sync now** for an
incremental update.

A full backfill re-reads up to 24 months, takes several minutes per provider,
and uses a large share of the provider's rate limit. It is safe to re-run:
records are matched on their source identifier and updated in place, so nothing
is duplicated.

---

## Divisions and mapping

**Settings → Divisions & mappings.**

A mapping rule decides which division a record belongs to. Rules are evaluated
in priority order, lowest number first, and the first match wins.

Example: *QuickBooks · class · contains · "Pixel" → Pixel LED Displays*.

### Records that match nothing

They stay **Unassigned**: counted in company totals, excluded from every
per-division figure, and never attributed to a default division. The Overview
page counts them so the gap is visible.

### Rules apply going forward

A new rule applies to records imported after it. To re-apply it to records
already imported, run a full backfill from Data Health.

---

## Metric definitions and approvals

**Settings → Metric definitions.**

Every formula the platform reports is documented here with its source system,
date basis, and exactly what it includes and excludes.

### Approving

Finance (or an owner) approves each definition. Approval records who and when,
in the audit log.

Until a definition is approved, its figures are still shown but are never
labelled as verified, and the Gross Margin page carries a visible notice.

### Cost mappings

**Cost mappings** lists the QuickBooks chart of accounts. Tick the accounts that
count as direct cost. Accounts QuickBooks types as "Cost of Goods Sold" are
pre-ticked as a starting point, but each one needs confirming.

**Operating expenses must not be ticked** — rent, overhead salaries, marketing,
software, professional fees. Including them would understate gross margin.

### Approved cost periods

Gross margin is reported for a period only when every month in it has an
approved cost figure. Unapproved months are listed here and are what the
"Not available" message on the Gross Margin page refers to.

### Reconciliation

For each agreed closed month, compare the platform figure against the
QuickBooks report and record the result. A metric with a failed reconciliation
is not released as verified.

---

## The daily brief

**Settings → Daily Brief.**

Set whether it sends automatically, at what time, and who receives it. Add or
remove recipients at any time; removing one keeps the historical delivery
records intact.

> Saving a time here records the intent. An external scheduler must call
> `POST /api/cron/brief` at that time — see the runbook. Without that, nothing
> sends.

**Recent briefs** shows per-recipient delivery status and counts consecutive
successful days, which is the acceptance evidence (five consecutive business
days to Ali).

You can send or re-send from the Daily Brief page. Recipients who already
received that brief are skipped, so nobody gets it twice.

If `EMAIL_PROVIDER` is `console`, briefs are written to the server log rather
than sent. The page says so.

---

## Company settings

**Settings → Company.**

| Setting | What it affects |
|---|---|
| Company name | Shown in the application and in email |
| Reporting timezone | Every reporting period and the brief's business date |
| Base currency | How amounts are formatted |
| Data stale after | When a source is flagged as stale (default 6 hours) |
| Quote stale after | When an open quote is flagged as gone quiet (default 21 days) |
| Large quote at | Which quotes are called out separately (default $10,000) |

---

## The audit log

Every consequential action is recorded with the actor, the time and the IP:
sign-ins and failures, user and role changes, password resets, settings and
mapping changes, cost classification changes, metric approvals, sync triggers,
brief sends, and every AI question with the queries it ran.

Recent account changes are on **Users & Permissions → Recent changes**.

---

## Monthly checklist

1. **Data Health** — every source connected, synced recently, no unresolved failures.
2. **Unmatched customers** — resolve anything waiting.
3. **Unassigned records** — if the count is growing, a mapping rule is missing.
4. **Cost approvals** — approve last month's cost figures so gross margin reports.
5. **Reconcile** — compare last month's revenue and A/R against QuickBooks and record it.
6. **Users** — remove anyone who has left; check for representative accounts with no linked record.
7. **Brief delivery** — confirm it is arriving.

---

## Things the system will not do

By design, and confirmed in the Phase 1 scope:

- It never writes to QuickBooks, Method CRM or Shopify.
- It never emails a customer. The daily brief goes to internal recipients only.
- It never shows a figure it cannot support. Unavailable is reported as
  unavailable, not as zero.
- It never attributes an unmatched record to a division or a customer by guess.
