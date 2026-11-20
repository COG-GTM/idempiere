# Modernization workstream (demo assets)

Devin-generated assets for the **journey-led Oracle/COTS → PostgreSQL modernization** of this
iDempiere stand-in. These live under `modernization/` and are intentionally separate from the
project's real `migration/` SQL upgrade scripts.

**Architecture:** [`ARCHITECTURE.md`](ARCHITECTURE.md) shows how these parts fit around the monolith
([diagram](diagrams/architecture.png), editable Graphviz source [`diagrams/architecture.dot`](diagrams/architecture.dot)).

| Path | What it is |
|---|---|
| `ARCHITECTURE.md`, `diagrams/` | Architecture of the modernization assets, with the Graphviz diagram (DOT, PNG, SVG). |
| `analysis/SYSTEM_ANALYSIS.md` | Source-grounded analysis of the monolith: posting engine, journeys, Oracle coupling, decomposition. |
| `plan/MIGRATION_PLAN.md` | Journey carry-forward/rewrite matrix, Oracle-coupling inventory, phased roadmap, risks. |
| `services/o2c-allocation/` | First migrated deployable: O2C allocation → GL posting (Node/Express). Runs on PostgreSQL 16 or embedded PGlite, deploys to Vercel, reports to Sentry + Datadog. |
| `powerbi/` | R2R → Power BI: iDempiere-shaped PostgreSQL ledger, TMDL semantic model + GL Overview report, legacy-SQL vs DAX parity harness. |
| `journey-map/` | Interactive user-journey map (React + React Flow), deployed to GitHub Pages. |
| `tools/` | Pre-work context enrichment: live CI (GitHub Actions) + SonarCloud, mock data-estate profile + downstream-systems registry, Slack notifier, program metrics. |
| `DANA_HOWTO.md` | Guided Dana (Data Analyst Devin) example for profiling the mock data estate. |

## Interactive journey map
- Live: **https://cog-gtm.github.io/idempiere/**
- Local: `cd journey-map && npm ci && npm run dev`
- Color = disposition: green Carry-Forward · amber Refactor · red Rewrite. Click a node for class/tables/source.

## Enrichment tooling
```bash
cd tools && pip install -r requirements.txt
python enrich_context.py --journey order-to-cash --branch <branch> --post-to L8N2-XX
```
Live sources use `GH_TOKEN`/`GITHUB_TOKEN` and `SONAR_TOKEN`; Jira posting uses `JIRA_EMAIL`/`JIRA_API_TOKEN`.
Data-estate volumes and the downstream registry are mocked (`journey_data.py`, `downstream/registry.json`).

## O2C allocation service
```bash
cd services/o2c-allocation && npm ci
EMBED_DB=1 npm start          # embedded PGlite, no database needed; open http://localhost:3001
npm test                      # parity tests (PG* env or EMBED_DB=1)
```
Full stack with PostgreSQL 16 and a Datadog agent: `docker compose up`. See the [service README](services/o2c-allocation/README.md).

## R2R → Power BI
```bash
cd powerbi && pip install -r requirements.txt
python -m r2r check                         # model / file-reference check
PGHOST=localhost python -m pytest -q tests  # includes the legacy-SQL parity test
```
Power BI Desktop refresh and DAX runs are Windows-only; see the [Power BI README](powerbi/README.md).

## CI
- `.github/workflows/modernization-ci.yml` — PR gate: build the map, run tooling tests, run o2c-allocation parity tests on PostgreSQL 16. R2R tests are not in CI yet.
- `.github/workflows/sonarcloud-modernization.yml` — SonarCloud quality gate on `modernization/` PRs; a failed gate posts to Slack to trigger Devin.
- `.github/workflows/journey-map-pages.yml` — build + deploy the map to GitHub Pages.
- `.github/workflows/vercel-deploy-o2c.yml` — deploy o2c-allocation to Vercel production on `master` pushes.
- `.github/workflows/sonarqube.yml` — the project's existing full SonarCloud analysis (manual dispatch).

*Reproducible via the "Legacy migration — plan & start" Devin playbook.*
