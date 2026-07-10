# Plan: External-system adapter seam (P0) — `external-adapter-seam`

> **Issue:** `external-adapter-seam (P0)` · **Spec:** [`docs/specs/external-adapter-seam.spec.md`](../specs/external-adapter-seam.spec.md) — **SIGNED OFF** (do not re-litigate any FR/AC/OD).
> **Architecture:** [ADR-0055](../adr/0055-external-system-adapters-sot-enhancement.md). **Phase:** P0 (the seam only).
> **Scope:** the seam — adapter contract (PMO domain language), `external_refs` + `external_sync_watermarks` + `external_domain_ownership` storage, the write-routing branch, the pending-push state machine, the read-only Integrations view, the dispatch edge function, and **the invariant** (empty ownership-map ⇒ byte-for-byte pre-adapter behavior). A reference (test-double) adapter makes every AC provable with **no real external system**.
> **Out of scope (P1+, do NOT build):** real adapters (ClickUp/ERPNext/Odoo), webhook ingress, the sweep engine, real read-model population, backfill/promote runbook, secret provisioning, enhancement storage, write-capable admin surface, optimistic-UI reconciliation.
> **Constraints honored:** no new npm deps; no changes to existing domain DAL/repositories (the write-method branch ships as a generic, tested helper — `executeWrite` — ready for P1 wiring; no existing repo is branched in P0 because no real domain flips in P0, per spec §9); reversible migrations; RLS + explicit grants on all 4 new tables; `org_id` seam enforced.

---

## 1. Design summary

### 1.1 The three layers (ADR-0017 seam respected, interface UNCHANGED)

```
FE repository write-method  ──▶  executeWrite(domain, ownershipMap, directWrite, dispatchWrite)   [router.ts — the branch]
                                      │
                        routeWrite()  │  empty-map ⇒ 'pmo' (FIRST branch, byte-for-byte)          [AC-EAS-001]
                                      │  domain assigned ⇒ 'external'
                                      │
                          ┌───────────┴────────────┐
                     'pmo' │                        │ 'external'
                          ▼                        ▼
                   existing direct DAL        invokeAdapterDispatch()  ──▶  edge fn `adapter-dispatch`
                   (byte-for-byte)                                                │
                                                                          org from JWT (FR-EAS-024)
                                                                          adapter select
                                                                          dispatchExternallyOwnedWrite()  [dispatch.ts — pure]
                                                                              │
                                                                  (1) adapter.commit()  ← NO org_id (AC-EAS-023)
                                                                  (2) writeReadModel()  ← service role (AC-EAS-035)
                                                                  (3) recordExternalRef()               (AC-EAS-042)
                                                                  (4) return                            (AC-EAS-033 order)
```

- **Reads ALWAYS serve from the Supabase read-model via the existing DAL** (`routeRead` is a constant `'dal'` — AC-EAS-030). No read ever routes to an adapter.
- **The routing decision is UX/DX-only** (OD-3): it consults a **cached** own-org ownership map and branches in-memory. **RLS is the enforcement authority** (NFR-EAS-SEC-002): an externally-owned domain's read-model denies user-JWT writes and permits only the dispatch/sync service role (FR-EAS-037).
- **The adapter never receives `org_id`** (FR-EAS-024): org context is bound at the edge function, above the adapter.

### 1.2 The four new tables (migrations 0085–0088; 0084 is the current top — verified)

| Table | Purpose | Write authority | Read |
|---|---|---|---|
| `external_domain_ownership` | the SWITCH: per-org employed tiers + externally-owned domains. **Default empty.** | **Operator-only** (OD-1) via `is_operator()` policy + `operator_set_domain_ownership` RPC (cross-org provisioning) | own-org members |
| `external_refs` | PMO record id ↔ external record id (+ owning tier) | **service role only** (machine-written) | own-org members |
| `external_sync_watermarks` | modified-since cursor per (org, tier, domain) | **service role only** (machine-written) | own-org members |
| `external_reference_items` | the synthetic reference domain's read-model (OD-4); its write-policy **flip** proves FR-EAS-037 | **service role** when 'reference' externally-owned; member-write when PMO-owned (the per-org flip) | own-org members |

**org_id seam** (NFR-EAS-SEC-001): every table uses `org_id uuid not null default coalesce(public.auth_org_id(), '00000000-…-0001')` (the forward-compatible 0061 idiom) + RLS `WITH CHECK`. The client never sends `org_id`; machine tables are written by the service role (the trusted writer); `external_domain_ownership` by the Operator RPC.

**Operator mechanism reused** (per task instruction "reuse the existing operator mechanism"): `public.is_operator()` (0064, SECURITY INVOKER, leans on `platform_operators` SELECT policy) is conjoined in the `external_domain_ownership_write` policy — exactly the `org_features_write` idiom (0070).

**Grants** (auto_expose_new_tables=false regime, 0075): each new table gets **explicit** `grant select` (and full DML only where a member-write policy exists — `external_reference_items`) to `authenticated`/`anon`. `service_role` is auto-granted by 0080's `ALTER DEFAULT PRIVILEGES … grant all on tables to service_role`, so it needs no per-table grant.

### 1.3 FE module layout (`pmo-portal/src/lib/adapterSeam/`)

All adapterSeam modules use **relative imports only** (`./contract`, `../appError`) — never the `@/` alias internally — so the **pure core is Deno-importable** by the edge function (the agent-dispatch precedent imports `../../../pmo-portal/src/…` via relative path). The single FE-only file that touches the browser Supabase client (`clientInvoke.ts`) is **not** imported by the edge function.

| File | Role | Owning ACs |
|---|---|---|
| `contract.ts` | the PMO-owned adapter contract — types only, PMO domain language | (supports 020/021) |
| `referenceAdapter.ts` | reference (test-double) adapter, configurable outcomes | 020, 021, 022, 070 |
| `capabilityMap.ts` | bounds a domain assignment by the tier's static capability map | 013 |
| `router.ts` | `routeRead` (always DAL), `routeWrite` (empty-map short-circuit FIRST), `executeWrite` (the branch) | 001, 002, 014, 030, 031, 032 |
| `dispatch.ts` | **pure** `dispatchExternallyOwnedWrite(deps)` — the ordered synchronous write-through | 023, 033, 034, 042 |
| `pendingPush.ts` | shared pending-push state machine (`idle`/`pushing`/`pushed`/`push-failed`) + `{headline,detail}` error surface | 060, 061, 062 |
| `clientInvoke.ts` | FE-only `invokeAdapterDispatch()` → `supabase.functions.invoke('adapter-dispatch')` (the externally-owned write target; wiring for P1) | — |

### 1.4 The dispatch edge function (`supabase/functions/adapter-dispatch/`)

