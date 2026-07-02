-- P2P Match-Invoice posting slice. PostgreSQL-native schema.
-- Mirrors the iDempiere tables on the match-invoice posting path (simplified):
--   C_Currency, M_Product, C_Order/Line, M_InOut/Line, C_Invoice/Line,
--   M_MatchInv, M_CostElement, Fact_Acct, plus a chart of accounts.
-- NUMERIC columns replace Oracle NUMBER for rounding-parity testing.

CREATE TABLE IF NOT EXISTS c_currency (
  c_currency_id   INTEGER PRIMARY KEY,
  iso_code        TEXT NOT NULL,
  stddprecision   INTEGER NOT NULL DEFAULT 2
);

CREATE TABLE IF NOT EXISTS c_acctschema (
  c_acctschema_id INTEGER PRIMARY KEY,
  c_currency_id   INTEGER NOT NULL REFERENCES c_currency,
  costingprecision INTEGER NOT NULL DEFAULT 4,
  costingmethod   TEXT NOT NULL DEFAULT 'S'  -- S=Standard, A=AveragePO, I=AverageInvoice
);

CREATE TABLE IF NOT EXISTS acct_element (
  account_id INTEGER PRIMARY KEY,
  acct_type  TEXT NOT NULL,
  name       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS m_product (
  m_product_id INTEGER PRIMARY KEY,
  name         TEXT NOT NULL,
  costingmethod TEXT NOT NULL DEFAULT 'S'
);

CREATE TABLE IF NOT EXISTS c_order (
  c_order_id    INTEGER PRIMARY KEY,
  c_currency_id INTEGER NOT NULL REFERENCES c_currency,
  dateordered   DATE NOT NULL
);

CREATE TABLE IF NOT EXISTS c_orderline (
  c_orderline_id INTEGER PRIMARY KEY,
  c_order_id     INTEGER NOT NULL REFERENCES c_order,
  m_product_id   INTEGER NOT NULL REFERENCES m_product,
  qtyordered     NUMERIC(20,4) NOT NULL,
  priceactual    NUMERIC(20,4) NOT NULL
);

CREATE TABLE IF NOT EXISTS m_inout (
  m_inout_id    INTEGER PRIMARY KEY,
  c_order_id    INTEGER REFERENCES c_order,
  movementdate  DATE NOT NULL,
  c_currency_id INTEGER NOT NULL REFERENCES c_currency
);

CREATE TABLE IF NOT EXISTS m_inoutline (
  m_inoutline_id INTEGER PRIMARY KEY,
  m_inout_id     INTEGER NOT NULL REFERENCES m_inout,
  c_orderline_id INTEGER REFERENCES c_orderline,
  m_product_id   INTEGER NOT NULL REFERENCES m_product,
  movementqty    NUMERIC(20,4) NOT NULL
);

CREATE TABLE IF NOT EXISTS c_invoice (
  c_invoice_id  INTEGER PRIMARY KEY,
  c_currency_id INTEGER NOT NULL REFERENCES c_currency,
  dateinvoiced  DATE NOT NULL,
  dateacct      DATE NOT NULL,
  grandtotal    NUMERIC(20,2) NOT NULL,
  iscreditmemo  BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS c_invoiceline (
  c_invoiceline_id INTEGER PRIMARY KEY,
  c_invoice_id     INTEGER NOT NULL REFERENCES c_invoice,
  m_product_id     INTEGER NOT NULL REFERENCES m_product,
  qtyinvoiced      NUMERIC(20,4) NOT NULL,
  priceactual      NUMERIC(20,4) NOT NULL,
  linenetamt       NUMERIC(20,2) NOT NULL
);

CREATE TABLE IF NOT EXISTS m_matchinv (
  m_matchinv_id INTEGER PRIMARY KEY,
  c_invoiceline_id INTEGER NOT NULL REFERENCES c_invoiceline,
  m_inoutline_id   INTEGER NOT NULL REFERENCES m_inoutline,
  m_product_id     INTEGER NOT NULL REFERENCES m_product,
  datetrx          DATE NOT NULL,
  dateacct         DATE NOT NULL,
  qty              NUMERIC(20,4) NOT NULL,
  reversal_id      INTEGER,
  posted           BOOLEAN NOT NULL DEFAULT FALSE
);

-- The GL. Mirrors Fact_Acct columns used in Doc_MatchInv SUM re-reads.
CREATE TABLE IF NOT EXISTS fact_acct (
  fact_acct_id   BIGSERIAL PRIMARY KEY,
  ad_table_id    INTEGER NOT NULL,
  record_id      INTEGER NOT NULL,
  line_id        INTEGER,
  c_acctschema_id INTEGER NOT NULL REFERENCES c_acctschema,
  account_id     INTEGER NOT NULL REFERENCES acct_element,
  c_currency_id  INTEGER NOT NULL REFERENCES c_currency,
  amtsourcedr    NUMERIC(20,2) NOT NULL DEFAULT 0,
  amtsourcecr    NUMERIC(20,2) NOT NULL DEFAULT 0,
  amtacctdr      NUMERIC(20,2) NOT NULL DEFAULT 0,
  amtacctcr      NUMERIC(20,2) NOT NULL DEFAULT 0,
  qty            NUMERIC(20,4),
  postingtype    TEXT NOT NULL DEFAULT 'A',
  description    TEXT,
  dateacct       DATE NOT NULL,
  created        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fact_acct_record ON fact_acct (ad_table_id, record_id);
CREATE INDEX IF NOT EXISTS idx_fact_acct_account ON fact_acct (c_acctschema_id, account_id);
