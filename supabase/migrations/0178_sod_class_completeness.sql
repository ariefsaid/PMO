-- 0178_sod_class_completeness.sql — slice 6 of the create-path SoD class: the cells the
-- per-table × {INSERT, UPDATE, DELETE, RPC-parameter} matrix found still OPEN after slice 5.
-- docs/specs/create-path-sod-class.spec.md §10 (and its §10.1 COMPLETENESS MATRIX);
-- proven by supabase/tests/0171_sod_class_completeness.test.sql.
-- Slices: 1 = 0173 (`projects` INSERT) · 2 = 0174 (five more tables, INSERT) · 3 = 0175 (UPDATE) ·
--         4 = 0176 (the residuals) · 5 = 0177 (DELETE + the projects money SoD) · 6 = THIS FILE.
--
-- ── WHY THERE IS A SLICE 6, AND WHAT CHANGED IN HOW WE LOOK ─────────────────────────────────────
-- Every miss across slices 2-5 has ONE shape: a table was added to the class and only the path
-- currently in hand was closed. Slice 2 closed INSERT and left UPDATE. Slice 3 fixed that. Slice 4
-- added `budget_versions` and closed INSERT only. Slice 5 closed DELETE and left `budget_versions`
-- UPDATE. Reading each slice on its own, every one of them looks complete.
--
-- ⚑ THE COMPLETENESS TEST IS NOT PER-SLICE. It is **per-table × {INSERT, UPDATE, DELETE,
--   RPC-parameter}**, built from the LIVE CATALOG, over the WHOLE class — fifteen tables — with every
--   cell marked OPEN / CLOSED / N-A-with-reason. That matrix is spec §10.1 and it is this slice's
--   first deliverable; the SQL below is second.
--
-- ⚑ AND A SECOND AXIS THE REVIEW ADDED: a cell is not closed because an assertion is green. Two of
--   the defects below are PROOF defects, not guard defects — an assertion that matched a `--` COMMENT
--   (0170 AC-PMS-021: delete the entire role gate, keep the comment, 62/62 still green), and an
--   assertion over `information_schema.column_privileges where privilege_type = 'DELETE'`, a set that
--   is EMPTY BY CONSTRUCTION because DELETE is not a column-level privilege in Postgres. The matrix
--   therefore carries an "is the proof binding?" column as well as "is the cell closed?".
--
-- ── WHAT THIS FILE CLOSES ───────────────────────────────────────────────────────────────────────
-- §1  budget_versions UPDATE — the round trip that voided budget_line_items_draft_guard  (HIGH)
-- §2  create_payment(p_status) — the protected end state as an RPC PARAMETER               (HIGH)
-- §3  incoming_payments INSERT/UPDATE — the sales_invoices treatment, mirrored             (HIGH)
-- §4  project_documents — the approved FILE is swappable by its author, un-audited       (MEDIUM)
-- §5  the money SoD's "second person" could be an OFFBOARDED account                     (MEDIUM)
-- §6  the DELETE guard was blind to CASCADES — its own headline lesson, unimplemented       (HIGH)
-- §7  the money SoD's carve-out: the justification was wrong; the message was under-inclusive
-- §8  hygiene: the missing FK index, the un-audited writes, the client-settable submitted_at,
--     the latent DELETE grants, and the WITNESS-column comment
--
-- ── SCOPE: WHO IS ENFORCED (ADR-0069, EXTENDED BY §6) ───────────────────────────────────────────
-- Guards enforce on roles SUBJECT to RLS and exempt roles that already BYPASS it. §6 corrects the
-- PREDICATE for delete-time guards: an ON DELETE CASCADE runs as the REFERENCED table's owner, so
-- `current_user` (and therefore actor_bypasses_rls()) describes the cascade machinery, not the actor.
-- ADR-0069 gains a fifth property and a second, narrower predicate for exactly this — which is the
-- escape hatch ADR-0069's own "Consequences" section anticipated.
--
-- ── REVERSIBILITY (ADR-0006) ────────────────────────────────────────────────────────────────────
-- ⚑ NOT `supabase db reset` — v0.8.0 is in production. The manual reverse, statement for statement
-- (⚑ EVERY ONE RESTORES A VULNERABLE STATE):
--   -- §1
--   drop trigger  if exists budget_versions_update_guard on public.budget_versions;
--   drop trigger  if exists budget_versions_audit_update on public.budget_versions;
--   drop trigger  if exists budget_versions_audit_insert on public.budget_versions;
--   drop function if exists public.assert_budget_version_update();
--   drop function if exists public.audit_budget_version_update();
--   drop function if exists public.audit_budget_version_insert();
--   grant update on public.budget_versions to authenticated;
--   -- §2 re-apply 0039/0100's create_payment body (drops the origination-status gate).
--   -- §3
--   drop trigger  if exists incoming_payments_origination_guard on public.incoming_payments;
--   drop trigger  if exists incoming_payments_audit_insert      on public.incoming_payments;
--   drop function if exists public.assert_incoming_payment_origination_insert();
--   drop function if exists public.audit_incoming_payment_insert();
--   grant insert, update on public.incoming_payments to authenticated;
--   -- §4
--   drop trigger  if exists project_documents_update_guard on public.project_documents;
--   drop trigger  if exists project_documents_audit_update on public.project_documents;
--   drop function if exists public.assert_project_document_update();
--   drop function if exists public.audit_project_document_update();
--   -- §5/§7 re-apply 0177 §B2's transition_project body and 0014's set_project_contract_value body.
--   -- §6
--   drop function if exists public.is_unattributed_authority();  -- after re-applying 0177 §A1's
--   --   assert_budget_version_delete() body verbatim (restores the cascade blindness).
--   -- §8
--   drop index  if exists public.projects_contract_value_set_by_idx;
--   drop trigger if exists procurement_invoices_audit_insert   on public.procurement_invoices;
--   drop trigger if exists procurement_receipts_audit_insert   on public.procurement_receipts;
--   drop trigger if exists procurement_quotations_audit_insert on public.procurement_quotations;
--   drop function if exists public.audit_procurement_invoice_insert();
--   drop function if exists public.audit_procurement_receipt_insert();
--   drop function if exists public.audit_procurement_quotation_insert();
--   grant insert (submitted_at) on public.timesheets to authenticated;
--   grant delete on public.procurements, public.timesheets to authenticated;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §0 — is_unattributed_authority(): the delete-time trust boundary (ADR-0069 property 5).
--
-- ⚑ THE DEFECT THIS REPAIRS IS IN SLICE 5'S OWN HEADLINE LESSON. 0177 opens with "a guard on a child
--   table is not a guard if a parent delete CASCADES" — and then wrote a guard that is blind to every
--   cascade. Probed live at 0177 with a `raise notice` inside the trigger:
--
--     an Admin deletes the Active version DIRECTLY  -> GUARD FIRED: current_user=authenticated  bypass=f
--     an Admin deletes the PARENT PROJECT (cascade) -> GUARD FIRED: current_user=postgres       bypass=t
--
--   An ON DELETE CASCADE action runs as the REFERENCED table's OWNER. So inside a cascade
--   `current_user` is `postgres`, `actor_bypasses_rls()` returns TRUE, and 0177's guard returned at
--   its first line without ever evaluating its rule. Two consequences:
--     (a) 0177's claim that the Admin carve-out is "LOAD-BEARING … the cascade runs for an Admin and
--         is refused for everyone else" was FALSE — the cascade ran for EVERYONE who could reach it.
--         (Proved by mutation: Draft-only-for-everyone killed AC-DPS-014 and left AC-DPS-015 GREEN.)
--     (b) any FUTURE cascading parent of budget_versions silently re-opens the whole defect with
--         0170 still green.
--
-- THE DECISION (deliberate, and recorded in ADR-0069): **a delete guard MUST fire on a
-- client-initiated cascade.** The discriminator is not the ROLE — a cascade rewrites it — it is
-- whether there is an ATTRIBUTABLE ACTOR. `auth.uid()` is read from the JWT claims GUC, which
-- survives the role switch a cascade performs, so:
--
--     a genuine server-side authority  (seed.sql, pgTAP fixtures, the service-role mirror writer,
--     the importer, e2e teardown via the `admin` client) has auth.uid() IS NULL;
--     a client-initiated cascade carries the caller's JWT, so auth.uid() IS NOT NULL even though
--     current_user has become postgres.
--
-- Hence: exempt only when BOTH hold — no actor AND an RLS-bypassing role. That is strictly narrower
-- than actor_bypasses_rls(), never wider, so it cannot exempt anyone it did not already exempt.
--
-- ⚑ WHY A SECOND PREDICATE AND NOT AN EDIT TO THE FIRST. actor_bypasses_rls() is asserted verbatim by
--   0168 §F and relied on by seven INSERT guards, where no cascade exists (a cascade never inserts).
--   ADR-0069's own Consequences section says: "If that distinction is ever needed, it belongs in a
--   separate, narrower predicate — not in this one." This is that predicate.
--
-- The four ADR-0069 properties carry over and are asserted: SECURITY INVOKER (current_user must be
-- the REAL calling role — a definer would read `postgres` and exempt everyone), pg_catalog FIRST in
-- the search_path (see §7a: naming it LAST is the exploitable form), coalesce(...) so an unknown role
-- FAILS CLOSED, and an explicit execute grant so a `revoke … from public` hardening cannot break it.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
create or replace function public.is_unattributed_authority() returns boolean
  language sql stable set search_path = pg_catalog, public as $$
  select auth.uid() is null and public.actor_bypasses_rls()
