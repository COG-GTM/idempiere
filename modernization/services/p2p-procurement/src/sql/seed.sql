-- Golden-dataset seed for P2P procurement schema parity.
-- Exercises the full procurement flow: Requisition -> PO -> Receipt -> Invoice ->
-- MatchPO -> MatchInv -> Payment. Row counts and checksums are verified in parity tests.

-- Reference data
INSERT INTO c_currency (c_currency_id, iso_code, stddprecision) VALUES
  (100, 'USD', 2), (101, 'EUR', 2)
ON CONFLICT DO NOTHING;

INSERT INTO c_bpartner (c_bpartner_id, name) VALUES
  (200, 'Apex Supplier Co'), (201, 'Global Parts Ltd')
ON CONFLICT DO NOTHING;

INSERT INTO c_doctype (c_doctype_id, name, docbasetype) VALUES
  (300, 'Purchase Requisition', 'POR'),
  (301, 'Purchase Order',       'POO'),
  (302, 'Material Receipt',     'MMR'),
  (303, 'AP Invoice',           'API'),
  (304, 'AP Payment',           'APP')
ON CONFLICT DO NOTHING;

INSERT INTO m_product (m_product_id, name) VALUES
  (400, 'Widget A'), (401, 'Widget B'), (402, 'Gadget X')
ON CONFLICT DO NOTHING;

INSERT INTO m_warehouse (m_warehouse_id, name) VALUES (500, 'Main Warehouse')
ON CONFLICT DO NOTHING;

INSERT INTO m_pricelist (m_pricelist_id, name, c_currency_id) VALUES (600, 'Standard Purchase', 100)
ON CONFLICT DO NOTHING;

INSERT INTO ad_user (ad_user_id, name) VALUES (700, 'Procurement Officer'), (701, 'AP Clerk')
ON CONFLICT DO NOTHING;

-- Requisition: 2 items from Apex Supplier, total USD 2,500.00
INSERT INTO m_requisition (m_requisition_id, ad_client_id, ad_org_id, createdby, updatedby,
  ad_user_id, c_doctype_id, documentno, datedoc, daterequired, m_pricelist_id, m_warehouse_id,
  docstatus, isapproved, processed, totallines) VALUES
  (1001, 11, 11, 700, 700, 700, 300, '10001', '2024-01-05', '2024-01-20', 600, 500,
   'CO', 'Y', 'Y', 2500.00)
ON CONFLICT DO NOTHING;

-- Purchase Orders: PO#1 USD 2500 (Apex), PO#2 EUR 1000 (Global Parts)
INSERT INTO c_order (c_order_id, ad_client_id, ad_org_id, createdby, updatedby,
  c_bpartner_id, c_currency_id, c_doctype_id, documentno, dateordered, dateacct,
  datepromised, m_warehouse_id, issotrx, docstatus, isapproved, processed,
  grandtotal, totallines) VALUES
  (2001, 11, 11, 700, 700, 200, 100, 301, '10001', '2024-01-10', '2024-01-10',
   '2024-01-25', 500, 'N', 'CO', 'Y', 'Y', 2500.00, 2500.00),
  (2002, 11, 11, 700, 700, 201, 101, 301, '10002', '2024-01-12', '2024-01-12',
   '2024-01-30', 500, 'N', 'CO', 'Y', 'Y', 1000.00, 1000.00)
ON CONFLICT DO NOTHING;

-- Material Receipts: received items for both POs
INSERT INTO m_inout (m_inout_id, ad_client_id, ad_org_id, createdby, updatedby,
  c_bpartner_id, c_doctype_id, c_order_id, documentno, movementdate, dateacct,
  movementtype, m_warehouse_id, issotrx, docstatus, isapproved, processed) VALUES
  (3001, 11, 11, 700, 700, 200, 302, 2001, '10001', '2024-01-22', '2024-01-22',
   'V+', 500, 'N', 'CO', 'Y', 'Y'),
  (3002, 11, 11, 700, 700, 201, 302, 2002, '10002', '2024-01-28', '2024-01-28',
   'V+', 500, 'N', 'CO', 'Y', 'Y')
ON CONFLICT DO NOTHING;

-- AP Invoices: INV#1 USD 2500 (Apex), INV#2 EUR 1000 (Global Parts)
INSERT INTO c_invoice (c_invoice_id, ad_client_id, ad_org_id, createdby, updatedby,
  c_bpartner_id, c_currency_id, c_doctype_id, c_order_id, documentno,
  dateinvoiced, dateacct, issotrx, docstatus, isapproved, processed,
  grandtotal, totallines) VALUES
  (4001, 11, 11, 701, 701, 200, 100, 303, 2001, '10001',
   '2024-01-25', '2024-01-25', 'N', 'CO', 'Y', 'Y', 2500.00, 2500.00),
  (4002, 11, 11, 701, 701, 201, 101, 303, 2002, '10002',
   '2024-02-01', '2024-02-01', 'N', 'CO', 'Y', 'Y', 1000.00, 1000.00)
ON CONFLICT DO NOTHING;

-- Match PO: link PO lines to receipt lines (Widget A 100, Widget B 50, Gadget X 25)
INSERT INTO m_matchpo (m_matchpo_id, ad_client_id, ad_org_id, createdby, updatedby,
  c_orderline_id, m_inoutline_id, m_product_id, datetrx, dateacct, qty, processed) VALUES
  (5001, 11, 11, 700, 700, 20011, 30011, 400, '2024-01-22', '2024-01-22', 100.00000000, 'Y'),
  (5002, 11, 11, 700, 700, 20012, 30012, 401, '2024-01-22', '2024-01-22',  50.00000000, 'Y'),
  (5003, 11, 11, 700, 700, 20021, 30021, 402, '2024-01-28', '2024-01-28',  25.00000000, 'Y')
ON CONFLICT DO NOTHING;

-- Match Inv: link invoice lines to receipt lines
INSERT INTO m_matchinv (m_matchinv_id, ad_client_id, ad_org_id, createdby, updatedby,
  c_invoiceline_id, m_inoutline_id, m_product_id, datetrx, dateacct, qty, processed) VALUES
  (6001, 11, 11, 701, 701, 40011, 30011, 400, '2024-01-25', '2024-01-25', 100.00000000, 'Y'),
  (6002, 11, 11, 701, 701, 40012, 30012, 401, '2024-01-25', '2024-01-25',  50.00000000, 'Y'),
  (6003, 11, 11, 701, 701, 40021, 30021, 402, '2024-02-01', '2024-02-01',  25.00000000, 'Y')
ON CONFLICT DO NOTHING;

-- Payments: PAY#1 USD 2500 (Apex), PAY#2 EUR 1000 (Global Parts)
INSERT INTO c_payment (c_payment_id, ad_client_id, ad_org_id, createdby, updatedby,
  c_bpartner_id, c_currency_id, c_doctype_id, c_invoice_id, c_order_id, documentno,
  datetrx, dateacct, payamt, isreceipt, docstatus, isapproved, isallocated, processed) VALUES
  (7001, 11, 11, 701, 701, 200, 100, 304, 4001, 2001, '10001',
   '2024-02-05', '2024-02-05', 2500.00, 'N', 'CO', 'Y', 'Y', 'Y'),
  (7002, 11, 11, 701, 701, 201, 101, 304, 4002, 2002, '10002',
   '2024-02-10', '2024-02-10', 1000.00, 'N', 'CO', 'Y', 'Y', 'Y')
ON CONFLICT DO NOTHING;
