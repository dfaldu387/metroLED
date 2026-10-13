# MetroLED Intelligence — user guide

Written for anyone using the dashboards. No technical knowledge assumed.

---

## Signing in

Go to the application address and enter your email and password. If you were
given a one-time password, you will be asked to choose your own.

If you cannot sign in, ask an account owner — they can reset your password.
After eight wrong attempts an account locks for fifteen minutes.

### "Demo data" banner

If a yellow banner says **Demo data — not live business figures**, every number
on screen is from a generated sample set used to review the interface before
the live connections are switched on. Do not act on those figures. The banner
disappears once real data is flowing.

---

## Finding your way around

The menu on the left (or behind the ☰ button on a phone) has three sections:

**Main** — Overview, Revenue, Accounts Receivable, Sales Pipeline, E-commerce,
Gross Margin
**Workspace** — Ask MetroLED, Daily Brief
**Administration** — Data Health, Users & Permissions, Settings

You will only see the items your role includes. To see exactly what your role
allows, open your name at the bottom of the menu → **Account settings**.

### Using it on a phone

The application installs to your home screen like an app. Open it in your
phone's browser and choose "Add to Home Screen" (iPhone) or "Install app"
(Android). It needs a connection to show figures — it deliberately never shows
you a cached number that might be out of date.

---

## Overview

The first thing to look at each morning.

**The five cards at the top** are the headline figures for the period you have
selected:

- **Total Revenue** — what you invoiced, excluding tax
- **Outstanding Receivables** — what customers owe you right now
- **Overdue Receivables** — the part of that which is past its due date
- **Open Sales Pipeline** — the total value of quotes still open
- **Gross Margin** — revenue less direct cost, as a percentage

Click any card to open the page behind it. The small **ⓘ** next to each one
explains exactly how that figure is calculated and where it comes from.

**Attention required** is the list of problems worth acting on today, most
urgent first: invoices that just became overdue, large quotes that have gone
quiet, a data source that has stopped syncing, records that could not be
matched to a customer. Each row has one obvious action.

**Division performance** compares MetroLED, Pixel LED Displays and Eco LED Mart.

**Data freshness** tells you whether you can trust what is above it. If a source
has not synced recently, there is an amber warning at the top of the page.

### Changing the period

The controls under the heading change the reporting period and the division.
Your selection is in the web address, so you can bookmark a view or send it to
someone else.

---

## Revenue

Invoiced sales excluding tax, by invoice date.

The headline figures, then a trend over time with the previous period as a
dashed line, a split by division, distributor versus direct, top customers, and
a breakdown by sales representative.

At the bottom is every invoice behind those figures. Search it, sort any
column, and page through it.

**What counts as revenue:** an invoice counts on the day it is issued, whether
or not it has been paid. Draft and voided invoices are excluded. Sales tax is
excluded.

---

## Accounts Receivable

What customers owe, and how late it is.

- **Total outstanding** — everything unpaid
- **Current** — not yet due
- **Overdue** — past the due date
- **Days Sales Outstanding** — roughly how long it takes to get paid

**Receivables by aging bucket** groups what is owed by how overdue it is:
current, 1–30, 31–60, 61–90, and more than 90 days.

The table lists every unpaid invoice. Filter it to overdue only, or to one
aging bucket. **View details** on any row opens a panel with the full invoice
and its reference in QuickBooks, so you can find the original record.

**This page is read-only.** It reads from QuickBooks and never writes back. You
cannot edit an invoice, record a payment, or send a reminder from here — those
happen in QuickBooks.

> If an invoice has no due date in QuickBooks it cannot be aged. Those are shown
> in their own row rather than being assumed to be current.

---

## Sales Pipeline

Open quotes from Method CRM.

- **Open pipeline value** — the total of every open quote
- **Average quote value**
- **Stale** — open quotes with no activity for 21+ days (configurable)
- **Win rate** — the share of decided quotes that were won

