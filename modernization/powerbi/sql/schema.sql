-- iDempiere-shaped subset of the Record-to-Report tables (PostgreSQL).
-- Column names follow the iDempiere Application Dictionary so legacy report SQL
-- (TrialBalance.java, FinReport.java, Aging.java) can be ported with minimal change.
DROP TABLE IF EXISTS fact_acct, c_payment, c_invoice, c_paymentterm, c_bpartner, c_bp_group,
  c_period, c_year, c_elementvalue, ad_org, r2r_date CASCADE;

CREATE TABLE ad_org (
  ad_org_id INTEGER PRIMARY KEY,
  value     TEXT NOT NULL,
  name      TEXT NOT NULL
);

CREATE TABLE c_elementvalue (
  c_elementvalue_id INTEGER PRIMARY KEY,
  value             TEXT NOT NULL UNIQUE,
  name              TEXT NOT NULL,
  accounttype       CHAR(1) NOT NULL,      -- A Asset, L Liability, O Owner's Equity, R Revenue, E Expense, M Memo
  accounttype_name  TEXT NOT NULL,
  accountsign       CHAR(1) NOT NULL,      -- N Natural, D Debit, C Credit
  issummary         CHAR(1) NOT NULL,
  parent_id         INTEGER,
  parent_value      TEXT,
  level1            TEXT NOT NULL,
  level2            TEXT,
  level3            TEXT,
  isbalancesheet    CHAR(1) NOT NULL,
  balancesheet_line TEXT,                  -- [Balance Sheet] report line from AccountingUS.csv
  profitloss_line   TEXT                   -- [Profit & Loss] report line from AccountingUS.csv
);

CREATE TABLE c_year (
  c_year_id   INTEGER PRIMARY KEY,
  fiscalyear  TEXT NOT NULL
);

CREATE TABLE c_period (
  c_period_id INTEGER PRIMARY KEY,
  c_year_id   INTEGER NOT NULL REFERENCES c_year,
  name        TEXT NOT NULL,
  periodno    INTEGER NOT NULL,
  startdate   DATE NOT NULL,
  enddate     DATE NOT NULL,
  periodsort  INTEGER NOT NULL
);

CREATE TABLE r2r_date (
  date        DATE PRIMARY KEY,
  year        INTEGER NOT NULL,
  monthno     INTEGER NOT NULL,
  monthname   TEXT NOT NULL,
  yearmonth   TEXT NOT NULL,
  yearmonthsort INTEGER NOT NULL
);

CREATE TABLE c_bp_group (
  c_bp_group_id INTEGER PRIMARY KEY,
  name          TEXT NOT NULL
);

CREATE TABLE c_bpartner (
  c_bpartner_id INTEGER PRIMARY KEY,
  value         TEXT NOT NULL,
  name          TEXT NOT NULL,
  c_bp_group_id INTEGER NOT NULL REFERENCES c_bp_group,
  iscustomer    CHAR(1) NOT NULL,
  isvendor      CHAR(1) NOT NULL
);

CREATE TABLE c_paymentterm (
  c_paymentterm_id INTEGER PRIMARY KEY,
  name             TEXT NOT NULL,
  netdays          INTEGER NOT NULL
);

CREATE TABLE c_invoice (
  c_invoice_id     INTEGER PRIMARY KEY,
  documentno       TEXT NOT NULL,
  ad_org_id        INTEGER NOT NULL REFERENCES ad_org,
  c_bpartner_id    INTEGER NOT NULL REFERENCES c_bpartner,
  issotrx          CHAR(1) NOT NULL,
  dateinvoiced     DATE NOT NULL,
  dateacct         DATE NOT NULL,
  c_paymentterm_id INTEGER NOT NULL REFERENCES c_paymentterm,
  c_currency_id    INTEGER NOT NULL,
  totallines       NUMERIC(20,2) NOT NULL,
  grandtotal       NUMERIC(20,2) NOT NULL,
  docstatus        CHAR(2) NOT NULL
);

CREATE TABLE c_payment (
  c_payment_id  INTEGER PRIMARY KEY,
  documentno    TEXT NOT NULL,
  ad_org_id     INTEGER NOT NULL REFERENCES ad_org,
  c_bpartner_id INTEGER NOT NULL REFERENCES c_bpartner,
  c_invoice_id  INTEGER REFERENCES c_invoice,
  isreceipt     CHAR(1) NOT NULL,
  datetrx       DATE NOT NULL,
  payamt        NUMERIC(20,2) NOT NULL,
  docstatus     CHAR(2) NOT NULL
);

CREATE TABLE fact_acct (
  fact_acct_id    INTEGER PRIMARY KEY,
  ad_client_id    INTEGER NOT NULL,
  ad_org_id       INTEGER NOT NULL REFERENCES ad_org,
  c_acctschema_id INTEGER NOT NULL,
  account_id      INTEGER NOT NULL REFERENCES c_elementvalue,
  datetrx         DATE NOT NULL,
  dateacct        DATE NOT NULL,
  c_period_id     INTEGER NOT NULL REFERENCES c_period,
  ad_table_id     INTEGER NOT NULL,          -- 318 C_Invoice, 335 C_Payment, 224 GL_Journal
  record_id       INTEGER NOT NULL,
  postingtype     CHAR(1) NOT NULL,          -- A Actual, B Budget
  c_currency_id   INTEGER NOT NULL,
  amtsourcedr     NUMERIC(20,2) NOT NULL,
  amtsourcecr     NUMERIC(20,2) NOT NULL,
  amtacctdr       NUMERIC(20,2) NOT NULL,
  amtacctcr       NUMERIC(20,2) NOT NULL,
  c_bpartner_id   INTEGER REFERENCES c_bpartner,
  description     TEXT
);
CREATE INDEX fact_acct_acct_date ON fact_acct (account_id, dateacct);
