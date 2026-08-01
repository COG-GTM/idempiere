-- P2P Procurement schema parity slice. PostgreSQL-native DDL.
-- Mirrors the iDempiere Oracle-era tables on the procurement path:
--   M_Requisition, C_Order, M_InOut, C_Invoice, M_MatchPO, M_MatchInv, C_Payment
-- plus required reference tables (C_Currency, C_BPartner, C_DocType, M_Product,
-- M_Warehouse, M_PriceList, AD_User).
--
-- NUMBER→NUMERIC precision mapping (AdempiereDatabase.java:438 / DisplayType.java):
--   _ID columns:   NUMERIC(10)  — Oracle NUMBER(10)
--   Amounts:        NUMERIC(20,2) — Oracle NUMBER, std-precision 2
--   Quantities:     NUMERIC(20,8) — Oracle NUMBER, extended precision
--   ProcessedOn:    NUMERIC      — Oracle NUMBER (epoch-seconds, no fixed scale)
--
-- Boolean (IsActive, IsApproved, …) use CHAR(1) to match Oracle-era Y/N semantics.
-- Dates use TIMESTAMP WITHOUT TIME ZONE (Oracle DATE equivalent).
-- UU columns use VARCHAR(36) (UUID text representation).
--
-- Sequences follow MSequence.java:79 pattern: one PostgreSQL SEQUENCE per table,
-- named <table>_sq, used for primary-key allocation.

-- ============================================================
-- Reference / lookup tables
-- ============================================================

CREATE TABLE IF NOT EXISTS c_currency (
  c_currency_id   NUMERIC(10) PRIMARY KEY,
  iso_code        VARCHAR(3) NOT NULL,
  stddprecision   NUMERIC(10) NOT NULL DEFAULT 2
);

CREATE TABLE IF NOT EXISTS c_bpartner (
  c_bpartner_id   NUMERIC(10) PRIMARY KEY,
  name            VARCHAR(60) NOT NULL,
  isactive        CHAR(1) NOT NULL DEFAULT 'Y'
);

CREATE TABLE IF NOT EXISTS c_doctype (
  c_doctype_id    NUMERIC(10) PRIMARY KEY,
  name            VARCHAR(60) NOT NULL,
  docbasetype     VARCHAR(3) NOT NULL,
  isactive        CHAR(1) NOT NULL DEFAULT 'Y'
);

CREATE TABLE IF NOT EXISTS m_product (
  m_product_id    NUMERIC(10) PRIMARY KEY,
  name            VARCHAR(60) NOT NULL,
  isactive        CHAR(1) NOT NULL DEFAULT 'Y'
);

CREATE TABLE IF NOT EXISTS m_warehouse (
  m_warehouse_id  NUMERIC(10) PRIMARY KEY,
  name            VARCHAR(60) NOT NULL,
  isactive        CHAR(1) NOT NULL DEFAULT 'Y'
);

CREATE TABLE IF NOT EXISTS m_pricelist (
  m_pricelist_id  NUMERIC(10) PRIMARY KEY,
  name            VARCHAR(60) NOT NULL,
  c_currency_id   NUMERIC(10) NOT NULL REFERENCES c_currency,
  isactive        CHAR(1) NOT NULL DEFAULT 'Y'
);

CREATE TABLE IF NOT EXISTS ad_user (
  ad_user_id      NUMERIC(10) PRIMARY KEY,
  name            VARCHAR(60) NOT NULL,
  isactive        CHAR(1) NOT NULL DEFAULT 'Y'
);

-- ============================================================
-- Procurement document tables (7 tables)
-- ============================================================

-- ---------- 1. M_Requisition ----------
CREATE SEQUENCE IF NOT EXISTS m_requisition_sq START WITH 1000000 INCREMENT BY 1;

