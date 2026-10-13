# Decisions and inputs needed from the client

Everything below blocks or changes part of the delivery. Items are ordered by
how much they hold up. Each one says who it needs to come from, what happens
until it arrives, and what the system does in the meantime.

Raise delays with Denish the same day, per the Phase 1 plan.

---

## 1. Credentials and API access — BLOCKING

**Needed from:** Ali / Denish
**Blocks:** every live figure. Until these arrive the application can only be
reviewed with the labelled demo dataset.

| System | What is needed | Where it goes |
|---|---|---|
| QuickBooks Online | An app on developer.intuit.com; client id and secret; the redirect URI registered as `<APP_URL>/api/integrations/quickbooks/callback`; an admin to complete the OAuth consent | `QBO_CLIENT_ID`, `QBO_CLIENT_SECRET` |
| Method CRM | API key for an account that can read Estimates and Customers | `METHOD_API_KEY` |
| Shopify | A custom app on the Eco LED Mart store with `read_orders`, `read_products`, `read_customers`; its Admin API access token and webhook signing secret | `SHOPIFY_ADMIN_ACCESS_TOKEN`, `SHOPIFY_WEBHOOK_SECRET` |
| Email | A Resend API key, or AWS SES credentials, plus a verified sending domain | `RESEND_API_KEY` or `AWS_*` |
| AI assistant | An Anthropic API key | `ANTHROPIC_API_KEY` |

Until the email provider is configured, `EMAIL_PROVIDER` stays `console`: the
daily brief is generated and rendered, and written to the server log instead of
being sent. The five-consecutive-business-day acceptance run cannot start until
a real provider is configured.

---

## 2. Division mapping rules — BLOCKING for every per-division figure

**Needed from:** Ali, with Farida for the QuickBooks side

The seed installs starting rules that match on the QuickBooks **class** and the
Method CRM **class** containing "Pixel", "Eco" or "MetroLED". These are a
guess. They must be checked against the real values.

Specifically, we need to know:

1. Does QuickBooks use **Class**, **Department/Location**, or something else to
   separate MetroLED from Pixel LED Displays?
2. What are the exact values? (The rules are case-insensitive but match on text.)
3. Are there invoices that belong to a division but carry no such marker? If so,
   what identifies them?
4. Does Method CRM use the same field, and the same values?

**Until confirmed:** a record matching no rule is reported as **Unassigned** and
is excluded from every per-division figure. It is deliberately never attributed
to a default division, because that would silently move revenue onto the wrong
division. The Overview page counts unassigned records so the gap is visible.

Rules can be changed in **Settings → Divisions & mappings** without a deploy.
A new rule applies to records imported after it; run a full backfill from Data
Health to re-apply it to existing records.

---

## 3. Metric definitions — BLOCKING for "verified" financial reporting

**Needed from:** Farida (financial metrics), Ali (pipeline metrics)

Every formula is documented in [`metrics.md`](metrics.md) and shown in the
application at **Settings → Metric definitions**, where it can be approved.

Until a definition is approved, figures derived from it are still shown but are
never labelled as verified, and the Gross Margin page carries a visible "not
yet certified" notice.

The specific questions:

| Metric | Question |
|---|---|
| **Revenue** | Accrual basis (invoice date) is implemented. Is cash basis wanted instead? The two differ materially. |
| **Cost of goods sold** | Which QuickBooks accounts count as direct cost? Accounts QuickBooks types as "Cost of Goods Sold" are pre-ticked in Settings → Metric definitions → Cost mappings, but each one needs confirming. Operating expenses are excluded by design. |
| **Gross margin** | Confirm `Gross Profit = Revenue − COGS` and `Gross Margin % = (Gross Profit ÷ Revenue) × 100`. Phase 1 reports by division only; profit per project is out of scope. |
| **A/R aging** | Buckets are Current, 1–30, 31–60, 61–90, 90+ days overdue. Confirm, or supply the preferred boundaries. |
| **DSO** | The simple formula is implemented: `(Outstanding A/R ÷ period revenue) × days in period`. Is the countback method required instead? |
| **Win rate** | Counted by **number** of decided quotes. Should it be by **value** instead? The two can differ a lot. |
| **Shopify sales** | Net sales = subtotal after discounts, less refunds; excludes tax and shipping. Confirm each inclusion. |

