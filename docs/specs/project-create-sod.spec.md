# Spec — close the INSERT-side hole in the project money/status SoD

**Status:** drafted 2026-07-28 (Director), pending owner sign-off
**Owner decision required:** OD-PCS-1 (see §6)
**Relates to:** ADR-0019 (server-enforced SoD + destructive deletes), ADR-0020 (project state machine),
ADR-0027 (bulk import). Supersedes nothing.

---

## 1. Problem

ADR-0019 requires that a project's **money and won-status** are not settable by the person who
originates the deal — the win is reached only through the `transition_project` state machine, which
carries the SoD checks and writes an audit row.

That rule is enforced on the **UPDATE** path and **absent on the INSERT path.**

Verified live against the local DB at migration `0172` (`information_schema.column_privileges`):

| grant | columns |
|---|---|
| `authenticated` **UPDATE** | `archived_at, budget, client_id, code, created_at, end_date, id, last_update, name, org_id, project_manager_id, spent, start_date` |
| `authenticated` **INSERT** | **every column**, incl. `contract_value`, `status`, `decided_at`, `customer_contract_ref`, `contract_date` |

The UPDATE grant deliberately withholds exactly the five columns that INSERT hands over.

### 1.1 Demonstrated exploit

Run as `authenticated` with the JWT claims of a seeded **Project Manager**
(`00000000-0000-0000-0000-0000000000b2`), inside a rolled-back transaction:

```sql
insert into public.projects (name, status, contract_value, decided_at, customer_contract_ref, client_id)
values ('EXPLOIT — forged win', 'Won, Pending KoM', 99999999.00, '2020-01-01', 'FORGED-REF-001', <company>)
returning id, status, contract_value, decided_at, customer_contract_ref;
```

Result — **the insert succeeds**:

```
 status           | contract_value | decided_at             | customer_contract_ref
 Won, Pending KoM |    99999999.00 | 2020-01-01 00:00:00+00 | FORGED-REF-001
```

`audit_events` rows written for it: **0**. The only triggers on `projects` are
`projects_stamp_org_id`, `projects_audit_delete` (**AFTER DELETE only**) and
`projects_block_inflight_external_delete`. **Nothing guards INSERT.**

### 1.2 Why the existing guard does not hold

`pmo-portal/src/lib/db/projects.ts` rejects a non-origination status before inserting and its
docstring calls this *"defence in depth — the state machine, not a direct create, owns the win"*.
It is **TypeScript in the browser**. The `anon`/`authenticated` PostgREST endpoint is public; the
check is one `curl` away from irrelevant. **A guard above the enforcement layer is not defence in
depth — it is the only defence, in the wrong place.** This is the same shape as the `0168`
timesheet clamp fixed in #409: a rule stated at a layer the attacker does not have to pass through.

### 1.3 Blast radius

`contract_value` on a won project feeds revenue-per-project, AR aging, the executive dashboard and
the ERPNext write-through. A forged win is indistinguishable from a real one in every downstream
surface, and — because `log_audit` is not on INSERT — leaves no record that it was ever created.

---

## 2. Scope

**In:** the INSERT path on `public.projects`.
**Out:** the UPDATE path (already correct); `transition_project` (already carries SoD + audit); the
five other tables sharing the restricted-UPDATE / blanket-INSERT shape — a security sweep is running
and they get their own slice (§7).

---

## 3. What legitimately needs these columns at INSERT

Established by reading both create paths, not assumed:

- `pmo-portal/src/lib/db/projects.ts` — `createProject` restricts `status` to
  `PROJECT_ORIGINATION_STATUSES` = `['Leads', 'Internal Project']`, and sends `contract_value`.
- `pmo-portal/src/lib/import/projectDescriptor.ts` — the bulk importer applies the **same**
  origination-status constraint, and its header states: *"`contract_value` is the origination value
  (optional, default 0; SoD only gates the won value)"*.
- **No server-side writer inserts into `projects` at all** — grep over `supabase/functions/**` and
  `supabase/migrations/**` returns nothing.

⇒ Enforcing origination-status-at-INSERT in the database **breaks no existing caller**. It moves an
already-agreed rule to the layer that can enforce it. `contract_value` must remain settable at
INSERT (it is the opportunity value); the SoD is about the **won** value, which the state machine
owns.

---

## 4. Requirements (EARS)

- **FR-PCS-001** — *Ubiquitous.* The system shall reject any INSERT into `public.projects` whose
  `status` is not one of `Leads`, `Internal Project`.
- **FR-PCS-002** — *Ubiquitous.* The system shall reject any INSERT into `public.projects` that
  supplies a non-NULL win artifact: `decided_at`, `customer_contract_ref`, or `contract_date`.