CREATE TABLE IF NOT EXISTS m_requisition (
  m_requisition_id        NUMERIC(10) PRIMARY KEY DEFAULT nextval('m_requisition_sq'),
  m_requisition_uu        VARCHAR(36) DEFAULT gen_random_uuid()::text,
  ad_client_id            NUMERIC(10) NOT NULL,
  ad_org_id               NUMERIC(10) NOT NULL,
  isactive                CHAR(1) NOT NULL DEFAULT 'Y',
  created                 TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now(),
  createdby               NUMERIC(10) NOT NULL,
  updated                 TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now(),
  updatedby               NUMERIC(10) NOT NULL,
  ad_user_id              NUMERIC(10) NOT NULL REFERENCES ad_user,
  c_doctype_id            NUMERIC(10) NOT NULL REFERENCES c_doctype,
  documentno              VARCHAR(30) NOT NULL,
  datedoc                 TIMESTAMP WITHOUT TIME ZONE NOT NULL,
  daterequired            TIMESTAMP WITHOUT TIME ZONE NOT NULL,
  description             VARCHAR(255),
  help                    VARCHAR(2000),
  docaction               VARCHAR(2) NOT NULL DEFAULT 'CO',
  docstatus               VARCHAR(2) NOT NULL DEFAULT 'DR',
  isapproved              CHAR(1) NOT NULL DEFAULT 'N',
  m_pricelist_id          NUMERIC(10) NOT NULL REFERENCES m_pricelist,
  m_warehouse_id          NUMERIC(10) NOT NULL REFERENCES m_warehouse,
  posted                  CHAR(1) NOT NULL DEFAULT 'N',
  priorityrule            VARCHAR(1) NOT NULL DEFAULT '5',
  processed               CHAR(1) NOT NULL DEFAULT 'N',
  processedon             NUMERIC,
  processing              CHAR(1) DEFAULT 'N',
  totallines              NUMERIC(20,2) NOT NULL DEFAULT 0
);

-- ---------- 2. C_Order ----------
CREATE SEQUENCE IF NOT EXISTS c_order_sq START WITH 1000000 INCREMENT BY 1;

CREATE TABLE IF NOT EXISTS c_order (
  c_order_id              NUMERIC(10) PRIMARY KEY DEFAULT nextval('c_order_sq'),
  c_order_uu              VARCHAR(36) DEFAULT gen_random_uuid()::text,
  ad_client_id            NUMERIC(10) NOT NULL,
  ad_org_id               NUMERIC(10) NOT NULL,
  ad_orgtrx_id            NUMERIC(10),
  isactive                CHAR(1) NOT NULL DEFAULT 'Y',
  created                 TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now(),
  createdby               NUMERIC(10) NOT NULL,
  updated                 TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now(),
  updatedby               NUMERIC(10) NOT NULL,
  ad_user_id              NUMERIC(10) REFERENCES ad_user,
  c_bpartner_id           NUMERIC(10) NOT NULL REFERENCES c_bpartner,
  c_bpartner_location_id  NUMERIC(10),
  bill_bpartner_id        NUMERIC(10) REFERENCES c_bpartner,
  bill_location_id        NUMERIC(10),
  bill_user_id            NUMERIC(10),
  c_currency_id           NUMERIC(10) NOT NULL REFERENCES c_currency,
  c_doctype_id            NUMERIC(10) NOT NULL REFERENCES c_doctype,
  c_doctypetarget_id      NUMERIC(10) REFERENCES c_doctype,
  c_paymentterm_id        NUMERIC(10),
  c_payment_id            NUMERIC(10),
  c_activity_id           NUMERIC(10),
  c_campaign_id           NUMERIC(10),
  c_charge_id             NUMERIC(10),
  c_conversiontype_id     NUMERIC(10),
  c_project_id            NUMERIC(10),
  documentno              VARCHAR(30) NOT NULL,
  dateordered             TIMESTAMP WITHOUT TIME ZONE NOT NULL,
  dateacct                TIMESTAMP WITHOUT TIME ZONE NOT NULL,
  datepromised             TIMESTAMP WITHOUT TIME ZONE,
  dateprinted             TIMESTAMP WITHOUT TIME ZONE,
  description             VARCHAR(255),
  docaction               VARCHAR(2) NOT NULL DEFAULT 'CO',
  docstatus               VARCHAR(2) NOT NULL DEFAULT 'DR',
  chargeamt               NUMERIC(20,2) NOT NULL DEFAULT 0,
  freightamt              NUMERIC(20,2) NOT NULL DEFAULT 0,
  grandtotal              NUMERIC(20,2) NOT NULL DEFAULT 0,
  totallines              NUMERIC(20,2) NOT NULL DEFAULT 0,
  deliveryrule            VARCHAR(1) NOT NULL DEFAULT 'A',
  deliveryviarule         VARCHAR(1) NOT NULL DEFAULT 'P',
  freightcostrule         VARCHAR(1) NOT NULL DEFAULT 'I',
  invoicerule             VARCHAR(1) NOT NULL DEFAULT 'I',
  paymentrule             VARCHAR(1) NOT NULL DEFAULT 'P',
  priorityrule            VARCHAR(1) NOT NULL DEFAULT '5',
  isapproved              CHAR(1) NOT NULL DEFAULT 'N',
  iscreditapproved        CHAR(1) NOT NULL DEFAULT 'N',
  isdelivered             CHAR(1) NOT NULL DEFAULT 'N',
  isdiscountprinted       CHAR(1) NOT NULL DEFAULT 'N',
  isdropship              CHAR(1) NOT NULL DEFAULT 'N',
  isinvoiced              CHAR(1) NOT NULL DEFAULT 'N',
  ispayschedulevalid      CHAR(1) NOT NULL DEFAULT 'N',
  isprinted               CHAR(1) NOT NULL DEFAULT 'N',
  issotrx                 CHAR(1) NOT NULL DEFAULT 'Y',
  isselected              CHAR(1) NOT NULL DEFAULT 'N',
  isselfservice            CHAR(1) NOT NULL DEFAULT 'N',
  istaxincluded           CHAR(1) NOT NULL DEFAULT 'N',
  istransferred           CHAR(1) NOT NULL DEFAULT 'N',
  m_pricelist_id          NUMERIC(10) REFERENCES m_pricelist,
  m_shipper_id            NUMERIC(10),
  m_warehouse_id          NUMERIC(10) NOT NULL REFERENCES m_warehouse,
  poreference             VARCHAR(20),
  posted                  CHAR(1) NOT NULL DEFAULT 'N',
  processed               CHAR(1) NOT NULL DEFAULT 'N',
  processedon             NUMERIC,
  processing              CHAR(1) DEFAULT 'N'
);

