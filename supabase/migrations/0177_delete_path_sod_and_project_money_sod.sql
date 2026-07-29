-- 0177_delete_path_sod_and_project_money_sod.sql — slice 5 of the create-path SoD class:
-- the DELETE path (PART A) and the `projects` money SoD (PART B).
-- docs/specs/create-path-sod-class.spec.md §9; proven by
-- supabase/tests/0170_delete_path_sod_and_project_money_sod.test.sql.
-- Slice 1 = 0173 (`projects` INSERT), 2 = 0174 (five more tables), 3 = 0175 (the UPDATE half),
-- 4 = 0176 (the residuals). This is the third and last of the three write paths.
--
-- ── THE CLASS, AND WHY THERE IS A FIFTH SLICE ───────────────────────────────────────────────────
-- SoD is enforced on the TRANSITION, so the attacker never transitions: they put the row into (or
-- out of) the protected state by a path the transition does not own. There are THREE such paths —
-- INSERT, UPDATE, DELETE. Slices 1-4 closed INSERT and UPDATE and each said so out loud; 0175 and
-- 0176 both wrote "STILL OPEN — DELETE" into their own headers and pinned the vulnerable state in
-- pgTAP rather than fixing it, because the shape was an ADR-0018/ADR-0019 decision. This file makes
-- that decision and closes it.
--
-- ⚑ AND THE NEW LESSON, WHICH IS THE POINT OF PART A: **a guard on a child table is not a guard if
--   a parent delete cascades.** `budget_line_items_draft_guard` (0005) refuses to touch a line item
--   whose owning version is not Draft — and `budget_line_items_budget_version_id_fkey` is ON DELETE
--   CASCADE, so deleting the Active PARENT took every line item with it, past the guard, with zero
--   audit rows. Probed live at 0176 as a plain Project Manager:
--
--     delete from budget_line_items where id = <item of an Active version> -> ERROR  (guard fires)
--     delete from budget_versions   where id = <that Active version>       -> DELETE 1
--     => line items left: 0.  audit rows for the destruction: 0.
--
--   The full ON DELETE CASCADE enumeration (62 FKs, live catalog) is in the spec §9.6. The only
--   cascade that bypassed a real child guard is that one; the file-table cascades
--   (`procurement_*_files_delete_admin_only` under their non-admin-deletable parents) are the second
--   family and are closed here as a consequence of the parent revokes.
--
-- ── WHAT THIS FILE CLOSES ───────────────────────────────────────────────────────────────────────
-- §A1 budget_versions — a non-Draft version is Admin-only to delete, and every delete is audited
-- §A2 sales_invoices  — client DELETE revoked outright; every delete is audited
-- §A3 incoming_payments — same (see §A3's re-judgement of slice 4's "not this class" call)
-- §A4 procurement_invoices / procurement_receipts / procurement_quotations — same
-- §B  projects — the money SoD: approver != author, on `contract_value`
--
-- ── SCOPE: WHO IS ENFORCED (identical to 0173/0174/0175/0176, and asserted) ──────────────────────
-- The new guards enforce on roles SUBJECT to RLS and EXEMPT roles that already BYPASS it
-- (postgres / service_role / supabase_admin) via public.actor_bypasses_rls() — ADR-0069. That is
-- exactly the RLS trust boundary: a BYPASSRLS role holds a server-side secret and is an authority,
-- not a client. The probed exploits are all `authenticated` PostgREST requests.
--
-- ⚑ ONE DELIBERATE EXCEPTION, in §B: the contract_value WITNESS trigger is NOT exempted, because it
--   is a witness, not a guard. See §B1.
--
-- ── REVERSIBILITY (ADR-0006) ────────────────────────────────────────────────────────────────────
-- ⚑ NOT `supabase db reset` — v0.8.0 is in production and a reset there is destructive and
-- local-only. The manual reverse, statement for statement (⚑ EVERY ONE RESTORES A VULNERABLE STATE):
--   -- §A1
--   drop trigger  if exists budget_versions_delete_guard on public.budget_versions;
--   drop trigger  if exists budget_versions_audit_delete on public.budget_versions;
--   drop function if exists public.assert_budget_version_delete();
--   drop function if exists public.audit_budget_version_delete();
--   -- §A2/§A3/§A4
--   grant delete on public.sales_invoices, public.incoming_payments, public.procurement_invoices,
--                   public.procurement_receipts, public.procurement_quotations to authenticated;
--   drop trigger  if exists sales_invoices_audit_delete         on public.sales_invoices;
--   drop trigger  if exists incoming_payments_audit_delete      on public.incoming_payments;
--   drop trigger  if exists procurement_invoices_audit_delete   on public.procurement_invoices;
--   drop trigger  if exists procurement_receipts_audit_delete   on public.procurement_receipts;
--   drop trigger  if exists procurement_quotations_audit_delete on public.procurement_quotations;
--   drop function if exists public.audit_sales_invoice_delete();
--   drop function if exists public.audit_incoming_payment_delete();
--   drop function if exists public.audit_procurement_invoice_delete();
--   drop function if exists public.audit_procurement_receipt_delete();
--   drop function if exists public.audit_procurement_quotation_delete();
--   -- §B
--   drop trigger  if exists projects_stamp_contract_value_witness on public.projects;
--   drop function if exists public.stamp_contract_value_witness();
--   alter table public.projects drop column contract_value_set_by, drop column contract_value_set_at;
--   -- then re-apply 0176 §3's transition_project body verbatim (drops the money SoD branch).

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- PART A — THE DELETE PATH
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §A1 — budget_versions. THE CASCADE IS THE DEFECT.
--
-- `budget_versions_write` (0002) is a FOR ALL policy for the four write-roles, and 0075 granted a
-- table-wide DELETE. There is no DELETE guard of any kind — contrary to
-- `pmo-portal/src/lib/db/budgets.ts` `deleteDraftVersion`, whose comment asserted "DB trigger blocks
-- non-Draft (OD-BUDGET-C)". THAT TRIGGER DID NOT EXIST; this file creates it and the comment is
-- corrected in the same commit.
--
-- Consequence, probed live at 0176 as a plain Project Manager (transcript in the header above): the
-- Active version deletes, and `budget_line_items_budget_version_id_fkey` (ON DELETE CASCADE) takes
-- every line item with it PAST `budget_line_items_draft_guard`. `budget_version_erp_mirror` cascades
-- too, erasing the ADR-0059 budget-push witness. Every budget KPI over that project (get_project_budget,
-- get_budget_projection, margin, at-risk, S-curve) goes to zero, ERPNext keeps enforcing a budget PMO
-- no longer holds, and NOTHING is written to audit_events.
--
-- THE RULE, and why it is this rule and not another:
--   • A DRAFT version stays deletable by the four write-roles. That is the shipped, tested FE
--     affordance (ProjectBudget.tsx renders "Delete draft" only on `status === 'Draft'`) and a Draft
--     version has no activation to destroy. Narrowing it to Admin would be a product regression with
--     no security gain.
--   • A NON-DRAFT version (Active / Archived) is ADMIN-ONLY — ADR-0019's destructive-delete shape,
--     the same one `projects_delete_admin_only` (0052) / `companies_delete_admin_only` (0013) /
--     `project_documents_delete_admin_only` (0017) already carry.
--   • ⚑ The Admin carve-out is LOAD-BEARING, not a softening: `budget_versions_project_id_fkey` is
--     itself ON DELETE CASCADE from `projects`, and an Admin hard-deleting a project (the Admin-only,
--     audited `projects_delete_admin_only` path, documented in deleteProject's docstring as
--     "budget/task/document children cascade-delete") cascades into this trigger with the SAME actor.
--     A flat Draft-only rule would have broken that shipped Admin capability — an over-block. With
--     the carve-out the cascade runs for an Admin and is refused for everyone else, which is exactly
--     the authorization we want at both entry points.
--
-- A TRIGGER, NOT A RESTRICTIVE POLICY. A restrictive DELETE policy filters rather than raises, so
-- `deleteDraftVersion`'s `.delete().eq('id',…)` would return success having deleted nothing and the
-- FE would toast "deleted" over a version that is still there. The trigger names the rule.
--
-- WHY THIS BREAKS NO CALLER (verified by reading every one, 2026-07-29):
--   • `deleteDraftVersion` (src/lib/db/budgets.ts:394) is the ONLY client delete on this table, and
--     the only affordance that reaches it (ProjectBudget.tsx VersionCard) renders on Draft only.
--   • `archiveVersion` / `activate_budget_version` / `clone_budget_version` are UPDATE/INSERT paths —
--     untouched: this guard is DELETE-only.
--   • `pmo-portal/e2e/serial/_budHelpers.ts` (lines 378/381/383) tears down versions AND the parent
--     project through the service-role `admin` client → BYPASSRLS → exempt by actor_bypasses_rls().
--   • seed.sql and the pgTAP fixtures run as postgres → likewise exempt.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
create or replace function public.assert_budget_version_delete() returns trigger
  language plpgsql set search_path = public as $$
