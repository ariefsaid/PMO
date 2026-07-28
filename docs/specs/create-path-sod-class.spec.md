# Spec — close the create-path SoD hole across the whole class (slice 2)

**Status:** drafted 2026-07-28 (Director), owner instructed "fix all of them"
**Slice 1:** `docs/specs/project-create-sod.spec.md` (`projects` only) — implemented separately
**Relates to:** ADR-0019 (server-enforced SoD), ADR-0020, ADR-0027

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

The RLS `WITH CHECK` carries `NOT domain_externally_owned(...)` and a mirror guard, but
`external_domain_ownership` is **empty**, so both are **currently no-ops**. A guard that is inert
until an unrelated table is populated is not a control.

### 2.4 `timesheets` — Medium, **variant B** (FR-CPS-040)
`timesheets_update_own` correctly pins `status='Draft'` in both `USING` and `WITH CHECK`;
`timesheets_insert` constrains only `user_id`. An Engineer inserted their own sheet already
`status='Approved', approved_by=self`, defeating a check commented *"even an Admin can never approve
their own timesheet… Do not reorder."*

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
  `procurement_receipts` and `procurement_quotations` from `authenticated`, leaving the existing
  `create_procurement_*` / `select_procurement_quote` definer RPCs as the only write path.
- **FR-CPS-040** — The system shall reject any INSERT into `timesheets` whose `status` is not `Draft`
  or which supplies a non-NULL `approved_by`.
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
