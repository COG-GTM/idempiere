-- O2C Allocation -> GL posting slice. PostgreSQL-native schema.
-- Mirrors the iDempiere tables on the allocation posting path (simplified):
--   C_Currency, C_Conversion_Rate, C_BPartner, C_Invoice, C_Payment,
--   C_AllocationHdr, C_AllocationLine, Fact_Acct, plus a small chart of accounts.
-- Numeric columns use NUMERIC(20,2)/NUMERIC(20,8) — the deliberate PostgreSQL
-- replacement for Oracle NUMBER, so rounding parity is testable.

CREATE TABLE IF NOT EXISTS c_currency (
  c_currency_id   INTEGER PRIMARY KEY,
  iso_code        TEXT NOT NULL,
  stddprecision   INTEGER NOT NULL DEFAULT 2
);

CREATE TABLE IF NOT EXISTS c_conversion_rate (
  c_conversion_rate_id INTEGER PRIMARY KEY,
  c_currency_id        INTEGER NOT NULL REFERENCES c_currency,
  c_currency_id_to     INTEGER NOT NULL REFERENCES c_currency,
  validfrom            DATE NOT NULL,
  validto              DATE,
  multiplyrate         NUMERIC(20,8) NOT NULL
);

CREATE TABLE IF NOT EXISTS c_bpartner (
  c_bpartner_id INTEGER PRIMARY KEY,
  name          TEXT NOT NULL
);

-- Chart of accounts (stand-in for C_ValidCombination / acct elements).
CREATE TABLE IF NOT EXISTS acct_element (
  account_id INTEGER PRIMARY KEY,
  acct_type  TEXT NOT NULL,   -- Receivable, UnallocatedCash, DiscountExp, WriteOff, RealizedGain, RealizedLoss
  name       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS c_invoice (
  c_invoice_id    INTEGER PRIMARY KEY,
  c_bpartner_id   INTEGER NOT NULL REFERENCES c_bpartner,
  c_currency_id   INTEGER NOT NULL REFERENCES c_currency,
  dateinvoiced    DATE NOT NULL,
  grandtotal      NUMERIC(20,2) NOT NULL,
  issotrx         BOOLEAN NOT NULL DEFAULT TRUE,
  docstatus       TEXT NOT NULL DEFAULT 'CO'
);

CREATE TABLE IF NOT EXISTS c_payment (
  c_payment_id    INTEGER PRIMARY KEY,
  c_bpartner_id   INTEGER NOT NULL REFERENCES c_bpartner,
  c_currency_id   INTEGER NOT NULL REFERENCES c_currency,
  datetrx         DATE NOT NULL,
  payamt          NUMERIC(20,2) NOT NULL,
  docstatus       TEXT NOT NULL DEFAULT 'CO'
);

CREATE TABLE IF NOT EXISTS c_allocationhdr (
  c_allocationhdr_id INTEGER PRIMARY KEY,
  c_currency_id      INTEGER NOT NULL REFERENCES c_currency,  -- allocation (payment) currency
  datetrx            DATE NOT NULL,
  docstatus          TEXT NOT NULL DEFAULT 'CO',
  posted             BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS c_allocationline (
  c_allocationline_id INTEGER PRIMARY KEY,
  c_allocationhdr_id  INTEGER NOT NULL REFERENCES c_allocationhdr ON DELETE CASCADE,
  c_invoice_id        INTEGER REFERENCES c_invoice,
  c_payment_id        INTEGER REFERENCES c_payment,
  c_bpartner_id       INTEGER NOT NULL REFERENCES c_bpartner,
  amount              NUMERIC(20,2) NOT NULL DEFAULT 0,  -- amount allocated (payment ccy)
  discountamt         NUMERIC(20,2) NOT NULL DEFAULT 0,
  writeoffamt         NUMERIC(20,2) NOT NULL DEFAULT 0
);

-- The GL. Mirrors Fact_Acct: each posting produces balanced debit/credit lines.
CREATE TABLE IF NOT EXISTS fact_acct (
  fact_acct_id   BIGSERIAL PRIMARY KEY,
  ad_table_id    INTEGER NOT NULL,       -- source document table id (C_AllocationHdr)
  record_id      INTEGER NOT NULL,       -- source document id
  account_id     INTEGER NOT NULL REFERENCES acct_element,
  c_currency_id  INTEGER NOT NULL REFERENCES c_currency,
  amtsourcedr    NUMERIC(20,2) NOT NULL DEFAULT 0,
  amtsourcecr    NUMERIC(20,2) NOT NULL DEFAULT 0,
  amtacctdr      NUMERIC(20,2) NOT NULL DEFAULT 0,  -- accounting-currency debit
  amtacctcr      NUMERIC(20,2) NOT NULL DEFAULT 0,  -- accounting-currency credit
  description    TEXT,
  dateacct       DATE NOT NULL,
  created        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fact_acct_record ON fact_acct (ad_table_id, record_id);

-- Covering index for GL reconciliation (recomputeBalances). Restores the Oracle-
-- era index coverage that the initial migration dropped, enabling an index-only
-- scan for the per-allocation DR/CR aggregation.
CREATE INDEX IF NOT EXISTS idx_fact_acct_recon
    ON fact_acct (ad_table_id, record_id)
    INCLUDE (amtacctdr, amtacctcr);
