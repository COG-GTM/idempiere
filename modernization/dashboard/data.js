// Oracle -> PostgreSQL modernization demo — Devin activity snapshot.
// Real data sourced from the Devin MCP (session search + per-session get).
// No API key required; regenerate before a demo (see README.md -> "Refreshing").
window.DEMO_METRICS = {
  generatedAt: "2026-06-29T08:25:00Z",
  window: "Modernization demo (COG-GTM/idempiere, Jira L8N2)",
  note:
    "Point-in-time snapshot. Cascade PRs (#7/#8/#9/#10) are intentionally left un-merged so the seeded bug stays armed for the live Sentry/Datadog demo.",
  epics: [
    { key: "L8N2-17", journey: "Order-to-Cash", disposition: "Rewrite", coupling: "High" },
    { key: "L8N2-46", journey: "Procure-to-Pay", disposition: "Refactor", coupling: "Medium" },
    { key: "L8N2-47", journey: "Record-to-Report", disposition: "Carry-Forward", coupling: "Low-Med" },
    { key: "L8N2-48", journey: "Inventory / Material Movement", disposition: "Carry-Forward", coupling: "Low" },
    { key: "L8N2-49", journey: "Manufacturing / Production", disposition: "Refactor", coupling: "Medium" }
  ],
  sessions: [
    {
      id: "83d62cffcde14fddaa75007e310bc9d3",
      title: "Fix o2c.allocation.posting.duration regression",
      lane: "Cascade — Datadog (latency)",
      trigger: "Datadog p95 > 2s → Slack → Devin",
      acus: 1.83,
      pr: { repo: "COG-GTM/idempiere", number: 7, state: "closed" },
      sonar: "passed",
      jira: "L8N2-37"
    },
    {
      id: "d7bdfd68a3214d45a7527ea33ab30013",
      title: "Fix o2c.allocation posting imbalance",
      lane: "Cascade — Sentry (correctness)",
      trigger: "Sentry PostingNotBalancedError → Slack → Devin",
      acus: 1.0,
      pr: { repo: "COG-GTM/idempiere", number: 8, state: "closed" },
      sonar: "n/a (based off master before gate landed)",
      jira: "L8N2-38"
    },
    {
      id: "b3ca679517a24f81b1f655876d52e440",
      title: "Fix O2C Allocation latency",
      lane: "Cascade — Datadog (latency)",
      trigger: "Datadog latency → Slack → Devin",
      acus: 1.03,
      pr: { repo: "COG-GTM/idempiere", number: 10, state: "open" },
      sonar: "running",
      jira: "—"
    },
    {
      id: "4c685391f6f049a3b5c258bebe5328b3",
      title: "!plan_migration rehearsal (plan one epic)",
      lane: "Planning — playbook",
      trigger: "Playbook !plan_migration (rehearsal)",
      acus: 1.26,
      pr: { repo: "COG-GTM/idempiere", number: 9, state: "closed" },
      sonar: "passed",
      jira: "L8N2-39 (dry-run)"
    },
    {
      id: "cbc561722be74a80be5b58a6822f18ce",
      title: "Re-jig L8N2 board: 5 journey epics + cleanup",
      lane: "Prep — orchestration",
      trigger: "Parent-spawned child session",
      acus: 1.85,
      pr: null,
      sonar: "—",
      jira: "L8N2-17/46/47/48/49"
    },
    {
      id: "77a66ec1c37b4241991c966ed42e5026",
      title: "[TEST] Nightly L8N2 migration digest → #sam-dd-demo",
      lane: "Scheduled — status digest",
      trigger: "Schedule (weekday 08:00 UTC), one-off test",
      acus: null,
      pr: null,
      sonar: "—",
      jira: "read-only"
    }
  ],
  // Early runs before the Slack→Devin automation was repointed from
  // event-driven-devin to idempiere/L8N2. Kept for an honest audit trail; tidied on the board.
  preRepoint: [
    { id: "45f492e0b8574444b6d5bc5b9b00e940", acus: 2.17, pr: "COG-GTM/event-driven-devin#2570 (closed)" },
    { id: "590236e56bf1439a8a693b1f8a8ff246", acus: 3.58, pr: "COG-GTM/event-driven-devin#2563 (open)" },
    { id: "ed4bd7eedd33422f848b2a692a0f5aa2", acus: 2.85, pr: "COG-GTM/event-driven-devin#2560 (open)" },
    { id: "ec37371f02f74e8984b996b3c0de47b5", acus: 1.87, pr: "COG-GTM/event-driven-devin#2565 (open)" }
  ]
};
