# Operations runbook

Deployment, scheduled work, and what to do when something goes wrong.

---

## 1. What runs

Three processes:

| Process | Command | Purpose |
|---|---|---|
| Web | `npm start` | The application and its API |
| Worker | `npm run worker` | Background jobs: syncs, the daily brief, webhook processing |
| Scheduler | HTTP calls to `/api/cron/*` | Triggers the recurring work |

The worker and the web process can run on the same host. More than one worker
can run safely: jobs are claimed with `FOR UPDATE SKIP LOCKED`, so the same job
is never processed twice.

---

## 2. Deployment

### First deployment

```bash
git clone <repository> && cd metroLED
npm ci

# Secrets - generate fresh ones per environment, never reuse them
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"  # SESSION_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"  # CREDENTIAL_ENCRYPTION_KEY
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"     # CRON_SECRET

npm run db:deploy     # apply migrations
npm run db:seed       # roles, divisions, metric definitions, first owner
npm run build
npm start
```

Then, in the application:

1. Sign in as the owner and change the password immediately.
2. Connect QuickBooks (Settings → Integrations → Connect), then add the Method
   and Shopify credentials.
3. Run a **full backfill** from Data Health to import 24 months of history.
   Expect this to take several minutes per provider.
4. Confirm the division mapping rules, then run the backfill again so existing
   records pick them up.
5. Have Finance approve the metric definitions.
6. Add the daily brief recipients and turn the schedule on.

### Subsequent deployments

```bash
git pull
npm ci
npm run db:deploy     # safe to run when there are no new migrations
npm run build
# restart web and worker
```

`db:deploy` applies migrations only; it never resets data. Never run
`prisma migrate reset` against staging or production.

### Environment

Set every variable in `.env.example`. The ones that must differ per
environment:

- `APP_ENV` — `production` disables demo mode entirely
- `APP_URL` — the public URL; used for email links and the OAuth redirect
- `DATABASE_URL`
- `SESSION_SECRET`, `CREDENTIAL_ENCRYPTION_KEY`, `CRON_SECRET` — unique per environment
- `ALLOW_DEMO_DATA=false` in staging once real data is flowing

**`CREDENTIAL_ENCRYPTION_KEY` cannot be rotated casually.** It decrypts the
stored provider tokens. If it is lost or changed, every integration must be
reconnected.

---

## 3. Scheduled work

Point any scheduler (Vercel Cron, a Kubernetes CronJob, systemd timer, cron)
at these endpoints. Each needs `Authorization: Bearer $CRON_SECRET`.

| Schedule | Call | Purpose |
|---|---|---|
| Every 3 hours | `POST /api/cron/sync` | Incremental sync of all enabled providers |
| Daily, 02:00 ET | `POST /api/cron/sync?backfill=true` | Nightly historical re-read |
| Weekdays, 07:00 ET | `POST /api/cron/brief` | Generate and send the daily brief |

Example crontab:

```cron
0 */3 * * *  curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" https://HOST/api/cron/sync
0 2 * * *    curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" "https://HOST/api/cron/sync?backfill=true"
0 7 * * 1-5  curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" https://HOST/api/cron/brief
```

**Calling these twice is safe.** The brief is keyed on its business date and a
recipient who already received it is skipped, so a double fire sends nothing
the second time. A sync resumes from its checkpoint and upserts on the source
identifier, so no record is duplicated.

### Response codes

| Code | Meaning | Action |
|---|---|---|
| 200 | Everything succeeded | None |
| 207 | Partial — some providers or deliveries failed | Check Data Health; it will retry on the next run |
| 401 | Bad or missing `CRON_SECRET` | Fix the scheduler's credential |
| 500 | Everything failed | Investigate; see below |
| 503 | `CRON_SECRET` not configured | Set it and restart |

Alert on 500 and on 207 persisting for more than two consecutive runs.

---

## 4. Monitoring

**Data Health** is the first place to look. It shows per provider: connection
status, last successful sync, last attempt, records read/created/updated/failed,
duration, the error summary, and the full run history.

Alert on:

| Signal | Where | Threshold |
|---|---|---|
| Consecutive sync failures | `Integration.consecutiveFailures` | ≥ 3 |
| Stale data | Last successful sync | > 6 hours (configurable) |
| Dead jobs | `Job.status = 'DEAD'` | ≥ 1 |
| Failed brief delivery | `BriefDelivery.status = 'FAILED'` | ≥ 1 |
| Unresolved record failures | `SyncError.resolvedAt IS NULL` | Growing |

A quick check:

```sql
SELECT provider, status, "lastSuccessAt", "consecutiveFailures", "lastErrorMessage"
FROM "Integration" WHERE "isEnabled" = true;

SELECT status, COUNT(*) FROM "Job" GROUP BY status;

SELECT "briefDate", status FROM "DailyBrief" ORDER BY "briefDate" DESC LIMIT 7;
```

---

## 5. Common problems

### A provider shows "Failing"

