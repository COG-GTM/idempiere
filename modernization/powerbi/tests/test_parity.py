import os

import pytest

from r2r import LEGACY_DIR, PARITY_DIR
from r2r.parity import compare


def test_compare_accepts_dax_column_names(tmp_path):
    exp = tmp_path / "e.csv"
    exp.write_text("period_name,debit,credit\nJan-25,10.00,10.00\n")
    act = tmp_path / "a.csv"
    act.write_text("Period[Period Name],[Debit],[Credit]\nJan-25,10.004,10\n")
    assert compare(exp, act) == []
    act.write_text("Period[Period Name],[Debit],[Credit]\nJan-25,11,10\n")
    assert len(compare(exp, act)) == 1


@pytest.mark.skipif(not os.environ.get("PGHOST"), reason="needs PostgreSQL (PGHOST)")
def test_expected_csvs_match_legacy_sql():
    from r2r.db import connect, load
    from r2r.parity import expected

    with connect() as conn:
        load(conn)
        for sql in sorted(LEGACY_DIR.glob("*.sql")):
            committed = (PARITY_DIR / "expected" / f"{sql.stem}.csv").read_text()
            assert expected(conn, sql.stem).read_text() == committed, f"{sql.stem} expected CSV is stale"
