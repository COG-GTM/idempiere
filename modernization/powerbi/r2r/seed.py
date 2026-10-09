"""Deterministic GardenWorld-style ledger for the R2R reports.

The chart of accounts is iDempiere's own US chart (AccountingUS.csv, the file the
Initial Client Setup imports). Transactions are generated, balanced per document,
and written as CSVs that both PostgreSQL (parity harness) and Power BI Desktop load.
"""
from __future__ import annotations

import calendar
import csv
import random
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path

from . import CHART_OF_ACCOUNTS, DATA_DIR

SEED = 20260930
AS_OF = date(2026, 9, 30)
FIRST = date(2025, 1, 1)
CLIENT_ID, ACCTSCHEMA_ID, USD = 11, 101, 100
T_INVOICE, T_PAYMENT, T_JOURNAL = 318, 335, 224
TAX_RATE = Decimal("0.08")
CENT = Decimal("0.01")

ACCOUNT_TYPES = {"Asset": "A", "Liability": "L", "Owner's Equity": "O", "Revenue": "R", "Expense": "E", "Memo": "M"}
ORGS = [(11, "HQ", "HQ"), (12, "Store Central", "Store Central"), (50001, "Store North", "Store North"), (50002, "Store South", "Store South")]
TRADING_ORGS = [12, 50001, 50002]
BP_GROUPS = [(103, "Standard Customers"), (104, "Gold Customers"), (105, "Vendors")]
PAYMENT_TERMS = [(105, "Immediate", 0), (106, "30 Net", 30), (107, "2%10 Net 30", 30), (108, "60 Net", 60)]
CUSTOMERS = ["Joe Block", "C&W Construction", "Patio Fun, Inc.", "Garden Design Studio", "Greenfield Landscaping",
             "Riverside Nursery", "Oak & Ivy Hotels", "Sunset Golf Club", "Hillcrest Schools", "Metro Parks Dept",
             "Blue Lake Resort", "Valley Homes", "Cedar Office Park", "Harbor Restaurants", "Northside Clinic"]
VENDORS = ["Seed Farm Inc.", "Tree Farm Inc.", "Fertilizer Supply Co.", "Patio Furniture Mfg", "Tools & Hardware Ltd",
           "Garden Logistics", "Valley Utilities", "Brightline Telecom"]


def money(x) -> Decimal:
    return Decimal(x).quantize(CENT, rounding=ROUND_HALF_UP)


def month_starts(start: date, end: date):
    d = date(start.year, start.month, 1)
    while d <= end:
        yield d
        d = date(d.year + (d.month == 12), d.month % 12 + 1, 1)


def month_end(d: date) -> date:
    return date(d.year, d.month, calendar.monthrange(d.year, d.month)[1])


def load_chart(path: Path = CHART_OF_ACCOUNTS) -> list[dict]:
    rows = list(csv.DictReader(path.open(encoding="utf-8")))
    by_value: dict[str, dict] = {}
    out = []
    for i, r in enumerate(rows):
        value = (r.get("[Account_Value]") or "").strip()
        if not value:
            continue
        acc = {
            "c_elementvalue_id": 1000 + i,
            "value": value,
            "name": r["[Account_Name]"].strip(),
            "accounttype": ACCOUNT_TYPES[r["[Account_Type]"].strip()],
            "accounttype_name": r["[Account_Type]"].strip(),
            "accountsign": {"Debit": "D", "Credit": "C"}.get((r["[Account_Sign]"] or "").strip(), "N"),
            "issummary": "Y" if r["[Account_Summary]"].strip() == "Yes" else "N",
            "parent_value": (r["[Account_Parent]"] or "").strip() or None,
            "balancesheet_line": (r["[Balance Sheet_Name]"] or "").strip() or None,
            "profitloss_line": (r["[Profit & Loss_Name]"] or "").strip() or None,
        }
        by_value[value] = acc
        out.append(acc)
    for acc in out:
        parent = by_value.get(acc["parent_value"]) if acc["parent_value"] else None
        acc["parent_id"] = parent["c_elementvalue_id"] if parent else None
        chain, node = [], acc
        while node:
            chain.append(node)
            node = by_value.get(node["parent_value"]) if node["parent_value"] else None
        chain.reverse()
        labels = [f'{n["value"]} {n["name"]}' for n in chain if n["issummary"] == "Y"]
        acc["level1"] = labels[0] if labels else f'{acc["value"]} {acc["name"]}'
        acc["level2"] = labels[1] if len(labels) > 1 else None
        acc["level3"] = labels[2] if len(labels) > 2 else None
        acc["isbalancesheet"] = "Y" if acc["accounttype"] in "ALO" else "N"
    return out