-- ---------- 3. M_InOut (Material Receipt / Shipment) ----------
CREATE SEQUENCE IF NOT EXISTS m_inout_sq START WITH 1000000 INCREMENT BY 1;

CREATE TABLE IF NOT EXISTS m_inout (
  m_inout_id              NUMERIC(10) PRIMARY KEY DEFAULT nextval('m_inout_sq'),
  m_inout_uu              VARCHAR(36) DEFAULT gen_random_uuid()::text,
  ad_client_id            NUMERIC(10) NOT NULL,
  ad_org_id               NUMERIC(10) NOT NULL,
  ad_orgtrx_id            NUMERIC(10),
  isactive                CHAR(1) NOT NULL DEFAULT 'Y',
  created                 TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now(),
  createdby               NUMERIC(10) NOT NULL,
  updated                 TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now(),
  updatedby               NUMERIC(10) NOT NULL,
  ad_user_id              NUMERIC(10) REFERENCES ad_user,
  c_bpartner_id           NUMERIC(10) NOT NULL REFERENCES c_bpartner,
  c_bpartner_location_id  NUMERIC(10),
  c_doctype_id            NUMERIC(10) NOT NULL REFERENCES c_doctype,
  c_order_id              NUMERIC(10) REFERENCES c_order,
  c_invoice_id            NUMERIC(10),
  c_activity_id           NUMERIC(10),
  c_campaign_id           NUMERIC(10),
  c_charge_id             NUMERIC(10),
  c_project_id            NUMERIC(10),
  documentno              VARCHAR(30) NOT NULL,
  movementdate            TIMESTAMP WITHOUT TIME ZONE NOT NULL,
  dateacct                TIMESTAMP WITHOUT TIME ZONE NOT NULL,
  dateordered             TIMESTAMP WITHOUT TIME ZONE,
  datereceived            TIMESTAMP WITHOUT TIME ZONE,
  dateprinted             TIMESTAMP WITHOUT TIME ZONE,
  description             VARCHAR(255),
  docaction               VARCHAR(2) NOT NULL DEFAULT 'CO',
  docstatus               VARCHAR(2) NOT NULL DEFAULT 'DR',
  chargeamt               NUMERIC(20,2) NOT NULL DEFAULT 0,
  freightamt              NUMERIC(20,2) NOT NULL DEFAULT 0,
  volume                  NUMERIC(20,2),
  weight                  NUMERIC(20,2),
  deliveryrule            VARCHAR(1) NOT NULL DEFAULT 'A',
  deliveryviarule         VARCHAR(1) NOT NULL DEFAULT 'P',
  freightcostrule         VARCHAR(1) NOT NULL DEFAULT 'I',
  movementtype            VARCHAR(2) NOT NULL,
  priorityrule            VARCHAR(1) NOT NULL DEFAULT '5',
  isapproved              CHAR(1) NOT NULL DEFAULT 'N',
  isdropship              CHAR(1) NOT NULL DEFAULT 'N',
  isindispute             CHAR(1) NOT NULL DEFAULT 'N',
  isintransit             CHAR(1) NOT NULL DEFAULT 'N',
  isprinted               CHAR(1) NOT NULL DEFAULT 'N',
  issotrx                 CHAR(1) NOT NULL DEFAULT 'Y',
  m_rma_id                NUMERIC(10),
  m_shipper_id            NUMERIC(10),
  m_warehouse_id          NUMERIC(10) NOT NULL REFERENCES m_warehouse,
  nopackages              NUMERIC(10),
  poreference             VARCHAR(20),
  posted                  CHAR(1) NOT NULL DEFAULT 'N',
  processed               CHAR(1) NOT NULL DEFAULT 'N',
  processedon             NUMERIC,
  processing              CHAR(1) DEFAULT 'N',
  salesrep_id             NUMERIC(10),
  trackingno              VARCHAR(60),
  reversal_id             NUMERIC(10)
);

