# Legacy Oracle/COTS ERP Modernization — Journey-Led Migration Plan

> Stand-in system: **iDempiere** (Compiere lineage, Oracle-native since 1999). This plan is the
> artifact Devin produces after breaking the monorepo down with DeepWiki and rediscovering the
> business **user journeys** from the code. Every claim links to source in the fork
> `COG-GTM/idempiere`.
>
> Interactive version of the map below: **https://cog-gtm.github.io/idempiere/**

## 1. Approach — migrate by *journey*, not by module
The client reasons about the system as **user journeys** (end-to-end business document flows). We
classify each journey as **Carry-Forward** (lift & shift with schema conversion), **Refactor**
(modernize in place using the existing `Convert_PostgreSQL` layer), or **Rewrite** (strangler-fig
replacement) based on four drivers: Oracle coupling, code complexity, data volume, downstream blast
radius.

## 2. Journey carry-forward / rewrite matrix
| Journey | Disposition | Oracle coupling | Complexity | Data volume | Blast radius |
|---|---|---|---|---|---|
| Order-to-Cash | **Rewrite** | High | High | Highest | High (4 consumers) |
| Procure-to-Pay | **Refactor** | Medium | Medium-High | High | Medium |
| Record-to-Report | **Carry-Forward** | Low-Medium | Medium | Medium | Medium |
| Inventory / Material Movement | **Carry-Forward** | Low | Medium | High | Low-Medium |
| Manufacturing / Production | **Refactor** | Medium | Medium-High | Medium | Low |

### Evidence (sized from real source)
| Class | Lines | Path |
|---|---|---|
| `MOrder` | 3287 | `org.adempiere.base/src/org/compiere/model/MOrder.java` |
| `MInOut` | 3644 | `org.adempiere.base/src/org/compiere/model/MInOut.java` |
| `MInvoice` | 3662 | `org.adempiere.base/src/org/compiere/model/MInvoice.java` |
| `MPayment` | 3388 | `org.adempiere.base/src/org/compiere/model/MPayment.java` |

## 3. Oracle-coupling inventory (the migration risk)
- **`DECODE`** — translated in `org.compiere.db.postgresql.provider/src/org/compiere/dbPort/Convert_PostgreSQL.java` (~L248-265); appears in posting/allocation SQL.
- **`(+)` outer joins** — handled via `org.adempiere.base/src/org/compiere/dbPort/Convert_SQL92.java` + `Join.java`.
- **Oracle types/functions** — `NUMBER`/`VARCHAR2`/`NVARCHAR2`/`CLOB`/`BLOB`, `SYSDATE`, `NVL`, `TO_DATE`.
- **Native sequences**, and split DDL/DML under `migration/` (`*` vs `*z` Oracle/PostgreSQL variants).
- The existing **`Convert_PostgreSQL`** layer is the seam we exploit for Refactor/Carry-Forward journeys.

## 4. Target state
- **DB**: Oracle → PostgreSQL via the existing conversion layer (Refactor/Carry-Forward) and explicit
  rewrites of the SQL the converter cannot safely translate (Rewrite journeys — see bug `L8N2-27`).
- **Architecture**: strangler-fig around the Rewrite journeys (Order-to-Cash first); the monolith keeps
  serving everything else until each journey is peeled off.

## 5. Phased roadmap
1. **Phase 0 — Foundation**: stand up Postgres target, CI/SonarCloud baseline, parity-test harness, data profiling.
2. **Phase 1 — Carry-Forward**: Record-to-Report, Inventory (schema conversion + parity).
3. **Phase 2 — Refactor**: Procure-to-Pay, Manufacturing (via `Convert_PostgreSQL`, fix matching SQL).
4. **Phase 3 — Rewrite**: Order-to-Cash behind a strangler facade (pricing/allocation), cut over by document type.
5. **Phase 4 — Decommission**: retire Oracle journey-by-journey once parity holds.

## 5a. Execution-ready backlog (Jira L8N2)
The plan above is decomposed into an execution-ready backlog under Epic **L8N2-39**
("Oracle/COTS Modernization — journey-led migration"). One story per journey slice, each carrying
acceptance criteria, source links, a golden-dataset parity-test requirement, a downstream-impact
note, and a `disposition-*` label.

| Story | Journey | Disposition |
|---|---|---|
| `L8N2-41` | Order-to-Cash — allocation posting (DECODE/`(+)` → Postgres) | Rewrite |
| `L8N2-42` | Procure-to-Pay — PO matching via `Convert_PostgreSQL` | Refactor |
| `L8N2-43` | Manufacturing/Production posting via `Convert_PostgreSQL` | Refactor |
| `L8N2-44` | Record-to-Report posting engine — schema conversion | Carry-Forward |
| `L8N2-45` | Inventory / Material Movement — schema conversion | Carry-Forward |

Backlog ordering follows the phased roadmap: Rewrite/Refactor slices are scoped first, Carry-Forward
slices follow. No story is assigned until a human picks up the first slice.

## 6. Risk register (top)
| Risk | Journey | Mitigation |
|---|---|---|
| `DECODE`/`(+)` mistranslation drifts AR allocation | O2C | Explicit rewrite + parity test (bug `L8N2-27`) |
| High-volume cutover downtime | O2C, Inventory | Dual-write + backfill behind strangler |
| Downstream consumers break | O2C | Contract tests per consumer (registry) |

## 7. Test / parity strategy
Per journey: golden-dataset parity (document totals, GL `Fact_Acct` lines, allocation balances) Oracle vs
Postgres; contract tests for each downstream consumer; SonarCloud quality gate on every PR.

---
*Generated by Devin. The per-journey assessments, enrichment (CI + data profile + downstream registry),
and this matrix are reproducible via the "Legacy migration — plan & start" playbook.*