$$;

comment on function public.is_unattributed_authority() is
  'ADR-0069 property 5 — the DELETE-time trust boundary. An ON DELETE CASCADE runs as the referenced '
  'table''s OWNER, so current_user (and actor_bypasses_rls()) describes the cascade machinery, not the '
  'actor; auth.uid() survives that switch and is the discriminator. TRUE only when there is NO '
  'attributable end-user actor AND the role bypasses RLS — strictly narrower than actor_bypasses_rls(), '
  'so it can never exempt a caller that one would not. Use this in delete guards; use '
  'actor_bypasses_rls() in insert/update guards, where no cascade can arise.';

grant execute on function public.is_unattributed_authority() to authenticated, anon;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §1 — budget_versions UPDATE. THE ROUND TRIP THAT VOIDED THE CHILD GUARD.
--
-- 0176 §4 closed INSERT. 0177 §A1 closed DELETE. **UPDATE was never touched**, and 0075's table-wide
-- UPDATE grant covers `status` AND `activated_at`. There is no BEFORE UPDATE trigger. Probed live at
-- 0177 as a plain Project Manager:
--
--   update budget_versions set status='Archived' where status='Active'          -> UPDATE 17, audit 0
--
-- and, far worse, the ROUND TRIP — which voids `budget_line_items_draft_guard` ENTIRELY:
--
--   update budget_versions  set status='Draft'                    -> UPDATE 1
--   update budget_line_items set budgeted_amount = 1              -> UPDATE 1   (guard sees "Draft")
--   update budget_versions  set status='Active',
--                               activated_at='2030-12-31'         -> UPDATE 1
--   => the Active version's line item went 1,000,000.00 -> 1.00, activated_at forged to 2030,
--      audit rows: 0.
--
-- That bypasses everything `activate_budget_version` (0005 + 0139) carries — its role gate, its
-- `is_active_member()` conjunct, its Draft-only legality rule, its parent-project org re-assertion and
-- its archive-the-previous-Active-in-one-transaction invariant — and forges `activated_at`, which is
-- the ADR-0059 §4 deterministic ERPNext budget-push key: a witness of an activation act the DB never
-- performed.
--
-- ⚑ 0170:162-167 currently PINS the client's direct `set status='Archived'` as a DESIRED CONTROL, and
--   it is one: `archiveVersion` (src/lib/db/budgets.ts:382) is a real, shipped, tested affordance. The
--   pin is not deleted — it is RE-SCOPED, so that the one transition a client legitimately makes stays
--   green and the two that defeat the guard are denied by message.
--
-- THE RULE: for a client, the ONLY legal status edit is `Active -> Archived`. Everything else —
-- `-> Active` (activate_budget_version's exclusive act) and `Active/Archived -> Draft` (the round
-- trip's first step) — is refused. `activated_at` is withheld from the grant AND asserted in the
-- trigger; the trigger is what NAMES the rule, since a grant's 42501 names nothing.
--
-- WHY THIS BREAKS NO CALLER (verified by reading every one, 2026-07-29):
--   • `archiveVersion` is the ONLY client UPDATE on this table — `grep -n "from('budget_versions')"`
--     over pmo-portal/src + pmo-portal/e2e returns 9 call sites and exactly one `.update(...)`, which
--     sends `{ status: 'Archived' }` and nothing else. Hence the re-grant is `status` ALONE.
--   • The affordance that reaches it (`pmo-portal/pages/ProjectBudget.tsx:521`) renders the "Archive"
--     button on `version.status === 'Active'` ONLY — exactly the transition the guard permits.
--   • `activate_budget_version` / `clone_budget_version` are SECURITY DEFINER owned by postgres:
--     exempt by actor_bypasses_rls(), and column grants do not apply to a definer at all.
--   • `_budHelpers.ts` writes through the service-role `admin` client → BYPASSRLS → exempt.
--
-- AND THE AUDIT: activation is unaudited on BOTH paths today — neither `activate_budget_version` nor
-- the direct UPDATE writes an audit row. The AFTER UPDATE trigger fires for ALL roles (0076 §4's
-- convention), so the RPC's activation lands on the trail too, which is the point.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
revoke update on public.budget_versions from authenticated, anon;
grant  update (status) on public.budget_versions to authenticated;

create or replace function public.assert_budget_version_update() returns trigger
  language plpgsql set search_path = public as $$
begin
  -- Server-side authority (postgres / service_role / supabase_admin, and the definer RPCs, which run
  -- as their postgres owner): exempt. An UPDATE never arrives by cascade, so actor_bypasses_rls() —
  -- not §0's narrower delete-time predicate — is the right boundary here. See the file header.
  if public.actor_bypasses_rls() then
    return new;
  end if;

  -- Every comparison is TOTAL (`is distinct from`), never `<>` — 0176 §6: a NULL-valued condition
  -- does not fire an `if`, and that fell four guards through to a NOT NULL constraint.
  if new.status is distinct from old.status
     and not (old.status is not distinct from 'Active' and new.status is not distinct from 'Archived')
  then
    raise exception
      'budget_versions."%" cannot be moved from % to % from the client: the only status change a client may make is archiving the Active version. Activation is activate_budget_version''s alone (it enforces the role gate, active membership, Draft-only legality and archiving the previous Active version in one transaction), and re-opening a version as a Draft would let its line items be edited past budget_line_items_draft_guard and then re-activated',
      old.name, old.status, new.status
      using errcode = '42501';
  end if;

  -- Behind the grant (`activated_at` is no longer client-UPDATEable), and it names the rule.
  if new.activated_at is distinct from old.activated_at then
    raise exception
      'budget_versions.activated_at cannot be changed: the activation witness is stamped only by activate_budget_version, and the ERPNext budget push key is derived from it'
      using errcode = '42501';
  end if;

  return new;
end; $$;

drop trigger if exists budget_versions_update_guard on public.budget_versions;
create trigger budget_versions_update_guard
  before update on public.budget_versions
  for each row execute function public.assert_budget_version_update();

-- Audit every update AND every insert (0076 §4 convention: a postgres-owned SECURITY DEFINER trigger
-- fn calling log_audit, which is granted to no client role). Both fire for ALL roles, so
-- activate_budget_version's activation — previously invisible — is on the trail with everything else.
create or replace function public.audit_budget_version_update() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  perform public.log_audit('budget_version.update', new.org_id, auth.uid(), new.id,
                           jsonb_build_object('from_status',       old.status::text,
                                              'to_status',         new.status::text,
                                              'from_activated_at', old.activated_at,
                                              'to_activated_at',   new.activated_at,
                                              'version',           new.version,
                                              'name',              new.name,
                                              'project_id',        new.project_id));
  return new;
end; $$;

drop trigger if exists budget_versions_audit_update on public.budget_versions;
create trigger budget_versions_audit_update
  after update on public.budget_versions
  for each row execute function public.audit_budget_version_update();

-- L3: budget_versions INSERT succeeded with NO audit row — 0176 §4 added the guard and not the trail.
create or replace function public.audit_budget_version_insert() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  perform public.log_audit('budget_version.create', new.org_id, auth.uid(), new.id,
                           jsonb_build_object('status',     new.status::text,
                                              'version',    new.version,
                                              'name',       new.name,
                                              'project_id', new.project_id));
  return new;
end; $$;

drop trigger if exists budget_versions_audit_insert on public.budget_versions;
create trigger budget_versions_audit_insert
  after insert on public.budget_versions
  for each row execute function public.audit_budget_version_insert();

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §2 — create_payment(p_status): THE PROTECTED END STATE IS AN RPC PARAMETER.
--
-- 0176 §5 closed this exact shape on `create_procurement_invoice`. `payments`, `purchase_orders`,
-- `purchase_requests` and `rfqs` hold NO client INSERT/UPDATE/DELETE grant at all (verified in the
-- live catalog), so their `create_*` definer RPCs are the WHOLE client write surface and `p_status`
-- is the whole parameter surface. Probed live at 0177, as a PROJECT MANAGER, against a **Draft**
-- procurement:
--
--   select create_payment(<draft case>, null, 'REF', 'Paid', '2026-03-02', 888888)
--     -> PAY-2607290001 | Paid | 888888.00      (and the case is STILL 'Draft')
--
-- `payments.status = 'Paid'` is minted by exactly one sanctioned writer: `transition_procurement`'s
-- `-> Paid` branch, which is **Finance-only** AND carries SoD-b (`approver != payer`, commented there
-- as MUST-run-outside-the-Admin-skip). The RPC bypassed both and produced a document with a real
-- `next_procurement_doc_number` sequence number. Same defect, same table family, same fix as 0176 §5.
--
-- ⚑ THE OTHER THREE RPCs SHARE THE SHAPE AND NOT THE DEFECT — and this file says so rather than
--   gating them on the resemblance. Assuming the shape implies the defect is the same reasoning error
--   that produced this whole slice series, run in reverse. Checked one at a time against "which
--   status does a ROLE-GATED transition mint on this table, that the RPC's own role gate does not
--   already imply?":
--     • purchase_requests -> 'Submitted' is minted by `-> Requested`, allowed to
--       {Executive, Project Manager, Finance, Engineer} — i.e. every write role. No SoD content.
--     • purchase_orders   -> 'Issued'    is minted by `-> Ordered`, allowed to {Project Manager,
--       Finance} — and `create_purchase_order`'s own gate is {Admin, Executive, PM, Finance}. The only
--       role that gains anything is Executive, on a document status, with no money rule attached.
--     • rfqs              -> no transition branch writes this table at all. Nothing to protect.
--   AND the tables are PERMISSIVE CAPTURE by design (FR-PR-017; `0079` AC-PR-014 asserts on purpose
--   that `create_purchase_order` succeeds on an already-Ordered case): they record ERP-canonical
--   documents that may have been raised outside PMO, so a status whitelist is a PRODUCT decision, not
--   a security one. The current behaviour is PINNED in 0171 §B and carried in docs/backlog.md so
--   changing it stays a deliberate, test-visible act — the same mechanism 0175/0176 used for DELETE.
--
-- ⚑ AND A LIVE DEFECT FOUND WHILE SURVEYING THE CALLERS, REPORTED NOT FIXED (it is not this class):
--   `RecordCaptureForm.tsx`'s STATUS_OPTIONS disagree with the tables' CHECK constraints. It offers
--   payment {Pending, Processed, Cleared} against CHECK {Scheduled, Paid} — so EVERY payment capture
--   from that form fails today with 23514 — plus purchase_request {Requested, Rejected} and rfq
--   {Sent, Received}, none of which are legal values either. Tracked in docs/backlog.md.
--
-- WHY THIS BREAKS NO CALLER (verified by reading every one, 2026-07-29):
--   • The gate is `p_status is not null and p_status <> 'Scheduled'`. **NULL is deliberately still
--     accepted** — unlike 0176 §5, whose callers always send a value. Here `pmo-portal/src/lib/db/
--     procurementRecords.ts` `createPayment` forwards a runtime-legal NULL ("permissive capture"), and
--     `supabase/tests/0079_procurement_record_rpcs.test.sql` calls `create_payment(…, null, …)` in
--     four assertions. The RPC's own `coalesce(p_status,'Scheduled')` default is preserved intact.
--   • `transition_procurement`'s `-> Paid` branch inserts the Paid payment row DIRECTLY (not through
--     this RPC) as the definer's postgres owner, so the sanctioned path is untouched.
--   • The historical importer writes `payments` with the service-role client
--     (scripts/lib/historicalImportRecordInsert.mjs), never through this RPC, so terminal-status
--     historical rows still import.
--
-- Body is 0100's verbatim (org + role gate + the same-case invoice invariant + the externally-owned
-- flip guard + the pay_number mint) with ONE inserted check, marked inline.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
create or replace function create_payment(
  p_procurement_id uuid, p_invoice_id uuid, p_reference_number text, p_status text, p_date date, p_amount numeric,
  p_import_key text default null, p_import_batch_id uuid default null, p_imported_at timestamptz default null)
  returns payments language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_row public.payments;
