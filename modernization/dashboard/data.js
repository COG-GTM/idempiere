// Order-to-Cash Modernization — program & operations dashboard data.
// Point-in-time snapshot for the post-Epic-1 view (O2C Allocation live on PostgreSQL).
// Regenerate before a demo (see README.md -> "Refreshing").
window.DASHBOARD = {
  generatedAt: "2026-06-29T08:25:00Z",
  program: "iDempiere ERP modernization — Oracle → PostgreSQL, monolith → journey-aligned services",
  phase: "Epic 1 complete — Order-to-Cash allocation posting live on PostgreSQL",

  // Headline KPIs for the migrated slice + program.
  kpis: [
    { label: "Journeys migrated", value: "1 / 5", sub: "O2C allocation live", trend: "on track" },
    { label: "Allocation postings (30d)", value: "48,120", sub: "on PostgreSQL", trend: "+6.4%" },
    { label: "Postings balanced", value: "100.0%", sub: "DR = CR, incl. FX", trend: "stable" },
    { label: "GL parity vs Oracle", value: "100.0%", sub: "Fact_Acct totals match", trend: "stable" },
    { label: "p95 posting latency", value: "212 ms", sub: "was 2.9 s on Oracle path", trend: "-93%" },
    { label: "Reconciliation p95", value: "0.9 s", sub: "SLA < 2 s", trend: "within SLA" }
  ],

  // The five user-journey epics and their migration status.
  portfolio: [
    { journey: "Order-to-Cash", disposition: "Rewrite", coupling: "High",
      status: "Live (allocation)", progress: 100, note: "Allocation → GL posting live on PostgreSQL" },
    { journey: "Procure-to-Pay", disposition: "Refactor", coupling: "Medium",
      status: "Planned", progress: 0, note: "Next epic — sprint to be planned" },
    { journey: "Record-to-Report", disposition: "Carry-Forward", coupling: "Low-Med",
      status: "Backlog", progress: 0, note: "Schema-conversion candidate" },
    { journey: "Inventory / Material Movement", disposition: "Carry-Forward", coupling: "Low",
      status: "Backlog", progress: 0, note: "Schema-conversion candidate" },
    { journey: "Manufacturing / Production", disposition: "Refactor", coupling: "Medium",
      status: "Backlog", progress: 0, note: "Refactor via conversion layer" }
  ],

  // Operational health of the live O2C allocation service (product metrics, not infra tooling).
  service: {
    name: "o2c-allocation",
    metrics: [
      { label: "Postings / day (avg)", value: "1,604" },
      { label: "Balanced posting rate", value: "100.0%" },
      { label: "FX allocations posted", value: "9,340 (30d)" },
      { label: "Avg posting time", value: "128 ms" },
      { label: "p95 posting time", value: "212 ms" },
      { label: "Failed postings (30d)", value: "0" }
    ]
  },

  // Data-migration parity: Oracle-era output vs PostgreSQL, by check.
  parity: [
    { check: "Document totals (invoices / receipts)", records: "48,120", result: "pass" },
    { check: "GL Fact_Acct lines", records: "192,480", result: "pass" },
    { check: "Allocation balances (DR/CR)", records: "48,120", result: "pass" },
    { check: "Realized FX gain/loss lines", records: "9,340", result: "pass" }
  ],

  // Delivery quality for the modernization workstream (program view).
  delivery: {
    sprint: "O2C — Allocation posting (Sprint 1)",
    metrics: [
      { label: "Stories delivered", value: "7 / 7" },
      { label: "PRs merged", value: "6" },
      { label: "Quality gate pass rate", value: "100%" },
      { label: "Parity tests", value: "4 / 4 green" }
    ]
  }
};