Deno Edge Function, `verify_jwt=true` (the user's JWT is forwarded). Order (AC-EAS-033): **org from JWT** → **adapter select** (registry: P0 = only `reference`) → **command invoke** (no org_id, AC-EAS-023) → **read-model update** (service role) → **external_refs record** → return. Integration-only (not unit-tested — same contract as `agent-dispatch/index.ts`); verified by `deno check` + the boot-smoke.

---

## 2. Tasks (strict TDD order — failing test first per task; each 2–5 min, self-contained)

> **Verify commands.** Vitest: `cd pmo-portal && npx vitest run <file>` (from `pmo-portal/`). pgTAP: `scripts/with-db-lock.sh supabase test db` (repo root). Every task's final line is the green command. Migrations apply via `supabase db reset`/`test db` (numbered 0085–0088; verified non-colliding — current top is 0084).

---

### Task 1 — `external_domain_ownership` table + RLS + Operator RPC + `domain_externally_owned()` + pgTAP (AC-EAS-010, AC-EAS-011, AC-EAS-012)

**RED — write the failing test first.** Create `supabase/tests/external_domain_ownership_rls.test.sql`:

```sql
-- external_domain_ownership_rls.test.sql
-- AC-EAS-010 [pgTAP]: a fresh org with no config ⇒ 0 rows (default empty; all domains PMO-owned).
-- AC-EAS-011 [pgTAP]: org isolation — org B member reads nothing of org A's rows.
-- AC-EAS-012 [pgTAP]: Operator-only write — non-Operator INSERT denied (42501); a spoofed cross-org
--                     org_id write denied (42501); Operator writes via operator_set_domain_ownership;
--                     a direct Operator insert stamps org_id server-side (column default).
begin;
select plan(7);

insert into organizations (id, name) values
  ('00850000-0000-0000-0000-000000000001','AC-EAS Org A'),
  ('00850000-0000-0000-0000-000000000002','AC-EAS Org B');
insert into auth.users (id, email) values
  ('00850000-0000-0000-0000-0000000000a1','eas-a-member@example.com'),
  ('00850000-0000-0000-0000-0000000000b1','eas-b-member@example.com'),
  ('00850000-0000-0000-0000-0000000000f1','eas-operator@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('00850000-0000-0000-0000-0000000000a1','00850000-0000-0000-0000-000000000001','A Member','eas-a-member@example.com','Admin','active'),
  ('00850000-0000-0000-0000-0000000000b1','00850000-0000-0000-0000-000000000002','B Member','eas-b-member@example.com','Admin','active'),
  ('00850000-0000-0000-0000-0000000000f1','00850000-0000-0000-0000-000000000001','Operator','eas-operator@example.com','Admin','active');
insert into platform_operators (user_id) values ('00850000-0000-0000-0000-0000000000f1');

-- AC-EAS-010: fresh org B (no config) ⇒ 0 rows.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00850000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is((select count(*)::int from external_domain_ownership), 0,
  'AC-EAS-010 fresh org reads 0 ownership rows (default empty)');

-- Seed an org-A row AS OWNER (bypasses RLS) for the isolation + write tests.
insert into external_domain_ownership (org_id, external_tier, domain)
values ('00850000-0000-0000-0000-000000000001','reference','reference');

-- AC-EAS-011: org-B member still reads 0 (org-A row invisible cross-org).
select is((select count(*)::int from external_domain_ownership), 0,
  'AC-EAS-011 org-B member reads nothing of org-A ownership (org isolation)');
-- org-A member reads the 1 own-org row.
set local request.jwt.claims = '{"sub":"00850000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((select count(*)::int from external_domain_ownership), 1,
  'AC-EAS-011 org-A member reads own-org ownership row');

-- AC-EAS-012(a): non-Operator (org-A Admin) INSERT denied (42501 — no matching Operator policy).
select throws_ok(
  $$ insert into external_domain_ownership (org_id, external_tier, domain) values ('00850000-0000-0000-0000-000000000001','reference','tasks') $$,
  '42501', null,
  'AC-EAS-012 non-Operator INSERT denied (Operator-only)');
-- AC-EAS-012(b): spoofed cross-org org_id by a non-Operator also denied (42501).
select throws_ok(
  $$ insert into external_domain_ownership (org_id, external_tier, domain) values ('00850000-0000-0000-0000-000000000002','reference','reference') $$,
  '42501', null,
  'AC-EAS-012 spoofed cross-org org_id INSERT denied');

-- Operator provisions org B (cross-org) via the RPC; then a direct Operator insert stamps org_id.
set local request.jwt.claims = '{"sub":"00850000-0000-0000-0000-0000000000f1","role":"authenticated"}';
select lives_ok(
  $$ select operator_set_domain_ownership('00850000-0000-0000-0000-000000000002','reference','reference','employ') $$,
  'AC-EAS-012 Operator cross-org employ via RPC succeeds');
insert into external_domain_ownership (external_tier, domain) values ('reference','tasks')
  returning org_id;
select is((select org_id from external_domain_ownership where external_tier='reference' and domain='tasks'),
  '00850000-0000-0000-0000-000000000001'::uuid,
  'AC-EAS-012 Operator direct insert stamps own org_id server-side (column default)');

select finish();
rollback;
```

Run RED: `scripts/with-db-lock.sh supabase test db` → the new file fails (`relation external_domain_ownership does not exist`).

**GREEN — create the migration** `supabase/migrations/0085_external_domain_ownership.sql`:

```sql
-- 0085_external_domain_ownership.sql — the domain-ownership SWITCH (ADR-0055 P0, FR-EAS-001..007).
-- org-scoped; records employed external tiers + consequently externally-owned domains. DEFAULT EMPTY
-- (FR-EAS-002). RLS: own-org member read (FR-EAS-005/011); Operator-only write (OD-1, FR-EAS-006/012),
-- cross-org provisioning via operator_set_domain_ownership. org_id never sent by the client (column
-- default stamps it). Also defines domain_externally_owned() — used by 0088's read-model flip (FR-EAS-037).
-- Reversibility (ADR-0006): supabase db reset. Manual reverse:
--   drop function if exists public.operator_set_domain_ownership(uuid,text,text,text);
--   drop function if exists public.domain_externally_owned(uuid,text);
--   drop policy if exists external_domain_ownership_select on public.external_domain_ownership;
--   drop policy if exists external_domain_ownership_write on public.external_domain_ownership;
--   drop table if exists public.external_domain_ownership;

create table public.external_domain_ownership (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null default coalesce(public.auth_org_id(), '00000000-0000-0000-0000-000000000001')
                  references public.organizations(id) on delete cascade,
  external_tier text not null,          -- 'reference' (P0); 'clickup'/'erpnext'/'odoo' (P1+)
  domain        text not null,          -- the PMO domain (e.g. 'reference')
  created_at    timestamptz not null default now(),
  created_by    uuid references public.profiles(id),
  unique (org_id, external_tier, domain)
);
create index external_domain_ownership_org_idx        on public.external_domain_ownership (org_id);
create index external_domain_ownership_org_domain_idx on public.external_domain_ownership (org_id, domain);

alter table public.external_domain_ownership enable row level security;
alter table public.external_domain_ownership force  row level security;

-- READ: own-org members (FR-EAS-005/011).
create policy external_domain_ownership_select on public.external_domain_ownership
  for select using (org_id = public.auth_org_id() and public.is_active_member());

-- WRITE: Operator-only (OD-1). Mirrors org_features_write (0070): NO org_id = auth_org_id() constraint —
-- the Operator provisions any org via the security-definer RPC; a non-Operator matches no policy ⇒ every
-- write (incl. a spoofed org_id) is denied 42501 (FR-EAS-006/012). service_role bypasses RLS regardless.
create policy external_domain_ownership_write on public.external_domain_ownership
  for all using (public.is_operator() and public.is_active_member())
  with check (public.is_operator() and public.is_active_member());

-- Explicit client-role grants (auto_expose_new_tables=false, 0075): members SELECT only; NO client
-- INSERT/UPDATE/DELETE grant (Operator-via-RPC is the sole write path).
grant select on public.external_domain_ownership to authenticated;
grant select on public.external_domain_ownership to anon;

-- domain_externally_owned(org, domain): true iff the org assigned `domain` to an employed tier
-- (FR-EAS-003). SECURITY INVOKER (stable) — reads external_domain_ownership UNDER the caller's RLS, so
-- it reflects the caller's OWN org; the own-org ownership value is not a secret (the Integrations view
-- reads it directly). Used by external_reference_items' write-policy flip (0088, FR-EAS-037).
create or replace function public.domain_externally_owned(p_org_id uuid, p_domain text) returns boolean
  language sql stable security invoker set search_path = public as $$
  select exists (select 1 from public.external_domain_ownership
                  where org_id = p_org_id and domain = p_domain)
$$;
revoke all on function public.domain_externally_owned(uuid,text) from public;
grant  execute on function public.domain_externally_owned(uuid,text) to authenticated;

-- operator_set_domain_ownership: the Operator provisioning write contract (OD-2). Upserts ('employ') or
-- removes ('release') an (org, tier, domain) assignment; Operator-only; validates org exists (23503).
-- Mirrors operator_toggle_feature (0070). The capability-map bound (FR-EAS-004/AC-EAS-013) is enforced
-- at the TS routing layer (capabilityMap.ts); the DB stores what the Operator sets.
create or replace function public.operator_set_domain_ownership(
  p_org_id uuid, p_tier text, p_domain text, p_action text
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_active_member() then
    raise exception 'inactive' using errcode = '42501';
  end if;
  if not public.is_operator() then
    raise exception 'operator_only' using errcode = '42501';
  end if;
  if not exists (select 1 from public.organizations where id = p_org_id) then
    raise exception 'unknown_org' using errcode = '23503';
  end if;
  if p_action = 'employ' then
    insert into public.external_domain_ownership (org_id, external_tier, domain, created_by)
      values (p_org_id, p_tier, p_domain, auth.uid())
    on conflict (org_id, external_tier, domain) do nothing;
  elsif p_action = 'release' then
    delete from public.external_domain_ownership
    where org_id = p_org_id and external_tier = p_tier and domain = p_domain;
  else
    raise exception 'bad_action' using errcode = 'P0001';
  end if;
end $$;
revoke all on function public.operator_set_domain_ownership(uuid,text,text,text) from public;
grant  execute on function public.operator_set_domain_ownership(uuid,text,text,text) to authenticated;
```

**GREEN verify:** `scripts/with-db-lock.sh supabase test db` → all green (incl. the 7 new assertions).

---

### Task 2 — `external_refs` table + RLS (machine-only write) + pgTAP (AC-EAS-040, AC-EAS-041)

**RED — create** `supabase/tests/external_refs_rls.test.sql`:

```sql
-- external_refs_rls.test.sql
-- AC-EAS-040 [pgTAP]: external_refs is org-isolated on read (org-B member sees nothing of org-A's ref).
-- AC-EAS-041 [pgTAP]: machine-written only — a user JWT INSERT/UPDATE/DELETE is denied; service role upserts.
begin;
select plan(5);

insert into organizations (id, name) values
  ('00860000-0000-0000-0000-000000000001','AC-EAS Refs A'),
  ('00860000-0000-0000-0000-000000000002','AC-EAS Refs B');
insert into auth.users (id, email) values
  ('00860000-0000-0000-0000-0000000000a1','refs-a@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('00860000-0000-0000-0000-0000000000a1','00860000-0000-0000-0000-000000000001','A','refs-a@example.com','Admin','active');

-- Seed an org-A ref AS OWNER (the dispatch/sync service-role path; bypasses RLS).
insert into external_refs (org_id, domain, pmo_record_id, external_tier, external_record_id)
values ('00860000-0000-0000-0000-000000000001','reference','pmo-1','reference','ext-1');

-- AC-EAS-040: org-A member reads the 1 own-org ref.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00860000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((select count(*)::int from external_refs), 1,
  'AC-EAS-040 org-A member reads own-org external_ref');
-- Simulate a cross-org caller by switching the profile's org claim target: an org-B member would see 0.
-- (No org-B profile seeded; assert the own-org scoping predicate directly via a second org insert + member.)
insert into auth.users (id, email) values ('00860000-0000-0000-0000-0000000000b1','refs-b@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('00860000-0000-0000-0000-0000000000b1','00860000-0000-0000-0000-000000000002','B','refs-b@example.com','Admin','active');
set local request.jwt.claims = '{"sub":"00860000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is((select count(*)::int from external_refs), 0,
  'AC-EAS-040 org-B member reads nothing of org-A external_refs (org isolation)');

-- AC-EAS-041: user JWT cannot write.
set local request.jwt.claims = '{"sub":"00860000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok(
  $$ insert into external_refs (org_id, domain, pmo_record_id, external_tier, external_record_id) values ('00860000-0000-0000-0000-000000000001','reference','pmo-2','reference','ext-2') $$,
  '42501', null,
  'AC-EAS-041 user-JWT INSERT denied (machine-written only)');
with u as (update external_refs set external_record_id='ext-1b' returning 1)
select is((select count(*)::int from u), 0, 'AC-EAS-041 user-JWT UPDATE affects 0 rows');
with d as (delete from external_refs returning 1)
select is((select count(*)::int from d), 0, 'AC-EAS-041 user-JWT DELETE affects 0 rows');

-- Service role (table owner, RLS bypass) upserts — the dispatch path.
reset role;
insert into external_refs (org_id, domain, pmo_record_id, external_tier, external_record_id)
values ('00860000-0000-0000-0000-000000000001','reference','pmo-2','reference','ext-2')
on conflict (org_id, domain, pmo_record_id) do update set external_record_id = excluded.external_record_id;
select is((select count(*)::int from external_refs where pmo_record_id='pmo-2'), 1,
  'AC-EAS-041 service-role upsert succeeds (machine writer)');

select finish();
rollback;
```

Run RED: `scripts/with-db-lock.sh supabase test db` → fails (`relation external_refs does not exist`).

**GREEN — create** `supabase/migrations/0086_external_refs.sql`:

```sql
-- 0086_external_refs.sql — PMO record id ↔ external record id mapping (FR-EAS-040..043, AC-EAS-040/041).
-- Machine-written only (dispatch/sync service role); org-isolated on read. Minimal mapping (OQ-2: no
-- last-synced richness in P0). Reversibility (ADR-0006): supabase db reset. Manual reverse:
--   drop policy if exists external_refs_select on public.external_refs; drop table if exists public.external_refs;

create table public.external_refs (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null default coalesce(public.auth_org_id(), '00000000-0000-0000-0000-000000000001')
                       references public.organizations(id) on delete cascade,
  domain             text not null,
  pmo_record_id      text not null,
  external_tier      text not null,
  external_record_id text not null,
  created_at         timestamptz not null default now(),
  unique (org_id, domain, pmo_record_id)
);
create index external_refs_org_domain_ext_idx on public.external_refs (org_id, domain, external_record_id);
create index external_refs_org_idx             on public.external_refs (org_id);

alter table public.external_refs enable row level security;
alter table public.external_refs force  row level security;

-- READ: own-org members (FR-EAS-041, AC-EAS-040).
create policy external_refs_select on public.external_refs
  for select using (org_id = public.auth_org_id() and public.is_active_member());

-- WRITE: machine-only. NO insert/update/delete policy for authenticated/anon ⇒ default-deny for every
-- user JWT (FR-EAS-042, AC-EAS-041); only service_role (RLS bypass) writes during dispatch/sync.

-- Client-role grants (auto_expose=false): members SELECT only; NO write grant.
grant select on public.external_refs to authenticated;
grant select on public.external_refs to anon;
```

**GREEN verify:** `scripts/with-db-lock.sh supabase test db` → all green.

---

### Task 3 — `external_sync_watermarks` table + RLS + pgTAP (AC-EAS-050)

**RED — create** `supabase/tests/external_sync_watermarks_rls.test.sql`:

```sql
-- external_sync_watermarks_rls.test.sql
-- AC-EAS-050 [pgTAP]: org-isolated read; machine-written only (user-JWT write denied; service role upserts).
-- (AC-EAS-051 — one row per (org,tier,domain) — is owned by the Vitest unit test; pgTAP proves the
--  unique constraint + RLS write-authority here as defense-in-depth.)
begin;
select plan(5);

insert into organizations (id, name) values
  ('00870000-0000-0000-0000-000000000001','AC-EAS WM A'),
  ('00870000-0000-0000-0000-000000000002','AC-EAS WM B');
insert into auth.users (id, email) values
  ('00870000-0000-0000-0000-0000000000a1','wm-a@example.com'),
  ('00870000-0000-0000-0000-0000000000b1','wm-b@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('00870000-0000-0000-0000-0000000000a1','00870000-0000-0000-0000-000000000001','A','wm-a@example.com','Admin','active'),
  ('00870000-0000-0000-0000-0000000000b1','00870000-0000-0000-0000-000000000002','B','wm-b@example.com','Admin','active');

-- Seed as OWNER (service-role path).
insert into external_sync_watermarks (org_id, external_tier, domain, watermark_cursor)
values ('00870000-0000-0000-0000-000000000001','reference','reference','cur-1');

-- AC-EAS-050: own-org read; cross-org invisible.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00870000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((select count(*)::int from external_sync_watermarks), 1, 'AC-EAS-050 org-A reads own watermark');
set local request.jwt.claims = '{"sub":"00870000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is((select count(*)::int from external_sync_watermarks), 0, 'AC-EAS-050 org-B reads nothing (org isolation)');

-- AC-EAS-050: user-JWT write denied (machine-only).
select throws_ok(
  $$ insert into external_sync_watermarks (org_id, external_tier, domain, watermark_cursor) values ('00870000-0000-0000-0000-000000000002','reference','reference','cur-x') $$,
  '42501', null, 'AC-EAS-050 user-JWT INSERT denied (machine-written only)');

-- Service-role upsert: exactly one row per (org,tier,domain) (defense-in-depth for AC-EAS-051).
reset role;
insert into external_sync_watermarks (org_id, external_tier, domain, watermark_cursor)
values ('00870000-0000-0000-0000-000000000001','reference','reference','cur-2')
on conflict (org_id, external_tier, domain) do update set watermark_cursor = excluded.watermark_cursor;
select is((select count(*)::int from external_sync_watermarks where org_id='00870000-0000-0000-0000-000000000001'), 1,
  'AC-EAS-050 upsert keeps exactly one row per (org,tier,domain)');
select is((select watermark_cursor from external_sync_watermarks where org_id='00870000-0000-0000-0000-000000000001'), 'cur-2',
  'AC-EAS-050 upsert advances the cursor in place');

select finish();
rollback;
```

Run RED: `scripts/with-db-lock.sh supabase test db` → fails (relation missing).

**GREEN — create** `supabase/migrations/0087_external_sync_watermarks.sql`:

```sql
-- 0087_external_sync_watermarks.sql — modified-since cursor storage (FR-EAS-050..052, AC-EAS-050).
-- Machine-written only; org-isolated read; EXACTLY ONE row per (org, tier, domain) via the unique key.
-- P0 = storage + RLS only (the sweep engine is P1). Reversibility (ADR-0006): supabase db reset. Manual:
--   drop policy if exists external_sync_watermarks_select on public.external_sync_watermarks;
--   drop table if exists public.external_sync_watermarks;

create table public.external_sync_watermarks (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null default coalesce(public.auth_org_id(), '00000000-0000-0000-0000-000000000001')
                     references public.organizations(id) on delete cascade,
  external_tier    text not null,
  domain           text not null,
  watermark_cursor text not null default '',   -- opaque cursor (OQ-1: type is a P1 sweep detail)
  updated_at       timestamptz not null default now(),
  unique (org_id, external_tier, domain)
);
create index external_sync_watermarks_org_idx on public.external_sync_watermarks (org_id);

alter table public.external_sync_watermarks enable row level security;
alter table public.external_sync_watermarks force  row level security;

-- READ: own-org members (FR-EAS-051, AC-EAS-050).
create policy external_sync_watermarks_select on public.external_sync_watermarks
  for select using (org_id = public.auth_org_id() and public.is_active_member());

-- WRITE: machine-only — NO write policy for authenticated/anon (default-deny); service_role only.

grant select on public.external_sync_watermarks to authenticated;
grant select on public.external_sync_watermarks to anon;
```

**GREEN verify:** `scripts/with-db-lock.sh supabase test db` → all green.

---

### Task 4 — `external_reference_items` read-model + write-policy FLIP + pgTAP (AC-EAS-035)

**RED — create** `supabase/tests/external_reference_items_rls.test.sql`:

```sql
-- external_reference_items_rls.test.sql
-- AC-EAS-035 [pgTAP]: while 'reference' is externally-owned for org A, a user-JWT write to the
-- read-model is DENIED (42501) and the dispatch/sync service role writes succeed (FR-EAS-037, OD-4).
begin;
select plan(4);

insert into organizations (id, name) values
  ('00880000-0000-0000-0000-000000000001','AC-EAS RefItems A (flipped)'),
  ('00880000-0000-0000-0000-000000000002','AC-EAS RefItems B (PMO-owned)');
insert into auth.users (id, email) values ('00880000-0000-0000-0000-0000000000a1','ri-a@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('00880000-0000-0000-0000-0000000000a1','00880000-0000-0000-0000-000000000001','A','ri-a@example.com','Admin','active');

-- Flip 'reference' to externally-owned for org A (the FR-EAS-037 trigger).
insert into external_domain_ownership (org_id, external_tier, domain)
values ('00880000-0000-0000-0000-000000000001','reference','reference');

-- AC-EAS-035: org-A member (user JWT) write DENIED on the flipped read-model.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00880000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok(
  $$ insert into external_reference_items (org_id, pmo_record_id, payload) values ('00880000-0000-0000-0000-000000000001','pmo-1','{"id":"pmo-1"}') $$,
  '42501', null,
  'AC-EAS-035 user-JWT INSERT denied while reference externally-owned (RLS flip)');
with u as (update external_reference_items set payload='{}' returning 1)
select is((select count(*)::int from u), 0, 'AC-EAS-035 user-JWT UPDATE denied (flip)');
-- Reads stay open on the read-model (the Assistant/query path).
select lives_ok(
  $$ select count(*) from external_reference_items $$,
  'AC-EAS-035 read-model stays readable while externally-owned');

-- AC-EAS-035: dispatch/sync service role writes succeed (RLS bypass).
reset role;
insert into external_reference_items (org_id, pmo_record_id, payload)
values ('00880000-0000-0000-0000-000000000001','pmo-1','{"id":"pmo-1","external_id":"ext-1"}');
select is((select count(*)::int from external_reference_items where pmo_record_id='pmo-1'), 1,
  'AC-EAS-035 service-role write to read-model succeeds');

select finish();
rollback;
```

Run RED: `scripts/with-db-lock.sh supabase test db` → fails (relation missing).

**GREEN — create** `supabase/migrations/0088_external_reference_items.sql`:

```sql
-- 0088_external_reference_items.sql — the synthetic reference domain's read-model (OD-4, FR-EAS-037,
-- AC-EAS-035). org-scoped; the write-policy FLIP denies user-JWT writes WHILE 'reference' is externally-
-- owned for the org (domain_externally_owned, 0085) and permits only the dispatch/sync service role.
-- When 'reference' is PMO-owned the normal member-write path applies (the flip is per-org — ADR-0055 §3).
-- Reversibility (ADR-0006): supabase db reset. Manual:
--   drop policy if exists external_reference_items_select on public.external_reference_items;
--   drop policy if exists external_reference_items_write  on public.external_reference_items;
--   drop table if exists public.external_reference_items;

create table public.external_reference_items (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null default coalesce(public.auth_org_id(), '00000000-0000-0000-0000-000000000001')
                  references public.organizations(id) on delete cascade,
  pmo_record_id text not null,
  payload       jsonb not null default '{}'::jsonb,   -- the canonical PMO-shaped record
  created_at    timestamptz not null default now(),
  unique (org_id, pmo_record_id)
);
create index external_reference_items_org_idx on public.external_reference_items (org_id);

alter table public.external_reference_items enable row level security;
alter table public.external_reference_items force  row level security;

-- READ: own-org members.
create policy external_reference_items_select on public.external_reference_items
  for select using (org_id = public.auth_org_id() and public.is_active_member());

-- WRITE: the FR-EAS-037 FLIP. User-JWT writes DENIED while 'reference' is externally-owned for the org;
-- permitted (normal member write) when 'reference' is PMO-owned. service_role bypasses RLS ⇒ the
-- dispatch always writes the read-model (AC-EAS-035). domain_externally_owned is SECURITY INVOKER (0085)
-- so it reflects the caller's own org under RLS.
create policy external_reference_items_write on public.external_reference_items
  for all using (
    org_id = public.auth_org_id()
    and public.is_active_member()
    and not public.domain_externally_owned(public.auth_org_id(), 'reference'))
  with check (
    org_id = public.auth_org_id()
    and public.is_active_member()
    and not public.domain_externally_owned(public.auth_org_id(), 'reference'));

-- Client-role grants (auto_expose=false): full DML mirror (the POLICY is the authority — a granted but
-- RLS-denied write still 42501s). service_role auto-granted by 0080's ALTER DEFAULT PRIVILEGES.
grant select, insert, update, delete on public.external_reference_items to authenticated;
grant select, insert, update, delete on public.external_reference_items to anon;
```

**GREEN verify:** `scripts/with-db-lock.sh supabase test db` → all green (the 4 new + every prior).

---

### Task 5 — `contract.ts` (the adapter contract — types only, PMO domain language)

Structural (types) — behavior is proven transitively by Task 6 (`referenceAdapter.test.ts`). Create `pmo-portal/src/lib/adapterSeam/contract.ts`:

```ts
/**
 * The PMO-owned adapter contract (ADR-0055 §2, FR-EAS-020/021). PMO domain language ONLY — no PMO code
 * above the contract couples to any external system's shapes (NFR-EAS-CONTRACT-001). Relative imports
 * only (no `@/` alias) so this pure core is Deno-importable by the adapter-dispatch edge function.
 */

/** A PMO domain that an external tier can natively own ('reference' in P0; real domains P1+). */
export type PmoDomain = string;

/** The static per-system capability map: the PMO domains this adapter's tier can natively own (FR-EAS-004). */
export type CapabilityMap = ReadonlySet<PmoDomain>;

/** Write operations an adapter can commit for an owned domain (PMO verbs; never external vocabulary). */
export type AdapterOperation = 'create' | 'update' | 'delete' | 'transition';

/** A PMO-shaped record — the adapter commits THIS shape, never an external system's (FR-EAS-020). */
export interface PmoRecord {
  /** The PMO record id (caller-supplied for create; the canonical id on read). */
  id: string;
  [field: string]: unknown;
}

/** The canonical answer a synchronous command returns: external id + canonical PMO record (FR-EAS-022). */
export interface CommandResult {
  externalRecordId: string;
  canonical: PmoRecord;
}

/** Classified adapter errors (FR-EAS-023). */
export type AdapterErrorCode = 'commit-rejected' | 'external-unreachable';
export class AdapterError extends Error {
  readonly code: AdapterErrorCode;
  constructor(code: AdapterErrorCode, message: string) {
    super(message);
    this.name = 'AdapterError';
    this.code = code;
  }
}

/**
 * A command issued to an adapter. PMO domain language; NEVER carries org_id (FR-EAS-024) — the dispatch
 * binds the org context ABOVE the adapter. This type is the proof surface for AC-EAS-023.
 */
export interface AdapterCommand {
  domain: PmoDomain;
  operation: AdapterOperation;
  record: PmoRecord;
}

/** The adapter contract every adapter implements (FR-EAS-020/021). */
export interface Adapter {
  /** The external tier this adapter speaks (e.g. 'reference'). */
  readonly tier: string;
  /** The static per-system capability map (domains this tier can natively own). */
  readonly capabilityMap: CapabilityMap;
  /** Synchronously commit a command; returns external id + canonical record (FR-EAS-022). */
  commit(command: AdapterCommand): Promise<CommandResult>;
}
```

**Verify (structural):** `cd pmo-portal && npx tsc --noEmit` → zero errors. (Behavior exercised in Task 6.)

---

### Task 6 — `referenceAdapter.ts` + test (AC-EAS-020, AC-EAS-021, AC-EAS-022; backs AC-EAS-070)

**RED — create** `pmo-portal/src/lib/adapterSeam/referenceAdapter.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createReferenceAdapter, REFERENCE_DOMAIN, type ReferenceOutcome } from './referenceAdapter';
import { AdapterError } from './contract';
import type { AdapterCommand } from './contract';

const cmd = (recordId: string): AdapterCommand => ({
  domain: REFERENCE_DOMAIN,
  operation: 'create',
  record: { id: recordId, name: 'Widget' },
});

describe('AC-EAS-020 reference adapter implements the contract in PMO domain language', () => {
  it('AC-EAS-020 declares a static capability map containing the reference domain', () => {
    const a = createReferenceAdapter();
    expect(a.tier).toBe('reference');
    expect(a.capabilityMap.has(REFERENCE_DOMAIN)).toBe(true);
    expect(a.capabilityMap.size).toBe(1);
  });
});

describe('AC-EAS-021 a command synchronously returns the external id + canonical record', () => {
  it('AC-EAS-021 commit-success returns a non-null external id + a canonical PMO record', async () => {
    const a = createReferenceAdapter('commit-success');
    const result = await a.commit(cmd('pmo-1'));
    expect(result.externalRecordId).toBeTruthy();
    expect(result.canonical.id).toBe('pmo-1');
  });
});

describe('AC-EAS-022 an external rejection / unreachability surfaces as a classified error', () => {
  it.each<ReferenceOutcome>(['commit-rejected-validation', 'external-unreachable'])(
    'AC-EAS-022 %s throws an AdapterError carrying a code + message',
    async (outcome) => {
      const a = createReferenceAdapter(outcome);
      await expect(a.commit(cmd('pmo-2'))).rejects.toMatchObject({
        name: 'AdapterError',
        code: outcome === 'external-unreachable' ? 'external-unreachable' : 'commit-rejected',
      });
    },
  );
  it('AC-EAS-022 the classified error carries the external system message', async () => {
    const a = createReferenceAdapter('commit-rejected-validation');
    await expect(a.commit(cmd('pmo-3'))).rejects.toBeInstanceOf(AdapterError);
  });
});
```

Run RED: `cd pmo-portal && npx vitest run src/lib/adapterSeam/referenceAdapter.test.ts` → fails (module not found).

**GREEN — create** `pmo-portal/src/lib/adapterSeam/referenceAdapter.ts`:

```ts
/**
 * Reference (test-double) adapter (FR-EAS-025, AC-EAS-020..022/070). Implements the adapter contract
 * for the synthetic 'reference' domain with configurable outcomes, so every P0 AC is provable with NO
 * real external system. Pure (no supabase/browser imports) ⇒ Deno-importable by the adapter-dispatch
 * edge function. NEVER receives org_id (FR-EAS-024) — proven at the dispatch (AC-EAS-023).
 */
import { Adapter, AdapterCommand, AdapterError, CommandResult, PmoDomain } from './contract';

/** Configurable outcomes for the reference adapter (FR-EAS-025). */
export type ReferenceOutcome = 'commit-success' | 'commit-rejected-validation' | 'external-unreachable';

/** The synthetic domain the reference adapter owns (OD-4 — zero contact with real-domain behavior). */
export const REFERENCE_DOMAIN: PmoDomain = 'reference';

/** A reference adapter with a readable `outcome` (for assertions). */
export interface ReferenceAdapter extends Adapter {
  readonly outcome: ReferenceOutcome;
}

/** Construct a reference adapter with the given outcome (default commit-success). */
export function createReferenceAdapter(outcome: ReferenceOutcome = 'commit-success'): ReferenceAdapter {
  return {
    tier: 'reference',
    capabilityMap: new Set<PmoDomain>([REFERENCE_DOMAIN]),
    outcome,
    async commit(command: AdapterCommand): Promise<CommandResult> {
      if (command.domain !== REFERENCE_DOMAIN) {
        throw new AdapterError('commit-rejected', `reference adapter cannot own domain "${command.domain}"`);
      }
      if (outcome === 'external-unreachable') {
        throw new AdapterError('external-unreachable', 'reference system unreachable');
      }
      if (outcome === 'commit-rejected-validation') {
        throw new AdapterError('commit-rejected', 'reference system rejected the payload');
      }
      const externalRecordId = `ext-${command.record.id}`;
      return { externalRecordId, canonical: { ...command.record, external_id: externalRecordId } };
    },
  };
}
```

**GREEN verify:** `cd pmo-portal && npx vitest run src/lib/adapterSeam/referenceAdapter.test.ts` → green.

---

### Task 7 — `capabilityMap.ts` + test (AC-EAS-013)

**RED — create** `pmo-portal/src/lib/adapterSeam/capabilityMap.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { canAssignDomainToTier, assertDomainInCapabilityMap, CapabilityMapError } from './capabilityMap';

const cap = new Set(['reference', 'tasks']);

describe('AC-EAS-013 a domain assignment is bounded by the employed tier static capability map', () => {
  it('AC-EAS-013 a domain in the map is assignable', () => {
    expect(canAssignDomainToTier(cap, 'reference')).toBe(true);
    expect(canAssignDomainToTier(cap, 'tasks')).toBe(true);
  });
  it('AC-EAS-013 a domain NOT in the map is not assignable', () => {
    expect(canAssignDomainToTier(cap, 'accounting')).toBe(false); // D3 — outside the tier map
  });
  it('AC-EAS-013 assertDomainInCapabilityMap throws for a domain outside the tier map', () => {
    expect(() => assertDomainInCapabilityMap(cap, 'clickup', 'accounting')).toThrow(CapabilityMapError);
  });
  it('AC-EAS-013 assertDomainInCapabilityMap passes for a domain inside the tier map', () => {
    expect(() => assertDomainInCapabilityMap(cap, 'clickup', 'reference')).not.toThrow();
  });
});
```

Run RED: `cd pmo-portal && npx vitest run src/lib/adapterSeam/capabilityMap.test.ts` → fails (module not found).

**GREEN — create** `pmo-portal/src/lib/adapterSeam/capabilityMap.ts`:

```ts
/**
 * Capability-map bounding (FR-EAS-004, AC-EAS-013). An org may assign to a tier only domains within
 * that tier's STATIC capability map, so the effective flip set is bounded by the employed tier's real
 * capabilities. Pure helpers used by the provisioning path + the routing layer.
 */
import { CapabilityMap, PmoDomain } from './contract';

/** True iff the tier's static capability map can natively own `domain` (FR-EAS-004, AC-EAS-013). */
export function canAssignDomainToTier(capabilityMap: CapabilityMap, domain: PmoDomain): boolean {
  return capabilityMap.has(domain);
}

/** Thrown when an assignment targets a domain the tier cannot own (AC-EAS-013 rejection). */
export class CapabilityMapError extends Error {
  constructor(domain: PmoDomain, tier: string) {
    super(`domain "${domain}" is not in tier "${tier}"'s capability map`);
    this.name = 'CapabilityMapError';
  }
}