class Ledger:
    def __init__(self, accounts: list[dict]):
        self.acct = {a["value"]: a for a in accounts}
        self.periods: dict[tuple[int, int], int] = {}
        self.facts: list[dict] = []

    def post(self, doc_date: date, org: int, table: int, record: int, lines, bpartner=None, desc="", posting="A"):
        dr = sum(l[1] for l in lines)
        cr = sum(l[2] for l in lines)
        assert dr == cr, f"unbalanced document {table}/{record}: {dr} != {cr}"
        for value, amt_dr, amt_cr in lines:
            a = self.acct[value]
            assert a["issummary"] == "N", f"posting to summary account {value}"
            self.facts.append({
                "fact_acct_id": len(self.facts) + 1, "ad_client_id": CLIENT_ID, "ad_org_id": org,
                "c_acctschema_id": ACCTSCHEMA_ID, "account_id": a["c_elementvalue_id"],
                "datetrx": doc_date, "dateacct": doc_date,
                "c_period_id": self.periods[(doc_date.year, doc_date.month)],
                "ad_table_id": table, "record_id": record, "postingtype": posting, "c_currency_id": USD,
                "amtsourcedr": amt_dr, "amtsourcecr": amt_cr, "amtacctdr": amt_dr, "amtacctcr": amt_cr,
                "c_bpartner_id": bpartner, "description": desc,
            })