- **FR-PCS-003** — *Ubiquitous.* The system shall write an `audit_events` row for every INSERT into
  `public.projects`, recording actor, org, entity id and the origination `status` +
  `contract_value`.
- **FR-PCS-004** — *Ubiquitous.* The system shall withhold the INSERT privilege on
  `decided_at`, `customer_contract_ref` and `contract_date` from `authenticated`, so the grant layer
  and the trigger layer both stop a forged win.
- **NFR-PCS-001** — Enforcement shall live in the database. A FE-only check does not satisfy any
  requirement in this spec.
- **NFR-PCS-002** — The rejection message shall name the offending rule and column, and shall not
  leak another org's data.

### 4.1 Deliberately NOT required

- Blocking `contract_value` at INSERT — it is the legitimate origination value (§3).
- Retro-fixing existing rows. §5's AC-PCS-020 only requires that the migration **reports** any
  pre-existing violation; deciding what to do about one is OD-PCS-1.

---

## 5. Acceptance criteria (Given/When/Then)

- **AC-PCS-001** *(pgTAP)* — **Given** a Project Manager in org A, **when** they INSERT a project
  with `status = 'Won, Pending KoM'`, **then** the insert is rejected, the message names the
  origination rule, and no row exists.
- **AC-PCS-002** *(pgTAP)* — **Given** the same PM, **when** they INSERT with
  `status = 'Leads'` and a non-NULL `decided_at`, **then** the insert is rejected naming
  `decided_at`. Repeat for `customer_contract_ref` and `contract_date`.
- **AC-PCS-003** *(pgTAP)* — **Given** the same PM, **when** they INSERT a legitimate
  `status = 'Leads'` project **with a `contract_value`**, **then** it succeeds. *(No-over-blocking
  control: a reject-everything guard must fail this.)*
- **AC-PCS-004** *(pgTAP)* — **Given** a successful origination INSERT, **then** exactly one
  `audit_events` row exists for it naming the actor.
- **AC-PCS-005** *(pgTAP)* — **Given** an Admin/Executive, **when** they attempt the AC-PCS-001
  insert, **then** it is **also** rejected. *(The rule is structural — the win path is the state
  machine for everyone. This is not a role gate.)*
- **AC-PCS-006** *(pgTAP)* — **Given** `authenticated`, **then** `information_schema` shows no
  INSERT privilege on `decided_at`, `customer_contract_ref`, `contract_date`.
- **AC-PCS-007** *(pgTAP)* — **Given** the state machine, **when** `transition_project` wins a
  project, **then** it still succeeds and still writes its audit row. *(Regression control: the fix
  must not break the legitimate win path.)*
- **AC-PCS-020** *(migration output)* — **Given** rows that already violate FR-PCS-001/002,
  **when** the migration applies, **then** it raises a WARNING with the count rather than failing
  or silently ignoring them.

**Mutation requirement (binding).** For each of AC-PCS-001..007, the plan must state the code change
that makes it fail, and the implementer must **run** that mutation. This repo has shipped pgTAP
proofs that stayed green with their guard deleted — once because the CHECK raised the same errcode
and the assertion passed `null` for the message, once because the regex matched the phrase in a SQL
**comment**. Assert the message text; do not assert errcode alone.

---

## 6. Owner decision required

- **OD-PCS-1 — what to do about pre-existing forged/legacy rows.** Production may hold projects
  created directly at a won status (legitimately, before the state machine existed, or otherwise).
  Options: (a) leave them, migration warns only — *recommended*, non-destructive, reversible;
  (b) quarantine them for review; (c) block the migration until they are reconciled. Until the owner
  rules, the implementation takes (a).

---

## 7. Follow-up, not in this slice

A security sweep is running over the five other tables with the same restricted-UPDATE /
blanket-INSERT shape (`procurements`, `procurement_invoices`, `procurement_quotations`,
`procurement_receipts`, `project_documents`). Each needs the §3 analysis on its own terms — a column
withheld from UPDATE because it is money, a workflow state, or an approval witness is a real hole;
one withheld because it is derived is not. **Do not generalise this fix to them without that
analysis.**

---

## 8. Traceability

| Req | AC | Owning layer |
|---|---|---|
| FR-PCS-001 | AC-PCS-001, AC-PCS-005 | pgTAP |
| FR-PCS-002 | AC-PCS-002 | pgTAP |
| FR-PCS-003 | AC-PCS-004 | pgTAP |
| FR-PCS-004 | AC-PCS-006 | pgTAP |
| NFR-PCS-001 | AC-PCS-001..006 (all DB-level) | pgTAP |
| — (no-over-blocking control) | AC-PCS-003, AC-PCS-007 | pgTAP |
| — (apply-time visibility) | AC-PCS-020 | migration output |
