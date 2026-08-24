-- 0203_rls_active_member_write_composition.sql — the offboarding gate is missing from six write policies.
-- Proven by supabase/tests/0203_rls_active_member_composition.test.sql (AC-AMC-001..010).
--
-- ── THE DEFECT, AND ITS ACTUAL REACH — READ THE GRANTS, NOT ONLY THE POLICIES ──────────────────
-- `0180`'s header states, as its founding premise:
--
--     "`is_active_member()` … is conjoined into every business-table RLS policy, so a deactivated
--      employee holding a still-valid JWT READS nothing."
--
-- ⚑ **That premise is false.** Probed against the live catalog at head (0202), four tables gate
-- membership on their read policy and not on their writes, or on neither:
--
--     purchase_orders       SELECT gated · INSERT/UPDATE/DELETE not
--     procurement_receipts  SELECT gated · INSERT/UPDATE/DELETE not
--     pipeline_stage_config gated on NEITHER side
--     erp_employees         gated on neither (single SELECT policy)
--
-- ⛔ **But a missing policy predicate is only reachable if a GRANT exists to exercise it, and for two
-- of these four it does not.** `role_table_grants` for `authenticated`, at the same head:
--
--     purchase_orders       SELECT only          ⇒ the write policies are a DEAD LAYER
--     procurement_receipts  SELECT only          ⇒ the write policies are a DEAD LAYER
--     pipeline_stage_config SELECT,INSERT,UPDATE,DELETE   ⇒ REACHABLE
--     incident_reports      SELECT,INSERT,UPDATE,DELETE   ⇒ REACHABLE
--
-- `0174` revoked client write grants on the procurement chain; the sole client write path there is a
-- SECURITY DEFINER RPC, which `0180` gated. `0180`'s own annotation on `procurement_receipts_insert`
-- says exactly this, and adds the instruction this file follows: *"Kept as the second layer if a
-- future migration re-grants INSERT."*
--
-- **So the live gap was `pipeline_stage_config`** — full client write grants and no membership gate on
-- either side — and the procurement pair is hardening of an unreachable layer. That inversion is the
-- point: the first read of this defect ranked the procurement tables highest **because their policies
-- looked worse**, and ranked the config table "lower stakes" without checking that it was the only one
-- a client could actually reach. A policy audit that does not join `role_table_grants` ranks by
-- appearance.
--
-- ⚑ **VERIFIED ON LOCAL DOCKER ONLY.** Grant defaults differ between local and hosted Supabase — that
-- is the `0185` lesson, and it cost a completeness sweep that was green in CI and false in production.
-- The revokes above come from migrations, so they apply on both; but the reach column in this header
-- must be re-derived against production before it is quoted as a production fact.
--
-- ⚑ NOT a `0099` regression on the procurement pair. The pre-flip `*_write` policies preserved in
-- `0099`'s own rollback block (`:19-23`, `:34-38`) did not carry the predicate either. It was never
-- there. `0099` split them per-command and faithfully copied what it found — the same copy-forward
-- that carried an unexamined role list into `tasks_insert` (see `DD-TASK-8`).
--
-- ── ⚑ WHY THIS IS SAFE HERE AND WAS NOT SAFE IN `0180` ──────────────────────────────────────────
-- `0180`'s central trap: `is_active_member()` resolves `auth.uid()`, which is NULL for a
-- **service_role** caller, so it returns FALSE — and adding the plain conjunct to a SECURITY DEFINER
-- RPC that an edge function invokes as service_role breaks that path in production, CLOSED and
-- silently. `0180` therefore needed an overload taking an explicit actor.
--
-- **That trap does not apply to a POLICY.** `service_role` holds `BYPASSRLS`, so RLS policies are not
-- evaluated for it at all; the sweep, the adapter dispatch and every other service-role writer are
-- unaffected by anything in this file. The conjunct binds only the `authenticated` path, which is
-- exactly the path a disabled account still holds a token for. Do not "fix" this file by importing
-- `0180`'s overload — that would be cargo-culting a mitigation for a different caller class.
--
-- ── §5, and why a working policy is being rewritten ─────────────────────────────────────────────
-- Every `*_delete_admin_only` policy in the tree is RESTRICTIVE (`0013`'s idiom: a permissive policy
-- carries the role set, a restrictive twin narrows DELETE to Admin). `incident_reports_delete_admin_only`
-- (`0017`) is **PERMISSIVE**. Today it is the only DELETE policy on the table, so the effective grant is
-- identical — but the restrictive form exists precisely so that a *later* permissive policy cannot
-- widen it, and this one has no such protection. Split into the standard pair; the net grant
-- (org + Admin + active member + the `incidents` feature flag) is unchanged, and the test asserts that.
--
-- ── ROLLBACK ────────────────────────────────────────────────────────────────────────────────────
--   drop policy purchase_orders_insert on public.purchase_orders;
--   drop policy purchase_orders_update on public.purchase_orders;
--   drop policy purchase_orders_delete on public.purchase_orders;
--   drop policy procurement_receipts_insert on public.procurement_receipts;
--   drop policy procurement_receipts_update on public.procurement_receipts;
--   drop policy procurement_receipts_delete on public.procurement_receipts;
--   -- …then re-create each from 0099 §2 verbatim (without the is_active_member() conjunct).
--   drop policy pipeline_stage_config_select on public.pipeline_stage_config;
--   drop policy pipeline_stage_config_write  on public.pipeline_stage_config;
--   -- …re-create from 0008 without the conjunct.
--   drop policy erp_employees_select on public.erp_employees;
--   -- …re-create from 0136 without the conjunct.
--   drop policy incident_reports_delete            on public.incident_reports;
--   drop policy incident_reports_delete_admin_only on public.incident_reports;
--   create policy incident_reports_delete_admin_only on public.incident_reports for delete
--     using (org_id = auth_org_id() and auth_role() = 'Admin' and is_active_member()
--       and public.org_feature_enabled(auth_org_id(), 'incidents'));
-- ================================================================================================