def generate(out_dir: Path = DATA_DIR) -> dict[str, int]:
    rng = random.Random(SEED)
    accounts = load_chart()
    led = Ledger(accounts)
    z = money(0)

    years = [{"c_year_id": 1000 + y, "fiscalyear": str(y)} for y in (2025, 2026)]
    periods, dates = [], []
    for m in month_starts(FIRST, date(2026, 12, 1)):
        pid = 1000 + (m.year - 2025) * 12 + m.month
        led.periods[(m.year, m.month)] = pid
        periods.append({"c_period_id": pid, "c_year_id": 1000 + m.year, "name": m.strftime("%b-%y"),
                        "periodno": m.month, "startdate": m, "enddate": month_end(m), "periodsort": m.year * 100 + m.month})
    d = FIRST
    while d <= date(2026, 12, 31):
        dates.append({"date": d, "year": d.year, "monthno": d.month, "monthname": d.strftime("%b"),
                      "yearmonth": d.strftime("%Y-%m"), "yearmonthsort": d.year * 100 + d.month})
        d += timedelta(days=1)

    bpartners = []
    for i, name in enumerate(CUSTOMERS):
        bpartners.append({"c_bpartner_id": 120 + i, "value": f"C{120 + i}", "name": name,
                          "c_bp_group_id": 104 if i % 4 == 1 else 103, "iscustomer": "Y", "isvendor": "N"})
    for i, name in enumerate(VENDORS):
        bpartners.append({"c_bpartner_id": 200 + i, "value": f"V{200 + i}", "name": name,
                          "c_bp_group_id": 105, "iscustomer": "N", "isvendor": "Y"})
    customers = [b for b in bpartners if b["iscustomer"] == "Y"]
    vendors = [b for b in bpartners if b["isvendor"] == "Y"]
    supply_vendors, utility_vendor, telecom_vendor = vendors[:6], vendors[6], vendors[7]

    invoices, payments = [], []
    seq = {"inv": 100000, "pay": 200000, "jnl": 300000}

    def nxt(k):
        seq[k] += 1
        return seq[k]

    # Opening balances (GL journal) — balance sheet only.
    opening = [("11100", money(250000), z), ("14120", money(180000), z), ("16100", money(150000), z),
               ("16200", money(400000), z), ("17300", money(120000), z), ("17400", money(45000), z),
               ("21100", z, money(60000)), ("24200", z, money(300000)), ("31000", z, money(500000)),
               ("32900", z, money(285000))]
    led.post(FIRST, 11, T_JOURNAL, nxt("jnl"), opening, desc="Opening balance 2025")

    def pay_invoice(inv, pay_date, amount):
        pid = nxt("pay")
        is_receipt = inv["issotrx"] == "Y"
        payments.append({"c_payment_id": pid, "documentno": str(pid), "ad_org_id": inv["ad_org_id"],
                         "c_bpartner_id": inv["c_bpartner_id"], "c_invoice_id": inv["c_invoice_id"],
                         "isreceipt": "Y" if is_receipt else "N", "datetrx": pay_date, "payamt": amount, "docstatus": "CO"})
        if is_receipt:
            lines = [("11100", amount, z), ("12110", z, amount)]
        else:
            lines = [("21100", amount, z), ("11100", z, amount)]
        led.post(pay_date, inv["ad_org_id"], T_PAYMENT, pid, lines, inv["c_bpartner_id"], f"Payment {pid}")

    for m in month_starts(FIRST, AS_OF):
        me = month_end(m)
        growth = Decimal(1) + Decimal(m.year - 2025) * Decimal("0.12") + Decimal(m.month) * Decimal("0.005")
        season = Decimal("1.35") if m.month in (4, 5, 6) else Decimal("0.75") if m.month in (12, 1, 2) else Decimal(1)
        for org in TRADING_ORGS:
            # AR invoices: revenue, tax, cost of goods.
            month_cogs = z
            for _ in range(rng.randint(12, 18)):
                day = m + timedelta(days=rng.randint(0, (me - m).days))
                cust = rng.choice(customers)
                term = rng.choice(PAYMENT_TERMS[1:]) if cust["c_bp_group_id"] == 104 else rng.choice(PAYMENT_TERMS)
                net = money(Decimal(rng.randint(1500, 12000)) * growth * season)
                tax = money(net * TAX_RATE)
                gross = net + tax
                iid = nxt("inv")
                inv = {"c_invoice_id": iid, "documentno": str(iid), "ad_org_id": org, "c_bpartner_id": cust["c_bpartner_id"],
                       "issotrx": "Y", "dateinvoiced": day, "dateacct": day, "c_paymentterm_id": term[0],
                       "c_currency_id": USD, "totallines": net, "grandtotal": gross, "docstatus": "CO"}
                invoices.append(inv)
                led.post(day, org, T_INVOICE, iid, [("12110", gross, z), ("41000", z, net), ("21610", z, tax)],
                         cust["c_bpartner_id"], f"AR invoice {iid}")
                cogs = money(net * Decimal(rng.randint(46, 56)) / 100)
                led.post(day, org, T_INVOICE, iid, [("51100", cogs, z), ("14120", z, cogs)], cust["c_bpartner_id"],
                         f"CoGS invoice {iid}")
                month_cogs += cogs
                # Receipt behaviour: most pay near terms, some late, some partially, some still open.
                due = day + timedelta(days=term[2])
                roll = rng.random()
                if roll < 0.82:
                    pay_date = due + timedelta(days=rng.randint(-5, 10))
                    amount = gross
                elif roll < 0.93:
                    pay_date = due + timedelta(days=rng.randint(25, 80))
                    amount = gross
                elif roll < 0.97:
                    pay_date = due + timedelta(days=rng.randint(0, 20))
                    amount = money(gross * Decimal(rng.choice([25, 40, 50, 60])) / 100)
                else:
                    pay_date = None
                    amount = z
                if pay_date and pay_date <= AS_OF:
                    pay_invoice(inv, max(pay_date, day), amount)
            # AP invoices for stock.
            restock = money(month_cogs * Decimal(rng.randint(95, 108)) / 100)
            for n in range(3):
                day = m + timedelta(days=rng.randint(0, (me - m).days))
                vend = rng.choice(supply_vendors)
                net = money(restock / 3) if n < 2 else restock - 2 * money(restock / 3)
                iid = nxt("inv")
                inv = {"c_invoice_id": iid, "documentno": str(iid), "ad_org_id": org, "c_bpartner_id": vend["c_bpartner_id"],
                       "issotrx": "N", "dateinvoiced": day, "dateacct": day, "c_paymentterm_id": 106,
                       "c_currency_id": USD, "totallines": net, "grandtotal": net, "docstatus": "CO"}
                invoices.append(inv)
                led.post(day, org, T_INVOICE, iid, [("14120", net, z), ("21100", z, net)], vend["c_bpartner_id"],
                         f"AP invoice {iid}")
                pay_date = day + timedelta(days=rng.randint(20, 45))
                if pay_date <= AS_OF:
                    pay_invoice(inv, pay_date, net)
            # Monthly operating costs, paid from the bank.
            opex = [("60130", 18000), ("60110", 9500), ("60410", 2100), ("60510", 1800), ("61100", 6500),
                    ("62100", 1200), ("66300", 650), ("72100", 400), ("70200", 120)]
            lines = []
            for value, base in opex:
                amt = money(Decimal(base) * growth * Decimal(rng.randint(92, 108)) / 100)
                lines.append((value, amt, z))
            total = sum(l[1] for l in lines)
            lines.append(("11100", z, total))
            led.post(me, org, T_JOURNAL, nxt("jnl"), lines, desc=f"Operating costs {m:%b-%y}")
            for vend, value, base in ((utility_vendor, "61200", 900), (telecom_vendor, "63100", 350)):
                net = money(Decimal(base) * Decimal(rng.randint(85, 120)) / 100)
                iid = nxt("inv")
                inv = {"c_invoice_id": iid, "documentno": str(iid), "ad_org_id": org, "c_bpartner_id": vend["c_bpartner_id"],
                       "issotrx": "N", "dateinvoiced": me, "dateacct": me, "c_paymentterm_id": 106,
                       "c_currency_id": USD, "totallines": net, "grandtotal": net, "docstatus": "CO"}
                invoices.append(inv)
                led.post(me, org, T_INVOICE, iid, [(value, net, z), ("21100", z, net)], vend["c_bpartner_id"],
                         f"AP invoice {iid}")
                pay_date = me + timedelta(days=rng.randint(15, 28))
                if pay_date <= AS_OF:
                    pay_invoice(inv, pay_date, net)
            # Budget postings (PostingType B): the legacy reports exclude these from actuals.
            budget_rev = money(Decimal(52000) * growth * season)
            budget_cogs = money(budget_rev * Decimal("0.58"))
            led.post(m, org, T_JOURNAL, nxt("jnl"),
                     [("51100", budget_cogs, z), ("79200", budget_rev - budget_cogs, z), ("41000", z, budget_rev)],
                     desc=f"Budget {m:%b-%y}", posting="B")
        # HQ: depreciation, mortgage interest, bank interest.
        dep = [("67120", "18120", money(1333.33)), ("67230", "18230", money(1000)), ("67240", "18240", money(750))]
        led.post(me, 11, T_JOURNAL, nxt("jnl"), [l for e, a, amt in dep for l in ((e, amt, z), (a, z, amt))],
                 desc=f"Depreciation {m:%b-%y}")
        interest = money(1250 - (m.year - 2025) * 60)
        principal = money(1500)
        led.post(me, 11, T_JOURNAL, nxt("jnl"),
                 [("82200", interest, z), ("24200", principal, z), ("11100", z, interest + principal)],
                 desc=f"Mortgage {m:%b-%y}")
        bank_int = money(Decimal(rng.randint(180, 420)))
        led.post(me, 11, T_JOURNAL, nxt("jnl"), [("11100", bank_int, z), ("80100", z, bank_int)],
                 desc=f"Bank interest {m:%b-%y}")

    tables = {
        "ad_org": [{"ad_org_id": i, "value": v, "name": n} for i, v, n in ORGS],
        "c_elementvalue": accounts,
        "c_year": years,
        "c_period": periods,
        "r2r_date": dates,
        "c_bp_group": [{"c_bp_group_id": i, "name": n} for i, n in BP_GROUPS],
        "c_bpartner": bpartners,
        "c_paymentterm": [{"c_paymentterm_id": i, "name": n, "netdays": d} for i, n, d in PAYMENT_TERMS],
        "c_invoice": invoices,
        "c_payment": payments,
        "fact_acct": led.facts,
    }
    out_dir.mkdir(parents=True, exist_ok=True)
    for name, rows in tables.items():
        write_csv(out_dir / f"{name}.csv", rows, COLUMNS[name])
    return {name: len(rows) for name, rows in tables.items()}


