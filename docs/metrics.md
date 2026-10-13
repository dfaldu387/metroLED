# Metric definitions

**Generated from `src/lib/metrics/definitions.ts`. Do not edit by hand** —
run `npx tsx scripts/dev/gen-metrics-doc.mjs` instead, so this document and the
application can never disagree about a formula.

Each definition is also shown in the application at
**Settings → Metric definitions**, where it is approved.

| Metric | Formula | Source | Approval needed from |
|---|---|---|---|
| [Revenue](#revenue) | `Revenue = SUM(invoice subtotal excluding tax) for invoices with an invoice date in the period` | QuickBooks Online | Farida (Finance) |
| [Cost of Goods Sold](#cogs) | `COGS = SUM(amounts posted to the QuickBooks accounts flagged as direct cost in Settings > Cost mappings) for the period` | QuickBooks Online | Farida (Finance) |
| [Gross Profit](#gross-profit) | `Gross Profit = Revenue − Cost of Goods Sold` | QuickBooks Online | Farida (Finance) |
| [Gross Margin %](#gross-margin-pct) | `Gross Margin % = (Gross Profit ÷ Revenue) × 100` | QuickBooks Online | Farida (Finance) |
| [Accounts Receivable (Outstanding)](#accounts-receivable) | `Outstanding A/R = SUM(invoice balance) for invoices with a balance greater than zero` | QuickBooks Online | Farida (Finance) |
| [Overdue Receivables](#accounts-receivable-overdue) | `Overdue A/R = SUM(invoice balance) where due date < today AND balance > 0` | QuickBooks Online | Farida (Finance) |
| [A/R Aging Buckets](#ar-aging-buckets) | `Days overdue = today − due date. Buckets: Current (not yet due), 1–30, 31–60, 61–90, more than 90 days overdue.` | QuickBooks Online | Farida (Finance) |
| [Days Sales Outstanding (DSO)](#dso) | `DSO = (Outstanding A/R ÷ Revenue for the period) × number of days in the period` | QuickBooks Online | Farida (Finance) |
| [Open Pipeline Value](#pipeline-value) | `Open pipeline = SUM(quote amount) for quotes with status Open` | Method CRM | Ali Jooma (Owner) |
| [Quote Aging / Stale Quotes](#quote-aging) | `Days since last activity = today − (last activity date, or the quote date when no activity is recorded). A quote is stale when that exceeds the configured threshold.` | Method CRM | Ali Jooma (Owner) |
| [Win Rate](#win-rate) | `Win rate = Won quotes ÷ (Won quotes + Lost quotes) × 100, counted by quotes closed in the period` | Method CRM | Ali Jooma (Owner) |
| [Shopify Sales (Eco LED Mart)](#shopify-sales) | `Shopify net sales = SUM(order subtotal after discounts) − SUM(refunds). Tax and shipping are excluded.` | Shopify Admin API | Sabir (E-commerce) and Farida (Finance) |
| [Average Order Value](#average-order-value) | `AOV = Shopify net sales ÷ number of orders` | Shopify Admin API | Sabir (E-commerce) |

---

## Revenue

<a id="revenue"></a>

Invoiced sales excluding tax, for invoices dated inside the reporting period.

```
Revenue = SUM(invoice subtotal excluding tax) for invoices with an invoice date in the period
```

- **Key:** `revenue`
- **Source systems:** QuickBooks Online
- **Date basis:** Invoice date (not payment date and not the date the record was synchronised).
- **Includes:** Invoices with status Open, Partially paid or Paid. An invoice counts as revenue when it is issued, regardless of whether it has been paid.
- **Excludes:** Draft invoices, voided invoices, written-off invoices, sales tax, and Shopify orders (those are reported separately as Shopify sales until they are invoiced in QuickBooks).
- **Currency:** Reported in the company base currency. Amounts recorded in another currency are converted using the exchange rate stored on the source document; no live FX rate is applied after the fact.
- **Division mapping:** Division comes from the mapping rules in Settings > Divisions. A record that matches no rule is reported as "Unassigned" and never silently attributed to a division.
- **Approval status:** Awaiting approval
- **Approver:** Farida (Finance)

> **Note:** Accrual basis. If the client requires cash-basis revenue instead, this definition and every figure derived from it must change together.

## Cost of Goods Sold

<a id="cogs"></a>

Direct costs attributed to a division for the period.

```
COGS = SUM(amounts posted to the QuickBooks accounts flagged as direct cost in Settings > Cost mappings) for the period
```

- **Key:** `cogs`
- **Source systems:** QuickBooks Online
- **Date basis:** Transaction date of the posting.
- **Includes:** Only accounts explicitly flagged "Include in cost of goods sold" and approved by Finance.
- **Excludes:** All operating expenses - rent, salaries not directly attributable to production, marketing, software, professional fees and general overhead. Operating expenses are never treated as direct costs.
- **Currency:** Reported in the company base currency. Amounts recorded in another currency are converted using the exchange rate stored on the source document; no live FX rate is applied after the fact.
- **Division mapping:** Division comes from the mapping rules in Settings > Divisions. A record that matches no rule is reported as "Unassigned" and never silently attributed to a division.
- **Approval status:** Awaiting approval
- **Approver:** Farida (Finance)

> **Note:** Each monthly figure must be marked approved in the Cost of goods sold table before gross margin is reported for that month. Unapproved months show as unavailable.

## Gross Profit

<a id="gross-profit"></a>

Revenue less cost of goods sold.

```
Gross Profit = Revenue − Cost of Goods Sold
```

- **Key:** `gross_profit`
- **Source systems:** QuickBooks Online
- **Date basis:** Invoice date for revenue; transaction date for cost.
- **Includes:** As per the Revenue and Cost of Goods Sold definitions.
- **Excludes:** As per the Revenue and Cost of Goods Sold definitions.
- **Currency:** Reported in the company base currency. Amounts recorded in another currency are converted using the exchange rate stored on the source document; no live FX rate is applied after the fact.
- **Division mapping:** Division comes from the mapping rules in Settings > Divisions. A record that matches no rule is reported as "Unassigned" and never silently attributed to a division.
- **Approval status:** Awaiting approval
- **Approver:** Farida (Finance)

> **Note:** Reported by division only in Phase 1. Profit per project is explicitly out of scope.

## Gross Margin %

<a id="gross-margin-pct"></a>

Gross profit as a percentage of revenue.

```
Gross Margin % = (Gross Profit ÷ Revenue) × 100
```

- **Key:** `gross_margin_pct`
- **Source systems:** QuickBooks Online
- **Date basis:** Invoice date for revenue; transaction date for cost.
- **Includes:** Periods where both revenue and an approved cost figure exist.
- **Excludes:** Periods with no revenue (the percentage is undefined and shown as unavailable rather than 0%), and periods whose cost figure has not been approved.
- **Currency:** Reported in the company base currency. Amounts recorded in another currency are converted using the exchange rate stored on the source document; no live FX rate is applied after the fact.
- **Division mapping:** Division comes from the mapping rules in Settings > Divisions. A record that matches no rule is reported as "Unassigned" and never silently attributed to a division.
- **Approval status:** Awaiting approval
- **Approver:** Farida (Finance)

## Accounts Receivable (Outstanding)

<a id="accounts-receivable"></a>

Money invoiced and not yet collected, as at today.

```
Outstanding A/R = SUM(invoice balance) for invoices with a balance greater than zero
```

- **Key:** `accounts_receivable`
- **Source systems:** QuickBooks Online
- **Date basis:** Point in time (as at now). Not a period total.
- **Includes:** Invoices with status Open or Partially paid and a remaining balance above zero.
- **Excludes:** Paid, draft, voided and written-off invoices.
- **Currency:** Reported in the company base currency. Amounts recorded in another currency are converted using the exchange rate stored on the source document; no live FX rate is applied after the fact.
- **Division mapping:** Division comes from the mapping rules in Settings > Divisions. A record that matches no rule is reported as "Unassigned" and never silently attributed to a division.
- **Approval status:** Awaiting approval
- **Approver:** Farida (Finance)

> **Note:** Balance comes from QuickBooks rather than being recalculated, so partial payments are always reflected.

## Overdue Receivables

<a id="accounts-receivable-overdue"></a>

Outstanding invoices whose due date has passed.

```
Overdue A/R = SUM(invoice balance) where due date < today AND balance > 0
```

- **Key:** `accounts_receivable_overdue`
- **Source systems:** QuickBooks Online
- **Date basis:** Due date compared against today in the company timezone.
- **Includes:** Outstanding invoices with a due date strictly before today.
- **Excludes:** Invoices with no due date recorded - these are reported separately as "No due date recorded".
- **Currency:** Reported in the company base currency. Amounts recorded in another currency are converted using the exchange rate stored on the source document; no live FX rate is applied after the fact.
- **Division mapping:** Division comes from the mapping rules in Settings > Divisions. A record that matches no rule is reported as "Unassigned" and never silently attributed to a division.
- **Approval status:** Awaiting approval
- **Approver:** Farida (Finance)

## A/R Aging Buckets

<a id="ar-aging-buckets"></a>

Outstanding balance grouped by how long it has been overdue.

```
Days overdue = today − due date. Buckets: Current (not yet due), 1–30, 31–60, 61–90, more than 90 days overdue.
```

- **Key:** `ar_aging_buckets`
- **Source systems:** QuickBooks Online
- **Date basis:** Due date compared against today in the company timezone.
- **Includes:** All outstanding invoices.
- **Excludes:** Invoices with no due date, grouped separately.
- **Currency:** Reported in the company base currency. Amounts recorded in another currency are converted using the exchange rate stored on the source document; no live FX rate is applied after the fact.
- **Division mapping:** Division comes from the mapping rules in Settings > Divisions. A record that matches no rule is reported as "Unassigned" and never silently attributed to a division.
- **Approval status:** Awaiting approval
- **Approver:** Farida (Finance)

> **Note:** Bucket boundaries are configurable in Settings and the configured values are shown on the A/R page.

## Days Sales Outstanding (DSO)

<a id="dso"></a>

Average number of days it takes to collect invoiced revenue.

```
DSO = (Outstanding A/R ÷ Revenue for the period) × number of days in the period
```

- **Key:** `dso`
- **Source systems:** QuickBooks Online
- **Date basis:** Outstanding A/R as at the period end; revenue by invoice date within the period.
- **Includes:** As per the Revenue and Accounts Receivable definitions.
- **Excludes:** Periods with no revenue, where DSO is undefined and reported as unavailable.
- **Currency:** Reported in the company base currency. Amounts recorded in another currency are converted using the exchange rate stored on the source document; no live FX rate is applied after the fact.
- **Division mapping:** Division comes from the mapping rules in Settings > Divisions. A record that matches no rule is reported as "Unassigned" and never silently attributed to a division.
- **Approval status:** Awaiting approval
- **Approver:** Farida (Finance)

> **Note:** This is the simple (non-countback) DSO formula. Confirm with Finance whether the countback method is required before this metric is reported as verified.

## Open Pipeline Value

<a id="pipeline-value"></a>

Total value of quotes that are still open.

```
Open pipeline = SUM(quote amount) for quotes with status Open
```

- **Key:** `pipeline_value`
- **Source systems:** Method CRM
- **Date basis:** Point in time (as at now), filtered by quote date when a period is applied.
- **Includes:** Quotes whose Method CRM stage maps to an open stage.
- **Excludes:** Won, lost, expired and cancelled quotes.
- **Currency:** Reported in the company base currency. Amounts recorded in another currency are converted using the exchange rate stored on the source document; no live FX rate is applied after the fact.
- **Division mapping:** Division comes from the mapping rules in Settings > Divisions. A record that matches no rule is reported as "Unassigned" and never silently attributed to a division.
- **Approval status:** Awaiting approval
- **Approver:** Ali Jooma (Owner)

> **Note:** This is an unweighted total. Probability-weighted pipeline is NOT reported: Method CRM does not supply a probability per stage and no weighting formula has been approved. Do not infer one.

## Quote Aging / Stale Quotes

<a id="quote-aging"></a>

How long an open quote has gone without activity.

```
Days since last activity = today − (last activity date, or the quote date when no activity is recorded). A quote is stale when that exceeds the configured threshold.
```

- **Key:** `quote_aging`
- **Source systems:** Method CRM
- **Date basis:** Last activity date on the quote.
- **Includes:** Open quotes only.
- **Excludes:** Closed quotes of any kind.
- **Currency:** Reported in the company base currency. Amounts recorded in another currency are converted using the exchange rate stored on the source document; no live FX rate is applied after the fact.
- **Division mapping:** Division comes from the mapping rules in Settings > Divisions. A record that matches no rule is reported as "Unassigned" and never silently attributed to a division.
- **Approval status:** Awaiting approval
- **Approver:** Ali Jooma (Owner)

> **Note:** The stale threshold and the "large quote" amount are configurable in Settings.

## Win Rate

<a id="win-rate"></a>

Share of decided quotes that were won.

```
Win rate = Won quotes ÷ (Won quotes + Lost quotes) × 100, counted by quotes closed in the period
```

- **Key:** `win_rate`
- **Source systems:** Method CRM
- **Date basis:** Quote close date.
- **Includes:** Quotes closed in the period with an outcome of Won or Lost.
- **Excludes:** Open quotes, expired quotes and cancelled quotes, because none of these represent a decision made by the customer. Periods with no decided quotes report as unavailable, not 0%.
- **Currency:** Not applicable - a count-based ratio.
- **Division mapping:** Division comes from the mapping rules in Settings > Divisions. A record that matches no rule is reported as "Unassigned" and never silently attributed to a division.
- **Approval status:** Awaiting approval
- **Approver:** Ali Jooma (Owner)

> **Note:** Counted by number of quotes. Confirm whether the client wants win rate by value instead; the two can differ substantially.

## Shopify Sales (Eco LED Mart)

<a id="shopify-sales"></a>

Net merchandise sales from the Shopify store.

```
Shopify net sales = SUM(order subtotal after discounts) − SUM(refunds). Tax and shipping are excluded.
```

- **Key:** `shopify_sales`
- **Source systems:** Shopify Admin API
- **Date basis:** Order placed date, converted to the company timezone.
- **Includes:** Orders that are not cancelled.
- **Excludes:** Cancelled orders, sales tax, shipping charges, and gift card sales. Refunds are deducted in the period the order was placed, not the period the refund was issued.
- **Currency:** Reported in the company base currency. Amounts recorded in another currency are converted using the exchange rate stored on the source document; no live FX rate is applied after the fact.
- **Division mapping:** All Shopify orders belong to the Eco LED Mart division.
- **Approval status:** Awaiting approval
- **Approver:** Sabir (E-commerce) and Farida (Finance)

> **Note:** This is an OPERATIONAL sales figure from the store, not accounting revenue. It will not equal QuickBooks revenue for the same period, because of timing differences and because not every order has been invoiced. The two are shown separately and never added together.

## Average Order Value

<a id="average-order-value"></a>

Average net sales per Shopify order.

```
AOV = Shopify net sales ÷ number of orders
```

- **Key:** `average_order_value`
- **Source systems:** Shopify Admin API
- **Date basis:** Order placed date.
- **Includes:** Non-cancelled orders in the period.
- **Excludes:** Cancelled orders. Periods with no orders report as unavailable, not $0.
- **Currency:** Reported in the company base currency. Amounts recorded in another currency are converted using the exchange rate stored on the source document; no live FX rate is applied after the fact.
- **Division mapping:** Eco LED Mart only.
- **Approval status:** Awaiting approval
- **Approver:** Sabir (E-commerce)

---

## Deliberately not implemented

**Probability-weighted pipeline.** Method CRM records no probability per
stage and no weighting formula has been approved, so the pipeline total is
the unweighted sum of open quotes and every screen says so. Inventing a
weighting would make the pipeline look more certain than the data supports.

**Profit per project.** Out of scope for Phase 1. Gross margin is reported by
division only.

## Why a figure can read "Not available"

A metric reports as unavailable rather than zero when zero would be a claim
the data does not support:

| Metric | Unavailable when |
|---|---|
| Gross margin | Any month in the period has no Finance-approved cost figure |
| Gross margin | The period has no revenue, so the percentage is undefined |
| Average order value | There were no orders to average |
| Win rate | No quote was won or lost in the period |
| Days Sales Outstanding | There was no revenue in the period |
| Any period comparison | The previous period has no data, so a percentage change is meaningless |