Then breakdowns by stage, by age, by representative and by division, and a
table of every open quote. Stale quotes are flagged, and you can filter to
"large and stale" — the ones worth chasing first.

> **The pipeline total is not a forecast.** It is the full value of every open
> quote, with no probability applied, because Method CRM does not record one.
> Treat it as the maximum, not the expected figure.

---

## E-commerce

How the Eco LED Mart Shopify store is doing: net sales, order count, average
order value, refunds, trends, order status and best sellers.

> **These are store sales, not accounting revenue.** Net sales here is the order
> subtotal after discounts, less refunds, and it excludes sales tax and
> shipping. It will not match the QuickBooks revenue for the same period, and
> the two are never added together. A table on the page shows exactly what is
> included and what is left out.

---

## Gross Margin

Revenue less direct cost, by division.

```
Gross Profit   = Revenue − Cost of Goods Sold
Gross Margin % = (Gross Profit ÷ Revenue) × 100
```

Cost of goods sold covers only the QuickBooks accounts marked as direct cost.
Operating expenses — rent, overhead salaries, marketing, software, professional
fees — are never included.

### Why it sometimes says "Not available"

A margin is only reported when Finance has approved the cost figure for **every**
month in the period. If one month is missing, the page says which, and shows no
profit figure at all.

This is deliberate. A margin calculated on a partial cost base would look
plausible and be wrong, which is worse than showing nothing.

The trend chart leaves a **gap** for an unapproved month rather than drawing it
as zero.

---

## Ask MetroLED

Ask a question about company data in plain English.

Try: *"What was our revenue last month?"*, *"How much money is overdue?"*,
*"Which large quotes have gone cold?"*, *"Is all our business data up to date?"*

Every answer has four parts:

- **Answer** — the figure
- **Business context** — what it means
- **Source** — which system, which period, how many records, and the formula
- **Data freshness** — when that source last synced

Open **View source** under any answer to see the exact queries that ran.

### What it will and will not do

It answers only from a fixed set of approved company-data queries. It cannot
write its own database queries, and it cannot reach anything your role is not
allowed to see — if you ask for something outside your permissions, it says so
rather than finding a way around.

If it cannot establish an accurate answer, it says **"I don't know"** and
explains what is missing. It will not guess a number.

---

## Daily Brief

Yesterday on one page, and the same thing arrives by email each business
morning:

1. Revenue and cash collected, by division
2. Invoices that became overdue
3. Large quotes that have gone quiet
4. Eco LED Mart highlights
5. Whether the data synced properly

Monday's brief covers Friday.

---

## Data Health

Whether the numbers can be trusted.

For each source: connected or not, when it last synced, how many records were
read, how long it took, and any error. Below that: the full sync history,
records that failed to import, and customers that could not be matched across
systems.

**Unmatched customers** matter. When the same business appears in QuickBooks
and Method CRM under slightly different names and the match is not confident
enough, the record waits here rather than being guessed. Until it is resolved,
its revenue shows under "Unknown customer".

---

## Common questions

**Why doesn't Shopify match QuickBooks?**
They measure different things. Shopify is what the store sold; QuickBooks is
what was invoiced. There are timing differences, and not every order is
invoiced. Both are correct on their own basis.

**Why does a figure say "Not available" instead of $0?**
Because zero would be a claim. "Not available" means the figure cannot be
calculated — no approved cost, no orders to average, no decided quotes. Zero
means genuinely nothing happened.

**Why is some revenue "Unassigned"?**
Those records match no division rule. They are counted in the totals but
excluded from per-division figures, rather than being put in the wrong
division. An owner can fix the rules in Settings.

**A number looks wrong.**
Check the data freshness at the top of the page, then the **ⓘ** next to the
figure for its exact definition. If it still looks wrong, tell an owner — they
can reconcile it against QuickBooks and record the result.

**Can I export this?**
Every chart has **View as table**, and tables can be copied. Use your browser's
print or save-as-PDF for a page.
