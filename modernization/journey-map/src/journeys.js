// Journey map data — rediscovered from the iDempiere codebase (COG-GTM/idempiere).
//
// Each journey is an end-to-end business document flow. Every node links to REAL
// source in the fork. Line counts are measured (`wc -l`) from the checked-out tree,
// not estimated. Each journey terminates in the accounting engine: a document's
// DocAction.completeIt() hands off to the matching Doc_* posting class, which calls
// createFacts() to emit balanced Fact_Acct (GL) lines.
//
// The Oracle→PostgreSQL coupling is concentrated in the runtime SQL-translation
// layer (org.compiere.db.postgresql.provider .../Convert_PostgreSQL.java +
// org.adempiere.base .../dbPort/Convert_SQL92.java), exercised most heavily by the
// allocation posting SQL. See modernization/analysis/SYSTEM_ANALYSIS.md.

const REPO = "https://github.com/COG-GTM/idempiere/blob/master";
const src = (path, line) => `${REPO}/${path}${line ? `#L${line}` : ""}`;

const MODEL = "org.adempiere.base/src/org/compiere/model";
const ACCT = "org.idempiere.acct/src/org/idempiere/acct/doc";
const CONV_PG = "org.compiere.db.postgresql.provider/src/org/compiere/dbPort/Convert_PostgreSQL.java";
const CONV_SQL92 = "org.adempiere.base/src/org/compiere/dbPort/Convert_SQL92.java";
const DB = "org.adempiere.base/src/org/compiere/db/AdempiereDatabase.java";
const FACT_LINE = "org.idempiere.acct/src/org/idempiere/acct/doc/FactLine.java";
const MSEQ = "org.adempiere.base/src/org/compiere/model/MSequence.java";

const construct = (name, action, file, line) => ({ name, action, file, line });
const slice = (title, detail, effort) => ({ title, detail, effort });

// disposition: "carry-forward" | "refactor" | "rewrite"
export const DISPOSITIONS = {
  "carry-forward": { label: "Carry-Forward", color: "#1f9d55", hint: "Low coupling / stable — convert schema & lift-and-shift" },
  refactor: { label: "Refactor", color: "#d97706", hint: "Medium coupling — modernize in place via the conversion layer" },
  rewrite: { label: "Rewrite", color: "#dc2626", hint: "High coupling + high value — strangler-fig replacement" },
};

export const CONVERSION_SEAM = [
  construct(
    "ROWNUM → LIMIT",
    "Rewrite single-row lookups to `LIMIT 1`, and add `ORDER BY` when the chosen row must be deterministic.",
    CONV_PG,
    398,
  ),
  construct(
    "DECODE(...) → CASE",
    "Let the shared converter rewrite Oracle `DECODE` calls to ANSI `CASE`; do not reintroduce Oracle-only SQL in new code.",
    CONV_PG,
    248,
  ),
  construct(
    "(+) outer join → ANSI JOIN",
    "Replace Oracle outer-join syntax with explicit `LEFT` / `RIGHT` joins before the query reaches PostgreSQL.",
    CONV_SQL92,
    53,
  ),
  construct(
    "SYSDATE → statement_timestamp()",
    "Use statement-time semantics for current time, or `CURRENT_DATE` when the business rule is date-only.",
    CONV_PG,
    60,
  ),
  construct(
    "NUMBER → NUMERIC",
    "Map amount and rate columns to exact `NUMERIC` precision instead of floating-point types.",
    DB,
    438,
  ),
  construct(
    "Sequences → identity",
    "Keep existing PK and document-number helpers on `MSequence`; new PostgreSQL tables can move to identity columns where the platform allows.",
    MSEQ,
    79,
  ),
];

// Node layers drive the canvas layout.
//   document   — business document model classes (the journey spine)
//   posting    — the Doc_* accounting class that posts the document
//   gl         — the Fact_Acct general-ledger sink
//   deployable — a migrated, independently-runnable service (PostgreSQL-native)
//   downstream — systems that consume the journey's data (blast radius)
export const LAYERS = {
  document: { label: "Business document", y: 60 },
  posting: { label: "Posting engine (Doc_*)", y: 250 },
  gl: { label: "General ledger", y: 250 },
  deployable: { label: "Migrated deployable", y: 430 },
  downstream: { label: "Downstream consumers", y: 430 },
};