begin
  select org_id into v_org from public.procurements where id = p_procurement_id;
  if v_org is null then raise exception 'procurement not found' using errcode = 'P0002'; end if;
  if v_org is distinct from auth_org_id()
     or auth_role() not in ('Admin','Executive','Project Manager','Finance')
  then raise exception 'not authorized' using errcode = '42501'; end if;
  -- Same-case invariant (0039, AC-PR-SEC-001 / FR-ENA-130d): invoice must belong to the same case.
  if p_invoice_id is not null and not exists (
    select 1 from public.procurement_invoices i
    where i.id = p_invoice_id and i.procurement_id = p_procurement_id
  ) then raise exception 'invoice not in this case' using errcode = '42501'; end if;
  -- Slice 6 addition (AC-ENA-072): a flipped org's payment writes must route through the ERPNext adapter.
  if public.domain_externally_owned(v_org, 'procurement') then
    raise exception 'procurement is externally-owned — payments route through the ERPNext adapter'
      using errcode = '42501';
  end if;
  -- ⚑ 0178: the origination-status gate. NULL is ACCEPTED on purpose (it is the permissive-capture
  -- default, sent by procurementRecords.ts and by four assertions in 0079) and the explicit
  -- `is not null` keeps the condition TOTAL — `p_status <> 'Scheduled'` alone is NULL for a NULL
  -- p_status and would fall through, which is 0176 §6's defect exactly.
  if p_status is not null and p_status <> 'Scheduled' then
    raise exception
      'payments.status "%" is not an origination status: a payment record is captured as Scheduled, and Paid is reached only by paying the case — the transition that is Finance-only and enforces that the approver does not pay their own request',
      p_status
      using errcode = 'P0001';
  end if;
  insert into public.payments
    (procurement_id, invoice_id, pay_number, reference_number, status, date, amount,
     import_key, import_batch_id, imported_at)
    values (p_procurement_id, p_invoice_id, next_procurement_doc_number(v_org, 'PAY'),
            p_reference_number, coalesce(p_status, 'Scheduled'), p_date, p_amount,
            p_import_key, p_import_batch_id, p_imported_at)
    returning * into v_row;
  return v_row;
