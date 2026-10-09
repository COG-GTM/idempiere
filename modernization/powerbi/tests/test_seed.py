import csv
import tempfile
from collections import defaultdict
from decimal import Decimal
from pathlib import Path

from r2r import DATA_DIR
from r2r.seed import generate, load_chart


def test_chart_is_idempiere_us_chart():
    accounts = {a["value"]: a for a in load_chart()}
    assert accounts["12110"]["name"] == "Accounts Receivable - Trade"
    assert accounts["12110"]["level1"] == "1 Assets"
    assert accounts["41000"]["accounttype"] == "R"


def test_committed_data_is_reproducible():
    with tempfile.TemporaryDirectory() as tmp:
        generate(Path(tmp))
        for f in sorted(DATA_DIR.glob("*.csv")):
            assert (Path(tmp) / f.name).read_bytes() == f.read_bytes(), f"{f.name} is stale: run python -m r2r seed"


def test_every_document_balances():
    totals = defaultdict(Decimal)
    with (DATA_DIR / "fact_acct.csv").open() as fh:
        for r in csv.DictReader(fh):
            totals[(r["ad_table_id"], r["record_id"], r["postingtype"])] += Decimal(r["amtacctdr"]) - Decimal(r["amtacctcr"])
    assert totals and all(v == 0 for v in totals.values())