-- ---------- 4. C_Invoice ----------
CREATE SEQUENCE IF NOT EXISTS c_invoice_sq START WITH 1000000 INCREMENT BY 1;

CREATE TABLE IF NOT EXISTS c_invoice (
  c_invoice_id            NUMERIC(10) PRIMARY KEY DEFAULT nextval('c_invoice_sq'),
  c_invoice_uu            VARCHAR(36) DEFAULT gen_random_uuid()::text,
  ad_client_id            NUMERIC(10) NOT NULL,
  ad_org_id               NUMERIC(10) NOT NULL,
  ad_orgtrx_id            NUMERIC(10),
  isactive                CHAR(1) NOT NULL DEFAULT 'Y',
  created                 TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now(),
  createdby               NUMERIC(10) NOT NULL,
  updated                 TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now(),
  updatedby               NUMERIC(10) NOT NULL,
  ad_user_id              NUMERIC(10) REFERENCES ad_user,
  c_bpartner_id           NUMERIC(10) NOT NULL REFERENCES c_bpartner,
  c_bpartner_location_id  NUMERIC(10),
  c_currency_id           NUMERIC(10) NOT NULL REFERENCES c_currency,
  c_doctype_id            NUMERIC(10) NOT NULL REFERENCES c_doctype,
  c_doctypetarget_id      NUMERIC(10) REFERENCES c_doctype,
  c_order_id              NUMERIC(10) REFERENCES c_order,
  c_paymentterm_id        NUMERIC(10),
  c_payment_id            NUMERIC(10),
  c_activity_id           NUMERIC(10),
  c_campaign_id           NUMERIC(10),
  c_charge_id             NUMERIC(10),
  c_conversiontype_id     NUMERIC(10),
  c_project_id            NUMERIC(10),
  documentno              VARCHAR(30) NOT NULL,
  dateinvoiced            TIMESTAMP WITHOUT TIME ZONE NOT NULL,
  dateacct                TIMESTAMP WITHOUT TIME ZONE NOT NULL,
  dateordered             TIMESTAMP WITHOUT TIME ZONE,
  dateprinted             TIMESTAMP WITHOUT TIME ZONE,
  description             VARCHAR(255),
  docaction               VARCHAR(2) NOT NULL DEFAULT 'CO',
  docstatus               VARCHAR(2) NOT NULL DEFAULT 'DR',
  chargeamt               NUMERIC(20,2) NOT NULL DEFAULT 0,
  grandtotal              NUMERIC(20,2) NOT NULL DEFAULT 0,
  totallines              NUMERIC(20,2) NOT NULL DEFAULT 0,
  currencyrate            NUMERIC(20,8),
  invoicecollectiontype   VARCHAR(1),
  paymentrule             VARCHAR(1) NOT NULL DEFAULT 'P',
  poreference             VARCHAR(20),
  isapproved              CHAR(1) NOT NULL DEFAULT 'N',
  isdiscountprinted       CHAR(1) NOT NULL DEFAULT 'N',
  isfixedassetinvoice     CHAR(1) NOT NULL DEFAULT 'N',
  isindispute             CHAR(1) NOT NULL DEFAULT 'N',
  isoverridecurrencyrate  CHAR(1) NOT NULL DEFAULT 'N',
  ispaid                  CHAR(1) NOT NULL DEFAULT 'N',
  ispayschedulevalid      CHAR(1) NOT NULL DEFAULT 'N',
  isprinted               CHAR(1) NOT NULL DEFAULT 'N',
  issotrx                 CHAR(1) NOT NULL DEFAULT 'Y',
  isselfservice           CHAR(1) NOT NULL DEFAULT 'N',
  istaxincluded           CHAR(1) NOT NULL DEFAULT 'N',
  istransferred           CHAR(1) NOT NULL DEFAULT 'N',
  m_pricelist_id          NUMERIC(10) REFERENCES m_pricelist,
  m_rma_id                NUMERIC(10),
  posted                  CHAR(1) NOT NULL DEFAULT 'N',
  processed               CHAR(1) NOT NULL DEFAULT 'N',
  processedon             NUMERIC,
  processing              CHAR(1) DEFAULT 'N',
  ref_invoice_id          NUMERIC(10),
  reversal_id             NUMERIC(10),
  salesrep_id             NUMERIC(10)
);

