# Spec: Timesheet correction path — PMO `Approved → Draft` re-open + the ERPNext cancel that must accompany it

> **Status:** DRAFT r2 (2026-07-23) — **re-specification after an adversarial money review returned NO SHIP
> with 9 BLOCKs** (`docs/reviews/2026-07-23-luna-fu1-timesheet-correction-spec.md`). The Director has
> independently re-verified findings 4, 5, 6, 8 and 9 against the shipped code; this author re-read every
> cited `file:line` and confirms all nine are REAL (evidence + the re-read recorded in §14). **The r1
> design assumed the cancel could ride the shipped PUSH machinery. It cannot.** Every piece of that
> machinery is CREATE-shaped. r2 specifies the cancel as its **own first-class operation**: its own durable
> INTENT, its own reconcile pass, its own operation-aware finalizer, and its own recovery probe. It stops
> reusing push-shaped parts and stops describing the cancel in terms of `push_state`.
>
> **Authority / grounds:** **ADR-0059** §8 (*"any change to the PMO state machine a Posture-B domain sits
> on … is its own issue with its own spec and its own owner ruling"* — this is that issue) +
> §3.1/§5 (the PMO process is untouched by the *integration*; this issue changes the process itself, on
> purpose); **ADR-0048** (the ledger is the oracle — PMO must never invent an accounting figure, and must
> never leave the ledger holding a figure PMO has withdrawn); **ADR-0058** (the fenced money-idempotency
> outbox — the cancel rides the outbox's *durable-command* guarantees, **not its push-shaped finalizer**);
> **ADR-0019** (server-enforced SoD + destructive ops — re-open authority + the correction INTENT are
> security-definer RPCs, pgTAP-proven, not hidden buttons); **ADR-0016** (RLS is the enforcement
> authority); **ADR-0010** (test pyramid + AC-id tagging); **OD-TS-1/2/4** (`docs/decisions.md` — the
> shipped timesheet state machine this issue extends); **OD-SAR-PMO-IS-THE-UI** (this issue is what closes
> the "approved-and-pushed week with a mistake has no in-app fix" gap that ruling tolerated).
>
> **ID prefix:** `FR-TSC-###` / `NFR-TSC-###` / `AC-TSC-###` (TimeSheet Correction). Deliberately distinct
> from the shipped `FR-TS-###` (the approval state machine, `timesheets-approval.spec.md`) and `FR-TSP-###`
> (the P3b push, `erpnext-adapter-p3b-timesheets.spec.md`); both are consumed as **preconditions, not
> re-litigated**. `grep -r AC-TSC-###` stays unambiguous.
>
> **What this issue is NOT:** it is not a P3b task, it does not re-open OQ-TSP-6 (the owner ruled option
> (b); we specify (b)), and it does not touch billing (OQ-TSP-4 stays ruled out).

---

## 0. Job story

> **When I approved a week that turns out to have wrong hours, I want to re-open that approved week,
> correct it, and re-approve it — so the client's project cost is computed on the CORRECTED hours, exactly
> once — without ever opening the ERPNext Desk, and without the wrong week and the corrected week both
> counting against the project.**

The user is an **approver** (the line manager, or Admin break-glass — the same authority that may approve,
OD-TS-1/4-D). Today their only option once they notice the mistake is an ERPNext Desk cancel — a known,
accepted, *temporary* violation of OD-SAR-PMO-IS-THE-UI (P3b §3, OQ-TSP-6 ruling). This issue removes that
exception by giving PMO its own correction path — but the path is **constrained by a money invariant**
(§5, F1): the ERP cancel that withdraws the wrong hours must **succeed before** PMO declares the sheet
editable, or the corrected week is pushed as a *second* Timesheet and the client's cost double-counts.

---

## 1. Overview and user value

The shipped timesheet state machine (`0007_timesheet_approval.sql`) makes **`Approved` terminal**
(`'Approved' → []`). P3b added the *consequence* of approval — a push to ERPNext — but deliberately did
**not** add a way back (ADR-0059 §8; P3b §13's "Do NOT add a PMO `Approved → Draft` re-open path" fence).
**This issue is the thing that fence deferred.** It adds exactly one transition — `Approved → Draft` — and
the ERPNext cancel command that must accompany it when the sheet has already been pushed.

What makes this hard is that the sheet is no longer just a PMO record once it is pushed: **ERPNext is
enforcing the approved hours as project cost.** Re-opening the PMO side while ERPNext still holds the wrong
week is not "an editable sheet" — it is a divergence the very next push turns into a **double-count**
(§6 R-DOUBLE). So the correction path is a **two-system operation with a strict ordering**, not a status
flip.

**The r2 fence (the review's root cause, stated once).** The cancel is **not a variant of the push.** The
shipped push machinery is CREATE-shaped end to end: the generic outbox finalizer (`dispatch.ts`
`finalizeOutboxRow`) does `record_outbox_ref → writeReadModel → confirm_outbox`, and the timesheets
read-model writer (`readModelWriters.ts` `timesheetsWriter`) unconditionally writes `push_state='pushed'`,
copies `ts_number`, and **clears `erp_cancelled_at`** (M-1). A successful cancel routed through that
finalizer would therefore leave PMO asserting T1 is *live* — the opposite of FR-TSC-040. The shipped sweep
has no owner for a failed cancel (the timesheet backstop derives only `ts:` create keys; the generic pass
`continue`s past `timesheets`; and 0131 deliberately excludes failed `transition` rows from reconcile).
The shipped transition guard never injects a server-resolved target, and the adapter throws without
`record.externalRecordId`. And ADR-0058's recovery probe searches the push anchor for the key — a cancel
stamps no key into T1, so a crashed cancel cannot be recovered (and ERPNext returns `417` on a re-cancel,
spike §6). **r2 gives the cancel its own INTENT, its own reconcile pass, its own operation-aware finalizer,
and its own recovery probe**, and it stops describing cancel state in terms of `push_state`.

The design reuses, and does not re-invent: the shipped `transition_timesheet` authority (extended, one new
map entry + one new authz branch + a generation-specific cancel-confirmed precondition), the shipped
ADR-0058 outbox **as a durable-command substrate** (the cancel rides its fenced insert/claim/confirm, **not
its push-shaped finalizer**), the shipped `verb:'cancel'` ERP primitive (`{docstatus:2}`) reached via a
**new timesheet-cancel adapter path** that reads a server-stamped target, the shipped
`external_ref_lineage` supersession machinery (**now with a cancellation uniqueness key**), the shipped
deterministic push key (whose `approved_at` witness already anticipates re-approval), and a **new
deterministic cancel key** `tsc:<id>:<generation>`.

| | Today (P3b shipped) | **This issue (r2)** |
|---|---|---|
| `Approved` transitions | terminal `→ []` | `→ [Draft]` (re-open) |
| Who may re-open | n/a | the approver population + Admin; **never the owner** (F2) |
| An approved+pushed week with a mistake | ERP Desk cancel only (violates OD-SAR-PMO-IS-THE-UI) | in-app re-open → correct → re-approve |
| ERP document per approval | one | **one per approval generation** — the cancelled one is retained as lineage, never deleted (F4) |
| Ordering | n/a | **cancel confirmed → Draft** (F1); fail closed otherwise |
| The cancel operation | n/a (Desk only) | **a first-class operation**: own INTENT, own reconcile pass, own finalizer, own recovery probe |

---

## 2. Scope

### In scope
- One new transition: `Approved → Draft`, added to `transition_timesheet`'s map + its TS mirror
  (`LEGAL_TIMESHEET_TRANSITIONS`), with a new authz branch (the approver population, F2) and a new
  generation-specific cancel-confirmed precondition (F1).
- **A durable correction INTENT** (`timesheet_correction_intent`) created by the re-open RPC only AFTER the
  exact re-open authority passes, bound to the specific timesheet **generation** (the `approved_at_pushed`
  of the live doc). The cancel command and its retries CONSUME that intent (FR-TSC-005/006/007). A generic
  timesheet-push authorization must NEVER authorize a cancel (finding 7).
- **A PMO-initiated ERPNext cancel as its own operation** — `operation:'transition', verb:'cancel'` on a
  **server-resolved** ERP `name` (never a client target), ridden through the ADR-0058 outbox under its own
  `tsc:` key, finalized by an **operation-aware cancel finalizer**, retried by a **correction-cancel
  reconcile pass**, and recovered by a **cancel-specific probe**.
- **"Cancel confirmed" defined as ONE durable, generation-specific condition** (finding 1), serialized
  against a concurrent push/cancel claim by a **named per-timesheet advisory lock**.
- **The pending-push case resolved** (finding 2): the re-open transaction atomically retires a
  `pending`/`failed` push row for the current generation, and rejects if a real ERP write is in flight.
- **Generation retention (F4):** the cancelled ERP Timesheet's identity survives in `external_ref_lineage`
  (+ a new `caused_by`) + ERP itself; the 1:1 `timesheet_erp_mirror` continues to hold the *current*
  generation's state.
- **The re-push as a new ERP document** (F5) — the second push is not blocked by the outbox, `external_refs`,
  or the mirror, and `timesheetPushKey`'s `approved_at` witness already makes it a distinct command.
- **Surface honesty** while a cancel is requested but not confirmed (F7), and the **sweep's
  non-interference** with a re-opened sheet (F8) — including the rule that the push queue must NEVER replay
  a confirmed push for a tombstoned-but-still-`Approved` sheet (finding 3).
- **Coexistence with the inbound desk-cancel tombstone** (FR-TSP-084) — no double-tombstone, no fight (F9),
  via an **atomic first-writer origin decision** (finding 8).
- **The Approved-terminal sweep** (§13): every shipped site whose safety rests on `Approved` being terminal
  / on a timesheet never leaving `Approved` / on `erp_cancelled_at` meaning *only* a desk cancel gets a
  numbered requirement, because this feature deletes that premise.

### Out of scope (non-goals — explicit)
- **⛔ Billable hours / billing / Timesheet→SI linkage** — still out (OQ-TSP-4, owner 2026-07-16). A
  correction re-pushes **costing truth only**, exactly as the original push did. No billing field is added.
- **Per-project PM approval** (OD-TS-3) — re-open signs off the *whole week*, like approve.
- **Bulk / automated re-open.** Re-open is always a deliberate human action by an authorized approver.
  No "auto-reopen on discrepancy", no multi-select.
- **Any new PMO status.** The four states stay four (F3). No `Reopened`, `Correcting`, `Cancelling`, no
  parallel column, no "pending cancel" PMO state to get stuck in. (The correction *intent* is a separate
  operational table, NOT a PMO timesheet status — see §4.1.)
- **Re-open of a `Rejected` sheet.** That already exists (`Rejected → Draft`, owner-only, FR-TS-006).
  This issue adds `Approved → Draft` only; the two share a target but have **different authority**
  (approver vs owner) and the RPC branches on the source state.
- **Re-opening a sheet whose push is mid-flight (committing/committed/quarantined/held).** Fail closed
  (F1/F8) — the user retries once it settles. (A `pending`/`failed` push is retired atomically, §5.2
  FR-TSC-009.)
- **Adopting native ERP Timesheets**, **auto-provisioning**, **helper apps** — all still prohibited
  (P3b §2/§13).
- **Changing what `transition_timesheet` does for any other transition.** The Draft/Submitted/Rejected
  arms, the SoD, and the existing stamps are byte-for-byte.
- **The budget domain's MEDIUM-G tombstone.** Budget has no PMO-initiated cancel/re-push cycle, so its
  `erp_cancelled_at == permanent-desk-cancel` premise stays intact. Verified, out of scope (§13 site 9).

---

## 3. The correction lifecycle (the picture this spec specifies)

```
APPROVED (pushed: ts_number=T1, erp_docstatus=1, mirror.approved_at_pushed = t1)   ← generation t1
  │
  │ (F1) approver clicks "Re-open for correction"
  │      FE → reopen_approved_timesheet(id)   [security-definer RPC, caller JWT, §4.2]
  │        ┌─ pg_advisory_xact_lock('ts-correct:'||id)         (the NAMED lock, FR-TSC-008)
  │        ├─ authority: approver pop + Admin; owner → 42501   (FR-TSC-020/021)
  │        ├─ retire pending/failed PUSH row for gen t1         (FR-TSC-009; or reject if committing/
  │        │   committed/quarantined/held — a real ERP write is in flight/landed)
  │        ├─ IF T1 LIVE   → resolve target server-side (external_refs → 'TS-…'),
  │        │                  create timesheet_correction_intent(open, gen=t1, target=…, created_by=caller),
  │        │                  enqueue CANCEL outbox row (key tsc:<id>:t1, payload.resolved_target=…)
  │        │                  → return 'cancel-dispatched'   (sheet stays APPROVED, surface "correcting")
  │        ├─ IF T1 ALREADY CANCELLED (desk tombstone present) → skip cancel, proceed to flip (FR-TSC-031)
  │        └─ IF NEVER PUSHED (no ts_number)                   → flip APPROVED→DRAFT directly (FR-TSC-060)
  │
  │      [edge fn / sweep correction-cancel pass drives the cancel, FR-TSC-053]
  │      ERP: PUT {docstatus:2} on T1  →  200, T1 docstatus=2
  │
  │      CANCEL FINALIZER (operation-aware, FR-TSC-042) — all steps idempotent, under the SAME advisory lock:
  │        ① atomic origin CAS: tombstone mirror (erp_cancelled_at, erp_docstatus=2, cancel_origin='pmo')
  │           WHERE erp_cancelled_at IS NULL OR cancel_origin='pmo'  → if 0 rows & origin='desk': PMO aborts
  │           (desk won, FR-TSP-084); the cancel outbox confirms as an idempotent no-op, intent consumed.
  │        ② insert external_ref_lineage (reason='cancelled', gen=t1)  ON CONFLICT DO NOTHING  (FR-TSC-091)
  │        ③ supersede external_refs mapping for the record (clear)    (FR-TSC-041)
  │        ④ CAPSTONE (one fenced RPC): consume intent (open→consumed) + confirm cancel outbox  (FR-TSC-008)
  │        ⑤ complete_timesheet_reopen(id, gen=t1) [service-role RPC, re-validates via intent.created_by]
  │           → runs the identical cancel-confirmed atomic UPDATE under the lock → APPROVED→DRAFT
  │
  ▼
DRAFT (editable) ◄── (the cancel-confirmed atomic UPDATE is the SAME gate transition_timesheet(→Draft) runs
  │                   on a manual retry; the finalizer just triggers it so the user does not have to)
  │  owner corrects entries → submits → approver re-approves (NEW approved_at = t2)
  ▼
APPROVED (pushed: ts_number=T2, erp_docstatus=1)   ← generation t2, re-push under key ts:<id>:t2 (F5)
     external_refs repoints id→T2; lineage T1→T2 (successor) recorded; mirror holds T2 (current gen);
     T1 retained in lineage (F4).
```

The invariant the picture enforces: **at no instant is the PMO sheet `Draft` (editable) while ERPNext
holds a *live* Timesheet for it.** The only way to Draft is through a confirmed cancel (or proof there was
never a live doc). The double-count is structurally unreachable. The flip to Draft is gated by ONE
durable, generation-specific condition (FR-TSC-008) serialized by a named per-timesheet lock, so an RPC
can never see a half-finalized state as confirmed (finding 1).

---

## 4. Data / schema changes (reversible migrations, RLS, org seam)

Migration head at spec time: `ls supabase/migrations | tail -1` = **`0150`**. This issue reserves
**`0151`–`0153`**. **Re-verify at build time** (concurrent writers — wrap every DB-driving command in
`scripts/with-db-lock.sh`; create migrations off `dev` in a worktree).

### 4.1 `0151_timesheet_correction_intent.sql` — the durable correction INTENT (F1, findings 1 & 7)

A new operational table — **NOT a PMO timesheet status** (F3 holds: the four PMO states stay four). It is
the **authority artifact** that distinguishes "this cancel is authorized because a re-open happened" from
"a raw `transition/cancel` POST." The cancel outbox row is the *command* (money-idempotency); the intent is
the *authority*. A generic timesheet-push authorization must NOT authorize a cancel — only an open intent
for the generation does (FR-TSC-007).

```sql
create table public.timesheet_correction_intent (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations(id) on delete cascade,
  timesheet_id    uuid not null references public.timesheets(id) on delete cascade,
  -- The GENERATION under cancel = the live doc's approved_at_pushed (= the push key's witness, FR-TSC-052).
  erp_generation  timestamptz not null,
  -- Server-resolved ERP name, stamped at intent creation from external_refs (finding 5). NEVER client-set.
  resolved_target text not null,
  created_by      uuid not null references public.profiles(id),   -- the re-opener, AFTER authority passed
  created_at      timestamptz not null default now(),
  consumed_at     timestamptz,                                    -- null = open; set = the cancel confirmed
  state           text not null default 'open'
                    check (state in ('open','consumed','superseded'))
);
-- ONE open intent per (org, sheet, generation): the re-open authority is generation-bound + single-use.
create unique index timesheet_correction_intent_one_open_per_generation
  on public.timesheet_correction_intent (org_id, timesheet_id, erp_generation)
  where state = 'open';
-- At most one NON-terminal intent per sheet (a new generation's re-open supersedes a prior open one).
create unique index timesheet_correction_intent_one_inflight_per_sheet
  on public.timesheet_correction_intent (org_id, timesheet_id)
  where state in ('open','consumed');
```

RLS: machine-written (service-role write; org-member SELECT so the surface can render "correcting"). No
INSERT/UPDATE/DELETE policy for org members — `force row level security` + a SELECT-only policy denies
every user-JWT write, exactly as `external_ref_lineage` (0096 §82–94). All mutations go through the
security-definer RPCs in §4.2.

**Lifecycle.** `open` (created by `reopen_approved_timesheet`) → `consumed` (the cancel finalizer's
CAPSTONE, §3 ④, sets `consumed_at` + `state='consumed'` in the SAME fenced statement that confirms the
cancel outbox) → or `superseded` (a desk cancel won the origin race, §3 ①; or a newer generation's re-open
retires it). **What happens if consumed twice:** the capstone RPC is fenced on `state='open'` and returns 0
for a second caller — the cancel outbox row is single-use (`external_command_outbox_key_single_use`,
0134), so a second confirm is a no-op; the intent's `one_open_per_generation` partial unique index already
prevents a second open intent for the same generation. So "twice" is structurally a single effect
(FR-TSC-006).

**Reversibility:** `drop table public.timesheet_correction_intent`. No PMO data is lost (the lineage rows +
ERP tombstones remain as audit).

### 4.2 `0151` (cont.) — the three security-definer RPCs

All three acquire the **named per-timesheet transaction-scoped advisory lock** at the top of their body
(FR-TSC-008), the serialization point against a concurrent push/cancel claim:

```sql
perform pg_advisory_xact_lock(hashtextextended('ts-correct:' || p_timesheet_id::text, 0));
```

1. **`reopen_approved_timesheet(p_timesheet_id uuid)`** — caller's JWT. Under the lock: the authority check
   (FR-TSC-020/021); retire a `pending`/`failed` push row for the current generation (FR-TSC-009) or reject
   if a push is `committing`/`committed`/`quarantined`/`held` (`P0001 'reopen-push-in-flight'`); then:
   - if a live doc exists (`mirror.ts_number` non-null AND `erp_cancelled_at IS NULL`) → resolve the ERP
     name server-side from `external_refs(org,'timesheets',id)` (definer bypasses RLS), create the intent
     (`open`, generation = `mirror.approved_at_pushed`, `resolved_target` = the name, `created_by` =
     caller), and INSERT the cancel outbox row (operation `transition`, key `tsc:<id>:<generation>`,
     payload `{erp_doc_kind:'timesheet', verb:'cancel', resolved_target, generation}`); return
     `cancel-dispatched`.
   - else if already cancelled (`erp_cancelled_at` set — a desk cancel tombstoned it) → skip the cancel
     (FR-TSC-031) and flip `Approved → Draft` here (the cancel-confirmed condition is trivially met: no
     live doc); return `reopened`.
   - else (never pushed, `ts_number` null) → flip `Approved → Draft` directly (FR-TSC-060); return
     `reopened`.
2. **`confirm_timesheet_cancel(p_outbox_id uuid, p_generation timestamptz)`** — service-role only (called
   by the operation-aware cancel finalizer). Under the lock: runs the idempotent steps ①–③
   (tombstone-with-origin-CAS → lineage insert → mapping clear), THEN the **capstone**: a single fenced
   statement that sets the matching intent `open→consumed` (`where timesheet_id=? and erp_generation=?
   and state='open'`) AND confirms the cancel outbox (`record_outbox_ref`-style fenced update, `state=
   'committed'→'confirmed'`). Returns the capstone row count (1 = this finalizer consumed; 0 = already
   consumed/superseded — idempotent no-op). See §5.3 FR-TSC-042 for the ORDER and what a crash between any
   two steps leaves behind.
3. **`complete_timesheet_reopen(p_timesheet_id uuid, p_generation timestamptz)`** — service-role only
   (called by the cancel finalizer after the capstone, AND it is the exact predicate
   `transition_timesheet`'s `Approved→Draft` arm evaluates on a manual retry). Under the lock: the
   **cancel-confirmed atomic UPDATE** (FR-TSC-008) — a single `update timesheets set status='Draft' where
   id=? and status='Approved' and <cancel-confirmed-subquery>` whose WHERE requires ALL of: an intent for
   `(sheet, generation)` in state `consumed`; its cancel outbox row `confirmed`; the mirror tombstone
   present (`erp_cancelled_at` set); the `external_refs` mapping for the record superseded (absent). If the
   sheet was never pushed (FR-TSC-060) or already desk-cancelled (FR-TSC-031), the subquery's "no live doc"
   branch admits it. Returns the update count (1 = flipped; 0 = not confirmed yet → the caller leaves it
   `Approved`).

   **The service-role call re-validates authority** via the intent's `created_by`: if that re-opener is no
   longer an active member of the approver population for this sheet (offboarded, or manager change), the
   flip is refused with `P0001 'reopen-authority-lapsed'` and the intent is surfaced for an operator. A
   service-role flip never bypasses the §4.1 authority — it re-derives it from the intent.

### 4.3 `0152_timesheet_reopen_transition.sql` — `transition_timesheet` + `cancel_origin`

`create or replace function transition_timesheet(...)`. Three additive changes inside the existing
security-definer body; nothing else about the function changes:

1. **The map (F3).** The `v_legal` literal gains `'Approved', jsonb_build_array('Draft')`. The four states
   stay four; one terminal edge becomes one non-terminal edge.
2. **The authz branch (F2).** A new `elsif p_to = 'Draft' and v_from = 'Approved' then` arm (ordered
   **after** the existing `Submitted`/`Approved`/`Rejected` arms so it cannot shadow them) that admits
   exactly the **approver population** — the same authority `0007` grants for `p_to in ('Approved',
   'Rejected')`: the line manager (`v_uid is not distinct from v_mgr`), or Admin/Executive when the manager
   is null, or Admin break-glass — **and excludes the owner** (`v_uid = v_owner → 42501`, the same SoD
   ordering `0007` uses for approve: actor≠owner FIRST). A bystander Engineer is rejected. This is a
   **different authority** from the shipped `Rejected→Draft` arm (owner-only): same target, source-dependent
   authority, branched on `v_from`.
3. **The cancel-confirmed precondition (F1, finding 1).** Before the status update, when
   `p_to = 'Draft' and v_from = 'Approved'`, the arm acquires the named advisory lock
   (`pg_advisory_xact_lock('ts-correct:'||id)`) and evaluates the SAME single durable, generation-specific
   condition as `complete_timesheet_reopen` (§4.2 #3): an intent for the sheet's current generation in
   state `consumed` + its cancel outbox `confirmed` + mirror tombstone + mapping superseded, OR the no-live
   -doc case. It **rejects with `P0001 'reopen-cancel-not-confirmed'`** otherwise. It inspects ALL
   non-terminal outbox states for the sheet (`pending`/`committing`/`committed`/`quarantined`/`held`) and
   the mapping evidence — not only `committing`. A read followed by an unrelated update is not a
   reservation; the named lock held across the check-then-flip is. (This arm is the manual-retry/safety
   twin of the finalizer-triggered `complete_timesheet_reopen`; the finalizer calls that RPC so the user
   does not have to retry, but the gate is identical and the RPC remains the authority.)

> **Why this is a deliberate, stated exception to FR-TSP-006** (approval never depends on ERP liveness).
> Re-open of a **pushed** sheet *does* depend on the ERP cancel — and must, because the alternative is the
> double-count (F1). Re-open of an **un-pushed** sheet does not (F6). The exception is scoped to exactly
> the `Approved→Draft` arm and named here so a reviewer does not pattern-match it as a violation of P3b's
> independence invariant.

The stamps (F4-audit): on `Approved→Draft`, `approved_by`/`approved_at` are **left as-is** (OD-TS-4-A's
"audit trail of the last cycle" precedent — overwritten on the next approve, which is what makes the
re-push a distinct command). `submitted_at` is likewise left as-is. No new stamp column (F3).

**`timesheet_erp_mirror.cancel_origin`** (additive, nullable `text`, values `'desk'`|`'pmo'`, default null)
is added by this migration. It distinguishes a **desk** cancel (permanent exclusion, FR-TSP-084) from a
**PMO-initiated** cancel (backstop stays live for the corrected generation). Stamped ONLY by: the inbound
desk tombstone (`_shared/erpnextFeedDeps.ts` `tombstoneMirror`) → `'desk'`; the cancel finalizer's origin
CAS (§3 ①) → `'pmo'`; a fresh push (`timesheetsWriter`) → `null` (alongside `erp_cancelled_at=null`).
**Fail closed:** an unattributable null tombstone reads as `'desk'` (R-LOST-SWEEP stays visible/recoverable;
an unwanted re-create is not). `external_refs` and the outbox unique 4-tuple are unchanged.

**Reversibility:** `create or replace transition_timesheet` with the `0007` body + `alter table
timesheet_erp_mirror drop column cancel_origin`. No PMO data is lost.

### 4.4 `0153_external_ref_lineage_cancellation_unique.sql` — cancellation uniqueness + `caused_by` (finding 8, F4)

The shipped `external_ref_lineage` (0096 §82–94) has a PK + a lookup index but **no uniqueness**, so two
writers (PMO + desk) can both insert a `cancelled` row for one generation (finding 8). This migration adds:

```sql
-- Exactly ONE 'cancelled' lineage row per (org, domain, pmo_record_id, superseded generation).
create unique index external_ref_lineage_one_cancelled_per_generation
  on public.external_ref_lineage (org_id, domain, pmo_record_id, superseded_external_record_id)
  where reason = 'cancelled';
alter table public.external_ref_lineage
  add column caused_by uuid references public.profiles(id);   -- F4: who caused the supersession (nullable)
```

Both new-cancel writers INSERT `… ON CONFLICT (org_id, domain, pmo_record_id, superseded_external_record_id)
WHERE reason='cancelled' DO NOTHING` (FR-TSC-091), so whichever wins, exactly one row results. The
`caused_by` column (OQ-TSC-2) records the re-opener for a PMO cancel / the system for a desk cancel.

---

## 5. Functional requirements (EARS)

### 5.1 The transition + its authority

- **FR-TSC-001 (the transition — F3)** — The `transition_timesheet` map shall admit exactly
  `Approved → Draft` and no other new edge; the states `{Draft, Submitted, Approved, Rejected}` shall
  remain the only states, with no new status value, no parallel column, and no "pending cancel" PMO state.
  (The correction INTENT in §4.1 is an operational table, NOT a PMO status.)
- **FR-TSC-020 (re-open authority — F2)** — When a caller requests `Approved → Draft`, the system shall
  admit the caller only if the caller is the sheet's line manager (`profiles.manager_id`), or Admin /
  Executive where the manager is null, or Admin break-glass — **and shall reject the sheet's owner with
  `42501`**, and shall reject any other bystander. This authority is the **same** as `0007`'s `p_to in
  ('Approved','Rejected')` branch. The rejection is enforced **inside the security-definer RPC** (definer
  bypasses RLS — the ADR-0011/0012 lesson), not by a hidden button; `can()`/UX gating is additional, never
  the authority.
- **FR-TSC-021 (SoD ordering — F2)** — The `actor = owner` check for `Approved → Draft` shall be evaluated
  BEFORE the role/manager check, exactly as `0007` does for approve, so break-glass can never defeat the
  "owner cannot re-open their own sheet" rule.

### 5.2 The correction INTENT + the cancel-confirmed precondition (the money invariant; findings 1, 2, 7)

- **FR-TSC-005 (the cancel is its own first-class operation — the r2 fence)** — The PMO cancel shall be a
  distinct operation from the push: it shall have its own durable INTENT (`timesheet_correction_intent`,
  §4.1), its own operation-aware finalizer (FR-TSC-042), its own reconcile pass (FR-TSC-053), and its own
  recovery probe (FR-TSC-054). It shall NOT be routed through the shipped push finalizer
  (`finalizeOutboxRow` → `timesheetsWriter`), and NO state of the cancel shall be described in terms of the
  push mirror's `push_state`. (The push mirror's `push_state` continues to mean only "the push's outcome";
  a cancel's state lives on the cancel outbox row + the intent.)
- **FR-TSC-006 (the intent — creation, generation-binding, double-consume — findings 1 & 7)** — The
  re-open RPC (`reopen_approved_timesheet`) shall create exactly one `timesheet_correction_intent` row,
  bound to the sheet's CURRENT generation (`mirror.approved_at_pushed`), with a server-resolved target and
  `created_by` = the re-opener, ONLY AFTER the authority check (FR-TSC-020/021) passes. The intent shall be
  single-use: its `open→consumed` transition is the finalizer's fenced capstone (§3 ④), the
  `one_open_per_generation` partial unique index prevents a second open intent for the same generation, and
  the cancel outbox's `key_single_use` index (0134) prevents a second command — so a retry or a concurrent
  finalizer consumes the intent at most once and issues at most one ERP cancel.
- **FR-TSC-007 (a generic push authorization must not authorize cancel — finding 7)** — The served
  `adapter-dispatch` path shall branch on operation: a timesheets-domain `transition/cancel` shall be
  admitted ONLY when an OPEN `timesheet_correction_intent` exists for `(sheet, generation)` created by an
  authorized re-opener, and shall be **rejected with `commit-rejected 'cancel-requires-correction-intent'`**
  otherwise. The shipped push gate (`isTimesheetPush` → `enforceTimesheetApproved` →
  `approved_timesheet_for_push`) shall NOT authorize a cancel: `approved_timesheet_for_push` admits the
  historical approver or any Admin/Executive/Project Manager/Finance, which is the PUSH authority, not the
  re-open authority — so without this branch a Finance user (or an old approver whose manager authority has
  changed) could POST `transition/cancel` directly and cancel T1 while PMO stays Approved. (AC-TSC-007.)
- **FR-TSC-008 ("cancel confirmed" is ONE durable, generation-specific condition + a named lock — finding
  1)** — The condition that permits `Approved → Draft` for a pushed sheet shall be the single atomic
  predicate evaluated by `complete_timesheet_reopen` / the `Approved→Draft` arm: **ALL of** (a) an intent
  for the sheet's current generation in state `consumed`; (b) that intent's cancel outbox row `confirmed`;
  (c) the mirror tombstone present (`erp_cancelled_at` set); (d) the `external_refs` mapping for the record
  superseded (absent). The check-and-flip shall be serialized against a concurrent push/cancel claim by the
  **named per-timesheet transaction-scoped advisory lock**
  `pg_advisory_xact_lock(hashtextextended('ts-correct:'||timesheet_id::text, 0))`, acquired by
  `reopen_approved_timesheet`, `confirm_timesheet_cancel`, `complete_timesheet_reopen`, the
  `transition_timesheet` `Approved→Draft` arm, AND the timesheets-domain finalizer critical section. A read
  of mirror/outbox/intent/mapping followed by an unrelated update is NOT a reservation; the lock held across
  the atomic check-then-flip is. The RPC shall inspect ALL non-terminal outbox states for the sheet
  (`pending`/`committing`/`committed`/`quarantined`/`held`), not only `committing`.
- **FR-TSC-009 (the pending-push case resolved atomically — finding 2)** — Inside the `reopen_approved_
  timesheet` transaction, under the lock, the RPC shall atomically RETIRE any `pending` or `failed` PUSH
  outbox row for the sheet's current generation (move it to a terminal `superseded` state, outside
  `external_command_outbox_one_inflight_per_record`'s non-terminal set, 0134) so it cannot wedge the next
  generation's push (`one_inflight_per_record` includes `pending`). The RPC shall instead REJECT with
  `P0001 'reopen-push-in-flight'` when a PUSH row is in `committing`/`committed`/`quarantined`/`held` (a
  real ERP write is in flight or landed — the user retries once it settles, then the cancel path runs).
  **FR-TSC-081's prior tolerance of a bare `pending` row is withdrawn;** `pending` is retired, not
  re-opened past. (AC-TSC-009.)
- **FR-TSC-010 (cancel-before-Draft ordering — F1, restated against the single condition)** — When a
  caller requests `Approved → Draft` for a pushed sheet whose cancel is not yet confirmed (the
  FR-TSC-008 condition does not all hold), the system shall reject the transition with `P0001
  'reopen-cancel-not-confirmed'` and leave the sheet `Approved` — never return it to `Draft`. A live ERP
  document (`mirror.ts_number` non-null AND `erp_cancelled_at IS NULL`, regardless of `push_state`) or any
  non-terminal PUSH outbox row whose ERP write may have landed makes the condition false.
- **FR-TSC-011 (fail closed, named + actionable — F1, finding 4)** — When the ERP cancel cannot be
  confirmed (unreachable, rejected, or still in flight), the sheet shall remain `Approved`, the failure
  shall be recorded as the **cancel outbox row's** `state='failed'` + a classified error (NOT as
  `mirror.push_state='failed'`), and the **correction-cancel reconcile pass** (FR-TSC-053) shall re-drive
  it. The surface shall offer a retry — never a silent flip to `Draft`.
- **FR-TSC-060 (the un-pushed case is not an error — F6)** — Where the org does not employ ERPNext, or the
  sheet has no mirror row, or its mirror `ts_number` is null (never successfully pushed), the system shall
  perform `Approved → Draft` as a **pure PMO transition** with no external call, no intent, no failure
  branch, and no cancel precondition — succeeding identically to the pre-P3b `Rejected → Draft` rework.
- **FR-TSC-031 (skip a redundant cancel — F6/F9)** — Before issuing the cancel, the path shall determine
  whether the ERP Timesheet is already cancelled (`erp_cancelled_at` set — a desk cancel tombstoned it via
  FR-TSP-084) and, if so, skip the ERP call entirely and flip to Draft (the no-live-doc branch of the
  FR-TSC-008 condition). A cancel of an already-cancelled doc is never issued.

### 5.3 The cancel operation: target resolution, finalizer, reconcile, recovery (findings 3, 4, 5, 6, 8, 9)

- **FR-TSC-030 (PMO-initiated cancel — F1/F9, restated as first-class)** — The correction path shall
  cancel a pushed sheet's live ERP Timesheet by issuing `operation:'transition', verb:'cancel'` against the
  ERP `name` **resolved solely server-side** (FR-TSC-032) from `external_refs(org,'timesheets',id)`, ridden
  through the ADR-0058 outbox under its own `tsc:` key (FR-TSC-052), **authorized by an open correction
  intent** (FR-TSC-006/007), finalized by the operation-aware cancel finalizer (FR-TSC-042), retried by the
  correction-cancel reconcile pass (FR-TSC-053), and recovered by the cancel-specific probe (FR-TSC-054).
  It shall NOT set or read `mirror.push_state`.
- **FR-TSC-032 (server-side target resolution; the client never carries the target — finding 5)** — The
  ERP `name` to cancel shall be resolved SERVER-SIDE inside `reopen_approved_timesheet` (definer reads
  `external_refs`) and persisted in the cancel outbox row's payload as `resolved_target` and in the intent.
  The shipped `transitionTargetGuard.ts` `checkTransitionTargetBinding` REJECTS a present client target for
  `timesheets` (the `REJECT_CLIENT_SUPPLIED_TARGET` set) — this stays byte-for-byte. The shipped
  `commitTransition` (`adapter.ts:161–165`) requires `record.externalRecordId` and throws without it — so
  r2 adds a **timesheet-cancel adapter path** that reads `resolved_target` from the command's
  server-resolved context (populated from the outbox payload by `dispatchFactory`'s cancel preflight),
  NEVER from `record.externalRecordId`. A client-supplied or foreign target shall be rejected before any
  ERP call. (AC-TSC-032 — what it is structurally unable to see: it cannot see the key derivation; it CAN
  see that a request carrying `externalRecordId` is refused and that a request naming a foreign ERP doc —
  one not in this record's `external_refs` — is refused, while the server-resolved cancel succeeds.)
- **FR-TSC-040 (nothing is deleted — F4)** — When a pushed Timesheet is cancelled (PMO- or desk-initiated),
  the system shall RETAIN the cancelled document's identity — its ERP `name`, `docstatus=2`, the
  cancellation timestamp, and (per OQ-TSC-2) its cause (`caused_by`) — in `external_ref_lineage` (a
  `reason='cancelled'` row) AND in ERPNext itself (a cancelled ERP Timesheet is a permanent tombstone).
  The 1:1 `timesheet_erp_mirror` shall reflect the CURRENT generation only; superseded generations are
  recoverable via lineage + ERP.
- **FR-TSC-041 (the mapping is superseded, not duplicated — F4/F5)** — The cancel finalizer shall
  SUPERSEDE the cancelled generation's `external_refs` mapping (record it in lineage, then clear the live
  mapping) so a later re-push maps the record to the NEW ERP document without a duplicate mapping and
  without losing the cancelled document's lineage. (OQ-TSC-3 recommends clear-after-lineage.)
- **FR-TSC-042 (the operation-aware cancel finalizer — finding 6; ORDER + crash-between)** — Finalization
  shall be operation-aware. For a timesheet cancel the finalizer (`confirm_timesheet_cancel`, §4.2 #2),
  under the named advisory lock, shall perform these steps IN THIS ORDER, each idempotent:
  1. **Atomic origin CAS** (FR-TSC-091): tombstone the mirror
     (`erp_cancelled_at=now(), erp_docstatus=2, cancel_origin='pmo'`) `WHERE erp_cancelled_at IS NULL OR
     cancel_origin='pmo'`. If 0 rows update AND the existing `cancel_origin='desk'`, PMO ABORTS (the desk
     won, FR-TSP-084): the cancel outbox confirms as an idempotent no-op and the intent is consumed — no
     lineage, no mapping change (the desk tombstone already did both).
  2. **Lineage insert**: `insert … reason='cancelled', superseded=<name>, caused_by=<re-opener> ON
     CONFLICT (…cancelled-per-generation…) DO NOTHING`.
  3. **Mapping supersede**: clear the record's `external_refs` row (FR-TSC-041).
  4. **Capstone** (one fenced RPC): consume the intent (`open→consumed`) AND confirm the cancel outbox
     (`committed→confirmed`) in a single statement fenced on `state='open'`/`state='committed'`.
  5. Trigger `complete_timesheet_reopen` (the flip).

  **What a crash between any two steps leaves behind** (each is recoverable; the re-open RPC never sees a
  half-state as confirmed because the capstone is last and atomic):
  - After the ERP `PUT {docstatus:2}` commits, before ①: T1 is cancelled in ERP, PMO mirror still live →
    the cancel-specific recovery probe (FR-TSC-054) GETs T1, sees `docstatus=2`, and re-runs the finalizer
    from ①. The re-open RPC rejects (`reopen-cancel-not-confirmed`) until then. **Fail-safe.**
  - After ① (tombstone), before ②: tombstone present, no lineage → recovery re-runs from ② (① is now a
    no-op; ② is `ON CONFLICT DO NOTHING`).
  - After ②, before ③: tombstone + lineage, mapping still points to T1 → recovery clears it (③). The
    re-open condition (mapping superseded) is false, so no premature flip.
  - After ③, before ④: tombstone + lineage + mapping cleared, intent still `open`, outbox still
    `committed` → recovery runs the capstone (④).
  - After ④, before ⑤: intent `consumed` + outbox `confirmed` but sheet still `Approved` → recovery calls
    `complete_timesheet_reopen` (⑤); the condition is now true.

  The cancel finalizer shall NOT call `timesheetsWriter` (which writes `push_state='pushed'`, copies
  `ts_number`, clears `erp_cancelled_at` — the CREATE shape). The shipped generic `finalizeOutboxRow`
  stays for creates/updates; cancels branch off it.
- **FR-TSC-053 (the correction-cancel reconcile pass — finding 4)** — A NEW sweep pass
  (`reconcileOrgTimesheetCancels`, sibling to `reconcileOrgTimesheetPushes`) shall own the cancel retry. It
  shall select ONLY cancel outbox rows that (a) are in a reconcile-eligible state, (b) belong to this org's
  `timesheets` domain, AND (c) have an OPEN correction intent for their generation — i.e. it drives ONLY
  this explicitly authorized intent. It shall derive the persisted `tsc:<id>:<generation>` key from the
  intent/outbox payload (NOT from the ERP name). It shall preserve 0131's terminal rule for UNRELATED human
  transitions (a rejected human `Submitted→Approved` stays terminal) — the cancel is not a human approval
  transition; it is an authorized machine correction, so its `failed` rows ARE reconcilable, expressed as a
  dedicated candidate set rather than by widening the generic `operation <> 'transition'` predicate. It
  shall use the operation-aware finalizer (FR-TSC-042), never the push finalizer. (AC-TSC-053 — what it is
  structurally unable to see: it cannot see the pass's internal ordering, only that a cancel that ERP
  rejected/unreachable is re-driven and eventually confirms or exhausts its attempts visibly.)
- **FR-TSC-054 (cancel-specific crash recovery — finding 9)** — The cancel outbox row's payload shall
  persist the `resolved_target` (the ERP name). The cancel recovery probe shall GET that target's current
  `docstatus` and treat `docstatus=2` as a SUCCESSFUL cancellation (finalize the tombstone via FR-TSC-042)
  rather than re-issuing a cancel — because ERPNext returns `417 Cannot edit cancelled document` on a
  re-cancel (spike §6), so a blind re-issue after the ERP commit strands the mirror live. The probe shall
  NOT search the push anchor (`note`) for the cancel key (a cancel stamps no key into T1; the generic
  immutable-anchor probe misses). (AC-TSC-054 — what it is structurally unable to see: the internal probe
  method; it CAN see that a process killed after the ERP cancel commit but before finalization converges to
  a tombstone + confirmed outbox without a second ERP cancel.)
- **FR-TSC-091 (atomic origin assignment + lineage uniqueness — finding 8)** — Origin assignment
  (`cancel_origin`) shall be an atomic conditional update that RETURNS the winning origin: PMO writes
  `cancel_origin='pmo'` only if the row is still `erp_cancelled_at IS NULL OR cancel_origin='pmo'`; if the
  row already shows `cancel_origin='desk'`, PMO ABORTS (the desk won) and the cancel is an idempotent
  no-op. The INBOUND desk path shall no-op if `cancel_origin='pmo'` already won (a stale desk webhook for a
  doc PMO already cancelled). The `external_ref_lineage_one_cancelled_per_generation` uniqueness (§4.4) +
  `ON CONFLICT DO NOTHING` shall make the lineage insert idempotent. Both interleavings (PMO-then-desk and
  desk-then-PMO) and a duplicate webhook delivery shall leave exactly one tombstone, one lineage row, one
  origin. (AC-TSC-091.)
- **FR-TSC-050 (re-push mints a NEW ERP document — F5)** — The re-push shall create a NEW ERP Timesheet
  (ERPNext cannot re-submit a cancelled document) under a distinct outbox key `ts:<id>:<approved_at>` (the
  re-approve produced a new `approved_at`), and shall not be blocked by:
  - **the outbox unique 4-tuple** + the one-in-flight partial-unique + key-single-use indexes (0096/0134):
    a different `approved_at` ⇒ a distinct key ⇒ a distinct row. **Not blocked.**
  - **`external_refs` uniqueness** (0088): FR-TSC-041 superseded the cancelled mapping, so the record is
    unmapped at re-push time; the shipped `record_outbox_ref` `on conflict` upsert maps it to the new name.
    **Not blocked.**
  - **`timesheet_erp_mirror.timesheet_id UNIQUE`** (0136): the shipped `timesheetsWriter` upserts
    `on conflict: 'timesheet_id'`, overwriting `ts_number` with the new generation (the mirror is the
    current-generation state; the old generation is retained in lineage). **Not blocked.**
  - **`timesheetPushKey.ts` keys on `approved_at`**: confirmed sufficient — its header comment states
    verbatim *"a sheet can legitimately be re-approved … the `approved_at` witness makes each approval its
    own command."* **No change to the push key is required.** It clears the shipped served-boundary guard
    (`isOpaqueIdempotencyKey()`) UNCHANGED.
- **FR-TSC-051 (the one shipped guard that MUST be addressed — F5)** — The shipped
  `checkCreateTargetUnmapped` guard rejects a `create` for a PMO record already mapped in `external_refs`.
  FR-TSC-041 supersedes the mapping at cancel time, so the re-push is a create-for-an-unmapped-record and
  the guard passes. **No change to `checkCreateTargetUnmapped` is made.**
- **FR-TSC-052 (the cancel key — F5, restated)** — The cancel shall ride the outbox under a deterministic
  key DISTINCT from the push key: **`tsc:<pmo_record_id>:<generation>`**, where `<generation>` is the
  `timesheet_erp_mirror.approved_at_pushed` for the doc under cancel (read from the mirror/intent, NOT the
  ERP name — the shipped opaque-key guard's third segment is `[0-9TZ:.+-]{4,40}` (`DETERMINISTIC_KEY_RE`),
  and an ERPNext Timesheet `name` like `TS-2026-00042` carries an `S` outside that alphabet, so
  `tsc:<id>:<erp_name>` would be REFUSED by `isOpaqueIdempotencyKey()` and the cancel could never
  dispatch; the UUID + timestamp segments both satisfy the guard unchanged). It is deterministic across the
  foreground cancel and the correction-cancel reconcile pass because both read the same `generation` from
  the intent/outbox payload. It distinguishes cancelling T1 from a later T2 (`tsc:<id>:t1` ≠
  `tsc:<id>:t2`). Its `tsc:` prefix means it can never collide with a push key. (The `DETERMINISTIC_KEY_RE`
  / `isOpaqueIdempotencyKey()` guard is NOT weakened — r2 depends on it.)

### 5.4 Surface honesty + sweep coexistence (F7, F8, F9; finding 3)

- **FR-TSC-070 (money-honesty during a pending cancel — F7)** — While a cancel has been requested but not
  confirmed (an OPEN intent exists; the mirror does not yet show `erp_cancelled_at` with
  `cancel_origin='pmo'`), the surface shall assert NEITHER that the hours are editable (still `Approved`)
  NOR that they are cancelled (the ERP doc may still be live). It shall state a third thing — that a
  correction is in progress and the ERP timesheet is being cancelled — with the cancel's current status (in
  flight / failed-retryable). A status may be asserted only when its inputs are known (the P3c money-honesty
  invariant, `0149_get_budget_projection.sql` header).
- **FR-TSC-080 (the sweep and a re-opened sheet — F8, BOTH directions, finding 3)** — Verified in both
  directions. **Direction 1 (do NOT re-push a Draft re-opened sheet):** once a sheet is `Draft`, the push
  queue (`listApprovedSheetsWithoutMirror`) filters `status='Approved'` and the re-asserted
  `approved_timesheet_for_push` gate refuses a non-`Approved` sheet — so no create fires.
  **Direction 2 (do NOT replay a confirmed push for a tombstoned-but-still-`Approved` sheet — finding 3):**
  the push queue (`listPendingTimesheetPushes`) shall EXCLUDE any sheet that has an OPEN correction intent
  for its current generation (a sheet mid-correction is not a push candidate), and the confirmed-replay
  path (`dispatch.ts` `reconcileOutbox` case `confirmed` → `convergeReadModel` → `timesheetsWriter`) shall
  NOT clear `erp_cancelled_at` for the timesheets domain — the cancel finalizer owns the tombstone.
  Direction 3 (DO still re-push a corrected, re-approved sheet whose foreground push failed) is FR-TSC-082.
- **FR-TSC-082 (distinguish desk cancel from PMO cancel so the backstop stays live for the correction —
  F8, money)** — `erp_cancelled_at` carries two meanings needing OPPOSITE backstop behavior: (a) a desk
  cancel (FR-TSP-084) PERMANENTLY excludes the sheet; (b) a PMO cancel INTENDS a re-push. The
  `cancel_origin` column (§4.3) distinguishes them, stamped by the SAME write that sets `erp_cancelled_at`
  (desk → `'desk'`; PMO finalizer → `'pmo'`; fresh push → `null`). Fail closed: an unattributable null
  tombstone reads as `'desk'`. The mirror work-queue predicate (`listPendingTimesheetPushes`) is widened
  from `.is('erp_cancelled_at', null)` to **"tombstone is null OR `cancel_origin='pmo'`"**, so a corrected,
  re-approved sheet whose foreground re-push failed (mirror `push_state='failed'`, `erp_cancelled_at` set,
  `cancel_origin='pmo'`) is still picked up and re-driven under its push key, while a desk-cancelled sheet
  stays permanently excluded. **FR-TSP-084's desk-cancel behavior is unchanged.** (The budget mirror has
  the analogous tombstone structure but NO PMO cancel, so it is unchanged — §13 site 9.)
- **FR-TSC-090 (PMO cancel and desk cancel do not fight or double-tombstone — F9, finding 8)** — See
  FR-TSC-091 (atomic origin CAS) and FR-TSC-031 (skip-if-already-cancelled). Exactly one `cancelled`
  lineage row per cancelled generation, never two.

---

## 6. Non-functional requirements

- **NFR-TSC-AUTH-001 (server-enforced, pgTAP-proven)** — Re-open authority (FR-TSC-020/021), the
  correction-intent creation (FR-TSC-006/007), and the cancel-confirmed precondition (FR-TSC-008/010) shall
  be enforced inside security-definer RPCs and proven by pgTAP at the DB layer (ADR-0019). A hidden button
  is not enforcement; `can()` is UX only.
- **NFR-TSC-IDEM-001 (no double-count)** — Under any interleaving of {re-open, cancel, push, sweep tick,
  retry, crash-after-ERP-cancel-before-finalize, desk-cancel-during-PMO-cancel}, at most ONE live ERP
  Timesheet shall exist for a sheet at any instant, and the corrected week shall reach ERP costing EXACTLY
  ONCE. Proven at the real served boundary with the `after-commit-before-mirror` fault seam (ADR-0058 §5),
  asserting against the ERP Timesheet list (the oracle), not PMO state.
- **NFR-TSC-REV-001 (reversibility)** — Reversed by `create or replace transition_timesheet` (0007 body) +
  `drop table timesheet_correction_intent` + `alter table timesheet_erp_mirror drop column cancel_origin` +
  `drop index external_ref_lineage_one_cancelled_per_generation` + `alter table external_ref_lineage drop
  column caused_by`. No PMO data is lost.
- **NFR-TSC-REG-001 (byte-for-byte for everyone else)** — The `Rejected → Draft` arm (owner-only), the
  `Submitted → Approved/Rejected` arms, every existing stamp, every non-timesheet domain, the budget
  tombstone, and the generic push finalizer for non-cancel operations shall be unchanged. The
  `Approved → []` → `Approved → [Draft]` map change is the only behavioral delta for the approval module.
- **NFR-TSC-TEST-001 (real boundary, real oracle)** — Every money-correctness AC shall assert against the
  real ERP Timesheet list (the double-count oracle) through the real served `adapter-dispatch`, never
  `page.route`, and never a PMO-mirror state dressed as proof (audit-program anti-shape #5).
- **NFR-TSC-FENCE-001 (the cancel is not the push — binding)** — No shipped CREATE-shaped primitive
  (`finalizeOutboxRow`, `timesheetsWriter`, the push anchor recovery probe, the push-only served gate) shall
  be on the cancel's path. A code review shall confirm the cancel branches off each of them. (This is the
  r2 fence as a testable property — AC-TSC-055.)

---

## 7. Acceptance criteria (Given/When/Then — each owned by EXACTLY ONE layer)

> **Authoring discipline (the audit-program lesson).** Before each AC, asked: *what is this structurally
> unable to see?* — recorded per AC. None asserts the request (anti-shape #5); none relies on a fixture
> pre-holding the asserted outcome (anti-shape #7); none posits a mirror/lineage state the shipped writers
> do not produce (anti-shape #6). Money ACs read the ERP oracle. Authority/precondition ACs run at the DB.

### The transition + authority (F2, F3)

- **AC-TSC-020 — An approver re-opens; the owner cannot; a bystander cannot. [pgTAP]**
  **Given** an `Approved` sheet owned by U, U's line-manager M (an `Engineer`-role manager), an Admin A,
  and an unrelated bystander B, **each in its OWN independent `Approved` fixture/transaction** (the r1
  NOTE: M's successful call flips the shared sheet to `Draft` before A calls the same transition — so each
  actor gets a fresh `Approved` sheet; the AUTHORITY outcome, not a shared-sheet sequencing artifact, is
  what is asserted),
  **When** each calls `transition_timesheet(sheet,'Draft')` on their own sheet,
  **Then** M and A are admitted (the sheet becomes `Draft`); U is rejected `42501` (owner cannot re-open
  their own approved sheet); B is rejected `42501`. (FR-TSC-020/021) *Cannot see: the SoD ordering in
  isolation — only the admit/reject outcome.*
- **AC-TSC-021 — `Rejected→Draft` stays owner-only; the four states stay four. [pgTAP]**
  **Given** the extended map, **When** the full `0007` transition battery is re-run, **Then** every
  pre-existing transition behaves identically to `0007` (the `Rejected→Draft` arm is NOT widened to
  approvers), `Approved→Draft` is the only new edge, and no row ever carries a status outside
  `{Draft,Submitted,Approved,Rejected}`. (FR-TSC-001, NFR-TSC-REG-001)

### The intent + the cancel-confirmed gate (findings 1, 2, 7)

- **AC-TSC-007 — A raw cancel POST is rejected without a correction intent; a generic push authorization
  does not authorize cancel. [served-fn e2e]**
  **Given** a pushed `Approved` sheet (`T1`) and a Finance-role caller (admitted by
  `approved_timesheet_for_push` for a PUSH),
  **When** the caller POSTs `operation:'transition', verb:'cancel'` for the sheet DIRECTLY (no re-open,
  no intent),
  **Then** the served path rejects with `commit-rejected 'cancel-requires-correction-intent'` BEFORE any
  ERP call, the ERP `Timesheet` list still shows `T1` live (`docstatus=1`), and no cancel outbox row is
  written. Separately, after a legitimate re-open (intent created), the same caller's role is irrelevant —
  the intent authorizes the cancel. (FR-TSC-005/006/007) *Cannot see: the intent table's internal columns;
  CAN see that a foreign/role-based cancel is refused and an intent-bound cancel succeeds.*
- **AC-TSC-008 — "Cancel confirmed" is one durable generation-specific condition; an RPC never sees a
  half-finalized state as confirmed. [served-fn e2e]**
  **Given** a pushed sheet mid-cancel (ERP `PUT {docstatus:2}` committed; finalizer crashed AFTER the tomb
  stone but BEFORE the capstone — tombstone + lineage present, intent still `open`, outbox still
  `committed`),
  **When** the approver requests `Approved → Draft`,
  **Then** `transition_timesheet` raises `P0001 'reopen-cancel-not-confirmed'` (the condition is not yet
  all-true), the sheet stays `Approved`, and the surface shows "cancel reconciling." After the
  correction-cancel recovery finishes the capstone, the SAME request (or the finalizer-triggered
  `complete_timesheet_reopen`) flips it to `Draft`. Concurrently, a PUSH claim racing the flip is serialized
  by the named advisory lock (asserted by observing the push does not write the mirror between the
  condition-check and the flip). (FR-TSC-008) *Cannot see: the lock implementation; CAN see that no
  half-state is ever admitted as confirmed and that a racing push cannot interleave.*
- **AC-TSC-009 — A `pending` push row is retired atomically by re-open; a `committing` push blocks re-open.
  [served-fn e2e]**
  **Given** (a) a pushed sheet with a leftover `pending` PUSH outbox row, and (b) a sheet with a
  `committing` PUSH outbox row,
  **When** the approver re-opens each,
  **Then** (a) re-open succeeds: the `pending` row is moved to `superseded` (outside
  `one_inflight_per_record`), the cancel is dispatched, and a LATER re-approval's `ts:<id>:t2` push is NOT
  wedged by `command-in-flight-for-record`; (b) re-open rejects `P0001 'reopen-push-in-flight'` and the
  sheet stays `Approved` until the push settles. (FR-TSC-009) *Cannot see: the row's state label in
  isolation; CAN see the wedge-vs-reject behavior and that the next generation is not blocked.*

### The money invariant (F1, F6)

- **AC-TSC-010 — A live ERP Timesheet blocks re-open; the sheet stays Approved with a named failure.
  [served-fn e2e]**
  **Given** an org employing ERPNext and a sheet `Approved` + pushed (`ts_number=T1`, `erp_docstatus=1`),
  **When** the approver requests re-open WITHOUT a confirmed cancel,
  **Then** `transition_timesheet` raises `P0001 'reopen-cancel-not-confirmed'`, the sheet's `status`
  remains `Approved`, T1 is still live (asserted against the ERP doc — the oracle), and the entries are not
  editable. (FR-TSC-010/011)
- **AC-TSC-011 — Cancel confirmed, then Draft, then corrected, then re-pushed: cost reflects the CORRECTED
  hours exactly once. [served-fn e2e]** *(spike-gated)*
  **Given** a pushed sheet (`T1`, 40h wrong) and the OQ-TSP-1 spike frozen,
  **When** the approver re-opens (cancel `T1` → confirmed → `Draft`), the owner corrects to 32h,
  re-submits, the approver re-approves, and the re-push lands,
  **Then** the client's ERP project holds EXACTLY ONE live Timesheet for that week (ERP list — the oracle),
  its `total_hours` = 32h NOT 40h, `T1` exists with `docstatus=2`, and the project's costing reflects 32h
  exactly once — **never 72h**. (FR-TSC-030/050, NFR-TSC-IDEM-001)
- **AC-TSC-012 — An un-pushed sheet re-opens with no ERP call and no failure. [served-fn e2e]**
  **Given** an org that does NOT employ ERPNext (and separately a pushed org's sheet whose push never
  reached ERP — `ts_number` null),
  **When** the approver re-opens,
  **Then** the sheet becomes `Draft`, ZERO ERP HTTP requests are issued (asserted against the bench), no
  cancel is attempted, no intent is created, and no failure is recorded. (FR-TSC-060)

### The cancel operation: target, finalizer, reconcile, recovery (findings 4, 5, 6, 8, 9)

- **AC-TSC-032 — The cancel target is resolved server-side; a client/foreign target is rejected.
  [served-fn e2e]**
  **Given** a pushed sheet (`T1`) and a legitimate re-open (intent created with `resolved_target=T1`),
  **When** (a) the cancel runs normally, and (b) a hand-crafted request carries `record.externalRecordId`
  for T1, and (c) a hand-crafted request names a FOREIGN ERP doc (one not in this record's `external_refs`),
  **Then** (a) the server-resolved cancel succeeds (T1 → `docstatus=2`, exactly one `{docstatus:2}` PUT);
  (b) the `externalRecordId`-carrying request is refused 422 by `checkNoClientSuppliedTarget` before any
  ERP call; (c) the foreign-target request is refused before any ERP call. (FR-TSC-032) *Cannot see: the
  key derivation; CAN see refuse-vs-succeed for the three target shapes.*
- **AC-TSC-040 — After a full re-open + re-push cycle, the cancelled generation is retrievable; nothing is
  silently lost. [served-fn e2e]** *(moved from pgTAP — SHOULD-FIX: the lineage/mapping/mirror lifecycle is
  edge-fn/service-role code (`lineage.ts`, `erpnextFeedDeps.ts`, `readModelWriters.ts`, the cancel
  finalizer), not a SQL RPC a pgTAP fixture can drive without pre-seeding the result (anti-shape #7).)*
  **Given** a sheet pushed as `T1`, re-opened (T1 cancelled), corrected, and re-pushed as `T2`,
  **When** the history is queried via `external_ref_lineage` and the mirror,
  **Then** a `reason='cancelled'` lineage row exists naming `T1` (`erp_docstatus=2`, `caused_by` = the
  re-opener); `external_refs` maps the record to `T2`; the mirror shows `ts_number=T2`, `erp_docstatus=1`,
  `erp_cancelled_at` null; and `T1` is retrievable by name from lineage (not silently overwritten). The
  lineage row was WRITTEN BY THE IMPLEMENTATION (the fixture does not pre-seed it — anti-shape #7).
  (FR-TSC-040/041/050) *pgTAP keeps the authority/RLS/uniqueness/CAS contracts (AC-TSC-020/021/091).*
- **AC-TSC-041 — The re-push is not blocked by the outbox, `external_refs`, or the mirror. [served-fn
  e2e]** *(spike-gated)*
  **Given** a sheet mid-cycle (T1 cancelled, mapping superseded, now `Draft`),
  **When** it is corrected, re-approved (new `approved_at` t2), and re-pushed,
  **Then** the re-push succeeds under key `ts:<id>:t2` (a distinct outbox row), `external_refs` repoints
  to `T2`, the mirror upserts to `T2`, and the ERP list shows exactly `{T1 cancelled, T2 live}`.
  (FR-TSC-050/051)
- **AC-TSC-042 — The cancel finalizer is operation-aware: a successful cancel tombstones the mirror and
  does NOT write `push_state='pushed'`/clear `erp_cancelled_at` via the push writer. [served-fn e2e]**
  **Given** a pushed sheet (`T1`) re-opened (cancel dispatched),
  **When** the cancel finalizer runs to the capstone,
  **Then** the mirror shows `erp_cancelled_at` set + `erp_docstatus=2` + `cancel_origin='pmo'`, the mirror
  `push_state` is NOT `'pushed'` on account of the cancel (it is unchanged or a cancel-specific value —
  NOT the push writer's `pushed`), `ts_number` is NOT overwritten by the cancel, exactly one `cancelled`
  lineage row exists, the `external_refs` mapping is cleared, and the cancel outbox is `confirmed`.
  (FR-TSC-042; finding 6) *Cannot see: which code branch ran; CAN see the mirror/outbox/lineage RESULT is
  the cancel shape, not the push shape — a regression that routes cancel through `timesheetsWriter` fails
  (`push_state='pushed'` + `erp_cancelled_at` null).*
- **AC-TSC-052 — A foreground cancel and a sweep-driven cancel for the same generation issue exactly one
  ERP cancel; one outbox row; one lineage row. [Playwright served-fn e2e]** *(re-spec'd — SHOULD-FIX: a
  same-key retry does NOT collide on `23505` — `dispatchMoneyWrite` reads-before-insert and the backstop
  reads the same key, so the r1 "second attempt COLLIDED … a `23505`" asserts an impossible mechanism.)*
  **Given** a pushed sheet (`T1`) whose re-open dispatches the foreground cancel under key
  `tsc:<id>:<generation>`, and that cancel is ALSO eligible for the correction-cancel reconcile pass (the
  foreground attempt ERP-rejected → outbox `failed`; the pass re-drives the same key),
  **When** both run,
  **Then** EXACTLY ONE `{docstatus:2}` cancel reaches ERPNext for `T1` (ERP list — T1 is `docstatus=2`,
  never double-cancelled), EXACTLY ONE `external_command_outbox` row exists for that cancel key (the
  second originator READ the existing single-use-key row and reconciled — NOT a `23505` insert collision),
  and EXACTLY ONE `reason='cancelled'` lineage row exists for `T1`. A non-deterministic key (a per-dispatch
  random) WOULD mint two rows and two cancels; a key the served boundary rejects (`tsc:<id>:<erp_name>`
  with an `S` outside `[0-9TZ:.+-]`) is refused at `isOpaqueIdempotencyKey()` before any outbox row is
  written, so the cancel never dispatches and `T1` stays live. (FR-TSC-052/053) *Cannot see: the key
  derivation in isolation; CAN see one-cancel/one-row/one-lineage and refuse-on-bad-shape.*
- **AC-TSC-053 — A cancel that ERP rejected or that was unreachable is re-driven by the correction-cancel
  reconcile pass; it eventually confirms or exhausts attempts visibly. [served-fn e2e]**
  **Given** a pushed sheet whose cancel ERPNext rejects (classified) or whose transport is unreachable,
  leaving the cancel outbox `failed` and the sheet `Approved`,
  **When** the sweep ticks (with the bench returning 5xx/unreachable, then recovering),
  **Then** the correction-cancel pass re-drives the SAME `tsc:` key, the cancel eventually confirms (T1 →
  `docstatus=2`) or, after the attempt budget, is surfaced `held` for an operator — and a generic
  `operation<>'transition'` human-transition failure elsewhere is NOT re-driven (0131's terminal rule for
  human transitions is preserved). (FR-TSC-011/053; finding 4) *Cannot see: the pass's internal ordering;
  CAN see re-drive-vs-hold and that human-transition terminality is untouched.*
- **AC-TSC-054 — A crash after the ERP cancel commit but before finalization converges via the
  cancel-specific probe (docstatus=2 = success), without a second ERP cancel. [served-fn e2e]**
  **Given** a pushed sheet whose cancel's ERP `PUT {docstatus:2}` has committed (T1 `docstatus=2`) but the
  process is killed before the finalizer runs (outbox still `committing`/`committed`),
  **When** recovery runs,
  **Then** the probe GETs the persisted `resolved_target` (T1), reads `docstatus=2`, treats it as success,
  runs the finalizer to the capstone (tombstone + lineage + mapping-clear + intent-consumed + confirm), and
  issues NO second `{docstatus:2}` PUT (ERPNext would return `417`). The sheet then re-opens to `Draft`.
  (FR-TSC-054; finding 9) *Cannot see: the probe method; CAN see convergence-without-second-cancel and the
  ERP list showing exactly one cancel.*
- **AC-TSC-091 — Desk-during-PMO and PMO-during-desk cancel interleave to exactly one tombstone, one
  lineage row, one origin; a duplicate webhook is a no-op. [served-fn e2e]**
  **Given** a pushed sheet (`T1`), **When** (a) the accountant cancels T1 in Desk and THEN PMO re-opens
  (PMO cancel arrives after the desk tombstone), and (b) PMO re-opens (cancel dispatched) and THEN a stale
  desk-cancel webhook for T1 arrives, and (c) a duplicate desk webhook arrives twice,
  **Then** in every case: exactly one `cancelled` lineage row for T1, the mirror `cancel_origin` reflects
  the TRUE first writer (`desk` in (a); `pmo` in (b) — the inbound desk path no-ops), PMO ABORTS its cancel
  as an idempotent no-op when `desk` already won, and no second tombstone/lineage/ERP-cancel occurs.
  (FR-TSC-091; finding 8) *Cannot see: the CAS mechanism; CAN see one-row/one-origin outcomes for both
  interleavings + the duplicate.*

### Surface honesty + sweep + coexistence (F7, F8, F9; finding 3)

- **AC-TSC-070 — A pending cancel asserts neither "editable" nor "cancelled". [Vitest RTL]**
  **Given** a pushed sheet whose cancel has been dispatched (open intent) but whose mirror does not yet
  show `erp_cancelled_at`, **When** an approver views the sheet, **Then** the surface does NOT show an edit
  affordance (still `Approved`), does NOT show a "cancelled" badge, and DOES show a correction-in-progress
  / cancelling state naming the cancel's status. (FR-TSC-070)
- **AC-TSC-080 — The sweep does not re-push a re-opened sheet, does not replay a confirmed push for a
  tombstoned sheet, and quarantines a stale committing row. [served-fn e2e]**
  **Given** (a) a re-opened (`Draft`) sheet whose T1 is cancelled, (b) a still-`Approved` sheet with a PMO
  tombstone + open intent (mid-correction), and (c) a sheet with a stale `committing` push row,
  **When** the sweep ticks twice,
  **Then** (a) no `Timesheet` create fires for the Draft sheet; (b) no confirmed-push replay fires for the
  mid-correction sheet (the open intent excludes it; the tombstone is NOT cleared by a replay); (c) the
  stale `committing` row is quarantined, not naively re-POSTed. The ERP list shows `{T1 cancelled}` in both
  (a) and (b) — no `T1b` resurrection. (FR-TSC-080; finding 3)
- **AC-TSC-082 — A corrected sheet whose foreground re-push FAILED is still recovered by the sweep; a
  desk-cancelled sheet is not. [Playwright served-fn e2e]** *(spike-gated)*
  **Given** a sheet pushed as `T1`, re-opened (PMO cancel → confirmed → `Draft`, mirror tombstoned
  `cancel_origin='pmo'`), corrected to 32h, re-approved (t2), whose foreground re-push then FAILS
  (`push_state='failed'`, tombstone standing `cancel_origin='pmo'`),
  **When** the sweep ticks,
  **Then** the sweep re-drives the `T2` push under `ts:<id>:t2` (the widened `cancel_origin='pmo'`
  predicate let it through), `T2` reaches ERPNext, and the ERP project holds exactly one live Timesheet at
  32h — **never 0h** (silent week-loss) and **never 72h** (double-count). Separately, a desk-cancelled
  sheet (`cancel_origin='desk'`/null) with `push_state='failed'` is NOT re-created. (FR-TSC-082) *Cannot
  see: the discriminator column; CAN see recovered-vs-excluded behavior — an impl that drops ALL backstop
  recovery for failed-repush fails.*
- **AC-TSC-055 — [code review] The cancel does not route through any CREATE-shaped primitive.**
  A review assertion (not a runtime AC) that the cancel path branches off `finalizeOutboxRow`,
  `timesheetsWriter`, the push-anchor recovery probe, and the push-only served gate, and that no cancel
  state is described via `push_state`. (NFR-TSC-FENCE-001) *Cannot see: runtime behavior; this is the
  structural fence as a reviewable property, complementing the runtime ACs above.*

### Traceability (ADR-0010 — one owning layer per AC)

| AC | Requirement(s) | Owning layer | Planned proof |
|---|---|---|---|
| AC-TSC-020 | FR-TSC-020/021 | **pgTAP** | `supabase/tests/0152_timesheet_reopen_authority.test.sql` (independent fixture per actor) |
| AC-TSC-021 | FR-TSC-001, NFR-TSC-REG-001 | **pgTAP** | extend `0021..0026` transition battery |
| AC-TSC-007 | FR-TSC-005/006/007 | **Playwright (served-fn e2e)** | `e2e/serial/AC-TSC-007-cancel-requires-intent.spec.ts` |
| AC-TSC-008 | FR-TSC-008 | **Playwright (served-fn e2e)** | `e2e/serial/AC-TSC-008-cancel-confirmed-one-condition.spec.ts` |
| AC-TSC-009 | FR-TSC-009 | **Playwright (served-fn e2e)** | `e2e/serial/AC-TSC-009-pending-push-retired.spec.ts` |
| AC-TSC-010 | FR-TSC-010/011 | **Playwright (served-fn e2e)** | `e2e/serial/AC-TSC-010-reopen-blocked-while-live.spec.ts` |
| AC-TSC-011 | FR-TSC-030/050, NFR-TSC-IDEM-001 | **Playwright (served-fn e2e)** | `e2e/serial/AC-TSC-011-correct-and-repush-no-doublecount.spec.ts` *(spike-gated)* |
| AC-TSC-012 | FR-TSC-060 | **Playwright (served-fn e2e)** | `e2e/serial/AC-TSC-012-unpushed-reopen.spec.ts` |
| AC-TSC-032 | FR-TSC-032 | **Playwright (served-fn e2e)** | `e2e/serial/AC-TSC-032-server-resolved-target.spec.ts` |
| AC-TSC-040 | FR-TSC-040/041/050 | **Playwright (served-fn e2e)** | `e2e/serial/AC-TSC-040-generation-retention.spec.ts` *(moved from pgTAP)* |
| AC-TSC-041 | FR-TSC-050/051 | **Playwright (served-fn e2e)** | `e2e/serial/AC-TSC-041-repush-not-blocked.spec.ts` *(spike-gated)* |
| AC-TSC-042 | FR-TSC-042 | **Playwright (served-fn e2e)** | `e2e/serial/AC-TSC-042-cancel-finalizer-operation-aware.spec.ts` |
| AC-TSC-052 | FR-TSC-052/053 | **Playwright (served-fn e2e)** | `e2e/serial/AC-TSC-052-cancel-key-single-use.spec.ts` |
| AC-TSC-053 | FR-TSC-011/053 | **Playwright (served-fn e2e)** | `e2e/serial/AC-TSC-053-cancel-reconcile-pass.spec.ts` |
| AC-TSC-054 | FR-TSC-054 | **Playwright (served-fn e2e)** | `e2e/serial/AC-TSC-054-cancel-crash-recovery.spec.ts` |
| AC-TSC-055 | NFR-TSC-FENCE-001 | **code-review assertion** | (review checklist, not a runtime test) |
| AC-TSC-070 | FR-TSC-070 | **Vitest (RTL)** | `pages/Approvals.test.tsx` (extend) |
| AC-TSC-080 | FR-TSC-080 | **Playwright (served-fn e2e)** | `e2e/serial/AC-TSC-080-sweep-no-repush-no-replay.spec.ts` |
| AC-TSC-082 | FR-TSC-080/082 | **Playwright (served-fn e2e)** | `e2e/serial/AC-TSC-082-sweep-recovers-failed-repush.spec.ts` *(spike-gated)* |
| AC-TSC-091 | FR-TSC-091 | **Playwright (served-fn e2e)** | `e2e/serial/AC-TSC-091-desk-pmo-cancel-interleave.spec.ts` |
| AC-TSC-091 (auth/uniqueness/CAS) | FR-TSC-091 (DB contracts) | **pgTAP** | `supabase/tests/0154_lineage_cancel_unique_and_origin_cas.test.sql` |

> **Spike-gating:** AC-TSC-011/041/082 are spike-gated on OQ-TSP-1's frozen Timesheet field map (the
> re-push body is the spike's, not this spec's). AC-TSC-020/021/091(DB) are pure DB and NOT spike-gated;
> AC-TSC-007/008/009/010/012/032/040/042/052/053/054/070/080 cancel/read/authority only and are NOT
> spike-gated.

---

## 8. Error handling

| Condition | Classification | Required behavior |
|---|---|---|
| Re-open of a pushed sheet whose cancel is not confirmed | `P0001 'reopen-cancel-not-confirmed'` | Reject; sheet stays `Approved`; surface the cancel's status + retry (FR-TSC-008/010/011) |
| Re-open while a real ERP write is in flight (push `committing`/`committed`/`quarantined`/`held`) | `P0001 'reopen-push-in-flight'` | Reject; retry once settled (FR-TSC-009) |
| Owner re-opens their own approved sheet | `42501` | Reject inside the RPC before any state change; SoD-ordered (FR-TSC-020/021) |
| Bystander re-opens | `42501` | Reject (FR-TSC-020) |
| Raw `transition/cancel` POST with no open correction intent | `commit-rejected 'cancel-requires-correction-intent'` | Reject before any ERP call (FR-TSC-007) |
| Cancel with a client-supplied or foreign ERP target | `422` (`checkNoClientSuppliedTarget` / target-binding) | Reject before any ERP call (FR-TSC-032) |
| Cancel ERP-unreachable / rejected | classified (`external-unreachable` / etc.) | Cancel outbox `state='failed'` + reason; sheet stays `Approved`; correction-cancel pass re-drives the same `tsc:` key (FR-TSC-011/053) |
| Cancel of an already-cancelled T1 (desk did it first) | **skip (not an error)** | No ERP call; the origin CAS sees `cancel_origin='desk'`; PMO aborts as an idempotent no-op; proceed to Draft (FR-TSC-031/091) |
| Crash after ERP cancel commit, before finalization | (recovery) | Cancel-specific probe GETs T1, `docstatus=2` ⇒ success; finalize to capstone; no second cancel (FR-TSC-054) |
| Re-push while the cancelled mapping is still in place | `commit-rejected` (target-mapped) | Must not occur — FR-TSC-041 supersedes the mapping at cancel time; if it somehow occurs, fail closed (no second doc) |
| Stale inbound webhook for a cancelled generation (PMO already won) | **ack-and-skip** | Inbound desk path no-op on `cancel_origin='pmo'`; no double-tombstone (FR-TSC-090/091) |
| Re-opener authority lapsed between intent creation and the flip | `P0001 'reopen-authority-lapsed'` | `complete_timesheet_reopen` re-validates `intent.created_by`; surface for an operator (§4.2 #3) |

---

## 9. Risks — and what could go wrong with money

- **R-DOUBLE (the headline, F1).** Re-opening PMO while ERPNext still holds the wrong week live → the
  corrected week is pushed as a SECOND Timesheet → the client's project cost double-counts that week
  (40h + 32h = 72h). Mitigated by: the generation-specific cancel-confirmed gate (FR-TSC-008) enforced in
  the RPC under the named lock; proven at the real boundary against the ERP list (AC-TSC-011).
- **R-RESURRECT (finding 6 — the push finalizer writing a cancel).** A cancel routed through
  `timesheetsWriter` writes `push_state='pushed'`, copies `ts_number`, and CLEARS `erp_cancelled_at` — so a
  successful cancel makes PMO believe T1 is live. Mitigated by the operation-aware cancel finalizer
  (FR-TSC-042) + the NFR-TSC-FENCE-001 review assertion (AC-TSC-042/055).
- **R-REPLAY (finding 3 — the sweep replaying the old push as a correction opens).** A tombstoned-but-still
  -`Approved` sheet re-derives the old `ts:<id>:t1` key and the confirmed-replay clears the tombstone.
  Mitigated by excluding open-intent sheets from the push queue + the operation-aware finalizer owning the
  tombstone (FR-TSC-080; AC-TSC-080).
- **R-NO-OWNER (finding 4 — a failed cancel has no owner).** 0131 excludes failed `transition` rows; the
  generic pass skips timesheets; the push backstop has no `tsc:` path. Mitigated by the correction-cancel
  reconcile pass (FR-TSC-053; AC-TSC-053).
- **R-LOST-GEN (F4).** A re-push silently overwrites `ts_number` on the 1:1 mirror, losing the cancelled
  generation's identity. Mitigated by lineage retention (FR-TSC-040) + `caused_by`; proven the
  implementation wrote the lineage row (AC-TSC-040).
- **R-STUCK (the "pending cancel" anti-pattern F3 forbids).** Mitigated by F3 (no new PMO status — the
  sheet is `Approved` with the cancel outbox `failed` until the correction-cancel pass confirms it, then
  `Draft`) and F1 (fail closed with a named, retryable failure).
- **R-WEDGE (F8).** The sweep re-creating a cancelled ERP Timesheet. Mitigated by the tombstone exclusion
  + the `Approved`-only candidate query + the gate + the open-intent exclusion (FR-TSC-080).
- **R-LOST-SWEEP (F8, money — the converse R-WEDGE missed).** A corrected, re-approved sheet whose
  foreground re-push FAILS is tombstoned and excluded by the shipped predicate. Mitigated by FR-TSC-082
  (`cancel_origin` discriminator + widened predicate); proven by AC-TSC-082 on the real foreground-failure
  path.
- **R-CRASH-WINDOW (finding 9).** The ERP cancel commits but the finalizer dies before the capstone. ERP
  has T1 cancelled, PMO's mirror doesn't reflect it. **Fail-safe** (no Draft, no double-count) and
  **self-heals**: the cancel-specific recovery probe (FR-TSC-054) GETs T1, sees `docstatus=2`, finalizes.
  The user sees a transient "cancel reconciling" (F7).
- **R-AUTHORITY (F2, finding 7).** Re-open authority implemented only as a hidden button / FE gate, or a
  raw cancel POST bypassing it. Mitigated by server-side enforcement in the security-definer RPC + the
  intent-required cancel branch + pgTAP proof (FR-TSC-020/021/007; AC-TSC-020/007).
- **R-DOUBLE-CANCEL / R-ORIGIN-RACE (F9, finding 8).** PMO and desk cancel both tombstone → two lineage
  rows, or the wrong origin wins. Mitigated by the atomic origin CAS + lineage uniqueness (FR-TSC-091;
  AC-TSC-091).
- **R-TARGET-FORGERY (finding 5).** A client-supplied or foreign ERP target redirects the cancel.
  Mitigated by server-side resolution + the `REJECT_CLIENT_SUPPLIED_TARGET` guard (FR-TSC-032; AC-TSC-032).

---

## 10. Open questions for the owner (with recommendations — none invented-around)

1. **OQ-TSC-1 — Is the deliberate exception to FR-TSP-006 (re-open of a *pushed* sheet depends on ERP
   liveness) acceptable?** **Recommendation: accept** — scoped, named, fail-closed; the money invariant
   outranks the liveness invariant here.
2. **OQ-TSC-2 — `caused_by` on `external_ref_lineage`?** **Recommendation: add** (§4.4) — the cleanest
   record of the re-opener at the history row; fallback is the intent's `created_by` join.
3. **OQ-TSC-3 — At re-open, clear or repoint the superseded `external_refs` mapping?** **Recommendation:
   clear** after writing the lineage row — gen1 is preserved in lineage + ERP; the mapping is re-created on
   the re-push. (Differs from FR-TSP-084's desk-cancel retain — there the sheet stays `Approved` and is
   never re-pushed.)
4. **OQ-TSC-4 — One new security-definer RPC, or extend `transition_timesheet`?** **Recommendation: both,
   split by concern (r2).** `transition_timesheet` keeps the single map entry + the `Approved→Draft` authz
   arm + the cancel-confirmed gate (one approval authority — the P3b invariant, OQ-TSC-4's reasoning). A
   dedicated `reopen_approved_timesheet` RPC owns the TWO-SYSTEM orchestration (authority → retire-pending
   → create-intent → enqueue-cancel) that does not fit a single transition statement, plus
   `confirm_timesheet_cancel` / `complete_timesheet_reopen` for the finalizer/service-role flip. The map
   stays the sole PMO-status authority; the reopen RPCs are the money-operation choreography around it.
5. **OQ-TSC-5 (new in r2) — Is the machinery this feature needs more than P3b has?** **Honest answer:
   yes.** P3b shipped a CREATE-shaped push path. A money-safe cancel needs a first-class cancel operation
   (intent + operation-aware finalizer + reconcile pass + recovery probe + atomic origin CAS + lineage
   uniqueness + a named per-timesheet lock). This spec specifies that machinery in full (§4–§5) rather
   than reducing scope to make the review pass. The owner should confirm the scope before build.

---

## 11. Self-verification (against the brief)

- **The cancel is specified as its own first-class operation (the fence):** own INTENT (FR-TSC-005/006,
  §4.1), own reconcile pass (FR-TSC-053), own operation-aware finalizer (FR-TSC-042), own recovery probe
  (FR-TSC-054). It stops reusing push-shaped parts and stops describing cancel in terms of `push_state`
  (NFR-TSC-FENCE-001, AC-TSC-055).
- **Every fence F1..F9 maps to ≥1 numbered requirement** (see §11 of r1, still accurate; r2 ADDS
  FR-TSC-005/006/007/008/009/032/042/053/054/091 and AC-TSC-007/008/009/032/042/053/054/055/091).
- **Every AC names exactly one owning layer** (§7 table); AC-TSC-011/041/082 are flagged spike-gated.
- **No AC is of an audit-program shape:** #5 (assert request not result) — money ACs read the ERP list;
  #6 (fake impossible state) — AC-TSC-040 requires the implementation to write the lineage row;
  #7 (mutation survives) — same. AC-TSC-052's impossible `23505` assertion is REMOVED (SHOULD-FIX).
- **No AC that a broken implementation could still pass:** each new AC records what it is structurally
  unable to see, and each asserts a RESULT (ERP list / mirror-outbox-lineage state), never a mechanism a
  broken impl could satisfy by shape alone. AC-TSC-055 is explicitly a code-review assertion, not a
  runtime test (it cannot be — the fence is structural).
- **Nothing weakened:** FR-TSP-084 (never fight the accountant) is preserved and reinforced (FR-TSC-091's
  desk-wins CAS); the money-honesty invariant is preserved (FR-TSC-070); `DETERMINISTIC_KEY_RE` /
  `isOpaqueIdempotencyKey()` is NOT widened (r2 depends on it — FR-TSC-052).

---

## 12. Deviations reported (not hidden)

- **r1's central assumption is withdrawn.** r1 assumed the cancel rides the shipped push machinery. It
  cannot (findings 3/4/5/6/9 — five faces of one mistake). r2 re-specifies the cancel as first-class.
- **FR-TSC-081's tolerance of a bare `pending` push is withdrawn** (finding 2): `pending` is retired
  atomically (FR-TSC-009).
- **AC-TSC-040 moved from pgTAP to served-fn e2e** (SHOULD-FIX): the lifecycle is edge-fn code.
- **AC-TSC-052 re-spec'd** (SHOULD-FIX): the impossible `23505` assertion is removed.
- **AC-TSC-020 fixed** (NOTE): independent `Approved` fixture per actor.
- **New owning ACs added** for the failure/crash/race cases r1 left unowned (SHOULD-FIX): AC-TSC-053
  (ERP-rejected/unreachable), AC-TSC-009 (pending-row race), AC-TSC-054 (crash after cancel commit),
  AC-TSC-091 (desk-during-PMO).
- **Migration range expanded** from `0151` to `0151`–`0153` (intent table; transition+cancel_origin;
  lineage uniqueness+caused_by). OQ-TSC-5 flags the scope honestly.

---

## 13. The Approved-terminal sweep (binding — the highest-value part of this round)

> The instruction: `Approved` stops being terminal the moment this spec ships. Find EVERY shipped site
> whose safety rests, explicitly or implicitly, on `Approved` being terminal / on a timesheet never leaving
> `Approved` / on `approved_at` being immutable once set / on `erp_cancelled_at` meaning *only* a desk
> cancel. Add a numbered requirement per site. **The grep, the comments, and the verdict for each site are
> below.** Two premises were checked and CLEARED (not load-bearing); they are stated as claims.

### Sites that NEED a requirement (the premise is load-bearing and this feature deletes it)

1. **`supabase/functions/erpnext-sweep/index.ts:383–393` — the EXPLICIT comment (the one quoted in the
   brief).** The generic outbox reconcile pass skips the `timesheets` domain partly because *"`transition_
   timesheet`'s map makes `Approved` TERMINAL … so an approval cannot be revoked behind a frozen payload's
   back."* This feature deletes that premise. **Requirement (FR-TSC-053 + this note):** the generic pass
   MUST remain excluded for `timesheets` (the domain-specific passes own it), AND the comment MUST be
   rewritten so its safety rests on *"the correction-cancel pass owns cancels and re-asserts the intent
   (FR-TSC-053); the push pass re-asserts `approved_timesheet_for_push`"* — NOT on Approved-terminal. A
   reviewer must not be able to re-add `timesheets` to the generic pass on the strength of a now-false
   premise. *(Re-read: `erpnext-sweep/index.ts:376–399`.)*

2. **`supabase/functions/erpnext-sweep/index.ts` `listPendingTimesheetPushes` (~`1429–1455`) — the mirror
   candidate query `.in('push_state',['pending','failed']).is('erp_cancelled_at', null)`.** Implicit
   premise: `erp_cancelled_at == desk cancel == permanent`, and a pushed sheet stays `Approved`. Both are
   now false (PMO cancel also tombstones; a sheet can be `Approved`-with-a-PMO-tombstone mid-correction).
   **Requirement (FR-TSC-080 dir 2 + FR-TSC-082):** the push queue must EXCLUDE any sheet with an OPEN
   correction intent for its current generation (no replay of the old push as a correction opens —
   finding 3), the confirmed-replay path must NOT clear the tombstone for the timesheets domain, AND the
   predicate widens to `cancel_origin='pmo'` for the failed-repush-recovery case. *(Re-read:
   `erpnext-sweep/index.ts:1429–1455`, `1519–1569`; `readModelWriters.ts:891–916`.)*

3. **`supabase/functions/adapter-dispatch/readModelWriters.ts:891–916` — `timesheetsWriter`.** Unconditionally
   writes `push_state='pushed'`, copies `ts_number`, clears `erp_cancelled_at` (M-1). Premise: every
   outbox finalize is a CREATE. **Requirement (FR-TSC-042, NFR-TSC-FENCE-001):** a cancel MUST NOT route
   through `timesheetsWriter`; the operation-aware cancel finalizer owns the tombstone. *(Re-read:
   `readModelWriters.ts:884–916`.)*

4. **`pmo-portal/src/lib/adapterSeam/dispatch.ts:218–246` — `finalizeOutboxRow` (generic
   `recordOutboxRef → convergeReadModel → confirmOutbox`).** Premise: every finalize writes a live mapping
   + a pushed mirror. **Requirement (FR-TSC-042):** the cancel branches off this finalizer; the cancel's
   capstone is `confirm_timesheet_cancel`. *(Re-read: `dispatch.ts:218–246`.)*

5. **`pmo-portal/src/lib/adapterSeam/erpnext/lineage.ts:46–57` (`applyCancel`: resolve→tombstone→record
   as SEPARATE calls) + `supabase/functions/_shared/erpnextFeedDeps.ts:150–165` (`tombstoneMirror`:
   unconditional `.update(…)`).** Premise: only ONE writer (the inbound desk feed) ever tombstones a
   timesheet, so no CAS / no lineage uniqueness is needed. **Requirement (FR-TSC-091):** atomic origin CAS
   that returns the winner + `external_ref_lineage_one_cancelled_per_generation` uniqueness + `ON CONFLICT
   DO NOTHING`; both interleavings tested (AC-TSC-091). *(Re-read: `lineage.ts:1–57`;
   `erpnextFeedDeps.ts:140–175`.)*

6. **The recovery probe searches the push anchor (`note`) for the idempotency key**
   (`pmo-portal/src/lib/adapterSeam/erpnext/recoveryProbe.ts` + `client.ts:83`; spike §2: anchor = `note`,
   `anchorMutable: false`). Premise: every recoverable money command stamped ITS key into the anchor. A
   cancel stamps no key into T1. **Requirement (FR-TSC-054):** cancel-specific recovery (GET
   `resolved_target`, `docstatus=2` ⇒ success), never the push-anchor probe. *(Re-read: spike §2;
   `recoveryProbe.ts`; `client.ts:80–90`.)*

7. **`supabase/functions/adapter-dispatch/transitionTargetGuard.ts:50–132` —
   `checkTransitionTargetBinding` / `checkNoClientSuppliedTarget`.** Rejects a PRESENT client target for
   `timesheets`, permits an ABSENT one, NEVER injects the resolved name. Premise: a timesheet transition
   never needs server target resolution (the only shipped timesheet "transition" was none — cancel/amend
   shipped for SI/PE). **Requirement (FR-TSC-032):** the served path resolves the target server-side and
   stamps it into the cancel outbox payload; the timesheet-cancel adapter path reads it; a client/foreign
   target is rejected. *(Re-read: `transitionTargetGuard.ts:40–132`.)*

8. **`supabase/functions/adapter-dispatch/approvalGuard.ts:46–49` (`isTimesheetPush` keys on
   `domain+erp_doc_kind`) + `index.ts:704–719` (the served gate).** A cancel has
   `erp_doc_kind:'timesheet'`, so `isTimesheetPush` is TRUE for it — the only served gate is
   `enforceTimesheetApproved` → `approved_timesheet_for_push` (Approved status + PUSH authz: historical
   approver OR Admin/Executive/PM/Finance). Premise: every timesheets-domain command is a push. **Requirement
   (FR-TSC-007):** the served path branches on operation; a cancel requires an OPEN correction intent, not
   the push gate. *(Re-read: `approvalGuard.ts:40–80`; `index.ts:700–720`.)*

### Premises CHECKED and CLEARED (stated as claims — the owner may verify)

9. **`approved_at` immutability once set — NOT load-bearing (cleared).** `0007:127–128` stamps
   `approved_at = case when p_to in ('Approved','Rejected') then now() else approved_at end` — it is set
   fresh on EACH approval and NOT cleared on a `→Draft` transition. The push key's own comment
   (`timesheetPushKey.ts`) states verbatim *"a sheet can legitimately be re-approved … the `approved_at`
   witness makes each approval its own command"* — so re-approval producing a new `approved_at` (t2) is
   already handled, and the deterministic key `ts:<id>:t2` is distinct from `ts:<id>:t1`. **No code assumes
   `approved_at` is immutable once set; no requirement needed.** *(Re-read: `0007:62–130`;
   `timesheetPushKey.ts:1–50`; `0138:60–100` (reads current `approved_at`, does not assume immutability).)*

10. **The budget domain's MEDIUM-G tombstone (`erp_cancelled_at`) — NOT affected (cleared, out of scope).**
    Budget (`budget_versions`: Draft/Active/Archived) has NO PMO-initiated cancel/re-push cycle, so its
    `erp_cancelled_at == permanent-desk-cancel` premise stays intact. The budget sweep pass
    (`reconcileOrgBudgetPushes`) and budget writer are unchanged. **No requirement needed; stated so the
    owner can confirm budget was checked and deliberately excluded.** *(Re-read: `readModelWriters.ts`
    budgetWriter; the spec's §5.4 FR-TSC-082 note.)*

11. **RLS `status='Draft'` editing policies (`0002_rls.sql:169–180`) — NOT affected (cleared).** A
    re-opened sheet IS `Draft` and its owner DOES correct entries — the `status='Draft'`-gated
    `timesheet_entries` edit policy is the intended behavior, not a violated premise. **No requirement
    needed.** *(Re-read: `0002_rls.sql:160–185`.)*

> **If I found a site beyond these, I would list it. I did not.** Sites 1–8 are every load-bearing
> Approved-terminal / never-leaves-Approved / desk-only-tombstone premise I could find by grepping
> `terminal`, `Approved`, `approved_at` immutability, `erp_cancelled_at`, `ts_number`, and reading the
> comments at each hit. Sites 9–11 are the premises I checked and cleared, stated as falsifiable claims.

---

## 14. Finding → requirement/AC → re-read evidence

| # | Finding (one line) | FR/AC that now answers it | file:line re-read (this author) |
|---|---|---|---|
| 1 | "Cancel confirmed" must be ONE durable generation-specific condition, serialized by a named lock | **FR-TSC-008**, AC-TSC-008; §4.2 #3 | `dispatch.ts:218–246,457–466`; `0096:196–207`; `0134:52–55`; `0138` |
| 2 | A `pending` push can post after Draft and wedge the next generation (`one_inflight_per_record` includes `pending`) | **FR-TSC-009** (withdraws FR-TSC-081's pending tolerance), AC-TSC-009 | `0138:45–47`; `dispatch.ts:511–519`; `0134:52–55`; `erpnext-sweep:1391–1399` |
| 3 | `cancel_origin='pmo'` is not a generation discriminator; the sweep replays the old push / treats a failed cancel as a failed create | **FR-TSC-080 dir 2**, FR-TSC-082 (reframed), AC-TSC-080 | `erpnext-sweep:1429–1455,1519–1569`; `readModelWriters.ts:891–912` |
| 4 | No sweep owner for a failed correction cancel (0131 excludes failed `transition`; generic pass skips timesheets; backstop has no `tsc:` path) | **FR-TSC-053**, AC-TSC-053 | `0131:42–61`; `erpnext-sweep:376–393,1519–1569` |
| 5 | Server-resolved cancel target cannot pass the shipped command path (guard never injects; adapter throws without `externalRecordId`) | **FR-TSC-032**, AC-TSC-032 | `transitionTargetGuard.ts:50–132`; `adapter.ts:157–165`; `dispatchFactory.ts:412–422` |
| 6 | Generic finalization writes a cancel as a fresh live push (`timesheetsWriter`: pushed/ts_number/clears `erp_cancelled_at`) | **FR-TSC-042**, NFR-TSC-FENCE-001, AC-TSC-042/055 | `dispatch.ts:218–246`; `readModelWriters.ts:891–916` |
| 7 | Cancel exposed without re-open authority or a one-time correction intent (`isTimesheetPush` gates it as a push) | **FR-TSC-005/006/007**, AC-TSC-007 | `approvalGuard.ts:46–49`; `index.ts:704–719`; `0138:76–84`; `adapter.ts:175–182` |
| 8 | Desk/PMO cancel ordering is not atomic; no lineage uniqueness | **FR-TSC-091**, §4.4, AC-TSC-091 | `erpnextFeedDeps.ts:150–165`; `lineage.ts:46–57`; `0096:82–94` |
| 9 | ADR-0058 anchor recovery cannot recover a crashed cancel (no key in T1; ERPNext 417 on re-cancel) | **FR-TSC-054**, AC-TSC-054 | `adapter.ts:175–182`; `dispatch.ts:489–501`; spike `2026-07-20-…md` §2, §6 |
| S1 | AC-TSC-052 asserted an impossible `23505` mechanism | AC-TSC-052 **re-spec'd** (SHOULD-FIX) | `erpnext-sweep:1519–1521`; `dispatch.ts:533–556` |
| S2 | AC-TSC-040 owned by a layer that cannot execute the claimed writer | AC-TSC-040 **moved to served-fn e2e** (SHOULD-FIX) | `lineage.ts`; `erpnextFeedDeps.ts`; `readModelWriters.ts` |
| S3 | Failure/crash/race cases had no owning AC | AC-TSC-053/009/054/091 **added** (SHOULD-FIX) | (new — see their FRs) |
| N1 | AC-TSC-020 internal sequencing (M and A on one sheet) | AC-TSC-020 **fixed**: independent fixture per actor (NOTE) | — |

---

## 15. Approved-terminal sweep — result (restated, separately, as the brief requires)

**Every site found, and what was specified for it:**

| Site | file:line | Premise deleted by this feature | Requirement added |
|---|---|---|---|
| 1 | `erpnext-sweep/index.ts:383–393` | "Approved is terminal ⇒ generic pass can skip timesheets" | FR-TSC-053 + comment rewrite (§13.1) |
| 2 | `erpnext-sweep/index.ts:1429–1455` | "erp_cancelled_at == desk cancel == permanent; pushed sheet stays Approved" | FR-TSC-080 dir 2 + FR-TSC-082 (§13.2) |
| 3 | `readModelWriters.ts:891–916` | "every finalize is a CREATE" | FR-TSC-042 / NFR-TSC-FENCE-001 (§13.3) |
| 4 | `dispatch.ts:218–246` | "every finalize writes a live mapping + pushed mirror" | FR-TSC-042 (§13.4) |
| 5 | `lineage.ts:46–57` + `erpnextFeedDeps.ts:150–165` | "only the desk feed tombstones" | FR-TSC-091 + §4.4 uniqueness (§13.5) |
| 6 | `recoveryProbe.ts` / `client.ts:83` + spike §2 | "every recoverable command stamped its key into the anchor" | FR-TSC-054 (§13.6) |
| 7 | `transitionTargetGuard.ts:50–132` | "timesheet transitions never need server target resolution" | FR-TSC-032 (§13.7) |
| 8 | `approvalGuard.ts:46–49` + `index.ts:704–719` | "every timesheets command is a push" | FR-TSC-007 (§13.8) |

**Premises checked and CLEARED (claims the owner may verify — "I found none beyond these" for these
classes):**
- `approved_at` immutability once set — **not load-bearing** (§13.9): `0007` sets it fresh per approval;
  the push key comment already handles re-approval; `0138` reads the current value.
- Budget MEDIUM-G tombstone — **not affected** (§13.10): budget has no PMO cancel; unchanged.
- RLS `status='Draft'` edit policies — **intended behavior** (§13.11): a re-opened sheet is Draft and
  editable by its owner.

I did not find any load-bearing Approved-terminal / never-leaves-Approved / approved_at-immutable /
desk-only-tombstone premise beyond sites 1–8 above. Sites 9–11 are the classes I checked and cleared,
stated explicitly so the claim is falsifiable.

SPEC-FIX-DONE