end; $$;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §3 — incoming_payments INSERT/UPDATE. THE `sales_invoices` TREATMENT, MIRRORED.
--
-- 0176 §4's out-of-scope note excluded this table as "mirror-integrity, not this class"; 0177 §A3
-- re-judged that, revoked its DELETE, and left the INSERT/UPDATE half open and recorded. This closes
-- it. Probed live at 0177 as a plain Project Manager:
--
--   insert incoming_payments (… 'IP-FORGED', 500000, 'Paid', erp_docstatus 1)  -> INSERT 1, audit 0
--   update incoming_payments set status='Paid', amount=999999,
--                                ip_number='IP-REWRITTEN', erp_docstatus=1     -> UPDATE 1, audit 0
--
-- The second is the sharper one: it REWRITES A REAL MIRROR ROW. `erp_docstatus = 1` is the ERP's
-- "submitted" flag and `erp_outstanding_amount` is its paid-detection oracle (0123/0125), so a client
-- that can write them can make PMO assert a receipt ERPNext never issued — and `sales_invoice_id` is
-- the money link the sweep reconciles on. The flip/mirror guards on this table (0123 §5) only fire
-- WHILE the org is externally-owned, and `external_domain_ownership` is empty, so they are inert for
-- every org today. Its twin got the full treatment in 0176 §1; this is that treatment verbatim.
--
-- WHY THIS BREAKS NO CALLER (verified by reading every one, 2026-07-29):
--   • FE DAL — `src/lib/db/revenue.ts` only SELECTs (`listIncomingPayments` 166, `getIncomingPayment`
--     191). There is no `.insert()`, `.update()` or `.upsert()` on this table anywhere in
--     `pmo-portal/src` or `pmo-portal/pages`.
--   • `repositories.revenue.createPayment` does NOT write the table: it dispatches externally with
--     `erp_doc_kind = 'incoming-payment'` (asserted by revenue.external.test.ts), and the mirror row
--     comes back through the service-role writer.
--   • Edge functions — `adapter-dispatch/readModelWriters.ts` writes it with `ctx.serviceClient`
--     (service_role), which holds its own grants and bypasses RLS.
--   • e2e — every write is through the service-role `admin` client (`_sarHelpers.ts:209`,
--     AC-SAR-071:208, AC-SAR-010, AC-SAR-041).
--   • Importers — `scripts/lib/historicalImportRecordInsert.mjs`'s RECORD_TABLE_BY_TYPE does not
--     contain this table.
-- The narrow INSERT re-grant (rather than a full revoke) mirrors 0176 §1's OQ-SAR-6 forward-compat
-- seam so the two AR tables keep the same shape: a client may originate a Scheduled BODY, and can
-- name neither a status, nor the ERP document number, nor any erp_* feed column.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
revoke insert on public.incoming_payments from authenticated, anon;
grant  insert (id, org_id, customer_id, sales_invoice_id, reference_number, date, amount, created_at)
  on public.incoming_payments to authenticated;

revoke update on public.incoming_payments from authenticated, anon;

comment on policy incoming_payments_update on public.incoming_payments is
  'DEAD SINCE 0178 and kept deliberately: the UPDATE grant to authenticated/anon is revoked, so this '
  'policy is never reached. It stays as the second layer if a future migration re-grants UPDATE — '
  'dropping it would make such a re-grant fully open instead of 4-role gated. The sole updater is the '
  'service-role mirror writer. Mirrors the comment 0177 put on incoming_payments_delete.';

create or replace function public.assert_incoming_payment_origination_insert() returns trigger
  language plpgsql set search_path = public as $$
begin
  -- Server-side authority (postgres / service_role / supabase_admin): exempt. ADR-0069.
  if public.actor_bypasses_rls() then
    return new;
  end if;

  -- ⚑ NULL-SAFE (0176 §6): `<>` is NULL for an explicit `status => NULL`, and a NULL condition falls
  -- through to the CHECK constraint — the wrong error, and a silent hole if the CHECK ever relaxes.
  if new.status is distinct from 'Scheduled' then
    raise exception
      'incoming_payments.status "%" is not the origination status: a customer receipt is created as Scheduled, and Paid is reached only through the ERPNext mirror, which is written by the service-role adapter and never by a client',
      new.status
      using errcode = 'P0001';
  end if;

  if new.ip_number is not null then
    raise exception
      'incoming_payments.ip_number cannot be set when a customer receipt is created: the ERP document number is written only by the mirror writer'
      using errcode = 'P0001';
  end if;

  if new.erp_docstatus is not null then
    raise exception
      'incoming_payments.erp_docstatus cannot be set when a customer receipt is created: the ERP feed columns are written only by the mirror writer'
      using errcode = 'P0001';
  end if;

  if new.erp_modified is not null then
    raise exception
      'incoming_payments.erp_modified cannot be set when a customer receipt is created: the ERP feed columns are written only by the mirror writer'
      using errcode = 'P0001';
  end if;

  if new.erp_amended_from is not null then
    raise exception
      'incoming_payments.erp_amended_from cannot be set when a customer receipt is created: the ERP feed columns are written only by the mirror writer'
      using errcode = 'P0001';
  end if;

  if new.erp_cancelled_at is not null then
    raise exception
      'incoming_payments.erp_cancelled_at cannot be set when a customer receipt is created: the ERP feed columns are written only by the mirror writer'
      using errcode = 'P0001';
  end if;

  return new;
end; $$;

drop trigger if exists incoming_payments_origination_guard on public.incoming_payments;
create trigger incoming_payments_origination_guard
  before insert on public.incoming_payments
  for each row execute function public.assert_incoming_payment_origination_insert();

create or replace function public.audit_incoming_payment_insert() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  perform public.log_audit('incoming_payment.create', new.org_id, auth.uid(), new.id,
                           jsonb_build_object('status',           new.status,
                                              'amount',           new.amount,
                                              'ip_number',        new.ip_number,
                                              'sales_invoice_id', new.sales_invoice_id));
  return new;
end; $$;

