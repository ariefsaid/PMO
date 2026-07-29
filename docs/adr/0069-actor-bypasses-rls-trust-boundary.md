# ADR-0069 — `actor_bypasses_rls()` is the one named trust boundary for server-side write guards

- **Status:** Accepted (2026-07-29)
- **Spec:** `docs/specs/create-path-sod-class.spec.md` (slices 2–4), `docs/specs/project-create-sod.spec.md`
- **Relates to:** ADR-0016 (RLS is the enforcement authority, `can()` is UX), ADR-0019 (server-enforced SoD)
- **Introduced by:** `0174_create_path_sod_class.sql` §0; hardened by `0175` §4/§5; extended to two more
  tables by `0176`. Asserted by `supabase/tests/0168_update_path_sod_class.test.sql` §F and
  `supabase/tests/0169_create_path_sod_residuals.test.sql` AC-RES-071.

## Context

The create-path SoD class (slices 1–4) added **BEFORE INSERT trigger guards** to seven tables:
`projects`, `procurements`, `project_documents`, `timesheets`, `sales_invoices`, `budget_versions`
(and the audit triggers alongside them). Each guard refuses a row that is created *already in* a
state a transition RPC is supposed to own.

Every one of those guards needs the same answer to one question: **who is this rule for?**

It cannot be for everybody. Enforcing on all callers would break, with no security benefit:

- `supabase/seed.sql` (seeds projects, procurements, documents, timesheets and budget versions across
  their whole status range),
- ~105 pgTAP fixture files, which insert non-origination rows as `postgres` to set a scene,
- the ERPNext e2e seed helpers (`pmo-portal/e2e/serial/_sarHelpers.ts`, `_budHelpers.ts`,
  `_tspHelpers.ts`) — service-role inserts past origination,
- `scripts/import-historical.mjs` — a service-role importer that legitimately loads historical **won**
  projects and **Paid** procurements,
- `supabase/functions/adapter-dispatch/readModelWriters.ts` — the service-role ERPNext mirror writer,
  which is the *normal* originator of a `sales_invoices` row and must set `status`, `si_number` and
  every `erp_*` column.

It also cannot be a role allow-list (`postgres`, `service_role`, `supabase_admin`) copy-pasted into
each guard: seven copies of a security predicate is seven chances to drift, and `0173` and `0174`
already proved that — `0173` inlined the lookup with `search_path = public` while `0174` extracted it
with `search_path = public, pg_catalog`, i.e. **two definitions of one trust boundary with different
resolution semantics**, one of which was exploitable (a relation named `public.pg_roles` would shadow
the catalog and could make every guard exempt every caller, silently). `0175` §4/§5 collapsed them.

## Decision

**There is exactly one predicate, `public.actor_bypasses_rls()`, and every server-side write guard
scopes itself with it.**

```sql
create or replace function public.actor_bypasses_rls() returns boolean
  language sql stable set search_path = pg_catalog, public as $$
  select coalesce((select rolbypassrls from pg_roles where rolname = current_user), false)
$$;
```

The boundary is **`pg_roles.rolbypassrls` on the CURRENT role**, which is precisely the RLS trust
boundary: a role that already bypasses Row Level Security holds a server-side secret and is an
**authority**, not a client. The guards therefore sit exactly where RLS sits, and the demonstrated
exploits — all `authenticated` PostgREST requests — are all inside the enforced set.

Four properties are load-bearing and are asserted, not assumed:

1. **`SECURITY INVOKER`** (the SQL default). `current_user` must be the REAL calling role. Under
   `SECURITY DEFINER` it would always read `postgres` and the function would exempt **every** caller,
   silently. This is why the function must never be "hardened" into a definer.
2. **`search_path = pg_catalog, public`** — catalog FIRST, so a `public.pg_roles` relation cannot
   shadow the catalog. Pinned by `0168` §F, which asserts the `proconfig` array verbatim.
3. **`coalesce(…, false)`** — if `current_user` is somehow absent from `pg_roles`, the guards
   **enforce** (fail closed) rather than waving the write through on a NULL.
4. **An explicit `grant execute … to authenticated, anon`.** It originally relied on the implicit
   PUBLIC execute grant, so the standard hardening step
   `revoke execute on all functions in schema public from public` would have turned every client
   INSERT on four tables into a 42501.

**Consequence for definer RPCs:** a `SECURITY DEFINER` function owned by `postgres`
(`create_procurement_*`, `save_timesheet_week`, `clone_budget_version`, `activate_budget_version`, the
transition RPCs) runs with `current_user = postgres`, so it is exempt by construction. That is the
mechanism by which "the RPC is the only write path" holds while the raw table path is closed — the
guards do not need to know which RPCs exist.

## Alternatives considered

- **Inline the `pg_roles` lookup in each guard** (what `0173` did). Rejected: it made a deliberate
  trust decision look like an accident, and it drifted within one migration of being written.
- **Check `auth.jwt() ->> 'role' = 'service_role'`** (the idiom `0123`'s mirror guards use). Rejected:
  it reads a *claim*, not the actual database role, so it misses `postgres` (fixtures, seed, psql
  operators) and it trusts a JWT field to describe the connection. `rolbypassrls` is the property that
  actually decides whether RLS applies.
- **Enforce on everyone and fix the fixtures/seed/importer.** Rejected: ~105 fixture files and a
  service-role importer whose entire job is loading terminal-status historical rows. It would trade a
  real security boundary for a cosmetic one and break the ability to seed a realistic database.
- **A `SET` variable / GUC opt-out (`set local app.skip_guards = true`).** Rejected: an opt-out any
  connection can set is not a boundary at all.

## Consequences

- **Good:** one thing to audit. A reviewer checks one function's owner, security mode, `search_path`
  and grant, and knows the scope of seven guards. Two pgTAP files pin those properties, so a future
  "hardening" that makes it a definer, or that reorders its `search_path`, fails a test rather than
  silently exempting everyone.
- **Good:** new create-path guards are a two-line convention (`if public.actor_bypasses_rls() then
  return new; end if;`) instead of a fresh security decision each time.
- **Cost / accepted risk:** anything holding a BYPASSRLS role can still write a forged row. That is
  already true of RLS itself, and the service-role key's blast radius is governed elsewhere
  (`docs/environments.md`, edge-function secrets). The audit triggers deliberately do **not** take the
  exemption — they fire for **all** roles, so a service-role backfill is on the audit trail even though
  it is exempt from the guard. A create is a create.
- **Cost:** the guards cannot distinguish "the ERPNext mirror writer" from "an operator with psql".
  Both are authorities. If that distinction is ever needed, it belongs in a separate, narrower
  predicate — not in this one.
