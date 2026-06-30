// Journey map data — rediscovered from the iDempiere codebase (COG-GTM/idempiere).
//
// Each journey is an end-to-end business document flow. Every node links to REAL
// source in the fork. Line counts are measured (`wc -l`) from the checked-out tree,
// not estimated. Each journey terminates in the accounting engine: a document's
// DocAction.completeIt() hands off to the matching Doc_* posting class, which calls
// createFacts() to emit balanced Fact_Acct (GL) lines.
//
// The Oracle→PostgreSQL coupling is concentrated in the runtime SQL-translation
// layer (org.idempiere.db.postgresql .../Convert_PostgreSQL.java +
// org.adempiere.base .../dbPort/Convert_SQL92.java), exercised most heavily by the
// allocation posting SQL. See modernization/analysis/SYSTEM_ANALYSIS.md.

const REPO = "https://github.com/COG-GTM/idempiere/blob/master";
const src = (path, line) => `${REPO}/${path}${line ? `#L${line}` : ""}`;

const MODEL = "org.adempiere.base/src/org/compiere/model";
const ACCT = "org.idempiere.acct/src/org/idempiere/acct/doc";
const CONV_PG =
  "org.idempiere.db.postgresql/src/org/idempiere/db/postgresql/dbPort/Convert_PostgreSQL.java";

