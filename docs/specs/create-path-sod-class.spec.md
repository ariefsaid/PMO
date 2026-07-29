# Spec — close the create-path SoD hole across the whole class (slices 2 + 3 + 4)

**Status:** drafted 2026-07-28 (Director), owner instructed "fix all of them"
**Slice 1:** `docs/specs/project-create-sod.spec.md` (`projects` only) — implemented separately
**Relates to:** ADR-0019 (server-enforced SoD), ADR-0020, ADR-0027, **ADR-0069** (`actor_bypasses_rls()`)

> ⚑ **SECOND CORRECTION, 2026-07-29 — the class was declared closed TWICE and was not closed either
> time. Slice 4 (`0176`) is §8 below.** Both earlier sweeps looked for a *shape* (asymmetric grants;
> then asymmetric policies) rather than for the *rule*, and so missed five more instances plus a
> logic defect in every guard shipped so far. **The sweep that finds this class is: for every rule a
> transition RPC enforces, ask "what else can put the row into that state?"** A blanket grant
> (`sales_invoices`), a guard on the wrong column (`project_documents.author_id`), a state the RPC
> never validates (`projects.contract_value`), an untouched table (`budget_versions`) and an **RPC
> parameter** (`create_procurement_invoice(p_status)`) are all answers — and none of them is a grant
> asymmetry.

> ⚑ **CORRECTION, 2026-07-29 — this spec was wrong about the scope of the fix, and slice 3 exists to
> repair that.** Everything below was written as an **INSERT-path** spec, because the class was
> characterised as "SoD is enforced on the UPDATE path, the INSERT path is left open". For
> `procurement_invoices` / `procurement_receipts` / `procurement_quotations` and for `timesheets` that
> premise was false: the UPDATE path was **not** enforcing either. `0010` narrowed those three child
> tables' UPDATE grant to a column list that still contained exactly the dangerous columns
> (`.status`, `.status`, `.is_selected`), `0075` re-mirrored that list verbatim, and
> `timesheets_update_own` pins only org/owner/`Draft` — it never constrained `approved_by` /
> `approved_at`. So after slice 2 (`0174`) **every forgery §2 enumerates was still reachable in two
> requests instead of one**, verified live against the local DB.
>
> **Slice 3 = `0175_update_path_sod_class.sql`**, proven by
> `supabase/tests/0168_update_path_sod_class.test.sql`: it revokes the client UPDATE grant on the
> three child tables entirely (no re-grant — the caller survey found no client UPDATE at all),
> narrows `timesheets` UPDATE to the columns that do have callers, and adds the `approved_at` branch
> `0174`'s create guard was missing. Read §5–§6 below as **slice 2's** acceptance criteria; slice 3's
> live in the `0168` test file.

---

## 1. The class

Slice 1 fixed `projects`. A security sweep over the live catalog found the **same defect on five more
tables**, plus one local-only hygiene issue. Every one is **pre-existing and live in production
today** — none is introduced by the current branch (`0169` even documents the `projects` case in a
comment).

**The general shape:** a workflow's Separation-of-Duties is enforced on the UPDATE path and by a
`security definer` RPC, and the **INSERT path is left open** — so an attacker does not transition
into the protected state, they simply *create a row already in it*. No transition runs, so no SoD
check runs and no audit row is written.

⚑ **Two variants, and the second is invisible to the obvious query.**
- **Variant A — asymmetric grants.** `UPDATE` is granted on a restricted column list; `INSERT` is
  blanket. Detectable by set-subtracting `information_schema.column_privileges`.
- **Variant B — symmetric grants, asymmetric policies.** Grants are identical on both paths, but the
  `INSERT` **policy** omits a constraint the `UPDATE` policy carries. `timesheets` is this: the
  column-privilege query finds nothing, and it was caught only by reading the policies.
  **Any future sweep for this class must do both.**

---

## 2. Findings, each with a live probe

All probes run as `authenticated` with the relevant profile's JWT claims, inside `BEGIN … ROLLBACK`.

### 2.1 `procurements` — **Critical, reachable by Engineer** (FR-CPS-010)
`procurements_insert` has **no role gate at all**, while `procurements_update` does. An **Engineer** —
the lowest write role — inserted:

```
 status | self_approved | po_number       audit rows: 0
 Paid   | t             | PO-FORGED-ENG
```

Terminal money state, `requested_by_id = approved_by_id`, and a `po_number` that bypasses the
`next_procurement_doc_number` sequence. Defeats **two** SoD rules whose own comments mark them
inviolable (requester≠approver, approver≠payer). *Worse than the `projects` case in slice 1.*

### 2.2 `project_documents` — High (FR-CPS-020)
A PM inserted a document at `status='Approved'` with `author_id` = self, defeating the approver≠author
check in `transition_document_status` — commented *"MUST stay — it is the segregation of duties being
enforced"* — and skipping the `log_audit` that RPC writes. 0 audit rows.

