# ADR-0019 — Server-enforced SoD + Admin-only delete for CRUD writes

- **Status:** Accepted (2026-06-08)
- **Context:** the app-wide FE-CRUD + RBAC program (`docs/plans/2026-06-07-crud-rbac-program.md`, PRs #32/#34/#35).
- **Related:** ADR-0016 (FE authz primitive — `can()` is UX-only), ADR-0011/0012 (the security-definer transition-RPC pattern), ADR-0018 (soft-archive + delete policy).

## Context
The CRUD program introduced create/edit/delete affordances across every entity. The FE gates them with
`can(action, entity, ctx)` on the **real JWT role** (ADR-0016) — but that is **UX only**. A few write
actions carry real **segregation-of-duties** or **destructive-blast-radius** semantics that must hold even
against a direct API call, so they need **server-side enforcement** (RLS / security-definer RPC), not just a
hidden button. The risk pattern is "FE hides it but RLS still allows it" (a gating gap the security audit
flagged on several slices).

## Decision
FE gating stays UX-only; **the server is the authority** for SoD + destructive deletes, via:

1. **`contract_value` SoD (migration 0014, `set_project_contract_value` RPC).** `contract_value` is **revoked
   from the direct-UPDATE column grant** so the RPC is its *sole* writer; the RPC re-asserts org + role +
   status — a PM may set it while a deal is pre-win, but only **Executive/Finance/Admin** may change it on an
   on-hand (won) project. Every change is audit-stamped (actor, date, previous value).
2. **Document-status SoD (migration 0017, `transition_document_status` RPC).** Project-document status
   transitions go through a security-definer RPC enforcing the legal status map **and `approver != author`**
   (the actor approving/rejecting cannot be the document's author). Not an FE-only check.
3. **Admin-only hard-delete (migrations 0013/0017, restrictive DELETE policies).** Hard-delete of
   `companies`, `project_documents`, and `incident_reports` is restricted to **Admin** at the RLS layer
   (mirroring 0013); other write-roles get **archive** (soft) or the entity's lifecycle terminal (e.g.
   procurement uses **Cancel**, never hard-delete). Referenced rows are FK-blocked (23503 → "in use") rather
   than cascade-deleted.
4. **Column-pinned own-row writes (migration 0016).** An Engineer may update **only the `status` column** of
   tasks where `assignee_id = auth.uid()` (column-pinned WITH CHECK, the timesheets MED-TS-2 pattern) — not
   reassign, not other columns, not others' tasks.
5. **`org_id` is never client-sent.** Child rows inherit `org_id` from their parent (e.g. the
   `procurement_items` BEFORE-INSERT trigger, migration 0015); RLS `WITH CHECK (org_id = auth_org_id())` is
   the tenancy authority.

## Consequences
- The FE `can()` map may be **stricter** than RLS (e.g. Finance hidden from project create) — that is fine;
  RLS is the floor, the FE is allowed to narrow UX. But where a rule is a real **boundary** (SoD, Admin-only
  delete), it is enforced server-side and proven by pgTAP (`0049`, `0051`, `0053`, `0054`, the `0052_*`
  contracts).
- New CRUD features follow this rule: gate the UX with `can()`, but if the rule is SoD or destructive, add the
  RLS policy / security-definer RPC + a pgTAP proof. Do not rely on the hidden affordance alone.
- Verified at merge: 1258 unit · 332 pgTAP · 39 e2e · CI green.