begin
  -- Server-side authority (postgres / service_role / supabase_admin): exempt. See the header.
  if public.actor_bypasses_rls() then
    return old;
  end if;

  -- NULL-safe by construction: `status` is NOT NULL, and `is distinct from` is total anyway (0176 §6).
  if old.status is distinct from 'Draft' and auth_role() is distinct from 'Admin' then
    raise exception
      'budget_versions."%" is % and only an Admin may delete a budget version that is not a Draft: deleting it CASCADES to its line items past budget_line_items_draft_guard, and to the ERPNext budget-push mirror — archive it instead',
      old.name, old.status
      using errcode = '42501';
  end if;

  return old;
end; $$;

drop trigger if exists budget_versions_delete_guard on public.budget_versions;
create trigger budget_versions_delete_guard
  before delete on public.budget_versions
  for each row execute function public.assert_budget_version_delete();

-- Audit every delete (0076 §4 convention: a postgres-owned SECURITY DEFINER trigger fn calling
-- log_audit, which is granted to no client role). Fires for ALL roles including the service-role
-- teardown path — a destructive delete is a destructive delete, whoever makes it. auth.uid() is
-- unaffected by the definer switch and is NULL for a service-role write, per the actor_id contract.
-- AFTER DELETE (not BEFORE) so an aborted delete leaves no audit row; the cascaded line items are
-- already gone by then, so the detail records what identified the destroyed version rather than a
-- count that is no longer readable.
create or replace function public.audit_budget_version_delete() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  perform public.log_audit('budget_version.delete', old.org_id, auth.uid(), old.id,
                           jsonb_build_object('status',       old.status::text,
                                              'version',      old.version,
                                              'name',         old.name,
                                              'project_id',   old.project_id,
                                              'activated_at', old.activated_at));
  return old;
