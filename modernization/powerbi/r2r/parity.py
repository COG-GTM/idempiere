"""Parity harness.

expected: run a legacy-report SQL port (legacy/<report>.sql) against PostgreSQL and
          write parity/expected/<report>.csv — what iDempiere would have shown.
compare:  diff a Power BI result (parity/actual/<report>.csv, exported from Power BI
          Desktop by tools/windows/Invoke-Dax.ps1 running dax/<report>.dax) against it.
"""
from __future__ import annotations

import csv
import re
from decimal import Decimal, InvalidOperation
from pathlib import Path

from . import LEGACY_DIR, PARITY_DIR

TOLERANCE = Decimal("0.01")


def expected(conn, report: str) -> Path:
    sql = (LEGACY_DIR / f"{report}.sql").read_text()
    with conn.cursor() as cur:
        cur.execute(sql)
        cols = [d.name for d in cur.description]
        rows = cur.fetchall()
    out = PARITY_DIR / "expected" / f"{report}.csv"
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh, lineterminator="\n")
        w.writerow(cols)
        for r in rows:
            w.writerow(["" if v is None else v for v in r])
    return out


def normalise(name: str) -> str:
    """'Period[Period Name]' / '[Debit]' / 'period_name' -> 'period name'."""
    m = re.search(r"\[([^\]]+)\]\s*$", name)
    name = m.group(1) if m else name
    return re.sub(r"[\s_]+", " ", name.strip().lower())


def _num(v: str):
    v = (v or "").strip()
    if v == "":
        return Decimal(0)
    try:
        return Decimal(v)
    except InvalidOperation:
        return None


def read(path: Path) -> tuple[list[str], list[dict]]:
    with path.open(encoding="utf-8-sig", newline="") as fh:
        r = csv.reader(fh)
        header = [normalise(h) for h in next(r)]
        return header, [dict(zip(header, row)) for row in r]


def compare(expected_csv: Path, actual_csv: Path) -> list[str]:
    """Return a list of human-readable mismatches (empty list = parity)."""
    exp_cols, exp_rows = read(expected_csv)
    act_cols, act_rows = read(actual_csv)
    missing = [c for c in exp_cols if c not in act_cols]
    if missing:
        return [f"columns missing from Power BI result: {missing} (got {act_cols})"]
    numeric = [c for c in exp_cols if exp_rows and all(_num(r[c]) is not None for r in exp_rows)]
    keys = [c for c in exp_cols if c not in numeric]

    def key(r):
        return tuple((r.get(k) or "").strip() for k in keys)

    act_by_key = {}
    for r in act_rows:
        act_by_key[key(r)] = r
    problems = []
    for r in exp_rows:
        a = act_by_key.pop(key(r), None)
        if a is None:
            problems.append(f"row missing in Power BI: {dict(zip(keys, key(r)))}")
            continue
        for c in numeric:
            ev, av = _num(r[c]), _num(a.get(c, ""))
            if av is None or abs(ev - av) > TOLERANCE:
                problems.append(f"{dict(zip(keys, key(r)))} {c}: iDempiere={ev} Power BI={a.get(c)}")
    for k, a in act_by_key.items():
        if any(_num(a.get(c, "")) not in (None, Decimal(0)) for c in numeric):
            problems.append(f"extra row in Power BI: {dict(zip(keys, k))}")
    return problems
