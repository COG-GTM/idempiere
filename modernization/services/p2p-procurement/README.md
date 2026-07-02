# P2P Procurement — Schema Parity Service

PostgreSQL-native DDL for the 7 procurement tables with Oracle-era precision, indexes, and sequence semantics.

**Ticket:** [L8N2-67](https://cog-gtm.atlassian.net/browse/L8N2-67)
**Epic:** [L8N2-46 — Procure-to-Pay \[Refactor\]](https://cog-gtm.atlassian.net/browse/L8N2-46)

## Quick start

```bash
# Start Postgres
docker run -d --name p2p-pg -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=p2p -p 5433:5432 postgres:16

# Install + run
npm ci
PGHOST=localhost PGPORT=5433 PGUSER=postgres PGPASSWORD=postgres PGDATABASE=p2p npm start

# Tests
PGHOST=localhost PGPORT=5433 PGUSER=postgres PGPASSWORD=postgres PGDATABASE=p2p npm test
```

## Tables

| Table | Purpose |
|---|---|
| `m_requisition` | Purchase requisitions |
| `c_order` | Purchase orders |
| `m_inout` | Material receipts |
| `c_invoice` | AP invoices |
| `m_matchpo` | PO ↔ Receipt matching |
| `m_matchinv` | Invoice ↔ Receipt matching |
| `c_payment` | Vendor payments |