COLUMNS = {
    "ad_org": ["ad_org_id", "value", "name"],
    "c_elementvalue": ["c_elementvalue_id", "value", "name", "accounttype", "accounttype_name", "accountsign", "issummary",
                       "parent_id", "parent_value", "level1", "level2", "level3", "isbalancesheet",
                       "balancesheet_line", "profitloss_line"],
    "c_year": ["c_year_id", "fiscalyear"],
    "c_period": ["c_period_id", "c_year_id", "name", "periodno", "startdate", "enddate", "periodsort"],
    "r2r_date": ["date", "year", "monthno", "monthname", "yearmonth", "yearmonthsort"],
    "c_bp_group": ["c_bp_group_id", "name"],
    "c_bpartner": ["c_bpartner_id", "value", "name", "c_bp_group_id", "iscustomer", "isvendor"],
    "c_paymentterm": ["c_paymentterm_id", "name", "netdays"],
    "c_invoice": ["c_invoice_id", "documentno", "ad_org_id", "c_bpartner_id", "issotrx", "dateinvoiced", "dateacct",
                  "c_paymentterm_id", "c_currency_id", "totallines", "grandtotal", "docstatus"],
    "c_payment": ["c_payment_id", "documentno", "ad_org_id", "c_bpartner_id", "c_invoice_id", "isreceipt", "datetrx",
                  "payamt", "docstatus"],
    "fact_acct": ["fact_acct_id", "ad_client_id", "ad_org_id", "c_acctschema_id", "account_id", "datetrx", "dateacct",
                  "c_period_id", "ad_table_id", "record_id", "postingtype", "c_currency_id", "amtsourcedr", "amtsourcecr",
                  "amtacctdr", "amtacctcr", "c_bpartner_id", "description"],
}


def write_csv(path: Path, rows: list[dict], columns: list[str]) -> None:
    with path.open("w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh, lineterminator="\n")
        w.writerow(columns)
        for r in rows:
            w.writerow(["" if r.get(c) is None else (r[c].isoformat() if isinstance(r[c], date) else r[c]) for c in columns])
