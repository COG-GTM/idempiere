# iDempiere — Legacy System Analysis for Oracle → PostgreSQL Modernization

> **Purpose.** This is the reverse-engineering deliverable: a source-grounded analysis of the
> legacy ERP, produced by tracing the actual code (not documentation alone). It establishes that
> we genuinely understand the system, quantifies the Oracle coupling and downstream blast radius,
> and decomposes the monolith into a target set of deployables. Everything here is cited to real
> files and verified metrics in this repository.
>
> **Stand-in note.** `COG-GTM/idempiere` is a fork of the open-source iDempiere ERP (descendant of
> Compiere, originally Oracle-only, code dating to 1999). It is used here as a faithful proxy for a
> decades-old Oracle/COTS system: same architectural shape, same document-driven domain, the same
> dual-database portability layer a real migration must confront.

---

## 1. Executive summary

iDempiere is a document-driven ERP: every business process is a **document** that moves through a
fixed lifecycle and, on completion, **posts** to the general ledger. The system was born Oracle-only
and later made database-portable through a **SQL-translation layer** rather than by removing Oracle
idioms from the codebase. As a result the Oracle coupling is *concentrated* (in the portability
layer and the migration scripts) but *pervasive in surface area* (hundreds of SQL fragments use
Oracle functions that are translated at runtime).

The migration is therefore **not** a uniform rewrite. It is a journey-by-journey decision:

- **Carry-forward** journeys that already round-trip cleanly through the PostgreSQL provider.
- **Refactor** journeys whose SQL leans on translated Oracle idioms (`DECODE`, `(+)` joins, `NVL`,
  `SYSDATE`, sequences) — modernize the SQL in place to native ANSI/PostgreSQL.
- **Rewrite / extract** the highest-value, highest-coupling journeys as independent deployables
  (strangler-fig), starting with **Order-to-Cash allocation posting**.

The rest of this document is the evidence.

## 2. System scale (measured in this repo)

| Metric | Value | How measured |
|---|---|---|
| OSGi plugins / modules (`org.*`) | **66** | `ls -d org.*` |
| Java source files | **4,541** | `find -name '*.java'` |
| Posting document classes (`Doc_*`) | **20** | `find -name 'Doc_*.java'` |
| `process` classes (server-side business logic) | **328** | `find -path '*process*' -name '*.java'` |
| Callout classes (model-driven UI logic) | **57** | `find -name 'Callout*.java'` |
| Oracle DDL/DML migration scripts | **1,099** | `find migration -path '*oracle*' -name '*.sql'` |
| PostgreSQL migration scripts (parallel set) | **1,099** | `find migration -path '*postgresql*' -name '*.sql'` |
| Both DB providers shipped | Oracle **and** PostgreSQL | `org.compiere.db.oracle.provider`, `org.compiere.db.postgresql.provider` |

The 1,099 ⇄ 1,099 split is itself the headline: **every schema change is authored twice**, once per
database. That is the maintenance tax a single-target migration is meant to retire.

## 3. Architecture

- **Runtime:** OSGi (Equinox) bundles built with **Maven + Tycho**. The full build is a multi-hour
  product build — unsuitable as a fast PR gate (see CI strategy in `modernization/`).
- **Layering:**
  - `org.adempiere.base` — core model (`PO`/`X_*`/`M*` active-record classes), the **DB
    abstraction** (`org.compiere.db.DB`) and the **SQL portability layer** (`org.compiere.dbPort`).
  - `org.idempiere.acct` — the **accounting engine** (`Doc`, `DocLine`, `Fact`, `FactLine`,
    `Doc_*`).
  - `org.adempiere.ui.zk` — the ZK web UI (windows, field editors, dashboards).
  - `org.compiere.db.oracle.provider` / `org.compiere.db.postgresql.provider` — per-database
    JDBC providers (HikariCP pooling), the seam where Oracle vs PostgreSQL is selected.
- **Application Dictionary (AD):** the system is **metadata-driven** — windows, tabs, fields,
  processes and even validation are defined in `AD_*` tables, not hard-coded screens. This matters
  for migration: behaviour lives in data as well as code.

### 3.1 The database-portability layer (the crux of Oracle coupling)

iDempiere does not write native PostgreSQL. It writes **Oracle-flavoured SQL** and translates it at
runtime for PostgreSQL through:

- `org.compiere.dbPort/Convert_SQL92.java` — base SQL-92 normalisation, including **Oracle `(+)`
  outer-join → ANSI `JOIN`** rewriting (helped by `org.compiere.dbPort/Join.java`).
- `org.compiere.db.postgresql.provider/.../dbPort/Convert_PostgreSQL.java` (1,253 lines) — the
  PostgreSQL-specific rewriter. Concrete, verified transformations:
  - **`DECODE(...)` → `CASE WHEN ... END`** — `Convert_PostgreSQL.java:248-265`
    (`DECODE (a,1,'one',2,'two','none')` ⇒ `CASE WHEN a=1 THEN 'one' WHEN a=2 THEN 'two' ELSE 'none' END`).
  - **`SYSDATE`** handling — `sysDatePattern` at `Convert_PostgreSQL.java:60`.
  - plus `TO_DATE`/`TO_CHAR`/`TRUNC`/`ROWNUM`/`DUAL`/sequence-syntax normalisation.

