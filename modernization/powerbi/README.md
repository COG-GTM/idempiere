# Record-to-Report → Power BI (demo assets)

Moves iDempiere's Record-to-Report reports into Power BI, with every number checked against the
legacy report logic. Part of the journey-led modernization: R2R is **Carry-Forward**
(epic [L8N2-47](https://cog-gtm.atlassian.net/browse/L8N2-47)), and only its reporting layer moves.

| Legacy iDempiere report | Source | Power BI page |
|---|---|---|
| Trial Balance | `org.idempiere.acct/src/org/idempiere/acct/report/TrialBalance.java` | story |
| Financial statements (Balance Sheet / P&L) | `org.idempiere.acct/src/org/idempiere/acct/report/FinReport.java` | story |
| AR / AP Aging | `org.adempiere.base.process/src/org/compiere/process/Aging.java`, `MAging.java` | story |

## Layout
- `sql/schema.sql`: iDempiere-shaped subset (`Fact_Acct`, `C_ElementValue`, `C_Period`, `C_Invoice`, `C_Payment`, ...).
- `data/*.csv`: deterministic ledger. The chart of accounts is iDempiere's own
  `org.adempiere.server-feature/data/import/AccountingUS.csv`. Transactions are generated (Jan-25 to Sep-26,
  GardenWorld-style orgs, actual and budget postings). Regenerate with `python -m r2r seed`.
- `pbi/iDempiere R2R.pbip`: Power BI project (TMDL semantic model and PBIR report). The `DataFolder` parameter defaults
  to `C:\idempiere\modernization\powerbi\data`.
- `legacy/<report>.sql`: PostgreSQL port of the legacy report's SQL, which is the source of truth for parity.
- `dax/<report>.dax`: the same result queried from the Power BI model.
- `parity/expected/<report>.csv`: legacy output (committed). `parity/actual/` holds Power BI output (not committed).

## Run
```sh
pip install -r requirements.txt
python -m r2r check                       # TMDL/PBIR references resolve against model and data
PGHOST=localhost python -m r2r load       # load data into PostgreSQL
PGHOST=localhost python -m r2r expected gl_period_balance
PGHOST=localhost python -m pytest -q tests
```

## Power BI Desktop (Windows)
```powershell
powershell -ExecutionPolicy Bypass -File tools\windows\Get-R2R.ps1 -Branch <branch>
# open C:\idempiere\modernization\powerbi\pbi\iDempiere R2R.pbip, Refresh
powershell -ExecutionPolicy Bypass -File tools\windows\Invoke-Dax.ps1 -DaxFile dax\gl_period_balance.dax -OutCsv parity\actual\gl_period_balance.csv
python -m r2r compare gl_period_balance
```

## Adding a report (one story = one PR)
1. Port the legacy SQL to `legacy/<report>.sql` and keep the Java filters (`PostingType='A'`, acct schema, date logic).
2. `python -m r2r expected <report>` and commit `parity/expected/<report>.csv`.
3. Add DAX measures to `pbi/iDempiere R2R.SemanticModel/definition/tables/*.tmdl` and a page under
   `pbi/iDempiere R2R.Report/definition/pages/`, then list it in `pages.json`.
4. Add `dax/<report>.dax` and run `python -m r2r check`.
5. In Power BI Desktop on Windows: refresh, screenshot the page, run `Invoke-Dax.ps1`, then `python -m r2r compare <report>`.