### 2.3 `procurement_invoices` / `procurement_receipts` / `procurement_quotations` — High (FR-CPS-030)
⚑ **For these three the grant asymmetry is NOT the defect** — their dangerous columns
(`procurement_invoices.status`, `procurement_receipts.status`, `procurement_quotations.is_selected`)
are granted on **both** paths, so they never appear in the withheld set. **Narrowing INSERT to match
UPDATE would not fix them.** The real defect: the `create_procurement_*` / `select_procurement_quote`
security-definer RPCs are **not the only granted path**. Probes forged `amount=888888` + `status='Paid'`
+ `erp_docstatus=1`, a `gr_number` driving 3-way match, and a pre-selected quote that never passed
`select_procurement_quote`'s stage+role gate.

⚑ **And this paragraph then drew the wrong conclusion.** Having correctly observed that the dangerous
columns are granted on **both** paths, the fix (FR-CPS-030, `0174`) revoked **INSERT only** — leaving
the other half of the very asymmetry it had just described. Re-verified live at `0174`, as a plain
Project Manager: `update procurement_invoices set status='Paid'` → `UPDATE 1`;
`update procurement_receipts set status='Complete'` → `UPDATE 1`;
`update procurement_quotations set is_selected=true, total_amount=1` → `UPDATE 1`. Closed by slice 3
(`0175`), which revokes UPDATE on all three with **no** re-grant — the caller survey (FE DAL, edge
functions, e2e helpers, importers) found **zero** client UPDATEs; every writer is either a definer RPC
or the service-role read-model writer.

The RLS `WITH CHECK` carries `NOT domain_externally_owned(...)` and a mirror guard, but
`external_domain_ownership` is **empty**, so both are **currently no-ops**. A guard that is inert
until an unrelated table is populated is not a control.

### 2.4 `timesheets` — Medium, **variant B** (FR-CPS-040)
`timesheets_update_own` correctly pins `status='Draft'` in both `USING` and `WITH CHECK`;
`timesheets_insert` constrains only `user_id`. An Engineer inserted their own sheet already
`status='Approved', approved_by=self`, defeating a check commented *"even an Admin can never approve
their own timesheet… Do not reorder."*

⚑ **"Correctly pins" was too generous.** `timesheets_update_own` pins org/owner/`Draft` and nothing
else, and the grant was table-wide, so an Engineer could `update timesheets set approved_by=<self>,
approved_at=now()` on their **own Draft sheet** — verified live at `0174` → `UPDATE 1`. Because
`transition_timesheet`'s `Draft → Submitted` branch deliberately leaves `approved_by`/`approved_at`
as-is, the forged approver **survived into `Submitted`** and was visible to
`approved_timesheet_for_push`. `0174`'s own trigger message ("the approver is stamped only by
`transition_timesheet`") was therefore false until slice 3 (`0175`) withheld both columns from the
UPDATE grant and added the missing `approved_at` branch to the create guard.

**Materiality is bounded, and the bound was verified:** `timesheet_entries_write` requires the parent
sheet be `Draft`, so the forged sheet **cannot carry hours**; and there is no DELETE policy on
`timesheets`, so delete-and-reinsert fails. Impact is a phantom zero-hour approved sheet, reachable by
`approved_timesheet_for_push`. Real, not urgent — **fix it in the same slice because it is the same
class, not because it is severe.**

### 2.5 `dblink` reachable by `anon` — **local/CI only** (FR-CPS-050)
`dblink` is installed **in `public`** on the shared dev DB with `EXECUTE` to `anon` and
`authenticated`. **No migration creates it** — `supabase/tests/0163_automation_cap_race.test.sql`
does (`create extension if not exists dblink;`) and the DDL survives the test.

Escalation was probed and **blocked**: loopback-as-`postgres` fails dblink's own `password_required`
check. Residual risk is outbound connections from `anon`, and the precedent of **a test permanently
mutating the shared database**. Production should be clean — **that must be verified against the prod
catalog, not assumed.**

---

## 3. Requirements (EARS)

- **FR-CPS-010** — The system shall reject any INSERT into `procurements` that is not an
  origination row: `status` must be `Draft` and `approved_by_id` must be NULL. The INSERT path shall
  additionally carry the same role gate as the UPDATE path.
- **FR-CPS-011** — The system shall withhold INSERT privilege on
  `status, approved_by_id, approval_notes, rejection_notes, po_number, pr_number, vendor_invoiced_at`
  from `authenticated`.
- **FR-CPS-020** — The system shall reject any INSERT into `project_documents` whose `status` is not
  the origination status.
- **FR-CPS-030** — The system shall withhold INSERT privilege on `procurement_invoices`,
  `procurement_receipts` and `procurement_quotations` from `authenticated`.
- **FR-CPS-031** *(slice 3, `0175`)* — The system shall **also** withhold UPDATE privilege on those
  three tables from `authenticated` and `anon`, with no re-grant, leaving the existing
  `create_procurement_*` / `select_procurement_quote` definer RPCs as the only client **INSERT and
  UPDATE** path. *(This is the sentence FR-CPS-030 claimed and did not deliver.)*
  ⚑ **STILL OPEN — DELETE.** Not "the only *write* path": `authenticated` retains a table DELETE
  grant (`0075`) plus a permissive DELETE policy on each of the three, so a plain Project Manager can
  `delete from procurement_invoices` a **Paid** invoice — verified live at `0175`. `timesheets` is
  closed by RLS (no DELETE policy → `DELETE 0`). Left open deliberately: the right shape is an
  ADR-0018 / ADR-0019 decision (soft-archive vs Admin-only destructive delete vs definer RPC), not a
  grant tweak inside an UPDATE-path slice. Current state pinned by `0168` §J; tracked in
  `docs/backlog.md`.
