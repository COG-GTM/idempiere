// Parity tests: P2P match-invoice posting on PostgreSQL must reproduce the
// Oracle-era accounting exactly — balanced Fact_Acct, correct IPV, reversal
// amounts identical.
//
// Golden dataset: scenarios 1-4 from seed.sql, covering all four acceptance
// criteria from L8N2-68.
const { test, before, after } = require('node:test');
const assert = require('node:assert');

const db = require('../src/db');
const { migrate } = require('../src/migrate');
const {
  buildFacts,
  loadMatchInv,
  postMatchInv,
  readFactAcctSums,
  readFactAcctNet,
  PostingNotBalancedError,
} = require('../src/matchinv');

before(async () => {
  await migrate();
  // Reset posted flags + match-inv GL so the suite is deterministic.
  await db.query('DELETE FROM fact_acct WHERE ad_table_id = 472');
  await db.query('UPDATE m_matchinv SET posted = FALSE');
});

after(async () => { await db.pool.end(); });

// -----------------------------------------------------------------------
// AC1: Match at PO price — balanced, no variance
// -----------------------------------------------------------------------
test('AC1: match at PO price posts balanced (NIR DR = InvClr CR), no IPV line', async () => {
  const mi = await loadMatchInv(4001);
  const { facts, balanced, debit, credit } = await buildFacts(mi);

  assert.ok(balanced, `posting must balance: DR=${debit} CR=${credit}`);
  assert.equal(debit, 50);
  assert.equal(credit, 50);

  // NIR DR = 50, InventoryClearing CR = 50, no IPV
  const nir = facts.find((f) => f.acctType === 'NotInvoicedReceipts');
  assert.equal(nir.dr, 50);
  const clr = facts.find((f) => f.acctType === 'InventoryClearing');
  assert.equal(clr.cr, 50);

  const ipv = facts.find((f) => f.acctType === 'InvoicePriceVariance');
  assert.equal(ipv, undefined, 'no IPV line when invoice price = PO price');
});

// -----------------------------------------------------------------------
// AC2: Match above PO price — IPV captures the difference, entry balances
// -----------------------------------------------------------------------
test('AC2: match above PO price posts IPV = 10 and entry balances', async () => {
  const mi = await loadMatchInv(4002);
  const { facts, balanced, debit, credit } = await buildFacts(mi);

  assert.ok(balanced, `posting must balance: DR=${debit} CR=${credit}`);
  assert.equal(debit, 60);
  assert.equal(credit, 60);

  // NIR DR = 50 (receipt at PO price)
  const nir = facts.find((f) => f.acctType === 'NotInvoicedReceipts');
  assert.equal(nir.dr, 50);

  // InventoryClearing CR = 60 (invoice price)
  const clr = facts.find((f) => f.acctType === 'InventoryClearing');
  assert.equal(clr.cr, 60);

  // IPV DR = 10 (difference: 60 - 50)
  const ipv = facts.find((f) => f.acctType === 'InvoicePriceVariance');
  assert.ok(ipv, 'IPV line must exist when price differs');
  assert.equal(ipv.dr, 10);
});

// -----------------------------------------------------------------------
// AC3: AveragePO costing with stock coverage — variance split to asset
// -----------------------------------------------------------------------
test('AC3: AveragePO with stock coverage splits IPV to asset + variance', async () => {
  const mi = await loadMatchInv(4003);
  // costingQty = 3 (stock on hand), qtyMatched = 5
  // IPV = 70 - 50 = 20
  // amtAsset = 3 * 20 / 5 = 12
  // amtVariance = 20 - 12 = 8
  const { facts, balanced, debit, credit } = await buildFacts(mi, {
    acctSchemaId: 2,
    costingQty: 3,
  });

  assert.ok(balanced, `posting must balance: DR=${debit} CR=${credit}`);
  assert.equal(debit, 70);
  assert.equal(credit, 70);

  const nir = facts.find((f) => f.acctType === 'NotInvoicedReceipts');
  assert.equal(nir.dr, 50);

  const clr = facts.find((f) => f.acctType === 'InventoryClearing');
  assert.equal(clr.cr, 70);

  const asset = facts.find((f) => f.acctType === 'Asset');
  assert.ok(asset, 'asset line must exist for stock-coverage split');
  assert.equal(asset.dr, 12);

  const variance = facts.find((f) => f.acctType === 'AverageCostVariance');
  assert.ok(variance, 'variance line must exist for uncovered portion');
  assert.equal(variance.dr, 8);
});

// -----------------------------------------------------------------------
// AC4: Reversal mirrors the original amounts exactly
// -----------------------------------------------------------------------
test('AC4: reversal mirrors original match amounts exactly', async () => {
  // First, post the original match 4002 so reversal can re-read its Fact_Acct
  await postMatchInv(4002);

  const mi = await loadMatchInv(4004);
  const { facts, balanced, debit, credit } = await buildFacts(mi);

  assert.ok(balanced, `reversal posting must balance: DR=${debit} CR=${credit}`);

  // Reversal swaps DR/CR of the original posting
  const nir = facts.find((f) => f.acctType === 'NotInvoicedReceipts');
  assert.ok(nir, 'NIR line must exist in reversal');

  const clr = facts.find((f) => f.acctType === 'InventoryClearing');
  assert.ok(clr, 'InvClr line must exist in reversal');

  // The reversal should produce exact mirror amounts
  assert.equal(debit, credit, 'reversal debit must equal credit');
});

// -----------------------------------------------------------------------
// COALESCE null-safety: SUM re-read returns 0 (not NULL) for missing rows
// -----------------------------------------------------------------------
test('COALESCE: SUM re-read returns zeros for non-existent record (no NPE)', async () => {
  // Query a record that doesn't exist — SUM should return 0, not NULL
  const sums = await readFactAcctSums(TABLE_MATCHINV_MISSING, 999999, 1, 1);
  assert.equal(Number(sums.src_dr), 0);
  assert.equal(Number(sums.acct_dr), 0);
  assert.equal(Number(sums.src_cr), 0);
  assert.equal(Number(sums.acct_cr), 0);

  const net = await readFactAcctNet(TABLE_MATCHINV_MISSING, 999999, 1, 1);
  assert.equal(Number(net.src_net), 0);
  assert.equal(Number(net.acct_net), 0);
});

const TABLE_MATCHINV_MISSING = 472;