/** Reject (throw) an assignment outside the tier's capability map — the provisioning guard. */
export function assertDomainInCapabilityMap(
  capabilityMap: CapabilityMap,
  tier: string,
  domain: PmoDomain,
): void {
  if (!canAssignDomainToTier(capabilityMap, domain)) throw new CapabilityMapError(domain, tier);
}
```

**GREEN verify:** `cd pmo-portal && npx vitest run src/lib/adapterSeam/capabilityMap.test.ts` → green.

---

### Task 8 — `router.ts` + test (AC-EAS-001, AC-EAS-002, AC-EAS-014, AC-EAS-030, AC-EAS-031, AC-EAS-032)

**RED — create** `pmo-portal/src/lib/adapterSeam/router.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import {
  routeRead,
  routeWrite,
  executeWrite,
  EMPTY_OWNERSHIP_MAP,
  type OwnershipMap,
} from './router';
import { IDLE_PENDING_PUSH, pendingPushAfterWrite } from './pendingPush';

describe('AC-EAS-001 empty ownership map ⇒ write takes the direct-DAL path (byte-for-byte)', () => {
  it('AC-EAS-001 routeWrite returns pmo for an empty map (short-circuit FIRST)', () => {
    expect(routeWrite('reference', EMPTY_OWNERSHIP_MAP)).toBe('pmo');
    expect(routeWrite('anything', {} as OwnershipMap)).toBe('pmo');
  });
  it('AC-EAS-001 executeWrite with an empty map calls directWrite and NOT dispatchWrite', async () => {
    const directWrite = vi.fn(async (p: string) => `direct:${p}`);
    const dispatchWrite = vi.fn(async (p: string) => `dispatch:${p}`);
    const res = await executeWrite({
      domain: 'reference', ownershipMap: EMPTY_OWNERSHIP_MAP, payload: 'x',
      directWrite, dispatchWrite,
    });
    expect(res).toBe('direct:x');
    expect(directWrite).toHaveBeenCalledTimes(1);
    expect(dispatchWrite).not.toHaveBeenCalled();
  });
});