- **FR-CPS-040** — The system shall reject any INSERT into `timesheets` whose `status` is not `Draft`
  or which supplies a non-NULL `approved_by` or `approved_at`.
- **FR-CPS-041** *(slice 3, `0175`)* — The system shall withhold UPDATE privilege on
  `timesheets.approved_by` and `timesheets.approved_at` from `authenticated`, re-granting UPDATE only
  on `id, org_id, user_id, week_start_date, status, submitted_at` (the columns with real callers).
- **FR-CPS-050** — `supabase/tests/0163_*.test.sql` shall not leave `dblink` installed in `public`
  with EXECUTE to `anon`. **A test shall not permanently mutate the shared database.**
- **FR-CPS-060** — Every INSERT into `procurements`, `project_documents` and `timesheets` shall write
  an `audit_events` row.
- **NFR-CPS-001** — Enforcement in the database. A FE-only check satisfies nothing here.
- **NFR-CPS-002** — **No legitimate caller may break.** Established by reading every caller (§4).

---

## 4. Why this breaks no caller (verified, not assumed)

- `procurements` — the only direct FE insert is `src/lib/db/procurementCrud.ts:78` `createProcurement`,
  which **already hardcodes `status: 'Draft'`** and never sets `approved_by_id`.
- `project_documents` — `src/lib/db/documents.ts:94` `createProjectDocument` **does not set `status`
  at all** (column default applies).
- `procurement_invoices` / `receipts` / `quotations` — **zero direct FE inserts.** The app already
  goes through the definer RPCs, which is why revoking table INSERT is the clean fix rather than a
  disruptive one.
- `timesheets` — `src/lib/db/timesheets.ts:94` `createDraftTimesheet` **hardcodes `status: 'Draft'`**
  and never sets `approved_by`. Verified by reading it, 2026-07-28.

⚑ All four were verified by reading the caller, not inferred from the table name. If the implementer
finds any of these statements false, **stop and report** — do not adjust the rule to fit the caller.
That inversion is how the FE-only guard in slice 1 came to exist.

---

## 5. Acceptance criteria (Given/When/Then) — all pgTAP

- **AC-CPS-010** — Given an **Engineer**, when they INSERT a procurement with `status='Paid'` and
  `approved_by_id` = self, then it is rejected naming the rule, and no row exists.
- **AC-CPS-011** — Given a PM, when they INSERT a procurement with `status='Approved'`, then rejected.
- **AC-CPS-012** — Given any write role, when they INSERT a `Draft` procurement with
  `approved_by_id` NULL, then it **succeeds**. *(No-over-blocking control.)*
- **AC-CPS-013** — Given `authenticated`, then no INSERT privilege exists on the FR-CPS-011 columns.
- **AC-CPS-020** — Given a PM, when they INSERT a `project_documents` row at `status='Approved'`,
  then rejected. **AC-CPS-021** — a `Draft` document still inserts. *(Control.)*
- **AC-CPS-030** — Given `authenticated`, then no INSERT privilege exists on the three child tables.
  **AC-CPS-031** — the `create_procurement_invoice` RPC still succeeds end-to-end. *(Control — this is
  the AC that catches an over-broad revoke.)*
- **AC-CPS-040** — Given an Engineer, when they INSERT a timesheet at `status='Approved'` with
  `approved_by` = self, then rejected. **AC-CPS-041** — a `Draft` sheet still inserts, and
  `save_timesheet_week` still works end-to-end. *(Control.)*
- **AC-CPS-050** — After a full `supabase db reset` + `supabase test db`, `dblink` is **not** present
  in `public` with EXECUTE to `anon`.
- **AC-CPS-060** — Each successful origination INSERT writes exactly one `audit_events` row.
- **AC-CPS-070** — Every pre-existing SoD proof still passes: `transition_procurement`,
  `transition_document_status`, `select_procurement_quote`, `transition_project`,
  `approved_timesheet_for_push`. *(Regression control.)*

**Mutation requirement (binding).** For every AC, state the change that makes it fail and **run it**.
Assert **message text**, not errcode alone. This repo has shipped pgTAP proofs that stayed green with
the guard deleted — one because the CHECK raised the same errcode, one because the regex matched the
phrase in a SQL **comment**. Strip comments where matching on source.

---

## 6. Explicitly out of scope

- Retro-remediating existing rows. Migrations **warn with a count**; disposition is an owner call
  (OD-PCS-1, still open from slice 1).
- Verifying the **production** catalog for FR-CPS-050 — that is an owner-run check against prod, not
  something this slice can do.

---

## 7. Traceability