end; $$;

drop trigger if exists budget_versions_audit_delete on public.budget_versions;
create trigger budget_versions_audit_delete
  after delete on public.budget_versions
  for each row execute function public.audit_budget_version_delete();

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §A2/§A3/§A4 — sales_invoices, incoming_payments, and the three procure-to-pay child tables.
--
-- All five are ERPNext MIRROR tables and all five carry the same residual: `authenticated` holds a
-- table DELETE grant plus a permissive DELETE policy, so a plain Project Manager can erase a
-- terminal money row with no audit trail. Probed live at 0176, all five DELETE 1, all five 0 audit
-- rows: a Paid sales invoice, a Paid incoming payment, a Paid vendor invoice, a Complete goods
-- receipt (a 3-way-match input) and the SELECTED quotation.
--
-- ⚑ The sales-invoice case is the sharpest: `sales_invoice_authors` and
--   `sales_invoice_submit_authorizations` are BOTH ON DELETE CASCADE from `sales_invoices`, and they
--   are the entire oracle that `grant_sales_invoice_submit_clearance` / `submit_sales_invoice`
--   (0132/0133) read. 0176 §1 made them client-unwritable; the parent delete erased them anyway.
--   Same shape as §A1: a control on the child, defeated from the parent.
--
-- ⚑ And the file tables: `procurement_invoice_files` / `procurement_receipt_files` /
--   `procurement_quotation_files` each carry a `*_delete_admin_only` restrictive policy (0058) and
--   each cascades from a parent a non-Admin could delete. Closing the parents closes that too.
--
-- THE SHAPE: a full REVOKE with no re-grant, exactly as 0175 did for the UPDATE half of the same
-- three procure-to-pay tables — because the caller survey again found NOTHING to preserve, and an
-- Admin-only re-grant would be an escape hatch no UI can reach. The service-role mirror writer keeps
-- its own grants (verified in the live catalog: service_role holds DELETE on all five) and remains
-- the sole deleter, which is right for a table whose rows mirror an external system of record.
--
-- The permissive DELETE policies are DELIBERATELY LEFT IN PLACE and commented: with the grant gone
-- they are dead, but they are the second layer if any future migration re-grants DELETE, and
-- deleting them would make such a re-grant fully open instead of 4-role gated.
--
-- WHY THIS BREAKS NO CALLER (verified by reading every one, 2026-07-29 — evidence in spec §9.5):
--   • FE DAL — `grep -n '\.delete()' src/lib/db/*.ts src/lib/repositories/*.ts` returns 16 call
--     sites and NOT ONE is any of these five tables. `src/lib/db/revenue.ts` (sales_invoices,
--     incoming_payments) only SELECTs and calls `submit_sales_invoice`;
--     `src/lib/db/procurementCrud.ts` deletes only `procurement_items` and `procurement_documents`.
--   • Edge functions — `grep -n '\.delete()'` over adapter-dispatch/readModelWriters.ts,
--     adapter-dispatch/index.ts, erpnext-sweep/index.ts and _shared/erpnextFeedDeps.ts returns
--     NOTHING: the mirror writers upsert, they never delete. And they hold service_role anyway.
--   • e2e — every delete on these tables is through the service-role `admin` client:
--     _sarHelpers.ts:208-209, AC-SAR-071:207-208, AC-ENA-013:107, AC-ENA-023:104, AC-ENA-023b:103.
--   • Importers — `scripts/import-historical.mjs` / `scripts/lib/historicalImportRecordInsert.mjs`
--     INSERT with the service-role client and never delete.
--   • pgTAP — the three existing delete sites run as the table OWNER (0070 §AC-PF-005,
--     outbox_inflight_link_delete_guard) and are unaffected by a grant revoked from `authenticated`.
--     The fourth (ap_invoices_payments_offboarded_rls) runs as `authenticated` and asserted the
--     VULNERABLE state on purpose ("a disabled user destroying an AP invoice is the more damaging
--     half"); it is rewritten in this slice to assert the denial.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
revoke delete on public.sales_invoices, public.incoming_payments,
                  public.procurement_invoices, public.procurement_receipts, public.procurement_quotations
  from authenticated, anon;

comment on policy sales_invoices_delete on public.sales_invoices is
  'DEAD SINCE 0177 and kept deliberately: the DELETE grant to authenticated/anon is revoked, so this '
  'policy is never reached. It stays as the second layer if a future migration re-grants DELETE — '
  'dropping it would make such a re-grant fully open instead of 4-role gated. The sole deleter is the '
  'service-role mirror writer; every delete is audited by sales_invoices_audit_delete.';

comment on policy incoming_payments_delete on public.incoming_payments is
  'DEAD SINCE 0177 and kept deliberately — see the comment on sales_invoices_delete.';

comment on policy procurement_invoices_delete on public.procurement_invoices is
  'DEAD SINCE 0177 and kept deliberately — see the comment on sales_invoices_delete.';

comment on policy procurement_receipts_delete on public.procurement_receipts is
  'DEAD SINCE 0177 and kept deliberately — see the comment on sales_invoices_delete.';

-- procurement_quotations has no dedicated DELETE policy: DELETE rides on the FOR ALL
-- procurement_quotations_write. Nothing to comment; the revoke is the control.

-- Audit every delete on all five (0076 §4 convention). None of these tables had ANY delete audit:
-- 0076 wired AFTER DELETE only to `companies` and `projects`, and 0123/0100/0010 never added one.
create or replace function public.audit_sales_invoice_delete() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  perform public.log_audit('sales_invoice.delete', old.org_id, auth.uid(), old.id,
                           jsonb_build_object('status',         old.status,
                                              'amount',         old.amount,
                                              'si_number',      old.si_number,
                                              'project_id',     old.project_id,
                                              'author_user_id', old.author_user_id));
  return old;
end; $$;

drop trigger if exists sales_invoices_audit_delete on public.sales_invoices;
create trigger sales_invoices_audit_delete
  after delete on public.sales_invoices
  for each row execute function public.audit_sales_invoice_delete();

create or replace function public.audit_incoming_payment_delete() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  perform public.log_audit('incoming_payment.delete', old.org_id, auth.uid(), old.id,
                           jsonb_build_object('status',           old.status,
                                              'amount',           old.amount,
                                              'ip_number',        old.ip_number,
                                              'sales_invoice_id', old.sales_invoice_id));
  return old;
end; $$;

drop trigger if exists incoming_payments_audit_delete on public.incoming_payments;
create trigger incoming_payments_audit_delete
  after delete on public.incoming_payments
  for each row execute function public.audit_incoming_payment_delete();

create or replace function public.audit_procurement_invoice_delete() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  perform public.log_audit('procurement_invoice.delete', old.org_id, auth.uid(), old.id,
                           jsonb_build_object('status',         old.status::text,
                                              'amount',         old.amount,
                                              'vi_number',      old.vi_number,
                                              'procurement_id', old.procurement_id));
  return old;
end; $$;

drop trigger if exists procurement_invoices_audit_delete on public.procurement_invoices;
create trigger procurement_invoices_audit_delete
  after delete on public.procurement_invoices
  for each row execute function public.audit_procurement_invoice_delete();

create or replace function public.audit_procurement_receipt_delete() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  perform public.log_audit('procurement_receipt.delete', old.org_id, auth.uid(), old.id,
                           jsonb_build_object('status',         old.status::text,
                                              'gr_number',      old.gr_number,
                                              'receipt_date',   old.receipt_date,
                                              'procurement_id', old.procurement_id));
  return old;
end; $$;

drop trigger if exists procurement_receipts_audit_delete on public.procurement_receipts;
create trigger procurement_receipts_audit_delete
  after delete on public.procurement_receipts
  for each row execute function public.audit_procurement_receipt_delete();

create or replace function public.audit_procurement_quotation_delete() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  perform public.log_audit('procurement_quotation.delete', old.org_id, auth.uid(), old.id,
                           jsonb_build_object('is_selected',    old.is_selected,
                                              'total_amount',   old.total_amount,
                                              'vq_number',      old.vq_number,
                                              'vendor_id',      old.vendor_id,
                                              'procurement_id', old.procurement_id));
  return old;
end; $$;

drop trigger if exists procurement_quotations_audit_delete on public.procurement_quotations;
create trigger procurement_quotations_audit_delete
  after delete on public.procurement_quotations
  for each row execute function public.audit_procurement_quotation_delete();

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- PART B — THE `projects` MONEY SoD. Approver != author, on `contract_value`.
--
-- ⚑ 0173's header claimed contract_value at INSERT was safe because "the SoD is about the WON value,
--   which transition_project + set_project_contract_value own". 0176 §3 corrected that claim and
--   added the detection control (the `project.transition` audit row) but left the DEFECT open as an
--   owner decision. Probed live again at 0176, as a plain Project Manager:
--
--     insert projects (…, 'Leads', contract_value 99999999)             -> INSERT 1
--     transition_project(…,'PQ Submitted') / ('Quotation Submitted')    -> ok
--     transition_project(…,'Won, Pending KoM','CPO-…','2026-03-02')     -> ok
--     => 'Won, Pending KoM | 99999999.00', reached ALONE.
--
-- ── THE OWNER'S RULING (2026-07-29), AND WHY THE TWO OPTIONS 0176 NAMED WERE BOTH REJECTED ──────
--   ✗ Gate the pipeline->Won edge on Admin/Executive/Finance. This removes "win the deal" from the
--     Project Manager role that OWNS the pipeline. That is a product regression dressed as a security
--     fix, and it pushes people to work around it.
--   ✗ Blanket re-approval of the value on every win. It taxes every win, including the overwhelming
--     majority where nothing is suspicious.
--   ✓ APPROVER != AUTHOR, ON THE MONEY. Exactly ADR-0019's existing shape (requester!=approver,
--     approver!=payer) applied to `contract_value`: record who last set the value, and refuse the win
--     when the actor winning the deal IS that person — unless they hold a role already trusted with
--     the value on an on-hand project (Admin / Executive / Finance, i.e. set_project_contract_value's
--     own gate, 0014). One extra person, only on the deals where one person did everything.
--
-- ── THE TWO CONDITIONS THAT BOUND IT, both deliberate ───────────────────────────────────────────
--   1. `contract_value > 0`. The rule is about MONEY. `projects.contract_value` is NOT NULL DEFAULT 0
--      and ProjectFormModal sends `parseMoneyInput(values.value) ?? 0`, so a deal created without a
--      value carries 0 — there is nothing to forge and no second person is required. (NaN cannot
--      reach here: `projects_contract_value_nonneg` (0169) rejects it. And if it ever did,
--      `'NaN'::numeric > 0` is TRUE in Postgres, so the guard would FIRE — fail closed either way.)
--   2. The role carve-out is the ON-HAND gate (Admin/Executive/Finance), not the pre-win one
--      (Admin/Executive/Project Manager). A PM is trusted to PROPOSE a value, which is why
--      set_project_contract_value lets them; they are not trusted to ratify their own proposal at
--      the moment it becomes revenue, which is the whole point.
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- ── §B1. The witness columns + the stamping trigger ─────────────────────────────────────────────
-- `contract_value` today has exactly two writers: the origination INSERT (still granted — it is the
-- opportunity value and every legitimate create sends it) and `set_project_contract_value` (0014),
-- because 0014 removed the column from the UPDATE grant. Both are covered by one BEFORE trigger.
alter table public.projects
  add column contract_value_set_by uuid references public.profiles(id),
  add column contract_value_set_at timestamptz;