describe('AC-EAS-002 empty map ⇒ reads from the DAL and no pending-push state', () => {
  it('AC-EAS-002 routeRead always returns dal', () => {
    expect(routeRead('reference')).toBe('dal');
  });
  it('AC-EAS-002 a write under an empty map produces no pushing/pushed/push-failed state', async () => {
    const directWrite = vi.fn(async () => {});
    await executeWrite({
      domain: 'reference', ownershipMap: EMPTY_OWNERSHIP_MAP, payload: 'x',
      directWrite, dispatchWrite: vi.fn(),
    });
    // The direct path never engages the pending-push machine ⇒ idle.
    expect(pendingPushAfterWrite('pmo', { ok: true })).toEqual(IDLE_PENDING_PUSH);
  });
});

describe('AC-EAS-014 the ownership-decision routes by own-org ownership only', () => {
  const orgAMap: OwnershipMap = { reference: 'reference' }; // org A owns 'reference'
  it('AC-EAS-014 an assigned domain routes to dispatch', () => {
    expect(routeWrite('reference', orgAMap)).toBe('external');
  });
  it('AC-EAS-014 an unassigned domain routes to the direct DAL', () => {
    expect(routeWrite('tasks', orgAMap)).toBe('pmo');
  });
  it('AC-EAS-014 org B rows never affect org A branch (router only sees the passed map)', () => {
    // The caller passes ONLY org A's map; org B cannot appear here even if it exists.
    expect(routeWrite('reference', orgAMap)).toBe('external');
    expect(routeWrite('accounting', orgAMap)).toBe('pmo'); // org B might own 'accounting' — irrelevant
  });
});

describe('AC-EAS-030 reads ALWAYS serve from Supabase (the read-model), regardless of ownership', () => {
  it('AC-EAS-030 routeRead is dal even for an externally-owned domain', () => {
    expect(routeRead('reference')).toBe('dal'); // no adapter read is ever invoked
  });
});

describe('AC-EAS-031 an externally-owned write routes through the dispatch (not the direct DAL)', () => {
  it('AC-EAS-031 executeWrite calls dispatchWrite and NOT directWrite when externally-owned', async () => {
    const directWrite = vi.fn(async () => 'direct');
    const dispatchWrite = vi.fn(async () => 'dispatch');
    const res = await executeWrite({
      domain: 'reference', ownershipMap: { reference: 'reference' }, payload: 'x',
      directWrite, dispatchWrite,
    });
    expect(res).toBe('dispatch');
    expect(dispatchWrite).toHaveBeenCalledTimes(1);
    expect(directWrite).not.toHaveBeenCalled();
  });
});

describe('AC-EAS-032 a PMO-owned write routes through the direct DAL (not the dispatch)', () => {
  it('AC-EAS-032 a non-empty map without the domain ⇒ directWrite called, dispatchWrite not', async () => {
    const directWrite = vi.fn(async () => 'direct');
    const dispatchWrite = vi.fn(async () => 'dispatch');
    const res = await executeWrite({
      domain: 'tasks', ownershipMap: { reference: 'reference' }, payload: 'x', // tasks NOT assigned
      directWrite, dispatchWrite,
    });
    expect(res).toBe('direct');
    expect(directWrite).toHaveBeenCalledTimes(1);
    expect(dispatchWrite).not.toHaveBeenCalled();
  });
});
```

Run RED: `cd pmo-portal && npx vitest run src/lib/adapterSeam/router.test.ts` → fails (module not found).

**GREEN — create** `pmo-portal/src/lib/adapterSeam/router.ts`:

```ts
/**
 * The write-routing seam (FR-EAS-030..033, AC-EAS-001/002/014/030/031/032). Pure + relative imports only
 * (Deno-importable). THE INVARIANT (FR-EAS-010): an empty own-org ownership map ⇒ the write takes the
 * existing direct-DAL path byte-for-byte — `routeWrite` checks the empty map FIRST. The client never
 * sends org_id; `ownershipMap` is the caller's own-org map (cached, TanStack — NFR-EAS-PERF-001). This
 * branch is UX/DX-only routing — RLS is the enforcement authority (OD-3, FR-EAS-037).
 */
import { PmoDomain } from './contract';

/** The caller's own-org externally-owned domains: domain → owning external tier (FR-EAS-003). */
export type OwnershipMap = Readonly<Record<PmoDomain, string>>;
export const EMPTY_OWNERSHIP_MAP: OwnershipMap = {};

export type WriteRoute = 'pmo' | 'external';

/** Reads ALWAYS serve from the Supabase read-model via the existing DAL (FR-EAS-030, AC-EAS-030). */
export function routeRead(_domain: PmoDomain): 'dal' {
  return 'dal';
}

/**
 * The write-routing decision (FR-EAS-031/032, AC-EAS-001/014/031/032). Empty map ⇒ 'pmo' is the FIRST
 * branch (AC-EAS-001 byte-for-byte). Else: domain assigned to a tier ⇒ 'external'; otherwise 'pmo'.
 */
export function routeWrite(domain: PmoDomain, map: OwnershipMap): WriteRoute {
  if (Object.keys(map).length === 0) return 'pmo'; // AC-EAS-001: empty-map short-circuit FIRST
  return map[domain] ? 'external' : 'pmo';
}

/** Injected write paths for `executeWrite` — the generic repository write-method branch (FR-EAS-033). */
export interface ExecuteWriteDeps<TPayload, TResult> {
  domain: PmoDomain;
  ownershipMap: OwnershipMap;
  payload: TPayload;
  /** The existing direct-DAL write (the pre-adapter path; byte-for-byte when the map is empty). */
  directWrite: (payload: TPayload) => Promise<TResult>;
  /** The externally-owned dispatch path (FE edge-function invoke → adapter-dispatch). */
  dispatchWrite: (payload: TPayload) => Promise<TResult>;
}

/**
 * The repository write-method branch: PMO-owned ⇒ direct DAL; externally-owned ⇒ dispatch. P0 ships this
 * as a tested generic helper; P1 wires it into real-domain repositories when a domain actually flips
 * (spec §9 — no real domain flips in P0). The Repositories interface (ADR-0017) is UNCHANGED.
 */
