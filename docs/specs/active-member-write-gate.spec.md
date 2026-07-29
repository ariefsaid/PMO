# Spec — a disabled user must not be able to write

**Status:** drafted 2026-07-29 (Director), owner approved the slice
**Relates to:** ADR-0019 (server-enforced SoD), ADR-0069 (`actor_bypasses_rls()` trust boundary)
**Sibling slices:** `docs/specs/project-create-sod.spec.md`, `docs/specs/create-path-sod-class.spec.md`

---

## 1. Problem

A deactivated employee is **read-blocked but write-enabled on the money path.** Probed live with a
valid JWT for a profile at `status = 'disabled'`:

```
select count(*) from procurements;                        -->  0     (RLS read blocked)
select create_procurement_invoice(<pr>,'Paid',…,424242);  -->  VI-…  Paid  424242.00
select create_procurement_receipt(<pr>,'Complete',…);     -->  GR-…
select create_procurement_quotation(<pr>,…);              -->  VQ-…
```

RLS carries `is_active_member()` on the table policies, so **reads** stop at deactivation. The
`security definer` RPCs bypass RLS by design and were supposed to re-assert the same conditions.
Most re-assert org and role. **They do not re-assert active membership.**

Offboarding is precisely when writes must stop — the disabled account *is* the threat model. A
departing employee with an unexpired token retains the ability to create vendor invoices, receipts
and payments.

### 1.1 Scope — 17 functions, enumerated from the live catalog

`security definer`, `EXECUTE` granted to `authenticated`, containing a write, and **not** containing
`is_active_member`:

```
admin_change_domain_ownership   clone_budget_version          create_payment
create_procurement_invoice      create_procurement_quotation  create_procurement_receipt
create_purchase_order           create_purchase_request       create_rfq
create_vault_secret_for_org     save_timesheet_week           select_procurement_quote
set_project_contract_value      transition_document_status    transition_procurement
transition_project              transition_timesheet
```

`activate_budget_version`, `admin_set_user_status` and `claim_sales_invoice_author` **do** carry it —
so this is a known pattern that was applied inconsistently, not an unconsidered one.

### 1.2 Why it is worse after the create-path slices

Slices 2–4 revoked client INSERT on `procurement_invoices` / `_receipts` / `_quotations`, making
these RPCs the **sole** client write path. The `is_active_member()` conjuncts still sitting on those
tables' now-unreachable INSERT policies are **dead code that reads like a live control** — the next
auditor will see the check and conclude the path is covered.

---

## 2. The trap that will break this slice if it is not planned for

`is_active_member()` takes **no arguments** and resolves the actor as `auth.uid()`:

```sql
select exists (select 1 from public.profiles p join auth.users u on u.id = p.id
               where p.id = auth.uid() and p.status = 'active'
                 and (u.banned_until is null or u.banned_until <= now()))
```

For a **service-role** caller `auth.uid()` is NULL ⇒ the function returns **false**. Adding the plain
conjunct to any RPC that a sweep, adapter or edge function invokes as service-role would **break that
path in production**, and it would break it *closed*, i.e. silently stop reconciliation rather than
erroring loudly at deploy.

**The repo has already solved this**: `approved_timesheet_for_push` resolves
`coalesce(auth.uid(), p_actor)`. Follow that precedent — do not invent a second mechanism.

⇒ **Per-RPC caller analysis is mandatory before touching any of the 17.** For each: is it reachable
only by a user JWT, or also by service-role / an edge function / a sweep / `import-historical.mjs`?

---

## 3. Requirements (EARS)

- **FR-AMG-001** — *Ubiquitous.* Every `security definer` function that writes on behalf of a caller
  shall reject the write when that caller is not an active member.
- **FR-AMG-002** — *Where a function has a service-role caller.* The active-member assertion shall be
  made against the **resolved** actor (`coalesce(auth.uid(), p_actor)`), not `auth.uid()` alone, so a
  legitimate service-role invocation is not rejected.
- **FR-AMG-003** — *Ubiquitous.* The assertion shall **fail closed**: an unresolvable actor is not an
  active member.
- **FR-AMG-004** — The rejection shall be distinguishable from a role denial, so an offboarded user's
  failure is diagnosable and does not read as a permissions bug.
- **FR-AMG-005** — RLS policy conjuncts rendered unreachable by the create-path slices shall be
  commented as superseded, naming what now enforces them.
- **NFR-AMG-001** — No legitimate caller may break. Established per-RPC by reading callers (§2), and
  proven by a no-over-blocking control per function.

---

## 4. Acceptance criteria (Given/When/Then) — pgTAP

- **AC-AMG-001** — Given a profile at `status='disabled'` with a valid JWT, when they invoke **each**
  of the 17 functions, then each is rejected with the active-member message and **no row is written**.
  *(One assertion per function — not a sampled subset. The whole point is that this was applied
  inconsistently; a sample would reproduce the original defect.)*
- **AC-AMG-002** — Given an **active** member with the required role, when they invoke each function,
  then it still succeeds. *(No-over-blocking control, per function.)*
- **AC-AMG-003** — Given a **service-role** caller supplying `p_actor` for an active member, when it
  invokes each function that has such a caller, then it succeeds. *(This is the control that catches
  the §2 trap.)*
- **AC-AMG-004** — Given a service-role caller supplying `p_actor` for a **disabled** member, then it
  is rejected. *(The resolved-actor form must not become a bypass.)*
- **AC-AMG-005** — Given a banned `auth.users` row (`banned_until` in the future) for an otherwise
  active profile, then writes are rejected. *(The helper already covers this; pin it.)*
- **AC-AMG-006** — The superseded RLS conjuncts are annotated, and a test asserts the annotation
  exists so it cannot be silently dropped.

**Mutation requirement (binding).** For every assertion, state the change that makes it fail and
**run it**, including a **message-only** mutation (same errcode, generic text). Assert message text,
never errcode alone.

---

## 5. Out of scope

- The `projects` money SoD and the DELETE path — sibling slices, in flight.
- The goods-receipt self-attestation carve-out (`AC-AUTHZ-007`) — a ratified contract; narrowing it is
  a product decision.
- Token revocation on deactivation. Adding the check closes the *write* surface; it does not shorten
  the life of an already-issued JWT. **Worth stating so nobody reads this slice as "offboarding is
  solved".** A real fix for token lifetime is a separate auth-side decision.