-- ---------- 5. M_MatchPO (PO ↔ Receipt match) ----------
CREATE SEQUENCE IF NOT EXISTS m_matchpo_sq START WITH 1000000 INCREMENT BY 1;

CREATE TABLE IF NOT EXISTS m_matchpo (
  m_matchpo_id            NUMERIC(10) PRIMARY KEY DEFAULT nextval('m_matchpo_sq'),
  m_matchpo_uu            VARCHAR(36) DEFAULT gen_random_uuid()::text,
  ad_client_id            NUMERIC(10) NOT NULL,
  ad_org_id               NUMERIC(10) NOT NULL,
  isactive                CHAR(1) NOT NULL DEFAULT 'Y',
  created                 TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now(),
  createdby               NUMERIC(10) NOT NULL,
  updated                 TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now(),
  updatedby               NUMERIC(10) NOT NULL,
  c_orderline_id          NUMERIC(10) NOT NULL,
  c_invoiceline_id        NUMERIC(10),
  m_inoutline_id          NUMERIC(10) NOT NULL,
  m_product_id            NUMERIC(10) NOT NULL REFERENCES m_product,
  m_attributesetinstance_id NUMERIC(10),
  datetrx                 TIMESTAMP WITHOUT TIME ZONE NOT NULL,
  dateacct                TIMESTAMP WITHOUT TIME ZONE NOT NULL,
  documentno              VARCHAR(30),
  description             VARCHAR(255),
  qty                     NUMERIC(20,8) NOT NULL DEFAULT 0,
  pricematchdifference    NUMERIC(20,2),
  isapproved              CHAR(1) NOT NULL DEFAULT 'N',
  posted                  CHAR(1) NOT NULL DEFAULT 'N',
  processed               CHAR(1) NOT NULL DEFAULT 'N',
  processedon             NUMERIC,
  processing              CHAR(1) DEFAULT 'N',
  ref_matchpo_id          NUMERIC(10),
  reversal_id             NUMERIC(10)
);

-- ---------- 6. M_MatchInv (Invoice ↔ Receipt match) ----------
CREATE SEQUENCE IF NOT EXISTS m_matchinv_sq START WITH 1000000 INCREMENT BY 1;