-- ── §1 — purchase_orders ────────────────────────────────────────────────────────────────────────
drop policy purchase_orders_insert on public.purchase_orders;
drop policy purchase_orders_update on public.purchase_orders;
drop policy purchase_orders_delete on public.purchase_orders;

create policy purchase_orders_insert on public.purchase_orders for insert
  with check (org_id = auth_org_id() and public.is_active_member()
    and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (select 1 from public.procurements p
                 where p.id = purchase_orders.procurement_id and p.org_id = auth_org_id())
    and not public.domain_externally_owned(auth_org_id(), 'procurement'));

create policy purchase_orders_update on public.purchase_orders for update
  using (org_id = auth_org_id() and public.is_active_member()
    and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (select 1 from public.procurements p
                 where p.id = purchase_orders.procurement_id and p.org_id = auth_org_id()))
  with check (org_id = auth_org_id() and public.is_active_member()
    and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (select 1 from public.procurements p
                 where p.id = purchase_orders.procurement_id and p.org_id = auth_org_id()));

create policy purchase_orders_delete on public.purchase_orders for delete
  using (org_id = auth_org_id() and public.is_active_member()
    and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (select 1 from public.procurements p
                 where p.id = purchase_orders.procurement_id and p.org_id = auth_org_id())
    and not public.domain_externally_owned(auth_org_id(), 'procurement'));

-- ── §2 — procurement_receipts ───────────────────────────────────────────────────────────────────
drop policy procurement_receipts_insert on public.procurement_receipts;
drop policy procurement_receipts_update on public.procurement_receipts;
drop policy procurement_receipts_delete on public.procurement_receipts;

create policy procurement_receipts_insert on public.procurement_receipts for insert
  with check (org_id = auth_org_id() and public.is_active_member()
    and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (select 1 from public.procurements p
                 where p.id = procurement_receipts.procurement_id and p.org_id = auth_org_id())
    and not public.domain_externally_owned(auth_org_id(), 'procurement'));