### Not implemented on purpose

**Probability-weighted pipeline.** Method CRM records no probability per stage
and no weighting formula has been approved, so the pipeline total is the
unweighted sum of open quotes and the page says so. If a weighted forecast is
wanted, we need the probability per stage from Ali.

---

## 4. Permissions matrix — needs confirmation

**Needed from:** Ali

The proposed matrix is seeded and is editable at **Users & Permissions →
Roles & permissions**. It needs a decision on each role, particularly:

- **Finance** currently sees the sales pipeline. Correct?
- **Operations** currently sees the pipeline and e-commerce but not revenue or
  receivables. Correct?
- **E-commerce** currently sees only the Overview and the store. Should Sabir
  also see Eco LED Mart revenue and receivables?

Two restrictions are treated as non-negotiable and are enforced in code as well
as in the table, so they cannot be granted by mistake:

- A sales representative never receives gross margin or any cost figure.
- A sales representative never sees another representative's records.

A sales representative's account must be linked to a representative record.
Until it is, that account sees **no sales data at all** — the restriction fails
closed rather than showing everything.

---

## 5. Daily brief: recipients and send time — needs confirmation

**Needed from:** Ali

- Who receives it? (Ali is seeded as the only recipient.)
- What time, US Eastern? (07:00 is the default.)
- Should it send on US public holidays? Currently it sends every weekday;
  weekends are skipped, and Monday's brief covers Friday.

Both are configurable at **Settings → Daily Brief**.

Note that saving a time there records the intent only. An external scheduler
has to call `POST /api/cron/brief` at that time — see the runbook.

---

## 6. The ten AI acceptance questions — needs confirmation

**Needed from:** Ali

Section 11 requires ten agreed questions that must return correct,
source-backed answers. These are implemented and suggested in the interface:

1. What was our revenue last month?
2. Which division generated the most revenue this quarter?
3. How much money is overdue?
4. Which invoices are more than 30 days overdue?
5. Which large quotes have gone cold?
6. How is Eco LED Mart performing?
7. What changed compared with last month?
8. Is all our business data up to date?
9. What is our gross margin by division?
10. What should I look at today?

Confirm this list, or replace any of them. Each needs an expected answer agreed
against the live data before it can be signed off.

---

## 7. Monday.com — conditional, not implemented

Phase 1 lists Monday.com as conditional on explicit client confirmation. It is
**not implemented**. The database and settings have a place for it, and it is
hidden entirely unless `MONDAY_ENABLED=true`.

If it is wanted, it goes through Hitesh's change log and Denish's approval
first, and we need to know which boards matter and what they should contribute.

---

## 8. Smaller confirmations

| Item | Default | Confirm |
|---|---|---|
| Base currency | CAD | Correct? Are there invoices in other currencies? |
| Reporting timezone | America/New_York | Correct for reporting, given the business location? |
| "Stale quote" threshold | 21 days without activity | Correct? |
| "Large quote" threshold | $10,000 | Correct? |
| "Stale data" threshold | 6 hours without a successful sync | Correct? |
| History to import | 24 months | Correct? |
| Sync frequency | Every 3 hours, plus a nightly backfill | Correct? |
| Customer match threshold | 70% confidence auto-matches; below that goes to manual review | Comfortable with this? |

All of these are in **Settings**, changeable without a deploy.

---

## What is NOT in Phase 1

Confirmed exclusions, listed so there is no ambiguity at handover:

- Writing any data back to QuickBooks, Method CRM or Shopify
- Automated customer emails or payment reminders
- Marketing tools
- Customer-facing chat or voice
- Inventory forecasting
- Native iOS or Android applications (the PWA installs to the home screen instead)
- Profitability per project

Any addition goes through Hitesh's change log and Denish's approval.
