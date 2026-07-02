-- Seed data for P2P match-invoice parity tests.
-- Golden dataset: deterministic test scenarios for the four acceptance criteria.
-- Idempotent: truncate fact_acct and re-seed on every run.

TRUNCATE fact_acct RESTART IDENTITY CASCADE;

-- Currencies
INSERT INTO c_currency VALUES (100, 'USD', 2) ON CONFLICT DO NOTHING;

-- Accounting schema (Standard costing, USD base)
INSERT INTO c_acctschema VALUES (1, 100, 4, 'S') ON CONFLICT DO NOTHING;
-- AveragePO schema for AC3
INSERT INTO c_acctschema VALUES (2, 100, 4, 'A') ON CONFLICT DO NOTHING;

-- Chart of accounts
INSERT INTO acct_element VALUES (1, 'NotInvoicedReceipts', 'Not-Invoiced Receipts') ON CONFLICT DO NOTHING;
INSERT INTO acct_element VALUES (2, 'InventoryClearing',   'Inventory Clearing')    ON CONFLICT DO NOTHING;
INSERT INTO acct_element VALUES (3, 'InvoicePriceVariance', 'Invoice Price Variance') ON CONFLICT DO NOTHING;
INSERT INTO acct_element VALUES (4, 'Asset',               'Product Asset')          ON CONFLICT DO NOTHING;
INSERT INTO acct_element VALUES (5, 'AverageCostVariance', 'Average Cost Variance') ON CONFLICT DO NOTHING;

-- Products
INSERT INTO m_product VALUES (10, 'Widget-A', 'S') ON CONFLICT DO NOTHING;      -- Standard costing
INSERT INTO m_product VALUES (20, 'Widget-B', 'S') ON CONFLICT DO NOTHING;      -- Standard costing (price variance)
INSERT INTO m_product VALUES (30, 'Widget-C', 'A') ON CONFLICT DO NOTHING;      -- AveragePO costing

-- ========================================================================
-- SCENARIO 1 (AC1): Match at PO price — balanced, no IPV
-- PO price = 10.00, Invoice price = 10.00, Qty = 5
-- ========================================================================
INSERT INTO c_order VALUES (100, 100, '2025-01-15') ON CONFLICT DO NOTHING;
INSERT INTO c_orderline VALUES (1001, 100, 10, 5.0000, 10.0000) ON CONFLICT DO NOTHING;

INSERT INTO m_inout VALUES (200, 100, '2025-01-20', 100) ON CONFLICT DO NOTHING;
INSERT INTO m_inoutline VALUES (2001, 200, 1001, 10, 5.0000) ON CONFLICT DO NOTHING;

INSERT INTO c_invoice VALUES (300, 100, '2025-01-25', '2025-01-25', 50.00, FALSE) ON CONFLICT DO NOTHING;
INSERT INTO c_invoiceline VALUES (3001, 300, 10, 5.0000, 10.0000, 50.00) ON CONFLICT DO NOTHING;

INSERT INTO m_matchinv VALUES (4001, 3001, 2001, 10, '2025-01-25', '2025-01-25', 5.0000, NULL, FALSE) ON CONFLICT DO NOTHING;

-- Receipt posting (upstream: Doc_InOut posted the receipt with NIR CR)
INSERT INTO fact_acct (ad_table_id, record_id, line_id, c_acctschema_id, account_id, c_currency_id,
  amtsourcedr, amtsourcecr, amtacctdr, amtacctcr, qty, postingtype, dateacct)
VALUES (319, 200, 2001, 1, 1, 100, 0.00, 50.00, 0.00, 50.00, -5.0000, 'A', '2025-01-20');

-- Invoice posting (upstream: Doc_Invoice posted with InventoryClearing DR)
INSERT INTO fact_acct (ad_table_id, record_id, line_id, c_acctschema_id, account_id, c_currency_id,
  amtsourcedr, amtsourcecr, amtacctdr, amtacctcr, qty, postingtype, dateacct)
VALUES (318, 300, 3001, 1, 2, 100, 50.00, 0.00, 50.00, 0.00, 5.0000, 'A', '2025-01-25');

-- ========================================================================
-- SCENARIO 2 (AC2): Match at price above PO — IPV captures difference
-- PO price = 10.00, Invoice price = 12.00, Qty = 5
-- IPV = (12 - 10) * 5 = 10.00
-- ========================================================================
INSERT INTO c_order VALUES (101, 100, '2025-02-01') ON CONFLICT DO NOTHING;
INSERT INTO c_orderline VALUES (1002, 101, 20, 5.0000, 10.0000) ON CONFLICT DO NOTHING;