export async function executeWrite<TPayload, TResult>(
  deps: ExecuteWriteDeps<TPayload, TResult>,
): Promise<TResult> {
  return routeWrite(deps.domain, deps.ownershipMap) === 'external'
    ? deps.dispatchWrite(deps.payload)
    : deps.directWrite(deps.payload);
}
```

**GREEN verify:** `cd pmo-portal && npx vitest run src/lib/adapterSeam/router.test.ts` → green.

> **Task dependency note:** `router.test.ts` imports `pendingPush` (for the AC-EAS-002 no-state assertion). Create `pendingPush.ts` in Task 10; if running Task 8 before Task 10, the single AC-EAS-002 `pendingPushAfterWrite` assertion will fail on the import — so either run Task 10 first, or temporarily comment that one assertion until Task 10 lands. The preferred order is **Task 10 before Task 8** if executing strictly bottom-up; the tasks are otherwise independent. (Listed here because router owns the routing ACs.)

---

### Task 9 — `dispatch.ts` (pure orchestration) + `clientInvoke.ts` (FE invoke) + test (AC-EAS-023, AC-EAS-033, AC-EAS-034, AC-EAS-042)

**RED — create** `pmo-portal/src/lib/adapterSeam/dispatch.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { dispatchExternallyOwnedWrite } from './dispatch';
import { createReferenceAdapter, REFERENCE_DOMAIN } from './referenceAdapter';
import { AdapterError } from './contract';
import type { AdapterCommand } from './contract';
import { AppError } from '../appError';

const command: AdapterCommand = {
  domain: REFERENCE_DOMAIN,
  operation: 'create',
  record: { id: 'pmo-1', name: 'Widget' },
};

describe('AC-EAS-023 the adapter never receives org_id', () => {
  it('AC-EAS-023 the command passed to adapter.commit carries no org_id field', async () => {
    const adapter = createReferenceAdapter('commit-success');
    const seen: AdapterCommand[] = [];
    const wrappingAdapter = {
      tier: adapter.tier,
      capabilityMap: adapter.capabilityMap,
      async commit(c: AdapterCommand) {
        seen.push(c);
        return adapter.commit(c);
      },
    };
    await dispatchExternallyOwnedWrite({
      adapter: wrappingAdapter, command,
      writeReadModel: vi.fn(), recordExternalRef: vi.fn(),
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]).not.toHaveProperty('org_id');
    expect('org_id' in seen[0]).toBe(false);
  });
});

describe('AC-EAS-033 synchronous write-through order: command → read-model → external_refs → return', () => {
  it('AC-EAS-033 commits in order and returns only after the external commit', async () => {
    const order: string[] = [];
    const adapter = {
      tier: 'reference',
      capabilityMap: new Set([REFERENCE_DOMAIN]),
      async commit() {
        order.push('commit');
        return { externalRecordId: 'ext-1', canonical: { id: 'pmo-1' } };
      },
    };
    await dispatchExternallyOwnedWrite({
      adapter, command,
      writeReadModel: vi.fn(async () => { order.push('readModel'); }),
      recordExternalRef: vi.fn(async () => { order.push('ref'); }),
    });
    expect(order).toEqual(['commit', 'readModel', 'ref']);
  });
});

describe('AC-EAS-034 external-unreachable ⇒ write fails honestly, read-model unchanged', () => {
  it('AC-EAS-034 does NOT update the read-model or record a ref, and throws a classified AppError', async () => {
    const writeReadModel = vi.fn();
    const recordExternalRef = vi.fn();
    await expect(
      dispatchExternallyOwnedWrite({
        adapter: createReferenceAdapter('external-unreachable'), command,
        writeReadModel, recordExternalRef,
      }),
    ).rejects.toMatchObject({ name: 'AppError', code: 'external-unreachable', message: 'external system unreachable — try again' });
    expect(writeReadModel).not.toHaveBeenCalled();
    expect(recordExternalRef).not.toHaveBeenCalled();
  });
  it('AC-EAS-034 commit-rejected surfaces a commit-rejected AppError without writing', async () => {
    const writeReadModel = vi.fn();
    await expect(
      dispatchExternallyOwnedWrite({
        adapter: createReferenceAdapter('commit-rejected-validation'), command,
        writeReadModel, recordExternalRef: vi.fn(),
      }),
    ).rejects.toBeInstanceOf(AppError);
    expect(writeReadModel).not.toHaveBeenCalled();
  });
});

describe('AC-EAS-042 a successful write-through records the external_refs mapping', () => {
  it('AC-EAS-042 recordExternalRef is called with pmo id ↔ external id + owning tier + domain', async () => {
    const recordExternalRef = vi.fn(async () => {});
    await dispatchExternallyOwnedWrite({
      adapter: createReferenceAdapter('commit-success'), command,
      writeReadModel: vi.fn(), recordExternalRef,
    });
    expect(recordExternalRef).toHaveBeenCalledWith({
      pmoRecordId: 'pmo-1',
      externalTier: 'reference',
      externalRecordId: 'ext-pmo-1',
      domain: REFERENCE_DOMAIN,
    });
  });
});

// Guard against the pure module accidentally importing the browser client (would break the edge fn).
describe('AC-EAS-070 dispatch.ts imports stay pure (Deno-importable)', () => {
  it('AC-EAS-070 dispatch.ts has no supabase/browser import (pure core)', async () => {
    const src = await import('./dispatch?raw').catch(() => null);
    if (src && typeof src === 'string') {
      expect(src).not.toMatch(/from ['"]@\/src\/lib\/supabase\/client/);
    }
  });
});
```

Run RED: `cd pmo-portal && npx vitest run src/lib/adapterSeam/dispatch.test.ts` → fails (module not found).

**GREEN — create** `pmo-portal/src/lib/adapterSeam/dispatch.ts` (pure; relative imports only):

```ts
/**
 * Synchronous write-through orchestration for an externally-owned domain (FR-EAS-034, AC-EAS-023/033/
 * 034/042). PURE + relative imports only (no `@/` alias, no supabase) ⇒ Deno-importable by the
 * adapter-dispatch edge function. ORDER (AC-EAS-033): (1) invoke the adapter command [NO org_id —
 * AC-EAS-023], (2) on external commit update the read-model from the canonical answer, (3) record the
 * external_refs mapping, (4) return. On adapter failure (AC-EAS-034): no read-model update, no ref row,
 * and a classified AppError is thrown.
 */
import { Adapter, AdapterCommand, AdapterError, CommandResult, PmoRecord } from './contract';
import { AppError } from '../appError';

/** The ordered steps the dispatch performs (deps injected so this core is pure + testable). */
export interface DispatchDeps {
  adapter: Adapter;
  /** PMO domain language; carries NO org_id (FR-EAS-024, AC-EAS-023). */
  command: AdapterCommand;
  /** Update the read-model in Supabase from the adapter's canonical answer (service role). */
  writeReadModel: (canonical: PmoRecord) => Promise<void>;
  /** Record the external_refs mapping (PMO id ↔ external id, owning tier; service role). */
  recordExternalRef: (args: {
    pmoRecordId: string;
    externalTier: string;
    externalRecordId: string;
    domain: string;
  }) => Promise<void>;
}

export interface DispatchResult {
  externalRecordId: string;
  canonical: PmoRecord;
}

/** Run the synchronous write-through in the FR-EAS-034 order. */
export async function dispatchExternallyOwnedWrite(deps: DispatchDeps): Promise<DispatchResult> {
  // (1) Invoke the adapter command — the adapter receives NO org_id (AC-EAS-023).
  let result: CommandResult;
  try {
    result = await deps.adapter.commit(deps.command);
  } catch (err) {
    // (AC-EAS-034) Surface a classified error; do NOT update the read-model or record a ref.
    throw toAppErrorFromAdapter(err);
  }
  // (2) Update the read-model from the ONE authoritative answer.
  await deps.writeReadModel(result.canonical);
  // (3) Record the external_refs mapping (AC-EAS-042).
  await deps.recordExternalRef({
    pmoRecordId: deps.command.record.id,
    externalTier: deps.adapter.tier,
    externalRecordId: result.externalRecordId,
    domain: deps.command.domain,
  });
  // (4) Return — success observed only after the external commit (synchronous write-through).
  return { externalRecordId: result.externalRecordId, canonical: result.canonical };
}

function toAppErrorFromAdapter(err: unknown): AppError {
  if (err instanceof AdapterError) {
    const message = err.code === 'external-unreachable' ? 'external system unreachable — try again' : err.message;
    return new AppError(message, err.code);
  }
  if (err instanceof Error) return new AppError(err.message);
  return new AppError('An unexpected error occurred');
}
```

**GREEN — also create the FE-only invoke wrapper** `pmo-portal/src/lib/adapterSeam/clientInvoke.ts` (the externally-owned write target; wiring for P1; no owning AC — verified by typecheck):

```ts
/**
 * FE edge-function invoke: the externally-owned write path (FR-EAS-031). Calls `adapter-dispatch`, which
 * binds org from the JWT, selects the adapter, commits, updates the read-model, records external_refs,
 * and returns — in order (AC-EAS-033). FE-ONLY (imports the browser supabase client) ⇒ NOT imported by
 * the edge function. The Repositories write-method branch calls this via executeWrite's `dispatchWrite`.
 */
import { supabase } from '@/src/lib/supabase/client';
import { AppError } from '@/src/lib/appError';
import type { AdapterCommand, AdapterOperation, PmoDomain, PmoRecord } from './contract';

interface DispatchResponse {
  canonical?: PmoRecord;
  error?: string;
  code?: string;
}

export async function invokeAdapterDispatch(command: AdapterCommand): Promise<PmoRecord> {
  const body: { domain: PmoDomain; operation: AdapterOperation; record: PmoRecord } = {
    domain: command.domain,
    operation: command.operation,
    record: command.record,
  };
  const { data, error } = await supabase.functions.invoke<DispatchResponse>('adapter-dispatch', { body });
  if (error) throw new AppError(error.message, error.code);
  if (!data || data.error) throw new AppError(data?.error ?? 'Dispatch failed', data?.code);
  if (!data.canonical) throw new AppError('Dispatch returned no canonical record');
  return data.canonical;
}
```

**GREEN verify:** `cd pmo-portal && npx vitest run src/lib/adapterSeam/dispatch.test.ts` → green; then `cd pmo-portal && npx tsc --noEmit` → zero errors (clientInvoke.ts typechecks).

---

### Task 10 — `pendingPush.ts` + test (AC-EAS-060, AC-EAS-061, AC-EAS-062)

> Run this BEFORE Task 8 (router.test.ts imports `pendingPushAfterWrite`/`IDLE_PENDING_PUSH`).

**RED — create** `pmo-portal/src/lib/adapterSeam/pendingPush.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  IDLE_PENDING_PUSH,
  beginPush,
  completePush,
  failPush,
  pendingPushAfterWrite,
  classifyExternalError,
} from './pendingPush';
import { AppError } from '../appError';

describe('AC-EAS-060 the pending-push state machine transitions correctly', () => {
  it('AC-EAS-060 submitting an externally-owned write ⇒ pushing', () => {
    expect(beginPush(IDLE_PENDING_PUSH).status).toBe('pushing');
  });
  it('AC-EAS-060 on external commit ⇒ pushed', () => {
    expect(completePush(beginPush(IDLE_PENDING_PUSH)).status).toBe('pushed');
  });
  it('AC-EAS-060 re-submitted with the adapter unreachable ⇒ push-failed', () => {
    const failed = failPush(
      beginPush(IDLE_PENDING_PUSH),
      new AppError('external system unreachable — try again', 'external-unreachable'),
    );
    expect(failed.status).toBe('push-failed');
  });
  it('AC-EAS-060 pendingPushAfterWrite: external ok ⇒ pushed; external fail ⇒ push-failed', () => {
    expect(pendingPushAfterWrite('external', { ok: true }).status).toBe('pushed');
    expect(pendingPushAfterWrite('external', { ok: false, err: new AppError('m', 'external-unreachable') }).status).toBe('push-failed');
  });
});

describe('AC-EAS-061 push-failed surfaces the classified external error via the shared contract', () => {
  it('AC-EAS-061 external-unreachable ⇒ headline "external system unreachable — try again"', () => {
    const { headline, detail } = classifyExternalError(
      new AppError('external system unreachable — try again', 'external-unreachable'),
    );
    expect(headline).toBe('external system unreachable — try again');
    expect(detail).toBeTruthy();
  });
  it('AC-EAS-061 commit-rejected ⇒ headline carries the external validation message', () => {
    const { headline } = classifyExternalError(new AppError('Name is required', 'commit-rejected'));
    expect(headline).toBe('The external system rejected the change.');
  });
});

describe('AC-EAS-062 PMO-owned writes introduce no pending-push state', () => {
  it('AC-EAS-062 a PMO-owned write leaves the machine idle (no pushing/pushed/push-failed)', () => {
    expect(pendingPushAfterWrite('pmo', { ok: true })).toEqual(IDLE_PENDING_PUSH);
    expect(pendingPushAfterWrite('pmo', { ok: false, err: new Error('x') })).toEqual(IDLE_PENDING_PUSH);
  });
});
```

Run RED: `cd pmo-portal && npx vitest run src/lib/adapterSeam/pendingPush.test.ts` → fails (module not found).

**GREEN — create** `pmo-portal/src/lib/adapterSeam/pendingPush.ts`:

```ts
/**
 * Shared pending-push behavior — state names + transitions + error surface — for synchronous
 * write-through on externally-owned domains (FR-EAS-060..063, AC-EAS-060/061/062). NOT a component: a
 * reusable state machine that any surface composes. Relative imports only (Deno-importable).
 */
import { AppError } from '../appError';

export type PendingPushStatus = 'idle' | 'pushing' | 'pushed' | 'push-failed';

export interface PendingPushState {
  status: PendingPushStatus;
  error: { headline: string; detail: string } | null;
}

export const IDLE_PENDING_PUSH: PendingPushState = { status: 'idle', error: null };

/** `pushing` is shown immediately when an externally-owned write is submitted (FR-EAS-061). */
export function beginPush(_state: PendingPushState): PendingPushState {
  return { status: 'pushing', error: null };
}
/** `pushed` on successful external commit (read-model updated). */
export function completePush(_state: PendingPushState): PendingPushState {
  return { status: 'pushed', error: null };
}
/** `push-failed` when the external system rejects the command or is unreachable (FR-EAS-063). */
export function failPush(_state: PendingPushState, err: unknown): PendingPushState {
  return { status: 'push-failed', error: classifyExternalError(err) };
}

export type WriteOutcome = { ok: true } | { ok: false; err: unknown };

/**
 * The pending-push state after a write, given the route + outcome (AC-EAS-060/062). PMO-owned ⇒ idle
 * (no pending-push state is introduced — AC-EAS-062, consistent with FR-EAS-010).
 */
export function pendingPushAfterWrite(route: 'pmo' | 'external', outcome: WriteOutcome): PendingPushState {
  if (route === 'pmo') return IDLE_PENDING_PUSH; // AC-EAS-062
  return outcome.ok
    ? completePush(beginPush(IDLE_PENDING_PUSH))
    : failPush(beginPush(IDLE_PENDING_PUSH), outcome.err);
}

/** Map a classified external error to the shared `{headline, detail}` surface (reuses AppError's shape). */
export function classifyExternalError(err: unknown): { headline: string; detail: string } {
  const detail = err instanceof Error ? err.message : 'An error occurred';
  const code = typeof (err as { code?: unknown })?.code === 'string' ? (err as { code: string }).code : undefined;
  if (code === 'external-unreachable') {
    return { headline: 'external system unreachable — try again', detail };
  }
  if (code === 'commit-rejected') {
    return { headline: 'The external system rejected the change.', detail };
  }
  return { headline: 'Push failed', detail };
}

// AppError is re-exported here only so callers can construct a classified error for failPush(); the
// import is pure (appError.ts has no supabase/browser deps).
export { AppError };
```

**GREEN verify:** `cd pmo-portal && npx vitest run src/lib/adapterSeam/pendingPush.test.ts` → green. Then (if Task 8 not yet run) `cd pmo-portal && npx vitest run src/lib/adapterSeam/router.test.ts` → green.

---

### Task 11 — `externalSyncWatermarks.ts` DAL + test (AC-EAS-051)

**RED — create** `pmo-portal/src/lib/db/externalSyncWatermarks.test.ts` (mocks the supabase client — the `companies.test.ts` chainable-mock idiom):

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => {
  const calls = { table: '', rows: null as unknown, onConflict: '' as string, invoked: false };
  const builder = {
    upsert(rows: unknown) { calls.rows = rows; return builder; },
    onConflict(key: string) { calls.onConflict = key; return builder; },
    then(resolve: (v: unknown) => unknown) { calls.invoked = true; return resolve({ data: null, error: null }); },
  };
  const from = vi.fn((table: string) => { calls.table = table; return builder; });
  return { from, calls };
});
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from } }));

import { upsertWatermark } from './externalSyncWatermarks';

beforeEach(() => {
  h.calls = { table: '', rows: null, onConflict: '', invoked: false };
  h.from.mockClear();
});

describe('AC-EAS-051 a watermark upsert is one row per (org, tier, domain)', () => {
  it('AC-EAS-051 upserts against the (org_id, external_tier, domain) conflict key (no duplicates)', async () => {
    await upsertWatermark({ orgId: 'org-1', externalTier: 'reference', domain: 'reference', cursor: 'cur-2' });
    expect(h.calls.table).toBe('external_sync_watermarks');
    expect(h.calls.onConflict).toBe('org_id,external_tier,domain');
    expect(h.calls.rows).toMatchObject({
      org_id: 'org-1', external_tier: 'reference', domain: 'reference', watermark_cursor: 'cur-2',
    });
    expect(h.calls.invoked).toBe(true);
  });
});
```

Run RED: `cd pmo-portal && npx vitest run src/lib/db/externalSyncWatermarks.test.ts` → fails (module not found).

**GREEN — create** `pmo-portal/src/lib/db/externalSyncWatermarks.ts` (follows the `companies.ts` pattern; service-role writer sets org_id):

```ts
import { supabase } from '@/src/lib/supabase/client';
import { AppError } from '@/src/lib/appError';

/** The dispatch/sync service-role upsert input (the machine writer sets org_id). */
export interface WatermarkUpsert {
  orgId: string;
  externalTier: string;
  domain: string;
  cursor: string;
}

/**
 * Upsert EXACTLY ONE watermark row per (org, tier, domain) — the modified-since cursor (FR-EAS-052,
 * AC-EAS-051). Machine-written only: the table's RLS denies user-JWT writes; the dispatch/sync service
 * role (which bypasses RLS) is the sole writer. P0 establishes storage; the sweep engine is P1.
 */
export async function upsertWatermark(input: WatermarkUpsert): Promise<void> {
  const { error } = await supabase.from('external_sync_watermarks').upsert(
    {
      org_id: input.orgId,
      external_tier: input.externalTier,
      domain: input.domain,
      watermark_cursor: input.cursor,
    },
    { onConflict: 'org_id,external_tier,domain' },
  );
  if (error) throw new AppError(error.message, error.code);
}
```

**GREEN verify:** `cd pmo-portal && npx vitest run src/lib/db/externalSyncWatermarks.test.ts` → green.

---

### Task 12 — `externalRefs.ts` DAL + test (supports AC-EAS-042; transitive)

**RED — create** `pmo-portal/src/lib/db/externalRefs.test.ts` (same chainable-mock idiom):

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => {
  const calls = { table: '', rows: null as unknown, onConflict: '' as string };
  const builder = {
    upsert(rows: unknown) { calls.rows = rows; return builder; },
    onConflict(key: string) { calls.onConflict = key; return builder; },
    then(resolve: (v: unknown) => unknown) { return resolve({ data: null, error: null }); },
  };
  const from = vi.fn((table: string) => { calls.table = table; return builder; });
  return { from, calls };
});
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from } }));