comment on column public.projects.contract_value_set_by is
  'WITNESS, never an input: the user who last set contract_value, stamped by '
  'projects_stamp_contract_value_witness. NULL WITH a non-NULL contract_value_set_at means a '
  'server-side authority set it (service_role / postgres / the importer) — which is by construction '
  'not the calling user. Read by transition_project''s money SoD (approver != author).';
comment on column public.projects.contract_value_set_at is
  'WITNESS, never an input: when contract_value was last set. Its NULL-ness is the fail-closed '
  'signal — NULL means the row predates 0177 and NO witness was ever taken, so transition_project '
  'refuses the win for a non-Admin/Executive/Finance caller when there is money on the row.';

-- ⚑ NOT exempted via actor_bypasses_rls(), unlike every guard in 0173-0176 and §A1 above. This is a
--   WITNESS, not a guard: it must record the truth for EVERY writer or the oracle it feeds is a lie.
--   For a service-role / postgres write auth.uid() is NULL, which is precisely the "set by a
--   server-side authority, not by any user" case §B2 relies on — and the reason the pair of columns
--   exists rather than one.
--
-- ⚑ THE PRECISION IS IN `update OF contract_value`, NOT IN A VALUE COMPARISON. The trigger fires only
--   when a statement explicitly TARGETS the column, which — given 0014 removed `contract_value` from
--   the client UPDATE grant — means exactly one thing: somebody deliberately ran
--   set_project_contract_value. An unrelated header UPDATE (`set name = …`) never fires it at all.
--   A first draft of this trigger ALSO required `new.contract_value is distinct from old.contract_value`,
--   and that was a real defect, caught by the AC-PMS-020 control: the ratifier's natural act is to
--   CONFIRM the figure the originator proposed, i.e. set it to the SAME number — which is not a
--   change, so the witness was not re-stamped and the legitimate two-person path DEADLOCKED. Setting
--   the value to the number it already holds is still an act of authorship, and it is the one the
--   rule is asking for.
create or replace function public.stamp_contract_value_witness() returns trigger
  language plpgsql set search_path = public as $$
