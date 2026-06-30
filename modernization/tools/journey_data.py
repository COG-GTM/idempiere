"""Mock Oracle data-estate profile for the iDempiere modernization demo.

Stands in for live profiling queries against the legacy Oracle warehouse. Each
journey maps to its primary document tables with representative row volumes, so
the enrichment step can size the migration without real DB credentials. Swap
`profile_journey()` for real `oracledb`/`psycopg` queries to go live.
"""

from __future__ import annotations

# journey -> [(table, approx_rows)]
JOURNEY_TABLES = {
    "order-to-cash": [
        ("C_Order", 1_180_000),
        ("C_OrderLine", 4_210_000),
        ("M_InOut", 905_000),
        ("C_Invoice", 1_120_000),
        ("C_InvoiceLine", 4_180_000),
        ("C_Payment", 870_000),
        ("C_AllocationHdr", 760_000),
    ],
    "procure-to-pay": [
        ("M_Requisition", 220_000),
        ("C_Order", 540_000),
        ("M_InOut", 610_000),
        ("C_Invoice", 580_000),
        ("M_MatchPO", 1_350_000),
        ("C_Payment", 470_000),
    ],
    "record-to-report": [
        ("GL_Journal", 410_000),
        ("Fact_Acct", 12_800_000),
        ("C_BankStatement", 96_000),
        ("C_Cash", 41_000),
    ],
    "inventory": [
        ("M_Movement", 1_020_000),
        ("M_Inventory", 180_000),
        ("M_Production", 95_000),
    ],
    "manufacturing": [
        ("M_Production", 95_000),
        ("M_ProductionLine", 720_000),
    ],
}


def profile_journey(journey: str) -> dict:
    tables = JOURNEY_TABLES.get(journey)
    if not tables:
        return {"found": False, "journey": journey}
    total = sum(rows for _, rows in tables)
    return {
        "found": True,
        "journey": journey,
        "tables": [{"table": t, "rows": r} for t, r in tables],
        "total_rows": total,
    }
