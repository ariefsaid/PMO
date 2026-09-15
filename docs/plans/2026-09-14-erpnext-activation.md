# Plan — ERPNext activation at Company selection (#650)

- **Date:** 2026-09-14 · **Issue:** #650 · **Branch/worktree:** `fix/650-erpnext-activation`
- **Spec:** [`docs/specs/external-admin-connect.spec.md`](../specs/external-admin-connect.spec.md) **§7 addendum**
  (`FR-EAC-101..111`, `NFR-EAC-SEC-101..103`, `AC-EAC-101..118`)
- **ADR:** [`docs/adr/0073-erpnext-activation-at-company-selection.md`](../adr/0073-erpnext-activation-at-company-selection.md)
- **Migration number chosen:** **`0216`** — head of `supabase/migrations/` is `0215_org_checks_after_stamp.sql`.
  One file: `supabase/migrations/0216_erpnext_activation.sql`. On a collision use
  `scripts/renumber-migration.sh <old> <new>`, never a hand-rolled `git mv`.
- **Executor tier:** money/auth path → Director-dispatched, not the ADW.

## Out of scope (stated, per the brief)

- **Credential resolution on the write paths — issue #651, running in parallel.** Nothing in this plan
  touches `pmo-portal/src/lib/adapterSeam/erpnext/credentials.ts`, `resolveErpCredentials`, or any sweep
  write path. `external-set-company` keeps its existing inline `read_vault_secret` + `split(':')`
  resolution byte-for-byte; if #651 lands first, that block is #651's to change, not this plan's.
- **The #481 crossing dry-run.** This plan makes activation possible; proving it against the live v16
  bench is #481's owner-gated checklist.
- **Any UI change beyond the Company-dialog error copy.** No new controls, no status chip, no layout.
- **ClickUp.** `external-connect`'s ClickUp branch, `finalize_external_connect`, and
  `cleanup_external_connect_attempt` are read but not modified.

## Premises I could not confirm

Read-only on code; no `supabase`, `docker`, `npm` or `deno` was run. These are the places where a
statement in this plan rests on reading rather than on execution:

1. **The live catalog at head.** Every grant/policy claim here comes from reading migrations, not from
   `pg_policies` / `role_table_grants` on a running database — the artifact that actually decides.
   Specifically: "`authenticated`/`anon` hold SELECT only on `external_org_bindings`" comes from
   `0096_erpnext_seam_tables.sql:103` plus a repo-wide grep over `supabase/**` that found no other grant on
   that table. **Task 1.2 turns this into a catalog-derived pgTAP assertion so the build verifies it rather
   than inheriting my grep.** Until that test runs green, treat the claim as unverified.
2. **v16 Company doctype field names.** `companyDefaultsFromDoc` reads `default_payable_account`,
   `default_cash_account`, `default_bank_account`, `default_expense_account`, `cost_center` — the v15 names
   `binding.ts` already uses. Whether ERPNext v16.33 exposes all five under those exact names is unverified
   (no bench access from here). The mapper writes `null` on absence, so a rename degrades to "no default",
   not "wrong account" — but silently. **The #481 dry-run must check this against the live v16 bench.**
3. **Whether `frappe.utils.change_log.get_versions` is reachable for a non-Administrator API user on
   v16.33.** `binding.ts` assumes it is (v15 behaviour). If v16 restricts it, activation would refuse every
   credential. Not checkable without the bench; the 422 message is written so this failure is legible if it
   happens.
4. **The exact prod state of `create_vault_secret_for_org`.** I read `0180`'s body. Whether the cloud
   project's copy matches is decided by `supabase migration list --linked`, which I did not run. The plan
   deliberately does **not** alter that function's signature, so this premise does not gate the design.
5. **Whether `external-companies` has ever succeeded against a self-serve-connected org.** It reads the
   same empty `site_url`, so it should not have; but I could not run it. If the Director wants that
   confirmed, the cheapest probe is a prod `select site_url from external_org_bindings where
   external_tier='erpnext'` — not part of this build.
6. **`docs/adr/0055` §5 and `docs/adr/0059`** were consulted for posture (external system = SoT per
   capability domain; Posture-B employment is the binding, not a domain flip). I did not re-derive their
   full argument here.

## What is actually broken (verified by reading, 2026-09-14)

| Fact | Artifact |
|---|---|
| The ERPNext connect branch never calls `finalize_external_connect` and never persists `siteUrl` | `supabase/functions/external-connect/index.ts` §7–§9 (the `if (tier === 'clickup')` block is the only finalize path) |
| The binding row is created with a literal empty site URL | `supabase/migrations/0180_rpc_active_member_gate.sql` — `insert into public.external_org_bindings (…, site_url, …) values (p_org_id, p_external_tier, '', …)` |
| `external-set-company` and `external-companies` both talk to `binding.site_url` | `external-set-company/index.ts` step 8; `external-companies/index.ts` step 8 |
| Nothing writes `activated_at` / `version_major` | `activateBinding` in `pmo-portal/src/lib/adapterSeam/erpnext/binding.ts` is referenced only by `binding.test.ts` and two docs/plans |
| Three predicates gate money on `activated_at` | `erpnext/dispatchFactory.ts` `resolveErpDispatchAdapter`; `erpnext-sweep/index.ts` `listEmployingOrgsLive`; `org_has_active_erpnext_binding` (mig `0160`) |
| Disconnect never clears `activated_at`, and the employ predicates never read `status` | `external-disconnect/index.ts` step 8; `0160` line 41 |
| `external-disconnect`'s audit call passes `p_entity_type` and omits `p_actor_id` — no overload of `log_audit(text,uuid,uuid,uuid,jsonb)` matches, so the call fails and is only `console.error`ed | `external-disconnect/index.ts` step 10 vs `0076_audit_events.sql:80` |
| `external-disconnect/disconnect.test.ts` asserts re-implemented local booleans, imports no handler, and is not in the binding guard's `REQUIRED` map | `disconnect.test.ts`; `scripts/check-edge-fn-test-binding.mjs:26-33` |

## Architecture

**Data flow after this change**

```
Admin → Integrations card
  │
  ├─ Connect (erpnext)
  │    external-connect
  │      verifyCallerJwt → Admin∨Operator → kill switch
  │      validateErpNextCredentials(siteUrl,…)        [SSRF + HTTPS, unchanged]
  │      rpc create_vault_secret_for_org(...)          [unchanged signature; writes site_url='']
  │      rpc set_external_binding_site_url(org,tier,siteUrl,actor)   ← NEW (0216)
  │           · service_role only · re-checks https:// + non-empty
  │           · repoint ⇒ clears activated_at / version_major / config.company
  │      → 200 {ok}   (RPC failure ⇒ 500 SITE_URL_NOT_PERSISTED, binding left inert)
  │
  ├─ Pick Company (erpnext)
  │    external-set-company
  │      verifyCallerJwt → Admin∨Operator
  │      load binding (secret_ref, status, config, site_url)
  │      guard: site_url non-empty                                   ← NEW (422)
  │      rpc read_vault_secret → apiKey:apiSecret                    [unchanged — #651 owns this]
  │      validateErpNextCompany(...) → the Company doc               [now RETURNS the doc]
  │      fetchErpVersionMajor(...)                                   ← NEW, imported from binding.ts
  │      major ∈ {15,16}? no  → 422 config-rejected, nothing written
  │                       yes → rpc activate_external_binding(...)   ← NEW (0216)
  │                              ONE update: version_major + config.company
  │                              + company defaults + activated_at=coalesce(activated_at,now())
  │      rpc log_audit('integration.set_company', …)                 [unchanged]
  │      → 200 {ok, companyId, versionMajor, activatedAt}
  │
  └─ Disconnect
       external-disconnect
         verifyCallerJwt → Admin∨Operator
         rpc delete_vault_secret(secret_ref)                          [unchanged]
         rpc deactivate_external_binding(org,tier,actor)              ← NEW (0216), replaces the PATCH
              ONE update: status/disconnected_at + clears
              activated_at / version_major / config.company
         clickup only: rpc admin_change_domain_ownership(release)     [unchanged]
         rpc log_audit('integration.disconnect', …)                   [ARG BUG FIXED]
```

**Component/file inventory** (everything this plan touches)

| File | Change |
|---|---|
| `supabase/migrations/0216_erpnext_activation.sql` | NEW — 3 service-role-only definer RPCs + grants + on-database assert |
| `supabase/tests/erpnext_activation.test.sql` | NEW — pgTAP for the RPCs, the grants, and the catalog-derived write-surface guard |
| `pmo-portal/src/lib/adapterSeam/erpnext/binding.ts` | `SUPPORTED_VERSION_MAJORS`, export `parseVersionMajor`, new `fetchErpVersionMajor`, new `companyDefaultsFromDoc`, `activateBinding` refactored onto both |
| `pmo-portal/src/lib/adapterSeam/erpnext/binding.test.ts` | v16 case inverted (`DD-OPS-10`), helpers covered |
| `supabase/functions/external-connect/index.ts` | ERPNext branch calls `set_external_binding_site_url` |
| `supabase/functions/external-connect/connect.test.ts` | 2 new cases |
| `supabase/functions/external-set-company/index.ts` | site-URL guard, handshake, activation RPC replaces the PATCH; `validateErpNextCompany` returns the doc |
| `supabase/functions/external-set-company/set-company.test.ts` | 5 new cases; 4 PATCH assertions become RPC assertions |
| `supabase/functions/external-disconnect/index.ts` | export `handleDisconnectRequest`, `import.meta.main` guard, `deactivate_external_binding`, `log_audit` arg fix |
| `supabase/functions/external-disconnect/disconnect.test.ts` | REWRITTEN to bind to the shipped handler |
| `scripts/check-edge-fn-test-binding.mjs` | add the disconnect entry (6/6 → 7/7) |
| `pmo-portal/src/lib/repositories/index.ts` | `setCompany` reads the error body and throws `AppError` |
| `pmo-portal/src/lib/repositories/integrations.setCompany.test.ts` | NEW |