const FACT_ACCT = {
  id: "gl-fact",
  layer: "gl",
  label: "GL — Fact_Acct",
  cls: "Fact / FactLine",
  table: "Fact_Acct",
  file: `${ACCT}/Fact.java`,
  lines: null,
  note: "All posting classes converge here. Every posting must balance (ΣDR = ΣCR).",
};

export const journeys = [
  {
    id: "o2c",
    name: "Order-to-Cash",
    disposition: "rewrite",
    summary:
      "Sales Order → Shipment → AR Invoice → Receipt → Allocation → GL. Highest data volume and the most Oracle-specific SQL in the system, concentrated in allocation posting (multi-currency realized FX, discount, write-off).",
    metrics: {
      oracleCoupling: "High — DECODE + (+) outer-joins in allocation/payment posting SQL",
      complexity: "High — multi-currency, bespoke pricing & allocation matching",
      dataVolume: "Highest — C_Invoice / C_AllocationLine are top-volume transaction tables",
      blastRadius: "High — revenue recognition, CRM, treasury, tax all read O2C output",
    },
    rationale:
      "Highest business value + highest Oracle coupling (DECODE / (+) outer-joins in Doc_AllocationHdr.createFacts, plus multiple conversion-rate lookups in the invoice and allocation flows) + bespoke logic → REWRITE behind a strangler facade. This is the slice migrated first (see the deployable node).",
    approach: {
      priority: "P0 — demo centerpiece",
      sequencing:
        "Start with schema/index parity and the shared conversion seam, then land the invoice and receipt posting slices, prove FX correctness, build the golden-dataset parity harness, and finish with the cutover / contract step.",
      slices: [
        slice(
          "Schema and index parity",
          "Align the O2C tables and access paths first so invoice, receipt, and allocation queries read the same shape on PostgreSQL.",
          "M",
        ),
        slice(
          "Invoice posting",
          "Move AR invoice posting onto the PostgreSQL-native path and preserve the invoice price / FX lookups that feed Fact_Acct.",
          "M",
        ),
        slice(
          "Receipt posting",
          "Land the cash receipt slice next so allocation and payment matching keep the same business outcome.",
          "M",
        ),
        slice(
          "FX correctness",
          "Prove the two-date conversion path and realized FX gain/loss calculations against Oracle-era output.",
          "S",
        ),
        slice(
          "Parity harness",
          "Add the golden-dataset check for document totals, Fact_Acct lines, and allocation balances before widening scope.",
          "M",
        ),
        slice(
          "Cutover and contract",
          "Lock the downstream contract, keep the rollback path explicit, and only then flip the O2C demo traffic.",
          "S",
        ),
      ],
    },
    nodes: [
      {
        id: "o2c-order",
        layer: "document",
        label: "Sales Order",
        cls: "MOrder",
        lines: 3287,
        file: `${MODEL}/MOrder.java`,
        table: "C_Order / C_OrderLine",
        action: "Keep the order pricing lookup on the shared conversion seam and prove the same line totals on PostgreSQL.",
        constructs: [
          construct(
            "currencyConvert",
            "Preserve the Oracle price conversion lookup until the PostgreSQL path can return the same order totals.",
            `${ACCT}/Doc_Order.java`,
            462,
          ),
          construct(
            "ROWNUM=1",
            "Rewrite the single-row subquery to `LIMIT 1` and keep the row choice deterministic.",
            `${ACCT}/Doc_Order.java`,
            468,
          ),
        ],
      },
      {
        id: "o2c-shipment",
        layer: "document",
        label: "Shipment",
        cls: "MInOut",
        lines: 3644,
        file: `${MODEL}/MInOut.java`,
        table: "M_InOut / M_InOutLine",
        action: "Treat shipment posting as part of the same O2C parity envelope and keep the cost path aligned.",
      },
      {
        id: "o2c-invoice",
        layer: "document",
        label: "AR Invoice",
        cls: "MInvoice",
        lines: 3662,
        file: `${MODEL}/MInvoice.java`,
        table: "C_Invoice / C_InvoiceLine",
        action: "Preserve the two-date FX lookup and invoice pricing semantics before the rewrite widens downstream.",
        constructs: [
          construct(
            "currencyConvertInvoice",
            "Keep the invoice price-conversion lookup aligned with Oracle-era output.",
            `${ACCT}/Doc_Invoice.java`,
            1544,
          ),
          construct(
            "ROWNUM=1",
            "Replace the single-row lookup with a deterministic PostgreSQL `LIMIT 1`.",
            `${ACCT}/Doc_Invoice.java`,
            1550,
          ),
          construct(
            "MConversionRate.convert",
            "Use the two-date FX conversion seam that feeds invoice posting totals.",
            `${ACCT}/Doc_Invoice.java`,
            1133,
          ),
        ],
      },
      {
        id: "o2c-payment",
        layer: "document",
        label: "Receipt",
        cls: "MPayment",
        lines: 3388,
        file: `${MODEL}/MPayment.java`,
        table: "C_Payment",
        action: "Keep the receipt slice in the same parity envelope as invoice and allocation so cash application stays balanced.",
      },
      {
        id: "o2c-alloc",
        layer: "document",
        label: "Allocation",
        cls: "MAllocationHdr",
        lines: 1097,
        file: `${MODEL}/MAllocationHdr.java`,
        table: "C_AllocationHdr / C_AllocationLine",
        action: "Rewrite the allocation seam behind the converter, then parity-test the realized FX gain/loss and allocation balance.",
        constructs: [
          construct(
            "DECODE(...)",
            "Let the conversion layer rewrite the Oracle branch logic to ANSI `CASE`.",
            CONV_PG,
            248,
          ),
          construct(
            "(+) outer join",
            "Replace the Oracle outer-join syntax with ANSI joins before the allocation facts are generated.",
            CONV_SQL92,
            53,
          ),
          construct(
            "MConversionRate.convert",
            "Keep the allocation-side realized FX calculation on the shared rate seam.",
            `${ACCT}/Doc_AllocationHdr.java`,
            893,
          ),
          construct(
            "MConversionRate.convert",
            "Keep the balancing side on the same FX seam so the final Fact_Acct lines still net to zero.",
            `${ACCT}/Doc_AllocationHdr.java`,
            1033,
          ),
        ],
      },
      {
        id: "o2c-post",
        layer: "posting",
        label: "Allocation posting",
        cls: "Doc_AllocationHdr",
        lines: 2159,
        file: `${ACCT}/Doc_AllocationHdr.java`,
        line: 192,
        table: "→ Fact_Acct",
        action: "Keep the posting class intact while the SQL translation layer rewrites Oracle-specific constructs underneath it.",
        constructs: [
          construct(
            "Realized gain/loss fact",
            "Preserve the balanced allocation posting that creates UnallocatedCash, Receivable, Discount, WriteOff, and FX gain/loss lines.",
            `${ACCT}/Doc_AllocationHdr.java`,
            192,
          ),
        ],
        oracle:
          "createFacts() (L192) books UnallocatedCash / Receivable / Discount / WriteOff / RealizedGain/Loss. The conversion-rate + payment lookups are the DECODE / (+) outer-join SQL translated at runtime by Convert_PostgreSQL.java (L248-265).",
        convFile: CONV_PG,
        convLine: 248,
      },
      FACT_ACCT,
      {
        id: "o2c-deployable",
        layer: "deployable",
        label: "o2c-allocation service ✅",
        cls: "Node/Express + PostgreSQL",
        table: "PostgreSQL-native fact_acct",
        action: "Keep the migrated service as the cutover target and use it as the parity reference for the rewrite slices.",
        note: "PG-native SQL (NVL→COALESCE, (+)→ANSI LEFT JOIN, NUMBER→NUMERIC). Parity-tested vs Oracle-era GL; instrumented with Sentry + Datadog + Slack→Devin.",
      },
      {
        id: "o2c-down-rev",
        layer: "downstream",
        label: "Revenue / Tax / Treasury",
        cls: "GL consumers",
        action: "Treat downstream readers as contract checks: revenue recognition, tax, and cash positioning must keep matching totals.",
        note: "Read Fact_Acct + allocation output for revenue recognition, tax and cash positioning.",
      },
    ],
    edges: [
      ["o2c-order", "o2c-shipment"],
      ["o2c-shipment", "o2c-invoice"],
      ["o2c-invoice", "o2c-payment"],
      ["o2c-payment", "o2c-alloc"],
      ["o2c-alloc", "o2c-post"],
      ["o2c-post", "gl-fact"],
      ["o2c-post", "o2c-deployable"],
      ["gl-fact", "o2c-down-rev"],
    ],
  },
  {
    id: "p2p",
    name: "Procure-to-Pay",
    disposition: "refactor",
    summary:
      "Requisition → Purchase Order → Material Receipt → AP Invoice → Match (PO/Receipt/Invoice) → Payment → GL. Standard procurement; Oracle coupling concentrated in the three-way matching posting.",
    metrics: {
      oracleCoupling: "Medium — matching posting SQL uses the conversion layer; less bespoke than O2C",
      complexity: "Medium-High — three-way match (PO↔Receipt↔Invoice) reconciliation",
      dataVolume: "High — M_MatchPO / M_MatchInv grow with receipt & invoice volume",
      blastRadius: "Medium — ERP-internal + supplier portal / AP",
    },
    rationale:
      "Mostly standard flows with coupling concentrated in matching and pricing lookups. REFACTOR in place using the existing Convert_PostgreSQL layer rather than a full rewrite.",
    approach: {
      priority: "P1 — refactor in place (sprint planned: L8N2-46, stories L8N2-67…72)",
      sequencing:
        "Sprint plan (P2P Refactor — Sprint 1): schema/index parity first, then the three-way match posting on the critical path with the deterministic last-price fix in parallel, FX/rounding right after matching, then the parity harness gates the downstream contract + observability close-out.",
      slices: [
        slice(
          "Schema and index parity (L8N2-67)",
          "Port/verify DDL + indexes for the seven procurement tables so they read consistently on PostgreSQL before touching matching logic.",
          "M",
        ),
        slice(
          "Three-way match posting (L8N2-68)",
          "Refactor Doc_MatchInv accrual clearing and InvoicePriceVariance (incl. AveragePO stock-coverage split) so posted values stay faithful.",
          "L",
        ),
        slice(
          "FX gain/loss and rounding (L8N2-69)",
          "Prove the receipt/invoice gain-loss and rounding-correction paths on the shared MConversionRate seam.",
          "M",
        ),
        slice(
          "Deterministic last-price updates (L8N2-70)",
          "Replace the Oracle-only ROWNUM=1 branches for PriceLastPO / PriceLastInv with deterministic single-row selection on both platforms.",
          "S",
        ),
        slice(
          "Parity harness (L8N2-71)",
          "Golden-dataset check of match balances, invoice variance, and Fact_Acct totals before widening the refactor.",
          "M",
        ),
        slice(
          "Downstream contract and observability (L8N2-72)",
          "Contract checks for AP aging / supplier settlement reads plus alerting on the posting path.",
          "S",
        ),
      ],
    },
    nodes: [
      { id: "p2p-req", layer: "document", label: "Requisition", cls: "MRequisition", lines: 624, file: `${MODEL}/MRequisition.java`, table: "M_Requisition" },
      {
        id: "p2p-po",
        layer: "document",
        label: "Purchase Order",
        cls: "MOrder",
        lines: 3287,
        file: `${MODEL}/MOrder.java`,
        table: "C_Order (IsSOTrx=N)",
        action: "Keep the PO price lookup on the shared conversion seam and avoid a hidden rownum dependency.",
        constructs: [
          construct(
            "currencyConvert",
            "Preserve the purchase-order price conversion until the PostgreSQL path matches Oracle-era totals.",
            `${ACCT}/Doc_Order.java`,
            462,
          ),
          construct(
            "ROWNUM=1",
            "Rewrite the lookup to deterministic `LIMIT 1` semantics.",
            `${ACCT}/Doc_Order.java`,
            468,
          ),
        ],
      },
      { id: "p2p-receipt", layer: "document", label: "Material Receipt", cls: "MInOut", lines: 3644, file: `${MODEL}/MInOut.java`, table: "M_InOut" },
      { id: "p2p-invoice", layer: "document", label: "AP Invoice", cls: "MInvoice", lines: 3662, file: `${MODEL}/MInvoice.java`, table: "C_Invoice" },
      { id: "p2p-match", layer: "document", label: "Match PO/Invoice", cls: "MMatchInv", lines: 479, file: `${MODEL}/MMatchInv.java`, table: "M_MatchInv / M_MatchPO" },
      { id: "p2p-pay", layer: "document", label: "Payment", cls: "MPayment", lines: 3388, file: `${MODEL}/MPayment.java`, table: "C_Payment" },
      {
        id: "p2p-post",
        layer: "posting",
        label: "Match posting",
        cls: "Doc_MatchInv",
        lines: 2878,
        file: `${ACCT}/Doc_MatchInv.java`,
        table: "→ Fact_Acct",
        action: "Keep the three-way match on the shared FX seam and parity-test accrual and variance output.",
        constructs: [
          construct(
            "MConversionRate.convert",
            "Keep the match posting on the shared currency conversion seam.",
            `${ACCT}/Doc_MatchInv.java`,
            293,
          ),
          construct(
            "MConversionRate.convert",
            "Preserve the same seam in the later match branches so variance math stays aligned.",
            `${ACCT}/Doc_MatchInv.java`,
            1270,
          ),
        ],
        oracle:
          "Reconciles PO/receipt/invoice accruals (NotInvoicedReceipts, InvoicePriceVariance). Currency conversion goes through the same translated SQL path as O2C.",
        convFile: CONV_PG,
        convLine: 248,
      },
      FACT_ACCT,
      {
        id: "p2p-down",
        layer: "downstream",
        label: "AP / Supplier portal",
        cls: "GL consumers",
        action: "Treat AP aging and supplier settlement as contract checks on the match and payment output.",
        note: "Accounts payable aging and supplier settlement read match + payment output.",
      },
    ],
    edges: [
      ["p2p-req", "p2p-po"],
      ["p2p-po", "p2p-receipt"],
      ["p2p-receipt", "p2p-invoice"],
      ["p2p-invoice", "p2p-match"],
      ["p2p-match", "p2p-pay"],
      ["p2p-match", "p2p-post"],
      ["p2p-post", "gl-fact"],
      ["gl-fact", "p2p-down"],
    ],
  },
  {
    id: "r2r",
    name: "Record-to-Report",
    disposition: "carry-forward",
    summary:
      "GL Journal / Bank Statement / Cash Journal → posting via the shared Doc base + DocManager → Fact_Acct → reporting. Standard double-entry through a well-isolated posting engine.",
    metrics: {
      oracleCoupling: "Low-Medium — standards-based double-entry; little bespoke SQL",
      complexity: "Medium — period control, accounting schema, reporting hierarchy",
      dataVolume: "Medium — Fact_Acct is large but mechanically generated",
      blastRadius: "Medium — financial reporting / BI / consolidation",
    },
    rationale:
      "The posting engine is well-factored and standards-based with low bespoke logic → CARRY-FORWARD with schema conversion only.",
    approach: {
      priority: "P2 — carry forward",
      sequencing:
        "Keep the posting engine in place, convert the schema and table contracts first, then validate the dispatcher / FactLine seam and finish with the report parity harness.",
      slices: [
        slice(
          "Schema conversion",
          "Lift the reporting tables first so the legacy posting engine can run without schema surprises.",
          "M",
        ),
        slice(
          "Dispatcher and FactLine seam",
          "Verify DocManager and the shared FactLine accounting seam still produce balanced debits and credits.",
          "S",
        ),
        slice(
          "Reporting parity",
          "Compare ledger and BI extracts against Oracle-era outputs on a golden dataset.",
          "M",
        ),
        slice(
          "Cutover contract",
          "Keep the reporting contract stable for finance consumers before expanding scope.",
          "S",
        ),
      ],
    },
    nodes: [
      { id: "r2r-gl", layer: "document", label: "GL Journal", cls: "MJournal", lines: 1110, file: `${MODEL}/MJournal.java`, table: "GL_Journal / GL_JournalLine" },
      { id: "r2r-bank", layer: "document", label: "Bank Statement", cls: "MBankStatement", lines: 804, file: `${MODEL}/MBankStatement.java`, table: "C_BankStatement" },
      { id: "r2r-cash", layer: "document", label: "Cash Journal", cls: "MCash", lines: 898, file: `${MODEL}/MCash.java`, table: "C_Cash" },
      {
        id: "r2r-mgr",
        layer: "posting",
        label: "Posting dispatcher",
        cls: "DocManager / Doc",
        lines: 908,
        file: `${ACCT}/DocManager.java`,
        table: "→ Fact_Acct",
        action: "Leave the dispatcher intact and validate the shared fact builder instead of rebuilding the reporting path.",
        note: "DocManager.postDocument routes each document to its Doc_* class; the Doc base (2,510 lines) builds and balances facts.",
        constructs: [
          construct(
            "amtAcctDr",
            "The shared FactLine builder keeps debit accounting on the same seam for every posting class.",
            FACT_LINE,
            881,
          ),
          construct(
            "amtAcctCr",
            "The shared FactLine builder keeps credit accounting on the same seam for every posting class.",
            FACT_LINE,
            895,
          ),
        ],
      },
      FACT_ACCT,
      {
        id: "r2r-down",
        layer: "downstream",
        label: "Reporting / BI",
        cls: "Fact_Acct consumers",
        action: "Treat finance reporting consumers as a contract boundary and keep their extracts unchanged.",
        note: "Financial statements, consolidation and BI extracts read Fact_Acct.",
      },
    ],
    edges: [
      ["r2r-gl", "r2r-mgr"],
      ["r2r-bank", "r2r-mgr"],
      ["r2r-cash", "r2r-mgr"],
      ["r2r-mgr", "gl-fact"],
      ["gl-fact", "r2r-down"],
    ],
  },
  {
    id: "inv",
    name: "Inventory / Material Movement",
    disposition: "carry-forward",
    summary:
      "Inventory Movement / Physical Inventory → posting → Fact_Acct (inventory valuation). Mechanical, table-driven, limited Oracle specifics.",
    metrics: {
      oracleCoupling: "Low — straightforward INSERT/UPDATE; few Oracle idioms",
      complexity: "Medium — costing method (standard/average/FIFO) on valuation",
      dataVolume: "High — M_Transaction / movement lines are high-volume",
      blastRadius: "Low-Medium — WMS / planning",
    },
    rationale:
      "Movement/inventory logic is mechanical and table-driven; valuation posting is standard → CARRY-FORWARD with schema conversion.",
    approach: {
      priority: "P3 — carry forward",
      sequencing:
        "This is mechanical enough to come after the higher-value journeys: convert the schema, validate valuation posting, then verify shipment / receipt cost conversion and parity.",
      slices: [
        slice(
          "Schema conversion",
          "Carry the inventory tables across first so the posting classes keep their structure.",
          "M",
        ),
        slice(
          "Valuation posting",
          "Validate the inventory valuation path and keep the cost math on the same accounting seam.",
          "S",
        ),
        slice(
          "Shipment and receipt cost",
          "Check the shipment / receipt posting path so the stock movement and cost conversion stay aligned.",
          "S",
        ),
        slice(
          "Parity harness",
          "Run the golden dataset against inventory valuation totals before cutover.",
          "M",
        ),
      ],
    },
    nodes: [
      { id: "inv-move", layer: "document", label: "Inventory Move", cls: "MMovement", lines: 1230, file: `${MODEL}/MMovement.java`, table: "M_Movement / M_MovementLine" },
      {
        id: "inv-phys",
        layer: "document",
        label: "Physical Inventory",
        cls: "MInventory",
        lines: 1354,
        file: `${MODEL}/MInventory.java`,
        table: "M_Inventory / M_InventoryLine",
        action: "Use the physical inventory slice to verify valuation math and quantity adjustments before cutover.",
      },
      {
        id: "inv-post",
        layer: "posting",
        label: "Movement posting",
        cls: "Doc_Inventory / Doc_InOut",
        lines: 523,
        file: `${ACCT}/Doc_Inventory.java`,
        table: "→ Fact_Acct",
        action: "Keep inventory valuation and shipment / receipt costing on the same FactLine seam.",
        constructs: [
          construct(
            "MConversionRate.convert",
            "Inventory valuation still runs through the shared conversion seam when amounts are accounted.",
            `${ACCT}/Doc_Inventory.java`,
            421,
          ),
          construct(
            "MConversionRate.convert",
            "Shipment / receipt costing keeps the same shared seam on the material-movement path.",
            `${ACCT}/Doc_InOut.java`,
            989,
          ),
        ],
        note: "Books inventory asset movement between warehouses/locators at cost.",
      },
      FACT_ACCT,
      {
        id: "inv-down",
        layer: "downstream",
        label: "WMS / Planning",
        cls: "stock consumers",
        action: "Treat replenishment and ATP as consumers of the valuation contract, not custom logic.",
        note: "Available-to-promise and replenishment read on-hand & valuation.",
      },
    ],
    edges: [
      ["inv-move", "inv-phys"],
      ["inv-move", "inv-post"],
      ["inv-phys", "inv-post"],
      ["inv-post", "gl-fact"],
      ["gl-fact", "inv-down"],
    ],
  },
  {
    id: "mfg",
    name: "Manufacturing / Production",
    disposition: "refactor",
    summary:
      "Production order → BOM explosion → component issue / receipt → production posting → Fact_Acct. Lower immediate priority; sits later in the roadmap.",
    metrics: {
      oracleCoupling: "Medium — costing + BOM explosion touch the conversion layer",
      complexity: "Medium-High — BOM levels, yield, work-in-process valuation",
      dataVolume: "Medium — production & component lines",
      blastRadius: "Low — plant-internal / MRP",
    },
    rationale:
      "Moderate coupling and complexity with lower immediate business value → REFACTOR in a later phase, after the high-value O2C/P2P slices.",
    approach: {
      priority: "P4 — refactor later",
      sequencing:
        "Refactor after O2C and P2P: first make the production schema portable, then validate the roll-up / variance lines, and only then harden the parity harness.",
      slices: [
        slice(
          "Schema conversion",
          "Move the production tables and master data shape first so the costing paths have stable inputs.",
          "M",
        ),
        slice(
          "Production roll-up",
          "Validate the batch-lot roll-up / component issue path and keep the inventory-to-WIP math balanced.",
          "M",
        ),
        slice(
          "Variance and costing seam",
          "Check the standard-cost variance branch and the shared cost seam before broadening scope.",
          "M",
        ),
        slice(
          "Parity harness",
          "Compare production posting totals with Oracle-era output before the refactor becomes the default path.",
          "S",
        ),
      ],
    },
    nodes: [
      { id: "mfg-prod", layer: "document", label: "Production", cls: "MProduction", lines: 1100, file: `${MODEL}/MProduction.java`, table: "M_Production" },
      { id: "mfg-line", layer: "document", label: "Production Line / BOM", cls: "MProductionLine", lines: 524, file: `${MODEL}/MProductionLine.java`, table: "M_ProductionLine" },
      {
        id: "mfg-post",
        layer: "posting",
        label: "Production posting",
        cls: "Doc_Production",
        lines: 561,
        file: `${ACCT}/Doc_Production.java`,
        table: "→ Fact_Acct",
        action: "Keep the component issue, roll-up, and variance branches on the shared posting seam.",
        constructs: [
          construct(
            "post roll-up",
            "Batch-lot roll-up posts through the same balanced accounting path.",
            `${ACCT}/Doc_Production.java`,
            386,
          ),
          construct(
            "post variance",
            "Standard-cost variance recognition stays on the same accounting path.",
            `${ACCT}/Doc_Production.java`,
            403,
          ),
          construct(
            "inventory asset line",
            "The finished-goods inventory line is still created as a FactLine entry at cost.",
            `${ACCT}/Doc_Production.java`,
            425,
          ),
        ],
        note: "Books component issue and finished-goods receipt at cost (WIP clearing).",
      },
      FACT_ACCT,
      {
        id: "mfg-down",
        layer: "downstream",
        label: "MRP / Costing",
        cls: "plant consumers",
        action: "Keep MRP and costing consumers on the same contract while the refactor lands.",
        note: "Material planning and product costing read production output.",
      },
    ],
    edges: [
      ["mfg-prod", "mfg-line"],
      ["mfg-line", "mfg-post"],
      ["mfg-post", "gl-fact"],
      ["gl-fact", "mfg-down"],
    ],
  },
];

export const srcUrl = (file, line) => src(file, line);