begin
  new.contract_value_set_by := auth.uid();
  new.contract_value_set_at := now();
  return new;
end; $$;

drop trigger if exists projects_stamp_contract_value_witness on public.projects;
create trigger projects_stamp_contract_value_witness
  before insert or update of contract_value on public.projects
  for each row execute function public.stamp_contract_value_witness();

-- The columns are WITHHELD FROM THE CLIENT by construction: `projects` carries no TABLE-level INSERT
-- or UPDATE grant to authenticated/anon (only column-level lists, 0008 A6 / 0014), and a column added
-- later is NOT covered by an existing column-level grant. These revokes are therefore no-ops TODAY
-- and are written anyway so the intent is in the migration and not only in the test: a witness is
-- never an input. 0170 asserts the resulting privilege state, which is the actual control.
revoke insert (contract_value_set_by, contract_value_set_at),
       update (contract_value_set_by, contract_value_set_at)
  on public.projects from authenticated, anon;

-- Un-backfillable state (the 0173 precedent for exactly this): existing rows keep NULL witnesses
-- because there is no record anywhere of who set their contract_value. WARN with a count so the
-- disposition is visible rather than silent. §B2 treats those rows FAIL-CLOSED.
do $$
declare v_n bigint;
begin
  select count(*) into v_n from public.projects
   where contract_value > 0
     and status::text in ('Leads','PQ Submitted','Quotation Submitted','Tender Submitted','Negotiation','Loss Tender');
  if v_n > 0 then
    raise warning '0177: % pre-existing pipeline project(s) carry contract_value > 0 with NO contract_value witness. Until an Admin/Executive/Finance user re-sets the value via set_project_contract_value (which stamps the witness), only an Admin/Executive/Finance user can win them. This is deliberate: a NULL witness fails CLOSED.', v_n;
  end if;