**Implication:** the coupling is *translated*, not *removed*. Migrating to PostgreSQL-native code
means moving each journey's SQL off the translation layer onto idioms PostgreSQL runs directly — so
the translator can eventually be retired per journey.

## 4. Document lifecycle & posting engine

Every journey is built on two shared mechanisms.

### 4.1 The `DocAction` state machine

`org.compiere.process/DocAction.java` defines the lifecycle every document obeys
(`DocAction.java:67-85`):

```
Drafted(DR) → InProgress(IP) → Approved(AP)/NotApproved(NA)
            → Completed(CO) → Closed(CL)
            → Voided(VO) / Reversed(RE) / Invalid(IN) / Unknown(??)
```

`completeIt()` is the hinge: it is where a document becomes financially real and triggers posting.

### 4.2 The posting pipeline (Order-to-Cash anchor)

Traced through `org.idempiere.acct`:

```
DocManager.postDocument(AD_Table_ID, Record_ID)
  → Doc.post()                       // lock, status & period checks, txn mgmt
    → Doc.loadDocumentDetails()      // subclass loads business data
    → Doc.postLogic()                // balance / convertible / open-period checks
      → Doc.createFacts(acctSchema)  // subclass: build accounting entries
        → Fact.createLine(...)       // one FactLine per GL effect
          → FactLine.convert()       // source → accounting currency
      → Fact.save()                  // persist to Fact_Acct (MFactAcct / X_Fact_Acct)
```

On repost, prior `Fact_Acct` rows are archived to `T_Fact_Acct_History` then deleted before
re-creation.

**Allocation posting** (`Doc_AllocationHdr.java`, 2,159 lines, `createFacts` at
`Doc_AllocationHdr.java:192`) is the richest O2C accounting step. Its GL effects (verified in the
source) are: **UnallocatedCash, Receivable (C_Receivable), DiscountExp, WriteOff**, plus
**RealizedGain / RealizedLoss** from multi-currency settlement. This is the exact logic the
pre-completed migration slice (Section 9) re-implements on PostgreSQL with a parity test.

## 5. User journeys (rediscovered from code)

Journeys are derived from the document graph (each document type = a step), the active-record model
classes that own them, the `Doc_*` posting class, and the underlying tables. LOC is the actual
file length in this repo and is used as a complexity proxy.

| Journey | Document flow | Anchor model classes (LOC) | Posting class (LOC) | Disposition |
|---|---|---|---|---|
| **Order-to-Cash (O2C)** | Sales Order → Shipment → Invoice → Payment → **Allocation** → GL | `MOrder` (3,287), `MInOut` (3,644), `MInvoice` (3,662), `MPayment` (3,388), `MAllocationHdr` (1,097) | `Doc_AllocationHdr` (2,159), `Doc_Invoice` (1,601) | **Rewrite / extract first** |
| **Procure-to-Pay (P2P)** | Requisition → PO → Receipt → Match → Vendor Invoice → Payment | `MRequisition` (624), `MOrder` (3,287), `MInOut` (3,644), `MMatchPO` (1,480), `MMatchInv` (479) | `Doc_MatchInv` (2,878), `Doc_MatchPO` | **Refactor** |
| **Record-to-Report (R2R)** | GL Journal → Fact_Acct → financial reports | `MJournal`, `MFactAcct` | `Doc_GLJournal` | **Refactor** (well-factored) |
| **Inventory / Material Movement** | Movement, Inventory count, internal use | `MMovement` (1,230), `MInventory` (1,354) | `Doc_Movement`, `Doc_Inventory` | **Carry-forward** (mechanical) |
| **Manufacturing** | Production → BOM issue/receipt | `MProduction` (1,100) | `Doc_Production` | **Carry-forward** (low priority) |

Scoring axes (full matrix in `modernization/plan/MIGRATION_PLAN.md`): Oracle-coupling density,
code complexity (LOC + branching), data volume, downstream blast radius, business criticality.

## 6. Oracle-coupling inventory (measured)

| Construct | Occurrences | Where / how handled |
|---|---|---|
| `NVL(...)` in Java SQL strings | **217** | translated to `COALESCE` via portability layer |
| Oracle `(+)` outer joins | **19** (base) | `Convert_SQL92.java` + `Join.java` → ANSI joins |
| `SYSDATE` in Java SQL | **11** | `Convert_PostgreSQL.java:60` |
| `DECODE(...)` literal in Java | 1 (+ runtime translation) | `Convert_PostgreSQL.java:248-265` → `CASE` |
| Parallel migration scripts | **1,099 × 2** | hand-authored per database under `migration/` |
| Sequences / `DUAL` / `ROWNUM` / `TO_DATE` | pervasive | normalised in `Convert_PostgreSQL.java` |

**Reading:** raw Oracle idioms are few in *unique* form but high in *count* and are kept alive by the
translation layer. A journey is "PostgreSQL-native" only once its SQL no longer depends on that
translation — which is the refactor work the backlog tracks.

