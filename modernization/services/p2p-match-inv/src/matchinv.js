// Match-invoice posting logic — PostgreSQL-native.
// Mirrors Doc_MatchInv.createFacts: NIR DR / InventoryClearing CR / IPV.
// All SUM re-reads use COALESCE(..., 0) for null-safe aggregation on PostgreSQL.
const db = require('./db');

// iDempiere table IDs (AD_Table_ID constants)
const TABLE_INOUT = 319;
const TABLE_INVOICE = 318;
const TABLE_MATCHINV = 472;

class PostingNotBalancedError extends Error {
  constructor(debit, credit) {
    super(`Posting not balanced: DR=${debit} CR=${credit}`);
    this.debit = debit;
    this.credit = credit;
  }
}

/**
 * Load match-inv record with joined invoice/receipt data.
 */
async function loadMatchInv(matchInvId) {
  const { rows } = await db.query(`
    SELECT mi.*, il.c_invoice_id, il.qtyinvoiced, il.linenetamt, il.priceactual AS inv_price,
           iol.m_inout_id, iol.movementqty, iol.c_orderline_id,
           ol.priceactual AS po_price,
           p.costingmethod,
           i.c_currency_id AS inv_currency_id, i.dateacct AS inv_dateacct
    FROM m_matchinv mi
    JOIN c_invoiceline il ON mi.c_invoiceline_id = il.c_invoiceline_id
    JOIN c_invoice i ON il.c_invoice_id = i.c_invoice_id
    JOIN m_inoutline iol ON mi.m_inoutline_id = iol.m_inoutline_id
    JOIN m_inout io ON iol.m_inout_id = io.m_inout_id
    JOIN m_product p ON mi.m_product_id = p.m_product_id
    LEFT JOIN c_orderline ol ON iol.c_orderline_id = ol.c_orderline_id
    WHERE mi.m_matchinv_id = $1
  `, [matchInvId]);
  return rows[0] || null;
}

/**
 * Read upstream Fact_Acct SUM for a given table/record/account.
 * Uses COALESCE(SUM(...), 0) — the refactored pattern from Doc_MatchInv.
 */
async function readFactAcctSums(tableId, recordId, acctSchemaId, accountId) {
  const { rows } = await db.query(`
    SELECT COALESCE(SUM(AmtSourceDr),0) AS src_dr,
           COALESCE(SUM(AmtAcctDr),0)   AS acct_dr,
           COALESCE(SUM(AmtSourceCr),0) AS src_cr,
           COALESCE(SUM(AmtAcctCr),0)   AS acct_cr
    FROM fact_acct
    WHERE ad_table_id = $1 AND record_id = $2
      AND c_acctschema_id = $3 AND account_id = $4
      AND postingtype = 'A'
  `, [tableId, recordId, acctSchemaId, accountId]);
  return rows[0];
}

/**
 * Read upstream Fact_Acct net (DR - CR) for a given table/record/account.
 * Uses COALESCE(SUM(...), 0) — the refactored pattern.
 */
async function readFactAcctNet(tableId, recordId, acctSchemaId, accountId) {
  const { rows } = await db.query(`
    SELECT COALESCE(SUM(AmtSourceDr),0) - COALESCE(SUM(AmtSourceCr),0) AS src_net,
           COALESCE(SUM(AmtAcctDr),0)   - COALESCE(SUM(AmtAcctCr),0)  AS acct_net
    FROM fact_acct
    WHERE ad_table_id = $1 AND record_id = $2
      AND c_acctschema_id = $3 AND account_id = $4
      AND postingtype = 'A'
  `, [tableId, recordId, acctSchemaId, accountId]);
  return rows[0];
}

// Account IDs from seed
const ACCT = {
  NIR: 1,
  INV_CLR: 2,
  IPV: 3,
  ASSET: 4,
  AVG_COST_VAR: 5,
};

function round2(n) {
  return Math.round(n * 100) / 100;
}

function makeFactLine(acctType, accountId, amount) {
  return {
    acctType,
    account_id: accountId,
    dr: amount > 0 ? amount : 0,
    cr: amount < 0 ? -amount : 0,
  };
}

/** Compute NIR DR amount from upstream receipt or reversal Fact_Acct. */
async function computeNirDr(mi, acctSchemaId, multiplierReceipt, isReversal) {
  if (isReversal) {
    const origSums = await readFactAcctSums(TABLE_MATCHINV, mi.reversal_id, acctSchemaId, ACCT.NIR);
    return Number(origSums.acct_cr);
  }
  const receiptSums = await readFactAcctSums(TABLE_INOUT, mi.m_inout_id, acctSchemaId, ACCT.NIR);
  return Number(receiptSums.acct_cr) * multiplierReceipt;
}

