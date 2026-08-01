// Allocation -> GL posting, the pre-completed O2C migration slice.
//
// Re-implements iDempiere's Doc_AllocationHdr.createFacts (org.idempiere.acct,
// Doc_AllocationHdr.java:192) on PostgreSQL-native SQL. GL effects mirror the
// source: UnallocatedCash (DR), Receivable (CR), DiscountExp (DR), WriteOff
// (DR), and RealizedGain/RealizedLoss from multi-currency settlement.
//
// The accounting currency is USD. Each allocation must post a balanced set of
// Fact_Acct lines (sum debits == sum credits); realized FX gain/loss is the
// balancing entry when invoice-date and payment-date conversion rates differ.

const db = require('./db');
const dd = require('./telemetry/datadog');

const ACCT_CURRENCY_ID = 100; // USD
const AD_TABLE_C_ALLOCATIONHDR = 735; // iDempiere AD_Table_ID for C_AllocationHdr
const EPSILON = 0.005;

class PostingNotBalancedError extends Error {
  constructor(allocationId, dr, cr) {
    super(`Allocation ${allocationId} posting not balanced: DR ${dr.toFixed(2)} != CR ${cr.toFixed(2)}`);
    this.name = 'PostingNotBalancedError';
    this.allocationId = allocationId;
    this.debit = dr;
    this.credit = cr;
  }
}

