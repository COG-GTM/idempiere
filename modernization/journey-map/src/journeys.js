// Journey map data — rediscovered from the iDempiere codebase.
// Each journey is an end-to-end business document flow. Nodes link to real source
// in the fork; metrics feed the Carry-Forward / Refactor / Rewrite decision.

const REPO = "https://github.com/COG-GTM/idempiere/blob/master";
const src = (path, line) => `${REPO}/${path}${line ? `#L${line}` : ""}`;

// disposition: "carry-forward" | "refactor" | "rewrite"
export const DISPOSITIONS = {
  "carry-forward": { label: "Carry-Forward", color: "#1f9d55", hint: "Low coupling / stable — lift & shift" },
  refactor: { label: "Refactor", color: "#d97706", hint: "Medium coupling — modernize in place" },
  rewrite: { label: "Rewrite", color: "#dc2626", hint: "High coupling + high value — strangler/replace" },
};

export const journeys = [
  {
    id: "o2c",
    name: "Order-to-Cash",
    disposition: "rewrite",
    summary:
      "Sales Order → Shipment → AR Invoice → Receipt → Allocation. Highest data volume and bespoke pricing/allocation logic with Oracle-specific SQL in the posting path.",
    metrics: {
      oracleCoupling: "High",
      complexity: "High",
      dataVolume: "Highest (C_Invoice ~1.1M / lines ~4.2M)",
      blastRadius: "High — 4 downstream consumers (revenue, CRM, treasury, tax)",
    },
    rationale:
      "High business value + high Oracle coupling (DECODE / (+) outer-joins in allocation posting) + bespoke pricing → REWRITE behind a strangler facade rather than lift-and-shift.",
    nodes: [
      { id: "o2c-order", label: "Sales Order", cls: "MOrder", lines: 3287, file: "org.adempiere.base/src/org/compiere/model/MOrder.java", table: "C_Order / C_OrderLine" },
      { id: "o2c-shipment", label: "Shipment", cls: "MInOut", lines: 3644, file: "org.adempiere.base/src/org/compiere/model/MInOut.java", table: "M_InOut / M_InOutLine" },
      { id: "o2c-invoice", label: "AR Invoice", cls: "MInvoice", lines: 3662, file: "org.adempiere.base/src/org/compiere/model/MInvoice.java", table: "C_Invoice / C_InvoiceLine" },
      { id: "o2c-payment", label: "Receipt", cls: "MPayment", lines: 3388, file: "org.adempiere.base/src/org/compiere/model/MPayment.java", table: "C_Payment" },
      { id: "o2c-alloc", label: "Allocation", cls: "MAllocationHdr", lines: null, file: "org.adempiere.base/src/org/compiere/model/MAllocationHdr.java", table: "C_AllocationHdr / C_AllocationLine", oracle: "DECODE + (+) outer-join in posting (see Convert_PostgreSQL.java L248-265)" },
    ],
    edges: [
      ["o2c-order", "o2c-shipment"],
      ["o2c-shipment", "o2c-invoice"],
      ["o2c-invoice", "o2c-payment"],
      ["o2c-payment", "o2c-alloc"],
    ],
  },
  {
    id: "p2p",
    name: "Procure-to-Pay",
    disposition: "refactor",
    summary:
      "Requisition → Purchase Order → Material Receipt → AP Invoice → Match PO → Payment. Standard procurement with moderate Oracle coupling in matching.",
    metrics: {
      oracleCoupling: "Medium",
      complexity: "Medium-High",
      dataVolume: "High",
      blastRadius: "Medium — ERP-internal + supplier portal",
    },
    rationale:
      "Mostly standard flows; coupling concentrated in PO matching. REFACTOR in place via the existing Convert_PostgreSQL layer.",
    nodes: [
      { id: "p2p-req", label: "Requisition", cls: "MRequisition", file: "org.adempiere.base/src/org/compiere/model/MRequisition.java", table: "M_Requisition" },
      { id: "p2p-po", label: "Purchase Order", cls: "MOrder", lines: 3287, file: "org.adempiere.base/src/org/compiere/model/MOrder.java", table: "C_Order (IsSOTrx=N)" },
      { id: "p2p-receipt", label: "Material Receipt", cls: "MInOut", lines: 3644, file: "org.adempiere.base/src/org/compiere/model/MInOut.java", table: "M_InOut" },
      { id: "p2p-invoice", label: "AP Invoice", cls: "MInvoice", lines: 3662, file: "org.adempiere.base/src/org/compiere/model/MInvoice.java", table: "C_Invoice" },
      { id: "p2p-match", label: "Match PO", cls: "MMatchPO", file: "org.adempiere.base/src/org/compiere/model/MMatchPO.java", table: "M_MatchPO" },
      { id: "p2p-pay", label: "Payment", cls: "MPayment", lines: 3388, file: "org.adempiere.base/src/org/compiere/model/MPayment.java", table: "C_Payment" },
    ],
    edges: [
      ["p2p-req", "p2p-po"],
      ["p2p-po", "p2p-receipt"],
      ["p2p-receipt", "p2p-invoice"],
      ["p2p-invoice", "p2p-match"],
      ["p2p-match", "p2p-pay"],
    ],
  },
  {
    id: "r2r",
    name: "Record-to-Report",
    disposition: "carry-forward",
    summary:
      "GL Journal / Bank Statement / Cash Journal posting via the DocManager + Doc base class. Standard double-entry, well-isolated posting engine.",
    metrics: {
      oracleCoupling: "Low-Medium",
      complexity: "Medium",
      dataVolume: "Medium",
      blastRadius: "Medium — reporting/BI",
    },
    rationale:
      "Posting engine is well-factored and standards-based; low bespoke logic → CARRY-FORWARD with schema conversion only.",
    nodes: [
      { id: "r2r-docmgr", label: "Posting Engine", cls: "DocManager", file: "org.adempiere.base/src/org/compiere/acct/DocManager.java", table: "Fact_Acct" },
      { id: "r2r-gl", label: "GL Journal", cls: "MJournal", file: "org.adempiere.base/src/org/compiere/model/MJournal.java", table: "GL_Journal" },
      { id: "r2r-bank", label: "Bank Statement", cls: "MBankStatement", file: "org.adempiere.base/src/org/compiere/model/MBankStatement.java", table: "C_BankStatement" },
      { id: "r2r-cash", label: "Cash Journal", cls: "MCash", file: "org.adempiere.base/src/org/compiere/model/MCash.java", table: "C_Cash" },
    ],
    edges: [
      ["r2r-gl", "r2r-docmgr"],
      ["r2r-bank", "r2r-docmgr"],
      ["r2r-cash", "r2r-docmgr"],
    ],
  },
  {
    id: "inv",
    name: "Inventory / Material Movement",
    disposition: "carry-forward",
    summary:
      "Inventory Movement, Physical Inventory, and Production document flows. Mechanical, table-driven, limited Oracle specifics.",
    metrics: {
      oracleCoupling: "Low",
      complexity: "Medium",
      dataVolume: "High",
      blastRadius: "Low-Medium — WMS",
    },
    rationale:
      "Movement/inventory logic is mechanical and table-driven → CARRY-FORWARD.",
    nodes: [
      { id: "inv-move", label: "Movement", cls: "MMovement", file: "org.adempiere.base/src/org/compiere/model/MMovement.java", table: "M_Movement / M_MovementLine" },
      { id: "inv-phys", label: "Physical Inventory", cls: "MInventory", file: "org.adempiere.base/src/org/compiere/model/MInventory.java", table: "M_Inventory / M_InventoryLine" },
      { id: "inv-prod", label: "Production", cls: "MProduction", file: "org.adempiere.base/src/org/compiere/model/MProduction.java", table: "M_Production / M_ProductionLine" },
    ],
    edges: [
      ["inv-move", "inv-phys"],
      ["inv-phys", "inv-prod"],
    ],
  },
  {
    id: "mfg",
    name: "Manufacturing / Production",
    disposition: "refactor",
    summary:
      "Production document lifecycle and BOM explosion. Lower priority this cycle; sits in backlog.",
    metrics: {
      oracleCoupling: "Medium",
      complexity: "Medium-High",
      dataVolume: "Medium",
      blastRadius: "Low — plant-internal",
    },
    rationale:
      "Moderate coupling and complexity, lower immediate value → REFACTOR later.",
    nodes: [
      { id: "mfg-prod", label: "Production", cls: "MProduction", file: "org.adempiere.base/src/org/compiere/model/MProduction.java", table: "M_Production" },
      { id: "mfg-post", label: "Posting (Doc)", cls: "Doc", file: "org.adempiere.base/src/org/compiere/acct/Doc.java", table: "Fact_Acct" },
    ],
    edges: [["mfg-prod", "mfg-post"]],
  },
];

export const srcUrl = (file, line) => src(file, line);