| Req | AC | Layer |
|---|---|---|
| FR-CPS-010 | AC-CPS-010, 011, 012 | pgTAP |
| FR-CPS-011 | AC-CPS-013 | pgTAP |
| FR-CPS-020 | AC-CPS-020, 021 | pgTAP |
| FR-CPS-030 | AC-CPS-030, 031 | pgTAP |
| FR-CPS-040 | AC-CPS-040, 041 | pgTAP |
| FR-CPS-050 | AC-CPS-050 | pgTAP / reset+test |
| FR-CPS-060 | AC-CPS-060 | pgTAP |
| NFR-CPS-002 | AC-CPS-012, 021, 031, 041, 070 | pgTAP |
| FR-RES-010/011/012 | AC-RES-010..019 | pgTAP (`0169`) |
| FR-RES-020/021 | AC-RES-020..025 | pgTAP (`0169`) |
| FR-RES-030 | AC-RES-030, 031 | pgTAP (`0169`) |
| FR-RES-040 | AC-RES-040, 041, 042 | pgTAP (`0169`) |
| FR-RES-050 | AC-RES-050, 051, 052 | pgTAP (`0169`) |
| FR-RES-060 | AC-RES-060, 070, 071 | pgTAP (`0169`) |

---

## 8. Slice 4 — the residuals (`0176_create_path_sod_residuals.sql`, proven by `supabase/tests/0169_create_path_sod_residuals.test.sql`)

Found by a three-reviewer battery run **after** slice 3 declared the class closed. Every item was
verified by a live probe against the local DB at `0175` before a line was written.

### 8.1 Findings

- **`sales_invoices` — CRITICAL, the SoD was defeated end-to-end.** `0123` granted `authenticated` a
  blanket `select, insert, update, delete` and relied on the per-command **flip** policies as "the
  real gate". They gate nothing for an org that is not flipped — i.e. every org today
  (`external_domain_ownership` is empty) — and the `0123`/`0125` mirror guard only fires *while*
  flipped. Two distinct forgeries:
  1. a **Project Manager** (not even an AR role) inserted `status='Paid'`, `amount=777777`,
     `si_number='SI-FORGED-001'`, `erp_docstatus=1` in **one statement**, with **zero** audit rows;
  2. the **SoD itself**: `submit_sales_invoice` / `grant_sales_invoice_submit_clearance` read exactly
     two sources — `sales_invoices.author_user_id` and the append-only `sales_invoice_authors` set —
     and both are written only inside `claim_sales_invoice_author` and the service-role mirror
     writer. Writing the invoice **body** through the direct table path bypassed both, so the person
     who chose the number **cleared their own submit**. The row-lock / clearance / fencing-token
     machinery of `0132`+`0133` was all downstream of an oracle a client could simply write.
- **`project_documents` — HIGH, the guard protected the wrong column.** `0174` checked `status`;
  **`author_id`** is the SoD subject of `transition_document_status` and was freely insertable. A PM
  inserts a `Draft` naming a colleague as author, then `Issued` → `Approved`: **self-approval in
  three statements**, and `0174`'s audit detail did not even record `author_id`. `procurements` has
  had the right control since `0051` (column default + restrictive INSERT policy + removal from the
  UPDATE grant); all three parts are mirrored.
- **`projects` — HIGH, the money SoD is STILL OPEN and `0173` said otherwise.** See the correction
  block in `docs/specs/project-create-sod.spec.md` §3. `0176` fixes the false claim and adds the
  missing detection control; **closing the defect is an owner decision** (FR-RES-030).
- **`budget_versions` — MEDIUM, same class, untouched.** `insert … values (…,'Active', now())`
  bypassed `activate_budget_version`'s role gate, its `is_active_member()` conjunct, its Draft-only
  legality rule and its archive-the-previous-Active invariant. Bounded by
  `budget_versions_one_active_idx` (a second Active hits 23505), so the reachable outcome is "the
  first Active version on a project is created ungated" — which still moves every budget KPI.
