# Plan: ERPNext adapter — Timesheets push-Approved-only (Issue P3b, ADR-0055 P3 phase, time/costing spine)

> **⚑ BUILD STATUS: COMPLETE — shipped in PR #360 (branch `feat/erpnext-adapter-p3`, head `fabde7c5`).**
> All 9 slices built; 11 adversarial audit rounds (10 NO SHIP → 1 SHIP). Gates at merge: verify 746
> files / 6277 tests, pgTAP 211/2103, deno 447, **e2e serial 54/54 against a live ERPNext bench**,
> visual gates 78/78.
>
> ⚑ This header previously read "NOT STARTED" long after the slices were built, and a status inventory
> was misled by it. **Verify build status against the filesystem and git, never against a checkbox.**
> **⚑ Spike status 2026-07-16: it could NOT run — the ERPNext bench had been down ~36h. The bench is
> restarted and the spike is re-dispatched.** Until `docs/spikes/2026-07-16-erpnext-timesheet-fields.md` §9
> is frozen: **no `Timesheet` or `Employee` field name may be written into code, and no builder may guess one
> to unblock themselves.** Spike-gated tasks are marked **⚑ SPIKE-GATED** inline.
>
> **Revised 2026-07-16 for the owner rulings.** ✅ **OQ-TSP-3 → the Employee-adopt sub-domain** (over
> map-only) ⇒ **Slice 3 is new**, `erp_employees` + the link RPC are new storage (`0110`/`0111`), the
> `employee_map` binding-config key is **deleted** from this plan, and FR-TSP-051 now resolves the employee
> via a **confirmed adopt link**. ✅ **OQ-TSP-4 → costing only, billable OUT** ⇒ the body sends **no** billing
> field (task 2.6) and it is a stated non-goal. Slices renumbered **0–8** (was 0–7).
>
> **Spec:** `docs/specs/erpnext-adapter-p3b-timesheets.spec.md` (rev. 2026-07-16) — **DRAFT.** **Do not start
> Slice 3 before an OQ-TSP-10 ruling** (it changes FR-TSP-092's link-state machine only, but that is Slice
> 3's core); **do not start Slice 2.6+ before the spike.** Open: **OQ-TSP-10** (Employee→PMO-user resolution
> — this plan builds the recommended **(C) adopt-then-confirm**), **OQ-TSP-5** (timezone — drafted position
> built), **OQ-TSP-6** (correction path — **nothing built**).
>
> **⚑ ID prefix:** `FR-TSP-###`/`AC-TSP-###`, **not** `FR-TS-###` (taken by the shipped
> `docs/specs/timesheets-approval.spec.md`, migration `0007`) — **owner-confirmed 2026-07-16**.
>
> **ADRs:** **ADR-0059** (**written + Proposed 2026-07-16** — `docs/adr/0059-pmo-sot-with-external-side-mirror.md`:
> Posture A vs **Posture B**, the choice rule, the seven Posture-B invariants, the deterministic key, the
> never-adopt rule + its **master-data exception** licensing Slice 3, and the ADR-0055 §5 row clarification.
> **P3b is its first instance — read it before this plan.**), **ADR-0055**, **ADR-0058** (verbatim + ADR-0059
> §4's anchor-less corollary), **ADR-0048**, **ADR-0019** (**already satisfied** by `transition_timesheet`),
> **ADR-0016**, **ADR-0010**, **ADR-0017**.
> **Decisions:** OD-SAR-GATES, OD-SAR-PMO-IS-THE-UI, OD-SAR-DRAFT-SUBMIT (task 2.2 explains why P3b is its
> deliberate opposite), OD-ENA-SHARED-BINDINGS (config keys, never a new table), OD-ENA-VAULT-SEAM.
>
> **Extends, never forks — the shipped surfaces to reuse EXACTLY:**
> - `pmo-portal/src/lib/adapterSeam/erpnext/{adapter,doctypeRegistry,doctypeBodies,feedKinds,partyAdopt,applyFeed,recoveryProbe,transitionPolicy,lineage,moneyShape,dispatchFactory,client,credentials}.ts` + `bodies/{shared,customer,supplier,salesInvoice,incomingPayment,paymentEntry}.ts`
> - `pmo-portal/src/lib/adapterSeam/{contract,dispatch,refs}.ts`
> - `supabase/functions/adapter-dispatch/{index,authGuard,sodGuard,transitionTargetGuard,readModelWriters,moneyOutboxDeps,faultSeams}.ts`
> - `supabase/functions/{erpnext-webhook,erpnext-sweep,_shared/erpnextFeedDeps}.ts` — **`erpnextFeedDeps.ts`'s
>   `mintMirror` is THE party-adopt path Slice 3 extends** (its `domain === 'companies'` branch mints a
>   `companies` row for a natively-created Supplier/Customer; Slice 3 adds a sibling `'timesheets'` branch —
>   **not a new mechanism**)
> - migrations `0074` (`stamp_org_id()`), `0087` (`domain_externally_owned`), `0088` (`external_refs`), `0089` (`external_sync_watermarks`), `0096` (outbox + bindings + claim/fence RPCs), `0102` (sweep cron), `0107` (`get_process_gates` — the org-guarded config-read idiom), `0076` (`audit_events`)
> - `e2e/serial/AC-SAR-*.spec.ts` + `scripts/{serve-functions,with-db-lock,with-erpnext-lock}.sh`
>
> **The P3a Luna re-audit is a binding design input** (`docs/reviews/2026-07-15-luna-p3a-reaudit-maxthinking.md`).
> Its ten findings are pre-closed **by construction**, not by later hardening — slice 5 lands the guards
> **before** any push can happen:
> | Luna finding (P3a) | P3b closure |
> |---|---|
> | BLOCK-1 unfiltered fallback probe cross-matches | N/A (unique doctypes) — and task 2.2's `neverReissue` removes the reissue path entirely if anchor-less |
> | BLOCK-2/3 transition SoD bypass; target unbound to PMO mapping | task 5.3 — `externalRecordId` **never** accepted from the client; target from `external_refs` only |
> | BLOCK-4 no ownership/role/kind checks; NULL actor no-ops SoD | tasks 5.1/5.2 — `approvalGuard` re-reads DB truth (no NULL branch exists) + `KIND_DOMAIN` + the **non-`MONEY_WRITE_ROLES`** rule + the read-only-kind reject |
> | BLOCK-5 raw refs fail **open** | task 4.2 — employee/project/activity **fail-closed before** the outbox claim |
> | BLOCK-6 cross-org validation **after** the external write | task 4.2 — same-org pre-flight **before** the claim |
> | BLOCK-7 inbound adoption loses links | task 6.2 — **no adoption path for the process doc**; and task 3.3's Employee adopt mints the **full** canonical + `erp_modified` (the exact party-adopt bug found live 2026-07-14) |
> | BLOCK-8 cancel reconcile unwired | task 6.3 — desk-cancel tombstone + reopen, wired + e2e'd |
> | SF9 gate passes without the ERP dimension | task 4.2 — unmapped project **rejects**, never omits |
> | SF10 partial config bypasses defaults | task 1.5 — the config read **merges over defaults in SQL** |
>
> **No-placeholder rule (binding):** every task has an exact path, the actual code/diff, its `AC-TSP-###`,
> and an exact verify command. TDD order: the failing-test task **precedes** its implementation task. Types
> are consistent across tasks (`AdapterCommand`/`PmoRecord`/`ErpDocKind`/`ErpCtx`/`DoctypeEntry`/
> `ReadModelWriter`/`ReadModelWriterCtx`/`ErpFeedDeps` are the shared vocabulary; P3b adds the `timesheets`
> domain, **two** kinds, and **one optional registry field** — no other contract change).
>
> **⚑ Migration numbering (binding — `ls supabase/migrations | tail -1` = `0107` at write time):** this plan
> reserves **`0108`** (`timesheet_erp_mirror`), **`0109`** (gate + config RPCs), **`0110`** (`erp_employees`),
> **`0111`** (`confirm_erp_employee_link`). **Re-verify at build time:** `ls supabase/migrations | sort | tail -5`;
> if any is taken by a concurrent writer, take the next free block and update **every** reference in this plan
> **and** the `supabase/tests/*` filenames + comments. Never edit a migration already shipped to
> `main`/`production`.
>
> **⚑ Parallel-agent hygiene (binding):** the local Docker DB is shared. Wrap **every** DB-driving command in
> `scripts/with-db-lock.sh` (`… supabase db reset` / `… supabase test db` / `… npx playwright test`) and the
> ERP-bench-driving e2e additionally in `scripts/with-erpnext-lock.sh`.

---

## 0. Job story (from spec §0)

> When a client employs ERPNext as the costing engine, the approved hours my team already entered and I
> already approved in PMO must land in ERPNext by themselves — while hours still being drafted, disputed, or
> awaiting approval never leak into the ledger; and every client who does NOT employ ERPNext keeps the exact
> timesheet module they have today.

PMO = the app, the weekly grid, **and the SoT for entry + approval** (ADR-0059 Posture B). ERPNext = the
native `Timesheet` and the costing downstream. The push is a **consequence** of `transition_timesheet`'s
already-SoD'd approval — never a second gate, never a step inside it. Two independent originators (the
approve path, the sweep backstop) are reconciled by a **deterministic** key on the shipped ADR-0058 outbox.
Inert with no `timesheets`→`erpnext` assignment.

---

## 1. Architecture overview (how P3b plugs into P2/P3a)

```
 User approves a timesheet (the SHIPPED path — pages/Approvals.tsx → useTimesheetApproval)
   → transition_timesheet(id,'Approved')       ← UNCHANGED authority: map legality + SoD (approver≠author)
                                                 + authz matrix. Commits FIRST, independently. FR-TSP-004(ii)
   → THEN, and only on success: repositories.timesheet.pushApproved(id)                    [slice 7]
        → routeDomainWrite('timesheets')  [shipped ADR-0056 cache, fail-closed 'pmo']
            ├─ 'pmo'      → NO-OP (approval already succeeded — nothing to reject)          ← FR-TSP-005
            └─ 'external' → dispatchDomainCommand('timesheets','create',
                              {id, erp_doc_kind:'timesheet'}, deterministicKey)             ← FR-TSP-041
                  → POST functions/v1/adapter-dispatch     [shipped fault seams reused]
                      ├─ checkErpnextCommandAuthorization  (org + per-domain role + KIND_DOMAIN
                      │                                     + employee-is-read-only)        ← 5.2
                      ├─ checkApprovedTimesheet            (DB re-read, caller JWT)         ← 5.1 ★ FR-TSP-010
                      ├─ checkTransitionTargetBinding      (timesheets allow-listed)        ← 5.3
                      ├─ resolveTimesheetRefs   CONFIRMED employee link + per-entry project
                      │                         + activity + same-org + >24h — ALL fail-closed,
                      │                         BEFORE the outbox claim                     ← 4.2
                      └─ dispatchExternallyOwnedWrite → resolveErpDispatchAdapter
                            → tsToBody {employee, time_logs:[…]}   ← ⚑ SPIKE-FROZEN (2.6); NO billing fields
                            → POST insert → PUT {docstatus:1} → refetch  (submitOnCreate:true — 2.2) ★
                            → external_command_outbox verbatim (ADR-0058)
                            → timesheets read-model writer → timesheet_erp_mirror           ← 4.3
 Employee master (the OQ-TSP-3 ruling — the SHIPPED party-adopt path, extended)              [slice 3]
   → erpnext-sweep (Employee cursor; first tick BACKFILLS) + erpnext-webhook (HMAC hint)
        → applyErpFeedEvent → erpnextFeedDeps.mintMirror  ['timesheets' branch, sibling of 'companies']
             → erp_employees row (full canonical + erp_modified — the 0103/party-adopt lesson)
             → external_refs(org,'timesheets','Employee:<name>')
             → link probe: unique work-email match → link_state='proposed'  (NEVER auto-confirmed)
                           zero/multi match        → link_state='unlinked' + action-required
        → Admin confirms → confirm_erp_employee_link RPC (Admin-only, audited) → 'confirmed'
             → ONLY 'confirmed' authorizes a push (FR-TSP-051); the sweep then self-heals the pending sheet
 Sweep backstop (the SECOND originator — new topology; P2/P3a had one)                       [slice 6]
   → approved-but-unpushed candidates (status='Approved' × mirror absent|'pending'|'failed',
     not tombstoned; bounded, index-served) → SAME deterministic key → SAME guards re-asserted ← R-SWEEP
 Native ERP Timesheet / desk cancel
   → no external_refs mapping → ACK-AND-SKIP + action-required — NEVER adopt  ← 6.2 (FR-TSP-082)
   → mapped, docstatus 2 → tombstone + lineage + push_state='failed' + action-required;
        NO auto re-push (never fight the accountant)                          ← 6.3 (FR-TSP-084)
```

`timesheets` / `timesheet_entries` / `transition_timesheet` / `save_timesheet_week` / `profiles` appear
**nowhere** as a write target. **That is the design** (ADR-0059 §3.1), and task 1.3's pgTAP proves it.

---

## 2. Key design decisions (binding — carry these into every task)

1. **PMO is SoT ⇒ a SIDE table, not a flip (ADR-0059 Posture B).** `timesheet_erp_mirror` is 1:1,
   machine-written, **default-deny** for `authenticated` (no INSERT/UPDATE/DELETE policy — stricter *and*
   simpler than P3a's flip + `*_native_mirror_guard`: there is no forward-compat PMO-native writer to shape
   for). The P3a flip would be **actively wrong**: it would `42501` the weekly grid on a flipped org.
2. **The Approved gate is a server-side DB re-read, not a payload check (FR-TSP-010).** `approvalGuard.ts`
   reads `timesheets.status` under the **caller's** JWT (the deputy `callerClient`, never `service_role` —
   the shipped `sodGuard.ts` precedent) **before** adapter/outbox/ERP. There is no NULL/absent branch to fall
   into — that is precisely how the Luna BLOCK-4 "NULL-actor no-ops the SoD" trap is closed **by
   construction**.
3. **The push role rule is NOT `MONEY_WRITE_ROLES` (FR-TSP-011).** A legitimate approver may be an
   **`Engineer`**-role line manager (`profiles.manager_id`; `0007` A2/A4). Rule: `approved_by` **OR**
   Admin/Executive/Project Manager/Finance **OR** the sweep. The obvious code reuse is wrong; AC-TSP-012 pins it.
4. **Deterministic idempotency key (ADR-0059 §4).** `'ts:' || timesheet_id || ':' || approved_at`. Two
   independent originators with no shared client state; a fresh random key would make the outbox's unique
   4-tuple useless for the exact collision it prevents (**two ERP Timesheets = a duplicated week of hours**).
5. **`submitOnCreate: true` — deliberately the OPPOSITE of `sales-invoice` (FR-TSP-061).**
   OD-SAR-DRAFT-SUBMIT exists because an SI's only gate **was** the ERP submit. A timesheet's gate is
   `transition_timesheet`'s SoD — **already passed, in PMO, by a different actor**. Task 2.2's registry
   comment states this **inline** so a reviewer pattern-matching on P3a does not "fix" it.
6. **Fail-closed refs, resolved BEFORE the outbox claim (FR-TSP-050).** Employee (**confirmed link only**),
   every entry's project, activity type, same-org, and the >24h check — all before the claim and the POST.
   **Never** omit an unresolved dimension (Luna SF9); **never** validate after the commit (Luna BLOCK-6).