// disposition: "carry-forward" | "refactor" | "rewrite"
export const DISPOSITIONS = {
  "carry-forward": { label: "Carry-Forward", color: "#1f9d55", hint: "Low coupling / stable — convert schema & lift-and-shift" },
  refactor: { label: "Refactor", color: "#d97706", hint: "Medium coupling — modernize in place via the conversion layer" },
  rewrite: { label: "Rewrite", color: "#dc2626", hint: "High coupling + high value — strangler-fig replacement" },
};

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
      "Highest business value + highest Oracle coupling (DECODE / (+) outer-joins in Doc_AllocationHdr.createFacts, the 2,159-line posting class) + bespoke logic → REWRITE behind a strangler facade. This is the slice migrated first (see the deployable node).",
    nodes: [
      { id: "o2c-order", layer: "document", label: "Sales Order", cls: "MOrder", lines: 3287, file: `${MODEL}/MOrder.java`, table: "C_Order / C_OrderLine" },
      { id: "o2c-shipment", layer: "document", label: "Shipment", cls: "MInOut", lines: 3644, file: `${MODEL}/MInOut.java`, table: "M_InOut / M_InOutLine" },
      { id: "o2c-invoice", layer: "document", label: "AR Invoice", cls: "MInvoice", lines: 3662, file: `${MODEL}/MInvoice.java`, table: "C_Invoice / C_InvoiceLine" },
      { id: "o2c-payment", layer: "document", label: "Receipt", cls: "MPayment", lines: 3388, file: `${MODEL}/MPayment.java`, table: "C_Payment" },
      { id: "o2c-alloc", layer: "document", label: "Allocation", cls: "MAllocationHdr", lines: 1097, file: `${MODEL}/MAllocationHdr.java`, table: "C_AllocationHdr / C_AllocationLine" },
      { id: "o2c-post", layer: "posting", label: "Allocation posting", cls: "Doc_AllocationHdr", lines: 2159, file: `${ACCT}/Doc_AllocationHdr.java`, line: 192, table: "→ Fact_Acct", oracle: "createFacts() (L192) books UnallocatedCash / Receivable / Discount / WriteOff / RealizedGain/Loss. The conversion-rate + payment lookups are the DECODE / (+) outer-join SQL translated at runtime by Convert_PostgreSQL.java (L248-265).", convFile: CONV_PG, convLine: 248 },
      FACT_ACCT,
      { id: "o2c-deployable", layer: "deployable", label: "o2c-allocation service ✅", cls: "Node/Express + PostgreSQL", file: "modernization/services/o2c-allocation/src/allocation.js", table: "PostgreSQL-native fact_acct", note: "PRE-COMPLETED migration of allocation posting. PG-native SQL (NVL→COALESCE, (+)→ANSI LEFT JOIN, NUMBER→NUMERIC). Parity-tested vs Oracle-era GL; instrumented with Sentry + Datadog + Slack→Devin." },
      { id: "o2c-down-rev", layer: "downstream", label: "Revenue / Tax / Treasury", cls: "GL consumers", note: "Read Fact_Acct + allocation output for revenue recognition, tax and cash positioning." },
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
      "Mostly standard flows with coupling concentrated in matching (Doc_MatchInv is 2,878 lines). REFACTOR in place using the existing Convert_PostgreSQL layer rather than a full rewrite.",
    nodes: [
      { id: "p2p-req", layer: "document", label: "Requisition", cls: "MRequisition", lines: 624, file: `${MODEL}/MRequisition.java`, table: "M_Requisition" },
      { id: "p2p-po", layer: "document", label: "Purchase Order", cls: "MOrder", lines: 3287, file: `${MODEL}/MOrder.java`, table: "C_Order (IsSOTrx=N)" },
      { id: "p2p-receipt", layer: "document", label: "Material Receipt", cls: "MInOut", lines: 3644, file: `${MODEL}/MInOut.java`, table: "M_InOut" },
      { id: "p2p-invoice", layer: "document", label: "AP Invoice", cls: "MInvoice", lines: 3662, file: `${MODEL}/MInvoice.java`, table: "C_Invoice" },
      { id: "p2p-match", layer: "document", label: "Match PO/Invoice", cls: "MMatchInv", lines: 479, file: `${MODEL}/MMatchInv.java`, table: "M_MatchInv / M_MatchPO" },
      { id: "p2p-pay", layer: "document", label: "Payment", cls: "MPayment", lines: 3388, file: `${MODEL}/MPayment.java`, table: "C_Payment" },
      { id: "p2p-post", layer: "posting", label: "Match posting", cls: "Doc_MatchInv", lines: 2878, file: `${ACCT}/Doc_MatchInv.java`, table: "→ Fact_Acct", oracle: "Reconciles PO/receipt/invoice accruals (NotInvoicedReceipts, InvoicePriceVariance). Currency conversion goes through the same translated SQL path as O2C.", convFile: CONV_PG, convLine: 248 },
      FACT_ACCT,
      { id: "p2p-down", layer: "downstream", label: "AP / Supplier portal", cls: "GL consumers", note: "Accounts payable aging and supplier settlement read match + payment output." },
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
      "The posting engine (Doc 2,510 lines, DocManager 908) is well-factored and standards-based with low bespoke logic → CARRY-FORWARD with schema conversion only.",
    nodes: [
      { id: "r2r-gl", layer: "document", label: "GL Journal", cls: "MJournal", lines: 1110, file: `${MODEL}/MJournal.java`, table: "GL_Journal / GL_JournalLine" },
      { id: "r2r-bank", layer: "document", label: "Bank Statement", cls: "MBankStatement", lines: 804, file: `${MODEL}/MBankStatement.java`, table: "C_BankStatement" },
      { id: "r2r-cash", layer: "document", label: "Cash Journal", cls: "MCash", lines: 898, file: `${MODEL}/MCash.java`, table: "C_Cash" },
      { id: "r2r-mgr", layer: "posting", label: "Posting dispatcher", cls: "DocManager / Doc", lines: 908, file: `${ACCT}/DocManager.java`, table: "→ Fact_Acct", note: "DocManager.postDocument routes each document to its Doc_* class; the Doc base (2,510 lines) builds and balances facts." },
      FACT_ACCT,
      { id: "r2r-down", layer: "downstream", label: "Reporting / BI", cls: "Fact_Acct consumers", note: "Financial statements, consolidation and BI extracts read Fact_Acct." },
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
    nodes: [
      { id: "inv-move", layer: "document", label: "Inventory Move", cls: "MMovement", lines: 1230, file: `${MODEL}/MMovement.java`, table: "M_Movement / M_MovementLine" },
      { id: "inv-phys", layer: "document", label: "Physical Inventory", cls: "MInventory", lines: 1354, file: `${MODEL}/MInventory.java`, table: "M_Inventory / M_InventoryLine" },
      { id: "inv-post", layer: "posting", label: "Movement posting", cls: "Doc_Movement", lines: 297, file: `${ACCT}/Doc_Movement.java`, table: "→ Fact_Acct", note: "Books inventory asset movement between warehouses/locators at cost." },
      FACT_ACCT,
      { id: "inv-down", layer: "downstream", label: "WMS / Planning", cls: "stock consumers", note: "Available-to-promise and replenishment read on-hand & valuation." },
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
    nodes: [
      { id: "mfg-prod", layer: "document", label: "Production", cls: "MProduction", lines: 1100, file: `${MODEL}/MProduction.java`, table: "M_Production" },
      { id: "mfg-line", layer: "document", label: "Production Line / BOM", cls: "MProductionLine", lines: 524, file: `${MODEL}/MProductionLine.java`, table: "M_ProductionLine" },
      { id: "mfg-post", layer: "posting", label: "Production posting", cls: "Doc_Production", lines: 561, file: `${ACCT}/Doc_Production.java`, table: "→ Fact_Acct", note: "Books component issue and finished-goods receipt at cost (WIP clearing)." },
      FACT_ACCT,
      { id: "mfg-down", layer: "downstream", label: "MRP / Costing", cls: "plant consumers", note: "Material planning and product costing read production output." },
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