end $$;

-- ── §B2. transition_project — the win branch now enforces approver != author on the money ───────
-- Body is 0176 §3's verbatim (which was 0008 A4/A5's plus the audit row) with ONE inserted block and
-- two extra `select … into` targets, all marked inline. Every other line — the transition map, the
-- org re-assertion, the coarse role gate, the legality check, all three update branches and the
-- log_audit call — is unchanged.
create or replace function transition_project(
  p_id uuid, p_to project_status, p_customer_contract_ref text default null, p_contract_date date default null)
  returns void language plpgsql security definer set search_path = public as $$
declare
  v_from project_status;
  v_org  uuid;
  v_role user_role := auth_role();
  v_value  numeric;      -- 0176: read for the audit detail.
  v_set_by uuid;         -- ⚑ 0177: the contract_value witness — the SoD subject of the win branch.
  v_set_at timestamptz;  -- ⚑ 0177: NULL here = no witness was ever taken -> FAIL CLOSED.
  v_legal jsonb := jsonb_build_object(
    'Leads',               jsonb_build_array('PQ Submitted','Loss Tender','Internal Project'),
    'PQ Submitted',        jsonb_build_array('Quotation Submitted','Leads','Loss Tender'),
    'Quotation Submitted', jsonb_build_array('Tender Submitted','PQ Submitted','Won, Pending KoM','Loss Tender'),
    'Tender Submitted',    jsonb_build_array('Negotiation','Quotation Submitted','Won, Pending KoM','Loss Tender'),
    'Negotiation',         jsonb_build_array('Won, Pending KoM','Tender Submitted','Loss Tender'),
    'Won, Pending KoM',    jsonb_build_array('Ongoing Project','On Hold','Close Out'),
    'Ongoing Project',     jsonb_build_array('On Hold','Close Out'),
    'On Hold',             jsonb_build_array('Ongoing Project','Close Out'),
    'Close Out',           jsonb_build_array('Ongoing Project'),
    'Loss Tender',         jsonb_build_array('Negotiation'),
    'Internal Project',    jsonb_build_array()
  );