7. **Never adopt the process doc; DO adopt the master (ADR-0059 §5 + its exception).** An inbound
   **Timesheet** with no mapping is ack-and-skipped (adoption would mint hours that never passed PMO
   approval — the deliberate inverse of P3a's FR-SAR-085). An inbound **Employee** adopts **normally**, via
   the **shipped `mintMirror` party-adopt path** — masters are not process documents.
8. **The Employee→PMO-user link is adopt-then-confirm (OQ-TSP-10(C), OPEN).** The adopt **proposes** on a
   unique work-email match; **only an Admin-`confirmed` link authorizes a push**; an ERP-side email edit can
   propose but **never** re-point a confirmed link. **This is a security property, not a nicety:** ERP-side
   email is Desk-editable, so auto-matching would let anyone with Desk access silently re-point whose cost a
   week becomes.
9. **`employee` lives in the `timesheets` domain, NOT `companies` (FR-TSP-094).** `companies` is **already
   flipped for existing orgs**; adding an `Employee` doctype to its sweep/feed would change their behavior —
   an FR-ENA-004 violation. The timesheets flip brings its own master. **AC-TSP-003 is that proof.**
10. **`neverReissue` — one additive, default-absent registry field (ADR-0059 §4 corollary).** Today
    `anchorField: null` ⇒ probe skipped ⇒ **reissue-capable** — for a Timesheet, a silently duplicated week.
    `reissueOnInconclusiveAbsence = !(entry.anchorMutable || entry.neverReissue)`. Additive ⇒ every shipped
    kind is byte-for-byte.
11. **The approval never depends on ERP (FR-TSP-006).** The push is outside the approval transaction; a
    failure is `push_state='failed'` + an operator surface, never a rolled-back approval. (A DB function
    cannot call an edge function anyway — "push from the RPC" is impossible **and** wrong.)
12. **Byte-for-byte FIRST.** Slice 1 lands the AC-TSP-004 flipped-org pgTAP **before** any push code exists.
    Every slice ends with `npm run verify` (AC-TSP-002 — the unchanged P2+P3a suite IS the regression gate).
13. **Costing only — billable is OUT (owner ruling).** No `is_billable`/`billing_hours`/`billing_rate`, no
    PMO billability/rate model. A builder adding one is committing a scope violation, not a favour.

---

## 3. Slice plan (9 slices; one PR each to `dev`; all green flag-off)

Each slice is a standalone PR that builds and passes `npm run verify` **with no org employing `timesheets`**
(byte-for-byte for every existing client). Merge order 0→8 is the dependency order.

| Slice | Scope (1 line) | ACs owned | Migrations | Tasks | Gate |
|---|---|---|---|---|---|
| **0** | **The OQ-TSP-1 live-bench spike** — the R9 ladder for `Timesheet` **+ the `Employee` read shape (#9)**; freeze the body maps, anchor, overlap, GL, cancel, edges | — (gates 011/090) | — | 0.1–0.2 | **IS the gate** |
| **1** | Storage: `timesheet_erp_mirror` (side table, default-deny, 4 day-one `erp_*` cols, `(org_id,push_state)` idx) + the gate/config RPCs + pgTAP incl. **the flipped-org byte-for-byte proof** | 004, 012, 050 | `0108`, `0109` | 1.1–1.8 | ⚑ **spike-gated** (see 0.2) |
| **2** | Adapter core: `timesheets` capability + the `timesheet` **and `employee`** kinds + the additive `neverReissue` semantics + `timeLogPacking.ts` + the spike-frozen bodies | 021, 032, 033, 034 | — | 2.1–2.9 | 2.6–2.8 ⚑ spike |
| **3** | ⭐ **Employee-adopt sub-domain** (the OQ-TSP-3 ruling): `erp_employees` + the Admin link RPC + the `mintMirror` `'timesheets'` branch + the propose-never-confirm probe + the Employee sweep cursor | 003, 090, 091, 093, 094 | `0110`, `0111` | 3.1–3.9 | ⚑ OQ-TSP-10 + spike #9 |
| **4** | Dispatch wiring: the fail-closed ref resolver (**confirmed-link** employee) + the `timesheets` read-model writer + the AC-TSP-001 regression net **FIRST** | 001, 030 | — | 4.1–4.6 | — |
| **5** | **The guards (land before any push can happen):** `approvalGuard.ts` + the per-domain role rule + read-only-kind + target binding | 013 | — | 5.1–5.6 | — |
| **6** | Feed: `timesheet` lifecycle-only, **never adopt**, desk-cancel reopen | 042 | — | 6.1–6.4 | — |
| **7** | FE: the approve path dispatches the push after (never inside) the RPC; the `failed`/`held` operator surface; the **Employee-link Confirm** surface | 051 | — | 7.1–7.6 | — |
| **8** | Served-fn serial e2e lane (`e2e/serial/AC-TSP-*`) | 010, 011, 020, 022, 031, 040, 041, 092 | — | 8.1–8.9 | ⚑ **spike** |

**AC-TSP-002** (zero-regression meta-AC) is the `npm run verify` + full-pgTAP gate at the end of **every**
slice. **AC-TSP-001** is the slice-4 RED-first regression net. **AC-TSP-004** lands in **slice 1**, before any
push code exists — deliberately.

---

## Slice 0 — The OQ-TSP-1 live-bench spike (**HARD GATE**)

**⚑ Status: could not run (bench down ~36h, 2026-07-14→16). Bench restarted; spike re-dispatched.**

**Goal:** freeze the `Timesheet` **and `Employee`** field maps, the anchor, and the validation ladder
empirically. **No body code before 0.2 is filed.** The P3a precedent: its spike overturned two drafted
assumptions (`project` not `cost_center`; SI cancel not hard-blocked). P3b's ladder is wider (child table +
datetimes + HR-master link + overlap validator + a second doctype) — assume the same.

### 0.1 — Run the R9 ladder against the stock bench

**Bed (identical to P2/P3a):** `frappe/erpnext:v15.94.3`, site `frontend` @ `http://localhost:8080`,
`PMO Smoke Co`, IDR, Standard COA, no custom apps, token auth, stock `/api/resource` v1 REST only.
**Method (identical to `docs/spikes/2026-07-11-erpnext-pe-mandatory-fields.md`):** POST a minimal body → read
`exc_type` + `_server_messages` → add exactly the named field → repeat to `200` → `PUT {docstatus:1}` →
**re-fetch and diff**. Record every rung verbatim.

The nine questions (spec §3 OQ-TSP-1): (1) minimal mandatory body for `Timesheet` + `time_logs`
(save/submit/server-derived, over `employee`/`company`/`activity_type`/`from_time`/`to_time`/`hours`/
`project`); (2) **the anchor** — probe `note`, `title`, `parent_project`, `time_logs[].description` for
verbatim survival of validate+submit+refetch **and** REST-filterability, in that order; (3) overlap
validation within a doc and across docs for one employee; (4) datetime format + site-TZ interpretation;
(5) **does submit post GL?**; (6) cancel semantics; (7) the zero/empty edges (empty `time_logs`, `hours:0`,
`hours>24`, a day summing >24 — clean `417` vs unguarded `500 TypeError`); (8) the unmapped-`employee` error
shape; **(9) ⭐ the `Employee` doctype READ shape** — `GET /api/resource/Employee` +
`GET /api/resource/Employee/<name>`: exact names for the id, `employee_name`, **`user_id`** (exists?
populated?), `company_email`/`personal_email`/`prefered_email` (**which exist; which are populated**),
`status`, `company`, `modified`; and whether `Employee` supports the same `modified`-poll + webhook the party
adopt uses.

**Verify:** every rung has a pasted request/response; the anchor probe shows each candidate's **post-refetch**
value; (5) is answered by `GET /api/resource/GL Entry?filters=[["voucher_no","=","<ts-name>"]]` returning its
count; (9) pastes a real `Employee` JSON body with the field names visible.

### 0.2 — File the frozen spike write-up (the binding authority)

**File:** `docs/spikes/2026-07-16-erpnext-timesheet-fields.md` (new — the P2 R9 / P3a R9-P3a format).
Structure: `§0 bed` · `§1 Timesheet minimal body ladder` · `§2 anchor probe` · `§3 overlap` · `§4 datetime/TZ`
· `§5 GL on submit` · `§6 cancel` · `§7 edges` · `§8 employee link errors` · **`§8b Employee read shape`** ·
`§9 FROZEN MAPS (binding)`.

**§9 must state, unambiguously:** the exact `tsToBody` field list; the exact `tsFromDoc` source fields; the
exact `employeeFromDoc` source fields (**which email field is `work_email`; whether `user_id` exists**); the
registry triple `anchorField`/`anchorMutable`/`neverReissue`; and — if the anchor probe found nothing — a
one-line **"ANCHOR-LESS ⇒ OQ-TSP-2 fail-closed fires: `anchorField:null`, `neverReissue:true`"**.

**Verify:** `ls docs/spikes/2026-07-16-erpnext-timesheet-fields.md`; §9 is copy-pasteable into tasks
2.2/2.6/2.7/3.3 with **zero** invention required. **If §9 cannot be written without a guess, the spike is not
done — say so; do not proceed.**

---

## Slice 1 — Storage: `timesheet_erp_mirror` + the gate RPCs + **the byte-for-byte proof**

**Goal:** the side table + the two SECURITY DEFINER reads the dispatch/sweep need — and AC-TSP-004 (the PMO
module is unchanged on a **flipped** org) proven **before any push code exists**. **No app code. No org
flipped ⇒ byte-for-byte.** *(Spike-gated only in that the slice must not merge ahead of a spike that could
force an `erp_*` column change; the schema below carries no ERP field names, so it may be **built** in
parallel with the spike and merged after §9 confirms no extra read-back column is needed.)*

### 1.1 — RED: pgTAP `supabase/tests/0110_timesheet_erp_mirror_rls.test.sql` (OWNS AC-TSP-050)

**File** (new). Model on `supabase/tests/erpnext_money_flip_rls.test.sql`. Seeds: org A (flipped on
`timesheets` via `operator_set_domain_ownership`) + org B (not); in A — user U (`Engineer`), U's line manager
M (`Engineer`, `profiles.manager_id = M`), a `Finance` user F, an unrelated `Engineer` X; U's `timesheets`
row + a service-role `timesheet_erp_mirror` row. Asserts:
- **Machine-only (FR-TSP-170):** user-JWT `INSERT`, `UPDATE ... SET push_state='pushed'`, and `DELETE` each
  **write 0 rows / are denied** (default-deny: no `authenticated` write policy); the **service role**
  `UPDATE ... SET push_state='pushed', ts_number='TS-0001', erp_total_hours=7.50, erp_docstatus=1` **succeeds**.
- **Read parity (FR-TSP-171):** U reads 1 row; M reads 1; F reads 1; **X reads 0**; a user in **org B** reads **0**.
- **Day-one columns (the 0103 lesson):** `information_schema.columns` confirms `erp_docstatus`,
  `erp_modified`, `erp_amended_from`, `erp_cancelled_at`, `erp_total_hours`, `erp_total_costing_amount`,
  `push_state`, `push_error`, `approved_at_pushed`.
- **Seam:** `unique (timesheet_id)`; deleting the parent `timesheets` row cascades the mirror row.
**Verify:** `scripts/with-db-lock.sh supabase test db -- -f 0110_timesheet_erp_mirror_rls` → **RED**.

### 1.2 — RED: pgTAP `supabase/tests/0113_timesheet_push_authz.test.sql` (OWNS AC-TSP-012)

**File** (new). The FR-TSP-011 rule, DB-side (the predicate lives in the `0109` RPC so it is provable at the
DB layer, not only in TS). On an approved sheet whose `approved_by` = M (**`Engineer`** line manager):
- `approved_timesheet_for_push(sheet)` **as M** → returns the row (**an `Engineer` is permitted** — the
  anti-`MONEY_WRITE_ROLES` proof, decision §2.3);
- as **F** (`Finance`, privileged) → returns the row;
- as **X** (active `Engineer` bystander) → **`42501`**;
- as **U** (the author, not the approver, not privileged) → **`42501`**;
- on a **`Submitted`** sheet, as M → **`P0001` / `timesheet-not-approved`**;
- cross-org: as a user in org B → **`42501`** (AC-TSP-031's DB half).
**Verify:** `scripts/with-db-lock.sh supabase test db -- -f 0113_timesheet_push_authz` → **RED**.

### 1.3 — RED: pgTAP `supabase/tests/0112_timesheet_module_unchanged_when_flipped.test.sql` (OWNS AC-TSP-004)

**File** (new). **P3b's single most important test** — R-SOT. On an org **flipped** on `timesheets`:
- **No schema drift:** `information_schema.columns` for `timesheets`, `timesheet_entries`, **and `profiles`**
  matches the pre-P3b set **exactly** (assert the expected `array_agg(column_name order by column_name)`);
  `pg_policies` for all three returns the **same policy names** as pre-P3b; `information_schema.triggers`
  shows **no** new trigger.
- **Behavior parity** (the shipped assertions re-run under a flipped org): U inserts an own-draft
  `timesheet_entries` row → **succeeds** (0011 `WITH CHECK`); U reads own rows / M reads U's submitted sheet
  (0007 A2) → **succeed**; `save_timesheet_week(...)` on U's own draft → **succeeds** and is atomic;
  `transition_timesheet(sheet,'Submitted')` by U → succeeds; `transition_timesheet(sheet,'Approved')` by
  **U** (self) → **`42501`** (the SoD still bites — P3b must **not** weaken it);
  `transition_timesheet(sheet,'Approved')` by **M** → succeeds; an illegal `'Approved'→'Draft'` → **`P0001`**
  (the map is unchanged — **no re-open path was smuggled in**, spec §13 / OQ-TSP-6).
**Verify:** `scripts/with-db-lock.sh supabase test db -- -f 0112_timesheet_module_unchanged_when_flipped` →
**RED** (the `timesheets` domain is not yet an accepted `domain_externally_owned` value ⇒ the flip fixture
errors). It goes GREEN in 1.4 **without a single line of timesheet-module change** — that is the point.

### 1.4 — GREEN: migration `0108_timesheet_erp_mirror.sql`

**File** `supabase/migrations/0108_timesheet_erp_mirror.sql` (new — **re-verify the number**).

```sql
-- 0108_timesheet_erp_mirror.sql (ERPNext P3b, Slice 1) — the ERP-side state for a PMO-OWNED record.
--
-- ⚑ ADR-0059 POSTURE B (the P3b inversion): unlike P2/P3a, PMO is the SoT for timesheet entry AND approval
-- (owner ruling: push Approved-only). So there is NO per-command RLS flip here: `timesheets` and
-- `timesheet_entries` stay user-writable and are NOT TOUCHED BY THIS MIGRATION AT ALL. A flip would 42501
-- the shipped weekly grid on a flipped org. This SIDE table holds only ERP-side state, is machine-written
-- (dispatch/sweep service role), and is reversed by a single `drop table` with ZERO PMO data loss
-- (NFR-TSP-REV-001 — a property Posture A does not have).
--
-- ⛔ DO NOT add `alter table public.timesheets` / `public.timesheet_entries` / `public.profiles` to this
--    file. FR-TSP-004(ii) + ADR-0059 §3.1 + spec §13; proven by
--    supabase/tests/0112_timesheet_module_unchanged_when_flipped.test.sql.
--
-- All four erp_* feed columns ship DAY ONE (the 0103 lesson: `companies` shipped without
-- erp_modified/erp_docstatus and broke the first live webhook with 42703).
--
-- Reversibility (ADR-0006, pre-production): `supabase db reset`. Manual reverse block:
--   drop table if exists public.timesheet_erp_mirror;   -- cascades its policies; no PMO data is lost

create table if not exists public.timesheet_erp_mirror (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null default '00000000-0000-0000-0000-000000000001',
  timesheet_id  uuid not null unique references public.timesheets(id) on delete cascade,
  ts_number     text,                        -- ERP `name` (display only; the mapping lives in external_refs, 0088)
  push_state    text not null default 'pending'
    check (push_state in ('pending','pushing','pushed','failed','held')),
  push_error    text,                        -- last classified failure (client-safe), for the operator surface
  pushed_at     timestamptz,
  approved_at_pushed timestamptz,            -- the timesheets.approved_at this push was keyed on (FR-TSP-041)
  erp_total_hours          numeric(9,2),     -- ERP server-computed total_hours — mirrored VERBATIM (ADR-0048)
  erp_total_costing_amount numeric(14,2),    -- ERP server-computed total_costing_amount — mirrored VERBATIM
  erp_docstatus    smallint,
  erp_modified     text,
  erp_amended_from text,
  erp_cancelled_at timestamptz,
  created_at    timestamptz not null default now()
);

-- The sweep's hot path (NFR-TSP-PERF-001): find approved-but-unpushed without scanning history.
create index if not exists timesheet_erp_mirror_org_state_idx
  on public.timesheet_erp_mirror (org_id, push_state);

create trigger timesheet_erp_mirror_stamp_org_id
  before insert on public.timesheet_erp_mirror for each row execute function public.stamp_org_id();

alter table public.timesheet_erp_mirror enable row level security;

-- SELECT ONLY, and only for the audience that may already read the parent sheet (FR-TSP-171 — the ERP state
-- of a sheet is never more visible than the sheet). The exists() mirrors timesheets_select (0007 A2): own
-- row OR privileged role OR the owner's line manager. NO INSERT/UPDATE/DELETE policy exists for
-- `authenticated` ⇒ default-deny (FR-TSP-170); the service role bypasses RLS. No *_native_mirror_guard
-- trigger is needed: there is no legitimate user UPDATE to column-pin.
create policy timesheet_erp_mirror_select on public.timesheet_erp_mirror for select
  using (org_id = auth_org_id() and exists (
    select 1 from public.timesheets t
     where t.id = timesheet_erp_mirror.timesheet_id
       and t.org_id = auth_org_id()
       and (t.user_id = auth.uid()
            or auth_role() in ('Admin','Executive','Project Manager','Finance')
            or exists (select 1 from public.profiles p
                        where p.id = t.user_id and p.manager_id = auth.uid()))));
```

**Verify:** `scripts/with-db-lock.sh supabase db reset` (clean); then 1.1 → **GREEN**; 1.3 → **GREEN**
(**without any timesheet-module edit** — if it needed one, the design is wrong: STOP and escalate); full
pgTAP still green.

### 1.5 — GREEN: migration `0109_approved_timesheet_for_push.sql` (the gate read + the config merge)

**File** `supabase/migrations/0109_approved_timesheet_for_push.sql` (new).

```sql
-- 0109_approved_timesheet_for_push.sql (ERPNext P3b, Slice 1) — the ONE read the dispatch + sweep use to
-- (a) prove the sheet is Approved (FR-TSP-010), (b) prove the caller may push it (FR-TSP-011), and
-- (c) hand back the entries in one round-trip. SECURITY DEFINER so it can read across the tables it needs
-- while RE-ASSERTING, internally and explicitly, every guard RLS would have applied (the ADR-0011/0012
-- lesson — DEFINER bypasses RLS, so removing any re-assertion below leaks a cross-org / unauthorized push):
--   • org: the sheet's org MUST equal the ACTOR's org                              (FR-TSP-054)
--   • status: MUST be 'Approved' — else P0001 'timesheet-not-approved'             (FR-TSP-010) ★ the ruling
--   • actor: caller MUST be approved_by, OR Admin/Executive/Project Manager/Finance (FR-TSP-011)
--     ⚑ NOT the money-role set alone: a legitimate approver is often an Engineer-role LINE MANAGER
--       (profiles.manager_id; 0007 A2/A4). Narrowing this to MONEY_WRITE_ROLES breaks the primary path.
-- The sweep calls this as service_role with p_actor => the sheet's approved_by (the admin-connect
-- p_actor_id precedent) — it never "trusts itself" past the status check.
create or replace function approved_timesheet_for_push(p_timesheet_id uuid, p_actor uuid default null)
  returns table (timesheet_id uuid, user_id uuid, approved_at timestamptz, entries jsonb)
  language plpgsql security definer set search_path = public as $$
declare
  v_org uuid; v_status timesheet_status; v_owner uuid; v_approved_by uuid; v_approved_at timestamptz;
  v_actor uuid := coalesce(p_actor, auth.uid());
  v_role  user_role;
begin
  select t.org_id, t.status, t.user_id, t.approved_by, t.approved_at
    into v_org, v_status, v_owner, v_approved_by, v_approved_at
    from public.timesheets t where t.id = p_timesheet_id;
  if v_org is null then
    raise exception 'timesheet not found' using errcode = 'P0002';
  end if;

  -- (a) tenancy — MUST STAY (definer bypasses RLS). Compared against the ACTOR's org, never a payload.
  if v_actor is not null then
    if v_org is distinct from (select p.org_id from public.profiles p where p.id = v_actor) then
      raise exception 'not authorized' using errcode = '42501';
    end if;
  end if;

  -- (b) THE OWNER'S RULING (FR-TSP-010): only an Approved sheet may ever reach ERP.
  if v_status is distinct from 'Approved' then
    raise exception 'timesheet-not-approved (status %)', v_status using errcode = 'P0001';
  end if;

  -- (c) actor rule (FR-TSP-011). approved_by OR privileged. NOT MONEY_WRITE_ROLES alone.
  select p.role into v_role from public.profiles p where p.id = v_actor;
  if not (v_actor is not distinct from v_approved_by
          or v_role in ('Admin','Executive','Project Manager','Finance')) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  return query
    select p_timesheet_id, v_owner, v_approved_at,
           coalesce((select jsonb_agg(jsonb_build_object(
                       'project_id', e.project_id, 'entry_date', e.entry_date,
                       'hours', e.hours::text,          -- decimal STRING (FR-TSP-070) — never a float
                       'project_org_id', pr.org_id)     -- for the same-org pre-flight (FR-TSP-054)
                     order by e.entry_date, e.project_id)  -- stable total order (FR-TSP-062 determinism)
                     from public.timesheet_entries e
                     join public.projects pr on pr.id = e.project_id
                    where e.timesheet_id = p_timesheet_id and e.hours > 0), '[]'::jsonb);
end; $$;
revoke all     on function approved_timesheet_for_push(uuid, uuid) from public;
grant  execute on function approved_timesheet_for_push(uuid, uuid) to   authenticated, service_role;
revoke execute on function approved_timesheet_for_push(uuid, uuid) from anon;

-- The timesheets binding config read — merged OVER defaults IN SQL. Luna SF10: `0107` returned a partial
-- jsonb unchanged, so `process_gates:{}` made a default-ON key read as undefined ⇒ OFF. Same trap, closed
-- the same way: `defaults || actual` (right operand wins per key; missing keys keep the default).
-- NOTE: there is NO `employee_map` key — the OQ-TSP-3 ruling replaced it with the erp_employees adopt
-- (slice 3). Do not re-introduce it.
create or replace function get_timesheet_config(p_org uuid)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare v_cfg jsonb;
begin
  if auth.uid() is not null and p_org is distinct from auth_org_id() then
    raise exception 'not authorized' using errcode = '42501';   -- the 0107 org-guard idiom
  end if;
  select coalesce(b.config, '{}'::jsonb) into v_cfg
    from public.external_org_bindings b
   where b.org_id = p_org and b.external_tier = 'erpnext';
  return jsonb_build_object(
           'project_map', '{}'::jsonb,
           'default_activity_type', 'null'::jsonb,
           'timesheet_day_start', to_jsonb('09:00:00'::text))
         || coalesce(v_cfg, '{}'::jsonb);
end; $$;
revoke all     on function get_timesheet_config(uuid) from public;
grant  execute on function get_timesheet_config(uuid) to   authenticated, service_role;
revoke execute on function get_timesheet_config(uuid) from anon;
```

**Verify:** `scripts/with-db-lock.sh supabase db reset`; then 1.2 → **GREEN**.

### 1.6 — GREEN: re-run the three pgTAP files (AC-TSP-004, AC-TSP-012, AC-TSP-050)

**Verify:** `scripts/with-db-lock.sh supabase test db` → `0110`/`0112`/`0113` green **and the full suite
green** (AC-TSP-002).

### 1.7 — Confirm the spike forces no schema change

**Verify:** once slice 0's §9 is frozen, re-read it against `0108`'s columns: if §9 names a server-computed
read-back P3b should mirror that `erp_total_hours`/`erp_total_costing_amount` do not cover, add it in a
**new** migration (`0112+`), never by editing `0108` if it has shipped. Record the check (pass/no-change) in
the PR description.

### 1.8 — Slice-1 gate

**Verify:** `cd pmo-portal && npm run verify` green (no app code references the new table yet — a
pure-storage slice). **AC-TSP-004, AC-TSP-012, AC-TSP-050 owned.** PR to `dev`.

---

## Slice 2 — Adapter core: the `timesheets` domain, both kinds, packing, the frozen bodies

**Goal:** the additive capability/registry/body entries + the deterministic time packing. Registered but no
org routes to them → inert. **Tasks 2.6–2.8 are BLOCKED on slice 0.**

### 2.1 — `ERPNEXT_TIMESHEETS_DOMAIN` + capability-map entry

**File** `pmo-portal/src/lib/adapterSeam/erpnext/adapter.ts`:

```ts
export const ERPNEXT_TIMESHEETS_DOMAIN: PmoDomain = 'timesheets';
// …in createErpAdapter:
capabilityMap: new Set<PmoDomain>([
  ERPNEXT_COMPANIES_DOMAIN, ERPNEXT_PROCUREMENT_DOMAIN, ERPNEXT_REVENUE_DOMAIN, ERPNEXT_TIMESHEETS_DOMAIN,
]),
```
Update the module docstring to `capabilityMap:{companies,procurement,revenue,timesheets}`. **No other
change** — the router reads `capabilityMap` generically; the dispatch reads `domain_externally_owned`
generically.
**Verify:** `cd pmo-portal && npx vitest run src/lib/adapterSeam/erpnext/adapter.test.ts` (extend the
capability-map assertion to expect `'timesheets'`); `npm run typecheck`.

### 2.2 — RED+GREEN: both kinds + the additive `neverReissue` semantics (OWNS AC-TSP-021 registry half)

**File** `pmo-portal/src/lib/adapterSeam/erpnext/doctypeRegistry.ts` — extend the union, add the optional
field, append **two** entries (**no existing entry edited**):

```ts
export type ErpDocKind =
  | 'purchase-request' | 'rfq' | 'quotation' | 'purchase-order' | 'goods-receipt'
  | 'purchase-invoice' | 'payment' | 'supplier' | 'customer'
  | 'sales-invoice' | 'incoming-payment'
  | 'timesheet' | 'employee';                     // P3b

// …added to DoctypeEntry (OPTIONAL + default-absent ⇒ every shipped kind is byte-for-byte, NFR-TSP-REG-001):
  /** P3b (FR-TSP-042/043, ADR-0059 §4 corollary): `true` ⇒ a post-window inconclusive recovery is HELD,
   *  never reissued, EVEN WHEN `anchorField` is null. Without it, `anchorField:null` means "skip the probe →
   *  fall through to a fresh claim+POST" — i.e. reissue-capable — which for a Timesheet is a silently
   *  DUPLICATED WEEK of hours (inflated project cost). Reaches C-1's posture by a different route: C-1 holds
   *  because the anchor is MUTABLE; this holds because there is NO anchor. Omitted/`false` ⇒ shipped
   *  behavior, unchanged. */
  neverReissue?: boolean;

// …appended to DOCTYPE_REGISTRY (anchor triple from docs/spikes/2026-07-16-…-timesheet-fields.md §9):
  // P3b — Timesheets domain (FR-TSP-060/061).
  // ⚑ submitOnCreate is INTENTIONALLY TRUE — the DELIBERATE OPPOSITE of 'sales-invoice'
  // (OD-SAR-DRAFT-SUBMIT). Do NOT "fix" this to match the SI. OD-SAR-DRAFT-SUBMIT exists because an SI's
  // ONLY approval gate WAS the ERP submit, so create+submit let the author approve their own invoice. A
  // timesheet's gate is transition_timesheet's SoD — approver≠author, ALREADY PASSED, in PMO, by a
  // DIFFERENT actor (0007 A4: "even an Admin can never approve their own timesheet"). The ERP submit is the
  // mechanical CONSEQUENCE of that approval, not a second gate; an ERP draft would mean approved hours never
  // reach costing, which is the entire point of P3b. (FR-TSP-061.)
  timesheet: { doctype: 'Timesheet', submittable: true, submitOnCreate: true,
               anchorField: <SPIKE §9>, anchorMutable: <SPIKE §9>, neverReissue: <SPIKE §9> },
  // P3b — the Employee MASTER (OQ-TSP-3 ruling). readOnly: PMO NEVER writes an ERP Employee; this kind
  // exists ONLY for the inbound adopt (ADR-0059 §5's master-data exception). The `customer` entry is the
  // precedent for a readOnly party master.
  employee: { doctype: 'Employee', submittable: false, readOnly: true, anchorField: null },
```

**File** `pmo-portal/src/lib/adapterSeam/dispatch.ts` — the ONE recovery-policy line:
```ts
// P3b FR-TSP-042 (ADR-0059 §4): an anchor-less kind must NOT fall through to a fresh POST (duplicated-week
// guard). Was: !entry.anchorMutable
const reissueOnInconclusiveAbsence = !(entry.anchorMutable || entry.neverReissue);
```

**Tests** (extend, RED first): `doctypeRegistry.test.ts` — the `timesheet` entry's doctype/submittable/
`submitOnCreate`/anchor triple; the `employee` entry's `readOnly:true`/`submittable:false`; **and** that
`purchase-invoice`/`payment`/`sales-invoice`/`incoming-payment` have `neverReissue === undefined` (the
additive proof). `dispatch.test.ts` — `{anchorField:null, neverReissue:true}` ⇒
`reissueOnInconclusiveAbsence === false` ⇒ `held`; `purchase-invoice` (`remarks`, immutable, no flag) still
⇒ `true` (**shipped behavior unchanged**).
**Verify:** `npx vitest run src/lib/adapterSeam/erpnext/doctypeRegistry.test.ts src/lib/adapterSeam/dispatch.test.ts`;
`npm run typecheck`.

### 2.3 — RED: `timeLogPacking.test.ts` (OWNS AC-TSP-033)

**File** `pmo-portal/src/lib/adapterSeam/erpnext/timeLogPacking.test.ts` (new). Per AC-TSP-033: three entries
on one date (`hours` 2.5, 3, 1.5; `timesheet_day_start='09:00:00'`) → `from_time`s `'…09:00:00'`,
`'…11:30:00'`, `'…14:30:00'` in stable `project_id` order; **two calls produce byte-identical output**
(`JSON.stringify` equality); no interval overlaps; every datetime matches
`/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/` (**no `T`, no `Z`, no offset**); a multi-date sheet packs each date
independently from the day start; `packTimeLogs` **throws** `daily-hours-exceed-24` for a date summing `> 24`
(AC-TSP-032 half).
**Verify:** `npx vitest run src/lib/adapterSeam/erpnext/timeLogPacking.test.ts` → **RED**.

### 2.4 — GREEN: `timeLogPacking.ts` (FR-TSP-062/063/055) — **spike-informed, not spike-blocked**

**File** `pmo-portal/src/lib/adapterSeam/erpnext/timeLogPacking.ts` (new):

```ts
/**
 * erpnext/timeLogPacking.ts (P3b, FR-TSP-062/063/055) — PMO stores `entry_date` + `hours` and NO clock
 * times; ERP's `time_logs[]` needs `from_time` (spike §1). This synthesizes them DETERMINISTICALLY: per
 * date, ordered by (entry_date, project_id) — a stable TOTAL order, never object-key or hash order —
 * starting at `dayStart`, each row packed sequentially and NON-OVERLAPPING (spike §3: ERP rejects
 * overlapping logs). Determinism is load-bearing: a re-push after a `committed`-state recovery must be
 * byte-identical or the probe/adopt logic cannot match its own prior body.
 *
 * Datetimes are NAIVE site-local 'YYYY-MM-DD HH:MM:SS' strings (spike §4, OQ-TSP-5 — OPEN) — built by
 * integer minute arithmetic, NEVER by `new Date()` (which would apply the RUNNER's timezone and silently
 * mis-date an hour at a day boundary). Hours cross as decimal STRINGS (FR-TSP-070).
 */
export interface TimesheetEntryInput { project_id: string; entry_date: string; hours: string; }
export interface PackedTimeLog { entry_date: string; project_id: string; from_time: string; hours: string; }

const MAX_MINUTES_PER_DAY = 24 * 60;

function hoursToMinutes(hours: string): number {
  // Decimal-string → integer minutes WITHOUT float drift on the value: split on '.', scale the fraction to
  // 2dp, integer-multiply. (0.05h = 3min; 7.25h = 435min.)
  const [wholeRaw, fracRaw = ''] = hours.trim().split('.');
  const whole = Number.parseInt(wholeRaw || '0', 10);
  const frac = Number.parseInt((fracRaw + '00').slice(0, 2), 10);
  if (!Number.isFinite(whole) || !Number.isFinite(frac)) throw new Error(`unparseable hours: ${hours}`);
  return whole * 60 + Math.round((frac * 60) / 100);
}

function minutesToClock(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
}

/** @throws Error('daily-hours-exceed-24') — the classifier maps it to commit-rejected (FR-TSP-055). */
export function packTimeLogs(entries: TimesheetEntryInput[], dayStart: string): PackedTimeLog[] {
  const sorted = [...entries].sort((a, b) =>
    a.entry_date === b.entry_date ? a.project_id.localeCompare(b.project_id)
                                  : a.entry_date.localeCompare(b.entry_date));
  const [sh, sm] = dayStart.split(':').map((p) => Number.parseInt(p, 10));
  const startMinutes = sh * 60 + sm;
  const cursor = new Map<string, number>();
  const out: PackedTimeLog[] = [];
  for (const e of sorted) {
    const mins = hoursToMinutes(e.hours);
    if (mins <= 0) continue;                       // zero rows are dropped (FR-TSP-056)
    const at = cursor.get(e.entry_date) ?? startMinutes;
    // FR-TSP-055: PMO caps a SINGLE entry at 24h (0001 CHECK) but NOT the daily total across projects.
    // 3 projects x 10h is a legal PMO sheet; packing it would spill from_time into the NEXT day (silently
    // mis-dating hours) and/or trip ERP's overlap validator. Reject BEFORE any ERP call.
    if (at - startMinutes + mins > MAX_MINUTES_PER_DAY) throw new Error('daily-hours-exceed-24');
    out.push({ entry_date: e.entry_date, project_id: e.project_id,
               from_time: `${e.entry_date} ${minutesToClock(at)}`, hours: e.hours });
    cursor.set(e.entry_date, at + mins);
  }
  return out;
}
```
**Verify:** `npx vitest run src/lib/adapterSeam/erpnext/timeLogPacking.test.ts` → **GREEN**; `npm run typecheck`.

### 2.5 — RED: `bodies/timesheet.test.ts` (OWNS AC-TSP-032) — **⚑ SPIKE-GATED**

**File** `pmo-portal/src/lib/adapterSeam/erpnext/bodies/timesheet.test.ts` (new). Assertions **against spike
§9** (fill the exact field names from it — **do not guess**): `tsToBody` emits one doc with the resolved
`employee`, `time_logs` carrying each row's resolved `project` + packed `from_time` + decimal-string `hours`
(+ `activity_type` **iff** §9 says mandatory); **and NO `is_billable`/`billing_hours`/`billing_rate` key
exists on any row** (the OQ-TSP-4 ruling — assert the **absence**, not just the value); a `>24h` day
**throws** `daily-hours-exceed-24`; a zero-entry sheet yields the skip signal (FR-TSP-056); `tsFromDoc`
mirrors `name`/`docstatus`/`modified`/`amended_from`/`total_hours`/`total_costing_amount`.
**Verify:** `npx vitest run src/lib/adapterSeam/erpnext/bodies/timesheet.test.ts` → **RED**.

### 2.6 — GREEN: `bodies/timesheet.ts` — **⚑ SPIKE-GATED; §9 is the ONLY authority**

**File** `pmo-portal/src/lib/adapterSeam/erpnext/bodies/timesheet.ts` (new). Shape (the **contract**;
**field names from spike §9, FR-TSP-064**):

```ts
/**
 * Timesheet `toBody`/`fromDoc` — FROZEN by docs/spikes/2026-07-16-erpnext-timesheet-fields.md §9.
 * `toBody` sends exactly §9's field list. Every dimension it carries (employee, per-row project, activity
 * type) is resolved SERVER-SIDE and FAIL-CLOSED by resolveTimesheetRefs (task 4.2) — this builder NEVER
 * omits an unresolved dimension and NEVER falls back to a default (Luna SF9/BLOCK-5).
 * ⛔ NO billing fields: OWNER RULING 2026-07-16 — P3b is COSTING ONLY; is_billable/billing_hours/
 *    billing_rate and the Timesheet→Sales-Invoice linkage are a SEPARATE issue. Adding one here is a scope
 *    violation, not a favour.
 * `fromDoc` mirrors ERP's server-computed totals as the ORACLE (ADR-0048) — PMO never recomputes them.
 */
import type { PmoRecord } from '../../contract.ts';
import type { ErpCtx } from '../doctypeRegistry.ts';
import { packTimeLogs, type TimesheetEntryInput } from '../timeLogPacking.ts';
import { mirrorMoney } from '../moneyShape.ts';

export function tsToBody(rec: PmoRecord, ctx: ErpCtx): unknown {
  const entries = (rec.entries ?? []) as TimesheetEntryInput[];
  const logs = packTimeLogs(entries, String(ctx.config.timesheet_day_start ?? '09:00:00'));
  return {
    employee: ctx.refs.employee,                    // the CONFIRMED adopt link, resolved upstream (FR-TSP-051)
    time_logs: logs.map((l) => ({
      // <SPIKE §9 field names>. `project` per row: resolved + fail-closed upstream (FR-TSP-052).
      activity_type: ctx.config.default_activity_type,   // include IFF §9 says mandatory
      from_time: l.from_time,                        // naive site-local (FR-TSP-063)
      hours: l.hours,                                // decimal STRING (FR-TSP-070)
      project: ctx.refs[`project:${l.project_id}`],
    })),
  };
}

export function tsFromDoc(doc: unknown): PmoRecord {
  const d = doc as Record<string, unknown>;
  return {
    id: String(d.name),
    ts_number: String(d.name),
    erp_total_hours: mirrorMoney(d.total_hours),
    erp_total_costing_amount: mirrorMoney(d.total_costing_amount),
    erp_docstatus: (d.docstatus as number | null) ?? null,
    erp_modified: (d.modified as string | null) ?? null,
    erp_amended_from: (d.amended_from as string | null) ?? null,
  };
}
```
**Verify:** `npx vitest run src/lib/adapterSeam/erpnext/bodies/timesheet.test.ts` → **GREEN**; `npm run typecheck`.

### 2.7 — GREEN: `bodies/employee.ts` — `fromDoc` ONLY — **⚑ SPIKE-GATED (§8b/§9)**

**File** `pmo-portal/src/lib/adapterSeam/erpnext/bodies/employee.ts` (new — modelled on `bodies/customer.ts`,
the shipped readOnly party master):

```ts
/**
 * Employee `fromDoc` — FROZEN by spike §8b/§9. READ-ONLY (FR-TSP-093): there is NO `toBody` — PMO never
 * creates/updates an ERP Employee. The kind exists solely for the inbound adopt (ADR-0059 §5's master-data
 * exception). `toBody` throws if ever called, so a mis-registration is loud, never a silent write.
 * ⛔ PII minimization (FR-TSP-095, NFR-TSP-SEC-002): mirror ONLY the fields below. The Employee doctype
 *    carries salary/bank/national-id fields — the adapter READS a wide doctype and must MIRROR a narrow row.
 */
import { AdapterError } from '../../contract.ts';
import type { PmoRecord } from '../../contract.ts';

export function employeeToBody(): never {
  throw new AdapterError('commit-rejected', 'employee-is-read-only'); // FR-TSP-093
}

export function employeeFromDoc(doc: unknown): PmoRecord {
  const d = doc as Record<string, unknown>;
  return {
    id: String(d.name),
    employee_number: String(d.name),
    employee_name: (d.employee_name as string | null) ?? null,
    work_email: (d[/* <SPIKE §8b: company_email | prefered_email> */ 'company_email'] as string | null) ?? null,
    erp_user_id: (d.user_id as string | null) ?? null,     // include IFF §8b confirms the field exists
    erp_status: (d.status as string | null) ?? null,
    erp_docstatus: (d.docstatus as number | null) ?? null,
    erp_modified: (d.modified as string | null) ?? null,
  };
}
```
**File** `pmo-portal/src/lib/adapterSeam/erpnext/doctypeBodies.ts` — append both (additive):
```ts
import { tsToBody, tsFromDoc } from './bodies/timesheet.ts';
import { employeeToBody, employeeFromDoc } from './bodies/employee.ts';
// appended to DOCTYPE_BODIES:
timesheet: { toBody: tsToBody, fromDoc: tsFromDoc },
employee:  { toBody: employeeToBody, fromDoc: employeeFromDoc },
```
**Verify:** `npx vitest run src/lib/adapterSeam/erpnext/bodies` (extend `bodies.test.ts`: `employeeToBody`
**throws** `employee-is-read-only`; `employeeFromDoc` mirrors §8b's fields and **nothing else** — assert the
returned key set exactly, proving no salary/bank field leaks); `npx vitest run src/lib/adapterSeam/erpnext/doctypeBodies.test.ts`.

### 2.8 — GREEN: `moneyShape.test.ts` extended for hours (OWNS AC-TSP-034)

**File** `pmo-portal/src/lib/adapterSeam/erpnext/moneyShape.test.ts` (extend). Cents-bearing hours (`'7.25'`,
`'8.35'`, `'0.05'`) round-trip through `tsFromDoc`→`mirrorMoney`→numeric **exactly**, no float artifact; ERP
`total_hours` is the oracle (never a sum of entries); an absent optional → `NULL` not `0`; an
over-`numeric(9,2)` value → `commit-rejected`, never truncated. GREEN via the shipped `mirrorMoney`.
**Verify:** `npx vitest run src/lib/adapterSeam/erpnext/moneyShape.test.ts`.

### 2.9 — Slice-2 gate

**Verify:** `cd pmo-portal && npm run verify` green. **AC-TSP-021, AC-TSP-032, AC-TSP-033, AC-TSP-034 owned.**
PR to `dev`.

---

## Slice 3 — ⭐ The Employee-adopt sub-domain (the OQ-TSP-3 ruling)

> **⚑ Gate:** needs an **OQ-TSP-10 ruling** (this slice builds the recommended **(C) adopt-then-confirm**;
> (A)/(B) change task 3.5's probe + 3.6's states only — the table, the adopt, and the fail-closed push are
> identical in all three) **and** spike §8b/§9 for the field names.
> **⚑ Reuse, never re-invent (FR-TSP-090):** every task below extends the **shipped party-adopt path**
> (`erpnextFeedDeps.mintMirror`'s `domain === 'companies'` branch is the template; `external_refs`,
> `mirrorStatusPatch`, the `erp_modified` guard, the webhook + modified-poll sweep are all reused as-is).
> **No new adopt function, no new feed engine, no new sweep, no new refs table.**

### 3.1 — RED: pgTAP `supabase/tests/0111_erp_employees_rls.test.sql` (OWNS AC-TSP-093)

**File** (new). Seeds org A (flipped on `timesheets`) + org B; in A — Admin, `Finance` F, users U and W with
adopted+confirmed Employees, an unrelated `Engineer` X. Asserts:
- **Machine-only:** user-JWT `INSERT`/`UPDATE`/`DELETE` on `erp_employees` → denied (default-deny); a
  service-role `UPDATE ... SET employee_name='…', erp_modified='…'` → **succeeds**.
- **PII boundary (FR-TSP-095, NFR-TSP-SEC-002):** Admin reads all rows; F reads all rows; **U reads exactly
  1** (its own, `profile_id = auth.uid()`); **X reads 0** (**unlike `companies`, this table is NOT org-wide
  readable** — assert this explicitly, it is the security delta); a user in **org B** reads **0**.
- **Constraints:** the partial unique index on `(org_id, profile_id) where link_state='confirmed'` exists
  (`pg_indexes`); `link_state` CHECK rejects `'bogus'`; the four `erp_*` columns exist +
  `link_state`/`profile_id`/`link_proposed_reason`/`linked_by`/`linked_at`/`work_email`/`erp_status`.
**Verify:** `scripts/with-db-lock.sh supabase test db -- -f 0111_erp_employees_rls` → **RED**.

### 3.2 — RED: pgTAP `supabase/tests/0114_erp_employee_link.test.sql` (OWNS AC-TSP-091)

**File** (new). The OQ-TSP-10(C) link-state machine, DB-side:
- a **non-Admin** (`Finance`, `Project Manager`, the subject themselves) calling
  `confirm_erp_employee_link(emp, U)` → **`42501`** (Admin-only);
- an **Admin** → `link_state='confirmed'`, `profile_id=U`, **`linked_by` = the Admin's `auth.uid()`** and
  `linked_at` **server-stamped** — assert they are **not** payload-controllable (FR-TSP-014: pass a bogus
  `linked_by`-shaped argument and prove the function has no such parameter);
- an Admin confirming a **second** Employee for the **same** `profile_id` → **`23505`** (the partial unique
  index — OQ-TSP-10(ii) drafted);
- an Admin in **org B** confirming org A's Employee → **`42501`** (the internal org re-assertion — DEFINER
  bypasses RLS, the ADR-0011/0012 lesson);
- a confirm writes exactly one **`audit_events`** row naming the actor + the link;
- a `proposed` row is **not** authoritative: `erp_employees` filtered by `link_state='confirmed'` for U
  returns **0 rows** while the row is `proposed`.
**Verify:** `scripts/with-db-lock.sh supabase test db -- -f 0114_erp_employee_link` → **RED**.

### 3.3 — GREEN: migration `0110_erp_employees.sql`

**File** `supabase/migrations/0110_erp_employees.sql` (new):

```sql
-- 0110_erp_employees.sql (ERPNext P3b, Slice 3 — the OQ-TSP-3 owner ruling: the Employee-ADOPT sub-domain,
-- chosen explicitly OVER a binding-config employee_map).
--
-- The adopt target for ERP `Employee` masters, minted by the SHIPPED party-adopt path
-- (_shared/erpnextFeedDeps.ts mintMirror — the same function that mints a `companies` row for a natively
-- created Supplier/Customer). Licensed by ADR-0059 §5's MASTER-DATA EXCEPTION: the never-adopt rule governs
-- a Posture-B domain's PROCESS documents (Timesheet), not the masters they reference — PMO is not the
-- Employee's SoT and no PMO process is bypassed by mirroring one.
--
-- ⛔ This table NEVER becomes a PMO identity: no profiles row, no auth user, no login is ever created from
--    an ERP Employee (FR-TSP-093). `profile_id` LINKS to an existing PMO user; it never creates one.
-- ⛔ PII (FR-TSP-095, NFR-TSP-SEC-002): employee names + work emails. Deliberately NOT org-wide readable
--    (unlike `companies`) — privileged roles + the subject only. Mirror ONLY the columns below; the
--    Employee doctype also carries salary/bank/national-id — never read them into PMO.
--
-- Reversibility: `supabase db reset`. Manual: drop table if exists public.erp_employees;

create table if not exists public.erp_employees (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null default '00000000-0000-0000-0000-000000000001',
  employee_number text,                      -- ERP `name` (display; the mapping lives in external_refs)
  employee_name   text,
  work_email      text,                      -- the spike-§8b-confirmed work-email field; the OQ-TSP-10(C)
                                             -- match CANDIDATE — never authoritative by itself
  erp_user_id     text,                      -- ERP `user_id` (Frappe User link), if §8b confirms it exists
  erp_status      text,                      -- ERP `status` ('Active'/'Left'/…) — surfaced, NOT a push gate
  -- ── the link (OQ-TSP-10(C) adopt-then-confirm) — written ONLY by confirm_erp_employee_link (0111) ──
  profile_id      uuid references public.profiles(id),
  link_state      text not null default 'unlinked'
    check (link_state in ('unlinked','proposed','confirmed','rejected')),
  link_proposed_reason text,                 -- e.g. 'work-email-exact-match' (auditability)
  linked_by       uuid references public.profiles(id),   -- server-resolved (FR-TSP-014), never a payload
  linked_at       timestamptz,
  -- ── feed columns, DAY ONE (the 0103 lesson) ──
  erp_docstatus    smallint,
  erp_modified     text,                     -- the per-row source-mod cursor — WITHOUT it the staleness
                                             -- guard never engages (the exact party-adopt bug found live
                                             -- 2026-07-14; inherit the lesson, do not re-learn it)
  erp_amended_from text,
  erp_cancelled_at timestamptz,
  created_at    timestamptz not null default now()
);

-- One PMO user has at most ONE confirmed Employee (OQ-TSP-10(ii) drafted — owner ruling pending).
create unique index if not exists erp_employees_org_profile_confirmed_uidx
  on public.erp_employees (org_id, profile_id) where link_state = 'confirmed';
create index if not exists erp_employees_org_link_state_idx on public.erp_employees (org_id, link_state);
create index if not exists erp_employees_org_work_email_idx on public.erp_employees (org_id, lower(work_email));

create trigger erp_employees_stamp_org_id
  before insert on public.erp_employees for each row execute function public.stamp_org_id();

alter table public.erp_employees enable row level security;

-- SELECT: privileged roles OR the subject themselves. NO INSERT/UPDATE/DELETE policy for `authenticated`
-- ⇒ default-deny (FR-TSP-170): the feed writes as service_role; the link is the 0111 Admin-only RPC.
create policy erp_employees_select on public.erp_employees for select
  using (org_id = auth_org_id()
         and (auth_role() in ('Admin','Executive','Finance','Project Manager')
              or profile_id = auth.uid()));
```
**Verify:** `scripts/with-db-lock.sh supabase db reset`; then 3.1 → **GREEN**.

### 3.4 — GREEN: migration `0111_confirm_erp_employee_link.sql`

**File** `supabase/migrations/0111_confirm_erp_employee_link.sql` (new):

```sql
-- 0111_confirm_erp_employee_link.sql (ERPNext P3b, Slice 3 — OQ-TSP-10(C), OPEN: adopt-then-confirm).
--
-- The ONLY writer of erp_employees' link columns. SECURITY DEFINER (the table is default-deny), therefore
-- it RE-ASSERTS org + Admin INTERNALLY — DEFINER bypasses RLS, so removing either re-assertion would let a
-- non-Admin (or another org) re-point whose cost a week of hours becomes (ADR-0011/0012 lesson).
--
-- WHY A HUMAN CONFIRM (the security property, OQ-TSP-10): the adopt PROPOSES a link from an ERP-side email
-- match, but ERP-side email is DESK-EDITABLE — auto-linking would let anyone with Desk access silently
-- re-point a PMO user's cost identity. Only a confirmed link authorizes a push (FR-TSP-051); an ERP-side
-- email change on a CONFIRMED row surfaces action-required and the confirmed link STANDS (never re-pointed).
create or replace function confirm_erp_employee_link(p_erp_employee_id uuid, p_profile_id uuid)
  returns void language plpgsql security definer set search_path = public as $$
declare
  v_org uuid; v_actor uuid := auth.uid(); v_target_org uuid;
begin
  if v_actor is null then raise exception 'not authenticated' using errcode = '42501'; end if;

  select e.org_id into v_org from public.erp_employees e where e.id = p_erp_employee_id for update;
  if v_org is null then raise exception 'employee not found' using errcode = 'P0002'; end if;

  -- org + Admin re-assertion — MUST STAY (definer bypasses RLS).
  if v_org is distinct from auth_org_id() or auth_role() is distinct from 'Admin' then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  -- The PMO user must be in the SAME org (never link across tenants).
  select p.org_id into v_target_org from public.profiles p where p.id = p_profile_id;
  if v_target_org is distinct from v_org then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  -- linked_by/linked_at are SERVER-RESOLVED (FR-TSP-014) — this function takes no such parameter, so a
  -- caller cannot forge the witness. The partial unique index rejects a second confirm for p_profile_id
  -- with 23505 (OQ-TSP-10(ii) drafted).
  update public.erp_employees
     set profile_id = p_profile_id,
         link_state = 'confirmed',
         linked_by  = v_actor,
         linked_at  = now()
   where id = p_erp_employee_id;

  insert into public.audit_events (org_id, actor_id, action, entity, entity_id, detail)
  values (v_org, v_actor, 'confirm_erp_employee_link', 'erp_employees', p_erp_employee_id,
          jsonb_build_object('profile_id', p_profile_id));
end; $$;
revoke all     on function confirm_erp_employee_link(uuid, uuid) from public;
grant  execute on function confirm_erp_employee_link(uuid, uuid) to   authenticated;
revoke execute on function confirm_erp_employee_link(uuid, uuid) from anon;
```
> **Builder note:** verify `audit_events`' actual column names against `0076_audit_events.sql` before
> writing the insert (`grep -n "create table" -A 15 supabase/migrations/0076_audit_events.sql`) and match
> them exactly — do not assume the shape above.

**Verify:** `scripts/with-db-lock.sh supabase db reset`; then 3.2 → **GREEN**.

### 3.5 — RED: the Employee adopt in the feed (OWNS AC-TSP-090 + AC-TSP-094) — **⚑ SPIKE-GATED**

**File** `supabase/functions/_shared/erpnextFeedDeps.test.ts` (extend — **RED first**):
- an inbound `Employee` event with **no** mapping mints **one** `erp_employees` row with the **full**
  canonical **and a non-null `erp_modified`** (the party-adopt lesson — assert `erp_modified` explicitly:
  its absence is the exact bug found live 2026-07-14), and records
  `external_refs(org,'timesheets','Employee:<name>')`;
- **no** `profiles` insert occurs (assert the mocked client's `from()` log has no `profiles` write) —
  FR-TSP-093;
- a **re-apply** is idempotent (no duplicate row; `link_state` unchanged);
- an **older-`modified`** event is a **no-op** (AC-TSP-042 Employee half);
- `erp_status` flipping to `'Left'` mirrors + leaves `link_state='confirmed'` intact (**AC-TSP-094**).
**Verify:** `deno test supabase/functions/_shared/erpnextFeedDeps.test.ts` → **RED**.

### 3.6 — GREEN: the `mintMirror` `'timesheets'` branch + the propose-never-confirm probe (FR-TSP-090..092)

**File** `supabase/functions/_shared/erpnextFeedDeps.ts` — add a **sibling branch** to the shipped
`domain === 'companies'` / `domain === 'revenue'` branches inside `mintMirror` (**do not fork the function,
do not add a second adopt path**):

```ts
// P3b — the Employee MASTER adopt (OQ-TSP-3 owner ruling). ADR-0059 §5's master-data exception: the
// never-adopt rule governs this domain's PROCESS documents (Timesheet — see the `timesheet` guard below),
// NOT the masters they reference. This is the SAME mint path the Supplier/Customer party adopt uses.
if (domain === 'timesheets' && kind === 'employee') {
  const id = crypto.randomUUID();
  // Mint the FULL canonical + the erp_modified stamp — never a half-empty name-only row. (The party adopt
  // shipped that bug: the adopted row was half-empty and the per-row staleness guard never engaged, found
  // live 2026-07-14. Inherit the lesson.)
  const { error } = await serviceClient.from('erp_employees').insert({
    id,
    org_id: orgId,
    employee_number: canonical.employee_number ?? canonical.id,
    employee_name: (canonical.employee_name as string | null | undefined) ?? null,
    work_email: (canonical.work_email as string | null | undefined) ?? null,
    erp_user_id: (canonical.erp_user_id as string | null | undefined) ?? null,
    erp_status: (canonical.erp_status as string | null | undefined) ?? null,
    link_state: 'unlinked',                       // NEVER auto-confirmed (FR-TSP-092)
    erp_docstatus: (canonical.erp_docstatus as number | null | undefined) ?? null,
    erp_modified: new Date(sourceModMs).toISOString(),
  });
  if (error) throw new AppError(error.message, error.code);
  // OQ-TSP-10(C): PROPOSE only, on a UNIQUE exact case-insensitive work-email match. Zero/multiple hits →
  // stay 'unlinked' + surface action-required (the party adopt's ambiguous-match precedent: SURFACE, never
  // auto-resolve). A proposal does NOT authorize a push — only an Admin confirm does (0111).
  await proposeEmployeeLink(serviceClient, orgId, id, canonical.work_email as string | null);
  return id;
}
```
plus a new local helper in the same file:
```ts
/** OQ-TSP-10(C) FR-TSP-092: propose, never confirm. Zero/multi match ⇒ unlinked + action-required. */
async function proposeEmployeeLink(
  serviceClient: SupabaseClient, orgId: string, erpEmployeeId: string, workEmail: string | null,
): Promise<void> {
  if (!workEmail) { await surfaceActionRequired(serviceClient, orgId, 'employee-link-no-email', { erpEmployeeId }); return; }
  const { data: matches } = await serviceClient.from('profiles')
    .select('id').eq('org_id', orgId).ilike('email', workEmail);   // exact, case-insensitive (no wildcards)
  const rows = (matches as Array<{ id: string }> | null) ?? [];
  if (rows.length !== 1) {
    await surfaceActionRequired(serviceClient, orgId,
      rows.length === 0 ? 'employee-link-no-match' : 'employee-link-ambiguous', { erpEmployeeId, workEmail });
    return;   // stays link_state='unlinked', profile_id=null — NEVER auto-resolve
  }
  await serviceClient.from('erp_employees')
    .update({ link_state: 'proposed', profile_id: rows[0].id, link_proposed_reason: 'work-email-exact-match' })
    .eq('org_id', orgId).eq('id', erpEmployeeId).eq('link_state', 'unlinked');   // never touch proposed/confirmed/rejected
}
```
**⚑ The `updateMirror` path must NOT re-point a confirmed link** (FR-TSP-092.4): an Employee update stamps
the mirrored fields + `erp_modified` and, **if `link_state='confirmed'` and `work_email` changed**, surfaces
`employee-link-email-changed` **without** altering `profile_id`/`link_state`.
> **Builder note:** confirm how PMO reads a user's email (`profiles.email` vs an `auth.users` join) before
> writing the probe — `grep -n "email" supabase/migrations/0001_init_schema.sql` + `0045_user_views.sql`.
> If `profiles` carries no email, the probe reads the shipped user view, **not** `auth.users` directly.

**Verify:** `deno test supabase/functions/_shared/erpnextFeedDeps.test.ts` → **GREEN**;
`deno check supabase/functions/_shared/erpnextFeedDeps.ts`.

### 3.7 — GREEN: `feedKinds.ts` entries for both kinds (FR-TSP-080; additive)

**File** `pmo-portal/src/lib/adapterSeam/erpnext/feedKinds.ts`:
```ts
// P3b — Timesheets domain. `Timesheet` and `Employee` are UNIQUE doctypes → kindFromDoctype suffices; NO
// payment_type-style disambiguation is needed (contrast FR-SAR-081 / Luna's PE sweep blocker).
KIND_DOMAIN:       timesheet: 'timesheets', employee: 'timesheets',
KIND_MIRROR_TABLE: timesheet: 'timesheet_erp_mirror', employee: 'erp_employees',
// externalIdForKind: 'Employee:<name>' — the SAME prefix convention as 'Supplier:'/'Customer:' (FR-TSP-091),
// so the encoding is deterministic and collision-free within the domain.
if (kind === 'employee') return `Employee:${erpName}`;
```
Widen `KIND_DOMAIN`'s value type to `'companies' | 'procurement' | 'revenue' | 'timesheets'`.
**Verify:** `npx vitest run src/lib/adapterSeam/erpnext/feedKinds.test.ts` (extend:
`kindFromDoctype('Timesheet') === 'timesheet'`; `kindFromDoctype('Employee') === 'employee'`;
`KIND_DOMAIN.employee === 'timesheets'` — **assert it is NOT `'companies'`**, FR-TSP-094;
`externalIdForKind('employee','HR-EMP-00001') === 'Employee:HR-EMP-00001'`; the PE branch untouched);
`npm run typecheck`.

### 3.8 — RED+GREEN: the Employee sweep cursor, gated on the `timesheets` flip (OWNS AC-TSP-003)

**File** `supabase/functions/erpnext-sweep/index.ts` — add `{ kind: 'employee', doctype: 'Employee' }` to
`SWEEP_DOCTYPES`, **gated on the org owning `timesheets`**:

```ts
// P3b FR-TSP-094 / AC-TSP-003 — THE REGRESSION GUARD. `companies` is ALREADY FLIPPED for existing orgs;
// sweeping `Employee` for them would add doctype calls + rows they never asked for = an FR-ENA-004
// violation. The per-doctype pass therefore runs only when the org owns the kind's OWN domain
// (KIND_DOMAIN[kind]) — which for `employee` is `timesheets`, deliberately NOT `companies`.
// The cursor starts at zero ⇒ the FIRST tick after the flip BACKFILLS every existing Employee (FR-TSP-091).
// There is no separate import job and none is needed.
if (!(await orgOwnsDomain(serviceClient, org.orgId, KIND_DOMAIN[kind]))) continue;
```
**Verify:** `deno test supabase/functions/erpnext-sweep/index.test.ts` (extend — **RED first**: an org owning
`companies` but **not** `timesheets` issues **zero** `Employee` doctype calls and its `companies` sweep
behavior is byte-for-byte; an org owning `timesheets` sweeps `Employee` and its first tick adopts the
pre-existing rows). Also extend `erpnext-webhook/index.test.ts`: an `Employee` webhook for a
non-`timesheets` org ack-and-skips with **no** side effect.

### 3.9 — Slice-3 gate

**Verify:** `cd pmo-portal && npm run verify`; `scripts/with-db-lock.sh supabase test db`;
`deno check supabase/functions/_shared/erpnextFeedDeps.ts supabase/functions/erpnext-sweep/index.ts`;
`deno test supabase/functions/`. **AC-TSP-003, AC-TSP-090, AC-TSP-091, AC-TSP-093, AC-TSP-094 owned.**
**Security-auditor review is MANDATORY on this slice** (a new PII table + a new identity-linking authority —
§12 R-EMPLOYEE-IDENTITY / R-EMPLOYEE-PII). PR to `dev`.

---

## Slice 4 — Dispatch wiring: the regression net FIRST, then the fail-closed resolver + writer

### 4.1 — RED: `repositories/timesheetPush.external.test.ts` (OWNS AC-TSP-001, the regression net — FIRST)

**File** (new — mirrors `revenue.external.test.ts`'s discipline). Asserts:
- On a **cold/absent** ownership map **and** on an org not owning `timesheets`: approving a sheet calls
  `transition_timesheet` and **`dispatchSpy` is NOT called** — **and the approval still resolves
  successfully** (FR-TSP-005: unlike `revenue`, the cold path is a benign no-op, **never** a
  `*-not-enabled` rejection — a wrong reject here would break approval for **every existing client**);
- On a flipped org: `pushApproved(id)` dispatches `('timesheets','create',{id, erp_doc_kind:'timesheet'},
  key)` where `key === 'ts:<id>:<approved_at>'` (**deterministic** — assert the exact string **and** that two
  calls produce the **same** key, unlike `freshIdempotencyKey()`);
- **A push rejection does NOT fail the approval** (FR-TSP-006): with `dispatchSpy` rejecting
  `external-unreachable`, the approve flow still resolves and the sheet is `Approved`;
- P2/P3a writes stay byte-for-byte (re-assert AC-ENA-001/AC-SAR-001).
**Verify:** `npx vitest run src/lib/repositories/timesheetPush.external.test.ts` → **RED**.

### 4.2 — GREEN: `resolveTimesheetRefs` in `dispatchFactory.ts` (FR-TSP-050..054; OWNS AC-TSP-030)

**File** `pmo-portal/src/lib/adapterSeam/erpnext/dispatchFactory.ts` — add a resolver beside
`resolveRevenueRefs` (additive; **do not** edit the revenue resolver):

```ts
/** Resolve timesheet-domain refs. EVERY resolution is FAIL-CLOSED and happens BEFORE the outbox claim and
 *  BEFORE the ERP POST (FR-TSP-050 — Luna BLOCK-6: P3a validated cross-org AFTER the external write, which
 *  can leave committed money with no PMO row; the P3b twin is committed HOURS with no PMO record).
 *  A miss THROWS a classified AppError — it is NEVER silently omitted from the body (Luna SF9). */
async function resolveTimesheetRefs(
  deps: ErpDispatchFactoryDeps,
  binding: ExternalOrgBindingRow,
): Promise<{ refs: Record<string, string | null> }> {
  const refs: Record<string, string | null> = {};
  const record = deps.command.record as {
    erp_doc_kind?: string; user_id?: string;
    entries?: Array<{ project_id: string; entry_date: string; hours: string; project_org_id?: string }>;
  };
  if (record.erp_doc_kind !== 'timesheet') return { refs };

  const cfg = binding.config ?? {};

  // (1) employee — via the CONFIRMED adopt link ONLY (FR-TSP-051, the OQ-TSP-3 ruling). NEVER auto-create
  //     an HR master; NEVER a shared default (it would mis-attribute cost). 'proposed' is NOT authoritative.
  const { data: emp } = await deps.serviceClient
    .from('erp_employees')
    .select('id, employee_number, org_id')
    .eq('org_id', deps.orgId)                       // (4) same-org, asserted in the query itself
    .eq('profile_id', record.user_id ?? '')
    .eq('link_state', 'confirmed')                  // the ONLY state that authorizes a push
    .maybeSingle();
  if (!emp) {
    throw new AppError(
      `no confirmed erp_employees link for user '${record.user_id}' — an Admin must confirm it`,
      'employee-unlinked',
    );
  }
  // The ERP target comes from external_refs, never from a mirrored display column (FR-TSP-013 discipline).
  const empExternalId = await resolveExternalRef(
    deps.serviceClient as unknown as ExternalRefsLookupClient, deps.orgId, 'timesheets', String(emp.id),
  );
  if (!empExternalId) throw new AppError(`employee '${emp.id}' has no external_refs mapping`, 'employee-unlinked');
  refs.employee = empExternalId.startsWith('Employee:') ? empExternalId.slice('Employee:'.length) : empExternalId;

  // (2) activity type — fail-closed IFF the spike proved it mandatory (FR-TSP-053).
  if (SPIKE_ACTIVITY_TYPE_MANDATORY && !cfg.default_activity_type) {
    throw new AppError('binding config has no default_activity_type', 'activity-type-unconfigured');
  }

  // (3) per-entry project — fail-closed. An unmapped project is a REJECT, never an omitted dimension
  //     (Luna SF9: "PMO shows project-attributed cost while ERP GL lacks the project dimension").
  const projectMap = (cfg.project_map as Record<string, string> | undefined) ?? {};
  for (const e of record.entries ?? []) {
    // (4) same-org pre-flight BEFORE the external write (FR-TSP-054). project_org_id comes from
    //     approved_timesheet_for_push (0109) — server truth, never the payload.
    if (e.project_org_id && e.project_org_id !== deps.orgId) {
      throw new AppError(`project '${e.project_id}' belongs to another org`, 'cross-org-link-rejected');
    }
    const erpProject = projectMap[e.project_id];
    if (!erpProject) throw new AppError(`no project_map entry for project '${e.project_id}'`, 'project-unmapped');
    refs[`project:${e.project_id}`] = erpProject;
  }
  return { refs };
}
```
Wire it into the factory's resolver switch beside the revenue branch (additive).

**Test** `dispatchFactory.test.ts` (extend — **RED before the code**): no `erp_employees` row →
`employee-unlinked`; a `proposed` (not confirmed) link → `employee-unlinked` (**the OQ-TSP-10(C) property**);
an employee row in another org → not found ⇒ `employee-unlinked`; unmapped project → `project-unmapped`;
null `default_activity_type` (when mandatory) → `activity-type-unconfigured`; a foreign `project_org_id` →
`cross-org-link-rejected`; **in every case the ERP client HTTP spy has ZERO calls and no outbox row is
claimed** (the ordering assertion — that is the AC, not the message).
**Verify:** `npx vitest run src/lib/adapterSeam/erpnext/dispatchFactory.test.ts` → GREEN.

### 4.3 — GREEN: the `timesheets` read-model writer (FR-TSP-072; additive)

**File** `supabase/functions/adapter-dispatch/readModelWriters.ts` — append a writer + one registry entry
(**no if-chain growth; no other domain's entry edited**):

```ts
/** P3b: the ERP-side state for a PMO-OWNED record. Writes ONLY timesheet_erp_mirror — NEVER `timesheets`,
 *  `timesheet_entries`, or `profiles` (FR-TSP-004(ii)/FR-TSP-072; PMO is SoT there).
 *  `onConflict:'timesheet_id'` makes a re-apply idempotent (the 1:1 seam). ERP totals are mirrored VERBATIM
 *  (ADR-0048), never recomputed. */
const timesheetsWriter: ReadModelWriter = {
  async upsert(ctx, canonical, command) {
    const { error } = await ctx.serviceClient.from('timesheet_erp_mirror').upsert({
      org_id: ctx.orgId,
      timesheet_id: String(command.record.id),
      ts_number: canonical.ts_number ?? null,
      push_state: 'pushed',
      push_error: null,
      pushed_at: new Date().toISOString(),
      // FR-TSP-014 / Luna BLOCK-4 / ADR-0059 §6: the server-resolved witness. Threaded from the gate's DB
      // read via the command record — NEVER a client payload — and it MUST be present on BOTH the sync path
      // and the sweep's finalize path (P3a's audit found the sweep finalizing with a NULL actor, silently
      // no-op'ing SoD). A missing witness is a THROW, not a null write.
      approved_at_pushed: requireApprovedAt(command),
      erp_total_hours: canonical.erp_total_hours ?? null,
      erp_total_costing_amount: canonical.erp_total_costing_amount ?? null,
      erp_docstatus: canonical.erp_docstatus ?? null,
      erp_modified: canonical.erp_modified ?? null,
      erp_amended_from: canonical.erp_amended_from ?? null,
    }, { onConflict: 'timesheet_id' });
    if (error) throw new AppError(`timesheet_erp_mirror upsert failed: ${error.message}`, 'DISPATCH_FAILED');
  },
};

function requireApprovedAt(command: AdapterCommand): string {
  const at = (command.record as { approved_at?: unknown }).approved_at;
  if (typeof at !== 'string' || !at) {
    throw new AppError('approved_at witness missing on timesheet push command', 'DISPATCH_FAILED');
  }
  return at;
}

// …appended to READ_MODEL_WRITERS:
  timesheets: timesheetsWriter,
```
**Verify:** `deno check supabase/functions/adapter-dispatch/index.ts`;
`deno test supabase/functions/adapter-dispatch/readModelWriters.test.ts` (extend: a `timesheets` upsert hits
`timesheet_erp_mirror` with `push_state:'pushed'`; a **missing** `approved_at` **throws** rather than writing
null; the writer **never** touches `timesheets`/`timesheet_entries`/`profiles` — assert on the mocked
client's `from()` call log).

### 4.4 — GREEN: the failure path writes `push_state='failed'` + the classified reason (FR-TSP-085)

**File** `supabase/functions/adapter-dispatch/readModelWriters.ts` — add `markTimesheetPushFailed(ctx,
timesheetId, classifiedError)` (a `timesheet_erp_mirror` upsert with `push_state:'failed'`,
`push_error: <client-safe message>`), called from `index.ts`'s `timesheets` error path for **every**
classified rejection (`employee-unlinked`, `project-unmapped`, `activity-type-unconfigured`,
`cross-org-link-rejected`, `daily-hours-exceed-24`, `external-unreachable`, `commit-rejected`) and
`push_state:'held'` for `command-held`. **ADR-0059 §6: a push failure that is invisible is
indistinguishable from a push that never happened — the sheet is already Approved, so nothing else will ever
surface it.**
**Verify:** `deno test supabase/functions/adapter-dispatch/readModelWriters.test.ts` (extend: each classified
error writes the matching `push_state` + a non-null `push_error`).

### 4.5 — GREEN: `repositories.timesheet.pushApproved` + the deterministic key (FR-TSP-041)

**File** `pmo-portal/src/lib/repositories/index.ts` — extend the shipped `timesheet` repository (additive):

```ts
/** P3b (FR-TSP-041, ADR-0059 §4): the key is DETERMINISTIC, not `freshIdempotencyKey()`. The push has TWO
 *  independent originators (this path and the sweep backstop) with NO shared client state; a random key per
 *  attempt would make the outbox's unique (org, domain, pmo_record_id, idempotency_key) tuple useless for
 *  exactly the collision it exists to prevent — sweep + user racing to TWO ERP Timesheets = a duplicated
 *  week of hours. Including approved_at keeps a future re-approval a DIFFERENT command, not a suppressed one. */
export function timesheetPushKey(timesheetId: string, approvedAt: string): string {
  return `ts:${timesheetId}:${approvedAt}`;
}

// …added to the `timesheet` repository object:
  pushApproved: (timesheetId) =>
    wrap(async () => {
      // FR-TSP-005: cold/absent map ⇒ 'pmo' ⇒ a benign NO-OP. NOT a rejection — the approval already
      // succeeded and there is nothing to fail. (Contrast revenue's `revenue-not-enabled` reject.)
      if (routeDomainWrite('timesheets') !== 'external') return;
      // The gate RPC is server truth for status + authz + entries (FR-TSP-010/011) — the client asserts
      // NOTHING. It throws 42501/P0001 before we ever build a command.
      const gate = await approvedTimesheetForPush(timesheetId);
      await dispatchDomainCommand(
        'timesheets',
        'create',
        { id: timesheetId, erp_doc_kind: 'timesheet',
          user_id: gate.user_id, approved_at: gate.approved_at, entries: gate.entries },
        timesheetPushKey(timesheetId, gate.approved_at),
      );
    }),
```
**File** `pmo-portal/src/lib/db/timesheetPush.ts` (new): `approvedTimesheetForPush(id)` — the typed
`supabase.rpc('approved_timesheet_for_push', { p_timesheet_id: id })` wrapper (`maybeSingle()`, the
`.single()`→406 lesson).
**File** `pmo-portal/src/lib/repositories/types.ts` — add `pushApproved(timesheetId: string): Promise<void>`
to `TimesheetRepository`.
**Verify:** `npx vitest run src/lib/repositories/timesheetPush.external.test.ts` → **GREEN**; `npm run typecheck`.

### 4.6 — Slice-4 gate

**Verify:** `cd pmo-portal && npm run verify` green; `deno check supabase/functions/adapter-dispatch/index.ts`.
**AC-TSP-001, AC-TSP-030 owned.** PR to `dev`.

---

## Slice 5 — The guards (they land BEFORE any push can actually happen)

**Goal:** the Approved gate + the role rule + kind↔domain + read-only-kind + target binding, at the served
boundary. Slice ordering is deliberate: the guards precede slice 8's e2e and slice 7's UI, so no window
exists in which a push can occur unguarded.

### 5.1 — RED+GREEN: `approvalGuard.ts` (the FR-TSP-010 enforcement; proven by AC-TSP-010 e2e)

**File** `supabase/functions/adapter-dispatch/approvalGuard.ts` (new — modelled **exactly** on the shipped
`sodGuard.ts`):

```ts
// P3b FR-TSP-010 — THE OWNER'S RULING, enforced server-side: a timesheet reaches ERP ONLY once Approved.
// Runs under the CALLER's own JWT (the deputy client — never service_role), so auth.uid()/auth_org_id()
// resolve to the real actor inside approved_timesheet_for_push (0109). The command payload is NEVER trusted
// to assert approved-ness: this is a DB RE-READ. (ADR-0059 §3.3; Luna BLOCK-4: "direct dispatch lacks
// ownership/role/kind enforcement… an ERP money write before the mirror writer rejects it". Here there is
// no NULL/absent branch to fall into — the gate either reads 'Approved' from the DB or it throws.)
import type { SupabaseClient } from '@supabase/supabase-js';

export function isTimesheetPush(command: { domain: string; record: { erp_doc_kind?: unknown } }): boolean {
  return command.domain === 'timesheets' && command.record.erp_doc_kind === 'timesheet';
}

export interface ApprovalGuardResult { ok: boolean; status: number; message: string; }

export async function enforceTimesheetApproved(
  callerClient: SupabaseClient,
  timesheetId: string,
): Promise<ApprovalGuardResult> {
  const { error } = await callerClient.rpc('approved_timesheet_for_push', { p_timesheet_id: timesheetId });
  if (!error) return { ok: true, status: 200, message: '' };
  if (error.code === 'P0001') return { ok: false, status: 422, message: 'timesheet-not-approved' };
  if (error.code === '42501') return { ok: false, status: 403, message: 'not-authorized' };
  if (error.code === 'P0002') return { ok: false, status: 404, message: 'not-found' };
  return { ok: false, status: 422, message: 'approval-check-failed' };
}
```
**File** `supabase/functions/adapter-dispatch/index.ts` — insert **immediately after** the shipped
`checkErpnextCommandAuthorization` block and **before** the idempotency/gates/adapter work:
```ts
// ── P3b FR-TSP-010 — the Approved-only gate. BEFORE the outbox, BEFORE adapter selection, BEFORE any ERP
// call. Deputy client (caller's JWT), same posture as the SI SoD gate above.
if (isTimesheetPush(command)) {
  const approved = await enforceTimesheetApproved(callerClient as never, String(command.record.id));
  if (!approved.ok) {
    return new Response(JSON.stringify({ error: 'commit-rejected', message: approved.message }), {
      status: approved.status, headers,
    });
  }
}
```
Also extend `isErpDomain` to include `ERPNEXT_TIMESHEETS_DOMAIN` and add
`[ERPNEXT_TIMESHEETS_DOMAIN]: resolveErpAdapter` to `ADAPTER_REGISTRY`.
**Verify:** `deno test supabase/functions/adapter-dispatch/approvalGuard.test.ts` (new — RED first: each PG
error code maps to its status/message; a non-timesheet command is not applicable; `ok` only on no error);
`deno check supabase/functions/adapter-dispatch/index.ts`.

### 5.2 — GREEN: the per-domain role rule + read-only-kind in `authGuard.ts` (FR-TSP-011/012/093; AC-TSP-013 half)

**File** `supabase/functions/adapter-dispatch/authGuard.ts` — check (b) currently requires
`MONEY_WRITE_ROLES` for **every** erpnext command. Make the role set **per-domain** (additive; the shipped
domains keep the identical set ⇒ byte-for-byte), and reject a write carrying a `readOnly` kind:

```ts
// P3b FR-TSP-011: the money role set is WRONG for `timesheets`. A legitimate approver is often an
// ENGINEER-role LINE MANAGER (profiles.manager_id; 0007 A2/A4) who is not in MONEY_WRITE_ROLES — narrowing
// the push to that set would break the PRIMARY approval path. For `timesheets` the real authorization is
// "approved_by OR privileged", enforced in approved_timesheet_for_push (0109, under the caller's JWT) — the
// DB, not a role list here. So this check is a no-op for `timesheets` and the 0109 RPC is the authority.
// Every other domain keeps MONEY_WRITE_ROLES verbatim.
const DOMAIN_WRITE_ROLES: Record<string, readonly string[] | null> = {
  companies: MONEY_WRITE_ROLES,
  procurement: MONEY_WRITE_ROLES,
  revenue: MONEY_WRITE_ROLES,
  timesheets: null,   // authorized by approved_timesheet_for_push (0109), not by a role list
};
// …in check (b):
const allowed = DOMAIN_WRITE_ROLES[command.domain] ?? MONEY_WRITE_ROLES;   // unknown domain ⇒ strictest
if (allowed && !allowed.includes(role)) { /* …unchanged 403… */ }

// P3b FR-TSP-093 — a readOnly kind can never be a write target. The Employee adopt is INBOUND-ONLY; a
// write command carrying it is rejected here, before the body builder's throw, so it never reaches an
// adapter. (DOCTYPE_REGISTRY is the single source of `readOnly` — do not duplicate the list.)
if (DOCTYPE_REGISTRY[kind as ErpDocKind]?.readOnly && (command.operation as string) !== 'read') {
  return { ok: false, status: 422, message: 'employee-is-read-only' };
}
```
Check (c) (`KIND_DOMAIN`) needs **no** change — it starts working for both new kinds the moment task 3.7
registers them.
**Verify:** `deno test supabase/functions/adapter-dispatch/authGuard.test.ts` (extend — RED first: a
`timesheets` command from an `Engineer` passes check (b) [the 0109 RPC is the authority]; a `revenue` command
from an `Engineer` **still** 403s [byte-for-byte]; `domain:'timesheets'` + `erp_doc_kind:'incoming-payment'`
→ 422; `domain:'procurement'` + `erp_doc_kind:'timesheet'` → 422; a **write** with
`erp_doc_kind:'employee'` → 422 `employee-is-read-only`).

### 5.3 — GREEN: extend `transitionTargetGuard.ts` to `timesheets` (FR-TSP-013; AC-TSP-013 half)

**File** `supabase/functions/adapter-dispatch/transitionTargetGuard.ts` — the shipped guard is hard-coded to
`domain==='revenue' && kind==='sales-invoice' && operation==='transition'`. Generalize via an **allow-list**
(revenue behavior byte-for-byte) **and** close the P3b-specific hole: a `timesheets` command must **never**
carry a client-supplied `externalRecordId` **at all**.

```ts
// P3b FR-TSP-013 (Luna BLOCK-3 generalized): the guard's applicability becomes a table, not an if-chain.
// The revenue/sales-invoice row reproduces the shipped behavior EXACTLY (transition only, mismatch → 422).
// The timesheets row is STRICTER: a timesheet push must never accept ANY client-supplied externalRecordId —
// the ERP target is resolved solely from external_refs(org,'timesheets',record.id). Rejecting its mere
// presence removes the "authorized PMO id, foreign ERP target" class by construction rather than by
// comparison.
const GUARDED: Array<{ domain: string; kind: string; operations: string[]; rejectClientTarget: boolean }> = [
  { domain: 'revenue',    kind: 'sales-invoice', operations: ['transition'], rejectClientTarget: false },
  { domain: 'timesheets', kind: 'timesheet',     operations: ['create', 'transition'], rejectClientTarget: true },
];
```
When `rejectClientTarget` and a non-empty `externalRecordId` is present → `{ok:false, status:422,
message:'externalRecordId is not accepted for this domain'}`. Otherwise the shipped compare-against-
`external_refs` logic runs unchanged.
**Verify:** `deno test supabase/functions/adapter-dispatch/transitionTargetGuard.test.ts` (extend — RED
first: a `timesheets` command **with** `externalRecordId` → 422; **without** → ok; every shipped
revenue/sales-invoice case → **identical** results to before).

### 5.4 — Manual adversarial re-read (the Luna lens, before slice 8 makes it live)

Re-read `adapter-dispatch/index.ts` top-to-bottom and confirm, **in order**: JWT verify → org resolve →
parse → `checkErpnextCommandAuthorization` → **`enforceTimesheetApproved`** → idempotency-key → SoD (revenue)
→ `checkTransitionTargetBinding` → gates → **service client created** → adapter → outbox → ERP. Assert that
**no `serviceClient` is constructed and no ERP client instantiated before the Approved gate**. Write the
finding (pass/fail + line numbers) into the PR description.
**Verify:** `grep -n "createClient(supabaseUrl, serviceRoleKey)\|enforceTimesheetApproved\|resolveErpAdapter" supabase/functions/adapter-dispatch/index.ts`
→ the `enforceTimesheetApproved` line number is **lower** than both others.

### 5.5 — GREEN: `can('push_timesheet' | 'confirm_employee_link', …)` UX gates (ADR-0016 — UX only)

**File** `pmo-portal/src/auth/policy.ts` — add `push_timesheet` (the sheet's `approved_by` or
`Admin`/`Executive`/`Project Manager`/`Finance`) and `confirm_employee_link` (`Admin` only). Docstring:
**"UX only — the enforcement authorities are `approved_timesheet_for_push` (0109) + `approvalGuard.ts` and
`confirm_erp_employee_link` (0111); the FE may be stricter than the DB, never laxer."**
**Verify:** `npx vitest run src/auth/policy.test.ts` (extend).

### 5.6 — Slice-5 gate

**Verify:** `cd pmo-portal && npm run verify` green; `deno check supabase/functions/adapter-dispatch/index.ts`;
`deno test supabase/functions/adapter-dispatch/`. **AC-TSP-013 owned.** PR to `dev`.

---

## Slice 6 — Feed: `timesheet` lifecycle-only, never adopt, desk-cancel reopen + the sweep backstop

### 6.1 — (folded into 3.7) `feedKinds.ts` — verify only

**Verify:** `npx vitest run src/lib/adapterSeam/erpnext/feedKinds.test.ts` (task 3.7's assertions still green).

### 6.2 — RED+GREEN: **never adopt** the process doc (FR-TSP-082; feeds AC-TSP-040)

**File** `supabase/functions/_shared/erpnextFeedDeps.ts` — for `kind === 'timesheet'`, when
`resolvePmoRecordId` returns **null** (a native Desk doc):
```ts
// P3b FR-TSP-082 (ADR-0059 §5) — the SoT-inversion guard. THE DELIBERATE INVERSE OF P3a's FR-SAR-085:
// there, ERP was SoT and adopting a natively-created SI was CORRECT (mint the mirror, project_id=NULL,
// surface it). Here PMO is SoT for entry AND approval, so minting a PMO timesheet from an ERP doc would
// create HOURS THAT NEVER PASSED PMO APPROVAL — exactly what the owner's ruling forbids. So: ack-and-skip,
// mint NOTHING (no timesheets row, no timesheet_entries, no mirror row), surface action-required.
// (This also removes the Luna BLOCK-7 "inbound adoption loses links" class by deleting the path.)
// ⚑ Note the contrast with the `employee` branch above: masters adopt, process documents do not.
if (kind === 'timesheet' && mappedPmoId === null) {
  await surfaceActionRequired(serviceClient, orgId, 'timesheet-native-not-adopted', { erpName, doctype: 'Timesheet' });
  return { applied: false, reason: 'native-timesheet-not-adopted' };   // ack (lossy hint), no side effect
}
```
**Verify:** `deno test supabase/functions/_shared/erpnextFeedDeps.test.ts` (extend — **RED first**: an
unmapped inbound Timesheet mints **zero** rows in `timesheets`/`timesheet_entries`/`timesheet_erp_mirror`
[assert on the mocked client's `from()` log: no `insert`/`upsert` to any of the three], acks, and records one
`action-required`).

### 6.3 — RED+GREEN: lifecycle stamp + desk-cancel reopen (FR-TSP-083/084; feeds AC-TSP-041/042)

**File** `supabase/functions/_shared/erpnextFeedDeps.ts` — for a **mapped** Timesheet: stamp the `erp_*`
columns + `erp_total_hours`/`erp_total_costing_amount` on `timesheet_erp_mirror` **only**, guarded by the
shipped per-row `erp_modified` monotonic comparison (a stale/older event is a **no-op**). On
`docstatus === 2`:
```ts
// P3b FR-TSP-084 — desk cancel. Tombstone + lineage + REOPEN the push state to 'failed' + action-required.
// ⛔ Do NOT re-push: the sweep would instantly re-create what a human just cancelled — an infinite fight
// between the backstop and the accountant. The tombstone (erp_cancelled_at not null) is ALSO the sweep's
// candidate-query EXCLUSION (task 6.4). The PMO `timesheets` row is UNTOUCHED — still Approved; PMO's
// approval is not ERP's to revoke (FR-TSP-004(ii)). Resolution is the OQ-TSP-6 correction path (OPEN).
```
**Verify:** `deno test supabase/functions/_shared/erpnextFeedDeps.test.ts` (extend — RED first: a cancel event
sets `erp_cancelled_at`/`erp_docstatus=2`/`push_state='failed'`, writes lineage `reason='cancelled'`, retains
`external_refs`, and issues **no** write to `timesheets`; an older-`modified` event is a **no-op**).

### 6.4 — RED+GREEN: the sweep backstop (FR-TSP-045; feeds AC-TSP-022)

**File** `supabase/functions/erpnext-sweep/index.ts` — add a `timesheets` push pass beside the shipped
doctype sweep (additive):
```ts
// P3b FR-TSP-045 — the backstop for the SECOND originator (ADR-0059 §4). Candidates: approved sheets with
// no successful, non-tombstoned push. Index-served by timesheet_erp_mirror(org_id, push_state) +
// timesheets(org_id, status) (0001) and BOUNDED per tick (NFR-TSP-PERF-001) so one org's backlog can never
// starve another's.
//   • 'pushed' and 'held' are NEVER re-driven ('held' is ADR-0058-terminal until an operator).
//   • 'pushing' is left to the ADR-0058 stale-claim path — NEVER a naive re-POST.
//   • a tombstoned row (erp_cancelled_at not null) is EXCLUDED — never fight the accountant (FR-TSP-084).
const BATCH = 50;
const { data: candidates } = await serviceClient
  .from('timesheets')
  .select('id, approved_at, approved_by, timesheet_erp_mirror(push_state, erp_cancelled_at)')
  .eq('org_id', org.orgId)
  .eq('status', 'Approved')
  .limit(BATCH);
for (const c of candidates ?? []) {
  const m = c.timesheet_erp_mirror?.[0];
  if (m && (m.push_state === 'pushed' || m.push_state === 'held' || m.push_state === 'pushing')) continue;
  if (m?.erp_cancelled_at) continue;
  // R-SWEEP (the Luna BLOCK-4 replay): the sweep has NO user JWT, so it MUST NOT skip the gate "because
  // it's trusted". It re-asserts it via the SAME 0109 RPC with p_actor => the sheet's approved_by — server
  // truth for status + authz + entries — and uses the SAME deterministic key, so a race with the user's
  // push collides on the outbox 4-tuple (23505) instead of creating a second ERP Timesheet.
  const gate = await serviceClient.rpc('approved_timesheet_for_push',
                                       { p_timesheet_id: c.id, p_actor: c.approved_by });
  if (gate.error) { await markFailed(serviceClient, c.id, gate.error.message); continue; }
  await pushTimesheet(serviceClient, org, gate.data, timesheetPushKey(c.id, c.approved_at));
}
```
**Verify:** `deno test supabase/functions/erpnext-sweep/index.test.ts` (extend — RED first: `pending`/
`failed`/absent are pushed; `pushed`/`held`/`pushing` and tombstoned are **skipped with zero ERP calls**; the
key equals `timesheetPushKey(...)`; the gate RPC is called on **every** candidate).
**Perf:** `scripts/with-db-lock.sh psql … -c "explain analyze select …"` on the candidate query → an **index
scan** on `timesheet_erp_mirror(org_id, push_state)`; paste the plan into the PR.

### 6.5 — GREEN: webhook trust boundary for the new kinds (FR-TSP-081; feeds AC-TSP-042)

**File** `supabase/functions/erpnext-webhook/index.ts` — no code change expected (HMAC verify precedes
routing; `kindFromDoctype` now resolves both). **Prove it, don't assume it.**
**Verify:** `deno test supabase/functions/erpnext-webhook/index.test.ts` (extend: Timesheet **and** Employee
payloads with an absent/invalid signature → `401` **and zero side effects**; valid → routed to
`applyErpFeedEvent` as a hint).

### 6.6 — Slice-6 gate

**Verify:** `cd pmo-portal && npm run verify`; `deno check supabase/functions/erpnext-sweep/index.ts
supabase/functions/erpnext-webhook/index.ts`; `deno test supabase/functions/`. **AC-TSP-042 owned.** PR to `dev`.

---

## Slice 7 — FE: push after (never inside) approval + the operator surfaces

### 7.1 — RED: `useTimesheetApproval` push wiring (FR-TSP-006)

**File** `pmo-portal/src/hooks/useTimesheetApproval.test.ts` (extend — RED first): on approve, the hook calls
`transition_timesheet` **first** and `repositories.timesheet.pushApproved` **after** it resolves (assert call
**order**, not just calls); when `pushApproved` **rejects**, the approve mutation **still resolves
successfully**, the sheet shows `Approved`, and **no** error toast blocks the user (FR-TSP-006 — PMO's SoT
never depends on ERP liveness); when the org is not flipped, `pushApproved` is a no-op (no dispatch).
**Verify:** `npx vitest run src/hooks/useTimesheetApproval.test.ts` → **RED**.

### 7.2 — GREEN: wire the push into the approve path (FR-TSP-006)

**File** `pmo-portal/src/hooks/useTimesheetApproval.ts` — after the transition mutation succeeds:
```ts
// P3b FR-TSP-006 (ADR-0059 §3.2): the push is a CONSEQUENCE of approval, never a step inside it. It runs
// AFTER the RPC commits, in its own try/catch, and its failure NEVER fails/rolls back/retry-loops the
// approval: PMO is the SoT for approval and must not depend on ERP liveness. The failure is durable in
// timesheet_erp_mirror.push_state='failed' (task 4.4) + surfaced to Admins (7.4), and the sweep re-drives
// it (6.4). An approval that "fails" because ERP is down would be a regression for every flipped client.
try { await repositories.timesheet.pushApproved(timesheetId); }
catch (err) { logPushFailure(timesheetId, err); }   // durable state is written server-side; never rethrow
```
**Verify:** `npx vitest run src/hooks/useTimesheetApproval.test.ts` → **GREEN**.

### 7.3 — RED: the operator surfaces (OWNS AC-TSP-051)

**File** `pmo-portal/pages/Approvals.test.tsx` (extend — RED first): given a flipped org and a sheet with
`push_state='failed'` + `push_error='employee-unlinked'`, an **Admin** sees the failure + its reason + a
**Retry** affordance (`can('push_timesheet')`); a non-privileged user does not; given an `erp_employees` row
in `link_state='proposed'`, an Admin sees a **Confirm** affordance (`can('confirm_employee_link')`) naming
the proposed PMO user + the match reason, and a non-Admin does not; given **no** mirror row at all (ERP
read-back absent), the page **renders fully from PMO data** with the ERP badge simply absent — never an error
state, never a blocked render (FR-TSP-173).
**Verify:** `npx vitest run pages/Approvals.test.tsx` → **RED**.

### 7.4 — GREEN: the push-state badge + retry + the Employee-link Confirm (FR-TSP-085, FR-TSP-173)

**Files** `pmo-portal/pages/Approvals.tsx` + `src/components/timesheets/PushStateBadge.tsx` +
`src/components/timesheets/EmployeeLinkConfirm.tsx` (new): read `timesheet_erp_mirror` + `erp_employees`
(RLS-scoped) via the repository; render `pushed`/`failed`/`held`/`pending` and the link state with **strict
`DESIGN.md` tokens** (32px controls; no ad-hoc colour); Retry calls `repositories.timesheet.pushApproved`,
Confirm calls the `confirm_erp_employee_link` RPC — both gated by `<CanWrite>`/`can()` and confirmed with
`ConfirmDialog` (the link confirm is an identity decision — it deserves the confirm step); classify errors
with the shipped `classifyMutationError`. **The ERP badge is supplementary — its absence must never gate the
page's render.**
**Verify:** `npx vitest run pages/Approvals.test.tsx pages/Timesheets.test.tsx` → **GREEN**;
`npx vitest run src/components/timesheets/` (new — the four push states + the four link states + the
`axe-core` a11y gate).

### 7.5 — GREEN: the repository reads (ADR-0017 seam)

**File** `pmo-portal/src/lib/repositories/index.ts` + `src/lib/db/timesheetPush.ts`: `getPushState(
timesheetId)`, `listProposedEmployeeLinks()`, `confirmEmployeeLink(erpEmployeeId, profileId)` — typed
wrappers; hooks consume `repositories`, never the DAL directly, and **never** thread `org_id`.
**Verify:** `npx vitest run src/lib/repositories/index.test.ts` (extend); `npm run typecheck`.

### 7.6 — Slice-7 gate

**Verify:** `cd pmo-portal && npm run verify` green. **AC-TSP-051 owned.** PR to `dev`. **Then:** a rendered
Discover pass on the Approvals surface per ADR-0030 (`docs/qa-portfolio.md`) — every finding graduates to a
test.

---

## Slice 8 — Served-fn serial e2e lane (**⚑ SPIKE-GATED**)

**Goal:** prove the owner's ruling at the **real** boundary. Every spec is `@e2e-isolation: serial`, uses the
`EDGE_JWT_ISSUER` lane + `ERPNEXT_SITE_URL=host.docker.internal`, runs under `scripts/with-db-lock.sh` +
`scripts/with-erpnext-lock.sh`, and exercises the **real served `adapter-dispatch`** + the shipped
server-side fault seams. **`page.route` is prohibited** (NFR-TSP-TEST-001).

### 8.1 — `e2e/serial/AC-TSP-010-approved-only-gate.spec.ts` (OWNS AC-TSP-010) — **the headline test**

The owner's ruling, adversarially. For sheets in `Draft`, `Submitted`, `Rejected`: POST a hand-crafted command
**directly** to the served `adapter-dispatch` (bypassing the FE entirely) — including one whose payload
asserts `status:'Approved'` and one carrying a forged `approved_by` — and assert **each**: `422`
`timesheet-not-approved`; `select count(*) from external_command_outbox where domain='timesheets'` is **0**;
`select count(*) from timesheet_erp_mirror` is **0**; and the ERP bench's Timesheet count is **unchanged**
(`GET /api/resource/Timesheet?limit_page_length=0` before/after — **the ERP is the oracle, not PMO state**).
**Verify:** `cd pmo-portal && scripts/with-db-lock.sh scripts/with-erpnext-lock.sh npx playwright test e2e/serial/AC-TSP-010-approved-only-gate.spec.ts`

### 8.2 — `e2e/serial/AC-TSP-011-timesheet-push.spec.ts` (OWNS AC-TSP-011)

The happy path through the **real UI**: adopt + **confirm** the author's Employee link, seed `project_map`;
user U fills a week across 2 projects × 2 days; U submits; **manager M approves in the app**; assert the ERP
`Timesheet` exists, `docstatus === 1`, its `time_logs` carry the resolved employee/projects and
non-overlapping synthetic `from_time`s **and no billing fields**; `external_refs('timesheets')` maps it;
`timesheet_erp_mirror` is `push_state='pushed'` with `ts_number` + a mirrored `erp_total_hours` equal to
ERP's `total_hours` (**not** to PMO's sum — the oracle).
**Verify:** `… npx playwright test e2e/serial/AC-TSP-011-timesheet-push.spec.ts`

### 8.3 — `e2e/serial/AC-TSP-020-push-idempotency.spec.ts` (OWNS AC-TSP-020)

Arm the shipped `after-commit-before-mirror` fault seam; approve (ERP commits, PMO fails before finalizing);
run **both** a sweep tick and a user re-push. Assert **exactly one** ERP Timesheet exists for the sheet (count
via the ERP REST API — the ERP is the oracle), the second attempt hit `23505` **or** reconciled via the outbox
`committed` fenced finalize, and the mirror is `push_state='pushed'` with the winner's `ts_number`.
**Verify:** `… npx playwright test e2e/serial/AC-TSP-020-push-idempotency.spec.ts`

### 8.4 — `e2e/serial/AC-TSP-022-sweep-backstop.spec.ts` (OWNS AC-TSP-022)

Seed approved sheets across `push_state` ∈ {absent, `pending`, `failed`, `pushed`, `held`}; tick the sweep;
assert the first three become `pushed`, `pushed`/`held` are untouched (**zero** ERP calls — assert the ERP
count delta), and the gate RPC ran for every candidate. Then flip one sheet to `Submitted` behind the sweep's
back and tick again → **no** push (the sweep re-asserts the gate, R-SWEEP).
**Verify:** `… npx playwright test e2e/serial/AC-TSP-022-sweep-backstop.spec.ts`

### 8.5 — `e2e/serial/AC-TSP-031-cross-org.spec.ts` (OWNS AC-TSP-031)

Two orgs; org B's caller dispatches a push for org A's approved sheet; a sheet whose entry references another
org's project; and a sheet whose author's confirmed Employee row belongs to another org. Assert `422`
`cross-org-link-rejected` (or `employee-unlinked` for the third) **and zero ERP calls** — the rejection
precedes the write (Luna BLOCK-6).
**Verify:** `… npx playwright test e2e/serial/AC-TSP-031-cross-org.spec.ts`

### 8.6 — `e2e/serial/AC-TSP-040-native-timesheet-not-adopted.spec.ts` (OWNS AC-TSP-040)

Create a `Timesheet` **directly** in ERPNext (REST, no PMO command); fire the webhook + tick the sweep. Assert
PMO's `timesheets`, `timesheet_entries`, and `timesheet_erp_mirror` counts are **all unchanged**, the webhook
acked `200`, and one `action-required` names the ERP doc. *(Contrast: the same tick **does** adopt a native
`Employee` — 8.8 — proving the master-data exception is scoped, not a loophole.)*
**Verify:** `… npx playwright test e2e/serial/AC-TSP-040-native-timesheet-not-adopted.spec.ts`

### 8.7 — `e2e/serial/AC-TSP-041-desk-cancel-tombstone.spec.ts` (OWNS AC-TSP-041)

Push a sheet; cancel it in ERP (`PUT {docstatus:2}`); apply the feed; **tick the sweep twice**. Assert the
mirror is tombstoned + lineage written + `external_refs` retained + `push_state='failed'` +
`action-required`; the PMO `timesheets` row is **still `Approved` and byte-identical**; and the sweep issued
**zero** re-pushes on **both** ticks (the ERP Timesheet count is unchanged — never fight the accountant).
**Verify:** `… npx playwright test e2e/serial/AC-TSP-041-desk-cancel-tombstone.spec.ts`

### 8.8 — ⭐ `e2e/serial/AC-TSP-092-employee-unlinked-selfheal.spec.ts` (OWNS AC-TSP-092)

The OQ-TSP-3 ruling's end-to-end story: create an `Employee` in ERP whose work email matches PMO user U;
tick the sweep → assert `erp_employees` is adopted with `link_state='proposed'` (**not** confirmed); approve
U's week → assert the push is rejected `employee-unlinked` **with zero ERP calls**, `push_state='failed'` +
`push_error` + `action-required`, **and the sheet is still `Approved`** (the approval stands); an **Admin
confirms** the link in the UI; tick the sweep → assert the sheet is **pushed automatically**
(`push_state='pushed'`, the ERP Timesheet exists) — **the approved sheet was never lost, only pending**.
**Verify:** `… npx playwright test e2e/serial/AC-TSP-092-employee-unlinked-selfheal.spec.ts`

### 8.9 — Slice-8 gate + the full battery

**Verify (all of these, in order):**
1. `cd pmo-portal && npm run verify` (**the WHOLE suite** — typecheck + lint:ci + test + build; never
   targeted-only: a change to a shared component silently breaks every *other* test that renders it);
2. `scripts/with-db-lock.sh supabase test db` (the **full** pgTAP suite — AC-TSP-002);
3. `cd pmo-portal && scripts/with-db-lock.sh scripts/with-erpnext-lock.sh npx playwright test e2e/serial/`
   (**the whole serial lane** — the P2/P3a `AC-ENA-*`/`AC-SAR-*` specs are the regression gate, not just the
   new ones);
4. the **3-reviewer battery** (spec-reviewer, code-quality-reviewer, **security-auditor** — the Approved
   gate, the new PII table, the identity-link RPC) **+ a rendered Discover pass** — **before** the PR
   (`pr-after-review-battery`: never open a PR before the full battery is green locally).
**AC-TSP-010, 011, 020, 022, 031, 040, 041, 092 owned.** PR to `dev`.

---

## 4. Traceability (ADR-0010 — each AC owned by exactly ONE layer)

| AC | Requirement(s) | Owning layer | Owning test (the canonical proof `grep -r AC-TSP-###` finds) | Task |
|---|---|---|---|---|
| AC-TSP-001 | FR-TSP-004(i), FR-TSP-005 | Vitest | `src/lib/repositories/timesheetPush.external.test.ts` | 4.1 |
| AC-TSP-002 | FR-TSP-004(i), FR-TSP-043 | **regression gate** | the unchanged P2+P3a suite — no single owning test | every slice gate |
| AC-TSP-003 | FR-TSP-004(i), FR-TSP-094 | Vitest (deno) | `supabase/functions/erpnext-sweep/index.test.ts` (+ `erpnext-webhook/index.test.ts`) | 3.8 |
| AC-TSP-004 | FR-TSP-004(ii) | pgTAP | `supabase/tests/0112_timesheet_module_unchanged_when_flipped.test.sql` | 1.3 |
| AC-TSP-010 | FR-TSP-010, FR-TSP-014 | served-fn e2e | `e2e/serial/AC-TSP-010-approved-only-gate.spec.ts` | 8.1 |
| AC-TSP-011 | FR-TSP-060..064, FR-TSP-071 | served-fn e2e | `e2e/serial/AC-TSP-011-timesheet-push.spec.ts` *(spike-gated)* | 8.2 |
| AC-TSP-012 | FR-TSP-011 | pgTAP | `supabase/tests/0113_timesheet_push_authz.test.sql` | 1.2 |
| AC-TSP-013 | FR-TSP-012, FR-TSP-013, FR-TSP-093 | Vitest (deno) | `supabase/functions/adapter-dispatch/authGuard.test.ts` + `transitionTargetGuard.test.ts` | 5.2, 5.3 |
| AC-TSP-020 | FR-TSP-040/041/044/045 | served-fn e2e | `e2e/serial/AC-TSP-020-push-idempotency.spec.ts` | 8.3 |
| AC-TSP-021 | FR-TSP-042, FR-TSP-043 | Vitest | `src/lib/adapterSeam/erpnext/doctypeRegistry.test.ts` + `src/lib/adapterSeam/dispatch.test.ts` | 2.2 |
| AC-TSP-022 | FR-TSP-045, FR-TSP-010 | served-fn e2e | `e2e/serial/AC-TSP-022-sweep-backstop.spec.ts` | 8.4 |
| AC-TSP-030 | FR-TSP-050..053 | Vitest | `src/lib/adapterSeam/erpnext/dispatchFactory.test.ts` | 4.2 |
| AC-TSP-031 | FR-TSP-050, FR-TSP-054 | served-fn e2e | `e2e/serial/AC-TSP-031-cross-org.spec.ts` | 8.5 |
| AC-TSP-032 | FR-TSP-055, FR-TSP-056 | Vitest | `src/lib/adapterSeam/erpnext/bodies/timesheet.test.ts` | 2.5 |
| AC-TSP-033 | FR-TSP-062, FR-TSP-063 | Vitest | `src/lib/adapterSeam/erpnext/timeLogPacking.test.ts` | 2.3 |
| AC-TSP-034 | FR-TSP-070, FR-TSP-071 | Vitest | `src/lib/adapterSeam/erpnext/moneyShape.test.ts` | 2.8 |
| AC-TSP-040 | FR-TSP-082 | served-fn e2e | `e2e/serial/AC-TSP-040-native-timesheet-not-adopted.spec.ts` | 8.6 |
| AC-TSP-041 | FR-TSP-084 | served-fn e2e | `e2e/serial/AC-TSP-041-desk-cancel-tombstone.spec.ts` | 8.7 |
| AC-TSP-042 | FR-TSP-081, FR-TSP-083 | Vitest (deno) | `supabase/functions/erpnext-webhook/index.test.ts` + `_shared/erpnextFeedDeps.test.ts` | 6.3, 6.5 |
| **AC-TSP-090** | FR-TSP-090/091/093 | Vitest (deno) | `supabase/functions/_shared/erpnextFeedDeps.test.ts` | 3.5 |
| **AC-TSP-091** | FR-TSP-092, FR-TSP-014 | pgTAP | `supabase/tests/0114_erp_employee_link.test.sql` | 3.2 |
| **AC-TSP-092** | FR-TSP-051, FR-TSP-045, FR-TSP-085 | served-fn e2e | `e2e/serial/AC-TSP-092-employee-unlinked-selfheal.spec.ts` | 8.8 |
| **AC-TSP-093** | FR-TSP-170..172, FR-TSP-095 | pgTAP | `supabase/tests/0111_erp_employees_rls.test.sql` | 3.1 |
| **AC-TSP-094** | FR-TSP-095 | Vitest (deno) | `supabase/functions/_shared/erpnextFeedDeps.test.ts` | 3.5 |
| AC-TSP-050 | FR-TSP-170..172 | pgTAP | `supabase/tests/0110_timesheet_erp_mirror_rls.test.sql` | 1.1 |
| AC-TSP-051 | FR-TSP-085, FR-TSP-173 | Vitest (RTL) | `pages/Approvals.test.tsx` | 7.3 |

**AC-id tagging (binding):** Vitest names the AC in the `it(...)` title; pgTAP as the **leading token** of the
test description; Playwright as the **leading token** of the `test(...)` title with file
`e2e/serial/AC-TSP-###-<slug>.spec.ts`. An AC may be *referenced* at several layers but has exactly **one**
owning layer — the row above.

**NFRs:** SEC-001/CONTRACT-001/REV-001 structural (reviewed at the gate); IDEM-001 → AC-TSP-020/021;
MONEY-001 → AC-TSP-034; REG-001 → AC-TSP-002 + 2.2's "shipped kinds have `neverReissue === undefined`"
assertion; SEC-002 → AC-TSP-093 + 2.7's exact-key-set assertion; AVAIL-001 → AC-TSP-051 + task 7.1's
call-order/failure-tolerance assertions; PERF-001 → task 6.4's `EXPLAIN` + the AC-TSP-022 e2e.

---

## 5. Definition of done

- [ ] Slice 0's spike frozen at `docs/spikes/2026-07-16-erpnext-timesheet-fields.md` **§9 (incl. §8b's
      `Employee` read shape) with zero guesses**.
- [ ] Owner rulings in hand: ✅ OQ-TSP-3 (adopt) · ✅ OQ-TSP-4 (costing only) · **OQ-TSP-10** (Employee→user
      resolution — this plan builds (C)) · **OQ-TSP-5** (timezone) · **OQ-TSP-6** (correction path) ·
      **ADR-0059 acceptance** (`docs/adr/0059-pmo-sot-with-external-side-mirror.md`, Proposed 2026-07-16).
- [ ] All 26 AC rows green at their owning layer, AC-id-tagged.
- [ ] `npm run verify` green (**whole suite**) + full pgTAP green + the **whole** `e2e/serial/` lane green.
- [ ] ≥80% line coverage on changed code; tests assert behavior.
- [ ] Migrations `0108`–`0111` reversible; **no** `alter table` on `timesheets`/`timesheet_entries`/`profiles`
      anywhere
      (`grep -rn "alter table public.timesheets\|alter table public.timesheet_entries\|alter table public.profiles" supabase/migrations/010[89]* supabase/migrations/011[01]*`
      → **empty**).
- [ ] **`grep -rn "employee_map" supabase/ pmo-portal/src/` → empty** (the draft-1 key was superseded by the
      OQ-TSP-3 adopt ruling — it must not survive anywhere).
- [ ] **`grep -rn "is_billable\|billing_rate\|billing_hours" pmo-portal/src/lib/adapterSeam/` → empty** (the
      OQ-TSP-4 ruling: costing only).
- [ ] 3-reviewer battery (spec / code-quality / **security-auditor** — the Approved gate, the new RLS, the
      **new PII table + identity-link RPC**, the `org_id` seam) **+ a rendered Discover pass** — all before
      the PR.
- [ ] `docs/decisions.md` records any Director ruling made during the build; `docs/backlog.md` updated;
      **ADR-0055 §5's map gains the posture column** if ADR-0059 is accepted (its §7 wording is ready to lift).
- [ ] PRs land on **`dev`**. **`main` is the autonomous ceiling. No production action without a direct,
      per-instance owner instruction.**