## 7. Data estate (sizing the migration, mock)

The migration-effort axis needs row volumes per journey. Production figures are unavailable for a
public fork, so the demo uses a **mock Oracle estate** (DuckDB-backed, drop-in `snowflake.connector`
shape) profiled by Dana (see `modernization/DANA_HOWTO.md`). Volume drives both downtime windows and
parity-test sample sizes; the largest tables (`C_Invoice`/`C_InvoiceLine`, `Fact_Acct`,
`M_Transaction`) gate O2C and R2R cutover.

## 8. Downstream / integration blast radius

What breaks if tables or SQL change under migration (surfaces verified against the plugin set):

| Surface | Module / classes | Migration risk |
|---|---|---|
| Web services / external integration | `org.idempiere.webservices`, `org.idempiere.adinterface` (`Process.java`; CXF/Jersey) | embedded SQL with `ROWNUM`/`DUAL`/date fns fails on PG; type/serialization drift |
| Data replication | `org.adempiere.replication`, `org.adempiere.replication.server` (`I_AD_Replication*`) | sequences / triggers / CDC are DB-specific; replication SQL must be PG-compatible |
| JasperReports | `org.adempiere.report.jasper(.library)` — **5 `.jrxml`** templates | report SQL embeds Oracle functions; `.jrxml` queries need review |
| Scheduled processors / background jobs | `org.adempiere.server` (`ServerProcessCtl`, `BackgroundJob`) | nightly accounting/inventory jobs run heavy SQL — silent failures if not ported |
| 2Pack (dictionary import/export) | `org.adempiere.pipo(.handlers)` (`PipoDictionaryService`) | schema/type drift breaks PackIn/PackOut XML |
| POS / web UI | `org.adempiere.ui.zk` (`I_U_POSTerminal`) | data-retrieval SQL must be PG-compatible |

This table is the basis for the **downstream registry** (`modernization/tools/downstream/registry.json`)
that the pre-work enrichment step renders into each ticket.

## 9. Decomposition into deployables (target architecture)

The monolith decomposes along the document graph into bounded contexts. Candidate deployables, in
strangler-fig priority order:

1. **O2C Allocation & GL Posting service** *(pre-completed slice — see Section 10)* — extracts the
   allocation→Fact_Acct posting path onto PostgreSQL-native SQL behind a small API. Highest coupling
   density + criticality ⇒ first.
2. **Invoicing service** — `C_Invoice` lifecycle + `Doc_Invoice` posting.
3. **Procurement & Matching service** — PO / receipt / `Doc_MatchInv` / `Doc_MatchPO`.
4. **Inventory/Movement service** — mechanical, low coupling ⇒ carry-forward as-is behind an adapter.
5. **Reporting/R2R read-model** — `Fact_Acct`-backed reporting, candidate for a read replica.
6. **Integration edge** (web services, replication, Jasper) — wrapped, last to move.

Each deployable owns its tables, exposes an API, and is independently observable — which is what lets
us instrument one in isolation.

## 10. The pre-completed slice (what runs in the demo)

To make the migration tangible we ship **one** deployable already migrated and **running**:
`modernization/services/o2c-allocation/` (Node/Express + PostgreSQL). It re-implements the
allocation-posting accounting from `Doc_AllocationHdr` (UnallocatedCash / Receivable / Discount /
WriteOff / Realized Gain-Loss) using **PostgreSQL-native SQL** — i.e. the migrated form of the
Oracle `DECODE`/`(+)`/`NVL` constructs. It is instrumented with **Sentry + Datadog** and wired to
**Slack → Devin**. A seeded regression (a reintroduced Oracle idiom / rounding mismatch) lets us show
the slice **breaking live**, an alert firing, and Devin triaging it to a PR. A **parity test**
(Oracle-expected vs PostgreSQL-actual `Fact_Acct` balances) is the acceptance gate.

## 11. Risk register (top items)

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Translated Oracle SQL behaves differently natively (NULL/`NVL`, date trunc, numeric rounding) | High | High | per-journey parity tests on `Fact_Acct`, document totals, allocation balances |
| Dual migration-script regime drifts during transition | Medium | High | freeze Oracle-side changes per journey once cut over; single-target after |
| Downstream consumers (Jasper, web services, replication) break silently | Medium | High | downstream registry + contract tests before cutover |
| Big-bang temptation on a 4,500-file monolith | Medium | Severe | strangler-fig by deployable; O2C allocation first |
| Metadata (AD_*) behaviour overlooked (logic lives in data) | Medium | Medium | include AD dictionary diff in each journey's scope |

## 12. Method & provenance

This analysis was produced by Devin combining **DeepWiki** structural Q&A (Architecture, Persistence,
Accounting Engine, Document Management, System Administration pages) with **direct source tracing** in
the fork. Every quantitative claim is reproducible from the commands recorded alongside each table;
every class/path citation resolves in `COG-GTM/idempiere`. The interactive journey map
(`modernization/journey-map/`, deployed to GitHub Pages) is the visual companion to Sections 5–9.