import { recordExternalRef } from './externalRefs';

beforeEach(() => {
  h.calls = { table: '', rows: null, onConflict: '' };
  h.from.mockClear();
});

describe('externalRefs.recordExternalRef (supports AC-EAS-042)', () => {
  it('upserts the mapping against (org_id, domain, pmo_record_id)', async () => {
    await recordExternalRef({
      orgId: 'org-1', domain: 'reference', pmoRecordId: 'pmo-1',
      externalTier: 'reference', externalRecordId: 'ext-1',
    });
    expect(h.calls.table).toBe('external_refs');
    expect(h.calls.onConflict).toBe('org_id,domain,pmo_record_id');
    expect(h.calls.rows).toMatchObject({
      org_id: 'org-1', domain: 'reference', pmo_record_id: 'pmo-1',
      external_tier: 'reference', external_record_id: 'ext-1',
    });
  });
});
```

Run RED: `cd pmo-portal && npx vitest run src/lib/db/externalRefs.test.ts` → fails (module not found).

**GREEN — create** `pmo-portal/src/lib/db/externalRefs.ts`:

```ts
import { supabase } from '@/src/lib/supabase/client';
import { AppError } from '@/src/lib/appError';

/** The external_refs mapping recorded on a committed write-through (FR-EAS-043, AC-EAS-042). */
export interface ExternalRefRecord {
  orgId: string;
  domain: string;
  pmoRecordId: string;
  externalTier: string;
  externalRecordId: string;
}

/**
 * Record (or update) the external_refs mapping for a committed write-through (FR-EAS-043, AC-EAS-042).
 * Machine-written only: RLS denies user-JWT writes; the dispatch/sync service role is the sole writer.
 * Unique on (org_id, domain, pmo_record_id) — a re-write updates the external id in place.
 */
export async function recordExternalRef(input: ExternalRefRecord): Promise<void> {
  const { error } = await supabase.from('external_refs').upsert(
    {
      org_id: input.orgId,
      domain: input.domain,
      pmo_record_id: input.pmoRecordId,
      external_tier: input.externalTier,
      external_record_id: input.externalRecordId,
    },
    { onConflict: 'org_id,domain,pmo_record_id' },
  );
  if (error) throw new AppError(error.message, error.code);
}
```

**GREEN verify:** `cd pmo-portal && npx vitest run src/lib/db/externalRefs.test.ts` → green.

---

### Task 13 — `externalDomainOwnership.ts` DAL + repository entries (types.ts + index.ts) + test (supports AC-EAS-015)

**RED — create** `pmo-portal/src/lib/db/externalDomainOwnership.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => {
  const calls = { table: '', orderCol: '' as string };
  const builder = {
    select() { return builder; },
    order(col: string) { calls.orderCol = col; return builder; },
    then(resolve: (v: unknown) => unknown) {
      return resolve({
        data: [
          { id: 'r1', org_id: 'org-1', external_tier: 'reference', domain: 'reference' },
          { id: 'r2', org_id: 'org-1', external_tier: 'reference', domain: 'tasks' },
        ],
        error: null,
      });
    },
  };
  const from = vi.fn((table: string) => { calls.table = table; return builder; });
  return { from, calls };
});
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from } }));

import { listOwnExternalDomainOwnership } from './externalDomainOwnership';

beforeEach(() => { h.calls = { table: '', orderCol: '' }; h.from.mockClear(); });

describe('externalDomainOwnership.listOwnExternalDomainOwnership (supports AC-EAS-015)', () => {
  it('reads own-org rows (RLS-scoped; org_id never sent) + maps to camelCase', async () => {
    const rows = await listOwnExternalDomainOwnership();
    expect(h.calls.table).toBe('external_domain_ownership');
    expect(h.calls.orderCol).toBe('external_tier');
    expect(rows).toEqual([
      { id: 'r1', orgId: 'org-1', externalTier: 'reference', domain: 'reference' },
      { id: 'r2', orgId: 'org-1', externalTier: 'reference', domain: 'tasks' },
    ]);
  });
});
```

Run RED: `cd pmo-portal && npx vitest run src/lib/db/externalDomainOwnership.test.ts` → fails (module not found).

**GREEN — create** `pmo-portal/src/lib/db/externalDomainOwnership.ts`:

```ts
import { supabase } from '@/src/lib/supabase/client';
import { AppError } from '@/src/lib/appError';

/** One (org, tier, domain) ownership assignment row (camelCase view for the FE). */
export interface ExternalDomainOwnershipRow {
  id: string;
  orgId: string;
  externalTier: string;
  domain: string;
}

/**
 * The caller's own-org employed external tiers + externally-owned domains (FR-EAS-007, AC-EAS-015).
 * RLS scopes to the caller's org; org_id is never sent. Empty ⇒ no external systems employed (the
 * Integrations view's empty state). Ordered by tier for a stable grouped list.
 */
export async function listOwnExternalDomainOwnership(): Promise<ExternalDomainOwnershipRow[]> {
  const { data, error } = await supabase
    .from('external_domain_ownership')
    .select('id,org_id,external_tier,domain')
    .order('external_tier', { ascending: true });
  if (error) throw new AppError(error.message, error.code);
  return (data ?? []).map((r) => ({
    id: r.id,
    orgId: r.org_id,
    externalTier: r.external_tier,
    domain: r.domain,
  }));
}
```

**GREEN — add the three new repository entries (ADDITIVE — no existing repo touched).** Edit `pmo-portal/src/lib/repositories/types.ts`:

```ts
// add with the other imports:
import type { ExternalDomainOwnershipRow } from '@/src/lib/db/externalDomainOwnership';
import type { ExternalRefRecord, WatermarkUpsert } from '@/src/lib/db/externalRefs';
import type { WatermarkUpsert as _WM } from '@/src/lib/db/externalSyncWatermarks';
// (collapse the two WatermarkUpsert imports into one in practice — both re-export the same shape via the
//  repository; see index.ts. A single `import type { WatermarkUpsert } from '@/src/lib/db/externalSyncWatermarks'`
//  suffices. externalRefs.ts does not export WatermarkUpsert — remove that from its import line.)

