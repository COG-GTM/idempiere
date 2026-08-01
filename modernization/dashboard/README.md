# Order-to-Cash Modernization — Operations Dashboard

A self-contained, no-build page that presents the **post-Epic-1 state of the modernization
program** the way a product/ops team would see it: headline KPIs for the migrated Order-to-Cash
allocation slice (now live on PostgreSQL), the five-journey migration portfolio, live-service
health, Oracle&nbsp;&rarr;&nbsp;PostgreSQL data-migration parity, and delivery quality.

It is a product-facing dashboard — it deliberately contains **no internal tooling references**
(no monitoring vendors, no agent/session internals). Just the program and the migrated product.

## Viewing

Open `index.html` directly in a browser (`file://` works — all data is embedded in `data.js`,
no server or API key required), or serve the folder:

```bash
cd modernization/dashboard && python3 -m http.server 8080
# then open http://localhost:8080
```

## Data

`data.js` is a point-in-time snapshot (`window.DASHBOARD`) with these sections:

- `kpis` — headline program/service metrics (journeys migrated, postings, balanced rate, GL
  parity vs Oracle, latency, reconciliation SLA).
- `portfolio` — the five user-journey epics, their disposition, status, and migration progress.
- `service` — operational health of the live `o2c-allocation` service (throughput, balanced rate,
  posting latency, failures).
- `parity` — data-migration parity checks comparing Oracle-era output to PostgreSQL.
- `delivery` — delivery quality for the modernization workstream (stories, PRs, quality-gate
  pass rate, parity tests).

## Refreshing before a demo

The dashboard is a snapshot — update the numbers and `generatedAt` in `data.js` shortly before
presenting so the figures reflect the current program state. No build step; just edit and reload.