1. Open Data Health and read the error summary.
2. **Test a connection** for that provider — it checks the credentials without
   importing anything.
3. If the test reports an authentication failure:
   - QuickBooks: the refresh token expires after 100 days of disuse. Reconnect
     from Settings → Integrations.
   - Method / Shopify: the API key or access token was revoked or rotated.
     Replace it.
4. If the test passes but syncs still fail, look at **Failed records** on Data
   Health — the problem is usually individual records, not the connection.
5. Run a sync manually and watch the result.

A failure in one provider does not stop the others. Each provider's outcome is
recorded separately.

### Figures look wrong

1. **Check freshness first.** A stale source is the most common cause.
2. **Check for unassigned records.** The Overview page counts invoices and
   quotes that match no division rule; they are excluded from per-division
   figures.
3. **Check unmatched customers** on Data Health. Their revenue is reported
   under "Unknown customer".
4. **Check the metric definition.** Settings → Metric definitions states the
   formula, the date basis, and exactly what is included and excluded. Most
   "wrong" figures are a different basis than expected — for example Shopify
   store sales compared against QuickBooks revenue, which are deliberately
   different things.
5. **Reconcile.** For a closed month, compare the platform figure against the
   QuickBooks report and record the result in Settings → Metric definitions →
   Reconciliation.

### Gross margin shows "Not available"

This is working as intended. A margin is only reported when Finance has
approved a cost figure for **every** month in the period. The message names the
months that are blocking it. Approve them in Settings → Metric definitions.

### The daily brief did not arrive

1. Settings → Daily Brief shows recent briefs with per-recipient delivery status.
2. If the status is `FAILED`, the error from the email provider is recorded
   against the recipient.
3. If no brief exists for the date at all, the scheduler did not fire. Check it,
   then send manually from the Daily Brief page.
4. If `EMAIL_PROVIDER=console`, nothing was ever sent — it was written to the
   server log. Configure a real provider.

Re-sending is safe: recipients who already received that brief are skipped.

### A job is stuck

Jobs whose worker died are reclaimed automatically after 30 minutes. To force it:

```sql
UPDATE "Job" SET status = 'PENDING', "lockedBy" = NULL, "lockedAt" = NULL
WHERE status = 'RUNNING' AND "lockedAt" < NOW() - INTERVAL '10 minutes';
```

A job that exhausted its retries is `DEAD` and will not run again on its own.
Fix the cause, then re-queue the work (for a sync, press Run sync on Data
Health).

### Shopify webhooks are not arriving

1. Confirm the endpoint in Shopify: `<APP_URL>/api/webhooks/shopify`.
2. Confirm `SHOPIFY_WEBHOOK_SECRET` matches the app's signing secret. A
   mismatch produces 401s, which Shopify shows as failed deliveries.
3. Check `WebhookEvent` for rows with `processError` set.

Webhooks are an optimisation for near-real-time order updates. If they stop,
the scheduled sync still picks the orders up — the dashboard is just a few
hours behind until it does.

### Someone is locked out

Eight failed sign-ins lock an account for 15 minutes. An owner can reset the
password from Users & Permissions, which clears the lock and issues a one-time
password.

---

## 6. Recovery

### Restore the database

Standard PostgreSQL restore. After restoring:

```bash
npm run db:deploy      # ensure migrations match the code
```

Then run a full backfill from Data Health. Sync is idempotent — it upserts on
`(integration, sourceId)` — so re-importing cannot create duplicates.

### A sync imported bad data

Because every row keeps its source identifier, a re-import corrects it. Fix the
mapping or the cause, then run a full backfill. Figures update as records are
re-imported.

### Rotating secrets

| Secret | Effect | Procedure |
|---|---|---|
| `SESSION_SECRET` | Signs demo cookies; real sessions are database-backed and survive | Change and restart |
| `CRON_SECRET` | Scheduler credential | Change in both the app and the scheduler |
| `CREDENTIAL_ENCRYPTION_KEY` | **Stored provider tokens become unreadable** | Only with a planned reconnection of every integration |

---

## 7. Security notes

- Provider credentials are encrypted at rest with AES-256-GCM and are decrypted
  only inside the sync service. No API route returns them; no screen shows them.
- Sessions are database-backed opaque tokens; only the SHA-256 hash is stored,
  so a database leak cannot be replayed as a login. Revoking a session takes
  effect immediately, and changing a role signs the user out.
- Passwords are bcrypt with cost 12.
- Sign-in returns the same message for an unknown email and a wrong password,
  and runs a hash comparison either way, so it cannot be used to enumerate
  accounts.
- Shopify webhooks are verified against the **raw** request body with a
  constant-time comparison. An unverified delivery is rejected and not stored.
- The cron endpoints require a shared secret, compared in constant time.
- Every administrative action — user changes, role changes, mapping changes,
  cost classification changes, metric approvals, syncs, brief sends, AI queries
  — is written to the audit log with the actor, time and IP.
