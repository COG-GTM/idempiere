# Modernization — Devin activity & audit dashboard

A self-contained, no-build page that surfaces **real Devin activity** across the
Oracle&nbsp;&rarr;&nbsp;PostgreSQL modernization demo: sessions spawned by the
observability&nbsp;&rarr;&nbsp;SDLC cascade and the `!plan_migration` playbook, their ACU
consumption, the PRs they opened, and the SonarCloud gate outcome — plus the journey
portfolio (Jira L8N2) and an audit trail of the early pre-repoint runs.

## Viewing

Open `index.html` directly in a browser (`file://` works — data is embedded in `data.js`,
no server or API key required), or serve the folder:

```bash
cd modernization/dashboard && python3 -m http.server 8080
# then open http://localhost:8080
```

## Where the data comes from

`data.js` is a point-in-time snapshot sourced from the **Devin MCP** (no `DEVIN_API_KEY`
needed — the enterprise REST metrics endpoints require an Enterprise-Admin personal key,
which the current key is not):

- `devin_session_search` — enumerate demo-window sessions.
- `devin_session_interact(action="get")` — per-session `acus_consumed`, `status`, `pull_requests`.
- Jira L8N2 epics via the Atlassian MCP.

## Refreshing before a demo

The dashboard is a snapshot, so regenerate `data.js` shortly before presenting:

1. `devin_session_search(created_after=<window start>, first=100)` to list sessions.
2. For each idempiere/L8N2 session, `devin_session_interact(action="get", ...)` for
   `acus_consumed` + `pull_requests` (+ PR state).
3. Update the `sessions`, `preRepoint`, and `generatedAt` fields in `data.js`.

> When an Enterprise-Admin personal API key (`apk_user_…`) becomes available, this can be
> upgraded to a live pull from the v2 `enterprise/sessions` + v3 ACU-consumption endpoints.

## Audit surface

For a full org-level audit log (who ran what, when), use Devin's built-in usage/audit views
in the webapp (Settings). This page is the demo-scoped, presenter-facing roll-up.
