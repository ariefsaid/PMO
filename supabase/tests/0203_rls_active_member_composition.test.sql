-- 0203_rls_active_member_composition.test.sql — the offboarding gate must be on every write policy,
-- and must STAY there. Migration under test: supabase/migrations/0203_rls_active_member_write_composition.sql.
--
-- ── WHAT THIS FILE IS ───────────────────────────────────────────────────────────────────────────
-- Two things, deliberately in one file:
--
--   (1) A **gate**. §1 is a standing, catalog-derived rule — not a list of today's tables. Any future
--       policy that drops the predicate reddens it, including on tables that do not exist yet.
--   (2) The **self-test for that gate** (§3), because a rule that silently matches nothing looks
--       exactly like a rule that passes. Both existing enforcement scripts in this repo have failed
--       for their own bugs; a gate is only worth what its own proof is worth.
--
-- ── THE RULE, AND WHY IT NEEDS NO ALLOWLIST ─────────────────────────────────────────────────────
--     If ANY policy on a public table references `is_active_member()`, then EVERY permissive policy
--     on that table must reference it.
--
-- The table itself declares whether it is in scope, so nothing has to be enumerated and no exception
-- list can rot. Measured against the pre-fix catalog this rule returned **exactly the six real
-- violations and nothing else** — a table that gates membership nowhere is simply not in scope, and a
-- table that gates it anywhere must gate it everywhere.
--
-- ⚑ It is deliberately NOT "every write policy must have it". That version needs an allowlist for
-- every legitimately ungated table, and an allowlist is the thing that goes stale and gets waved
-- through. The self-declaring form has no such surface.
--
-- ── ⚑ ONE ASSERTION PER POLICY, NOT A SAMPLE (0173's rule, and the same reason) ─────────────────
-- The defect IS inconsistent application — the SELECT policies carried the predicate and the writes
-- did not, on the same tables. A sampled proof reproduces exactly the gap it is meant to close, so §4
-- names all six individually even though §1 already covers them as a set.
-- ================================================================================================

begin;
select plan(21);

-- The detector, defined ONCE. A temporary view rather than repeated SQL text: §1 and §3 must exercise
-- the same expression, or the self-test proves a query that is not the gate.
create temporary view rls_am_violations as
with pol as (
  select tablename, policyname, cmd, permissive,
         (coalesce(qual,'') || coalesce(with_check,'')) like '%is_active_member%' as has_am
    from pg_policies
   where schemaname = 'public'),
tab as (
  select tablename, bool_or(has_am) as any_am from pol group by tablename)
select pol.tablename, pol.policyname, pol.cmd
  from pol join tab using (tablename)
 where tab.any_am
   and pol.permissive = 'PERMISSIVE'
   and not pol.has_am;

-- ── §1 — THE GATE ───────────────────────────────────────────────────────────────────────────────
select is_empty(
  'select tablename || ''.'' || policyname || '' ('' || cmd || '')'' from rls_am_violations',
  'AC-AMC-001 every table that gates active membership anywhere gates it on every permissive policy');

-- ── §2 — ANTI-VACUITY. A detector whose input is empty is not a passing detector. ───────────────
select ok(
  (select count(distinct tablename) from pg_policies
    where schemaname = 'public'
      and (coalesce(qual,'') || coalesce(with_check,'')) like '%is_active_member%') >= 20,
  'AC-AMC-002 at least 20 public tables reference is_active_member (the rule has real input)');

select ok(
  (select count(*) from pg_policies where schemaname = 'public' and permissive = 'PERMISSIVE') >= 100,
  'AC-AMC-003 at least 100 permissive policies exist in public (the rule scans a real catalog)');

-- ── §3 — SELF-TEST: the detector must actually detect, and must not over-detect ─────────────────
-- A throwaway table carrying the shape of the original defect: a read policy that gates membership
-- and a write policy that does not. Rolled back with the rest of the transaction.
create table public.zz_amc_control_violating (id uuid primary key default gen_random_uuid(), org_id uuid);
alter table public.zz_amc_control_violating enable row level security;
create policy zz_amc_control_violating_select on public.zz_amc_control_violating
  for select using (public.is_active_member());
create policy zz_amc_control_violating_insert on public.zz_amc_control_violating
  for insert with check (org_id is not null);   -- the planted defect: no membership predicate

select is(
  (select count(*)::int from rls_am_violations where tablename = 'zz_amc_control_violating'),
  1,
  'AC-AMC-004 SELF-TEST: the detector reports a planted write policy missing the predicate');

select is(
  (select policyname from rls_am_violations where tablename = 'zz_amc_control_violating'),
  'zz_amc_control_violating_insert',
  'AC-AMC-005 SELF-TEST: it reports the WRITE policy, not the compliant read policy');

-- The opposite polarity: a table whose policies all carry the predicate must NOT be reported. Without
-- this, a detector that flagged everything would pass AC-AMC-004 and fail nothing.
create table public.zz_amc_control_clean (id uuid primary key default gen_random_uuid(), org_id uuid);
alter table public.zz_amc_control_clean enable row level security;
create policy zz_amc_control_clean_select on public.zz_amc_control_clean
  for select using (public.is_active_member());
create policy zz_amc_control_clean_insert on public.zz_amc_control_clean
  for insert with check (public.is_active_member() and org_id is not null);

select is_empty(
  'select policyname from rls_am_violations where tablename = ''zz_amc_control_clean''',
  'AC-AMC-006 SELF-TEST: a fully-gated table is not reported (the detector is not vacuously positive)');

-- ── §4 — the six policies the migration fixed, named individually ───────────────────────────────
select ok((select bool_and((coalesce(qual,'') || coalesce(with_check,'')) like '%is_active_member%')
             from pg_policies where schemaname = 'public' and policyname = 'purchase_orders_insert'),
  'AC-AMC-007 purchase_orders_insert gates active membership');
select ok((select bool_and((coalesce(qual,'') || coalesce(with_check,'')) like '%is_active_member%')
             from pg_policies where schemaname = 'public' and policyname = 'purchase_orders_update'),
  'AC-AMC-008 purchase_orders_update gates active membership');
select ok((select bool_and((coalesce(qual,'') || coalesce(with_check,'')) like '%is_active_member%')
             from pg_policies where schemaname = 'public' and policyname = 'purchase_orders_delete'),
  'AC-AMC-009 purchase_orders_delete gates active membership');
select ok((select bool_and((coalesce(qual,'') || coalesce(with_check,'')) like '%is_active_member%')
             from pg_policies where schemaname = 'public' and policyname = 'procurement_receipts_insert'),
  'AC-AMC-010 procurement_receipts_insert gates active membership');
select ok((select bool_and((coalesce(qual,'') || coalesce(with_check,'')) like '%is_active_member%')
             from pg_policies where schemaname = 'public' and policyname = 'procurement_receipts_update'),
  'AC-AMC-011 procurement_receipts_update gates active membership');
select ok((select bool_and((coalesce(qual,'') || coalesce(with_check,'')) like '%is_active_member%')
             from pg_policies where schemaname = 'public' and policyname = 'procurement_receipts_delete'),
  'AC-AMC-012 procurement_receipts_delete gates active membership');

-- The UPDATE policies must carry it on BOTH sides: a USING-only conjunct lets a disabled account move
-- a row it can already see into a state it should not be able to write.
select ok((select qual like '%is_active_member%' and with_check like '%is_active_member%'
             from pg_policies where schemaname = 'public' and policyname = 'purchase_orders_update'),
  'AC-AMC-013 purchase_orders_update gates it in USING *and* WITH CHECK');
select ok((select qual like '%is_active_member%' and with_check like '%is_active_member%'
             from pg_policies where schemaname = 'public' and policyname = 'procurement_receipts_update'),
  'AC-AMC-014 procurement_receipts_update gates it in USING *and* WITH CHECK');

-- ── §5 — the two tables brought into scope, and the own-row disjunct that must survive ──────────
select ok((select bool_and((coalesce(qual,'') || coalesce(with_check,'')) like '%is_active_member%')
             from pg_policies where schemaname = 'public' and tablename = 'pipeline_stage_config'),
  'AC-AMC-015 both pipeline_stage_config policies gate active membership');

select ok((select qual like '%profile_id%' and qual like '%is_active_member%'
             from pg_policies where schemaname = 'public' and policyname = 'erp_employees_select'),
  'AC-AMC-016 erp_employees_select gates membership WITHOUT dropping the own-row disjunct');

-- ── §6 — incident_reports DELETE: the 0013 pair, with the net grant unchanged ───────────────────
select is(
  (select permissive from pg_policies
    where schemaname = 'public' and policyname = 'incident_reports_delete_admin_only'),
  'RESTRICTIVE',
  'AC-AMC-017 incident_reports_delete_admin_only is RESTRICTIVE, like every other member of its family');

select ok(
  (select count(*) = 1 from pg_policies
    where schemaname = 'public' and tablename = 'incident_reports' and cmd = 'DELETE'
      and permissive = 'PERMISSIVE'
      and (coalesce(qual,'') || coalesce(with_check,'')) like '%is_active_member%'
      and qual like '%org_feature_enabled%'),
  'AC-AMC-018 a permissive incident_reports DELETE exists, still feature-flagged and membership-gated');

-- ── §7 — the annotations this migration re-attached, and the rule that keeps them honest ───────
-- ⛔ `drop policy` discards its `pg_description` row. 0173 caught 0203 doing exactly that; these two
-- assertions mean 0203's OWN file fails next time rather than a neighbour's.
select ok(
  (select d.description like '%create_procurement_receipt%'
     from pg_policy p join pg_description d on d.objoid = p.oid and d.classoid = 'pg_policy'::regclass
    where p.polname = 'procurement_receipts_insert'),
  'AC-AMC-019 procurement_receipts_insert kept its annotation naming create_procurement_receipt');

select ok(
  (select d.description like '%DEAD SINCE 0177%'
     from pg_policy p join pg_description d on d.objoid = p.oid and d.classoid = 'pg_policy'::regclass
    where p.polname = 'procurement_receipts_delete'),
  'AC-AMC-020 procurement_receipts_delete kept its deliberately-dead annotation');

-- ⚑ THE ASSERTION THAT WOULD HAVE STOPPED THIS FILE BEING MIS-RANKED.
-- Several policies are annotated UNREACHABLE because the client write GRANT was revoked, not because
-- the predicate stops anyone. That claim is only true while the grant stays revoked — and a policy
-- audit that reads predicates without joining `role_table_grants` ranks by appearance, which is
-- precisely how the live gap here (a config table with full write grants and no membership gate) was
-- first filed as "lower stakes" beneath two tables a client cannot write at all.
select is_empty($$
  select p.polname || ' on ' || c.relname
    from pg_policy p
    join pg_class c on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
    join pg_description d on d.objoid = p.oid and d.classoid = 'pg_policy'::regclass
   where d.description like '%UNREACHABLE%'
     and exists (select 1 from information_schema.role_table_grants g
                  where g.table_schema = 'public' and g.table_name = c.relname
                    and g.grantee = 'authenticated'
                    and g.privilege_type in ('INSERT','UPDATE','DELETE'))
$$, 'AC-AMC-021 every policy annotated UNREACHABLE really is: no client write grant on its table');

select * from finish();
rollback;