INSERT INTO m_inout VALUES (201, 101, '2025-02-05', 100) ON CONFLICT DO NOTHING;
INSERT INTO m_inoutline VALUES (2002, 201, 1002, 20, 5.0000) ON CONFLICT DO NOTHING;

INSERT INTO c_invoice VALUES (301, 100, '2025-02-10', '2025-02-10', 60.00, FALSE) ON CONFLICT DO NOTHING;
INSERT INTO c_invoiceline VALUES (3002, 301, 20, 5.0000, 12.0000, 60.00) ON CONFLICT DO NOTHING;

INSERT INTO m_matchinv VALUES (4002, 3002, 2002, 20, '2025-02-10', '2025-02-10', 5.0000, NULL, FALSE) ON CONFLICT DO NOTHING;

-- Receipt posting (NIR CR = 50.00 at PO price)
INSERT INTO fact_acct (ad_table_id, record_id, line_id, c_acctschema_id, account_id, c_currency_id,
  amtsourcedr, amtsourcecr, amtacctdr, amtacctcr, qty, postingtype, dateacct)
VALUES (319, 201, 2002, 1, 1, 100, 0.00, 50.00, 0.00, 50.00, -5.0000, 'A', '2025-02-05');

-- Invoice posting (InventoryClearing DR = 60.00 at invoice price)
INSERT INTO fact_acct (ad_table_id, record_id, line_id, c_acctschema_id, account_id, c_currency_id,
  amtsourcedr, amtsourcecr, amtacctdr, amtacctcr, qty, postingtype, dateacct)
VALUES (318, 301, 3002, 1, 2, 100, 60.00, 0.00, 60.00, 0.00, 5.0000, 'A', '2025-02-10');

-- ========================================================================
-- SCENARIO 3 (AC3): AveragePO costing with stock coverage split
-- PO price = 10.00, Invoice price = 14.00, Qty matched = 5
-- IPV total = (14 - 10) * 5 = 20.00
-- Current stock qty = 3 (less than matched qty 5)
-- amtAsset = 3 * 20 / 5 = 12.00  (goes to Asset account)
-- amtVariance = 20 - 12 = 8.00   (goes to AverageCostVariance account)
-- ========================================================================
INSERT INTO c_order VALUES (102, 100, '2025-03-01') ON CONFLICT DO NOTHING;
INSERT INTO c_orderline VALUES (1003, 102, 30, 5.0000, 10.0000) ON CONFLICT DO NOTHING;

INSERT INTO m_inout VALUES (202, 102, '2025-03-05', 100) ON CONFLICT DO NOTHING;
INSERT INTO m_inoutline VALUES (2003, 202, 1003, 30, 5.0000) ON CONFLICT DO NOTHING;

INSERT INTO c_invoice VALUES (302, 100, '2025-03-10', '2025-03-10', 70.00, FALSE) ON CONFLICT DO NOTHING;
INSERT INTO c_invoiceline VALUES (3003, 302, 30, 5.0000, 14.0000, 70.00) ON CONFLICT DO NOTHING;

INSERT INTO m_matchinv VALUES (4003, 3003, 2003, 30, '2025-03-10', '2025-03-10', 5.0000, NULL, FALSE) ON CONFLICT DO NOTHING;

-- Receipt posting (NIR CR = 50.00 at PO price)
INSERT INTO fact_acct (ad_table_id, record_id, line_id, c_acctschema_id, account_id, c_currency_id,
  amtsourcedr, amtsourcecr, amtacctdr, amtacctcr, qty, postingtype, dateacct)
VALUES (319, 202, 2003, 2, 1, 100, 0.00, 50.00, 0.00, 50.00, -5.0000, 'A', '2025-03-05');

-- Invoice posting (InventoryClearing DR = 70.00 at invoice price)
INSERT INTO fact_acct (ad_table_id, record_id, line_id, c_acctschema_id, account_id, c_currency_id,
  amtsourcedr, amtsourcecr, amtacctdr, amtacctcr, qty, postingtype, dateacct)
VALUES (318, 302, 3003, 2, 2, 100, 70.00, 0.00, 70.00, 0.00, 5.0000, 'A', '2025-03-10');

-- ========================================================================
-- SCENARIO 4 (AC4): Reversal — mirrors the original amounts exactly
-- Reverses Scenario 2 (match 4002). reversal_id points back to original.
-- The reversal re-reads SUM(AmtSourceDr/Cr) from Fact_Acct for match 4002.
-- ========================================================================
INSERT INTO m_matchinv VALUES (4004, 3002, 2002, 20, '2025-02-15', '2025-02-15', -5.0000, 4002, FALSE) ON CONFLICT DO NOTHING;
