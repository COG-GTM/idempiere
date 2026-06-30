-- Deterministic seed for the allocation posting slice.
-- USD is the accounting currency. EUR invoices exercise the multi-currency
-- realized gain/loss path (the parity-sensitive bit).

INSERT INTO c_currency (c_currency_id, iso_code, stddprecision) VALUES
  (100, 'USD', 2),
  (101, 'EUR', 2)
ON CONFLICT DO NOTHING;

-- EUR->USD rate moved between invoice and payment date => realized FX gain/loss.
INSERT INTO c_conversion_rate (c_conversion_rate_id, c_currency_id, c_currency_id_to, validfrom, validto, multiplyrate) VALUES
  (1, 101, 100, DATE '2024-01-01', DATE '2024-01-31', 1.10000000),
  (2, 101, 100, DATE '2024-02-01', DATE '2024-02-28', 1.05000000),
  (3, 100, 100, DATE '2024-01-01', NULL, 1.00000000)
ON CONFLICT DO NOTHING;

INSERT INTO c_bpartner (c_bpartner_id, name) VALUES
  (200, 'Acme Wholesale'),
  (201, 'Globex Retail')
ON CONFLICT DO NOTHING;

INSERT INTO acct_element (account_id, acct_type, name) VALUES
  (300, 'Receivable',     '1200 Accounts Receivable'),
  (301, 'UnallocatedCash','1150 Unallocated Cash Receipts'),
  (302, 'DiscountExp',    '5100 Payment Discount Expense'),
  (303, 'WriteOff',       '5200 Bad Debt Write-off'),
  (304, 'RealizedGain',   '7100 Realized FX Gain'),
  (305, 'RealizedLoss',   '8100 Realized FX Loss')
ON CONFLICT DO NOTHING;

-- Invoice 1: USD 1,000 to Acme (simple, balanced allocation).
INSERT INTO c_invoice (c_invoice_id, c_bpartner_id, c_currency_id, dateinvoiced, grandtotal) VALUES
  (400, 200, 100, DATE '2024-01-10', 1000.00)
ON CONFLICT DO NOTHING;
-- Invoice 2: EUR 500 to Globex on 2024-01-15 (rate 1.10 => 550.00 USD AR).
INSERT INTO c_invoice (c_invoice_id, c_bpartner_id, c_currency_id, dateinvoiced, grandtotal) VALUES
  (401, 201, 101, DATE '2024-01-15', 500.00)
ON CONFLICT DO NOTHING;

-- Payment 1: USD 980 from Acme (20 settlement discount).
INSERT INTO c_payment (c_payment_id, c_bpartner_id, c_currency_id, datetrx, payamt) VALUES
  (500, 200, 100, DATE '2024-01-20', 980.00)
ON CONFLICT DO NOTHING;
-- Payment 2: EUR 500 from Globex on 2024-02-10 (rate 1.05 => 525.00 USD cash;
--   AR was 550.00 => 25.00 realized FX LOSS).
INSERT INTO c_payment (c_payment_id, c_bpartner_id, c_currency_id, datetrx, payamt) VALUES
  (501, 201, 101, DATE '2024-02-10', 500.00)
ON CONFLICT DO NOTHING;

-- Allocation A (USD): pay 980 + 20 discount against the 1,000 invoice.
INSERT INTO c_allocationhdr (c_allocationhdr_id, c_currency_id, datetrx) VALUES
  (600, 100, DATE '2024-01-20')
ON CONFLICT DO NOTHING;
INSERT INTO c_allocationline (c_allocationline_id, c_allocationhdr_id, c_invoice_id, c_payment_id, c_bpartner_id, amount, discountamt, writeoffamt) VALUES
  (700, 600, 400, 500, 200, 980.00, 20.00, 0.00)
ON CONFLICT DO NOTHING;

-- Allocation B (EUR): pay 500 against the EUR 500 invoice; FX moved => realized loss.
INSERT INTO c_allocationhdr (c_allocationhdr_id, c_currency_id, datetrx) VALUES
  (601, 101, DATE '2024-02-10')
ON CONFLICT DO NOTHING;
INSERT INTO c_allocationline (c_allocationline_id, c_allocationhdr_id, c_invoice_id, c_payment_id, c_bpartner_id, amount, discountamt, writeoffamt) VALUES
  (701, 601, 401, 501, 201, 500.00, 0.00, 0.00)
ON CONFLICT DO NOTHING;