begin
  -- Load + lock the row (serializes concurrent transitions on the SAME project). P0002 if absent.
  -- ⚑ 0177: the witness is read under the SAME lock as the value it witnesses — a concurrent
  --   set_project_contract_value takes that lock too, so the pair can never be read torn.
  select status, org_id, contract_value, contract_value_set_by, contract_value_set_at
    into v_from, v_org, v_value, v_set_by, v_set_at
    from public.projects where id = p_id for update;
  if v_from is null then
    raise exception 'project not found' using errcode = 'P0002';
  end if;

  -- Tenant isolation (FR-PR-004): proven independently of RLS (definer bypasses it).
  -- SECURITY: this org re-assertion MUST stay — removing it leaks cross-org writes.
  if v_org is distinct from auth_org_id() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  -- Coarse role gate (FR-PR-004, OD-SP-1): no per-transition matrix (sales is not procurement).
  -- SECURITY: this coarse role gate MUST stay — removing it lets any authenticated user transition.
  if v_role is null or v_role not in ('Admin','Executive','Project Manager','Finance') then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  -- Transition-map legality (FR-PR-001/003): (from,to) must be in the data map and not a no-op, else P0001.
  if p_to = v_from or not (v_legal -> v_from::text) ? p_to::text then
    raise exception 'illegal transition % -> %', v_from, p_to using errcode = 'P0001';
  end if;

  -- Branch on the target (OD-PR-C/D, FR-PR-005/006/007).
  if p_to = 'Won, Pending KoM'
     and v_from in ('Leads','PQ Submitted','Quotation Submitted','Tender Submitted','Negotiation') then

    -- ⚑ 0177 — THE MONEY SoD. SECURITY: this block MUST stay. Without it a Project Manager sets
    -- their own contract_value at origination, runs the legal pipeline alone, and lands a won deal
    -- at a value NOBODY ELSE EVER APPROVED — set_project_contract_value's Admin/Executive/Finance
    -- gate binds only once the project is already on-hand, so the value rides in underneath it.
    -- Every clause is TOTAL (never NULL) on purpose — `is distinct from` rather than `=`, and an
    -- explicit `v_set_at is null` branch — because a NULL-valued condition does not fire an `if`
    -- and that is the exact defect 0176 §6 had to repair in four other guards.
    if coalesce(v_value, 0) > 0
       and (v_role is null or v_role not in ('Admin','Executive','Finance'))
       and (    v_set_at is null                                          -- no witness -> FAIL CLOSED
             or (v_set_by is not null and v_set_by is not distinct from auth.uid()) )
    then
      if v_set_at is null then
        raise exception
          'this deal''s contract value has no recorded author, so winning it requires Admin, Executive or Finance: the value must be re-set through set_project_contract_value (which records who set it) before a Project Manager can win the deal'
          using errcode = '42501';
      else
        raise exception
          'you set this deal''s contract value, so you cannot also win it: the contract value must be approved by someone other than the person who set it (Admin, Executive or Finance) — ask them to set the value, or to win the deal'
          using errcode = '42501';
      end if;
    end if;

    -- Win-capture (OD-PR-C): fires only on FIRST reach of Won from a pipeline stage.
    if p_customer_contract_ref is null or btrim(p_customer_contract_ref) = '' or p_contract_date is null then
      raise exception 'customer contract ref and date are required to win' using errcode = 'P0001';
    end if;
    update public.projects set
      status                = p_to,
      customer_contract_ref = p_customer_contract_ref,
      contract_date         = p_contract_date,
      decided_at            = p_contract_date::timestamptz,
      last_update           = now()
    where id = p_id;
  elsif p_to = 'Loss Tender' then
    update public.projects set
      status      = p_to,
      decided_at  = now(),
      last_update = now()
    where id = p_id;
  else
    update public.projects set
      status      = p_to,
      last_update = now()
    where id = p_id;
  end if;

  -- 0176: the transition is on the audit trail. ⚑ 0177 adds the witness to the detail — the audit
  -- row now answers "who set this value, and who turned it into revenue" in one read.
  perform public.log_audit('project.transition', v_org, auth.uid(), p_id,
                           jsonb_build_object('from',                  v_from::text,
                                              'to',                    p_to::text,
                                              'contract_value',        v_value,
                                              'contract_value_set_by', v_set_by,
                                              'contract_value_set_at', v_set_at,
                                              'customer_contract_ref', p_customer_contract_ref,
                                              'contract_date',         p_contract_date));
end; $$;