- **`create_procurement_invoice(p_status)` — MEDIUM, the protected end state was a PARAMETER.** Now
  that slices 2+3 made the definer RPCs the sole client write path, their parameters are the whole
  remaining surface. It minted a `Paid` invoice for an arbitrary amount on request. The rule already
  existed as a TypeScript comment (`RecordCaptureForm.tsx` N1: *"Paid is NOT offered here — Mark as
  Paid is the sole PR→Paid authority"*) in front of a public RPC.
- **Three-valued logic — MINOR but real, in EVERY guard shipped so far.** `new.status not in (…)` and
  `new.status <> 'Draft'` evaluate to **NULL** for an explicit `status => NULL`, and `if NULL then`
  does not fire, so every guard **fell through** and the NOT NULL constraint caught the insert
  instead: the wrong error, and all four guards open **silently** the moment any migration relaxes one
  of those NOT NULLs. Same family as `NaN >= 0` being TRUE in Postgres.

### 8.2 Requirements (EARS)

- **FR-RES-010** — The system shall withhold INSERT privilege on `sales_invoices.status`,
  `.si_number`, `.author_user_id` and every `erp_*` column from `authenticated`, re-granting INSERT
  only on the body columns.
- **FR-RES-011** — The system shall withhold UPDATE privilege on `sales_invoices` from
  `authenticated` and `anon` entirely, with no re-grant.
- **FR-RES-012** — The system shall reject any INSERT into `sales_invoices` that is not an
  origination row, and shall write an `audit_events` row for every insert.
- **FR-RES-020** — The system shall reject any INSERT into `project_documents` whose `author_id` is
  not the calling user, defaulting `author_id` to the caller when it is omitted.
- **FR-RES-021** — The system shall withhold UPDATE privilege on `project_documents.author_id` from
  `authenticated`, and shall record `author_id` in the create audit detail.
- **FR-RES-030** — `transition_project` shall write an `audit_events` row naming the actor, the from
  and to states, and the `contract_value` in force at the transition.
  ⚑ **STILL OPEN:** the money SoD itself. `transition_project` does not validate `contract_value`, so
  an originator can win their own deal at their own value. Closing it is an owner decision between
  (a) gating the pipeline→Won edge on Admin/Executive/Finance and (b) requiring re-approval of the
  value on win (which needs a `contract_value` authorship trail that does not exist). Current
  behaviour PINNED by AC-RES-032.
- **FR-RES-040** — The system shall reject any INSERT into `budget_versions` whose `status` is not
  `Draft` or which supplies a non-NULL `activated_at`, and shall withhold INSERT privilege on
  `activated_at` from `authenticated`.
- **FR-RES-050** — `create_procurement_invoice` shall reject any `p_status` that is not an
  origination status (`Received`, `Scheduled`).
- **FR-RES-060** — Every create-path guard shall treat a NULL `status` as a violation of the
  origination rule (explicit `is null` / `is distinct from`), not fall through to a constraint.
- **NFR-RES-001** — Every denial shall assert **message text**, not errcode alone, and every revoke
  shall be paired with a proof that the legitimate path still works.

### 8.3 Acceptance criteria — all pgTAP, in `supabase/tests/0169_create_path_sod_residuals.test.sql`

`AC-RES-010`..`019` (sales_invoices grants, both probed forgeries, the fail-closed submit, the create
audit, the service-role mirror control, **and AC-RES-019 pinning the STILL-OPEN DELETE**) ·
`AC-RES-020`..`025` (foreign/NULL author denied; both DAL insert shapes still work; the default stamps
the caller; `author_id` out of the UPDATE grant; the real SoD still fires) · `AC-RES-030`/`031` (the
win path still works; the transition is audited) · **`AC-RES-032` pins the STILL-OPEN money SoD** ·
`AC-RES-040`..`042` (budget_versions guard + grant + createBudgetVersion/activate/archive controls) ·
`AC-RES-050`..`052` (Paid rejected; Received/Scheduled + `capture_vendor_invoice` still work) ·
**`AC-RES-053` pins the STILL-OPEN goods-receipt self-attestation** · `AC-RES-060` (NULL status on all
six guarded tables) · `AC-RES-070`/`071` (the trigger layer behind the revokes; the ADR-0069 boundary).

**Mutation evidence (binding requirement, performed):** 22 mutations applied to the live schema,
**22 killed, 0 survived** — including four MESSAGE-only mutations (same errcode, generic text) and
five deliberate OVER-BLOCKING mutations (full revoke of the SI INSERT; revoke of `budget_versions`
UPDATE; revoke of the `project_documents` metadata UPDATE; constraining the invoice RPC to `Received`
alone; making the SI guard enforce on BYPASSRLS roles).

### 8.4 Explicitly out of scope for slice 4 (all reported, none silently dropped)

- **The `projects` money SoD** (FR-RES-030 ⚑) and **DELETE on `sales_invoices`** — both pinned, both
  owner decisions, both in `docs/backlog.md`.
- **`create_procurement_receipt`'s requester carve-out** — an Engineer who raised the request can
  record their own `Complete` goods receipt. NOT the same defect (`Partial`/`Complete` are both
  origination values, so no status constraint touches it) and the carve-out is a **ratified**
  contract asserted on purpose by `supabase/tests/0055_authz_hardening.test.sql` AC-AUTHZ-007.
  Pinned by AC-RES-053.
- **`incoming_payments`** — the AR twin of `sales_invoices` carries the identical blanket grants
  (`insert/update/delete` to `authenticated`, `status` ∈ `Scheduled|Paid`, `erp_*` feed columns) and
  the same inert flip guard. It is **not** this class: there is no transition RPC and no SoD rule to
  bypass, so it is a mirror-integrity question (`0123`'s flip design), not a create-path SoD one.
  Reported to the Director, deliberately not fixed here.
- **`budget_versions` DELETE** — found while auditing the DELETE path for this slice: a plain PM can
  delete the **Active** version (there is no DELETE guard, contrary to `budgets.ts:392`'s comment), and
  the parent's `on delete cascade` **bypasses** `enforce_draft_line_item`. Verified live. Same
  DELETE-path family as the two items above; `docs/backlog.md` groups all three as one slice.
- **The `is_active_member()` gap across 17 RPCs** — a different class, tracked separately.

---

## 9. Slice 5 — the DELETE path and the `projects` money SoD (`0177_delete_path_sod_and_project_money_sod.sql`, proven by `supabase/tests/0170_delete_path_sod_and_project_money_sod.test.sql`)

**Status:** implemented 2026-07-29. Owner-approved (both parts) before a line was written.
This is the **third and last** of the three write paths. Every finding below was re-verified by a live
probe against the local DB **at `0176`** before any code changed; every probe is replayed as an
assertion in `0170`.

### 9.1 Why there is a slice 5

`0175` and `0176` each wrote *"STILL OPEN — DELETE"* into their own headers and **pinned the
vulnerable state in pgTAP** (`0168` §J `AC-UPS-080`, `0169` `AC-RES-019`) rather than fixing it,
because the shape was an ADR-0018/ADR-0019 decision. `0176` did the same for the `projects` money SoD
(`AC-RES-032`), because closing it was a product decision. Those pins were written so that closing the
defects would have to be a **deliberate, test-visible act**. This slice is that act, and it rewrites
all of them.

⚑ **The new lesson, and the reason DELETE is not just "one more grant to revoke":**
**a guard on a child table is not a guard if a parent delete cascades.**

### 9.2 Findings, each with its live probe at `0176`

- **`budget_versions` — MEDIUM-HIGH, and the sharpest instance in the whole class.** The child guard
  works and the parent walks around it:
  ```
  delete from budget_line_items where <owning version is Active> -> ERROR: line-items can only change
                                                                     while the owning version is Draft
  delete from budget_versions   where <that Active version>      -> DELETE 1
  => line items left: 0.   audit rows: 0.
  ```
  `budget_line_items_budget_version_id_fkey` and `budget_version_erp_mirror_budget_version_id_fkey`
  are both `ON DELETE CASCADE`, so a plain PM zeroed the Active budget, every KPI over it
  (`get_project_budget` / `get_budget_projection` / margin / at-risk / S-curve) and the ADR-0059
  budget-push witness, in **one request with no audit row** — while ERPNext kept enforcing a budget PMO
  no longer held. ⚑ `pmo-portal/src/lib/db/budgets.ts:392` documented *"DB trigger blocks non-Draft
  (OD-BUDGET-C)"*; **that trigger did not exist.** The comment is corrected in the same commit.
- **`sales_invoices` / `incoming_payments` / `procurement_invoices` / `procurement_receipts` /
  `procurement_quotations` — MEDIUM, all five.** Each holds a table DELETE grant to `authenticated`
  plus a permissive DELETE policy. Probed as a plain PM: `DELETE 1` on a **Paid** sales invoice, a
  **Paid** incoming payment, a **Paid** vendor invoice, a **Complete** goods receipt (a 3-way-match
  input) and the **selected** quotation — **0 audit rows for any of them** (`0076`'s AFTER DELETE audit
  convention was wired only to `companies` and `projects`).
  Two cascade families ride on those parents: `sales_invoice_authors` +
  `sales_invoice_submit_authorizations` (which **are** the `submit_sales_invoice` SoD oracle that
  `0176` §1 had just made client-unwritable) and the `procurement_*_files_delete_admin_only` file
  tables (`0058`) whose Admin-only DELETE policy a non-Admin could reach through the parent.
- **`projects` — HIGH, the money SoD.** Re-probed at `0176`, unchanged from `0175`:
  ```
  insert projects (…, 'Leads', contract_value 99999999)          -> INSERT 1  (a plain PM)
  transition_project('PQ Submitted') / ('Quotation Submitted')   -> ok
  transition_project('Won, Pending KoM','CPO-1','2026-03-02')    -> ok
  => 'Won, Pending KoM | 99999999.00', reached ALONE
  ```

### 9.3 `incoming_payments` — slice 4's judgement, re-judged

Slice 4 excluded it as "not this class: no transition RPC, so no SoD rule to bypass — it is
mirror-integrity". **Slice 5 re-examined that and agrees, and acts on the half that IS in scope.**
There is no `transition_incoming_payment`, no approval, no requester/approver pair: a client-inserted
`Paid` receipt is a **false mirror row**, not a defeated approval, and the right fix is `0123`'s flip
design plus the `sales_invoices` treatment from `0176` §1 — a slice with its own caller survey.
What **is** in scope here is the destructive delete: erasing a Paid payment with no audit row is the
same act as erasing a Paid invoice, and it is closed identically. The INSERT/UPDATE half is recorded in
`docs/backlog.md` as still open rather than left un-pinned.

### 9.4 The owner's ruling on the money SoD, and why the two shapes `0176` named were both rejected

- ✗ **Gate the pipeline→Won edge on Admin/Executive/Finance.** Removes "win the deal" from the Project
  Manager role that owns the pipeline. A product regression dressed as a security fix; people work
  around it.
- ✗ **Blanket re-approval of the value on win.** Taxes every win, including the overwhelming majority
  where nothing is suspicious.
- ✓ **Approver ≠ author, on the money.** Exactly ADR-0019's existing shape (requester≠approver,
  approver≠payer) applied to `contract_value`: record who last set it, and refuse the win when the
  actor winning the deal **is** that person — unless they hold a role already trusted with the value
  on an on-hand project (Admin / Executive / Finance, i.e. `set_project_contract_value`'s own gate).

Two deliberate bounds, both asserted:
1. **`contract_value > 0`.** The rule is about money. The column is `NOT NULL DEFAULT 0` and
   `ProjectFormModal` sends `parseMoneyInput(values.value) ?? 0`, so a deal created without a value
   carries 0 and needs no second person. (NaN cannot reach the branch — `projects_contract_value_nonneg`
   (`0169`) rejects it — and if it ever did, `'NaN'::numeric > 0` is TRUE in Postgres, so the guard
   would fire. Fail closed either way.)
2. **The carve-out is the ON-HAND gate (Admin/Executive/Finance), not the pre-win one
   (Admin/Executive/Project Manager).** A PM is trusted to *propose* a value; they are not trusted to
   ratify their own proposal at the moment it becomes revenue.

**NULL handling — fail closed, and why there are two columns.** `contract_value_set_at` NULL means
*no witness was ever taken* (a pre-`0177` row; there is no record anywhere of who set those values, so
a backfill is impossible) → the win is **refused** for a non-Admin/Exec/Finance caller, with its own
message naming the remedy. `contract_value_set_by` NULL **with** a non-NULL `contract_value_set_at`
means *a server-side authority set it* (`auth.uid()` is NULL for service_role / postgres / the
importer / `seed.sql`) — which is by construction not the calling user, so the two-person rule is
already satisfied and the win is **allowed**. Collapsing the two into one column would have forced a
choice between blocking every seeded row and failing open on every legacy row. Every clause in the
guard is written **total** (`is distinct from`, an explicit `is null` branch) — a NULL-valued condition
does not fire an `if`, which is §8.1's three-valued-logic defect exactly.

### 9.5 Why this breaks no caller (verified by reading every one, 2026-07-29)

- **`budget_versions`** — `deleteDraftVersion` (`src/lib/db/budgets.ts:394`) is the only client delete,
  and the only affordance reaching it (`ProjectBudget.tsx` `VersionCard`) renders on `Draft` only.
  `archiveVersion` is an UPDATE (untouched — the guard is DELETE-only). `_budHelpers.ts` (378/381/383)
  tears down versions *and* the parent project through the service-role `admin` client → exempt.
- **The five mirror tables** — `grep -n '\.delete()' src/lib/db/*.ts src/lib/repositories/*.ts` returns
  16 call sites and **not one** is any of these five. Edge functions never delete (`readModelWriters.ts`,
  `adapter-dispatch/index.ts`, `erpnext-sweep/index.ts`, `_shared/erpnextFeedDeps.ts` — the mirror
  writers upsert) and hold `service_role` anyway. Every e2e delete uses the service-role `admin` client
  (`_sarHelpers.ts` 208-209, `AC-SAR-071` 207-208, `AC-ENA-013` 107, `AC-ENA-023` 104, `AC-ENA-023b` 103).
  The importer only inserts. `service_role` retains DELETE on all five (asserted).
- **`projects` witness columns** — `projects` carries **no table-level INSERT/UPDATE grant** (only the
  column lists from `0008` A6 / `0014`), so a newly added column is withheld by construction. The
  explicit revoke in `0177` §B1 states the intent; `0170` `AC-PMS-010` is the enforcement.

### 9.6 The `ON DELETE CASCADE` enumeration (binding, from the live catalog)

62 `ON DELETE CASCADE` FKs in `public`, each cross-referenced against its child's delete-time guards
(BEFORE/AFTER DELETE triggers and DELETE/ALL RLS policies). **Two families have a child control a
parent delete could bypass; everything else is a child with no delete-time control of its own.**

| child | parent | child's delete-time control | reachable before `0177`? |
|---|---|---|---|
| `budget_line_items` | `budget_versions` | `budget_line_items_draft_guard` (BEFORE DELETE) | **YES — the defect.** Closed by §A1 |
| `budget_version_erp_mirror` | `budget_versions` | none | yes (silent loss of the push witness). Closed by §A1 |
| `sales_invoice_authors` | `sales_invoices` | none (client-unwritable by `0176`) | **YES** — the submit-SoD oracle. Closed by §A2 |
| `sales_invoice_submit_authorizations` | `sales_invoices` | none | **YES** — the clearance record. Closed by §A2 |
| `procurement_invoice_files` | `procurement_invoices` | `*_delete_admin_only` (RESTRICTIVE) | **YES** — a non-Admin reached it via the parent. Closed by §A4 |
| `procurement_receipt_files` | `procurement_receipts` | `*_delete_admin_only` | **YES.** Closed by §A4 |
| `procurement_quotation_files` | `procurement_quotations` | `*_delete_admin_only` | **YES.** Closed by §A4 |
| `budget_versions` | `projects` | `budget_versions_delete_guard` (new, §A1) | **NO — and deliberately so.** `projects_delete_admin_only` (`0052`) already requires Admin, and §A1's Admin carve-out is exactly what keeps that shipped capability working. Asserted by `AC-DPS-015` |
| `procurement_items` | `procurements` | `procurement_items_draft_only_del` (RESTRICTIVE) | **NO** — `procurements` has **no DELETE policy at all**, so a client DELETE matches 0 rows. Verified in the catalog |
| `procurement_invoices` / `receipts` / `quotations` / `payments` / `purchase_orders` / `purchase_requests` / `rfqs` / `procurement_status_events` | `procurements` | various | **NO**, same reason |
| `timesheet_entries`, `timesheet_erp_mirror` | `timesheets` | `timesheet_entries_write` (parent-Draft) | **NO** — `timesheets` has no DELETE policy (`0168` `AC-UPS-081`) |
| `project_documents` | `projects` | `project_documents_delete_admin_only` | **NO** — the parent is Admin-only too; no escalation |
| `payment_files`, `purchase_order_files`, `purchase_request_files`, `rfq_files` | their `*` parents | `*_delete_admin_only` | **NO** — those parents cascade only from `procurements`, which is undeletable by a client |
| the remaining ~35 (`agent_*`, `erp_*`, `external_*`, `m365_*`, `ms_graph_*`, `org_features`, `platform_operators`, `profiles`, `tasks`, `task_dependencies`, `crm_activities`, `budget_projections`, `budget_category_account_map`, `external_reference_items`, `project_milestones`) | mostly `organizations` / `profiles` / `projects` | none, or a plain `*_write` | no child-guard to bypass |

### 9.7 Requirements (EARS)

- **FR-DPS-010** — The system shall reject any DELETE of a `budget_versions` row whose `status` is not
  `Draft`, unless the caller is an Admin, and shall write an `audit_events` row for every delete.
- **FR-DPS-020** — The system shall withhold DELETE privilege on `sales_invoices`,
  `incoming_payments`, `procurement_invoices`, `procurement_receipts` and `procurement_quotations`
  from `authenticated` and `anon`, with no re-grant, and shall write an `audit_events` row for every
  delete on each.
- **FR-PMS-010** — The system shall record, on every write of `projects.contract_value`, the user who
  wrote it and when (`contract_value_set_by`, `contract_value_set_at`), and shall withhold both
  columns from the client INSERT and UPDATE grants.
- **FR-PMS-020** — `transition_project` shall reject a pipeline→`Won, Pending KoM` transition when
  `contract_value > 0`, the caller is not Admin/Executive/Finance, and either the caller is the
  recorded author of the value **or** no author was ever recorded (fail closed). The message shall
  name the rule and the remedy.
- **FR-PMS-021** — `transition_project`'s audit row shall carry the witness alongside the value.
- **NFR-DPS-001** — Every denial shall assert **message text**, not errcode alone, and every revoke
  shall be paired with a proof that the legitimate path still works.

### 9.8 Acceptance criteria — all pgTAP, in `supabase/tests/0170_delete_path_sod_and_project_money_sod.test.sql` (62 assertions)

`AC-DPS-010`..`016` (Active and Archived deletes refused naming the cascade; the child guard still
fires directly; the line item survives; `deleteDraftVersion` and `archiveVersion` still work; the
delete is audited; an Admin's direct delete **and** their project hard-delete both cascade through and
are both audited; the ADR-0069 BYPASSRLS boundary, proven in both directions) ·
`AC-DPS-020`..`025` (grant topology at table **and** column level; `service_role` keeps all five; the
five probed forgeries denied by message; the rows survive; both cascade children survive; the
service-role mirror writer still deletes all five; all five deletes audited, with the detail) ·
`AC-PMS-010`..`021` (witness columns withheld while `contract_value` stays insertable; the witness
stamped on INSERT and by `set_project_contract_value`; an unrelated header UPDATE does **not** re-stamp;
**the exploit refused**; a PM winning a colleague's value; Finance winning their own; a zero-value deal;
the fail-closed NULL witness **and** the Admin re-route; a server-seeded row still winnable; the
same-figure ratification re-stamping; the whole legitimate journey end to end; the three pre-existing
`transition_project` gates intact).

**Mutation evidence (binding requirement, performed): 24 mutations applied to the live schema, 24
killed, 0 survived** — including three MESSAGE-ONLY mutations (same errcode, generic or borrowed text),
one DETAIL-ONLY mutation, five OVER-BLOCKING mutations (Draft-only for everyone; every delete refused;
revoking DELETE from `service_role`; dropping the `contract_value > 0` bound; dropping the
Admin/Exec/Finance carve-out), one FAIL-OPEN-on-NULL mutation (the three-valued-logic trap) and two
ADR-0069-boundary mutations. Each was killed by a **distinct, relevant** assertion, and a clean run
after every inverse proved the campaign itself was not measuring leftover damage.

⚑ **A defect the controls found in this slice's own first draft:** the witness trigger initially
stamped only when `contract_value` actually *changed*. The ratifier's natural act is to **confirm** the
originator's figure — the same number — which is not a change, so the witness was not re-stamped and
the legitimate two-person path **deadlocked**. Caught by `AC-PMS-020`, not by any security assertion.
The trigger now takes its precision from `update OF contract_value` (only `set_project_contract_value`
can target that column) rather than from a value comparison.

### 9.9 Explicitly out of scope for slice 5 (all reported, none silently dropped)

- **`incoming_payments` INSERT/UPDATE** — §9.3; a mirror-integrity slice, tracked in `docs/backlog.md`.
- **`create_procurement_receipt`'s requester carve-out** — a **ratified** contract (`AC-AUTHZ-007`),
  pinned by `0169` `AC-RES-053`. A product decision.
- **The `is_active_member()` gap across 17 RPCs** — a different class, tracked separately.
- **Backfilling the `contract_value` witness** — impossible (no record exists). `0177` WARNs with the
  affected count; the disposition is an owner call, alongside OD-PCS-1.