CREATE TABLE IF NOT EXISTS m_matchinv (
  m_matchinv_id           NUMERIC(10) PRIMARY KEY DEFAULT nextval('m_matchinv_sq'),
  m_matchinv_uu           VARCHAR(36) DEFAULT gen_random_uuid()::text,
  ad_client_id            NUMERIC(10) NOT NULL,
  ad_org_id               NUMERIC(10) NOT NULL,
  isactive                CHAR(1) NOT NULL DEFAULT 'Y',
  created                 TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now(),
  createdby               NUMERIC(10) NOT NULL,
  updated                 TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now(),
  updatedby               NUMERIC(10) NOT NULL,
  c_invoiceline_id        NUMERIC(10) NOT NULL,
  m_inoutline_id          NUMERIC(10),
  m_product_id            NUMERIC(10) NOT NULL REFERENCES m_product,
  m_attributesetinstance_id NUMERIC(10),
  datetrx                 TIMESTAMP WITHOUT TIME ZONE NOT NULL,
  dateacct                TIMESTAMP WITHOUT TIME ZONE NOT NULL,
  documentno              VARCHAR(30),
  description             VARCHAR(255),
  qty                     NUMERIC(20,8) NOT NULL DEFAULT 0,
  posted                  CHAR(1) NOT NULL DEFAULT 'N',
  processed               CHAR(1) NOT NULL DEFAULT 'N',
  processedon             NUMERIC,
  processing              CHAR(1) DEFAULT 'N',
  ref_matchinv_id         NUMERIC(10),
  reversal_id             NUMERIC(10)
);

-- ---------- 7. C_Payment ----------
CREATE SEQUENCE IF NOT EXISTS c_payment_sq START WITH 1000000 INCREMENT BY 1;

CREATE TABLE IF NOT EXISTS c_payment (
  c_payment_id            NUMERIC(10) PRIMARY KEY DEFAULT nextval('c_payment_sq'),
  c_payment_uu            VARCHAR(36) DEFAULT gen_random_uuid()::text,
  ad_client_id            NUMERIC(10) NOT NULL,
  ad_org_id               NUMERIC(10) NOT NULL,
  ad_orgtrx_id            NUMERIC(10),
  isactive                CHAR(1) NOT NULL DEFAULT 'Y',
  created                 TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now(),
  createdby               NUMERIC(10) NOT NULL,
  updated                 TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now(),
  updatedby               NUMERIC(10) NOT NULL,
  c_bpartner_id           NUMERIC(10) NOT NULL REFERENCES c_bpartner,
  c_bankaccount_id        NUMERIC(10),
  c_bp_bankaccount_id     NUMERIC(10),
  c_currency_id           NUMERIC(10) NOT NULL REFERENCES c_currency,
  c_doctype_id            NUMERIC(10) NOT NULL REFERENCES c_doctype,
  c_invoice_id            NUMERIC(10) REFERENCES c_invoice,
  c_order_id              NUMERIC(10) REFERENCES c_order,
  c_charge_id             NUMERIC(10),
  c_conversiontype_id     NUMERIC(10),
  c_activity_id           NUMERIC(10),
  c_campaign_id           NUMERIC(10),
  c_project_id            NUMERIC(10),
  documentno              VARCHAR(30) NOT NULL,
  datetrx                 TIMESTAMP WITHOUT TIME ZONE NOT NULL,
  dateacct                TIMESTAMP WITHOUT TIME ZONE NOT NULL,
  description             VARCHAR(255),
  docaction               VARCHAR(2) NOT NULL DEFAULT 'CO',
  docstatus               VARCHAR(2) NOT NULL DEFAULT 'DR',
  payamt                  NUMERIC(20,2) NOT NULL DEFAULT 0,
  discountamt             NUMERIC(20,2) NOT NULL DEFAULT 0,
  chargeamt               NUMERIC(20,2) NOT NULL DEFAULT 0,
  overunderamt            NUMERIC(20,2) NOT NULL DEFAULT 0,
  currencyrate            NUMERIC(20,8),
  paymentrule             VARCHAR(1) NOT NULL DEFAULT 'S',
  isreceipt               CHAR(1) NOT NULL DEFAULT 'Y',
  isallocated             CHAR(1) NOT NULL DEFAULT 'N',
  isapproved              CHAR(1) NOT NULL DEFAULT 'N',
  isonline                CHAR(1) NOT NULL DEFAULT 'N',
  isoverunderpayment      CHAR(1) NOT NULL DEFAULT 'N',
  isoverridecurrencyrate  CHAR(1) NOT NULL DEFAULT 'N',
  isprepayment            CHAR(1) NOT NULL DEFAULT 'N',
  isreconciled            CHAR(1) NOT NULL DEFAULT 'N',
  isselfservice           CHAR(1) NOT NULL DEFAULT 'N',
  isdelayedcapture        CHAR(1) NOT NULL DEFAULT 'N',
  posted                  CHAR(1) NOT NULL DEFAULT 'N',
  processed               CHAR(1) NOT NULL DEFAULT 'N',
  processedon             NUMERIC,
  processing              CHAR(1) DEFAULT 'N',
  reversal_id             NUMERIC(10)
);

