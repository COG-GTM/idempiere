# Modernization workstream (demo assets)

Devin-generated assets for the **journey-led Oracle/COTS → PostgreSQL modernization** of this
iDempiere stand-in. These live under `modernization/` and are intentionally separate from the
project's real `migration/` SQL upgrade scripts.

| Path | What it is |
|---|---|
| `plan/MIGRATION_PLAN.md` | Journey carry-forward/rewrite matrix, Oracle-coupling inventory, phased roadmap, risks. |
| `journey-map/` | Interactive user-journey map (React + React Flow), deployed to GitHub Pages. |
| `tools/` | Pre-work context enrichment: live CI (GitHub Actions) + SonarCloud, mock data-estate profile + downstream-systems registry. |

## Interactive journey map
- Live: **https://cog-gtm.github.io/idempiere/** (after Pages is enabled — Settings → Pages → Source: GitHub Actions)
- Local: `cd journey-map && npm ci && npm run dev`
- Color = disposition: green Carry-Forward · amber Refactor · red Rewrite. Click a node for class/tables/source.

## Enrichment tooling
```bash
cd tools && pip install -r requirements.txt
python enrich_context.py --journey order-to-cash --branch <branch> --post-to L8N2-XX
```
Live sources use `GH_TOKEN`/`GITHUB_TOKEN` and `SONAR_TOKEN`; Jira posting uses `JIRA_EMAIL`/`JIRA_API_TOKEN`.
Data-estate volumes and the downstream registry are mocked (`journey_data.py`, `downstream/registry.json`).

## CI
- `.github/workflows/modernization-ci.yml` — fast PR gate (build the map, run tooling tests).
- `.github/workflows/journey-map-pages.yml` — build + deploy the map to GitHub Pages.
- `.github/workflows/sonarqube.yml` — the project's existing full SonarCloud analysis (manual dispatch).

*Reproducible via the "Legacy migration — plan & start" Devin playbook.*
