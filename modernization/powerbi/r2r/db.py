"""Load the seeded ledger into PostgreSQL (the stand-in for iDempiere's database)."""
from __future__ import annotations

import os

import psycopg

from . import DATA_DIR, SQL_DIR
from .seed import COLUMNS

LOAD_ORDER = ["ad_org", "c_elementvalue", "c_year", "c_period", "r2r_date", "c_bp_group", "c_bpartner",
              "c_paymentterm", "c_invoice", "c_payment", "fact_acct"]


def dsn() -> str:
    return os.environ.get("R2R_DSN") or "host={} port={} user={} password={} dbname={}".format(
        os.environ.get("PGHOST", "localhost"), os.environ.get("PGPORT", "5432"), os.environ.get("PGUSER", "postgres"),
        os.environ.get("PGPASSWORD", "postgres"), os.environ.get("PGDATABASE", "r2r"))


def connect() -> psycopg.Connection:
    return psycopg.connect(dsn(), autocommit=True)


def load(conn: psycopg.Connection) -> dict[str, int]:
    conn.execute((SQL_DIR / "schema.sql").read_text())
    counts = {}
    for table in LOAD_ORDER:
        cols = ", ".join(COLUMNS[table])
        with conn.cursor() as cur:
            with cur.copy(f"COPY {table} ({cols}) FROM STDIN WITH (FORMAT csv, HEADER true, NULL '')") as cp:
                cp.write((DATA_DIR / f"{table}.csv").read_bytes())
            counts[table] = conn.execute(f"SELECT count(*) FROM {table}").fetchone()[0]
    return counts
