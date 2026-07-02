# O2C Allocation → GL Posting Service (pre-completed migration slice)

This is **one bounded context extracted from the iDempiere monolith and migrated to
PostgreSQL** — the first deployable in the Oracle→PostgreSQL modernization (see
`modernization/analysis/SYSTEM_ANALYSIS.md` §9–§10). It re-implements the
Order-to-Cash **allocation posting** accounting from
`org.idempiere.acct/.../Doc_AllocationHdr.java` (`createFacts`, line 192) on
PostgreSQL-native SQL, instrumented for production observability.

## What it does

`POST /allocations/:id/post` applies an allocation (payment + discount + write-off
settling an invoice) to the general ledger, producing a **balanced set of
`Fact_Acct` lines** mirroring the source engine's GL effects:

| Account | DR/CR | Source |
|---|---|---|
| UnallocatedCash | DR | cash received (payment-date FX rate) |
| DiscountExp | DR | settlement discount |
| WriteOff | DR | write-off |
| Receivable | CR | AR carrying value (invoice-date FX rate) |
| RealizedGain / RealizedLoss | CR / DR | FX movement between invoice and payment dates |

The posting **must balance** (Σ debits = Σ credits); realized FX gain/loss is the
balancing entry for multi-currency settlements.

## The migration that was performed

The conversion-rate lookup in `src/allocation.js` (`getRate`) is the migrated form
of the legacy Oracle SQL — `(+)` outer join → ANSI `LEFT JOIN`, `NVL` → `COALESCE`
(the exact transformations the iDempiere portability layer does at runtime, here
done natively). Oracle `NUMBER` → PostgreSQL `NUMERIC(20,2)` so rounding parity is
testable. See `src/sql/schema.sql` and the comment block in `getRate`.

## Run it

```bash
# Full stack (Postgres + service):
docker compose up --build
# add the Datadog agent too:
DD_API_KEY=... docker compose --profile observability up --build

# Or against any Postgres:
npm install && npm run migrate && npm start
```

## Vercel deployment notes

Use `DATABASE_URL` for the managed Postgres connection, with TLS enabled by the provider (`sslmode=require`).
For the Vercel function, set `DD_API_KEY`, `DD_SITE`, `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `ALLOC_BUG=1`,
and a smaller `RECOMPUTE_SCALE` such as `3000` so the recompute endpoint stays within function limits.
Use `EMBED_DB=1` to force the same in-process database path in a local shell smoke test.
The local docker-compose path still uses the discrete `PG*` variables and the Datadog agent.

Then:
```bash
curl localhost:3001/health
curl -X POST localhost:3001/allocations/600/post   # USD, balanced
curl -X POST localhost:3001/allocations/601/post   # EUR, books 25.00 realized FX loss
curl localhost:3001/allocations/601/facts
```

## Parity tests

```bash
PGHOST=localhost PGUSER=postgres PGPASSWORD=postgres PGDATABASE=o2c npm test
```
Asserts the Oracle-era expected GL (balanced totals, correct realized FX) is
reproduced exactly. Runs in CI (`Modernization CI` → *O2C allocation service*) with
a Postgres service container.

## Observability & the seeded regression

The service is **monitored** by Sentry and Datadog — it does **not** post to Slack
itself. On a posting failure it only:
- **Sentry** (`SENTRY_DSN`) — captures the exception with allocation context.
- **Datadog** (`DD_API_KEY` via the agent) — APM traces (Express + pg) plus
  `o2c.allocation.posting.{success,imbalance}` and `posting.amount` metrics.

Alerting and remediation are owned by those tools' own integrations:

```
app exception  → Sentry issue   → Sentry→Slack alert rule  ┐
app imbalance  → Datadog metric → Datadog→Slack monitor    ┘→ #sam-dd-demo
                                                             → Devin → Jira → session → PR → SonarQube
```

Set **`ALLOC_BUG=1`** to arm the seeded regression: a refactor that drops the
realized-FX balancing entry. Single-currency allocations still post; **multi-currency
allocations break** (`PostingNotBalancedError`, HTTP 422) — a realistic partial
outage that surfaces in Sentry + Datadog (which then alert) and is caught by the
parity test.

All credentials come from the environment and are never logged. The service runs
fully even when every observability integration is unset (they degrade to no-ops).