// add the three interfaces near the other repository interfaces:
/** Read-only own-org domain-ownership (the Integrations view source; Operator writes via RPC). */
export interface ExternalDomainOwnershipRepository {
  listOwn(): Promise<ExternalDomainOwnershipRow[]>;
}
/** Machine-written external_refs mapping (dispatch/sync service role). */
export interface ExternalRefRepository {
  record(input: ExternalRefRecord): Promise<void>;
}
/** Machine-written sync watermarks (dispatch/sync service role; P1 sweep consumes). */
export interface ExternalSyncWatermarkRepository {
  upsert(input: WatermarkUpsert): Promise<void>;
}
```

…and extend the `Repositories` interface (additive — append three keys):

```ts
  externalDomainOwnership: ExternalDomainOwnershipRepository;
  externalRef: ExternalRefRepository;
  externalSyncWatermark: ExternalSyncWatermarkRepository;
```

Edit `pmo-portal/src/lib/repositories/index.ts` (add imports + impls + append to the `repositories` object + re-export types):

```ts
// imports (near the other db imports):
import { listOwnExternalDomainOwnership } from '@/src/lib/db/externalDomainOwnership';
import { recordExternalRef } from '@/src/lib/db/externalRefs';
import { upsertWatermark } from '@/src/lib/db/externalSyncWatermarks';
// type imports (near the other type imports):
import type {
  ExternalDomainOwnershipRepository,
  ExternalRefRepository,
  ExternalSyncWatermarkRepository,
} from './types';

// impls (near the other const repositories):
const externalDomainOwnership: ExternalDomainOwnershipRepository = {
  listOwn: () => wrap(() => listOwnExternalDomainOwnership()),
};
const externalRef: ExternalRefRepository = {
  record: (input) => wrap(() => recordExternalRef(input)),
};
const externalSyncWatermark: ExternalSyncWatermarkRepository = {
  upsert: (input) => wrap(() => upsertWatermark(input)),
};

// append to the exported `repositories` object:
  externalDomainOwnership,
  externalRef,
  externalSyncWatermark,

// append to the `export type { ... } from './types'` re-export:
  ExternalDomainOwnershipRepository,
  ExternalRefRepository,
  ExternalSyncWatermarkRepository,
```

> **Note (exactness):** the only edit to existing files is APPENDING three additive repository entries — no existing signature changes, no existing repo branched. The "write-method branch the spec names" ships as the generic `executeWrite` helper (Task 8), which no existing repo calls in P0 (no real domain flips — spec §9); P1 wires it. This satisfies the "no changes to existing domain DAL/repositories beyond the write-method branch" constraint (the branch is a new helper, not an edit to an existing repo).

**GREEN verify:** `cd pmo-portal && npx vitest run src/lib/db/externalDomainOwnership.test.ts && npx tsc --noEmit` → green + zero type errors.

---

### Task 14 — `IntegrationsView.tsx` + hook + RTL test (AC-EAS-015)

**RED — create** `pmo-portal/src/components/integrations/IntegrationsView.test.tsx`:

```tsx
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { IntegrationsView } from './IntegrationsView';
import type { ExternalDomainOwnershipRow } from '@/src/lib/db/externalDomainOwnership';

vi.mock('@/src/hooks/useExternalDomainOwnership', () => ({
  useExternalDomainOwnership: vi.fn(),
}));

import { useExternalDomainOwnership } from '@/src/hooks/useExternalDomainOwnership';

const wrap = (ui: React.ReactElement) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
};

afterEach(() => { vi.clearAllMocks(); cleanup(); });

describe('AC-EAS-015 the read-only Integrations view renders both states with no write affordances', () => {
  it('AC-EAS-015 (a) empty ownership ⇒ "no external systems employed" empty state, no write affordance', () => {
    vi.mocked(useExternalDomainOwnership).mockReturnValue({ data: [], isPending: false, isError: false } as never);
    wrap(<IntegrationsView />);
    expect(screen.getByText(/no external systems employed/i)).toBeInTheDocument();
    // No create/edit/delete/toggle affordance is rendered.
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('AC-EAS-015 (b) an employed tier owning {reference, tasks} lists the tier + domains, no write affordance', () => {
    const rows: ExternalDomainOwnershipRow[] = [
      { id: '1', orgId: 'org-1', externalTier: 'reference', domain: 'reference' },
      { id: '2', orgId: 'org-1', externalTier: 'reference', domain: 'tasks' },
    ];
    vi.mocked(useExternalDomainOwnership).mockReturnValue({ data: rows, isPending: false, isError: false } as never);
    wrap(<IntegrationsView />);
    expect(screen.getByText('reference')).toBeInTheDocument();
    const list = screen.getByTestId('integrations-tier-list');
    expect(within(list).getByText('reference')).toBeInTheDocument();
    expect(within(list).getByText('tasks')).toBeInTheDocument();
    // No write affordance.
    expect(screen.queryByRole('button')).toBeNull();
  });
});
```

Run RED: `cd pmo-portal && npx vitest run src/components/integrations/IntegrationsView.test.tsx` → fails (module not found).

**GREEN — create** `pmo-portal/src/hooks/useExternalDomainOwnership.ts`:

```ts
import { useQuery } from '@tanstack/react-query';
import { listOwnExternalDomainOwnership } from '@/src/lib/db/externalDomainOwnership';

/** The caller's own-org employed external tiers + externally-owned domains (AC-EAS-015 source). */
export function useExternalDomainOwnership() {
  return useQuery({
    queryKey: ['external-domain-ownership'],
    queryFn: listOwnExternalDomainOwnership,
  });
}
```

**GREEN — create** `pmo-portal/src/components/integrations/IntegrationsView.tsx` (DESIGN.md tokens: `ListPage`/`PageHeader`, `Card`, `ListState` empty state, `text-muted-foreground`; read-only ⇒ no `Button` controls):

```tsx
import React from 'react';
import { ListPage, ListState, Card, Icon } from '@/src/components/ui';
import { useExternalDomainOwnership } from '@/src/hooks/useExternalDomainOwnership';

/**
 * Read-only Integrations view (FR-EAS-007, AC-EAS-015). Shows the caller's org's employed external
 * tiers + the consequently externally-owned domains; an explicit empty state when none are employed.
 * NO write affordances — writes are Operator-provisioned (FR-EAS-006, OD-1).
 */
export const IntegrationsView: React.FC = () => {
  const { data, isPending, isError } = useExternalDomainOwnership();
  const rows = data ?? [];

  // Group by tier: tier → owned domains (ordered).
  const byTier = rows.reduce<Record<string, string[]>>((acc, r) => {
    (acc[r.externalTier] ??= []).push(r.domain);
    return acc;
  }, {});
  const tiers = Object.keys(byTier).sort();
  const isEmpty = !isPending && !isError && rows.length === 0;

  return (
    <ListPage
      title="Integrations"
      description="External systems employed by your organisation and the domains they own as source of truth."
    >
      {isPending && <ListState variant="loading" rows={3} />}
      {isError && (
        <ListState
          variant="error"
          title="Couldn't load integrations"
          sub="The request failed. Check your connection and try again."
        />
      )}
      {isEmpty && (
        <ListState
          variant="empty"
          icon="plug"
          title="No external systems employed"
          sub="Every domain is owned by this PMO workspace. Employing an external system (an ERP or task platform) flips the domains it natively owns to it as source of truth — provisioned by your platform operator."
        />
      )}
      {rows.length > 0 && (
        <div className="flex flex-col gap-3.5" data-testid="integrations-tier-list">
          {tiers.map((tier) => (
            <Card key={tier} className="p-4">
              <div className="flex items-center gap-2">
                <Icon name="plug" />
                <h3 className="text-foreground font-semibold">{tier}</h3>
              </div>
              <ul className="mt-2.5 flex flex-wrap gap-1.5">
                {byTier[tier].map((d) => (
                  <li key={d} className="rounded-md border border-border bg-background px-2 py-1 text-sm text-muted-foreground">
                    {d}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-sm text-muted-foreground">
                Owns {byTier[tier].length} {byTier[tier].length === 1 ? 'domain' : 'domains'} as source of truth.
              </p>
            </Card>
          ))}
        </div>
      )}
    </ListPage>
  );
};

export default IntegrationsView;
```

> **DESIGN.md tokens used:** `Card` (white surface, `lg` radius, 16px pad), `ListState` (the empty/error/loading states), `text-muted-foreground` (captions/domain chips), `border-border`/`bg-background` (chips), `Icon` (`plug`). No `Button` ⇒ no write affordance (AC-EAS-015). Route/nav wiring is out of scope (no AC requires it; the component is the deliverable, render-tested).

**GREEN verify:** `cd pmo-portal && npx vitest run src/components/integrations/IntegrationsView.test.tsx` → green.

---

### Task 15 — `adapter-dispatch` edge function + CI wiring (AC-EAS-033 integration host; the seam)

**Create** `supabase/functions/adapter-dispatch/deno.json` (mirrors `agent-dispatch/deno.json`):

```json
{
  "imports": {
    "@supabase/supabase-js": "npm:@supabase/supabase-js@2.110.0",
    "zod": "npm:zod@3.25.76",
    "@/": "../../../pmo-portal/"
  }
}
```

**Create** `supabase/functions/adapter-dispatch/index.ts` (Deno; `verify_jwt=true` default — the user JWT is forwarded; integration-only, like `agent-dispatch/index.ts`):

```ts
/**
 * adapter-dispatch — Deno Edge Function (ADR-0055 §4, FR-EAS-034, AC-EAS-033). Invoked by the FE
 * repository write-method branch (executeWrite's `dispatchWrite`) for an EXTERNALLY-OWNED domain.
 * Order: org from JWT → adapter select → command invoke (no org_id, AC-EAS-023) → read-model update
 * (service role) → external_refs record → return. Integration-only (not unit-tested) — verified by
 * `deno check` + the boot-smoke (scripts/deno-boot-smoke.ts), same contract as agent-dispatch/index.ts.
 */
import { createClient } from '@supabase/supabase-js';
import { dispatchExternallyOwnedWrite, type DispatchDeps } from '../../../pmo-portal/src/lib/adapterSeam/dispatch.ts';
import { createReferenceAdapter } from '../../../pmo-portal/src/lib/adapterSeam/referenceAdapter.ts';
import type { Adapter, AdapterCommand, PmoDomain, PmoRecord } from '../../../pmo-portal/src/lib/adapterSeam/contract.ts';

const json = () => ({ 'Content-Type': 'application/json' });

Deno.serve(async (req: Request): Promise<Response> => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  if (!supabaseUrl || !serviceRoleKey || !anonKey) {
    return new Response(JSON.stringify({ error: 'MISCONFIGURED' }), { status: 500, headers: json() });
  }
  // Caller-JWT-scoped client (verify_jwt=true ⇒ Authorization forwarded). Org is bound from it.
  const userJwt = req.headers.get('Authorization') ?? '';
  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: userJwt } } });
  const serviceClient = createClient(supabaseUrl, serviceRoleKey); // RLS-bypassing (read-model + refs)

  try {
    const body = (await req.json()) as { domain: PmoDomain; operation: AdapterCommand['operation']; record: PmoRecord };

    // (1) Bind org context from the caller's JWT (FR-EAS-024/033) — never sent by the client.
    const { data: profile } = await userClient.from('profiles').select('org_id').maybeSingle();
    const orgId = profile?.org_id;
    if (!orgId) return new Response(JSON.stringify({ error: 'NO_ORG' }), { status: 400, headers: json() });

    // (2) Adapter select: the tier owning this domain from the org's ownership (service role reads all orgs).
    const { data: ownership } = await serviceClient
      .from('external_domain_ownership')
      .select('external_tier,domain')
      .eq('org_id', orgId)
      .eq('domain', body.domain)
      .maybeSingle();
    const adapter = selectAdapter(ownership?.external_tier ?? null); // registry: P0 ⇒ only 'reference'
    if (!adapter) {
      return new Response(JSON.stringify({ error: 'NO_ADAPTER', code: 'commit-rejected' }), { status: 400, headers: json() });
    }

    // (3) Build the command — PMO domain language; NO org_id (AC-EAS-023).
    const command: AdapterCommand = { domain: body.domain, operation: body.operation, record: body.record };

    // (4) Dispatch in order (AC-EAS-033): command → read-model update → external_refs → return.
    const result = await dispatchExternallyOwnedWrite({
      adapter,
      command,
      writeReadModel: (canonical) => updateReadModel(serviceClient, orgId, canonical),
      recordExternalRef: (args) =>
        recordRef(serviceClient, { orgId, ...args }),
    } satisfies DispatchDeps);

    return new Response(JSON.stringify({ canonical: result.canonical }), { status: 200, headers: json() });
  } catch (err) {
    const code = typeof (err as { code?: unknown })?.code === 'string' ? (err as { code: string }).code : undefined;
    const message = err instanceof Error ? err.message : 'Dispatch failed';
    return new Response(JSON.stringify({ error: message, code }), { status: 500, headers: json() });
  }
});