**Scaling / `org_id` seam.** Every new RPC is keyed `(p_org_id, p_external_tier)` — the table's unique
key — and reads/writes exactly one row; no cross-org scan is introduced. `org_id` is never threaded from
the client (the edge fns take it from the verified JWT's profile). Cost is O(1) per connect / per Company
selection, both of which happen a handful of times in an org's life. No index is needed.

**Why no restrictive policy or trigger.** `authenticated`/`anon` hold **SELECT only** on
`external_org_bindings`, so a write policy or an `activated_at` trigger would be a dead layer that reads
like a live control (`0180` §3 annotates exactly this class; the `0203` audit re-learned it). The live
layer is the grant surface + the service-role-only RPC EXECUTE, and Task 1.2 proves both from the catalog
so a future re-grant fails the suite. A trigger would also break `supabase/seed.sql` and
`e2e/serial/_tspHelpers.ts` `upsertTspBinding`, which write these columns directly and legitimately.

## Deliberate changes to currently-green tests (BDD rule: justify, never bend)

| Test | Change | Justification |
|---|---|---|
| `binding.test.ts` "a v16 handshake leaves the binding un-activated" | inverted to "activates" | `DD-OPS-10` ruled RIS targets v16.33; the v15-only pin is superseded. The v14 case stays as the negative oracle. |
| `set-company.test.ts` ×4 `restCall(calls,'external_org_bindings','PATCH').length` | becomes `rpcCall(calls,'activate_external_binding').length` | FR-EAC-106 moves the write into one RPC so company/version/stamp cannot land partially. The **goal** oracle ("the selected Company is persisted") is unchanged; only the mechanism assertion moves. |
| `disconnect.test.ts` (whole file) | rewritten to import `handleDisconnectRequest` | It currently asserts local booleans it defined itself; it would stay green with the shipped handler deleted. |

---

# Tasks

Ordering is TDD: within each phase the failing test comes first. Run the named verify command after every
task. **Never weaken a test to get green.**

Shell prefixes used below:
- `WT=/Users/ariefsaid/Coding/PMO/.claude/worktrees/650-erpnext-activation`
- DB work is always `cd $WT && scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db'`
  (chained under ONE lock hold — a sibling reset landing between them produces false reds AND false greens).

## Phase 0 — preflight (no code)

### Task 0.1 — confirm the migration number is still free
```bash
cd $WT && ls supabase/migrations | tail -3
```
Expect `0215_org_checks_after_stamp.sql` as the highest. If a sibling worktree has taken `0216`, pick the
next free number and use it consistently everywhere below (and in the ADR's reversibility note).

### Task 0.2 — confirm the write-surface premise before designing on it
```bash
cd $WT && grep -rn "external_org_bindings" supabase/migrations | grep -i grant
```
Expect exactly one hit: `0096_erpnext_seam_tables.sql:103: grant select on public.external_org_bindings to authenticated, anon;`
If anything else appears, STOP and re-open the enforcement design — a write grant means the dead-layer
reasoning in ADR-0073 §6 is wrong.

---

## Phase 1 — the database contract (pgTAP first)

### Task 1.1 — write the failing pgTAP file, header + plan + fixtures
Create `supabase/tests/erpnext_activation.test.sql`:
```sql
-- erpnext_activation.test.sql — #650 / ADR-0073.
-- AC-EAC-103, AC-EAC-109, AC-EAC-110, AC-EAC-111, AC-EAC-112, AC-EAC-113, AC-EAC-114
begin;
select plan(24);

reset role;
insert into organizations (id, name) values
  ('e6500000-0000-0000-0000-000000000001', 'Act Org A');
insert into auth.users (id, email) values
  ('e65a0000-0000-0000-0000-00000000000a', 'act-admin@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('e65a0000-0000-0000-0000-00000000000a', 'e6500000-0000-0000-0000-000000000001',
   'Act Admin', 'act-admin@example.com', 'Admin', 'active');

-- A connected-but-not-activated erpnext binding, exactly as external-connect leaves it today.
insert into external_org_bindings (org_id, external_tier, site_url, secret_ref, status)
values ('e6500000-0000-0000-0000-000000000001', 'erpnext', '', 'act-secret-ref', 'active');

select finish();
rollback;
```
**Verify:** `cd $WT && scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db'` —
expect a FAIL for a plan of 24 with 0 tests run. That is the RED.

### Task 1.2 — AC-EAC-113: the catalog-derived write-surface guard
Insert before `select finish();`:
```sql
-- AC-EAC-113 the ONLY client privilege on the binding table is SELECT. A future migration that
-- re-grants a write fails here — this, not a policy, is the live layer (ADR-0073 §6).
select is(
  (select coalesce(string_agg(distinct privilege_type, ',' order by privilege_type), '')
     from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'external_org_bindings'
      and grantee in ('anon', 'authenticated')),
  'SELECT',
  'AC-EAC-113 authenticated/anon hold SELECT only on external_org_bindings'
);
```
**Verify:** same command. Expect this one test to PASS (it describes head) while the plan count still fails.

### Task 1.3 — AC-EAC-112: the three RPCs do not exist yet (RED that names the contract)
Append:
```sql
-- AC-EAC-112 service-role-only EXECUTE on the three activation RPCs.
select ok(
  to_regprocedure('public.set_external_binding_site_url(uuid,text,text,uuid)') is not null,
  'AC-EAC-112 set_external_binding_site_url exists');
select ok(
  to_regprocedure('public.activate_external_binding(uuid,text,int,text,jsonb,uuid)') is not null,
  'AC-EAC-112 activate_external_binding exists');
select ok(
  to_regprocedure('public.deactivate_external_binding(uuid,text,uuid)') is not null,
  'AC-EAC-112 deactivate_external_binding exists');
select ok(
  not has_function_privilege('anon', 'public.activate_external_binding(uuid,text,int,text,jsonb,uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.activate_external_binding(uuid,text,int,text,jsonb,uuid)', 'EXECUTE'),
  'AC-EAC-112 activate_external_binding is not client-executable');
select ok(
  has_function_privilege('service_role', 'public.activate_external_binding(uuid,text,int,text,jsonb,uuid)', 'EXECUTE'),
  'AC-EAC-112 activate_external_binding is service_role-executable');
```
**Verify:** same command. Expect 3 hard failures (`to_regprocedure` returns null) — RED.

### Task 1.4 — write `0216`, part 1: `set_external_binding_site_url`
Create `supabase/migrations/0216_erpnext_activation.sql` with the header and the first function:
```sql
-- 0216_erpnext_activation.sql — #650 / ADR-0073.
-- ERPNext activation becomes a real code path: connect persists site_url, Company selection performs the
-- version handshake and stamps activated_at, disconnect clears it. Three service-role-only SECURITY
-- DEFINER RPCs; NO column is added, dropped or retyped and NO policy/trigger is added to
-- external_org_bindings (authenticated/anon hold SELECT only — a write policy there would be a dead
-- layer that reads like a live control; see ADR-0073 §6 and 0180 §3).
--
-- Reversibility (ADR-0006): supabase db reset. Manual rollback, reverse order:
--   drop function if exists public.deactivate_external_binding(uuid, text, uuid);
--   drop function if exists public.activate_external_binding(uuid, text, int, text, jsonb, uuid);
--   drop function if exists public.set_external_binding_site_url(uuid, text, text, uuid);

-- ── FR-EAC-101/102 — persist the connect site URL; a REPOINT un-activates. ───────────────────────
create or replace function public.set_external_binding_site_url(
  p_org_id uuid, p_external_tier text, p_site_url text, p_actor_id uuid
) returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_prior  text;
  v_result text;
begin
  if current_setting('role', true) <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  -- The edge fn's SSRF/HTTPS guard stays where it is; this is the second layer, so a future caller
  -- cannot skip it (NFR-EAC-SEC-101).
  if p_site_url is null or btrim(p_site_url) = '' or p_site_url !~* '^https://' then
    raise exception 'site_url must be a non-empty https:// URL' using errcode = '22023';
  end if;

  select site_url into v_prior
    from public.external_org_bindings
   where org_id = p_org_id and external_tier = p_external_tier and status = 'active'
   for update;
  if not found then
    raise exception 'no active binding for this org and tier' using errcode = 'P0001';
  end if;

  if coalesce(v_prior, '') <> '' and v_prior is distinct from p_site_url then
    -- FR-EAC-102: activated_at/version_major/config.company describe the OLD site. Keeping them would
    -- let the very next sweep tick push money documents at a different host under a stale company.
    update public.external_org_bindings
       set site_url      = p_site_url,
           activated_at  = null,
           version_major = null,
           config        = coalesce(config, '{}'::jsonb) - 'company',
           updated_at    = now()
     where org_id = p_org_id and external_tier = p_external_tier;
    v_result := 'repointed';
  else
    update public.external_org_bindings
       set site_url = p_site_url, updated_at = now()
     where org_id = p_org_id and external_tier = p_external_tier;
    v_result := 'set';
  end if;

  perform public.log_audit('integration.site_url_set', p_org_id, p_actor_id, null,
    jsonb_build_object('tier', p_external_tier, 'actor', p_actor_id, 'outcome', v_result));
  return v_result;
end;
$$;
```
**Verify:** `cd $WT && scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db'` — the
`set_external_binding_site_url exists` assertion turns green.

### Task 1.5 — `0216`, part 2: `activate_external_binding`
Append to the same file:
```sql
-- ── FR-EAC-104/106/107/110 — ONE statement: version + company + defaults + set-once stamp. ───────
-- The supported-major allowlist lives here AS WELL AS in
-- pmo-portal/src/lib/adapterSeam/erpnext/binding.ts (SUPPORTED_VERSION_MAJORS). The edge fn's check is
-- the UX gate; THIS is the authority (FR-EAC-110). Keep the two in step — each has its own test.
create or replace function public.activate_external_binding(
  p_org_id uuid, p_external_tier text, p_version_major int,
  p_company text, p_config_patch jsonb, p_actor_id uuid
) returns timestamptz
language plpgsql security definer set search_path = public
as $$
declare
  v_supported constant int[] := array[15, 16];   -- DD-OPS-10: local bench v15.94.3, RIS target v16.33
  v_prior_stamp timestamptz;
  v_stamp       timestamptz;
begin
  if current_setting('role', true) <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_external_tier <> 'erpnext' then
    raise exception 'only the erpnext tier has an activation handshake' using errcode = 'P0001';
  end if;
  if p_version_major is null or not (p_version_major = any (v_supported)) then
    raise exception 'unsupported erpnext major version %', coalesce(p_version_major::text, 'null')
      using errcode = 'P0001';
  end if;
  if p_company is null or btrim(p_company) = '' then
    raise exception 'company is required to activate' using errcode = '22023';
  end if;
  if p_config_patch is not null and jsonb_typeof(p_config_patch) <> 'object' then
    raise exception 'config patch must be a JSON object' using errcode = '22023';
  end if;

  select activated_at into v_prior_stamp
    from public.external_org_bindings
   where org_id = p_org_id and external_tier = p_external_tier
     and status = 'active' and coalesce(site_url, '') <> ''
   for update;
  if not found then
    raise exception 'binding is not connectable (inactive, missing, or no site_url)'
      using errcode = 'P0001';
  end if;

  -- ONE statement: a half-written activation on the money path is the class ADR-0058 exists to remove.
  -- coalesce() is FR-EAC-107's set-once rule: activated_at is DD-XING-2's epoch and the sweep's
  -- `approved_at >= activated_at` floor — moving it forward on a re-select would silently drop every
  -- week approved in between out of recovery scope.
  update public.external_org_bindings
     set version_major = p_version_major,
         config        = coalesce(config, '{}'::jsonb)
                         || coalesce(p_config_patch, '{}'::jsonb)
                         || jsonb_build_object('company', p_company),
         activated_at  = coalesce(activated_at, now()),
         updated_at    = now()
   where org_id = p_org_id and external_tier = p_external_tier
  returning activated_at into v_stamp;

  perform public.log_audit('integration.activate', p_org_id, p_actor_id, null,
    jsonb_build_object('tier', p_external_tier, 'actor', p_actor_id,
                       'company', p_company, 'version_major', p_version_major,
                       'first_activation', v_prior_stamp is null));
  return v_stamp;
end;
$$;
```
**Verify:** same command. `activate_external_binding exists` + the two privilege assertions turn green.

### Task 1.6 — `0216`, part 3: `deactivate_external_binding`
Append:
```sql
-- ── FR-EAC-108 — disconnect un-activates in the SAME statement. ──────────────────────────────────
-- The sweep's employ predicates (erpnext-sweep listEmployingOrgsLive, org_has_active_erpnext_binding
-- mig 0160) read activated_at and NEVER read status, so leaving the stamp keeps a disconnected org
-- "employing" until the deleted Vault secret happens to fail. Fail-closed by accident is not a control.
-- No audit here on purpose: external-disconnect emits the single 'integration.disconnect' event, and
-- AC-EAC-019 asserts exactly one.
create or replace function public.deactivate_external_binding(
  p_org_id uuid, p_external_tier text, p_actor_id uuid
) returns int
language plpgsql security definer set search_path = public
as $$
declare v_n int;
begin
  if current_setting('role', true) <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  update public.external_org_bindings
     set status          = 'disconnected',
         disconnected_at = now(),
         activated_at    = null,
         version_major   = null,
         config          = coalesce(config, '{}'::jsonb) - 'company',
         updated_at      = now()
   where org_id = p_org_id and external_tier = p_external_tier
  returning 1 into v_n;
  return coalesce(v_n, 0);
end;
$$;
```
**Verify:** same command. `deactivate_external_binding exists` turns green.

### Task 1.7 — `0216`, part 4: grants + the on-database assert
Append (the `0210` idiom — hosted Supabase's default privileges differ from local Docker, so the proof
must run where the grants live):
```sql
-- ── NFR-EAC-SEC-102 — service-role-only EXECUTE, asserted on THIS database. ──────────────────────
do $$
declare fn text;
begin
  foreach fn in array array[
    'public.set_external_binding_site_url(uuid, text, text, uuid)',
    'public.activate_external_binding(uuid, text, int, text, jsonb, uuid)',
    'public.deactivate_external_binding(uuid, text, uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
    if has_function_privilege('anon', fn, 'EXECUTE')
       or has_function_privilege('authenticated', fn, 'EXECUTE') then
      raise exception '0216: % is still executable by anon/authenticated', fn;
    end if;
    if not has_function_privilege('service_role', fn, 'EXECUTE') then
      raise exception '0216: % lost service_role EXECUTE', fn;
    end if;
  end loop;
end $$;
```
**Verify:** same command. All five Task 1.3 assertions green.

### Task 1.8 — AC-EAC-110 + AC-EAC-111: the refusal cases
Append to the pgTAP file (before `finish()`), with the binding still at `site_url=''` from Task 1.1:
```sql
-- AC-EAC-110 an unusable binding is refused; nothing partial is written.
select throws_ok(
  $$ select public.activate_external_binding(
       'e6500000-0000-0000-0000-000000000001','erpnext',15,'ACME','{}'::jsonb,
       'e65a0000-0000-0000-0000-00000000000a') $$,
  'P0001', null,
  'AC-EAC-110 activation refuses a binding with an empty site_url');
select is(
  (select activated_at from external_org_bindings
    where org_id='e6500000-0000-0000-0000-000000000001' and external_tier='erpnext'),
  null::timestamptz,
  'AC-EAC-110 the refused activation wrote no stamp');
select is(
  (select config ? 'company' from external_org_bindings
    where org_id='e6500000-0000-0000-0000-000000000001' and external_tier='erpnext'),
  false,
  'AC-EAC-110 the refused activation wrote no company');

-- Give the binding a site_url the honest way, then re-test the version gate.
select is(
  public.set_external_binding_site_url(
    'e6500000-0000-0000-0000-000000000001','erpnext','https://erp.example.com',
    'e65a0000-0000-0000-0000-00000000000a'),
  'set',
  'AC-EAC-103 the first site_url write reports "set"');

-- AC-EAC-111 the DATABASE rejects an unsupported major, independently of the edge function.
select throws_ok(
  $$ select public.activate_external_binding(
       'e6500000-0000-0000-0000-000000000001','erpnext',14,'ACME','{}'::jsonb,
       'e65a0000-0000-0000-0000-00000000000a') $$,
  'P0001', null,
  'AC-EAC-111 activation refuses ERPNext major 14');
select is(
  (select version_major from external_org_bindings
    where org_id='e6500000-0000-0000-0000-000000000001' and external_tier='erpnext'),
  null::int,
  'AC-EAC-111 the refused major wrote no version');
```
**Verify:** same command — 6 more green.

### Task 1.9 — AC-EAC-109: set-once across re-selection
Append:
```sql
-- AC-EAC-109 activated_at is SET-ONCE for the lifetime of a connection.
select isnt(
  public.activate_external_binding(
    'e6500000-0000-0000-0000-000000000001','erpnext',15,'Company A',
    '{"default_payable_account":"Creditors - A"}'::jsonb,
    'e65a0000-0000-0000-0000-00000000000a'),
  null::timestamptz,
  'AC-EAC-109 first activation returns a stamp');

create temporary table act_t0 as
  select activated_at as t0 from external_org_bindings
   where org_id='e6500000-0000-0000-0000-000000000001' and external_tier='erpnext';

select is(
  public.activate_external_binding(
    'e6500000-0000-0000-0000-000000000001','erpnext',16,'Company B','{}'::jsonb,
    'e65a0000-0000-0000-0000-00000000000a'),
  (select t0 from act_t0),
  'AC-EAC-109 re-selecting a Company preserves the ORIGINAL activated_at');
select is(
  (select config->>'company' from external_org_bindings
    where org_id='e6500000-0000-0000-0000-000000000001' and external_tier='erpnext'),
  'Company B',
  'AC-EAC-109 re-selection does update the company');
select is(
  (select config->>'default_payable_account' from external_org_bindings
    where org_id='e6500000-0000-0000-0000-000000000001' and external_tier='erpnext'),
  'Creditors - A',
  'AC-EAC-109 the config merge does not clobber sibling keys');
select is(
  (select version_major from external_org_bindings
    where org_id='e6500000-0000-0000-0000-000000000001' and external_tier='erpnext'),
  16,
  'AC-EAC-109 re-selection updates version_major');
```
**Verify:** same command — 5 more green.

### Task 1.10 — AC-EAC-103: repoint clears the stamps
Append:
```sql
-- AC-EAC-103 a repoint un-activates.
select is(
  public.set_external_binding_site_url(
    'e6500000-0000-0000-0000-000000000001','erpnext','https://erp-new.example.com',
    'e65a0000-0000-0000-0000-00000000000a'),
  'repointed',
  'AC-EAC-103 changing the site_url reports "repointed"');
select ok(
  (select activated_at is null and version_major is null and not (config ? 'company')
     from external_org_bindings
    where org_id='e6500000-0000-0000-0000-000000000001' and external_tier='erpnext'),
  'AC-EAC-103 a repoint clears activated_at, version_major and config.company');
select throws_ok(
  $$ select public.set_external_binding_site_url(
       'e6500000-0000-0000-0000-000000000001','erpnext','http://erp.example.com',
       'e65a0000-0000-0000-0000-00000000000a') $$,
  '22023', null,
  'AC-EAC-103 a non-https site_url is refused by the database too');
```
**Verify:** same command — 3 more green.

### Task 1.11 — AC-EAC-114: disconnect un-activates and the employ predicate goes false
Append:
```sql
-- AC-EAC-114 deactivation flips org_has_active_erpnext_binding (mig 0160) to false.
select is(
  public.set_external_binding_site_url(
    'e6500000-0000-0000-0000-000000000001','erpnext','https://erp-new.example.com',
    'e65a0000-0000-0000-0000-00000000000a'),
  'set',
  'AC-EAC-114 re-writing the SAME site_url is not a repoint');
select isnt(
  public.activate_external_binding(
    'e6500000-0000-0000-0000-000000000001','erpnext',16,'Company B','{}'::jsonb,
    'e65a0000-0000-0000-0000-00000000000a'),
  null::timestamptz,
  'AC-EAC-114 re-activated after the repoint');
select ok(
  public.org_has_active_erpnext_binding('e6500000-0000-0000-0000-000000000001'),
  'AC-EAC-114 the employ predicate is true while activated');
select is(
  public.deactivate_external_binding(
    'e6500000-0000-0000-0000-000000000001','erpnext','e65a0000-0000-0000-0000-00000000000a'),
  1,
  'AC-EAC-114 deactivation touched one row');
select ok(
  not public.org_has_active_erpnext_binding('e6500000-0000-0000-0000-000000000001'),
  'AC-EAC-114 the employ predicate is FALSE immediately after disconnect');
select ok(
  (select status = 'disconnected' and disconnected_at is not null
      and activated_at is null and version_major is null and not (config ? 'company')
     from external_org_bindings
    where org_id='e6500000-0000-0000-0000-000000000001' and external_tier='erpnext'),
  'AC-EAC-114 disconnect soft-archives AND clears the stamps in one statement');
```
**Verify:** same command — 6 more green.

### Task 1.12 — AC-EAC-112: a client session is denied
Append, then correct `plan(24)` to the actual count:
```sql
-- AC-EAC-112 an authenticated Admin cannot call the activation path directly.
set local role authenticated;
set local request.jwt.claims = '{"sub":"e65a0000-0000-0000-0000-00000000000a","role":"authenticated"}';
select throws_ok(
  $$ select public.deactivate_external_binding(
       'e6500000-0000-0000-0000-000000000001','erpnext','e65a0000-0000-0000-0000-00000000000a') $$,
  '42501', null,
  'AC-EAC-112 authenticated is denied deactivate_external_binding');
reset role;
```
**Verify:** `cd $WT && scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db'` — the whole
file green with the plan count matching. If the count is off, fix `plan(N)`, never delete a test.

### Task 1.13 — mutation check the database layer
Temporarily break each rule, run the suite, confirm RED, then revert:
1. `v_supported constant int[] := array[14,15,16];` → the AC-EAC-111 pair must go red.
2. `activated_at = now()` (drop the `coalesce`) → AC-EAC-109's set-once assertion must go red.
3. drop `and coalesce(site_url,'') <> ''` from the activation `select … for update` → AC-EAC-110 must go red.
4. drop `config = … - 'company'` from `deactivate_external_binding` → the AC-EAC-114 combined assertion
   must go red.
5. change the `42501` guard to `if false then` in `deactivate_external_binding` → AC-EAC-112 must go red.
**Verify:** for each, `cd $WT && scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db'`
must FAIL; after `git checkout -- supabase/migrations/0216_erpnext_activation.sql` it must PASS.
A mutation that stays green means the oracle is dead — fix the oracle before continuing.

---

## Phase 2 — the shared handshake (`binding.ts`)

### Task 2.1 — RED: the helper tests
In `pmo-portal/src/lib/adapterSeam/erpnext/binding.test.ts`, add to the import line
`fetchErpVersionMajor, companyDefaultsFromDoc, SUPPORTED_VERSION_MAJORS` and append inside
`describe('erpnext/binding', …)`:
```ts
  it('AC-EAC-116 SUPPORTED_VERSION_MAJORS is exactly [15, 16] (DD-OPS-10: bench v15, RIS v16)', () => {
    expect([...SUPPORTED_VERSION_MAJORS]).toEqual([15, 16]);
  });

  it('AC-EAC-116 fetchErpVersionMajor parses the major from the handshake', async () => {
    for (const [version, major] of [['15.94.3', 15], ['16.33.0', 16], ['14.30.1', 14]] as const) {
      const fetchImpl = fetchDeps(async () => jsonResponse(200, { erpnext: { version } }));
      await expect(
        fetchErpVersionMajor({ fetchImpl, creds: { apiKey: 'k', apiSecret: 's' }, siteUrl: 'https://erp.example.com' }),
      ).resolves.toBe(major);
    }
  });

  it('AC-EAC-116 companyDefaultsFromDoc maps the five Company account defaults, null when absent', () => {
    expect(companyDefaultsFromDoc({ default_payable_account: 'Creditors - A' }, 'ACME')).toEqual({
      company: 'ACME',
      default_payable_account: 'Creditors - A',
      default_cash_account: null,
      default_bank_account: null,
      default_expense_account: null,
      cost_center: null,
    });
  });
```
**Verify:** `cd $WT/pmo-portal && npx vitest run src/lib/adapterSeam/erpnext/binding.test.ts` — RED
(the three symbols do not exist).

### Task 2.2 — invert the v16 expectation (deliberate, `DD-OPS-10`)
Replace the existing case at `binding.test.ts` "AC-ENA-073 a v16 handshake leaves the binding
un-activated (activatedAt stays null)" with:
```ts
  it('AC-ENA-073/AC-EAC-116 a v16 handshake ACTIVATES (DD-OPS-10 — RIS targets v16.33)', async () => {
    const fetchImpl = fetchDeps(async (url) => {
      if (url.includes('/api/method/frappe.utils.change_log.get_versions')) {
        return jsonResponse(200, { erpnext: { version: '16.33.0' } });
      }
      if (url.includes('/api/resource/Company/PMO%20Smoke%20Co')) {
        return jsonResponse(200, { name: 'PMO Smoke Co', default_payable_account: 'Creditors - PSC' });
      }
      throw new Error(`unexpected URL ${url}`);
    });
    const result = await activateBinding(
      { fetchImpl, creds: { apiKey: 'k', apiSecret: 's' }, siteUrl: 'https://erp.example.com', company: 'PMO Smoke Co' },
      () => '2026-09-14T00:00:00.000Z',
    );
    expect(result.versionMajor).toBe(16);
    expect(result.activatedAt).toBe('2026-09-14T00:00:00.000Z');
  });
```
Leave the v14 case untouched — it is the negative oracle.
**Verify:** same vitest command — still RED, now for the right reason (v16 not yet supported).

### Task 2.3 — GREEN: add the three exports to `binding.ts`
In `pmo-portal/src/lib/adapterSeam/erpnext/binding.ts`, replace
`export const SUPPORTED_VERSION_MAJOR = 15;` with:
```ts
/** The ERPNext majors PMO activates. `DD-OPS-10`: the local dev bench is v15.94.3, RIS's target is
 *  v16.33 — both must pass. ⚑ MIRRORED IN SQL: `activate_external_binding`'s `v_supported` array
 *  (migration 0216). The database is the authority (FR-EAC-110); this is the fast/UX gate. Change both. */
export const SUPPORTED_VERSION_MAJORS: readonly number[] = [15, 16];
```
Change `parseVersionMajor` from `function` to `export function`, and add below it:
```ts
/** The ONE version handshake: `GET /api/method/frappe.utils.change_log.get_versions` → the major.
 *  Imported by `external-set-company` across the pmo-portal/src seam (the convention `erpnext-sweep`
 *  already uses) so there is never a second copy of this parse. */
export async function fetchErpVersionMajor(deps: {
  fetchImpl: typeof fetch;
  creds: ErpBindingCreds;
  siteUrl: string;
}): Promise<number> {
  const clientDeps: ErpClientDeps = {
    fetchImpl: deps.fetchImpl, apiKey: deps.creds.apiKey, apiSecret: deps.creds.apiSecret, baseUrl: deps.siteUrl,
  };
  return parseVersionMajor(await callMethod(clientDeps, 'frappe.utils.change_log.get_versions'));
}

/** Map one `GET Company/<name>` response onto the `config` account defaults the money bodies read
 *  (`bodies/paymentEntry.ts` `paid_from`/`paid_to`, `bodies/incomingPayment.ts`). Absent ⇒ `null`
 *  ("no default"), never a guessed account. */
export function companyDefaultsFromDoc(
  companyDoc: Record<string, unknown>, company: string,
): ErpBindingConfig {
  return {
    company,
    default_payable_account: companyDoc.default_payable_account ?? null,
    default_cash_account: companyDoc.default_cash_account ?? null,
    default_bank_account: companyDoc.default_bank_account ?? null,
    default_expense_account: companyDoc.default_expense_account ?? null,
    cost_center: companyDoc.cost_center ?? null,
  };
}
```
**Verify:** `cd $WT/pmo-portal && npx vitest run src/lib/adapterSeam/erpnext/binding.test.ts` — the
three new tests green; the v16 test still red.

### Task 2.4 — refactor `activateBinding` onto the two helpers
In `activateBinding`, replace the handshake + mismatch + config block:
```ts
  const versionMajor = await fetchErpVersionMajor({ fetchImpl: deps.fetchImpl, creds: deps.creds, siteUrl: deps.siteUrl });

  if (!SUPPORTED_VERSION_MAJORS.includes(versionMajor)) {
    return { versionMajor, activatedAt: null, config: {} };
  }
```
(keeping the `readPermScope` block exactly as it is), and replace the `const config: ErpBindingConfig = {…}`
literal with:
```ts
  const config = companyDefaultsFromDoc(companyDoc, deps.company);
```
Delete the now-unused `const clientDeps` only if nothing else in the function uses it — the
`assertErpReadPermissions` call and `getDoc` both do, so **keep it**.
**Verify:** `cd $WT/pmo-portal && npx vitest run src/lib/adapterSeam/erpnext/binding.test.ts` — all green,
including the inverted v16 case and the untouched v14 case.

### Task 2.5 — mutation check the TS layer
Set `SUPPORTED_VERSION_MAJORS = [15]`; the v16 case and the `toEqual([15,16])` assertion must both go red.
Set it to `[14,15,16]`; the v14 case must go red. Revert.
**Verify:** `cd $WT/pmo-portal && npx vitest run src/lib/adapterSeam/erpnext/binding.test.ts` red for each,
green after `git checkout -- src/lib/adapterSeam/erpnext/binding.ts`.

### Task 2.6 — Deno can still typecheck the seam
**Verify:** `cd $WT/pmo-portal && npm run typecheck && npm run typecheck:edge` — zero errors. (`binding.ts`
is now imported by an edge function in Phase 4; this catches a `.ts`-extension or type-only-import slip
before it becomes a boot-time crash — the class `scripts/deno-boot-smoke.ts` exists for.)

---

## Phase 3 — connect persists the site URL

### Task 3.1 — RED: AC-EAC-101
Append to `supabase/functions/external-connect/connect.test.ts` (inside the ERPNext describe block,
reusing that file's existing `withFetchMock` / `supabaseSelect` / `supabaseRpc` / `erp` / `authed`
helpers exactly as its neighbouring ERPNext cases do):
```ts
  it('AC-EAC-101 an ERPNext connect persists the submitted site URL', async () => {
    await withFetchMock(
      [
        supabaseSelect('profiles', () => jsonResponse({ org_id: 'org-1', role: 'Admin' },
          { headers: { 'content-type': 'application/vnd.pgrst.object+json' } })),
        supabaseSelect('platform_operators', () => new Response('null',
          { status: 200, headers: { 'content-type': 'application/json' } })),
        erp('erp.example.com', '/api/method/frappe.auth.get_logged_user',
          () => jsonResponse({ message: 'erp-user@example.com' })),
        supabaseRpc('create_vault_secret_for_org', () => jsonResponse('erpnext_token_org-1_1')),
        supabaseRpc('set_external_binding_site_url', (call) => {
          const body = call.bodyJson as Record<string, unknown>;
          assertEquals(body.p_site_url, 'https://erp.example.com');
          assertEquals(body.p_external_tier, 'erpnext');
          return jsonResponse('set');
        }),
      ],
      async ({ calls }) => {
        const res = await handleConnectRequest(await authed({
          tier: 'erpnext',
          credential: { siteUrl: 'https://erp.example.com', apiKey: 'k', apiSecret: 's' },
        }));
        assertEquals(res.status, 200);
        assertEquals(rpcCall(calls, 'set_external_binding_site_url').length, 1);
      },
    );
  });
```
**Verify:** `cd $WT/supabase/functions/external-connect && deno test . --config deno.json --allow-env --allow-net --allow-read`
— RED (`set_external_binding_site_url` is never called).

### Task 3.2 — RED: AC-EAC-102
Append the failure case:
```ts
  it('AC-EAC-102 a failed site-URL persist returns 500 SITE_URL_NOT_PERSISTED and activates nothing', async () => {
    await withFetchMock(
      [
        supabaseSelect('profiles', () => jsonResponse({ org_id: 'org-1', role: 'Admin' },
          { headers: { 'content-type': 'application/vnd.pgrst.object+json' } })),
        supabaseSelect('platform_operators', () => new Response('null',
          { status: 200, headers: { 'content-type': 'application/json' } })),
        erp('erp.example.com', '/api/method/frappe.auth.get_logged_user',
          () => jsonResponse({ message: 'erp-user@example.com' })),
        supabaseRpc('create_vault_secret_for_org', () => jsonResponse('erpnext_token_org-1_1')),
        supabaseRpc('set_external_binding_site_url', () =>
          jsonResponse({ message: 'no active binding for this org and tier', code: 'P0001' }, { status: 400 })),
      ],
      async ({ calls }) => {
        const res = await handleConnectRequest(await authed({
          tier: 'erpnext',
          credential: { siteUrl: 'https://erp.example.com', apiKey: 'k', apiSecret: 's' },
        }));
        assertEquals(res.status, 500);
        assertEquals((await res.json()).error, 'SITE_URL_NOT_PERSISTED');
        // Deliberately NO compensating delete on the ERPNext branch (ADR-0073 consequences):
        // cleanup_external_connect_attempt would DELETE the org's one live binding on a failed rotate.
        assertEquals(rpcCall(calls, 'cleanup_external_connect_attempt').length, 0);
        assertEquals(rpcCall(calls, 'delete_vault_secret').length, 0);
      },
    );
  });
```
**Verify:** same deno command — RED.

### Task 3.3 — GREEN: wire the RPC into the ERPNext branch
In `supabase/functions/external-connect/index.ts`, immediately after the `if (rpcError) { … }` block
(step 7) and **before** the `if (tier === 'clickup')` block, insert:
```ts
  // 7b. FR-EAC-101 — persist the site URL the admin submitted. `create_vault_secret_for_org` writes
  // `site_url = ''` (mig 0180) and its signature is on production, so this is a second, additive RPC
  // rather than a parameter change (ADR-0073 §1: a dropped 5-arg overload would PGRST202 the deployed
  // connect path during the deploy window).
  if (tier === 'erpnext') {
    const { error: siteUrlError } = await serviceClient.rpc('set_external_binding_site_url', {
      p_org_id: profile.org_id,
      p_external_tier: 'erpnext',
      p_site_url: credential.siteUrl!,
      p_actor_id: userId,
    });
    if (siteUrlError) {
      // No compensating delete: the binding is left with `site_url = ''`, which external-set-company
      // (FR-EAC-103) and activate_external_binding's own guard both refuse. The partial state is inert,
      // and a retry of Connect rotates it. See ADR-0073 "Costs and risks accepted".
      console.error('set_external_binding_site_url failed', siteUrlError);
      return errorResponse(
        'The ERPNext site URL could not be saved; no connection was activated. Please try connecting again.',
        'SITE_URL_NOT_PERSISTED', 500);
    }
  }
```
**Verify:** `cd $WT/supabase/functions/external-connect && deno test . --config deno.json --allow-env --allow-net --allow-read`
— both new cases green, every pre-existing case still green.

### Task 3.4 — mutation check the connect wiring
Delete the `if (siteUrlError)` branch body (return the success path regardless) → AC-EAC-102 must go red.
Change `p_site_url: credential.siteUrl!` to `p_site_url: ''` → AC-EAC-101 must go red. Revert both.
**Verify:** same deno command red for each, green after `git checkout -- index.ts`.

---

## Phase 4 — Company selection IS activation

### Task 4.1 — RED: AC-EAC-104 (empty site URL refuses before any external call)
Append to `supabase/functions/external-set-company/set-company.test.ts`:
```ts
  it('AC-EAC-104 an empty site_url refuses Company selection before any external call', async () => {
    await withFetchMock(
      [
        supabaseSelect('profiles', () => jsonResponse({ org_id: 'org-1', role: 'Admin' },
          { headers: { 'content-type': 'application/vnd.pgrst.object+json' } })),
        supabaseSelect('platform_operators', () => new Response('null',
          { status: 200, headers: { 'content-type': 'application/json' } })),
        supabaseSelect('external_org_bindings', () =>
          jsonResponse({ secret_ref: 'vault-ref', status: 'active', config: {}, site_url: '' },
            { headers: { 'content-type': 'application/vnd.pgrst.object+json' } })),
      ],
      async ({ calls }) => {
        const res = await handleSetCompanyRequest(await authed({ tier: 'erpnext', companyId: 'ACME' }));
        assertEquals(res.status, 422);
        assertEquals((await res.json()).error, 'CONFIG_REJECTED');
        assertEquals(rpcCall(calls, 'read_vault_secret').length, 0);
        assertEquals(rpcCall(calls, 'activate_external_binding').length, 0);
        assertEquals(calls.filter((c) => c.url.host === 'erp.example.com').length, 0);
      },
    );
  });
```
**Verify:** `cd $WT/supabase/functions/external-set-company && deno test . --config deno.json --allow-env --allow-net --allow-read`
— RED (today it proceeds and 502s).

### Task 4.2 — RED: AC-EAC-106 (unsupported major)
Append:
```ts
  it('AC-EAC-106 an unsupported ERPNext major refuses with a legible 422 and writes nothing', async () => {
    await withFetchMock(
      [
        supabaseSelect('profiles', () => jsonResponse({ org_id: 'org-1', role: 'Admin' },
          { headers: { 'content-type': 'application/vnd.pgrst.object+json' } })),
        supabaseSelect('platform_operators', () => new Response('null',
          { status: 200, headers: { 'content-type': 'application/json' } })),
        supabaseSelect('external_org_bindings', () =>
          jsonResponse({ secret_ref: 'vault-ref', status: 'active', config: {}, site_url: 'https://erp.example.com' },
            { headers: { 'content-type': 'application/vnd.pgrst.object+json' } })),
        supabaseRpc('read_vault_secret', () => jsonResponse('test-key:test-secret')),
        erp('erp.example.com', '/api/resource/Company/ACME', () => jsonResponse({ data: { name: 'ACME' } })),
        erp('erp.example.com', '/api/method/frappe.utils.change_log.get_versions',
          () => jsonResponse({ erpnext: { version: '14.30.1' } })),
      ],
      async ({ calls }) => {
        const res = await handleSetCompanyRequest(await authed({ tier: 'erpnext', companyId: 'ACME' }));
        assertEquals(res.status, 422);
        const body = await res.json();
        assertEquals(body.error, 'config-rejected');
        assert(body.message.includes('14'));
        assert(body.message.includes('15 and 16'));
        assertEquals(rpcCall(calls, 'activate_external_binding').length, 0);
        assertEquals(rpcCall(calls, 'log_audit').length, 0);
        assertEquals(restCall(calls, 'external_org_bindings', 'PATCH').length, 0);
      },
    );
  });
```
Add `assert` to the `@std/assert` import at the top of the file.
**Verify:** same deno command — RED.

### Task 4.3 — RED: AC-EAC-105, AC-EAC-107, AC-EAC-108
Append the three positive cases (v15 with defaults, v16, and the ordering oracle):
```ts
  it('AC-EAC-107 a v15 handshake activates with the Company account defaults', async () => {
    await withFetchMock(
      [
        supabaseSelect('profiles', () => jsonResponse({ org_id: 'org-1', role: 'Admin' },
          { headers: { 'content-type': 'application/vnd.pgrst.object+json' } })),
        supabaseSelect('platform_operators', () => new Response('null',
          { status: 200, headers: { 'content-type': 'application/json' } })),
        supabaseSelect('external_org_bindings', () =>
          jsonResponse({ secret_ref: 'vault-ref', status: 'active', config: {}, site_url: 'https://erp.example.com' },
            { headers: { 'content-type': 'application/vnd.pgrst.object+json' } })),
        supabaseRpc('read_vault_secret', () => jsonResponse('test-key:test-secret')),
        erp('erp.example.com', '/api/resource/Company/ACME', () => jsonResponse({
          data: { name: 'ACME', default_payable_account: 'Creditors - A', default_cash_account: 'Cash - A' },
        })),
        erp('erp.example.com', '/api/method/frappe.utils.change_log.get_versions',
          () => jsonResponse({ erpnext: { version: '15.94.3' } })),
        supabaseRpc('activate_external_binding', (call) => {
          const body = call.bodyJson as Record<string, unknown>;
          assertEquals(body.p_version_major, 15);
          assertEquals(body.p_company, 'ACME');
          const patch = body.p_config_patch as Record<string, unknown>;
          assertEquals(patch.default_payable_account, 'Creditors - A');
          assertEquals(patch.default_cash_account, 'Cash - A');
          assertEquals(patch.default_bank_account, null);
          return jsonResponse('2026-09-14T00:00:00+00:00');
        }),
        supabaseRpc('log_audit', () => jsonResponse(null)),
      ],
      async ({ calls }) => {
        const res = await handleSetCompanyRequest(await authed({ tier: 'erpnext', companyId: 'ACME' }));
        assertEquals(res.status, 200);
        assertEquals(await res.json(), {
          ok: true, companyId: 'ACME', versionMajor: 15, activatedAt: '2026-09-14T00:00:00+00:00',
        });
        assertEquals(rpcCall(calls, 'activate_external_binding').length, 1);
        // AC-EAC-105: the write moved into the RPC — there is no direct PATCH any more.
        assertEquals(restCall(calls, 'external_org_bindings', 'PATCH').length, 0);
        // AC-EAC-105: Company validation precedes the handshake, which precedes the write.
        const order = calls.map((c) => c.url.pathname);
        assert(order.indexOf('/api/resource/Company/ACME')
             < order.indexOf('/api/method/frappe.utils.change_log.get_versions'));
        assert(order.indexOf('/api/method/frappe.utils.change_log.get_versions')
             < order.indexOf('/rest/v1/rpc/activate_external_binding'));
      },
    );
  });

  it('AC-EAC-108 a v16 handshake activates (DD-OPS-10 — RIS targets v16.33)', async () => {
    await withFetchMock(
      [
        supabaseSelect('profiles', () => jsonResponse({ org_id: 'org-1', role: 'Admin' },
          { headers: { 'content-type': 'application/vnd.pgrst.object+json' } })),
        supabaseSelect('platform_operators', () => new Response('null',
          { status: 200, headers: { 'content-type': 'application/json' } })),
        supabaseSelect('external_org_bindings', () =>
          jsonResponse({ secret_ref: 'vault-ref', status: 'active', config: {}, site_url: 'https://erp.example.com' },
            { headers: { 'content-type': 'application/vnd.pgrst.object+json' } })),
        supabaseRpc('read_vault_secret', () => jsonResponse('test-key:test-secret')),
        erp('erp.example.com', '/api/resource/Company/ACME', () => jsonResponse({ data: { name: 'ACME' } })),
        erp('erp.example.com', '/api/method/frappe.utils.change_log.get_versions',
          () => jsonResponse({ erpnext: { version: '16.33.0' } })),
        supabaseRpc('activate_external_binding', (call) => {
          assertEquals((call.bodyJson as Record<string, unknown>).p_version_major, 16);
          return jsonResponse('2026-09-14T00:00:00+00:00');
        }),
        supabaseRpc('log_audit', () => jsonResponse(null)),
      ],
      async ({ calls }) => {
        const res = await handleSetCompanyRequest(await authed({ tier: 'erpnext', companyId: 'ACME' }));
        assertEquals(res.status, 200);
        assertEquals(rpcCall(calls, 'activate_external_binding').length, 1);
      },
    );
  });
```
**Verify:** same deno command — RED.

### Task 4.4 — update the four PATCH assertions (deliberate mechanism change)
In the four pre-existing cases that assert
`assertEquals(restCall(calls, 'external_org_bindings', 'PATCH').length, 1);`
("Admin OK — sets config.company", "Operator OK", and the two that assert `0` stay as-is), replace with
`assertEquals(rpcCall(calls, 'activate_external_binding').length, 1);`, and replace their
`{ label: 'update company config', method: 'PATCH', … }` mock route with
```ts
        supabaseRpc('activate_external_binding', (call) => {
          assertEquals((call.bodyJson as Record<string, unknown>).p_company, 'ACME Corp'); // or 'ACME'
          return jsonResponse('2026-09-14T00:00:00+00:00');
        }),
```
plus the two `erp(... '/api/method/frappe.utils.change_log.get_versions', …)` routes each case now needs.
The goal oracle (the selected Company is persisted for this org) is preserved — only the mechanism moved.
**Verify:** same deno command — still RED, now uniformly on "activate_external_binding never called".

### Task 4.5 — GREEN part 1: `validateErpNextCompany` returns the doc
In `supabase/functions/external-set-company/index.ts`, change the signature to
`async function validateErpNextCompany(deps: ErpCompanyDeps, companyId: string): Promise<Record<string, unknown>>`
and, in the success path, replace the bare `if (!res.ok) { … }` tail with:
```ts
    if (!res.ok) {
      if (res.status === 404) {
        throw new AppError('Company not found in ERPNext', 'NOT_FOUND');
      }
      throw new AppError('Failed to validate ERPNext company', 'external-unreachable');
    }
    // FR-EAC-106: the Company doc is the source of the account defaults `bodies/paymentEntry.ts` reads.
    // Frappe wraps a single doc as `{ data: {...} }`; tolerate an unwrapped body too.
    const body = (await res.json()) as { data?: Record<string, unknown> } & Record<string, unknown>;
    return (body.data ?? body) as Record<string, unknown>;
```
Keep the surrounding `try/catch` and the SSRF/HTTPS guards byte-for-byte.
**Verify:** `cd $WT/pmo-portal && npm run typecheck:edge` — zero errors.

### Task 4.6 — GREEN part 2: the site-URL guard
In `handleSetCompanyRequest`, immediately after the `if (binding.status !== 'active')` block, insert:
```ts
  // FR-EAC-103 — `create_vault_secret_for_org` writes `site_url = ''` (mig 0180). Without this guard the
  // handler would build `'/api/resource/Company/…'` against an empty base and fail as `external-unreachable`,
  // which tells the admin nothing about what to do.
  if (!binding.site_url || String(binding.site_url).trim() === '') {
    return errorResponse(
      'This ERPNext connection has no site URL. Disconnect and connect again to continue.',
      'CONFIG_REJECTED', 422);
  }
```
**Verify:** `cd $WT/supabase/functions/external-set-company && deno test . --config deno.json --allow-env --allow-net --allow-read`
— AC-EAC-104 green.

### Task 4.7 — GREEN part 3: the handshake + the activation RPC
Add to the imports at the top of `external-set-company/index.ts`:
```ts
import {
  fetchErpVersionMajor,
  companyDefaultsFromDoc,
  SUPPORTED_VERSION_MAJORS,
} from '../../../pmo-portal/src/lib/adapterSeam/erpnext/binding.ts';
```
Change step 8's call site to capture the doc:
```ts
  let companyDoc: Record<string, unknown>;
  try {
    companyDoc = await validateErpNextCompany({
      fetchImpl: fetch, siteUrl: binding.site_url, apiKey, apiSecret,
    }, companyId);
  } catch (err) { /* …unchanged… */ }
```
Then replace step 9 (`const currentConfig = …` through the `if (updateError)` block) with:
```ts
  // 9. FR-EAC-104/105 — the version handshake, BEFORE any write. OD-INT-6 makes Company selection the
  // activation event; DD-OPS-10 makes {15, 16} the supported set.
  let versionMajor: number;
  try {
    versionMajor = await fetchErpVersionMajor({
      fetchImpl: fetch, creds: { apiKey, apiSecret }, siteUrl: binding.site_url,
    });
  } catch (err) {
    console.error('erpnext version handshake failed', err);
    return errorResponse(
      'Could not read the ERPNext version from that site; no connection was activated.',
      'external-unreachable', 502);
  }

  if (!SUPPORTED_VERSION_MAJORS.includes(versionMajor)) {
    return errorResponse(
      `ERPNext ${versionMajor} is not supported (PMO supports 15 and 16). No connection was activated.`,
      'config-rejected', 422);
  }

  // 10. FR-EAC-106/107 — ONE statement: version + company + Company account defaults + the set-once
  // stamp. Replaces the direct PATCH so activation cannot land partially.
  const { data: activatedAt, error: activateError } = await serviceClient.rpc('activate_external_binding', {
    p_org_id: profile.org_id,
    p_external_tier: 'erpnext',
    p_version_major: versionMajor,
    p_company: companyId,
    p_config_patch: companyDefaultsFromDoc(companyDoc, companyId),
    p_actor_id: userId,
  });
  if (activateError) {
    console.error('activate_external_binding failed', activateError);
    return errorResponse('Failed to activate the ERPNext connection', 'INTERNAL', 500);
  }
```
Extend the existing `log_audit` detail with `version_major: versionMajor, activated_at: activatedAt`
and change the final return to
`return json({ ok: true, companyId, versionMajor, activatedAt });`.
Update the `SetCompanyResponse` interface to `{ ok: true; companyId: string; versionMajor: number; activatedAt: string | null }`
and the file's header comment (the numbered flow) to match.
**Verify:** `cd $WT/supabase/functions/external-set-company && deno test . --config deno.json --allow-env --allow-net --allow-read`
— the whole suite green.

### Task 4.8 — mutation check the set-company layer
1. Delete the `SUPPORTED_VERSION_MAJORS.includes` branch → AC-EAC-106 must go red.
2. Move the `fetchErpVersionMajor` call to *after* the `activate_external_binding` call → AC-EAC-105's
   ordering assertion must go red.
3. Delete the `!binding.site_url` guard → AC-EAC-104 must go red.
4. Change `p_config_patch` to `{}` → AC-EAC-107's account-default assertions must go red.
Revert after each.
**Verify:** the deno command red for each, green after `git checkout -- index.ts`.

### Task 4.9 — the whole edge-fn suite still binds and passes
**Verify:** `cd $WT && bash scripts/deno-test-edge-fns.sh` and
`cd $WT/pmo-portal && npm run check:edge-test-binding` — both green (7/7 comes in Phase 5).

---

## Phase 5 — disconnect un-activates (and gets a real test)

### Task 5.1 — export the shipped handler
In `supabase/functions/external-disconnect/index.ts`, change
`serveWithErrorReporting('external-disconnect', async (req: Request): Promise<Response> => {` … `});`
into a named export plus a guarded serve:
```ts
export async function handleDisconnectRequest(req: Request): Promise<Response> {
```
…(body unchanged)…
```ts
}

// Deno.serve entry point (only runs when module is main)
if (import.meta.main) {
  serveWithErrorReporting('external-disconnect', handleDisconnectRequest);
}
```
Also add the two test hooks the other fns carry, so a suite can bind without starting timers:
```ts
export function setTestJwks(resolver: JwksResolver): void { _jwks = resolver; }
export const testSupabaseOptions = {
  auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
};
```
and pass `testSupabaseOptions` as the third argument of the `createClient(...)` call at step 2.
**Verify:** `cd $WT/pmo-portal && npm run typecheck:edge` — zero errors.

### Task 5.2 — RED: add disconnect to the binding guard
In `scripts/check-edge-fn-test-binding.mjs`, add to `REQUIRED`:
```js
  'supabase/functions/external-disconnect/disconnect.test.ts': 'handleDisconnectRequest',
```
and change the final success line to `console.log('✓ edge-fn tests bind to shipped handlers (7/7)');`.
**Verify:** `cd $WT/pmo-portal && npm run check:edge-test-binding` — RED
("must import the SHIPPED handler"). That is AC-EAC-117's failing oracle.

### Task 5.3 — RED: rewrite `disconnect.test.ts` against the shipped handler
Replace the whole of `supabase/functions/external-disconnect/disconnect.test.ts` with an edgeTestKit
suite modelled exactly on `set-company.test.ts`'s preamble:
```ts
/**
 * external-disconnect — Deno unit tests against the SHIPPED handler.
 * AC-EAC-114 (stamps cleared), AC-EAC-117 (binds to shipped code), AC-EAC-118 (audit args).
 */
import { describe, it, afterAll } from '@std/testing/bdd';
import { assertEquals } from '@std/assert';
import { handleDisconnectRequest, setTestJwks } from './index.ts';
import {
  createJwtAuthority, installEdgeEnv, withFetchMock, supabaseRpc, supabaseSelect,
  restCall, rpcCall, jsonResponse, createAuthedRequest, createTestJwksResolver,
} from '../_shared/testing/edgeTestKit.ts';

const env = installEdgeEnv();
const auth = await createJwtAuthority(env.SUPABASE_URL);
setTestJwks(createTestJwksResolver(auth));
afterAll(() => env.restore());

async function authed(body: unknown, sub = 'user-1') {
  return createAuthedRequest('http://edge.test/disconnect', body, await auth.mintJwt({ sub }));
}

const adminProfile = () => supabaseSelect('profiles', () =>
  jsonResponse({ org_id: 'org-1', role: 'Admin' },
    { headers: { 'content-type': 'application/vnd.pgrst.object+json' } }));
const notOperator = () => supabaseSelect('platform_operators', () =>
  new Response('null', { status: 200, headers: { 'content-type': 'application/json' } }));

describe('external-disconnect', () => {
  it('AC-EAC-114 an ERPNext disconnect clears the activation stamps via the RPC, not a PATCH', async () => {
    await withFetchMock(
      [
        adminProfile(), notOperator(),
        supabaseSelect('external_org_bindings', () =>
          jsonResponse({ secret_ref: 'vault-ref', webhook_secret_ref: null },
            { headers: { 'content-type': 'application/vnd.pgrst.object+json' } })),
        supabaseRpc('delete_vault_secret', () => jsonResponse(null)),
        supabaseRpc('deactivate_external_binding', (call) => {
          const body = call.bodyJson as Record<string, unknown>;
          assertEquals(body.p_external_tier, 'erpnext');
          assertEquals(body.p_actor_id, 'user-1');
          return jsonResponse(1);
        }),
        supabaseRpc('log_audit', (call) => {
          const body = call.bodyJson as Record<string, unknown>;
          // AC-EAC-118: log_audit(text,uuid,uuid,uuid,jsonb) — p_actor_id is REQUIRED and there is no
          // p_entity_type parameter. The shipped call passed p_entity_type and omitted p_actor_id, so
          // no overload matched and the disconnect audit event was never written.
          assertEquals(body.p_action, 'integration.disconnect');
          assertEquals(body.p_actor_id, 'user-1');
          assertEquals('p_entity_type' in body, false);
          return jsonResponse(null);
        }),
      ],
      async ({ calls }) => {
        const res = await handleDisconnectRequest(await authed({ tier: 'erpnext' }));
        assertEquals(res.status, 200);
        assertEquals(rpcCall(calls, 'deactivate_external_binding').length, 1);
        assertEquals(restCall(calls, 'external_org_bindings', 'PATCH').length, 0);
        assertEquals(rpcCall(calls, 'log_audit').length, 1);
      },
    );
  });

  it('AC-EAC-117 an Engineer is refused with 403 and no side effect', async () => {
    await withFetchMock(
      [
        supabaseSelect('profiles', () => jsonResponse({ org_id: 'org-1', role: 'Engineer' },
          { headers: { 'content-type': 'application/vnd.pgrst.object+json' } })),
        notOperator(),
      ],
      async ({ calls }) => {
        const res = await handleDisconnectRequest(await authed({ tier: 'erpnext' }));
        assertEquals(res.status, 403);
        assertEquals(rpcCall(calls, 'delete_vault_secret').length, 0);
        assertEquals(rpcCall(calls, 'deactivate_external_binding').length, 0);
      },
    );
  });

  it('AC-EAC-117 a missing binding returns 404 before any write', async () => {
    await withFetchMock(
      [
        adminProfile(), notOperator(),
        supabaseSelect('external_org_bindings', () =>
          new Response('null', { status: 200, headers: { 'content-type': 'application/json' } })),
      ],
      async ({ calls }) => {
        const res = await handleDisconnectRequest(await authed({ tier: 'erpnext' }));
        assertEquals(res.status, 404);
        assertEquals(rpcCall(calls, 'deactivate_external_binding').length, 0);
      },
    );
  });
});
```
Create `supabase/functions/external-disconnect/deno.json` matching `external-set-company/deno.json`
verbatim if it does not already carry `@std/testing/bdd`.
**Verify:** `cd $WT/pmo-portal && npm run check:edge-test-binding` — 7/7 green;
`cd $WT/supabase/functions/external-disconnect && deno test . --config deno.json --allow-env --allow-net --allow-read`
— RED (the handler still PATCHes and still passes `p_entity_type`).

### Task 5.4 — GREEN: swap the PATCH for the RPC and fix the audit args
In `external-disconnect/index.ts`, replace step 8 (the `.from('external_org_bindings').update({…})`
block) with:
```ts
  // 8. FR-EAC-108 — soft-archive AND un-activate in ONE statement. The sweep's employ predicates
  // (erpnext-sweep listEmployingOrgsLive, org_has_active_erpnext_binding mig 0160) read `activated_at`
  // and never read `status`, so leaving the stamp kept a disconnected org "employing".
  const { data: touched, error: deactivateError } = await serviceClient.rpc('deactivate_external_binding', {
    p_org_id: profile.org_id,
    p_external_tier: tier,
    p_actor_id: userId,
  });
  if (deactivateError) {
    console.error('deactivate_external_binding failed', deactivateError);
    return errorResponse('Failed to update binding', 'INTERNAL', 500);
  }
  if (touched === 0) {
    return errorResponse('No binding found for this tier', 'NOT_FOUND', 404);
  }
```
and replace step 10's `log_audit` argument object with:
```ts
  const { error: auditError } = await serviceClient.rpc('log_audit', {
    p_action: 'integration.disconnect',
    p_org_id: profile.org_id,
    // ⚑ log_audit is (p_action, p_org_id, p_actor_id, p_entity_id, p_detail) — mig 0076. The previous
    // call passed `p_entity_type` (no such parameter) and omitted `p_actor_id`, so no overload matched
    // and this audit event was never written.
    p_actor_id: userId,
    p_entity_id: null,
    p_detail: { tier, actor: userId },
  });
```
**Verify:** `cd $WT/supabase/functions/external-disconnect && deno test . --config deno.json --allow-env --allow-net --allow-read`
— green.

### Task 5.5 — mutation check the disconnect layer
Restore the old `p_entity_type` argument shape → AC-EAC-118's assertion must go red.
Replace the RPC with the old direct `.update({ status, disconnected_at })` → AC-EAC-114's
`PATCH === 0` / `deactivate === 1` pair must go red. Revert both.
**Verify:** the deno command red for each, green after `git checkout -- index.ts`.

---

## Phase 6 — the admin sees why (FE seam only)

### Task 6.1 — RED: AC-EAC-115
Create `pmo-portal/src/lib/repositories/integrations.setCompany.test.ts`:
```ts
/**
 * AC-EAC-115 — the Company-selection seam surfaces the edge function's own message.
 * `FunctionsHttpError` does not parse the body; without this the admin sees
 * "Edge Function returned a non-2xx status code" instead of the reason activation was refused.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { AppError } from '@/src/lib/appError';

const invoke = vi.fn();
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } } }));

function httpError(status: number, body: unknown) {
  const err = new Error('Edge Function returned a non-2xx status code') as Error & { context?: Response };
  err.context = new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json' },
  });
  return err;
}

describe('repositories.integrations.setCompany', () => {
  beforeEach(() => { invoke.mockReset(); });

  it('AC-EAC-115 surfaces the endpoint message and code on a 422', async () => {
    const { repositories } = await import('./index');
    invoke.mockResolvedValue({
      data: null,
      error: httpError(422, {
        error: 'config-rejected',
        message: 'ERPNext 14 is not supported (PMO supports 15 and 16). No connection was activated.',
      }),
    });
    await expect(repositories.integrations.setCompany('org-1', 'erpnext', 'ACME')).rejects.toMatchObject({
      message: 'ERPNext 14 is not supported (PMO supports 15 and 16). No connection was activated.',
      code: 'config-rejected',
    });
  });

  it('AC-EAC-115 a network failure (no .context) still throws an AppError', async () => {
    const { repositories } = await import('./index');
    invoke.mockResolvedValue({ data: null, error: new Error('Failed to send a request to the Edge Function') });
    await expect(repositories.integrations.setCompany('org-1', 'erpnext', 'ACME')).rejects.toBeInstanceOf(AppError);
  });
});
```
⚑ Before running, confirm the supabase-client module specifier this file must mock by reading the import
at the top of `pmo-portal/src/lib/repositories/index.ts` and matching it exactly.
**Verify:** `cd $WT/pmo-portal && npx vitest run src/lib/repositories/integrations.setCompany.test.ts` — RED.

### Task 6.2 — GREEN: read the error body in the repository
In `pmo-portal/src/lib/repositories/index.ts`, add near the other local helpers:
```ts
/** `FunctionsHttpError` carries the edge fn's JSON body on `.context: Response` but never parses it —
 *  the same pattern as `m365/connectClient.ts`, `db/adminUsers.ts` and `adapterSeam/dispatchClient.ts`.
 *  Without this the admin sees "Edge Function returned a non-2xx status code" instead of the reason. */
async function throwInvokeError(error: unknown): Promise<never> {
  const context = (error as { context?: Response } | null | undefined)?.context;
  if (context && typeof context.clone === 'function') {
    try {
      const body = (await context.clone().json()) as { error?: string; message?: string };
      if (typeof body.message === 'string' && body.message.trim() !== '') {
        throw new AppError(body.message, body.error);
      }
    } catch (parsed) {
      if (parsed instanceof AppError) throw parsed;
    }
  }
  throw toAppError(error);
}
```
and change `setCompany`'s `if (error) throw error;` to `if (error) await throwInvokeError(error);`.
Ensure `AppError` and `toAppError` are imported from `@/src/lib/appError` in this file (add to the
existing import if absent).
**Verify:** `cd $WT/pmo-portal && npx vitest run src/lib/repositories/integrations.setCompany.test.ts` — green.

### Task 6.3 — confirm the dialog renders it, without touching the component
`IntegrationsView.handleSetCompanySubmit` already does
`const { detail } = classifyMutationError(err); setSetCompanyError(detail);`, and
`classifyMutationError` falls back to `err.message` for any code outside `POSTGRES_GENERATED_DETAIL`
(`config-rejected` is not in it). No component change is expected.
**Verify:** `cd $WT/pmo-portal && npx vitest run src/components/integrations/IntegrationsView.test.tsx`
— green with no edit. If it is not, the smallest fix is in the component's error branch, **not** in the
test.

### Task 6.4 — mutation check the FE seam
Revert `setCompany` to `if (error) throw error;` → AC-EAC-115's first case must go red. Restore.
**Verify:** `cd $WT/pmo-portal && npx vitest run src/lib/repositories/integrations.setCompany.test.ts`.

---

## Phase 7 — full gates

### Task 7.1 — the whole verify suite
**Verify:** `cd $WT/pmo-portal && npm run verify:locked`
(read `package.json`'s `verify` for the current gate list — it grows; do not trust a count written here).
Zero errors, zero ESLint warnings. This is binding **before** any push: targeted runs miss cross-component
breakage.

### Task 7.2 — the whole pgTAP suite, chained under one lock
**Verify:** `cd $WT && scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db'` — every
file green, including `external_admin_connect_rls.test.sql` and
`integration_enablement_atomic_recovery.test.sql`, which touch the same table and the same RPC family.

### Task 7.3 — the edge-function suites and the boot smoke
**Verify:**
```bash
cd $WT && bash scripts/deno-test-edge-fns.sh
cd $WT && deno run --allow-read --allow-env scripts/deno-boot-smoke.ts
```
The boot smoke matters here: `external-set-company` now imports `binding.ts` → `client.ts` →
`contract.ts` across the pmo-portal seam, and a circular import in that chain TDZ-crashes the deployed
worker while `deno check` and Vitest both pass.

### Task 7.4 — the e2e lanes that share the binding row
**Verify:** `cd $WT && scripts/with-db-lock.sh npm --prefix pmo-portal run e2e`
(`npm run e2e`, never bare `npx playwright test` — the latter silently skips the `serial` lane, which is
where `_tspHelpers.upsertTspBinding` lives). Nothing in this plan blocks a service-role write to
`external_org_bindings`, so these should be unaffected; a red here means an unintended constraint slipped in.

### Task 7.5 — record the outcome
Append to `docs/backlog.md` under the current-state block: `#650` shipped, migration `0216` on `dev`,
cloud DB unchanged (a prod push is a separate, per-instance, owner-gated action). Note the two open
questions from spec §7.6 so the Director sees them without re-reading the spec.

---

## Traceability

| AC | Requirement | Owning layer | Owning file | Task |
|---|---|---|---|---|
| AC-EAC-101 | FR-EAC-101 | Deno unit | `supabase/functions/external-connect/connect.test.ts` | 3.1, 3.3 |
| AC-EAC-102 | FR-EAC-101 | Deno unit | `supabase/functions/external-connect/connect.test.ts` | 3.2, 3.3 |
| AC-EAC-103 | FR-EAC-102 | pgTAP | `supabase/tests/erpnext_activation.test.sql` | 1.8, 1.10 |
| AC-EAC-104 | FR-EAC-103 | Deno unit | `supabase/functions/external-set-company/set-company.test.ts` | 4.1, 4.6 |
| AC-EAC-105 | FR-EAC-104, FR-EAC-106 | Deno unit | `set-company.test.ts` | 4.3, 4.7 |
| AC-EAC-106 | FR-EAC-105 | Deno unit | `set-company.test.ts` | 4.2, 4.7 |
| AC-EAC-107 | FR-EAC-106 | Deno unit | `set-company.test.ts` | 4.3, 4.7 |
| AC-EAC-108 | FR-EAC-105 (v16) | Deno unit | `set-company.test.ts` | 4.3, 4.7 |
| AC-EAC-109 | FR-EAC-107 | pgTAP | `erpnext_activation.test.sql` | 1.9 |
| AC-EAC-110 | FR-EAC-106 | pgTAP | `erpnext_activation.test.sql` | 1.8 |
| AC-EAC-111 | FR-EAC-110 | pgTAP | `erpnext_activation.test.sql` | 1.8 |
| AC-EAC-112 | FR-EAC-109, NFR-EAC-SEC-102 | pgTAP | `erpnext_activation.test.sql` | 1.3, 1.7, 1.12 |
| AC-EAC-113 | NFR-EAC-SEC-103 | pgTAP | `erpnext_activation.test.sql` | 1.2 |
| AC-EAC-114 | FR-EAC-108 | pgTAP + Deno unit | `erpnext_activation.test.sql` (owning), `disconnect.test.ts` (wiring) | 1.11, 5.4 |
| AC-EAC-115 | FR-EAC-111 | Vitest | `pmo-portal/src/lib/repositories/integrations.setCompany.test.ts` | 6.1, 6.2 |
| AC-EAC-116 | FR-EAC-104, FR-EAC-110 | Vitest | `pmo-portal/src/lib/adapterSeam/erpnext/binding.test.ts` | 2.1–2.4 |
| AC-EAC-117 | (process gate) | Verify gate + Deno unit | `scripts/check-edge-fn-test-binding.mjs`, `disconnect.test.ts` | 5.2, 5.3 |
| AC-EAC-118 | NFR-EAC-OBS-001 | Deno unit | `disconnect.test.ts` | 5.3, 5.4 |

**No new Playwright journey.** Every AC above is owned at the lowest sufficient layer. The only genuinely
cross-stack proof — an admin connecting a real Frappe site and activating it — needs a live ERPNext bench,
which CI does not have; that proof is the owner-gated **#481** dry-run checklist, not a CI e2e. Coverage
is not lost: no AC was pushed up a layer, and none was dropped.

## Director rulings (2026-09-14, before build)

- **Premise 2 settled on the live v16.33 instance** (Administrator session, `GET Company/PMO Smoke Co`):
  `default_payable_account` ✓ (`Creditors - PSC`), `default_cash_account` ✓ (`Cash - PSC`),
  `default_expense_account` ✓ (`Cost of Goods Sold - PSC`), `cost_center` ✓ (`Main - PSC`) —
  **`default_bank_account` is ABSENT on v16** (not null-valued: the key is not on the doc). The mapper's
  "absent ⇒ `null`" rule therefore fires on every v16 activation for that one field. Phase 4 must include a test
  for exactly this shape (four keys present, one missing), and `bodies/paymentEntry.ts`'s reading of
  `config.default_bank_account` must treat `null` as "no default", never post `undefined` — verify by reading it;
  if it cannot, say so in the report rather than papering over it (the #481 dry-run will hit it).
- **Premise 3 settled:** `frappe.utils.change_log.get_versions` is `@frappe.whitelist()` on v16.33 (checked in the
  running container's `apps/frappe/frappe/utils/change_log.py:104`) — reachable for any authenticated API user,
  no System Manager needed.
- **Spec §7.6 Q1 (ClickUp rotate's destructive cleanup):** own issue after this lands; not touched here.
- **Spec §7.6 Q2 (Company account defaults):** **in scope** — Phase 4 stays. A binding whose first Payment Entry
  posts undefined accounts is not "connected".
- **ADR renumbered to 0073** (0072 was taken the same day by #651's ADR). References updated.
- **No restrictive policy / trigger** — agreed, for the reason the plan gives; Task 1.2's catalog-derived pgTAP
  assertion is the live layer's proof and is mandatory.
- **`activated_at = coalesce(activated_at, now())`** set-once, cleared only by disconnect or a site-URL repoint —
  agreed; it is `DD-XING-2`'s epoch and the sweep's floor.

## Rollout order (deploy hazard)

`0216` is purely additive (three new functions, no signature change), so **migration-before-function and
function-before-migration are both safe**:
- migration first, functions later ⇒ the new RPCs exist and nobody calls them;
- functions first, migration later ⇒ `set_external_binding_site_url` / `activate_external_binding` /
  `deactivate_external_binding` 404 as `PGRST202`, and each call site already returns a 500/422 with a
  retry instruction rather than reporting a working connection.

That property is the reason ADR-0073 rejected adding a parameter to `create_vault_secret_for_org`. Ship to
`dev` → `main` as usual; **the cloud DB and production are untouched and require a separate, explicit,
per-instance owner instruction.**