/** Compute InventoryClearing CR amount from upstream invoice or reversal Fact_Acct. */
async function computeInvClrCr(mi, acctSchemaId, multiplierInvoice, isReversal) {
  if (isReversal) {
    const origSums = await readFactAcctSums(TABLE_MATCHINV, mi.reversal_id, acctSchemaId, ACCT.INV_CLR);
    return Number(origSums.acct_dr);
  }
  const invoiceSums = await readFactAcctSums(TABLE_INVOICE, mi.c_invoice_id, acctSchemaId, ACCT.INV_CLR);
  return Number(invoiceSums.acct_dr) * multiplierInvoice;
}

/** Build IPV fact lines for AveragePO costing with stock-coverage split. */
function buildAveragePOIpvLines(ipv, mi, opts) {
  const lines = [];
  const qtyMatched = Math.abs(Number(mi.qty));
  const qtyCost = opts.costingQty != null ? opts.costingQty : qtyMatched;

  let amtAsset;
  let amtVariance;
  if (qtyCost < qtyMatched) {
    amtAsset = round2(qtyCost * ipv / qtyMatched);
    amtVariance = round2(ipv - amtAsset);
  } else {
    amtAsset = ipv;
    amtVariance = 0;
  }

  if (amtAsset !== 0) {
    lines.push(makeFactLine('Asset', ACCT.ASSET, amtAsset));
  }
  if (amtVariance !== 0) {
    lines.push(makeFactLine('AverageCostVariance', ACCT.AVG_COST_VAR, amtVariance));
  }
  return lines;
}

/**
 * Build the match-invoice posting facts.
 *
 * Mirrors Doc_MatchInv.createFacts:
 *   NotInvoicedReceipts  DR  (from receipt Fact_Acct)
 *   InventoryClearing    CR  (from invoice Fact_Acct)
 *   InvoicePriceVariance DR/CR (difference)
 *
 * @param {object} mi - loaded match-inv record
 * @param {object} opts - { acctSchemaId, costingQty } for AveragePO stock coverage
 * @returns {Promise<{ facts: Array, balanced: boolean, debit: number, credit: number }>}
 */
async function buildFacts(mi, opts = {}) {
  const acctSchemaId = opts.acctSchemaId || 1;
  const facts = [];
  const isReversal = mi.reversal_id != null && mi.reversal_id > 0;
  const multiplierReceipt = Number(mi.qty) / Number(mi.movementqty);
  const multiplierInvoice = Number(mi.qty) / Number(mi.qtyinvoiced);

  const nirDr = await computeNirDr(mi, acctSchemaId, multiplierReceipt, isReversal);
  facts.push({ acctType: 'NotInvoicedReceipts', account_id: ACCT.NIR, dr: round2(nirDr), cr: 0 });

  const invClrCr = await computeInvClrCr(mi, acctSchemaId, multiplierInvoice, isReversal);
  facts.push({ acctType: 'InventoryClearing', account_id: ACCT.INV_CLR, dr: 0, cr: round2(invClrCr) });

  const ipv = round2(invClrCr - nirDr);
  if (ipv !== 0) {
    if (mi.costingmethod === 'A') {
      facts.push(...buildAveragePOIpvLines(ipv, mi, opts));
    } else {
      facts.push(makeFactLine('InvoicePriceVariance', ACCT.IPV, ipv));
    }
  }

  const debit = round2(facts.reduce((s, f) => s + f.dr, 0));
  const credit = round2(facts.reduce((s, f) => s + f.cr, 0));
  const balanced = Math.abs(debit - credit) < 0.005;

  return { facts, balanced, debit, credit };
}

/**
 * Post match-invoice: build facts, verify balance, write to Fact_Acct.
 */
async function postMatchInv(matchInvId, opts = {}) {
  const mi = await loadMatchInv(matchInvId);
  if (!mi) throw new Error(`Match-inv ${matchInvId} not found`);

  const result = await buildFacts(mi, opts);
  if (!result.balanced) throw new PostingNotBalancedError(result.debit, result.credit);

  for (const f of result.facts) {
    await db.query(`
      INSERT INTO fact_acct (ad_table_id, record_id, c_acctschema_id, account_id,
        c_currency_id, amtsourcedr, amtsourcecr, amtacctdr, amtacctcr, postingtype, dateacct)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'A', $10)
    `, [TABLE_MATCHINV, matchInvId, opts.acctSchemaId || 1, f.account_id,
        mi.inv_currency_id || 100, f.dr, f.cr, f.dr, f.cr, mi.dateacct]);
  }

  await db.query('UPDATE m_matchinv SET posted = TRUE WHERE m_matchinv_id = $1', [matchInvId]);
  return { posted: true, debit: result.debit, credit: result.credit, facts: result.facts };
}

module.exports = { loadMatchInv, buildFacts, postMatchInv, PostingNotBalancedError, readFactAcctSums, readFactAcctNet };
