"""iDempiere Record-to-Report → Power BI migration toolkit (demo assets)."""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REPO_ROOT = ROOT.parent.parent
DATA_DIR = ROOT / "data"
SQL_DIR = ROOT / "sql"
LEGACY_DIR = ROOT / "legacy"
DAX_DIR = ROOT / "dax"
PARITY_DIR = ROOT / "parity"
PBI_DIR = ROOT / "pbi"
CHART_OF_ACCOUNTS = REPO_ROOT / "org.adempiere.server-feature" / "data" / "import" / "AccountingUS.csv"
