# Dana (Data Analyst Devin) — guided example for the modernization demo

Dana is Devin's **Data Analyst** mode: you connect a data source, ask questions in plain English,
and Dana writes + runs the SQL and returns tables, charts, and a shareable dashboard. For this demo
we use it to **profile the (mock) Oracle data estate** behind each journey, which feeds the
"data volume" axis of the carry-forward/rewrite matrix.

## 1. What to connect
- **For the demo narrative**: the mock estate in `modernization/tools/journey_data.py`
  (`JOURNEY_TABLES` — per-journey table row counts). It's deliberately Oracle-shaped (C_Order,
  C_Invoice, M_InOut, …) so the story reads like the client's real warehouse.
- **For a live data source**: connect Dana to a Postgres/Snowflake/CSV source. To make the mock
  estate queryable, export it to CSV first:
  ```bash
  cd modernization/tools
  python -c "import json,journey_data as j; import csv,sys; w=csv.writer(sys.stdout); w.writerow(['journey','table','rows']); [w.writerow([k,t,r]) for k,v in j.JOURNEY_TABLES.items() for t,r in v]" > estate.csv
  ```
  Then upload `estate.csv` as the Dana data source.

## 2. How to start a Dana session
1. New session → switch mode to **Data Analyst (Dana)**.
2. Add the data source (upload `estate.csv`, or connect Postgres/Snowflake credentials).
3. Ask in plain English (examples below). Dana writes the SQL, runs it, and renders charts.

## 3. Demo prompts (golden path)
- "Which journeys hold the most rows? Show a bar chart of total rows per journey."
- "For Order-to-Cash, break down row counts by table and show the top 5."
- "Estimate relative migration effort assuming effort scales with total rows × number of tables.
  Rank the journeys."
- "Build a dashboard: total rows per journey, table counts per journey, and a migration-sizing
  ranking."

## 4. How it ties back to the matrix
The "data volume" column in `modernization/plan/MIGRATION_PLAN.md` is exactly what Dana surfaces
here. In the demo: show the matrix → "where does *data volume* come from?" → open the Dana
dashboard → "Dana profiled the estate and sized it for us." Carry the ranking into Phase ordering
(highest-volume journeys get dual-write/backfill mitigations).

## 5. Tips
- Dana keeps the SQL it generated — open it to show the audience the actual queries.
- Save the dashboard and share the link; it can be embedded next to the Confluence page.
- To go from mock → real, swap the CSV/`journey_data.py` source for the client's warehouse
  connection; the prompts stay identical.