function round2(n) {
  // Banker-safe 2dp rounding — the PostgreSQL NUMERIC(20,2) parity target.
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// Conversion-rate lookup, migrated from Oracle to PostgreSQL-native SQL.
//
//   ORACLE (legacy form this replaces):
//     SELECT NVL(r.multiplyrate, 1)
//       FROM c_conversion_rate r
//      WHERE r.c_currency_id (+)    = :from
//        AND r.c_currency_id_to (+) = :to
//        AND :d BETWEEN r.validfrom AND NVL(r.validto, :d)
//
//   POSTGRESQL (this code): ANSI LEFT JOIN + COALESCE, explicit date bounds.
async function getRate(fromCcy, toCcy, dateISO, client = db) {
  if (fromCcy === toCcy) return 1;
  const { rows } = await client.query(
    `SELECT COALESCE(r.multiplyrate, NULL)::numeric AS rate
       FROM (SELECT 1) dummy
       LEFT JOIN c_conversion_rate r
         ON r.c_currency_id = $1
        AND r.c_currency_id_to = $2
        AND $3::date >= r.validfrom
        AND $3::date <= COALESCE(r.validto, $3::date)
      ORDER BY r.validfrom DESC
      LIMIT 1`,
    [fromCcy, toCcy, dateISO],
  );
  const rate = rows[0] && rows[0].rate != null ? Number(rows[0].rate) : null;
  if (rate == null) {
    throw new Error(`No conversion rate ${fromCcy}->${toCcy} on ${dateISO}`);
  }
  return rate;
}

async function loadAllocation(id, client = db) {
  const hdr = (await client.query(
    `SELECT * FROM c_allocationhdr WHERE c_allocationhdr_id = $1`, [id],
  )).rows[0];
  if (!hdr) return null;
  const lines = (await client.query(
    `SELECT al.*, inv.c_currency_id AS invoice_currency_id, inv.dateinvoiced,
            pay.c_currency_id AS payment_currency_id, pay.datetrx AS paymentdate
       FROM c_allocationline al
       LEFT JOIN c_invoice inv ON inv.c_invoice_id = al.c_invoice_id
       LEFT JOIN c_payment pay ON pay.c_payment_id = al.c_payment_id
      WHERE al.c_allocationhdr_id = $1
      ORDER BY al.c_allocationline_id`,
    [id],
  )).rows;
  return { hdr, lines };
}

// Build the balanced Fact_Acct lines for one allocation.
async function buildFacts(allocation, _opts = {}, client = db) {
  const { hdr, lines } = allocation;
  const facts = [];
  let totalDr = 0;
  let totalCr = 0;

  for (const line of lines) {
    const amount = Number(line.amount);
    const discount = Number(line.discountamt);
    const writeoff = Number(line.writeoffamt);

    const payCcy = line.payment_currency_id || hdr.c_currency_id;
    const invCcy = line.invoice_currency_id || hdr.c_currency_id;
    const payDate = (line.paymentdate || hdr.datetrx).toISOString().slice(0, 10);
    const invDate = (line.dateinvoiced || hdr.datetrx).toISOString().slice(0, 10);

    // Cash + discount + write-off settle at the PAYMENT-date rate.
    const payRate = await getRate(payCcy, ACCT_CURRENCY_ID, payDate, client);
    // The receivable was booked at the INVOICE-date rate (its carrying value).
    const invRate = await getRate(invCcy, ACCT_CURRENCY_ID, invDate, client);

    const cashAcct = round2(amount * payRate);
    const discountAcct = round2(discount * payRate);
    const writeoffAcct = round2(writeoff * payRate);
    const arAcct = round2((amount + discount + writeoff) * invRate);

    const push = (acctType, accountId, dr, cr, desc) => {
      facts.push({ acctType, accountId, dr, cr, desc, ccy: ACCT_CURRENCY_ID });
      totalDr += dr; totalCr += cr;
    };

    push('UnallocatedCash', 301, cashAcct, 0, `Cash received (${payCcy}@${payRate})`);
    if (discountAcct !== 0) push('DiscountExp', 302, discountAcct, 0, 'Payment discount');
    if (writeoffAcct !== 0) push('WriteOff', 303, writeoffAcct, 0, 'Write-off');
    push('Receivable', 300, 0, arAcct, `AR settled (${invCcy}@${invRate})`);

    // Realized FX gain/loss balances the line when settle-rate != booking-rate.
    const settledDr = cashAcct + discountAcct + writeoffAcct;
    const realized = round2(arAcct - settledDr);
    if (realized !== 0) {
      if (realized > 0) {
        push('RealizedLoss', 305, realized, 0, 'Realized FX loss');
      } else {
        push('RealizedGain', 304, 0, -realized, 'Realized FX gain');
      }
    }
  }

  const dr = round2(totalDr);
  const cr = round2(totalCr);
  return { facts, debit: dr, credit: cr, balanced: Math.abs(dr - cr) < EPSILON };
}

// Post an allocation: build facts, enforce balance, persist to fact_acct.
async function postAllocation(id) {
  return db.withTransaction(async (client) => {
    const allocation = await loadAllocation(id, client);
    if (!allocation) {
      const e = new Error(`Allocation ${id} not found`);
      e.statusCode = 404;
      throw e;
    }
    if (allocation.hdr.posted) {
      return { allocationId: id, alreadyPosted: true };
    }

    const { facts, debit, credit, balanced } = await buildFacts(allocation, {}, client);

    if (!balanced) {
      dd.increment('posting.imbalance', { journey: 'order-to-cash' });
      throw new PostingNotBalancedError(id, debit, credit);
    }

    await client.query(`DELETE FROM fact_acct WHERE ad_table_id = $1 AND record_id = $2`,
      [AD_TABLE_C_ALLOCATIONHDR, id]);
    for (const f of facts) {
      await client.query(
        `INSERT INTO fact_acct (ad_table_id, record_id, account_id, c_currency_id,
            amtsourcedr, amtsourcecr, amtacctdr, amtacctcr, description, dateacct)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [AD_TABLE_C_ALLOCATIONHDR, id, f.accountId, f.ccy, f.dr, f.cr, f.dr, f.cr, f.desc,
          allocation.hdr.datetrx],
      );
    }
    await client.query(`UPDATE c_allocationhdr SET posted = TRUE WHERE c_allocationhdr_id = $1`, [id]);

    dd.increment('posting.success', { journey: 'order-to-cash' });
    dd.gauge('posting.amount', debit, { journey: 'order-to-cash' });
    return { allocationId: id, posted: true, debit, credit, lines: facts.length };
  });
}

// Deliberately-slow GL re-derivation — the Datadog *performance* regression
// (distinct from the Sentry *correctness* break). Models a naive Oracle->PG
// migration that lost an index on fact_acct: the "reconciliation" re-checks the
// ledger by scanning an unindexed row product, so latency grows with ledger
// "size". Emits the `o2c.allocation.posting.duration` timing the latency monitor
// alerts on. `scale` (default RECOMPUTE_SCALE) controls how slow it runs.
async function recomputeBalances({ scale } = {}) {
  const started = Date.now();
  const n = Number.isFinite(scale) ? scale : Number(process.env.RECOMPUTE_SCALE || 9000);
  // O(n^2) scan standing in for the index the migration dropped.
  const { rows } = await db.query(
    `SELECT count(*)::bigint AS scanned
       FROM generate_series(1, $1) a
       CROSS JOIN generate_series(1, $1) b`,
    [n],
  );
  // Re-derive the real per-allocation balances so the work is meaningful.
  const { rows: balances } = await db.query(
    `SELECT record_id AS allocation_id,
            sum(amtacctdr)::numeric AS dr,
            sum(amtacctcr)::numeric AS cr
       FROM fact_acct
      WHERE ad_table_id = $1
      GROUP BY record_id
      ORDER BY record_id`,
    [AD_TABLE_C_ALLOCATIONHDR],
  );
  const durationMs = Date.now() - started;
  dd.timing('posting.duration', durationMs, { op: 'recompute', journey: 'order-to-cash' });
  return {
    scanned: Number(rows[0].scanned),
    allocations: balances.map((b) => ({
      allocationId: b.allocation_id,
      debit: Number(b.dr),
      credit: Number(b.cr),
      balanced: Math.abs(Number(b.dr) - Number(b.cr)) < EPSILON,
    })),
    durationMs,
  };
}

module.exports = { postAllocation, buildFacts, loadAllocation, getRate, round2, recomputeBalances, PostingNotBalancedError, ACCT_CURRENCY_ID };