drop trigger if exists incoming_payments_audit_insert on public.incoming_payments;
create trigger incoming_payments_audit_insert
  after insert on public.incoming_payments
  for each row execute function public.audit_incoming_payment_insert();

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §4 — project_documents: AN APPROVED DOCUMENT'S FILE IS SWAPPABLE BY ITS AUTHOR, UN-AUDITED.
--
-- 0176 §2 removed `author_id` from the UPDATE grant and stopped there. `title`, `file_path`,
-- `revision`, `code`, `category` and `doc_date` stay updatable AT ANY STATUS, and there is no UPDATE
-- trigger and no update audit at all. Probed live at 0177:
--
--   PM authors a Draft "Benign scope of work" -> Issued -> a COLLEAGUE Approves it (the real SoD runs
--   and passes) -> the AUTHOR then updates it to title 'Variation order +5,000,000',
--   file_path 'red/swapped.pdf', revision 'B', code 'DOC-RED-9'    -> UPDATE 1, audit rows: 0
--
-- ⚑ THE SoD IS DEFEATED ON THE GOAL, NOT ON THE TRANSITION. `transition_document_status`'s
--   approver-!=-author check ran, passed, and protected nothing, because what was approved is not what
--   the row now holds.
--
-- ⚑ WHAT THIS FILE CLOSES, AND WHAT IT DELIBERATELY DOES NOT — read this before "finishing" it.
--   The obvious rule ("content columns are immutable once status is distinct from Draft") WOULD BE AN
--   OVER-BLOCK: `pmo-portal/pages/project-detail/tabs/DocumentsTab.tsx:296,538` renders the metadata
--   Edit affordance whenever `canEditDoc(d) && d.status !== 'Closed' && d.status !== 'Superseded'` —
--   i.e. the AUTHOR editing their own Issued/Approved document's metadata is a shipped, unit-tested
--   product affordance, and `updateProjectDocument` (src/lib/db/documents.ts:116) writes exactly
--   code/category/title/revision/doc_date. Removing it is a PRODUCT decision (the product's sanctioned
--   way to change an approved document is `createDocumentRevision`, a new row). So:
--     ✓ CLOSED HERE — `file_path` is immutable once the document leaves Draft. This is the sharp half
--       (swapping the actual FILE behind an approval) and it costs nothing: `onUpload`/`onReplace`
--       render on `d.status === 'Draft'` ONLY (DocumentsTab.tsx:210-211), and the sole other writer,
--       `set_document_file_path` (0025), is a definer owned by postgres and therefore exempt.
--     ✓ CLOSED HERE — every project_documents UPDATE is now audited, with the before/after of each
--       content column. The metadata edit stays possible and stops being invisible.
--     ⚑ STILL OPEN, PINNED, OWNER'S CALL — the metadata edit itself on a non-Draft document. Asserted
--       by 0171 AC-SCC-041 so that closing it is a deliberate, test-visible act, and carried in
--       docs/backlog.md. Naming the UI line here so the owner rules on the affordance and the rule
--       together, not on one of them.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
create or replace function public.assert_project_document_update() returns trigger
  language plpgsql set search_path = public as $$
begin
  -- Server-side authority — including set_document_file_path (0025) and transition_document_status
  -- (0017), both SECURITY DEFINER owned by postgres. ADR-0069.
  if public.actor_bypasses_rls() then
    return new;
  end if;

  -- TOTAL comparisons throughout (0176 §6). `old.status is distinct from 'Draft'` is TRUE for a NULL
  -- status too, which is the fail-closed direction.
  if old.status is distinct from 'Draft'
     and new.file_path is distinct from old.file_path
  then
    raise exception
      'project_documents."%" is % and its file cannot be replaced from the client: the approval in transition_document_status (nobody approves their own document) attests to the FILE THAT WAS APPROVED, so swapping it afterwards would defeat that rule on the goal rather than on the transition — raise a revision instead',
      old.title, old.status
      using errcode = '42501';
  end if;

  return new;
end; $$;

drop trigger if exists project_documents_update_guard on public.project_documents;
create trigger project_documents_update_guard
  before update on public.project_documents
  for each row execute function public.assert_project_document_update();

create or replace function public.audit_project_document_update() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  perform public.log_audit('project_document.update', new.org_id, auth.uid(), new.id,
                           jsonb_build_object('status',        new.status::text,
                                              'author_id',     new.author_id,
                                              'from_title',    old.title,     'to_title',    new.title,
                                              'from_code',     old.code,      'to_code',     new.code,
                                              'from_category', old.category,  'to_category', new.category,
                                              'from_revision', old.revision,  'to_revision', new.revision,
                                              'from_doc_date', old.doc_date,  'to_doc_date', new.doc_date,
                                              'from_file_path',old.file_path, 'to_file_path',new.file_path));
  return new;
end; $$;

