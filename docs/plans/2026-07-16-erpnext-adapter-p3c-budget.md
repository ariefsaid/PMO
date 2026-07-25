# Plan: ERPNext adapter — PMO budget push + PMO projection (Issue P3c, ADR-0055 §6, ADR-0059 Posture B)

> **⚑ BUILD STATUS: COMPLETE — shipped in PR #360** (branch `feat/erpnext-adapter-p3`, head `fabde7c5`),
> including the owner's OQ-BUD-3 ruling (fail closed on multi-FY; the phasing dimension is its own next
> issue) and OQ-BUD-3b (the fiscal year comes from ERPNext's own `Fiscal Year` doctype, never a
> synthesized calendar year). ⚑ This header read "NOT STARTED" long after the slices were built —
> verify against the filesystem and git, never a checkbox. Original context below.
>
> **(historical)** **NOT STARTED — BLOCKED on sign-off.** **REWRITTEN 2026-07-16** — the owner ruling
> **reversed the direction**; the prior inbound-mirror plan is **withdrawn in full**. Do not start slice 1
> until: (a) the **budget-write spike** freezes OQ-BUD-1 (its output lands at
> `docs/spikes/2026-07-16-erpnext-budget-fields.md`); (b) the owner rules **OQ-BUD-2** (the activation state
> stamp) and **OQ-BUD-3** (multi-fiscal-year). Slice 0 tasks 0.1–0.2 may proceed before (b).
>
> **Spec:** `docs/specs/erpnext-adapter-p3c-budget.spec.md` (**DRAFT — awaiting sign-off**;
> `FR-BUD-004..185` / `NFR-BUD-*` / `AC-BUD-001..054`).
>
> **⚑ THE RULING (binding, owner 2026-07-16) — direction: PMO → ERP.** **PMO authors the budget and pushes it
> into ERPNext. ADR-0055 §6 STANDS (no supersede.)** *"In sync" has one safe meaning — **one authority,
> one-way propagation**; two-way budget sync is an unresolvable conflict problem.* PMO is the authority
> (OD-BUDGET-1: `get_project_budget()` = Σ Active `budget_version`). ERP receives the budget for GL/audit **and
> for its native overspend controls** — **the main thing this issue buys**.
>
> **ADRs:** **ADR-0055** §§1–5 + **§6 (STANDS — the mandate:** *"Activating a version = synchronous command
> amending the ERP object"*; two of its clauses are contradicted by the ruling → spec OQ-BUD-5, a Director
> clarification, **not** a supersede). **ADR-0059** — ⚑ **the binding posture. P3c is its SECOND Posture-B
> instance** (spec §1.1 applies §2's test: **4/4 → B**). Its §§2–6 + the `neverReissue` corollary apply
> **verbatim** — **read ADR-0059 and the P3b spec/plan before writing a line; P3c must look like P3b, not
> like a fresh invention.** **ADR-0058** (the fenced outbox — verbatim, + ADR-0059 §4's deterministic-key
> delta). **ADR-0048** (no PMO recomputation of ERP figures). **ADR-0019 / ADR-0016 / ADR-0017 / ADR-0010**.
> **OD-BUDGET-1..5** (the shipped authority this issue **preserves and propagates**).
>
> **⚑ DIRECTION + POSTURE (the two things to get right):**
> 1. **P3c is a WRITE-THROUGH domain — P3a IS the structural template.** It needs the ADR-0058 fenced
>    outbox, a dispatch route, an `ErpDocKind`, authorization-before-ERP-write, cross-org pre-flight,
>    kind↔domain enforcement, and fail-closed refs. *(The prior draft's "the ledger read-model is the
>    precedent, not P3a" conclusion is **INVERTED** — it was written for the withdrawn direction.)*
> 2. **⚑ But there is NO RLS FLIP — the single most likely error in this issue.** A flip is **Posture A's**
>    mechanism (P2/P3a). **P3c is Posture B: PMO stays SoT.** So there is **NO** `domain_externally_owned`
>    row for `'budget'`, **NO** per-command RLS split, **NO** `*_native_mirror_guard`, **NO** adopt, and
>    **NO** modification to `budget_versions`/`budget_line_items`/`get_project_budget`/any KPI. **If you find
>    yourself writing a flip migration, stop — you are building P3a again.** External-side state lives in a
>    **separate side table** (`budget_version_erp_mirror`), per ADR-0059 §1's table.
>
> **⚑ "Projection" is two different things — use the fixed vocabulary.** ADR-0055 §6's *"projected into the
> ERP object"* = **PUSHED**. This issue's **"the projection"** = PMO's **forward view** (`pmo_etc` →
> EAC/variance), which is **PMO-only and NEVER pushed** (FR-BUD-160, AC-BUD-054). **Say "the push" for
> PMO→ERP and "the projection" only for the forward view.** Never mix them in code, comments, or UI copy.
>
> **Surfaces this plan extends, never forks** (read each before writing its twin):
> - `pmo-portal/src/lib/adapterSeam/erpnext/doctypeRegistry.ts` — the `DOCTYPE_REGISTRY` static table
>   (+ `anchorField`/`anchorMutable`/**`neverReissue`**) — **append-only, one additive entry**.
> - `pmo-portal/src/lib/adapterSeam/erpnext/doctypeBodies.ts` + `bodies/{salesInvoice,purchaseInvoice}.ts` —
>   the `toBody`/`fromDoc` idiom + the `ErpCtx` (`refs`/`config`) injection.
> - `supabase/functions/adapter-dispatch/{index,readModelWriters,moneyOutboxDeps}.ts` — the served boundary,
>   the fenced outbox deps, `reissueOnInconclusiveAbsence`.
> - `pmo-portal/src/lib/adapterSeam/dispatch.ts` — `dispatchMoneyWrite` + `OutboxRow`.
> - `supabase/functions/erpnext-sweep/index.ts` — `reconcileOrgOutbox` + `runErpSweepCycle` (P3c adds **one**
>   backstop pass, additively).
> - **`docs/specs/erpnext-adapter-p3b-timesheets.spec.md` + `docs/plans/2026-07-16-erpnext-adapter-p3b-timesheets.md`** —
>   ⚑ **the Posture-B sibling. Its side-mirror shape, deterministic key, gate, backstop, and never-adopt
>   wiring are the idioms to copy.** Coordinate: if P3b lands `neverReissue`, **reuse it** (FR-BUD-143).
> - `supabase/migrations/0096` (outbox + `external_refs` + bindings), `0088` (`external_refs`), `0074`
>   (`stamp_org_id()`), `0101` (the machine-written read-model RLS template — for the **side mirror only**),
>   `0005` (`get_project_budget` — the **SECURITY INVOKER read-RPC** template), `0001` (`budget_category`).
>
> **No-placeholder rule (binding):** every task has an exact path, the actual code/diff, its `AC-BUD-###`,
> and an exact verify command. **TDD order: the failing-test task precedes its implementation task, always.**
> Types are consistent across tasks (`AdapterCommand`/`PmoRecord`/`ErpDocKind`/`ErpCtx`/`OutboxRow` from the
> shipped contract; P3c adds the `budget` domain + one kind, no new contract field).
>
> **⚑ Migration numbering (binding — `ls supabase/migrations | tail -1` = `0107` at write time):** this plan
> reserves **`0108`** (the three tables + RLS) and **`0109`** (the `get_budget_projection` RPC) — **but P3b is
> writing concurrently on this branch and will very likely take `0108`.** The builder **MUST** re-verify
> (`ls supabase/migrations | sort | tail -5`), bump **both** numbers to the next free pair, and update every
> reference in this plan + the pgTAP comments. Never edit a migration already shipped to `main`/`production`.
> *(If OQ-BUD-2(a) is ratified, it needs a **third** migration — see task 0.6.)*
>
> **⚑ Parallel-agent hygiene (binding):** every DB-driving command runs under `scripts/with-db-lock.sh`; the
> bench e2e also takes `scripts/with-erpnext-lock.sh`. Work in this worktree only.
>
> **⚑ Pre-push gate (binding):** before any PR, run the **whole** suite from `pmo-portal/`: `npm run verify`.
> **HOLD-NO-PR** until the Director says otherwise (the P3 branch policy). Then **Luna `--thinking max`**
> (the standing money/security review rule for this program).

---

## 0. Job story (from spec §0)

> When a client employs ERPNext, the budget the PMO team approved in PMO must become the budget ERPNext
> enforces — automatically, the moment it is activated — so ERP's native overspend controls stop a purchase
> order against a budget the team never approved, and the GL reports against the figure the team actually
> agreed; while PMO remains the single authority for what the budget *is*, and every client who does NOT
> employ ERPNext stays byte-for-byte the pre-P3c system.

---

## 1. Architecture overview

```
 PMO IS SoT (unflipped, untouched — ADR-0059 Posture B):
   budget_versions / budget_line_items / activate_budget_version / get_project_budget   ← ZERO changes
        │                                                                                 (OQ-BUD-2's
        │  user activates a version (the shipped RPC — its own authority, its own tx)      activated_at is
        ▼                                                                                  the ONE escalated
   ✅ ACTIVATION ALWAYS SUCCEEDS (ADR-0059 §3.2 — never depends on ERP liveness)           candidate)
        │
        │  the push is a CONSEQUENCE, after the tx commits, outside it (ADR-0059 §3.1)
        ▼
 ORIGINATOR 1 — the foreground consequence path        ORIGINATOR 2 — the sweep backstop
   repositories.budgetPush.push(versionId)               erpnext-sweep pass (5) reconcileOrgBudgetPushes
        └──────────────────────┬──────────────────────────────────┘
                               ▼   both derive the SAME deterministic key (ADR-0059 §4):
                                    'bud:' || budget_version_id || ':' || <state_stamp>   ← OQ-BUD-2
                               ▼
                    POST functions/v1/adapter-dispatch   [served boundary — P3a's, reused]
                               ▼
      ⚑ GATE (before adapter selection, before the outbox, before ANY ERP call):
         (1) re-READ budget_versions.status FROM THE DB under the CALLER'S JWT  → must be 'Active'
             (the payload is NEVER trusted — ADR-0059 §3.3)                        FR-BUD-100 / AC-BUD-020
         (2) OD-BUDGET-3 role on the REAL JWT                                      FR-BUD-101
         (3) cross-org pre-flight (version, project, refs)                         FR-BUD-014
         (4) kind↔domain: 'budget' ↔ 'budget'                                      FR-BUD-013
         (5) ⚑ resolve the category→account map — UNMAPPED ⇒ FAIL CLOSED, no ERP call
             (never a default account)                                             FR-BUD-113 / AC-BUD-011
         (6) ⚑ single-FY check — multi-FY ⇒ FAIL CLOSED, never invent a split      FR-BUD-124 / AC-BUD-033
                               ▼
                    external_command_outbox  [ADR-0058 verbatim — fenced claim + generation token]
                       unique (org_id, domain, pmo_record_id, idempotency_key)
                       ⇒ the two originators collide safely (23505 → reconcile)    AC-BUD-021
                               ▼
                    budgetToBody(activeVersion, ctx)  → ERP `Budget`
                       { company, fiscal_year, budget_against:'Project', project,
                         accounts:[{account, budget_amount}],           ← the MAP's output, decimal-strings
                         action_if_annual_budget_exceeded: 'Warn',      ← the POINT (default Warn, never Stop)
                         applicable_on_* }                              ← spike-frozen (OQ-BUD-1 #8)
                       ⚑ NEVER carries pmo_etc / EAC / variance         FR-BUD-160 / AC-BUD-054
                               ▼
                    ⚑ UPSERT the ONE ERP Budget per (company, FY, project)         FR-BUD-121 / AC-BUD-031
                       first activation → create; every later one → update (or cancel+amend
                       per the spike, OQ-BUD-1 #4) via external_refs('budget')
                       anchor: expected NULL ⇒ neverReissue:true ⇒ HELD, never reissued  FR-BUD-143
                               ▼
                    budget_version_erp_mirror  ← ADR-0059 §6 side mirror (external-side state ONLY)
                       push_state pending|pushing|pushed|failed|held  + push_error
                       + unmapped_categories[] + activated_at_witness (server-resolved, never a payload)
                       index (org_id, push_state) — the operator surface AND the sweep's work queue

 INBOUND (lifecycle-only — ADR-0059 §5):
   erpnext-webhook / sweep → a Desk-created Budget (no external_refs) ⇒ ⚑ ACK-AND-SKIP + action-required
                              — NEVER adopt into budget_versions                   FR-BUD-140 / AC-BUD-040
                           → an external CANCEL of a pushed Budget ⇒ tombstone + failed + action-required,
                              ⚑ NEVER auto-re-push (never fight the operator); PMO version stays Active
                                                                                    FR-BUD-142 / AC-BUD-041

 THE PROJECTION (PMO-only, never pushed — all Supabase, no ERP call from the browser):
   get_budget_projection(project, fy)  [SECURITY INVOKER, mig 0109]
      per CATEGORY (PMO's grain):
        pmo_budget_amount ← budget_line_items of the ACTIVE version   (PMO SoT — not an ERP read-back)
        actuals_to_date   ← erp_actuals_snapshot.net for the MAPPED account  (P2's shipped GL truth)
                             ⚑ needs the map's INVERSE ⇒ the map must be a BIJECTION   FR-BUD-111
        pmo_etc           ← budget_projections                        (PMO-owned, authored)
        EAC = actuals + etc · variance = pmo_budget − EAC · utilization = EAC / NULLIF(pmo_budget,0)
```

**Reversibility (ADR-0059 §3.7):** `drop table budget_version_erp_mirror` + `budget_category_account_map` +
`budget_projections` ⇒ **zero PMO data loss**; the budget module is untouched and fully functional.

---

## 2. Key design decisions (binding — carry these into every task)

1. **⚑ Posture B: NO flip, PMO stays SoT (FR-BUD-006).** No `domain_externally_owned('budget')`; no policy on
   `budget_versions`/`budget_line_items` mentions it; no `*_native_mirror_guard`; `get_project_budget()` is
   **the** authority for every KPI in **both** employing and non-employing orgs. Task 7.1's pgTAP makes this
   structural. **This is the owner's one-authority ruling — do not "improve" it into a flip.**
2. **⚑ The PMO transition is untouched (ADR-0059 §3.1/§8).** Do not modify `activate_budget_version`'s
   authorization, semantics, or state map. The push is a consequence **after** the tx, **outside** it. *(A DB
   function cannot call an edge function — "push from inside the RPC" is impossible and wrong.)* **The one
   escalated candidate is OQ-BUD-2(a)'s `activated_at`** (task 0.6, gated on an owner ruling).
3. **⚑ Activation never fails on ERP (ADR-0059 §3.2 / FR-BUD-008 / AC-BUD-032).** No push failure of any
   class blocks, rolls back, or retry-loops activation. The user's action **always** succeeds; the failure
   becomes durable state + an operator surface.
4. **⚑ The gate re-reads the DB; the payload is never trusted (ADR-0059 §3.3 / AC-BUD-020).** The dispatch
   re-reads `budget_versions.status` under the **caller's JWT** before adapter selection / the outbox / any
   ERP call. **There must be no null/absent branch that falls through to permission.** *(The Luna P3a audit
   found exactly this hole. The sweep takes the **same** route and re-asserts the **same** gate — never
   "trusts itself", never finalizes with a NULL actor.)*
5. **⚑ The deterministic key (ADR-0059 §4).** `'bud:' || budget_version_id || ':' || <state_stamp>`. Two
   legitimate originators with **no shared client state** ⇒ a random per-attempt key would make the outbox's
   unique constraint **useless for the exact collision it exists to prevent**. **The stamp is OQ-BUD-2 —
   blocked; do not pick one unilaterally.**
6. **⚑ Anchor-less ⇒ `neverReissue` (ADR-0059 §4 corollary / FR-BUD-143).** `Budget` is expected to have no
   anchor field (spike #5). Today `anchorField: null` ⇒ skip probe ⇒ **reissue-capable** ⇒ a silently
   duplicated ERP Budget. So: `neverReissue: true` ⇒ `reissueOnInconclusiveAbsence = !(anchorMutable ||
   neverReissue)` ⇒ **held**. **The flag is additive + default-absent — P3b introduces it; REUSE it, do not
   re-invent it.** Every shipped kind must stay byte-for-byte.
7. **⚑ THE CRUX — the map is a BIJECTION (FR-BUD-111).** `unique (org_id, category)` makes the **push**
   well-defined; **`unique (org_id, erp_account)` makes the PROJECTION well-defined** (it needs the inverse
   to attribute account-grained actuals back to a category — without it PMO would **invent a split**, an
   ADR-0048 violation). Both uniques are load-bearing; neither is decoration.
8. **⚑ Unmapped category ⇒ FAIL CLOSED, categories NAMED, no ERP call (FR-BUD-113 / AC-BUD-011).** Never a
   default/fallback/suspense account; never a silently dropped line. A silently-defaulted budget line makes
   ERP enforce overspend controls against the **wrong account** — the feature actively misleading the client.
9. **⚑ Never adopt (ADR-0059 §5) and never fight the operator (§5 corollary).** A Desk-created Budget is
   ack-and-skipped, never adopted. An external cancel is **never** auto-re-pushed and the PMO version stays
   `Active`. *(The exact **inverse** of P3a's FR-SAR-085 — do not pattern-match.)*
10. **⚑ One ERP Budget per (company, FY, project) — UPSERT, never duplicate (FR-BUD-121).** Re-activation and
    revision **update the same object** via `external_refs('budget')`. The **mechanism** (PUT vs cancel+amend)
    is spike-frozen (OQ-BUD-1 #4) — **do not design past the spike**.
11. **Default `Warn`, never `Stop` (FR-BUD-131).** `Stop` makes ERP **block** a client's POs org-wide. That
    blast radius is a deliberate, Admin, audited opt-in — never an integration side effect.
12. **The projection is PMO-only and never pushed (FR-BUD-160).** `budgetToBody` emits **only**
    `budgeted_amount` per mapped category. Owned by a structural test (task 7.2).
13. **Money is decimal-string on the wire, `numeric(14,2)` at rest, SQL `numeric` in the projection.** No JS
    float math on any money value.
14. **Confinement (NFR-BUD-CONTRACT-001).** `Budget`/`budget_against`/`budget_amount`/`fiscal_year`/
    `action_if_annual_budget_exceeded` live **only** under `adapterSeam/erpnext/**` + the ERPNext edge fns.
    **`budget_category` is a PMO word and never crosses into ERP** — the map is the boundary.

---

## 3. Slice list

| Slice | Content | Independently testable? |
|---|---|---|
| **0** | Spike gate (**blocker**) + schema (mig 0108: side mirror + map + projections) + pgTAP + the OQ-BUD-2 migration (**gated**) | yes — `supabase test db` |
| **1** | ⚑ The map: repository + resolution + **fail-closed unmapped** + the Admin gate | yes — Vitest + pgTAP |
| **2** | The registry entry + `bodies/budget.ts` (spike-gated) | yes — Vitest |
| **3** | The dispatch route + ⚑ the server-side gate + the deterministic key + the side mirror | yes — Vitest |
| **4** | The activation-consequence push path (originator 1) + the repository seam | yes — Vitest |
| **5** | The sweep backstop (originator 2) + inbound never-adopt + never-fight-the-operator | yes — Vitest |
| **6** | The projection: formula + RPC (mig 0109) + the read surface + the Admin map surface | yes — Vitest + pgTAP + e2e |
| **7** | ⚑ The invariant proofs: no-flip, never-pushed, byte-for-byte + the bench e2e | yes — pgTAP + Vitest + e2e |

---

## 4. Traceability (ADR-0010 — each AC owned by exactly ONE layer)

| AC | Owning layer | Owning test file | Slice |
|---|---|---|---|
| **AC-BUD-001** | Vitest | `pmo-portal/src/lib/adapterSeam/erpnext/budgetNonEmploying.test.ts` | 7 |
| **AC-BUD-002** | *(meta — the unchanged P2/P3a/P3b + shipped-budget suites ARE the proof)* | `npm run verify` + `supabase test db` + `e2e/serial/` | 7 |
| **AC-BUD-003** | pgTAP | `supabase/tests/budget_no_flip_invariant.test.sql` | 7 |
| **AC-BUD-010** | pgTAP | `supabase/tests/budget_category_account_map_rls.test.sql` | 0 |
| **AC-BUD-011** | Vitest | `pmo-portal/src/lib/budget/categoryAccountMap.test.ts` | 1 |
| **AC-BUD-012** | Vitest | `pmo-portal/src/lib/adapterSeam/erpnext/bodies/budget.test.ts` | 2 |
| **AC-BUD-020** | Vitest | `supabase/functions/adapter-dispatch/budgetGate.test.ts` | 3 |
| **AC-BUD-021** | Vitest | `supabase/functions/adapter-dispatch/budgetGate.test.ts` | 3 |
| **AC-BUD-022** | Vitest | `pmo-portal/src/lib/adapterSeam/erpnext/doctypeRegistry.test.ts` (extends the shipped file) | 2 |
| **AC-BUD-023** | Vitest | `supabase/functions/erpnext-sweep/budgetBackstop.test.ts` | 5 |
| **AC-BUD-030** | e2e (served fn + live bench) | `pmo-portal/e2e/serial/AC-BUD-030-budget-push.spec.ts` | 7 |
| **AC-BUD-031** | e2e (served fn + live bench) | `pmo-portal/e2e/serial/AC-BUD-031-budget-reactivation-upsert.spec.ts` | 7 |
| **AC-BUD-032** | Vitest | `pmo-portal/src/lib/budget/budgetPushConsequence.test.ts` | 4 |
| **AC-BUD-033** | Vitest | `supabase/functions/adapter-dispatch/budgetGate.test.ts` | 3 |
| **AC-BUD-040** | Vitest | `supabase/functions/erpnext-sweep/budgetBackstop.test.ts` | 5 |
| **AC-BUD-041** | Vitest | `supabase/functions/erpnext-sweep/budgetBackstop.test.ts` | 5 |
| **AC-BUD-050** | Vitest | `pmo-portal/src/lib/budget/budgetProjection.test.ts` | 6 |
| **AC-BUD-051** | Vitest | `pmo-portal/src/lib/budget/budgetProjection.test.ts` | 6 |
| **AC-BUD-052** | pgTAP | `supabase/tests/budget_projections_rls.test.sql` | 0 |
| **AC-BUD-053** | pgTAP | `supabase/tests/budget_projection_rpc.test.sql` | 6 |
| **AC-BUD-054** | Vitest (structural) | `pmo-portal/src/lib/adapterSeam/erpnext/budgetNeverPushesProjection.test.ts` | 7 |

**AC-id tagging (binding):** Vitest → the `AC-BUD-###` leads the `it(...)` title; pgTAP → leads the test
description; Playwright → leads the `test(...)` title, file `AC-BUD-###-<slug>.spec.ts`. So
`grep -r AC-BUD-011` finds exactly one canonical proof.

---

## Slice 0 — the spike gate + the schema

### Task 0.1 — Consume + verify the budget-write spike (**BLOCKS slices 1–2**)
**File (read, do not author):** `docs/spikes/2026-07-16-erpnext-budget-fields.md` (a write spike is running).
**Gate — the spike MUST answer these before slice 2 starts** (spec §3 OQ-BUD-1):
1. the minimal mandatory insert body; 2. is `Budget` submittable; 3. does ERP reject a second Budget per
(company, FY, project) + the exact error; **4. ⚑ is `budget_amount` updatable on a submitted Budget, or is
revision cancel+amend?**; **5. ⚑ is there ANY anchor field surviving `validate` (expected NO ⇒
`neverReissue`)?**; 6. the real bench Account values; 7. project-dimension viability; **8. ⚑ the
`action_if_annual_budget_exceeded` literals + `applicable_on_*` flags + observed overspend behavior**;
9. is one Budget per FY genuinely required (→ OQ-BUD-3).
**Verify:**
```bash
cd /Users/ariefsaid/Coding/PMO/.claude/worktrees/erpnext-adapter-p3 && \
  for q in 'minimal.*body' 'submittable' 'uniqueness|already exists' 'update.*submit|allow_on_submit' \
           'anchor' 'account' 'project.*dimension' 'action_if_annual_budget_exceeded' 'fiscal.*year'; do
    grep -qiE "$q" docs/spikes/2026-07-16-erpnext-budget-fields.md || echo "SPIKE GAP: $q";
  done; echo SPIKE-GATE-CHECKED
```
Any `SPIKE GAP` line ⇒ **do not start slice 2**; report back to the Director.
**AC:** none (the prerequisite that makes AC-BUD-012/022/031 writable against reality).

### Task 0.2 — Re-verify the migration numbers (P3b is writing concurrently)
**Verify:**
```bash
cd /Users/ariefsaid/Coding/PMO/.claude/worktrees/erpnext-adapter-p3 && ls supabase/migrations | sort | tail -5
```
Bump `0108`/`0109` to the next free pair; update every reference in this plan + the pgTAP comments.
**AC:** none (hygiene).

### Task 0.3 — RED: the map pgTAP proof (the Admin gate + ⚑ the bijection)
**File (new):** `supabase/tests/budget_category_account_map_rls.test.sql`
Reuse the shipped role/org fixture helpers verbatim (read `erpnext_sales_invoices_flip_rls.test.sql` first —
do **not** invent a second fixture idiom).
```sql
-- AC-BUD-010 budget_category_account_map: org-isolated, ADMIN-only, and a BIJECTION (FR-BUD-110..112)
begin;
select plan(9);

select has_table('public','budget_category_account_map', 'AC-BUD-010 the map table exists');
select col_type_is('public','budget_category_account_map','category','budget_category',
                   'AC-BUD-010 category is the shipped ENUM, not text (OD-BUDGET-4)');
-- ⚑ BOTH uniques: (org,category) makes the PUSH well-defined; (org,erp_account) makes the PROJECTION's
--   inverse well-defined (FR-BUD-111) — without it, actuals could not be attributed back to a category
--   without PMO inventing a split (ADR-0048).
select col_is_unique('public','budget_category_account_map', array['org_id','category'],
                     'AC-BUD-010 unique(org,category) — one account per category (the push)');
select col_is_unique('public','budget_category_account_map', array['org_id','erp_account'],
                     'AC-BUD-010 unique(org,erp_account) — one category per account (the projection inverse)');

-- Admin writes in its own org
select tests.authenticate_as('admin_org_a');
select lives_ok(
  $$insert into public.budget_category_account_map (category, erp_account) values ('Labor','5100 - Direct Costs')$$,
  'AC-BUD-010 Admin may author a map row');

-- ⚑ Finance is DENIED — the map is Admin-only, deliberately STRICTER than OD-BUDGET-3
select tests.authenticate_as('finance_org_a');
select throws_ok(
  $$insert into public.budget_category_account_map (category, erp_account) values ('Materials','5200 - Materials')$$,
  '42501', null, 'AC-BUD-010 Finance map write denied 42501 (Admin-only, FR-BUD-112)');

-- the bijection is enforced in BOTH directions
select tests.authenticate_as('admin_org_a');
select throws_ok(
  $$insert into public.budget_category_account_map (category, erp_account) values ('Labor','5900 - Other')$$,
  '23505', null, 'AC-BUD-010 a second account for a mapped CATEGORY is rejected');
select throws_ok(
  $$insert into public.budget_category_account_map (category, erp_account) values ('Overheads','5100 - Direct Costs')$$,
  '23505', null, 'AC-BUD-010 a second category for a mapped ACCOUNT is rejected (the inverse)');

-- org B cannot read org A's map
select tests.authenticate_as('admin_org_b');
select is((select count(*)::int from public.budget_category_account_map), 0,
          'AC-BUD-010 org B cannot read org A map rows');

select * from finish();
rollback;
```
**Verify (RED):**
```bash
cd /Users/ariefsaid/Coding/PMO/.claude/worktrees/erpnext-adapter-p3 && scripts/with-db-lock.sh supabase test db 2>&1 | grep -E 'budget_category_account_map|not ok'
```
**AC:** AC-BUD-010

### Task 0.4 — RED: the `budget_projections` pgTAP proof
**File (new):** `supabase/tests/budget_projections_rls.test.sql`
```sql
-- AC-BUD-052 budget_projections: org-isolated + OD-BUDGET-3 role-gated (the PMO-owned enhancement)
begin;
select plan(7);

select has_table('public','budget_projections', 'AC-BUD-052 budget_projections exists');
select col_type_is('public','budget_projections','category','budget_category',
                   'AC-BUD-052 the projection is at PMO grain (category), not ERP account grain');
select col_is_unique('public','budget_projections', array['org_id','project_id','fiscal_year','category'],
                     'AC-BUD-052 one ETC per (org, project, fy, category) — the upsert target');

select tests.authenticate_as('finance_org_a');
select lives_ok(
  $$insert into public.budget_projections (project_id, fiscal_year, category, pmo_etc)
    values (tests.project_id_org_a(), '2026', 'Labor', 35000.00)$$,
  'AC-BUD-052 Finance (OD-BUDGET-3) may author an ETC');

select tests.authenticate_as('engineer_org_a');
select throws_ok(
  $$insert into public.budget_projections (project_id, fiscal_year, category, pmo_etc)
    values (tests.project_id_org_a(), '2026', 'Materials', 100.00)$$,
  '42501', null, 'AC-BUD-052 Engineer ETC write denied 42501 (OD-BUDGET-3 gate)');

select tests.authenticate_as('finance_org_b');
select throws_ok(
  $$insert into public.budget_projections (project_id, fiscal_year, category, pmo_etc)
    values (tests.project_id_org_a(), '2026', 'Labor', 1.00)$$,
  '42501', null, 'AC-BUD-052 cross-org ETC write denied 42501');
select is((select count(*)::int from public.budget_projections), 0,
          'AC-BUD-052 org B cannot read org A ETC rows');

select * from finish();
rollback;
```
**Verify (RED):** as task 0.3, grepping `budget_projections`.
**AC:** AC-BUD-052

### Task 0.5 — GREEN: migration 0108 — the three tables + RLS (⚑ NO flip)
**File (new):** `supabase/migrations/0108_budget_push_seam.sql`
```sql
-- 0108_budget_push_seam.sql — ERPNext P3c (spec §4; ADR-0055 §6 + ADR-0059 Posture B).
-- ⚑ POSTURE B — PMO IS SoT. There is deliberately NO RLS FLIP here: no domain_externally_owned('budget'),
-- no per-command RLS split, no *_native_mirror_guard, and NOT ONE existing table/RPC/policy is altered.
-- budget_versions / budget_line_items / activate_budget_version / get_project_budget remain THE authority
-- (OD-BUDGET-1) for every KPI in employing AND non-employing orgs (FR-BUD-006, proven by
-- supabase/tests/budget_no_flip_invariant.test.sql / AC-BUD-003). If a future edit adds a flip here, it has
-- misread the owner's one-authority ruling.
--
-- Three additive tables:
--   §1 budget_version_erp_mirror   — ADR-0059 §6 side mirror: EXTERNAL-SIDE STATE ONLY (machine-written,
--                                    the 0101 template). Reversible by `drop table` with ZERO PMO data loss.
--   §2 budget_category_account_map — ⚑ THE CRUX (FR-BUD-110..113): org-scoped, ADMIN-only, and a BIJECTION.
--   §3 budget_projections          — the PMO-owned forward view (`pmo_etc`); NEVER pushed (FR-BUD-160).
--
-- pgTAP: budget_erp_mirror_rls / budget_category_account_map_rls / budget_projections_rls /
--        budget_no_flip_invariant.
--
-- Reversibility (ADR-0006): `supabase db reset`. Manual rollback (reverse order):
--   drop trigger if exists budget_projections_stamp_org_id on public.budget_projections;
--   drop trigger if exists budget_category_account_map_stamp_org_id on public.budget_category_account_map;
--   drop trigger if exists budget_version_erp_mirror_stamp_org_id on public.budget_version_erp_mirror;
--   drop table if exists public.budget_projections;
--   drop table if exists public.budget_category_account_map;
--   drop table if exists public.budget_version_erp_mirror;
-- ⇒ PMO's budget module is untouched and fully functional (NFR-BUD-REV-001, ADR-0059 §3.7).

-- ============================================================================
-- §1 — budget_version_erp_mirror (ADR-0059 §6). Grain (budget_version_id × fiscal_year); fiscal_year is in
-- the key for forward-compat with OQ-BUD-3(c) multi-FY at zero cost today. `push_state` is BOTH the
-- operator surface AND the sweep's work queue ⇒ index (org_id, push_state), bounded per tick.
-- `activated_at_witness` is SERVER-RESOLVED from DB truth — never written from a payload (ADR-0059 §6).
-- ============================================================================
create table public.budget_version_erp_mirror (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null default coalesce(public.auth_org_id(),'00000000-0000-0000-0000-000000000001')
                        references public.organizations(id) on delete cascade,
  budget_version_id   uuid not null references public.budget_versions(id) on delete cascade,
  fiscal_year         text not null,
  push_state          text not null default 'pending'
                        check (push_state in ('pending','pushing','pushed','failed','held')),
  push_error          text,
  unmapped_categories text[],                        -- FR-BUD-113: NAME the blocking categories (actionable, not just red)
  activated_at_witness timestamptz,                  -- server-resolved witness of the state stamp (OQ-BUD-2)
  erp_budget_name     text,                          -- ERP Budget `name` (display + the UPSERT target)
  erp_docstatus       smallint,
  erp_modified        text,
  erp_cancelled_at    timestamptz,
  pushed_at           timestamptz,
  created_at          timestamptz not null default now(),
  unique (org_id, budget_version_id, fiscal_year)
);
create index budget_version_erp_mirror_queue_idx on public.budget_version_erp_mirror (org_id, push_state);

-- ============================================================================
-- §2 — budget_category_account_map — ⚑ THE CRUX. `category` is the SHIPPED ENUM (a table, not jsonb, is
-- exactly why: an enum-typed key + DB-enforced uniqueness + RLS + pgTAP integrity — OQ-BUD-4(a)).
-- ⚑ BOTH uniques are load-bearing (FR-BUD-111): (org,category) makes the PUSH well-defined; (org,erp_account)
-- makes the PROJECTION's inverse well-defined — without it, account-grained actuals could not be attributed
-- back to a category without PMO inventing a split (ADR-0048). The map is a BIJECTION.
-- ============================================================================
create table public.budget_category_account_map (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null default coalesce(public.auth_org_id(),'00000000-0000-0000-0000-000000000001')
                references public.organizations(id) on delete cascade,
  category    public.budget_category not null,
  erp_account text not null,
  updated_by  uuid references public.profiles(id),
  updated_at  timestamptz not null default now(),
  unique (org_id, category),
  unique (org_id, erp_account)
);

-- ============================================================================
-- §3 — budget_projections — the PMO-owned forward view. Grain = PMO's (category), NOT ERP's (account):
-- PMO is SoT, so the projection speaks PMO's vocabulary. `pmo_etc` is NEVER pushed (FR-BUD-160).
-- ============================================================================
create table public.budget_projections (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null default coalesce(public.auth_org_id(),'00000000-0000-0000-0000-000000000001')
                references public.organizations(id) on delete cascade,
  project_id  uuid not null references public.projects(id) on delete cascade,
  fiscal_year text not null,
  category    public.budget_category not null,
  pmo_etc     numeric(14,2) not null default 0,
  note        text,
  updated_by  uuid references public.profiles(id),
  updated_at  timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  unique (org_id, project_id, fiscal_year, category)
);
create index budget_projections_scope_idx on public.budget_projections (org_id, project_id, fiscal_year);

-- ============================================================================
-- §4 — RLS. Side mirror: machine-only (the 0101 idiom — force RLS + a SELECT-only policy + NO non-SELECT
-- policy ⇒ every user-JWT write is 42501). Map: ADMIN-only (FR-BUD-112 — stricter than OD-BUDGET-3).
-- Projections: OD-BUDGET-3, reused verbatim from budget_versions_write. NONE of these is flip-gated.
-- ============================================================================
alter table public.budget_version_erp_mirror enable row level security;
alter table public.budget_version_erp_mirror force  row level security;
create policy budget_version_erp_mirror_select on public.budget_version_erp_mirror
  for select using (org_id = public.auth_org_id() and public.is_active_member());
grant select on public.budget_version_erp_mirror to authenticated, anon;

alter table public.budget_category_account_map enable row level security;
alter table public.budget_category_account_map force  row level security;
create policy budget_category_account_map_select on public.budget_category_account_map
  for select using (org_id = public.auth_org_id() and public.is_active_member());
create policy budget_category_account_map_write on public.budget_category_account_map
  for all
  using      (org_id = public.auth_org_id() and public.is_active_member() and public.auth_role() = 'Admin')
  with check (org_id = public.auth_org_id() and public.is_active_member() and public.auth_role() = 'Admin');
grant select, insert, update, delete on public.budget_category_account_map to authenticated;
revoke all on public.budget_category_account_map from anon;

alter table public.budget_projections enable row level security;
alter table public.budget_projections force  row level security;
create policy budget_projections_select on public.budget_projections
  for select using (org_id = public.auth_org_id() and public.is_active_member());
create policy budget_projections_write on public.budget_projections
  for all
  using      (org_id = public.auth_org_id() and public.is_active_member()
              and public.auth_role() in ('Admin','Executive','Project Manager','Finance'))
  with check (org_id = public.auth_org_id() and public.is_active_member()
              and public.auth_role() in ('Admin','Executive','Project Manager','Finance')
              and exists (select 1 from public.projects p
                          where p.id = budget_projections.project_id and p.org_id = public.auth_org_id()));
grant select, insert, update, delete on public.budget_projections to authenticated;
revoke all on public.budget_projections from anon;

-- ── stamp_org_id() triggers (0074 pattern) ────────────────────────────────────────────────────────
create trigger budget_version_erp_mirror_stamp_org_id before insert on public.budget_version_erp_mirror
  for each row execute function public.stamp_org_id();
create trigger budget_category_account_map_stamp_org_id before insert on public.budget_category_account_map
  for each row execute function public.stamp_org_id();
create trigger budget_projections_stamp_org_id before insert on public.budget_projections
  for each row execute function public.stamp_org_id();
```
> **Builder notes (read-the-code-first, do not retype from this plan):** `auth_role()`'s exact literals must
> match `budget_versions_write` in `0002_rls.sql`. The `Admin`-only idiom must match however P3a's
> `manage_external_bindings`/operator gate is actually expressed — **use the shipped predicate**, not a
> hand-rolled `auth_role() = 'Admin'`, if one exists. Check whether `0074_org_id_stamp_trigger.sql`'s table
> list must gain the three tables or whether per-table attachment (as written) is the shipped idiom (follow
> what `0101` did).
**Verify (GREEN):**
```bash
cd /Users/ariefsaid/Coding/PMO/.claude/worktrees/erpnext-adapter-p3 && scripts/with-db-lock.sh supabase db reset && \
  scripts/with-db-lock.sh supabase test db 2>&1 | grep -E 'budget_category_account_map|budget_projections'
```
**AC:** AC-BUD-010, AC-BUD-052

### Task 0.6 — ⚑ GATED: migration 010X — `budget_versions.activated_at` (OQ-BUD-2(a))
**⚑ DO NOT RUN THIS TASK without an explicit owner ruling ratifying OQ-BUD-2(a).** It modifies the
transition's schema **and** RPC, which **ADR-0059 §3.1 forbids** and §8 says is "its own issue with its own
spec and its own owner ruling". It is here **only** so the ratified path is unambiguous.
**Files (edit — a NEW migration; never edit `0005`):** `supabase/migrations/010X_budget_version_activated_at.sql`
```sql
-- 010X_budget_version_activated_at.sql — the ADR-0059 §4 deterministic-key state stamp (spec OQ-BUD-2(a)).
-- ⚑ Applied ONLY under an explicit owner ratification of OQ-BUD-2(a) (an explicitly-scoped exception to
-- ADR-0059 §3.1). It is a WITNESS, not a rule: additive + nullable, adds NO gate, changes NO state-machine
-- semantics, alters NO existing row, and is read by NO KPI (get_project_budget does not touch it).
-- Without it, a roll-back re-activation of an Archived version derives a key identical to that version's
-- original push ⇒ 23505 ⇒ SILENTLY SUPPRESSED ⇒ ERP keeps enforcing the newer version's figures while PMO
-- says otherwise (spec OQ-BUD-2).
-- Reversibility: alter table public.budget_versions drop column if exists activated_at;
--                (+ restore activate_budget_version's prior body from 0005).
alter table public.budget_versions add column if not exists activated_at timestamptz;

-- Re-create activate_budget_version with ONE added `set`. Every other line is LIFTED VERBATIM from
-- 0005_budget_mutation_rpc.sql — re-read that file and copy it; do not paraphrase it from this plan.
-- The ONLY delta is:  update budget_versions set status = 'Active', activated_at = now() where id = version_id;
```
**Verify:**
```bash
cd /Users/ariefsaid/Coding/PMO/.claude/worktrees/erpnext-adapter-p3 && scripts/with-db-lock.sh supabase db reset && \
  scripts/with-db-lock.sh supabase test db 2>&1 | grep -E '0008_budget_activation|0009_budget_role_gate|0011_budget_draft_guard'
# The SHIPPED budget suite MUST stay green — the stamp changes no semantics (AC-BUD-002).
```
**AC:** none directly (it unblocks AC-BUD-021/031's key).

### Task 0.7 — Regenerate the DB types
**File (edit):** `pmo-portal/src/lib/supabase/database.types.ts` — **regenerate, never hand-cast**.
```bash
cd /Users/ariefsaid/Coding/PMO/.claude/worktrees/erpnext-adapter-p3 && \
  scripts/with-db-lock.sh supabase gen types typescript --local > pmo-portal/src/lib/supabase/database.types.ts && \
  cd pmo-portal && npm run typecheck
```
**AC:** none (hygiene).

---

## Slice 1 — ⚑ the map: resolution + fail-closed

### Task 1.1 — RED: the map-resolution test (the crux)
**File (new):** `pmo-portal/src/lib/budget/categoryAccountMap.test.ts`
```ts
import { describe, it, expect } from 'vitest';
import { resolveBudgetAccounts, BudgetCategoryUnmappedError } from './categoryAccountMap';

const MAP = [
  { category: 'Labor', erp_account: '5100 - Direct Costs' },
  { category: 'Materials', erp_account: '5200 - Materials' },
  { category: 'Equipment', erp_account: '5300 - Equipment' },
];

describe('categoryAccountMap', () => {
  it('AC-BUD-011 resolves mapped non-zero categories to their accounts as decimal-strings', () => {
    const rows = resolveBudgetAccounts(
      [{ category: 'Labor', budgeted_amount: '50000.00' }, { category: 'Materials', budgeted_amount: '25000.00' }],
      MAP,
    );
    expect(rows).toEqual([
      { account: '5100 - Direct Costs', budget_amount: '50000.00' },
      { account: '5200 - Materials', budget_amount: '25000.00' },
    ]);
  });

  it('AC-BUD-011 sums multiple line items of the same category into one account row', () => {
    const rows = resolveBudgetAccounts(
      [{ category: 'Labor', budgeted_amount: '30000.00' }, { category: 'Labor', budgeted_amount: '20000.50' }],
      MAP,
    );
    expect(rows).toEqual([{ account: '5100 - Direct Costs', budget_amount: '50000.50' }]); // exact — no float drift
  });

  it('AC-BUD-011 omits a ZERO-amount category (ERP has no meaning for a zero budget line) — not an error', () => {
    const rows = resolveBudgetAccounts([{ category: 'Equipment', budgeted_amount: '0.00' }], MAP);
    expect(rows).toEqual([]);
  });

  it('AC-BUD-011 ⚑ FAILS CLOSED on an unmapped non-zero category, NAMING every one — never a default account', () => {
    let err: unknown;
    try {
      resolveBudgetAccounts([
        { category: 'Materials', budgeted_amount: '25000.00' },   // mapped
        { category: 'Contingency', budgeted_amount: '10000.00' }, // UNMAPPED
        { category: 'Overheads', budgeted_amount: '5000.00' },    // UNMAPPED
      ], MAP);
    } catch (e) { err = e; }

    expect(err).toBeInstanceOf(BudgetCategoryUnmappedError);
    expect((err as BudgetCategoryUnmappedError).code).toBe('budget-category-unmapped');
    // ⚑ NAMES them — an operator surface must be actionable, not just red
    expect((err as BudgetCategoryUnmappedError).unmappedCategories).toEqual(['Contingency', 'Overheads']);
    // ⚑ and it THROWS rather than returning a partial body — a partial push would silently under-budget ERP
  });

  it('AC-BUD-011 an unmapped ZERO-amount category is NOT an error (nothing would be pushed for it)', () => {
    expect(resolveBudgetAccounts([{ category: 'Contingency', budgeted_amount: '0.00' }], MAP)).toEqual([]);
  });
});
```
**Verify (RED):**
```bash
cd /Users/ariefsaid/Coding/PMO/.claude/worktrees/erpnext-adapter-p3/pmo-portal && npx vitest run src/lib/budget/categoryAccountMap.test.ts
```
**AC:** AC-BUD-011

### Task 1.2 — GREEN: `categoryAccountMap.ts`
**File (new):** `pmo-portal/src/lib/budget/categoryAccountMap.ts`
```ts
/**
 * budget/categoryAccountMap.ts (P3c slice 1, FR-BUD-110..114) — ⚑ THE CRUX of P3c.
 *
 * PMO budgets a `budget_category` (7 values, OD-BUDGET-4); an ERP `Budget` line is per ACCOUNT. This module
 * is the boundary. It is PMO-side and carries NO Frappe vocabulary (NFR-BUD-CONTRACT-001): it emits
 * {account, budget_amount} pairs, and `bodies/budget.ts` puts them in a Frappe body.
 *
 * ⚑ FAIL CLOSED (FR-BUD-113): an unmapped, NON-ZERO category THROWS — it never falls back to a default,
 * fallback, or suspense account, and never silently drops the line. A silently-defaulted budget line makes
 * ERP enforce overspend controls against the WRONG account, i.e. the feature actively misleading the client.
 * It throws rather than returning a partial list, because a partial push would silently UNDER-budget ERP.
 *
 * Money is decimal-string end-to-end; summing is done in integer cents (NFR-BUD-MONEY-001 — no float math).
 */
export type BudgetCategory =
  | 'Labor' | 'Materials' | 'Subcontractors' | 'Equipment' | 'Permits & Fees' | 'Overheads' | 'Contingency';

export interface BudgetLineItem { category: BudgetCategory | string; budgeted_amount: string }
export interface CategoryAccountMapRow { category: BudgetCategory | string; erp_account: string }
export interface BudgetAccountRow { account: string; budget_amount: string }

/** FR-BUD-113 / FR-BUD-015: a NON-RETRYABLE `commit-rejected` bucket — never blind-retried. */
export class BudgetCategoryUnmappedError extends Error {
  readonly code = 'budget-category-unmapped';
  constructor(readonly unmappedCategories: string[]) {
    super(`budget categories have no ERP account mapping: ${unmappedCategories.join(', ')}`);
    this.name = 'BudgetCategoryUnmappedError';
  }
}

const toCents = (v: string): number => Math.round(Number(v) * 100);
const fromCents = (c: number): string => (c / 100).toFixed(2);

/**
 * Resolve the Active version's line items → ERP `accounts[]` rows.
 * Steps: (1) sum cents per category; (2) drop ZERO totals (no ERP meaning — FR-BUD-114, not an error);
 * (3) ⚑ collect EVERY unmapped non-zero category and throw naming ALL of them (one round-trip for the
 * operator, not a whack-a-mole); (4) emit one row per mapped category.
 */
export function resolveBudgetAccounts(
  lineItems: BudgetLineItem[],
  map: CategoryAccountMapRow[],
): BudgetAccountRow[] {
  const byCategory = new Map<string, number>();
  for (const li of lineItems) {
    byCategory.set(li.category, (byCategory.get(li.category) ?? 0) + toCents(li.budgeted_amount));
  }
  const accountFor = new Map(map.map((m) => [m.category, m.erp_account]));

  const nonZero = [...byCategory.entries()].filter(([, cents]) => cents !== 0);
  // ⚑ Collect ALL unmapped first — never throw on the first one (the operator gets one complete list).
  const unmapped = nonZero.filter(([cat]) => !accountFor.has(cat)).map(([cat]) => cat);
  if (unmapped.length > 0) throw new BudgetCategoryUnmappedError(unmapped);

  return nonZero.map(([cat, cents]) => ({
    account: accountFor.get(cat) as string,
    budget_amount: fromCents(cents),
  }));
}
```
**Verify (GREEN):**
```bash
cd /Users/ariefsaid/Coding/PMO/.claude/worktrees/erpnext-adapter-p3/pmo-portal && \
  npx vitest run src/lib/budget/categoryAccountMap.test.ts && npm run typecheck
```
**AC:** AC-BUD-011

---

## Slice 2 — the registry entry + the body (⚑ spike-gated)

### Task 2.1 — RED: the registry entry + ⚑ the `neverReissue` proof
**File (edit):** `pmo-portal/src/lib/adapterSeam/erpnext/doctypeRegistry.test.ts` — append (the shipped file's
docstring records the per-doctype empirical rationale; add P3c's):
```ts
it('AC-BUD-022 the budget kind is anchor-less ⇒ neverReissue ⇒ HELD, never auto-reissued (ADR-0059 §4)', () => {
  const entry = DOCTYPE_REGISTRY.budget;
  expect(entry.doctype).toBe('Budget');
  // Spike #5: Budget has no stock free-text field surviving validate ⇒ no probe is possible.
  expect(entry.anchorField).toBeNull();
  // ⚑ Today anchorField:null ⇒ "skip the probe → fresh claim+POST" = REISSUE-CAPABLE. For a Posture-B
  //   budget that is a silently DUPLICATED ERP object. ADR-0059 §4's corollary closes it:
  expect(entry.neverReissue).toBe(true);
  expect(!(entry.anchorMutable || entry.neverReissue)).toBe(false); // reissueOnInconclusiveAbsence === false
});

it('AC-BUD-022 every shipped kind keeps its reissue behavior byte-for-byte (neverReissue is additive)', () => {
  for (const kind of ['purchase-invoice', 'payment', 'sales-invoice', 'incoming-payment'] as const) {
    const e = DOCTYPE_REGISTRY[kind];
    expect(e.neverReissue).toBeUndefined();               // default-absent
  }
  expect(!(DOCTYPE_REGISTRY['purchase-invoice'].anchorMutable || DOCTYPE_REGISTRY['purchase-invoice'].neverReissue)).toBe(true);  // still reissue-capable
  expect(!(DOCTYPE_REGISTRY['payment'].anchorMutable || DOCTYPE_REGISTRY['payment'].neverReissue)).toBe(false);                   // still held (C-1)
});
```
**Verify (RED):**
```bash
cd /Users/ariefsaid/Coding/PMO/.claude/worktrees/erpnext-adapter-p3/pmo-portal && npx vitest run src/lib/adapterSeam/erpnext/doctypeRegistry.test.ts
```
**AC:** AC-BUD-022

### Task 2.2 — GREEN: the registry entry + the `neverReissue` flag
**File (edit):** `pmo-portal/src/lib/adapterSeam/erpnext/doctypeRegistry.ts` — three additive edits:
1. `export type ErpDocKind = … | 'budget';`
2. `DoctypeEntry` gains (**iff P3b has not already landed it — check first, then reuse**):
```ts
  /** ADR-0059 §4 corollary: `true` when this kind must NEVER be auto-reissued on an inconclusive
   *  post-window recovery even though it has NO anchor. A `null` anchor otherwise means "skip the probe →
   *  fresh claim+POST" = reissue-capable; for a Posture-B document (P3b Timesheet, P3c Budget) that is a
   *  silently DUPLICATED external record. Additive + default-absent ⇒ every shipped kind is byte-for-byte:
   *  `reissueOnInconclusiveAbsence = !(entry.anchorMutable || entry.neverReissue)`. */
  neverReissue?: boolean;
```
3. The entry (values **from the spike**, not from this plan):
```ts
  // P3c — the budget push (ADR-0055 §6 + ADR-0059 Posture B). PMO is SoT; ERP holds a copy for the GL +
  // the native overspend controls. Anchor: the budget-write spike (#5) found NO stock free-text field
  // surviving validate ⇒ anchorField null ⇒ neverReissue TRUE (ADR-0059 §4 corollary — a blind reissue
  // would mint a duplicate ERP Budget). submittable/submitOnCreate per spike #2.
  budget: { doctype: 'Budget', submittable: <spike #2>, anchorField: null, neverReissue: true },
```
**File (edit):** `supabase/functions/adapter-dispatch/index.ts` — the **one line** ADR-0059 §4 specifies:
```ts
-  reissueOnInconclusiveAbsence: !entry.anchorMutable,
+  reissueOnInconclusiveAbsence: !(entry.anchorMutable || entry.neverReissue),
```
**File (edit):** `supabase/functions/erpnext-sweep/index.ts` — the identical change in `buildReconcileDepsLive`.
> **⚑ Coordinate with P3b:** if P3b already landed `neverReissue` + both one-liners, **skip edits 2 and the
> two one-liners entirely and only add the `budget` entry.** Duplicating the flag is the failure mode.
**Verify (GREEN):**
```bash
cd /Users/ariefsaid/Coding/PMO/.claude/worktrees/erpnext-adapter-p3/pmo-portal && \
  npx vitest run src/lib/adapterSeam/erpnext/ && npm run typecheck && \
  cd .. && deno check supabase/functions/adapter-dispatch/index.ts supabase/functions/erpnext-sweep/index.ts
```
**AC:** AC-BUD-022

### Task 2.3 — RED: the body test
**File (new):** `pmo-portal/src/lib/adapterSeam/erpnext/bodies/budget.test.ts`
```ts
it('AC-BUD-012 maps categories→accounts, uses the PROJECT dimension, carries the overspend controls, omits zero rows, and NEVER leaks the projection', () => {
  const body = budgetToBody(
    {
      id: 'ver-1',
      fiscal_year: '2026',
      line_items: [
        { category: 'Labor', budgeted_amount: '50000.00' },
        { category: 'Materials', budgeted_amount: '25000.00' },
        { category: 'Equipment', budgeted_amount: '0.00' },   // zero → omitted
      ],
      pmo_etc: '35000.00',            // ⚑ present on the record but MUST NOT reach the body (FR-BUD-160)
    } as never,
    {
      refs: { project: 'PROJ-0001' },
      config: {
        company: 'PMO Smoke Co',
        category_account_map: [
          { category: 'Labor', erp_account: '5100 - Direct Costs' },
          { category: 'Materials', erp_account: '5200 - Materials' },
          { category: 'Equipment', erp_account: '5300 - Equipment' },
        ],
        budget_overspend_action: 'Warn',
      },
    },
  ) as Record<string, unknown>;

  expect(body.company).toBe('PMO Smoke Co');
  expect(body.fiscal_year).toBe('2026');
  expect(body.budget_against).toBe('Project');          // ⚑ the PROJECT dimension (FR-BUD-115)
  expect(body.project).toBe('PROJ-0001');
  expect(body.cost_center).toBeUndefined();             // never a Cost-Center fallback
  expect(body.accounts).toEqual([                        // exactly two — the zero row is OMITTED
    { account: '5100 - Direct Costs', budget_amount: '50000.00' },
    { account: '5200 - Materials', budget_amount: '25000.00' },
  ]);
  expect(body.action_if_annual_budget_exceeded).toBe('Warn');   // the POINT of the feature (FR-BUD-130)

  // ⚑ FR-BUD-160: no projection value anywhere in the body, under any key
  expect(JSON.stringify(body)).not.toContain('35000');
});

it('AC-BUD-012 fails closed (no body) when the ERP project ref is unresolvable — never an unattributed budget', () => {
  expect(() => budgetToBody(
    { id: 'ver-1', fiscal_year: '2026', line_items: [{ category: 'Labor', budgeted_amount: '1.00' }] } as never,
    { refs: { project: null }, config: { company: 'C', category_account_map: [{ category: 'Labor', erp_account: '5100' }] } },
  )).toThrow(/project/i);
});
```
**Verify (RED):**
```bash
cd /Users/ariefsaid/Coding/PMO/.claude/worktrees/erpnext-adapter-p3/pmo-portal && npx vitest run src/lib/adapterSeam/erpnext/bodies/budget.test.ts
```
**AC:** AC-BUD-012

### Task 2.4 — GREEN: `bodies/budget.ts` + wire `DOCTYPE_BODIES`
**File (new):** `pmo-portal/src/lib/adapterSeam/erpnext/bodies/budget.ts` — follow `bodies/salesInvoice.ts`'s
shape verbatim (the `toBody(rec, ctx)` signature, `ErpCtx.refs`/`ctx.config`, the fail-closed ref check).
```ts
/**
 * erpnext/bodies/budget.ts (P3c slice 2, FR-BUD-012/114/115/130/160) — the ERP `Budget` body.
 *
 * ⚑ Direction: PMO → ERP (ADR-0055 §6 + ADR-0059 Posture B). PMO is SoT; ERP holds a copy for the GL and
 * the NATIVE OVERSPEND CONTROLS — which is why `action_if_annual_budget_exceeded` is not optional garnish
 * but the point (FR-BUD-130). Field map is FROZEN by docs/spikes/2026-07-16-erpnext-budget-fields.md.
 *
 * ⚑ FR-BUD-160: this body carries ONLY the Active version's `budgeted_amount` per MAPPED category. It NEVER
 * carries `pmo_etc`, an EAC, a variance, or a utilization — the projection is PMO's forecast, and pushing it
 * would put a PMO estimate into the client's GL controls. (Structural proof: budgetNeverPushesProjection.test.ts.)
 */
import { resolveBudgetAccounts, type CategoryAccountMapRow } from '../../../budget/categoryAccountMap.ts';
import { AdapterError } from '../../contract.ts';
import type { PmoRecord } from '../../contract.ts';
import type { ErpCtx } from '../doctypeRegistry.ts';

export function budgetToBody(rec: PmoRecord, ctx: ErpCtx): unknown {
  // FR-BUD-013 fail-closed refs: an unresolvable ERP project is NEVER a null/omitted dimension and NEVER a
  // cost_center fallback — an unattributed budget would silently mis-scope the overspend controls.
  const project = ctx.refs.project;
  if (!project) throw new AdapterError('commit-rejected', 'budget push: the ERP project reference is unresolved');

  const map = (ctx.config.category_account_map as CategoryAccountMapRow[] | undefined) ?? [];
  // Throws BudgetCategoryUnmappedError (FR-BUD-113) — the dispatch classifies it BEFORE any ERP call.
  const accounts = resolveBudgetAccounts(rec.line_items as never, map);

  return {
    company: ctx.config.company,
    fiscal_year: rec.fiscal_year,
    budget_against: 'Project',                 // FR-BUD-115 — the PROJECT dimension, always
    project,
    accounts,
    // FR-BUD-130/131 — the POINT. Default 'Warn': 'Stop' would make ERP BLOCK a client's POs org-wide, so
    // it is an Admin, audited opt-in, never an integration side effect.
    action_if_annual_budget_exceeded: (ctx.config.budget_overspend_action as string | undefined) ?? 'Warn',
    ...(ctx.config.budget_applicable_on as Record<string, unknown> | undefined ?? {}),
  };
}

export function budgetFromDoc(doc: unknown): PmoRecord { /* name/docstatus/modified only — lifecycle, never figures */ }
```
**File (edit):** `pmo-portal/src/lib/adapterSeam/erpnext/doctypeBodies.ts` — one additive entry:
`budget: { toBody: budgetToBody, fromDoc: budgetFromDoc },`
**Verify (GREEN):**
```bash
cd /Users/ariefsaid/Coding/PMO/.claude/worktrees/erpnext-adapter-p3/pmo-portal && \
  npx vitest run src/lib/adapterSeam/erpnext/bodies/budget.test.ts && npm run typecheck
```
**AC:** AC-BUD-012

---

## Slice 3 — the dispatch route + ⚑ the gate + the deterministic key

### Task 3.1 — RED: the gate tests (⚑ the forged-payload guard + fail-closed)
**File (new):** `supabase/functions/adapter-dispatch/budgetGate.test.ts`
```ts
it('AC-BUD-020 ⚑ re-reads the version status FROM THE DB under the caller JWT and rejects a FORGED payload', async () => {
  const erpCalls: string[] = [];
  const db = stubDb({ budget_versions: [{ id: 'ver-1', org_id: ORG, project_id: 'proj-1', status: 'Draft' }] });
  //                                                                                       ^^^^^^^ real truth

  await expect(runBudgetGate({
    db, callerJwtOrg: ORG,
    command: { domain: 'budget', operation: 'create',
               record: { id: 'ver-1', status: 'Active' } },   // ⚑ the payload LIES
    onErpCall: (u: string) => erpCalls.push(u),
  })).rejects.toMatchObject({ code: 'commit-rejected' });

  expect(erpCalls).toHaveLength(0);            // ⚑ rejected BEFORE any ERP call
  expect(db.outboxInserts()).toHaveLength(0);  // ⚑ and before the outbox
});

it('AC-BUD-020 an ABSENT status is never treated as permission (no null/fall-through branch)', async () => {
  const db = stubDb({ budget_versions: [] });   // the row does not exist
  await expect(runBudgetGate({ db, callerJwtOrg: ORG, command: { domain: 'budget', operation: 'create', record: { id: 'ghost' } } }))
    .rejects.toMatchObject({ code: 'commit-rejected' });
});

it('AC-BUD-020 rejects a caller outside the OD-BUDGET-3 role set on the REAL JWT role', async () => { /* Engineer → commit-rejected, zero ERP calls */ });

it('AC-BUD-020 cross-org pre-flight: a version in another org is rejected before adapter selection', async () => { /* FR-BUD-014 */ });

it('AC-BUD-021 ⚑ both originators derive the IDENTICAL deterministic key; the second collides 23505 and reconciles', async () => {
  const version = { id: 'ver-1', org_id: ORG, project_id: 'proj-1', status: 'Active', activated_at: '2026-07-16T10:00:00Z' };
  const foreground = deriveBudgetIdempotencyKey(version);
  const sweep      = deriveBudgetIdempotencyKey(version);   // no shared client state — derived from DB truth
  expect(foreground).toBe(sweep);
  expect(foreground).toBe('bud:ver-1:2026-07-16T10:00:00Z');

  const db = stubDb({ budget_versions: [version] });
  await runBudgetGate({ db, callerJwtOrg: ORG, command: cmd(version) });
  await expect(runBudgetGate({ db, callerJwtOrg: ORG, command: cmd(version) }))
    .rejects.toMatchObject({ code: '23505' });               // the outbox unique does its job
  expect(db.erpCreateCount()).toBe(1);                        // ⚑ exactly ONE ERP Budget
});

it('AC-BUD-021 a RE-activation (new activated_at) is a DISTINCT command, never silently suppressed', () => {
  expect(deriveBudgetIdempotencyKey({ id: 'ver-1', activated_at: '2026-07-16T10:00:00Z' } as never))
    .not.toBe(deriveBudgetIdempotencyKey({ id: 'ver-1', activated_at: '2026-07-20T09:00:00Z' } as never));
  // ⚑ Without the stamp, rolling back to an Archived version would collide with its ORIGINAL push and be
  //   SILENTLY SUPPRESSED — leaving ERP enforcing the newer version's figures (spec OQ-BUD-2).
});

it('AC-BUD-011 an unmapped category is rejected at the boundary; the side mirror NAMES the categories', async () => {
  const db = stubDb({ budget_versions: [activeVersion], budget_category_account_map: [{ category: 'Materials', erp_account: '5200' }] });
  await expect(runBudgetGate({ db, callerJwtOrg: ORG, command: cmd(activeVersion) }))
    .rejects.toMatchObject({ code: 'budget-category-unmapped' });
  expect(db.erpCreateCount()).toBe(0);
  const mirror = db.rows('budget_version_erp_mirror')[0];
  expect(mirror.push_state).toBe('failed');
  expect(mirror.unmapped_categories).toEqual(['Contingency', 'Overheads']);
});

it('AC-BUD-033 ⚑ a multi-fiscal-year project fails closed — no split is invented, no partial budget pushed', async () => {
  const db = stubDb({
    budget_versions: [activeVersion],
    projects: [{ id: 'proj-1', org_id: ORG, start_date: '2026-06-01', end_date: '2027-03-31' }],  // spans FY26+FY27
  });
  await expect(runBudgetGate({ db, callerJwtOrg: ORG, command: cmd(activeVersion) }))
    .rejects.toMatchObject({ code: 'budget-multi-fiscal-year' });
  expect(db.erpCreateCount()).toBe(0);                                   // nothing partial reached ERP
  expect(db.rows('budget_version_erp_mirror')[0].push_error).toBe('budget-multi-fiscal-year');
});
```
**Verify (RED):**
```bash
cd /Users/ariefsaid/Coding/PMO/.claude/worktrees/erpnext-adapter-p3/pmo-portal && npx vitest run ../supabase/functions/adapter-dispatch/budgetGate.test.ts
```
**AC:** AC-BUD-020, AC-BUD-021, AC-BUD-033 (+ AC-BUD-011's boundary half)

### Task 3.2 — GREEN: the budget gate + the key + the dispatch route
**Files (new):** `supabase/functions/adapter-dispatch/budgetGate.ts`; **(edit)**
`supabase/functions/adapter-dispatch/index.ts` (route `'budget'` additively) +
`readModelWriters.ts` (a `budget` writer that upserts `budget_version_erp_mirror` — **external-side state
only; it must NEVER write `budget_versions`/`budget_line_items`**).
```ts
/**
 * adapter-dispatch/budgetGate.ts (P3c slice 3, FR-BUD-100..102/113/124, ADR-0059 §3.3).
 *
 * ⚑ THE GATE. Runs BEFORE adapter selection, BEFORE the outbox, BEFORE any ERP call. It re-reads the PMO
 * record's state FROM THE DATABASE under the CALLER'S OWN JWT. The command payload is NEVER trusted to
 * assert the precondition — ADR-0059 §3.3: "the gate either reads the required state from the DB or it
 * throws — there is no null/absent branch to fall into." (The Luna P3a audit found exactly this hole.)
 */
export function deriveBudgetIdempotencyKey(v: { id: string; activated_at: string | null }): string {
  // ADR-0059 §4: DERIVED, not minted. Two legitimate originators (the activation consequence + the sweep
  // backstop) share NO client state, so a random per-attempt key would make the outbox's unique constraint
  // useless for the exact collision it exists to prevent. The activated_at stamp keeps a legitimate
  // RE-activation a DISTINCT command rather than a silently suppressed one (spec OQ-BUD-2).
  if (!v.activated_at) throw new AdapterError('commit-rejected', 'budget push: no activation stamp'); // fail closed
  return `bud:${v.id}:${v.activated_at}`;
}

export async function runBudgetGate(deps: BudgetGateDeps): Promise<BudgetGateResult> {
  // (1) ⚑ re-READ from the DB under the caller's JWT — never the payload (FR-BUD-100)
  const version = await deps.db.readBudgetVersionAsCaller(deps.command.record.id);
  if (!version) throw new AdapterError('commit-rejected', 'budget push: version not readable');       // no null branch
  if (version.status !== 'Active') throw new AdapterError('commit-rejected', 'budget push: version is not Active');
  // (2) OD-BUDGET-3 on the REAL JWT role (FR-BUD-101); (3) cross-org pre-flight (FR-BUD-014);
  // (4) kind↔domain: 'budget' ↔ 'budget' (FR-BUD-013);
  // (5) ⚑ the map — unmapped ⇒ BudgetCategoryUnmappedError → side mirror failed + unmapped_categories (FR-BUD-113);
  // (6) ⚑ single-FY — multi-FY ⇒ 'budget-multi-fiscal-year', never a split (FR-BUD-124).
  // Every rejection path records the side mirror's push_state/push_error BEFORE throwing, so the failure is
  // durable + visible (ADR-0059 §6) — the activation already succeeded and nothing else will surface it.
}
```
**Verify (GREEN):**
```bash
cd /Users/ariefsaid/Coding/PMO/.claude/worktrees/erpnext-adapter-p3/pmo-portal && \
  npx vitest run ../supabase/functions/adapter-dispatch/ && cd .. && \
  deno check supabase/functions/adapter-dispatch/index.ts && \
  deno run --allow-all scripts/deno-boot-smoke.ts supabase/functions/adapter-dispatch/index.ts
```
> The boot-smoke is **mandatory** — it catches the circular-import TDZ class `deno check` + Vitest both miss.
**AC:** AC-BUD-020, AC-BUD-021, AC-BUD-033, AC-BUD-011

---

## Slice 4 — the activation consequence (originator 1)

### Task 4.1 — RED: ⚑ activation never fails on ERP
**File (new):** `pmo-portal/src/lib/budget/budgetPushConsequence.test.ts`
```ts
it('AC-BUD-032 ⚑ the ACTIVATION succeeds even when ERP is unreachable; the failure is durable + visible', async () => {
  const rpc = vi.fn().mockResolvedValue({ error: null });              // activate_budget_version succeeds
  const dispatch = vi.fn().mockRejectedValue(new Error('external-unreachable'));

  const result = await activateAndPush({ versionId: 'ver-1', rpc, dispatch });

  expect(result.activated).toBe(true);          // ⚑ the user's action ALWAYS succeeds (ADR-0059 §3.2)
  expect(result.error).toBeUndefined();         // ⚑ the push failure is NOT surfaced as an activation failure
  expect(rpc).toHaveBeenCalledOnce();
  expect(rpc).toHaveBeenCalledBefore(dispatch); // ⚑ the push is a CONSEQUENCE, after the tx (ADR-0059 §3.1)
  expect(result.pushState).toBe('failed');      // durable state, not a lost error
});

it('AC-BUD-032 a push rejection never rolls back or retry-loops the activation', async () => {
  const rpc = vi.fn().mockResolvedValue({ error: null });
  const dispatch = vi.fn().mockRejectedValue(new Error('budget-category-unmapped'));
  const result = await activateAndPush({ versionId: 'ver-1', rpc, dispatch });
  expect(result.activated).toBe(true);
  expect(rpc).toHaveBeenCalledOnce();           // ⚑ never re-called — no retry loop on the PMO transition
  expect(dispatch).toHaveBeenCalledOnce();      // and no client-side retry storm
});
```
**Verify (RED):**
```bash
cd /Users/ariefsaid/Coding/PMO/.claude/worktrees/erpnext-adapter-p3/pmo-portal && npx vitest run src/lib/budget/budgetPushConsequence.test.ts
```
**AC:** AC-BUD-032

### Task 4.2 — GREEN: the consequence path + the repository seam
**Files (new):** `pmo-portal/src/lib/budget/budgetPushConsequence.ts`,
`pmo-portal/src/lib/repositories/budgetPush.ts`; **(edit)** `src/lib/repositories/index.ts` (additive).
```ts
/**
 * budget/budgetPushConsequence.ts (P3c slice 4, FR-BUD-008/120, ADR-0059 §3.1/§3.2).
 * The FOREGROUND originator: activate (the shipped RPC — untouched) → THEN push, outside its transaction.
 * ⚑ The activation ALWAYS succeeds. A push failure of ANY class is swallowed into durable side-mirror state
 * + an operator surface — never surfaced as an activation failure, never rolled back, never retry-looped.
 * The sweep backstop (slice 5) is the other originator; the deterministic key makes them collide safely.
 */
export async function activateAndPush(deps: ActivateAndPushDeps): Promise<ActivateAndPushResult> {
  const { error } = await deps.rpc('activate_budget_version', { version_id: deps.versionId });
  if (error) return { activated: false, error };     // a REAL activation failure — the PMO transition's own
  try {
    await deps.dispatch({ domain: 'budget', operation: 'create', record: { id: deps.versionId } });
    return { activated: true, pushState: 'pushed' };
  } catch {
    // ⚑ ADR-0059 §3.2: never fail the user's action on ERP. The side mirror (written server-side by the
    // gate/dispatch) carries the durable failure; the sweep backstop re-drives it.
    return { activated: true, pushState: 'failed' };
  }
}
```
**Verify (GREEN):**
```bash
cd /Users/ariefsaid/Coding/PMO/.claude/worktrees/erpnext-adapter-p3/pmo-portal && \
  npx vitest run src/lib/budget/ src/lib/repositories/index.test.ts && npm run typecheck
```
**AC:** AC-BUD-032

---

## Slice 5 — the sweep backstop (originator 2) + inbound

### Task 5.1 — RED: the backstop + ⚑ never-adopt + ⚑ never-fight-the-operator
**File (new):** `supabase/functions/erpnext-sweep/budgetBackstop.test.ts`
```ts
it('AC-BUD-023 the backstop re-asserts the SAME gate from DB truth and never acts with a NULL actor', async () => {
  const db = stubDb({
    budget_version_erp_mirror: [{ budget_version_id: 'ver-1', push_state: 'pending' }],
    budget_versions: [{ id: 'ver-1', status: 'Archived' }],     // ⚑ no longer Active
  });
  await reconcileOrgBudgetPushes(db, ORG);
  expect(db.erpCreateCount()).toBe(0);                          // ⚑ it does NOT push
  expect(db.finalizedWithNullActor()).toBe(false);              // ⚑ never "trusts itself" because it is the sweep
});

it('AC-BUD-023 the backstop drives a still-Active pending row through the SAME dispatch path', async () => {
  const db = stubDb({
    budget_version_erp_mirror: [{ budget_version_id: 'ver-1', push_state: 'pending' }],
    budget_versions: [{ id: 'ver-1', status: 'Active', activated_at: '2026-07-16T10:00:00Z' }],
  });
  await reconcileOrgBudgetPushes(db, ORG);
  expect(db.erpCreateCount()).toBe(1);
  expect(db.rows('budget_version_erp_mirror')[0].push_state).toBe('pushed');
});

it('AC-BUD-023 pushed and held rows are never re-driven; the queue is bounded per tick', async () => {
  const db = stubDb({ budget_version_erp_mirror: [
    { budget_version_id: 'a', push_state: 'pushed' }, { budget_version_id: 'b', push_state: 'held' },
  ] });
  await reconcileOrgBudgetPushes(db, ORG);
  expect(db.erpCreateCount()).toBe(0);
  expect(db.lastQueryLimit('budget_version_erp_mirror')).toBeLessThanOrEqual(BUDGET_BACKSTOP_TICK_LIMIT); // ADR-0059 §6
});

it('AC-BUD-040 ⚑ a Desk-created Budget is ACK-AND-SKIPPED, NEVER adopted (ADR-0059 §5)', async () => {
  const db = stubDb({ external_refs: [] });                       // no mapping ⇒ natively created
  const res = await applyBudgetFeedEvent(db, ORG, { name: 'BUDGET-DESK-001', docstatus: 1, modified: 'x' });
  expect(res.acked).toBe(true);
  expect(res.actionRequired).toBe(true);
  expect(db.rows('budget_versions')).toHaveLength(0);             // ⚑ NOTHING minted into PMO's SoT
  expect(db.rows('budget_line_items')).toHaveLength(0);
  // ⚑ the deliberate INVERSE of P3a's FR-SAR-085 adopt rule — do not pattern-match
});

it('AC-BUD-041 ⚑ an external CANCEL is tombstoned + failed + surfaced, and NEVER auto-re-pushed', async () => {
  const db = stubDb({
    external_refs: [{ domain: 'budget', pmo_record_id: 'ver-1', external_record_id: 'BUDGET-001' }],
    budget_version_erp_mirror: [{ budget_version_id: 'ver-1', push_state: 'pushed', erp_budget_name: 'BUDGET-001' }],
    budget_versions: [{ id: 'ver-1', status: 'Active', activated_at: '2026-07-16T10:00:00Z' }],
  });
  await applyBudgetFeedEvent(db, ORG, { name: 'BUDGET-001', docstatus: 2, modified: 'y' });
  const m = db.rows('budget_version_erp_mirror')[0];
  expect(m.erp_cancelled_at).toBeTruthy();
  expect(m.erp_docstatus).toBe(2);
  expect(m.push_state).toBe('failed');
  expect(m.actionRequired).toBe(true);

  await reconcileOrgBudgetPushes(db, ORG);                        // the backstop then runs
  expect(db.erpCreateCount()).toBe(0);                            // ⚑ NEVER re-pushes (never fight the operator)
  expect(db.rows('budget_versions')[0].status).toBe('Active');    // ⚑ PMO's budget is not ERP's to revoke
});
```
**Verify (RED):**
```bash
cd /Users/ariefsaid/Coding/PMO/.claude/worktrees/erpnext-adapter-p3/pmo-portal && npx vitest run ../supabase/functions/erpnext-sweep/budgetBackstop.test.ts
```
**AC:** AC-BUD-023, AC-BUD-040, AC-BUD-041

### Task 5.2 — GREEN: the backstop pass + the inbound feed wiring
**Files (new):** `supabase/functions/erpnext-sweep/budgetBackstop.ts`; **(edit)**
`supabase/functions/erpnext-sweep/index.ts` (`ErpSweepCycleDeps` gains
`reconcileOrgBudgetPushes: (org) => Promise<{ driven: number; error?: string }>`; one additive pass **(5)**
after the accounting refresh, in the **same try/catch shape as its siblings** so one org's failure never
aborts the loop) + `_shared/erpnextFeedDeps.ts` (the `budget` domain's **never-adopt** branch: `mintMirror`
for `domain === 'budget'` **throws a classified `budget-never-adopt` error the fn logs + acks + surfaces** —
mirroring the shipped procurement `no-case-link` idiom, and **never** minting).
> **⚑ Builder note:** in `erpnextFeedDeps.ts`'s `mintMirror`, the `budget` branch must come **before** any
> generic fallback and must **never** insert into `budget_versions`/`budget_line_items`. Read the shipped
> `revenue` branch to see the adopt idiom — then write its **inverse**.
**Verify (GREEN):**
```bash
cd /Users/ariefsaid/Coding/PMO/.claude/worktrees/erpnext-adapter-p3/pmo-portal && \
  npx vitest run ../supabase/functions/erpnext-sweep/ && cd .. && \
  deno check supabase/functions/erpnext-sweep/index.ts && \
  deno run --allow-all scripts/deno-boot-smoke.ts supabase/functions/erpnext-sweep/index.ts
```
**AC:** AC-BUD-023, AC-BUD-040, AC-BUD-041

---

## Slice 6 — the projection + the surfaces

### Task 6.1 — RED: the projection formula
**File (new):** `pmo-portal/src/lib/budget/budgetProjection.test.ts`
```ts
it('AC-BUD-050 EAC = actuals + etc; variance = PMO budget − EAC; utilization = EAC / PMO budget', () => {
  const cell = deriveProjectionCell({ category: 'Labor', pmoBudgetAmount: '100000.00', actualsToDate: '40000.00', pmoEtc: '35000.00' });
  expect(cell.projectedFinalCost).toBe('75000.00');
  expect(cell.projectedVariance).toBe('25000.00');
  expect(cell.projectedUtilization).toBe(0.75);
});

it('AC-BUD-051 a zero or null PMO budget yields utilization NULL — never 0, never Infinity, never a throw', () => {
  expect(deriveProjectionCell({ category: 'Labor', pmoBudgetAmount: '0.00', actualsToDate: '10.00', pmoEtc: '0.00' }).projectedUtilization).toBeNull();
  expect(deriveProjectionCell({ category: 'Labor', pmoBudgetAmount: null, actualsToDate: '10.00', pmoEtc: '0.00' }).projectedUtilization).toBeNull();
});

it('AC-BUD-051 an absent ETC row is treated as 0 so EAC = actuals', () => {
  const cell = deriveProjectionCell({ category: 'Labor', pmoBudgetAmount: '100000.00', actualsToDate: '40000.00', pmoEtc: null });
  expect(cell.projectedFinalCost).toBe('40000.00');
  expect(cell.projectedVariance).toBe('60000.00');
});
```
**Verify (RED):**
```bash
cd /Users/ariefsaid/Coding/PMO/.claude/worktrees/erpnext-adapter-p3/pmo-portal && npx vitest run src/lib/budget/budgetProjection.test.ts
```
**AC:** AC-BUD-050, AC-BUD-051

### Task 6.2 — GREEN: `budgetProjection.ts`
**File (new):** `pmo-portal/src/lib/budget/budgetProjection.ts`
```ts
/**
 * budget/budgetProjection.ts (P3c slice 6, FR-BUD-151) — PMO's FORWARD VIEW.
 *
 * ⚑ "Projection" here = PMO's forward-looking derived view. It is NOT ADR-0055 §6's "projected into the ERP
 * object" (that means PUSHED — see bodies/budget.ts). Nothing computed here is EVER pushed (FR-BUD-160;
 * structural proof: budgetNeverPushesProjection.test.ts).
 *
 * Inputs:  pmoBudgetAmount ← budget_line_items of the ACTIVE version   (PMO SoT, OD-BUDGET-1 — NOT an ERP
 *                                                                       read-back: PMO is the authority)
 *          actualsToDate   ← erp_actuals_snapshot.net for the MAPPED account (ERP GL truth, P2's shipped sum)
 *          pmoEtc          ← budget_projections.pmo_etc                (PMO-owned, authored)
 * This module is the ORACLE (unit-owned); the RPC (mig 0109) computes the same arithmetic in SQL numeric for
 * the real read path. Keep them in step: AC-BUD-050 and AC-BUD-053 must agree.
 */
const toCents = (v: string | null): number => (v === null || v === '' ? 0 : Math.round(Number(v) * 100));
const fromCents = (c: number): string => (c / 100).toFixed(2);

export function deriveProjectionCell(input: ProjectionInput): BudgetProjectionCell {
  const actualsC = toCents(input.actualsToDate);
  const etcC = toCents(input.pmoEtc);                      // an absent ETC row ⇒ 0
  const eacC = actualsC + etcC;
  const hasBudget = input.pmoBudgetAmount !== null && input.pmoBudgetAmount !== '';
  const budgetC = hasBudget ? toCents(input.pmoBudgetAmount) : null;
  const varianceC = budgetC === null ? -eacC : budgetC - eacC;
  const utilization = budgetC === null || budgetC === 0 ? null : eacC / budgetC;   // never Infinity, never 0
  return {
    category: input.category,
    pmoBudgetAmount: hasBudget ? fromCents(budgetC as number) : null,
    actualsToDate: fromCents(actualsC),
    pmoEtc: fromCents(etcC),
    projectedFinalCost: fromCents(eacC),
    projectedVariance: fromCents(varianceC),
    projectedUtilization: utilization,
  };
}
```
**Verify (GREEN):** as 6.1 + `npm run typecheck`.
**AC:** AC-BUD-050, AC-BUD-051

### Task 6.3 — RED: the RPC pgTAP proof
**File (new):** `supabase/tests/budget_projection_rpc.test.sql`
```sql
-- AC-BUD-053 get_budget_projection: org-scoped under the CALLER'S RLS; per-CATEGORY; matches the unit oracle
begin;
select plan(5);

select has_function('public','get_budget_projection', array['uuid','text'], 'AC-BUD-053 the read RPC exists');
select is(p.prosecdef, false, 'AC-BUD-053 SECURITY INVOKER (RLS is the org filter, not a hand-rolled where)')
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='get_budget_projection';

-- PMO SoT: an Active version with a Labor line; ERP GL actuals on the MAPPED account; a PMO ETC.
select tests.authenticate_as('admin_org_a');
insert into public.budget_category_account_map (category, erp_account) values ('Labor','5100 - Direct Costs');
select tests.authenticate_as('finance_org_a');
-- (fixture: an Active budget_version for project A with a 'Labor' line of 100000.00)
insert into public.budget_projections (project_id, fiscal_year, category, pmo_etc)
  values (tests.project_id_org_a(), '2026', 'Labor', 35000.00);
set local role service_role;
insert into public.erp_actuals_snapshot (org_id, project_id, account, fiscal_year, debit, credit, net, snapshot_id)
  values ('00000000-0000-0000-0000-000000000001', tests.project_id_org_a(), '5100 - Direct Costs','2026', 40000.00, 0, 40000.00, gen_random_uuid());

select tests.authenticate_as('finance_org_a');
select results_eq(
  $$select category::text, pmo_budget_amount, actuals_to_date, pmo_etc, projected_final_cost, projected_variance
    from public.get_budget_projection(tests.project_id_org_a(), '2026')$$,
  $$values ('Labor', 100000.00::numeric, 40000.00::numeric, 35000.00::numeric, 75000.00::numeric, 25000.00::numeric)$$,
  'AC-BUD-053 the RPC derives EAC/variance matching the unit oracle, at PMO category grain');

select tests.authenticate_as('finance_org_b');
select is((select count(*)::int from public.get_budget_projection(tests.project_id_org_a(), '2026')), 0,
          'AC-BUD-053 cross-org read returns zero rows (RLS)');

select * from finish();
rollback;
```
**Verify (RED):**
```bash
cd /Users/ariefsaid/Coding/PMO/.claude/worktrees/erpnext-adapter-p3 && scripts/with-db-lock.sh supabase test db 2>&1 | grep -E 'budget_projection_rpc|not ok'
```
**AC:** AC-BUD-053

### Task 6.4 — GREEN: migration 0109 — `get_budget_projection`
**File (new):** `supabase/migrations/0109_get_budget_projection.sql` — follow `0005`'s `get_project_budget`
idiom (SECURITY INVOKER + the `revoke all / grant execute to authenticated / revoke from anon` block).
```sql
-- 0109_get_budget_projection.sql — ERPNext P3c (spec §5.7, FR-BUD-151/153, AC-BUD-053).
-- PMO's FORWARD VIEW, derived ON READ, never stored, NEVER pushed (FR-BUD-160).
-- SECURITY INVOKER (the get_project_budget idiom, 0005): it runs under the CALLER'S RLS, so org isolation
-- comes from the underlying tables' SELECT policies — no hand-rolled org filter, no security-definer.
-- Grain = PMO's CATEGORY (PMO is SoT). Joining ERP account-grained actuals back to a category requires the
-- map's INVERSE — which is exactly why budget_category_account_map is a BIJECTION (FR-BUD-111): without
-- unique(org, erp_account) this join would be ambiguous and PMO would have to INVENT a split (ADR-0048).
-- Money arithmetic is SQL numeric; the JS twin (src/lib/budget/budgetProjection.ts) is the unit oracle and
-- MUST agree (AC-BUD-050 ↔ AC-BUD-053).
-- Reversibility: drop function if exists public.get_budget_projection(uuid, text);

create or replace function public.get_budget_projection(p_project_id uuid, p_fiscal_year text)
returns table (
  category              public.budget_category,
  pmo_budget_amount     numeric,
  actuals_to_date       numeric,
  pmo_etc               numeric,
  projected_final_cost  numeric,
  projected_variance    numeric,
  projected_utilization numeric,
  push_state            text,
  push_error            text
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with pmo_budget as (
    -- PMO SoT (OD-BUDGET-1): Σ the ACTIVE version's line items per category. Not an ERP read-back.
    select li.category, sum(li.budgeted_amount) as pmo_budget_amount
      from public.budget_versions v
      join public.budget_line_items li on li.budget_version_id = v.id
     where v.project_id = p_project_id and v.status = 'Active'
     group by li.category
  ),
  actuals as (
    -- ERP GL truth (P2's shipped snapshot), mapped account → category via the BIJECTION's inverse.
    select m.category, sum(s.net) as actuals_to_date
      from public.erp_actuals_snapshot s
      join public.budget_category_account_map m
        on m.org_id = s.org_id and m.erp_account = s.account
     where s.project_id = p_project_id and s.fiscal_year = p_fiscal_year
     group by m.category
  ),
  etc as (
    select bp.category, bp.pmo_etc
      from public.budget_projections bp
     where bp.project_id = p_project_id and bp.fiscal_year = p_fiscal_year
  ),
  push as (
    select em.push_state, em.push_error
      from public.budget_version_erp_mirror em
      join public.budget_versions v on v.id = em.budget_version_id
     where v.project_id = p_project_id and v.status = 'Active' and em.fiscal_year = p_fiscal_year
     limit 1
  ),
  cells as (
    -- FULL OUTER: an ETC or an actual on a category the Active version does not budget MUST surface —
    -- never an inner join that silently drops it.
    select coalesce(b.category, a.category, e.category) as category,
           b.pmo_budget_amount,
           coalesce(a.actuals_to_date, 0) as actuals_to_date,
           coalesce(e.pmo_etc, 0)         as pmo_etc
      from pmo_budget b
      full outer join actuals a on a.category = b.category
      full outer join etc     e on e.category = coalesce(b.category, a.category)
  )
  select c.category,
         c.pmo_budget_amount,
         c.actuals_to_date,
         c.pmo_etc,
         (c.actuals_to_date + c.pmo_etc) as projected_final_cost,
         -- the JS oracle yields −EAC when there is no budget; keep the two in step with an explicit case
         -- (a plain subtraction would yield NULL and lose the signal).
         case when c.pmo_budget_amount is null then -(c.actuals_to_date + c.pmo_etc)
              else c.pmo_budget_amount - (c.actuals_to_date + c.pmo_etc) end as projected_variance,
         -- NULLIF ⇒ NULL on a zero budget: never a divide-by-zero, never Infinity (AC-BUD-051).
         ((c.actuals_to_date + c.pmo_etc) / nullif(c.pmo_budget_amount, 0)) as projected_utilization,
         (select push_state from push), (select push_error from push)
    from cells c
   order by c.category;
$$;

revoke all on function public.get_budget_projection(uuid, text) from public;
grant execute on function public.get_budget_projection(uuid, text) to authenticated;
revoke execute on function public.get_budget_projection(uuid, text) from anon;
```
**Verify (GREEN):**
```bash
cd /Users/ariefsaid/Coding/PMO/.claude/worktrees/erpnext-adapter-p3 && scripts/with-db-lock.sh supabase db reset && \
  scripts/with-db-lock.sh supabase test db 2>&1 | grep -E 'budget_projection_rpc'
```
**AC:** AC-BUD-053

### Task 6.5 — GREEN: the two surfaces
**Files (new):** `pmo-portal/pages/BudgetProjection.tsx`, `pmo-portal/pages/admin/BudgetAccountMap.tsx`
(+ routes in `App.tsx`, additive); **(new)** `pmo-portal/src/lib/repositories/budgetProjection.ts`.
Build with the shared primitives + strictly `DESIGN.md` tokens.
- **BudgetProjection:** per-**category** rows — **Budget (PMO)** | **Actuals to date (ERP GL)** | **ETC
  (PMO)** | **Projected final** | **Variance** | **Utilization**. The ETC cell is editable only under
  `<CanWrite>`/`usePermission` on the **real JWT role** (ADR-0016 — UX only; RLS is the authority).
- ⚑ **The push-state banner (FR-BUD-123):** when `push_state` ∈ (`failed`,`held`), state the **operational
  consequence in plain words** — **"ERPNext is still enforcing the previous budget for this project"** — and,
  for `budget-category-unmapped`, **name the categories** with a link to the map admin. *(That sentence, not
  a red badge, is what a finance user needs.)*
- ⚑ **Divergence (FR-BUD-152):** PMO's figure stays **authoritative and displayed**; divergence is reported.
- **BudgetAccountMap (Admin):** CRUD the 7 categories → accounts; ⚑ surface the **bijection** violations as
  a validation error naming the conflicting category/account (FR-BUD-111's accepted cost).
**Verify:**
```bash
cd /Users/ariefsaid/Coding/PMO/.claude/worktrees/erpnext-adapter-p3/pmo-portal && \
  npm run typecheck && npm run lint:ci && npx vitest run pages/
```
**AC:** none directly (slice 7's e2e exercises them).

---

## Slice 7 — the invariant proofs

### Task 7.1 — ⚑ RED+GREEN: the NO-FLIP / PMO-authority pgTAP proof
**File (new):** `supabase/tests/budget_no_flip_invariant.test.sql`
```sql
-- AC-BUD-003 ⚑ POSTURE B: PMO's budget tables are NOT flipped and PMO remains THE authority (FR-BUD-006).
-- This is the owner's one-authority ruling made structural. If this test ever goes red, someone has
-- pattern-matched P3a's flip onto a Posture-B domain.
begin;
select plan(7);

-- (a) no ownership row for 'budget' — there is no command path to gate; a flip would be a misnamed no-op
select is((select count(*)::int from public.external_domain_ownership where domain = 'budget'), 0,
          'AC-BUD-003 no domain_externally_owned row for budget exists');

-- (b) no policy on the PMO budget tables references the flip predicate
select is((select count(*)::int from pg_policies
           where tablename in ('budget_versions','budget_line_items')
             and (qual like '%domain_externally_owned%' or with_check like '%domain_externally_owned%')), 0,
          'AC-BUD-003 no budget policy references domain_externally_owned (no flip)');

-- (c) no native-mirror guard trigger
select is((select count(*)::int from pg_trigger t join pg_class c on c.oid = t.tgrelid
           where c.relname in ('budget_versions','budget_line_items') and t.tgname like '%native_mirror_guard%'), 0,
          'AC-BUD-003 no *_native_mirror_guard trigger on the PMO budget tables');

-- (d) an EMPLOYING org's Finance user writes + activates + reads exactly as a non-employing one does
--     (fixture: org A has an activated erpnext binding; org B does not)
select tests.authenticate_as('finance_org_a');   -- EMPLOYING
select lives_ok($$insert into public.budget_line_items (budget_version_id, category, budgeted_amount)
                  values (tests.draft_version_org_a(), 'Labor', 1000.00)$$,
                'AC-BUD-003 an EMPLOYING org may still author budget line items (no 42501 — the grid lives)');
select lives_ok($$select public.activate_budget_version(tests.draft_version_org_a())$$,
                'AC-BUD-003 an EMPLOYING org may still activate a version');
select is((select public.get_project_budget(tests.project_id_org_a())), 1000.00::numeric,
          'AC-BUD-003 get_project_budget remains THE authority for an EMPLOYING org (OD-BUDGET-1)');

select tests.authenticate_as('finance_org_b');   -- NON-employing — identical behavior
select lives_ok($$insert into public.budget_line_items (budget_version_id, category, budgeted_amount)
                  values (tests.draft_version_org_b(), 'Labor', 1000.00)$$,
                'AC-BUD-003 a NON-employing org is byte-for-byte unchanged');

select * from finish();
rollback;
```
**Verify:**
```bash
cd /Users/ariefsaid/Coding/PMO/.claude/worktrees/erpnext-adapter-p3 && scripts/with-db-lock.sh supabase test db 2>&1 | grep -E 'budget_no_flip'
```
**AC:** AC-BUD-003

### Task 7.2 — ⚑ RED+GREEN: the never-push-the-projection structural test
**File (new):** `pmo-portal/src/lib/adapterSeam/erpnext/budgetNeverPushesProjection.test.ts`
```ts
it('AC-BUD-054 ⚑ no pmo_etc / EAC / variance / utilization value can reach ERP, under any key', async () => {
  const requests: Array<{ method: string; body: string }> = [];
  const fetchImpl = vi.fn(async (_u: string, init?: RequestInit) => {
    requests.push({ method: String(init?.method ?? 'GET'), body: String(init?.body ?? '') });
    return new Response(JSON.stringify({ data: { name: 'BUDGET-001', docstatus: 1, modified: 'x' } }), { status: 200 });
  }) as unknown as typeof fetch;

  await pushBudget({ fetchImpl, version: activeVersionWithEtc /* pmo_etc 35000.00, EAC 75000.00 */, map: FULL_MAP });

  for (const r of requests) {
    expect(r.body).not.toContain('35000');    // pmo_etc
    expect(r.body).not.toContain('75000');    // EAC
    expect(r.body).not.toMatch(/etc|projected|variance|utilization/i);
  }
});

it('AC-BUD-054 budgetToBody emits ONLY budgeted_amount per mapped category', () => {
  const body = budgetToBody(activeVersionWithEtc as never, ctxWithFullMap) as Record<string, unknown>;
  expect(Object.keys(body).sort()).toEqual(
    ['accounts', 'action_if_annual_budget_exceeded', 'budget_against', 'company', 'fiscal_year', 'project'].sort(),
  );
  for (const a of body.accounts as Array<Record<string, unknown>>) {
    expect(Object.keys(a).sort()).toEqual(['account', 'budget_amount']);   // nothing else crosses
  }
});
```
**Verify:**
```bash
cd /Users/ariefsaid/Coding/PMO/.claude/worktrees/erpnext-adapter-p3/pmo-portal && npx vitest run src/lib/adapterSeam/erpnext/budgetNeverPushesProjection.test.ts
```
**AC:** AC-BUD-054

### Task 7.3 — RED+GREEN: the non-employing byte-for-byte test
**File (new):** `pmo-portal/src/lib/adapterSeam/erpnext/budgetNonEmploying.test.ts`
```ts
it('AC-BUD-001 a non-employing org: activation makes no ERP call, no outbox row, no side-mirror row', async () => {
  const fetchImpl = vi.fn() as unknown as typeof fetch;
  const db = stubDb({ external_org_bindings: [] });        // no activated binding — the shipped default
  const result = await activateAndPush({ versionId: 'ver-1', rpc: db.rpc, dispatch: db.dispatch, fetchImpl });
  expect(result.activated).toBe(true);
  expect(fetchImpl).not.toHaveBeenCalled();
  expect(db.rows('external_command_outbox')).toHaveLength(0);
  expect(db.rows('budget_version_erp_mirror')).toHaveLength(0);
});
```
**Plus the schema-level half of FR-BUD-004/006 — assert nothing existing moved:**
```bash
cd /Users/ariefsaid/Coding/PMO/.claude/worktrees/erpnext-adapter-p3 && \
  git diff --stat origin/dev -- supabase/migrations/0001_init_schema.sql supabase/migrations/0002_rls.sql \
    supabase/migrations/0022_finance_budget_debt.sql supabase/migrations/0032_fix_top_projects_spent.sql \
    supabase/migrations/0033_at_risk_budget_from_versions.sql
# MUST print NOTHING. (0005_budget_mutation_rpc.sql is ALSO untouched unless OQ-BUD-2(a) was ratified —
#  and even then it is a NEW migration 010X, never an edit to 0005.)
```
**Verify:**
```bash
cd /Users/ariefsaid/Coding/PMO/.claude/worktrees/erpnext-adapter-p3/pmo-portal && npx vitest run src/lib/adapterSeam/erpnext/budgetNonEmploying.test.ts
```
**AC:** AC-BUD-001

### Task 7.4 — the bench e2e: the push
**File (new):** `pmo-portal/e2e/serial/AC-BUD-030-budget-push.spec.ts`
```ts
test('AC-BUD-030 activating a version pushes the mapped budget with its overspend controls', async ({ page, request }) => {
  // Given a complete map, a single-FY project, an Active-able version — no page.route; the REAL served fn
  await loginAs(page, 'finance');
  await page.goto('/projects/<seeded>/budget');
  await page.getByRole('button', { name: 'Activate' }).click();
  await expect(page.getByText(/activated/i)).toBeVisible();

  const budget = await benchGet(request, `/api/resource/Budget?filters=[["project","=","${erpProject}"]]`);
  expect(budget.data).toHaveLength(1);                                   // exactly ONE
  const doc = await benchGet(request, `/api/resource/Budget/${budget.data[0].name}`);
  expect(doc.data.budget_against).toBe('Project');
  expect(doc.data.action_if_annual_budget_exceeded).toBe('Warn');        // the POINT of the feature
  expect(doc.data.accounts.map((a) => [a.account, a.budget_amount])).toEqual([
    ['5100 - Direct Costs', 50000], ['5200 - Materials', 25000],
  ]);
  const mirror = await svc.from('budget_version_erp_mirror').select('*').single();
  expect(mirror.data.push_state).toBe('pushed');
});
```
**Verify:**
```bash
cd /Users/ariefsaid/Coding/PMO/.claude/worktrees/erpnext-adapter-p3/pmo-portal && \
  ../scripts/with-erpnext-lock.sh ../scripts/with-db-lock.sh npx playwright test e2e/serial/AC-BUD-030-budget-push.spec.ts
```
**AC:** AC-BUD-030

### Task 7.5 — ⚑ the bench e2e: re-activation upserts, never duplicates
**File (new):** `pmo-portal/e2e/serial/AC-BUD-031-budget-reactivation-upsert.spec.ts`
```ts
test('AC-BUD-031 re-activation UPSERTS the same ERP Budget — never a duplicate', async ({ page, request }) => {
  await activateVersion(page, v1);
  const first = await benchList(request, 'Budget', erpProject);
  expect(first).toHaveLength(1);

  // (a) a clone → edit → activate revision
  await cloneEditActivate(page, { category: 'Labor', amount: '60000' });
  const afterRevision = await benchList(request, 'Budget', erpProject);
  expect(afterRevision).toHaveLength(1);                                   // ⚑ still exactly ONE object
  expect(await benchAccountAmount(request, afterRevision[0].name, '5100 - Direct Costs')).toBe(60000);

  // (b) ⚑ a ROLL-BACK re-activation of the earlier version — must NOT be silently suppressed (OQ-BUD-2)
  await activateVersion(page, v1);
  const afterRollback = await benchList(request, 'Budget', erpProject);
  expect(afterRollback).toHaveLength(1);
  expect(await benchAccountAmount(request, afterRollback[0].name, '5100 - Direct Costs')).toBe(50000); // back to v1
});
```
**Verify:**
```bash
cd /Users/ariefsaid/Coding/PMO/.claude/worktrees/erpnext-adapter-p3/pmo-portal && \
  ../scripts/with-erpnext-lock.sh ../scripts/with-db-lock.sh npx playwright test e2e/serial/AC-BUD-031-budget-reactivation-upsert.spec.ts
```
**AC:** AC-BUD-031

### Task 7.6 — the full regression gate (AC-BUD-002) + the pre-push verify
```bash
cd /Users/ariefsaid/Coding/PMO/.claude/worktrees/erpnext-adapter-p3/pmo-portal && npm run verify
cd /Users/ariefsaid/Coding/PMO/.claude/worktrees/erpnext-adapter-p3 && scripts/with-db-lock.sh supabase db reset && scripts/with-db-lock.sh supabase test db
cd /Users/ariefsaid/Coding/PMO/.claude/worktrees/erpnext-adapter-p3/pmo-portal && \
  ../scripts/with-erpnext-lock.sh ../scripts/with-db-lock.sh npx playwright test e2e/serial/
```
**Then:** **Luna `--thinking max`** money/security review (the standing rule). **HOLD-NO-PR** until the
Director says otherwise.
**AC:** AC-BUD-002

---

## 5. Definition of done

- [ ] OQ-BUD-1 frozen by the budget-write spike; **OQ-BUD-2 + OQ-BUD-3 owner-ruled**; OQ-BUD-5 recorded by
      the Director **(sign-off prerequisites)**.
- [ ] Migrations `0108`/`0109` (renumbered — P3b races us) applied, **reversible**, with reversal blocks.
- [ ] **⚑ AC-BUD-003 green** — no flip; PMO's budget tables + `get_project_budget` are **untouched and
      authoritative** in an employing org; `git diff --stat origin/dev -- supabase/migrations/000*` clean
      (0005 excepted **only** under a ratified OQ-BUD-2(a), and then only via a **new** migration).
- [ ] **⚑ AC-BUD-011 green** — an unmapped category fails closed, naming the categories, with no ERP call.
- [ ] **⚑ AC-BUD-021 green** — the two originators cannot mint two ERP Budgets.
- [ ] **⚑ AC-BUD-054 green** — no projection value can reach ERP.
- [ ] **⚑ AC-BUD-032 green** — activation never fails on ERP.
- [ ] RLS on all three new tables; `org_id` seam + `stamp_org_id()` on all three; pgTAP green.
- [ ] Every AC-BUD-### green at its **one** owning layer per §4; `grep -r AC-BUD-011` finds exactly one proof.
- [ ] `npm run verify` green (whole suite) + `supabase test db` green + `e2e/serial/` green.
- [ ] `deno check` + `scripts/deno-boot-smoke.ts` green for `adapter-dispatch` **and** `erpnext-sweep`.
- [ ] Coverage ≥80% lines on changed code; tests assert behavior.
- [ ] Luna `--thinking max` → SHIP.
- [ ] `docs/backlog.md` + `docs/decisions.md` updated with the P3c outcome + the OQ rulings **(Director)**.

---

## 6. Open questions (carried from spec §10 — for the Director)

1. **OQ-BUD-2 — ⚑ the activation state stamp. NEW; blocks sign-off.** `budget_versions` has no
   `activated_at`, and a version-id-only/content-digest key **silently suppresses a roll-back
   re-activation** ⇒ ERP keeps enforcing the wrong budget. Proposed **(a)**: an additive, nullable
   `activated_at` stamped by `activate_budget_version` — which **ADR-0059 §3.1/§8 forbids**. Ratify as a
   narrow exception (it is a *witness*: no gate, no semantic change, no KPI touched) **or** split into a
   2-task pre-req issue. **Task 0.6 is written but GATED on this.**
2. **OQ-BUD-3 — ⚑ multi-fiscal-year. Blocks sign-off.** PMO's budget has no FY dimension; ERP's `Budget` is
   per FY. Proposed **(a)**: push the start FY, **fail closed** on multi-FY (never invent a split —
   ADR-0048). **Size the cost:** if most real projects span fiscal years, the feature is largely inert until
   a FY/phasing dimension lands on `budget_line_items` (its own issue).
3. **OQ-BUD-1 — the write field map. Blocks slices 1–2.** Task 0.1 gates on the spike. Highest-value:
   **#4** (update-after-submit vs cancel+amend → FR-BUD-121's mechanism) and **#5** (anchor? expected no ⇒
   `neverReissue`).
4. **OQ-BUD-4 — where the map lives. Non-blocking.** Proposed **(a)** a dedicated table (enum key + the
   bijective uniques + RLS + admin CRUD + pgTAP integrity) over **(b)** the `process_gates` jsonb precedent.
5. **OQ-BUD-5 — ADR-0055 §6's "ERP's figure wins" + "capture as new version" need a recorded
   clarification.** Both clauses are **two-way sync** and contradict the ruling + ADR-0059 §8. This plan
   builds §6's **mechanism** and **not** its reconcile-up clauses (divergence is reported, never merged).
6. **Coordination:** **`neverReissue` is P3b's flag — reuse it, do not duplicate it** (task 2.2). ADR-0059
   §7's ownership map gains a **Budgets / Posture B** row (spec §1.1's wording is ready to lift) — the
   Director's to record.