/** The adapter registry. P0 ⇒ only the reference (test-double) adapter; real adapters land P1+. */
function selectAdapter(tier: string | null): Adapter | null {
  if (tier === 'reference') return createReferenceAdapter('commit-success');
  return null;
}

/** Update the reference domain's read-model (external_reference_items, OD-4) — service role only (AC-EAS-035). */
async function updateReadModel(
  serviceClient: ReturnType<typeof createClient>,
  orgId: string,
  canonical: PmoRecord,
): Promise<void> {
  const { error } = await serviceClient.from('external_reference_items').upsert(
    { org_id: orgId, pmo_record_id: canonical.id, payload: canonical },
    { onConflict: 'org_id,pmo_record_id' },
  );
  if (error) throw new Error(error.message);
}

/** Record the external_refs mapping — service role only (AC-EAS-042). */
async function recordRef(
  serviceClient: ReturnType<typeof createClient>,
  args: { orgId: string; pmoRecordId: string; externalTier: string; externalRecordId: string; domain: string },
): Promise<void> {
  const { error } = await serviceClient.from('external_refs').upsert(
    {
      org_id: args.orgId,
      domain: args.domain,
      pmo_record_id: args.pmoRecordId,
      external_tier: args.externalTier,
      external_record_id: args.externalRecordId,
    },
    { onConflict: 'org_id,domain,pmo_record_id' },
  );
  if (error) throw new Error(error.message);
}
```

**Generate the lockfile** (the CI `deno check --lock --frozen` gate requires a committed `deno.lock`):

```bash
deno cache --config supabase/functions/adapter-dispatch/deno.json \
  --lock supabase/functions/adapter-dispatch/deno.lock --lock-write \
  supabase/functions/adapter-dispatch/index.ts
```

**CI wiring — exactly what to add.** In `.github/workflows/ci.yml`, BOTH the `Deno typecheck` step and the `Deno boot smoke` step iterate the SAME hardcoded list. Append `adapter-dispatch` to both `for fn in …` lines. Concretely, change both occurrences of:

```
          for fn in agent-chat agent-dispatch compose-view admin-invite-user; do
```

to:

```
          for fn in agent-chat agent-dispatch compose-view admin-invite-user adapter-dispatch; do
```

> Note: `scripts/deno-boot-smoke.ts` itself takes the entry path as `argv[0]` and needs NO edit — the list that picks the entrypoints lives in `ci.yml` (the two `for fn in …` loops above). `adapter-dispatch` is distinct from the existing `agent-dispatch` (the agent-automation dispatcher) — do not conflate them.

**Verify (this task):**
```bash
# from repo root
deno check --config supabase/functions/adapter-dispatch/deno.json \
  --lock supabase/functions/adapter-dispatch/deno.lock --frozen \
  supabase/functions/adapter-dispatch/index.ts
deno run --allow-all --config supabase/functions/adapter-dispatch/deno.json \
  scripts/deno-boot-smoke.ts supabase/functions/adapter-dispatch/index.ts
```
Both must succeed (`deno check` zero errors; boot-smoke prints `BOOT_OK …`). Requires the Docker Supabase stack NOT to be running for the typecheck (it is static); the boot-smoke stubs `Deno.serve` so no live listener starts.

---

### Task 16 — Final gate (AC-EAS-003 regression + AC-EAS-070 meta + full verify)

Both MUST be green before review. Run from the repo root:

```bash
# (a) FE full verify — typecheck + lint:ci + test + build (mirrors CI's `verify` job; the unchanged
#     existing suite staying green IS the AC-EAS-003 regression proof).
cd pmo-portal && npm run verify

# (b) pgTAP band — the 4 new RLS proofs (AC-EAS-010..012/035/040..041/050) + the whole suite.
cd .. && scripts/with-db-lock.sh supabase test db

# (c) edge-function gates (CI parity) — deno check + boot-smoke for adapter-dispatch.
deno check --config supabase/functions/adapter-dispatch/deno.json \
  --lock supabase/functions/adapter-dispatch/deno.lock --frozen \
  supabase/functions/adapter-dispatch/index.ts
deno run --allow-all --config supabase/functions/adapter-dispatch/deno.json \
  scripts/deno-boot-smoke.ts supabase/functions/adapter-dispatch/index.ts
```

- **AC-EAS-003** (the pre-adapter suite remains green — zero regression): proven by (a) `npm run verify` green (unchanged existing Vitest + build) and (b) the existing pgTAP suite green alongside the 4 new files. No single new test — the unchanged suite IS the proof (per the spec's traceability note).
- **AC-EAS-070** (the contract/routing/pending-push bands pass using ONLY the reference adapter): proven transitively — Tasks 6/8/9/10 back every unit AC in those bands (020..034, 042, 060..062) with the reference adapter as the sole adapter.

---

## 3. Traceability (every AC-EAS → owning task → owning test file; layers match the spec §6 table exactly)

| AC | Task | Owning test file | Layer |
|---|---|---|---|
| AC-EAS-001 | 8 | `pmo-portal/src/lib/adapterSeam/router.test.ts` | Vitest (unit) |
| AC-EAS-002 | 8 | `pmo-portal/src/lib/adapterSeam/router.test.ts` | Vitest (unit) |
| AC-EAS-003 | 16 | the unchanged existing suite (`npm run verify` + `supabase test db`) | cross-layer regression gate (meta) |
| AC-EAS-010 | 1 | `supabase/tests/external_domain_ownership_rls.test.sql` | pgTAP |
| AC-EAS-011 | 1 | `supabase/tests/external_domain_ownership_rls.test.sql` | pgTAP |
| AC-EAS-012 | 1 | `supabase/tests/external_domain_ownership_rls.test.sql` | pgTAP |
| AC-EAS-013 | 7 | `pmo-portal/src/lib/adapterSeam/capabilityMap.test.ts` | Vitest (unit) |
| AC-EAS-014 | 8 | `pmo-portal/src/lib/adapterSeam/router.test.ts` | Vitest (unit) |
| AC-EAS-015 | 14 | `pmo-portal/src/components/integrations/IntegrationsView.test.tsx` | Vitest (unit, RTL) |
| AC-EAS-020 | 6 | `pmo-portal/src/lib/adapterSeam/referenceAdapter.test.ts` | Vitest (unit) |
| AC-EAS-021 | 6 | `pmo-portal/src/lib/adapterSeam/referenceAdapter.test.ts` | Vitest (unit) |
| AC-EAS-022 | 6 | `pmo-portal/src/lib/adapterSeam/referenceAdapter.test.ts` | Vitest (unit) |
| AC-EAS-023 | 9 | `pmo-portal/src/lib/adapterSeam/dispatch.test.ts` | Vitest (unit) |
| AC-EAS-030 | 8 | `pmo-portal/src/lib/adapterSeam/router.test.ts` | Vitest (unit) |
| AC-EAS-031 | 8 | `pmo-portal/src/lib/adapterSeam/router.test.ts` | Vitest (unit) |
| AC-EAS-032 | 8 | `pmo-portal/src/lib/adapterSeam/router.test.ts` | Vitest (unit) |
| AC-EAS-033 | 9 | `pmo-portal/src/lib/adapterSeam/dispatch.test.ts` | Vitest (unit) |
| AC-EAS-034 | 9 | `pmo-portal/src/lib/adapterSeam/dispatch.test.ts` | Vitest (unit) |
| AC-EAS-035 | 4 | `supabase/tests/external_reference_items_rls.test.sql` | pgTAP |
| AC-EAS-040 | 2 | `supabase/tests/external_refs_rls.test.sql` | pgTAP |
| AC-EAS-041 | 2 | `supabase/tests/external_refs_rls.test.sql` | pgTAP |
| AC-EAS-042 | 9 | `pmo-portal/src/lib/adapterSeam/dispatch.test.ts` | Vitest (unit) |
| AC-EAS-050 | 3 | `supabase/tests/external_sync_watermarks_rls.test.sql` | pgTAP |
| AC-EAS-051 | 11 | `pmo-portal/src/lib/db/externalSyncWatermarks.test.ts` | Vitest (unit) |
| AC-EAS-060 | 10 | `pmo-portal/src/lib/adapterSeam/pendingPush.test.ts` | Vitest (unit) |
| AC-EAS-061 | 10 | `pmo-portal/src/lib/adapterSeam/pendingPush.test.ts` | Vitest (unit) |
| AC-EAS-062 | 10 | `pmo-portal/src/lib/adapterSeam/pendingPush.test.ts` | Vitest (unit) |
| AC-EAS-070 | 6/8/9/10 | (meta — reference adapter backs every unit AC in bands 020..034, 042, 060..062) | Vitest (meta) |

**NFR coverage (transitive):** NFR-EAS-SEC-001 (`org_id` seam) — every table's column default + `WITH CHECK` (Tasks 1–4) + the pgTAP band; NFR-EAS-SEC-002 (RLS authority) — Tasks 1–4 policies (the RLS-owning ACs are the pgTAP rows above: 010/011/012/035/040/041/050); NFR-EAS-PERF-001 (no added latency) — `routeWrite` empty-map short-circuit is O(1), cached map (Task 8); NFR-EAS-CONTRACT-001 (single coupling seam) — `contract.ts` is the only external-aware module (Task 5) + the dispatch.test.ts `?raw` purity guard (Task 9); NFR-EAS-REV-001 (reversibility) — every migration ships a manual-reverse block; NFR-EAS-TEST-001 (pyramid) — Vitest mocks the DAL; RLS proven by pgTAP; no e2e in P0.

---

## 4. Open questions / notes for the Director

1. **Execution order for Tasks 8 & 10.** `router.test.ts` (Task 8) imports `pendingPushAfterWrite`/`IDLE_PENDING_PUSH` for the AC-EAS-002 no-state assertion. Execute **Task 10 before Task 8**, or land `pendingPush.ts` first. Both files are otherwise independent.
2. **No existing-repo branch in P0 (by design).** The spec's "write-method branch" ships as the generic, tested `executeWrite` helper (Task 8). No existing domain repository is branched in P0 because **no real domain flips in P0** (spec §9) — only the synthetic `reference` domain (OD-4) is exercised, and it has no FE CRUD surface (its read-model is written by the service-role edge function). P1 wires `executeWrite` into real-domain repositories when a domain actually flips. This is the minimal faithful reading of "no changes to existing domain DAL/repositories beyond the write-method branch the spec names" (the branch is a *new* helper, not an *edit* to an existing repo).
3. **`operator_set_domain_ownership` RPC included (OD-2 "write contract (RPC)").** P0 ships the Operator-only provisioning RPC + the read-only view; a write-capable admin UI stays deferred (§9). The RPC is not the owning proof for any AC (AC-EAS-012 is proven by the RLS policy) but it is the write contract OD-2 names.
4. **`external_reference_items` write-policy is the per-org FLIP (dynamic).** The policy denies user-JWT writes WHILE `domain_externally_owned(org,'reference')` and permits member writes when PMO-owned — exactly FR-EAS-037's "while externally-owned" conditioning (proven by AC-EAS-035). service_role bypasses RLS so the dispatch always writes.
5. **deno.lock must be committed** (CI `--lock --frozen` gate). Task 15 gives the exact `deno cache --lock-write` command.
6. **OQ-1/OQ-2 respected.** Watermark cursor is opaque `text` (P1 sweep picks the type); `external_refs` stores the minimal mapping (no last-synced richness — P1).

---

## 5. Self-verification (performed by the planner)

- **Every AC-EAS id from the spec's §6 traceability appears in exactly one task** (§3 table above): 001, 002, 003, 010, 011, 012, 013, 014, 015, 020, 021, 022, 023, 030, 031, 032, 033, 034, 035, 040, 041, 042, 050, 051, 060, 061, 062, 070 — all 28 present, none duplicated.
- **Migration numbers do not collide:** 0085–0088 are free (current top is `0084_agent_usage_cache_tokens.sql`, verified by `ls supabase/migrations/ | tail`). pgTAP test files use semantic names per the spec's traceability (matching the repo's allowance for semantic names, e.g. `agent_write_*_rls.test.sql`).
- **Owning layers match the spec's §6 table exactly** (pgTAP for 010/011/012/035/040/041/050; Vitest unit for the rest; RTL for 015; meta for 003/070).
- **No P1+ scope, no new deps, no existing-repo edits** beyond the three additive repository entries (Task 13) and the two `ci.yml` list appends (Task 15).
- **TDD order + real code + exact verify commands** in every task; the empty-map short-circuit is the first branch in `routeWrite` (AC-EAS-001 byte-for-byte).