drop trigger if exists project_documents_audit_update on public.project_documents;
create trigger project_documents_audit_update
  after update on public.project_documents
  for each row execute function public.audit_project_document_update();

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §5 + §6 + §7 — the `projects` money SoD, repaired in three ways at once.
--
-- ── §5 (MEDIUM): THE SECOND PERSON COULD BE AN OFFBOARDED ACCOUNT ───────────────────────────────
-- `transition_project` and `set_project_contract_value` both re-assert org and role and NEITHER calls
-- `is_active_member()`. `auth_role()` reads `profiles.role` with no status filter, so a DISABLED
-- profile still returns 'Project Manager'. Probed live at 0177:
--
--   disabled PM #1: set_project_contract_value(<deal>, 77000000)              -> ok
--   disabled PM #2: transition_project(<deal>,'Won, Pending KoM','CPO','…')   -> ok
--   => 'Won, Pending KoM | 77000000.00', witnessed by disabled PM #1.
--
-- The two-person rule 0177 had JUST introduced was satisfiable by two offboarded accounts. That lands
-- directly on this slice's own control, so it is fixed here rather than deferred to the wider sweep.
-- `activate_budget_version` (0139) and every `*_write` RLS policy already carry the conjunct; this
-- makes the two money RPCs match them. (⚑ The full `is_active_member()` gap across the other 17 RPCs
-- is a DIFFERENT class and stays its own slice — docs/backlog.md.)
--
-- ── §6: THE RULE ITSELF IS REPLACED — ADR-0070, APPROVAL AUTHORITY IS RANK, NOT A ROLE LIST ─────
-- 0177 shipped "approver != author — ANY second person will do", carved out for an ENUMERATED
-- {Admin, Executive, Finance}, justified in its own header as "set_project_contract_value's own
-- gate". THAT JUSTIFICATION IS FALSE: the RPC has TWO gates and they differ — ON-HAND is
-- {Admin, Executive, Finance}, PRE-WIN is {Admin, Executive, Project Manager}. The list was copied
-- from the wrong branch, and 62 assertions plus two reviewers missed it, because **a list of role
-- literals carries no meaning a reader or a test can check it against.** That is the defect ADR-0070
-- exists to remove, and it is why the fix is not a better list.
--
-- AND THE RULE WAS ALSO WRONG ON ITS MERITS. ADR-0019 §1 says only {Admin, Executive, Finance} may
-- set a contract value on a WON project. Winning a deal is exactly the moment a pipeline value
-- BECOMES a won value — so "any second person" let a PM and a peer PM achieve in two steps what
-- ADR-0019 forbids in one. The easiest second signature is the colleague at the next desk.
--
-- ── THE OWNER'S RULE (ADR-0070) ─────────────────────────────────────────────────────────────────
--   An actor may approve another actor's work when EITHER
--     (1) the approver is the author's LINE MANAGER (profiles.manager_id) — unconditional, whatever
--         the two roles are; that is the point of storing a hierarchy rather than inferring one; OR
--     (2) the approver's role OUTRANKS the author's.
--   Rank, defined in EXACTLY ONE PLACE (public.role_rank):
--     Admin = Executive  >  Finance  >  Project Manager  >  Engineer
--   Operations Manager / Director slot between Finance and Project Manager when they are created,
--   and NO SoD PREDICATE CHANGES. That property is the whole point; it is asserted by 0171.
--
-- ⚑ THE PRECEDENT IS ALREADY IN THE SCHEMA, it was simply never applied to money: transition_timesheet
--   resolves `select manager_id into v_mgr from public.profiles where id = v_owner` for exactly this.
--
-- ⚑ WHY manager_id IS SAFE TO TRUST AS AN AUTHORISATION INPUT (verified against the live catalog,
--   NOT assumed): `profiles_update_self`'s WITH CHECK pins BOTH `role` and `manager_id` to their
--   current values, so a user cannot self-grant approval authority by editing their own supervisor or
--   their own role. Only `profiles_admin_write` (Admin + same org + is_active_member()) can — and an
--   Admin already outranks everyone, so it grants them nothing new. **THAT PIN IS LOAD-BEARING: any
--   future migration touching profiles_update_self must keep it, or every rule built on this ADR
--   silently becomes self-serve.** Asserted by 0171 AC-SCC-076 so it cannot be removed quietly.
--
-- ⚑ FAIL CLOSED ON A MISSING MANAGER. Only 6 of 11 seeded profiles carry a manager_id. A NULL manager
--   falls back to the rank test and must never wave anything through — a NULL-driven exemption is
--   0176 §6's defect exactly. Every comparison below is TOTAL and every helper coalesces to FALSE.
--
-- ── §7 (from 0177 §B1's L4 note): the `set_by IS NULL => exempt` branch ─────────────────────────
-- Commented on the column itself, where a future service-role writer of contract_value will read it.
-- ════════════════════════════════════════════════════════════════════════════════════════════════

comment on column public.projects.contract_value_set_by is
  'WITNESS, never an input: the user who last set contract_value, stamped by '
  'projects_stamp_contract_value_witness. NULL WITH a non-NULL contract_value_set_at means a '
  'server-side authority set it (service_role / postgres / the importer) — which is by construction '
  'not the calling user. Read by transition_project''s money SoD (approver != author). '
  '⚑ 0178: that NULL-actor branch is EXEMPT from the two-person rule, so any FUTURE service-role or '
  'trigger writer of contract_value silently disarms the money SoD for every row it touches. A writer '
  'that acts ON BEHALF OF a user must record that user here (see agent_write_sod_contract_value), not '
  'leave it NULL.';

-- ── §6a. RANK, IN EXACTLY ONE PLACE (ADR-0070) ──────────────────────────────────────────────────
-- ⚑ THIS FUNCTION IS THE ONLY PLACE IN THE SCHEMA THAT ORDERS ROLES. Adding Operations Manager or
--   Director is a one-line change HERE and nowhere else. If you find yourself writing
--   `role in ('Admin','Executive',…)` in a new SoD predicate, that is the defect this replaced.
-- Gaps of 10 are deliberate: a new role slots in without renumbering (Operations Manager -> 25,
-- Director -> 35, say). Admin and Executive are EQUAL at 40 — ADR-0070's ordering has them tied.
create or replace function public.role_rank(p_role user_role) returns int
  language sql immutable set search_path = pg_catalog, public as $$
  select case p_role
           -- Admin > Executive, STRICTLY (owner ruling 2026-07-29, ADR-0070). An earlier draft had
           -- them equal because the role gates list them together — but the owner's profile rule is
           -- "you may edit a profile only if you OUTRANK its owner, and may only assign a role BELOW
           -- your own", and under equality that makes assigning `Executive` impossible for anyone and
           -- an Executive's profile uneditable by anyone. Strictness makes both rules fall out with
           -- no special case. (Admin-may-edit-a-peer-Admin is a separate, explicit carve-out in the
           -- profiles policy — it is NOT expressed here, because rank must stay a strict order.)
           when 'Admin'           then 50
           when 'Executive'       then 40
           when 'Finance'         then 30
           when 'Project Manager' then 20
           when 'Engineer'        then 10
         end
$$;

comment on function public.role_rank(user_role) is
  'ADR-0070 — the ONE definition of role rank: Admin = Executive > Finance > Project Manager > '
  'Engineer. Returns NULL for an unmapped role so every caller FAILS CLOSED (role_outranks and '
  'holds_won_value_authority both coalesce to false). Adding a role is a one-line change here and '
  'must not require editing any SoD predicate — 0171 AC-SCC-075 asserts that property.';

create or replace function public.role_outranks(p_approver user_role, p_author user_role) returns boolean
  language sql immutable set search_path = pg_catalog, public as $$
  -- coalesce(...) so a NULL or unmapped role on EITHER side is "does not outrank" — never an
  -- exemption. A NULL-valued condition does not fire an `if`, which is 0176 §6's defect.
  select coalesce(public.role_rank(p_approver) > public.role_rank(p_author), false)
$$;

-- ADR-0019 §1's threshold, expressed as rank rather than as a list. `{Admin, Executive, Finance}` is
-- exactly `role_rank >= role_rank('Finance')` today (asserted by 0171 AC-SCC-074, which is the
-- falsifiable form of the claim 0177 made in a comment and got wrong). A role added ABOVE Finance
-- inherits won-value authority automatically; one added BELOW it does not. No predicate edit either way.
create or replace function public.holds_won_value_authority(p_role user_role) returns boolean
  language sql immutable set search_path = pg_catalog, public as $$
  select coalesce(public.role_rank(p_role) >= public.role_rank('Finance'), false)
$$;

-- The PRE-WIN counterpart, and the one place Finance's authority changed (owner ruling 2026-07-29).
-- ADR-0019's original pre-win gate was the literal list {Admin, Executive, Project Manager} —
-- Finance EXCLUDED, on the reasoning that a pipeline figure is a sales estimate, not an accounting
-- one. ADR-0070 then made Finance outrank a PM for money, which created a contradiction the pgTAP
-- caught rather than a human: the rank rule said Finance could ratify a PM's figure, and this gate
-- refused to let Finance write it, so the ratifier pool silently collapsed to Admin/Executive/line
-- manager. The owner ruled Finance IN. Expressed as rank so the next role added above Engineer
-- inherits the right answer without editing this predicate.
create or replace function public.holds_pipeline_value_authority(p_role user_role) returns boolean
  language sql immutable set search_path = pg_catalog, public as $$
  select coalesce(public.role_rank(p_role) >= public.role_rank('Project Manager'), false)
$$;

comment on function public.holds_pipeline_value_authority(user_role) is
  'ADR-0019 §1 pre-win gate as RANK: may this role set a contract value while the deal is still in '
  'the pipeline? True at Project Manager rank and above — so Admin, Executive, Finance and PM, and '
  'NOT Engineer. Finance was added 2026-07-29 by owner ruling: ADR-0070 makes Finance outrank a PM '
  'for money, so Finance must be able to WRITE the figure it is trusted to ratify. NULL/unmapped '
  'roles coalesce to false (fail closed).';

comment on function public.holds_won_value_authority(user_role) is
  'ADR-0019 §1 as RANK, not a role list: may this role be the final word on a WON project''s '
  'contract value? True for Finance and anything that outranks it. This is the threshold that '
  'decides whether winning a priced deal needs a second person at all.';

-- "May p_approver_id approve work authored by p_author_id?" — ADR-0070's two limbs, and the only
-- place they are combined. SECURITY DEFINER for the same reason auth_role()/auth_org_id() are: it
-- must read profiles rows RLS would hide. It reads no `current_user`, so ADR-0069 property 1 does
-- not apply. Cross-org is refused explicitly rather than left to RLS the definer has bypassed.
create or replace function public.may_approve_work_of(p_approver_id uuid, p_author_id uuid)
  returns boolean language sql stable security definer set search_path = pg_catalog, public as $$
  select coalesce(
    (select
         -- (1) LINE MANAGEMENT — unconditional, whatever the two roles are. `author.manager_id is
         --     not null` is explicit: a NULL manager must never match a NULL approver id.
         (author.manager_id is not null and author.manager_id = p_approver_id)
         -- (2) RANK.
         or public.role_outranks(approver.role, author.role)
       from public.profiles author
       join public.profiles approver on approver.org_id = author.org_id
      where author.id = p_author_id and approver.id = p_approver_id),
    false)
$$;

comment on function public.may_approve_work_of(uuid, uuid) is
  'ADR-0070 — the ONE approval-authority predicate: TRUE when the approver is the author''s line '
  'manager (profiles.manager_id, unconditional) OR the approver''s role outranks the author''s. '
  'Coalesces to FALSE, so a missing profile, a cross-org pair or a NULL manager_id FAILS CLOSED. '
  '⚑ profiles_update_self pins BOTH role and manager_id, so a user cannot self-grant this — that '
  'pin is load-bearing for every rule built on this function.';

grant execute on function public.role_rank(user_role),
                          public.role_outranks(user_role, user_role),
                          public.holds_won_value_authority(user_role),
                          public.may_approve_work_of(uuid, uuid)
  to authenticated, anon;

create or replace function set_project_contract_value(p_id uuid, p_value numeric)
  returns void language plpgsql security definer set search_path = public as $$
declare
  v_status project_status;
  v_org    uuid;
  v_old    numeric;
  v_role   user_role := auth_role();
  v_on_hand constant text[] := array['Won, Pending KoM','Ongoing Project','On Hold','Close Out'];
begin
  -- FR-HRD-040: reject an invalid value here for the human-readable message; the column CHECK/
  -- NOT NULL are the authority for every UPDATE writer. Null is distinguished from out-of-range
  -- (negative/NaN/Infinity) so the diagnosis is useful; the out-of-range message is asserted
  -- verbatim by pgTAP 0162 for both the negative and the NaN case, so keep it exact.
  if p_value is null then
    raise exception 'contract value is required' using errcode = '23502';
  end if;
  if not (p_value >= 0 and p_value < 'Infinity'::numeric) then
    raise exception 'contract value must be a non-negative number' using errcode = '23514';
  end if;

  select status, org_id, contract_value
    into v_status, v_org, v_old
    from public.projects where id = p_id for update;
  if v_status is null then
    raise exception 'project not found' using errcode = 'P0002';
  end if;

  -- SECURITY: this org re-assertion MUST stay — removing it leaks cross-org writes.
  if v_org is distinct from auth_org_id() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  -- ⚑ 0178 (§5). SECURITY: this active-membership conjunct MUST stay. Without it a DISABLED profile
  -- still satisfies auth_role() (it reads profiles.role with no status filter), so an offboarded
  -- account can author the contract value that transition_project's money SoD then treats as a
  -- legitimate second person. Probed live at 0177: two disabled PMs landed a 77,000,000 won deal
  -- between them. Matches activate_budget_version (0139) and every *_write RLS policy.
  if not public.is_active_member() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  -- SECURITY: this role/status gate MUST stay (ADR-0019 SoD).
  -- ⚑ 0178 (ADR-0070): the ON-HAND branch's enumerated {Admin, Executive, Finance} is replaced by
  -- the rank threshold it always meant. PROVABLY IDENTICAL TODAY — role_rank >= role_rank('Finance')
  -- selects exactly those three, asserted by 0171 AC-SCC-074 — so this is a refactor, not a
  -- behaviour change, and the message is unchanged and still asserted verbatim by 0162.
  -- ⚑ The PRE-WIN branch was correctly LEFT AS A LIST by the first draft of this migration, on the
  -- grounds that {Admin, Executive, Project Manager} is NOT a rank prefix — it excludes Finance
  -- while including a role Finance outranks — so converting it would be a behaviour change and a
  -- PRODUCT DECISION, not a refactor. That was the right call, and the decision has now been taken:
  -- **owner ruling 2026-07-29 — Finance IS in.**
  --
  -- The contradiction that forced it: ADR-0070 makes Finance outrank a Project Manager for money,
  -- so the money SoD offers Finance as a ratifier of a PM's figure — while this gate refused to let
  -- Finance WRITE that figure before the win. The ratifier pool silently collapsed to
  -- {Admin, Executive, the PM's own line manager}. ⚑ The pgTAP caught this, not a human: five
  -- assertions in 0170/0171 failed on "a FINANCE user ratifies the PM's figure". The same two-gate
  -- confusion had already produced a wrong role list in 0177's header and a wrong remedy in a
  -- user-facing error message — third occurrence, first time a test was the thing that caught it.
  --
  -- Now a rank prefix (Project Manager and above), so it converts cleanly and a future
  -- Operations Manager / Director inherits the right answer with no edit here.
  if v_status::text = any(v_on_hand) then
    if not public.holds_won_value_authority(v_role) then
      raise exception 'changing the contract value on a won project requires Executive or Finance'
        using errcode = '42501';
    end if;
  else
    if not public.holds_pipeline_value_authority(v_role) then
      raise exception 'not authorized to set the contract value' using errcode = '42501';
    end if;
  end if;

  update public.projects
    set contract_value = p_value,
        last_update    = now()
  where id = p_id;

  perform public.log_audit('project.contract_value.set', v_org, auth.uid(), p_id,
                           jsonb_build_object('from', v_old, 'to', p_value));
end; $$;

-- Body is 0177 §B2's verbatim with TWO deltas, both marked inline: the active-membership conjunct
-- (§5) and the two corrected refusal messages (§6). The transition map, the org re-assertion, the
-- coarse role gate, the legality check, the money-SoD predicate itself, all three update branches and
-- the log_audit call are unchanged.
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

  -- ⚑ 0178 (§5). SECURITY: this active-membership conjunct MUST stay — see the twin comment in
  -- set_project_contract_value. Two DISABLED Project Managers satisfied the money SoD between them
  -- before this line existed (probed live at 0177).
  if not public.is_active_member() then
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
    -- ⚑ 0178 REPLACES 0177's RULE (ADR-0070). 0177 said "approver != author, any second person" and
    -- carved out an ENUMERATED {Admin, Executive, Finance} on a justification that was false (see the
    -- file header §6). The rule is now RANK + LINE MANAGEMENT, and it reads in three clauses:
    --
    --   (i)   there is money on the row                       -> otherwise nothing to ratify;
    --   (ii)  the WINNER does not themselves hold won-value authority (ADR-0019 §1, as rank) ->
    --         a Finance/Executive/Admin winner is already the accountable party and needs nobody;
    --   (iii) the value was NOT authored by someone who may approve THIS winner's work — i.e. not by
    --         the winner's line manager and not by anyone who outranks them.
    --
    -- The direction in (iii) is the subtle part and a first draft got it backwards: the question is
    -- NOT "may the winner approve the value's author?" but "did someone with authority OVER THE
    -- WINNER put their name on this number?" A PM whose line manager set the value is cleared; a PM
    -- whose PEER set it is NOT — which is the behaviour change ADR-0070 makes, and the reason a
    -- second signature can no longer be the colleague at the next desk.
    --
    -- Every clause is TOTAL: `coalesce(v_value,0)`, an explicit `v_set_at is null` branch, and three
    -- helpers that all coalesce to FALSE. A missing manager_id (5 of 11 seeded profiles) falls back
    -- to the rank test and can never wave a win through — 0176 §6's defect, not repeated.
    --
    -- ⚑ `v_set_by IS NULL with a non-NULL v_set_at` is deliberately NOT refused: that is the witness
    --   shape of a SERVER-SIDE authority (seed.sql / the historical importer / service_role, where
    --   auth.uid() is NULL). It is not a person, so it has no rank, and refusing it would block every
    --   seeded and imported deal. Pinned by 0170 AC-PMS-019.
    if coalesce(v_value, 0) > 0
       and not public.holds_won_value_authority(v_role)
       and (    v_set_at is null                                          -- no witness -> FAIL CLOSED
             or (v_set_by is not null and not public.may_approve_work_of(v_set_by, auth.uid())) )
    then
      if v_set_at is null then
        raise exception
          'this deal''s contract value has no recorded author, so you cannot win it: the value must be set by your supervisor or by someone who outranks you, through set_project_contract_value (which records who set it) — or ask them to win the deal'
          using errcode = '42501';
      else
        raise exception
          'this deal''s contract value was not set by anyone senior to you, so you cannot win it: it must be confirmed by your supervisor or by someone who outranks you, through set_project_contract_value (which records who set it) — or ask them to win the deal'
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

-- ── The cascade-aware rewrite of 0177 §A1's delete guard (see §0) ───────────────────────────────
-- ONE line differs from 0177 §A1: the exemption predicate. With it, an Admin's project hard-delete
-- (projects_delete_admin_only, 0052) now REALLY does cascade through this trigger with the same
-- actor and pass its Admin carve-out — which is what 0177's header claimed and did not deliver, so
-- the carve-out becomes load-bearing in fact and not only in the comment.
create or replace function public.assert_budget_version_delete() returns trigger
  language plpgsql set search_path = public as $$
begin
  -- ⚑ 0178: is_unattributed_authority(), NOT actor_bypasses_rls(). A cascade runs as the referenced
  -- table's owner, so current_user is postgres and the old predicate exempted every client-initiated
  -- cascade before this rule was ever evaluated. See §0 and ADR-0069 property 5.
  if public.is_unattributed_authority() then
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

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §8 — HYGIENE. Small, each one probed.
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- I3. `projects_contract_value_set_by_fkey` was the ONLY foreign key on `projects` without a covering
-- index (client_id / org_id / project_manager_id all have one). Probed against the live catalog.
-- Without it, deleting or updating a `profiles` row seq-scans `projects` to check the constraint.
create index if not exists projects_contract_value_set_by_idx
  on public.projects (contract_value_set_by);

-- L1. `timesheets.submitted_at` was client-INSERTable, so a Draft sheet could be created carrying a
-- forged submission timestamp — which corrupts 0174 §1's post-submit forensic heuristic at its source.
-- Probed live at 0177: an inserted Draft carried submitted_at = 2020-01-01. The ONLY sanctioned writer
-- is `transition_timesheet` (verified in the catalog: it is the only function whose body mentions the
-- column), the FE's `createDraftTimesheet` (src/lib/db/timesheets.ts:93) sends exactly
-- {user_id, week_start_date, status:'Draft'}, and `_tspHelpers.ts:247` writes it through the
-- service-role `admin` client, which is unaffected by a revoke from `authenticated`. The re-granted
-- list is 0175 FR-CPS-041's INSERT set MINUS submitted_at (approved_by/approved_at stay in the grant
-- and are covered by assert_timesheet_origination_insert's own branches, unchanged).
revoke insert on public.timesheets from authenticated, anon;
grant  insert (id, org_id, user_id, week_start_date, status, approved_by, approved_at)
  on public.timesheets to authenticated;

-- L2. Latent DELETE grants with NO DELETE policy: `procurements` and `timesheets` are closed TODAY by
-- POLICY ABSENCE ALONE (a client DELETE matches 0 rows — verified live: `DELETE 0`), which means a
-- single future `create policy … for delete` re-opens a destructive path nobody re-reviewed. Revoke
-- the grants so the closure rests on two independent layers instead of one.
-- ⚑ `budget_line_items` is DELIBERATELY NOT included, and the brief that named it was wrong: its
--   DELETE rides on the FOR ALL `budget_line_items_write` policy and IS a live, legitimate capability
--   (a PM deleting a line item from a DRAFT version — probed live: `DELETE 1`, and
--   `budget_line_items_draft_guard` is what bounds it). Revoking it would break the Draft budget
--   editor. Asserted as a control in 0171 §H.
revoke delete on public.procurements, public.timesheets from authenticated, anon;

-- L3. The three procure-to-pay child tables: their `create_procurement_*` definer RPCs are the sole
-- client write path (0174/0175) and NONE of the three inserts was audited — 0177 added AFTER DELETE
-- audits to all five mirror tables and left the create side of these three silent. Same 0076 §4
-- convention, firing for all roles.
create or replace function public.audit_procurement_invoice_insert() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  perform public.log_audit('procurement_invoice.create', new.org_id, auth.uid(), new.id,
                           jsonb_build_object('status',         new.status::text,
                                              'amount',         new.amount,
                                              'vi_number',      new.vi_number,
                                              'procurement_id', new.procurement_id));
  return new;
end; $$;

drop trigger if exists procurement_invoices_audit_insert on public.procurement_invoices;
create trigger procurement_invoices_audit_insert
  after insert on public.procurement_invoices
  for each row execute function public.audit_procurement_invoice_insert();

create or replace function public.audit_procurement_receipt_insert() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  perform public.log_audit('procurement_receipt.create', new.org_id, auth.uid(), new.id,
                           jsonb_build_object('status',         new.status::text,
                                              'gr_number',      new.gr_number,
                                              'receipt_date',   new.receipt_date,
                                              'procurement_id', new.procurement_id));
  return new;
end; $$;

drop trigger if exists procurement_receipts_audit_insert on public.procurement_receipts;
create trigger procurement_receipts_audit_insert
  after insert on public.procurement_receipts
  for each row execute function public.audit_procurement_receipt_insert();

create or replace function public.audit_procurement_quotation_insert() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  perform public.log_audit('procurement_quotation.create', new.org_id, auth.uid(), new.id,
                           jsonb_build_object('is_selected',    new.is_selected,
                                              'total_amount',   new.total_amount,
                                              'vq_number',      new.vq_number,
                                              'vendor_id',      new.vendor_id,
                                              'procurement_id', new.procurement_id));
  return new;
end; $$;

drop trigger if exists procurement_quotations_audit_insert on public.procurement_quotations;
create trigger procurement_quotations_audit_insert
  after insert on public.procurement_quotations
  for each row execute function public.audit_procurement_quotation_insert();