create policy procurement_receipts_update on public.procurement_receipts for update
  using (org_id = auth_org_id() and public.is_active_member()
    and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (select 1 from public.procurements p
                 where p.id = procurement_receipts.procurement_id and p.org_id = auth_org_id()))
  with check (org_id = auth_org_id() and public.is_active_member()
    and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (select 1 from public.procurements p
                 where p.id = procurement_receipts.procurement_id and p.org_id = auth_org_id()));

create policy procurement_receipts_delete on public.procurement_receipts for delete
  using (org_id = auth_org_id() and public.is_active_member()
    and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (select 1 from public.procurements p
                 where p.id = procurement_receipts.procurement_id and p.org_id = auth_org_id())
    and not public.domain_externally_owned(auth_org_id(), 'procurement'));

-- ── §3 — pipeline_stage_config (both sides; it carried the predicate on neither) ────────────────
drop policy pipeline_stage_config_select on public.pipeline_stage_config;
drop policy pipeline_stage_config_write  on public.pipeline_stage_config;

create policy pipeline_stage_config_select on public.pipeline_stage_config for select
  using (org_id = auth_org_id() and public.is_active_member());

create policy pipeline_stage_config_write on public.pipeline_stage_config for all
  using (org_id = auth_org_id() and public.is_active_member()
    and auth_role() in ('Admin','Executive','Project Manager','Finance'))
  with check (org_id = auth_org_id() and public.is_active_member()
    and auth_role() in ('Admin','Executive','Project Manager','Finance'));

-- ── §4 — erp_employees (read of the employee map; own-row disjunct preserved) ───────────────────
drop policy erp_employees_select on public.erp_employees;

create policy erp_employees_select on public.erp_employees for select
  using (org_id = auth_org_id() and public.is_active_member()
    and (auth_role() in ('Admin','Executive','Finance','Project Manager')
         or profile_id = (select auth.uid())));

-- ── §5 — incident_reports DELETE: the 0013 permissive+restrictive pair, net grant unchanged ─────
drop policy incident_reports_delete_admin_only on public.incident_reports;

create policy incident_reports_delete on public.incident_reports for delete
  using (org_id = auth_org_id() and public.is_active_member()
    and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and public.org_feature_enabled(auth_org_id(), 'incidents'));

create policy incident_reports_delete_admin_only on public.incident_reports
  as restrictive for delete
  using (auth_role() = 'Admin');

-- ── §6 — RE-ATTACH THE POLICY COMMENTS THE RECREATE ABOVE DISCARDED ────────────────────────────
-- ⛔ `drop policy` takes its `pg_description` row with it. `0173`'s AC-AMG-006 asserts these
-- annotations exist and name their successor RPC, and it caught this file doing exactly that — the
-- `0125` / `0189` class (drop-and-recreate silently losing an attached object), landing on comments
-- rather than triggers this time.
--
-- ⚑ The `procurement_receipts_insert` text is REWRITTEN, not restored verbatim: `0180`'s version said
-- "this policy never carried is_active_member() at all", which stops being true one section above.
-- Copying a stale annotation forward is how a comment becomes a lie that a test still passes.
comment on policy procurement_receipts_insert on public.procurement_receipts is
  'SUPERSEDED and UNREACHABLE since 0174: `authenticated`/`anon` hold SELECT only on this table. The '
  'sole client write path is the SECURITY DEFINER RPC create_procurement_receipt, which re-asserts '
  'org, the Admin/PM/requester gate, the ERPNext-ownership fence and — since 0180 — active membership '
  '(assert_is_active_member). ⚑ HISTORY, since it explains the asymmetry with its twin: this policy '
  'carried NO is_active_member() from 0063 until 0203, so the goods-receipt create path had no '
  'active-member control on any layer until 0180 closed the RPC. 0203 added the conjunct here as the '
  'second layer, per this comment''s own instruction, in case a future migration re-grants INSERT.';

comment on policy procurement_receipts_delete on public.procurement_receipts is
  'DEAD SINCE 0177 and kept deliberately — see the comment on sales_invoices_delete. 0203 re-created '
  'it to add the is_active_member() conjunct; still dead, still deliberate, now consistent with the '
  'composition rule proven by 0203''s test.';