-- ============================================================
-- Document-number sequences (MSequence.java pattern)
-- ============================================================
-- In iDempiere, document numbers are drawn from AD_Sequence or native DB sequences
-- via MSequence.getNextID / getDocumentNo. We mirror this with dedicated sequences.
CREATE SEQUENCE IF NOT EXISTS docno_requisition_sq START WITH 10000 INCREMENT BY 1;
CREATE SEQUENCE IF NOT EXISTS docno_order_sq       START WITH 10000 INCREMENT BY 1;
CREATE SEQUENCE IF NOT EXISTS docno_inout_sq       START WITH 10000 INCREMENT BY 1;
CREATE SEQUENCE IF NOT EXISTS docno_invoice_sq     START WITH 10000 INCREMENT BY 1;
CREATE SEQUENCE IF NOT EXISTS docno_payment_sq     START WITH 10000 INCREMENT BY 1;

-- ============================================================
-- Indexes — high-volume match tables and common query patterns
-- ============================================================

-- M_MatchPO: queries by order line, receipt line, product, and date range
CREATE INDEX IF NOT EXISTS idx_matchpo_orderline     ON m_matchpo (c_orderline_id);
CREATE INDEX IF NOT EXISTS idx_matchpo_inoutline     ON m_matchpo (m_inoutline_id);
CREATE INDEX IF NOT EXISTS idx_matchpo_product       ON m_matchpo (m_product_id);
CREATE INDEX IF NOT EXISTS idx_matchpo_datetrx       ON m_matchpo (datetrx);
CREATE INDEX IF NOT EXISTS idx_matchpo_dateacct      ON m_matchpo (dateacct);
CREATE INDEX IF NOT EXISTS idx_matchpo_posted        ON m_matchpo (posted) WHERE posted = 'N';

-- M_MatchInv: queries by invoice line, receipt line, product, and date range
CREATE INDEX IF NOT EXISTS idx_matchinv_invoiceline  ON m_matchinv (c_invoiceline_id);
CREATE INDEX IF NOT EXISTS idx_matchinv_inoutline    ON m_matchinv (m_inoutline_id);
CREATE INDEX IF NOT EXISTS idx_matchinv_product      ON m_matchinv (m_product_id);
CREATE INDEX IF NOT EXISTS idx_matchinv_datetrx      ON m_matchinv (datetrx);
CREATE INDEX IF NOT EXISTS idx_matchinv_dateacct     ON m_matchinv (dateacct);
CREATE INDEX IF NOT EXISTS idx_matchinv_posted       ON m_matchinv (posted) WHERE posted = 'N';

-- C_Order: common procurement lookups
CREATE INDEX IF NOT EXISTS idx_order_bpartner        ON c_order (c_bpartner_id);
CREATE INDEX IF NOT EXISTS idx_order_docstatus       ON c_order (docstatus);
CREATE INDEX IF NOT EXISTS idx_order_dateordered      ON c_order (dateordered);

-- C_Invoice: common AP lookups
CREATE INDEX IF NOT EXISTS idx_invoice_bpartner      ON c_invoice (c_bpartner_id);
CREATE INDEX IF NOT EXISTS idx_invoice_docstatus     ON c_invoice (docstatus);
CREATE INDEX IF NOT EXISTS idx_invoice_dateinvoiced  ON c_invoice (dateinvoiced);

-- C_Payment: common payment lookups
CREATE INDEX IF NOT EXISTS idx_payment_bpartner      ON c_payment (c_bpartner_id);
CREATE INDEX IF NOT EXISTS idx_payment_docstatus     ON c_payment (docstatus);
CREATE INDEX IF NOT EXISTS idx_payment_datetrx       ON c_payment (datetrx);

-- M_InOut: receipt lookups
CREATE INDEX IF NOT EXISTS idx_inout_bpartner        ON m_inout (c_bpartner_id);
CREATE INDEX IF NOT EXISTS idx_inout_order           ON m_inout (c_order_id);
CREATE INDEX IF NOT EXISTS idx_inout_docstatus       ON m_inout (docstatus);
