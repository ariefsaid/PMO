-- 0176_create_path_sod_residuals.sql — slice 4 of the create-path SoD class: the residuals three
-- reviewers found after slices 1-3 declared it closed.
-- docs/specs/create-path-sod-class.spec.md §Slice 4; proven by supabase/tests/0169_create_path_sod_residuals.test.sql.
-- Slice 1 = 0173 (`projects`), slice 2 = 0174 (five more tables), slice 3 = 0175 (the UPDATE half).
--
-- ── THE CLASS, RESTATED — THIS IS WHAT KEPT BEING MISSED ────────────────────────────────────────
-- SoD is enforced on the TRANSITION, so the attacker never transitions: they CREATE or EDIT the row
-- into the protected state by a path the transition does not own. There are THREE such paths
-- (INSERT, UPDATE, DELETE) and THREE variants of table shape (asymmetric grants / asymmetric policies
-- / a blanket grant with nothing to contrast against). A fix that closes one path, or that finds one
-- variant, READS COMPLETE AND IS NOT. The class was declared closed twice and was not closed either
-- time. Everything below was verified by live probe against the local DB at 0175 before it was
-- written, and each probe is replayed as an assertion in 0169.
--
-- ⚑ The sweep that finds this class is NOT "which tables have asymmetric grants". It is: for every
--   rule a transition RPC enforces, ask "what else can put the row in that state?" — a blanket grant
--   (sales_invoices), a guard on the wrong column (project_documents), a state the RPC never
--   validates (projects.contract_value), an untouched table (budget_versions), and an RPC PARAMETER
--   (create_procurement_invoice) are all answers, and none of them is a grant asymmetry.
--
-- ── WHAT THIS FILE CLOSES ───────────────────────────────────────────────────────────────────────
-- §1 sales_invoices (CRITICAL — the SoD was defeated end-to-end)
-- §2 project_documents — the guard protected `status`; `author_id` is the SoD subject
-- §3 projects — transition_project wrote NO audit row (the money SoD itself stays OPEN; see §3)
-- §4 budget_versions — same class, untouched by slices 1-3
-- §5 create_procurement_invoice — the protected end state was a PARAMETER
-- §6 three-valued logic — every guard shipped so far fell through on an explicit `status => NULL`
--
-- ── WHAT THIS FILE DELIBERATELY DOES NOT CLOSE (all pinned by assertions in 0169) ────────────────
--   • the projects money SoD itself (§3 "STILL OPEN"),
--   • DELETE on sales_invoices (§1 "STILL OPEN"; same shape 0175 left open on the procure-to-pay
--     child tables, same ADR-0018/ADR-0019 decision),
--   • create_procurement_receipt's requester carve-out (a RATIFIED contract, AC-AUTHZ-007),
--   • `incoming_payments` — the AR twin of sales_invoices carries the identical blanket grants, but
--     it has NO transition RPC and NO SoD rule to bypass, so it is a mirror-integrity question
--     (0123's flip design), not this class. Reported to the Director, not fixed here.
--
-- ── SCOPE: WHO IS ENFORCED (identical to 0173/0174/0175, and asserted) ──────────────────────────
-- The new guards enforce on roles SUBJECT to RLS and EXEMPT roles that already BYPASS it
-- (postgres / service_role / supabase_admin) via public.actor_bypasses_rls() — ADR-0069. That is
-- exactly the RLS trust boundary: a BYPASSRLS role holds a server-side secret and is an authority,
-- not a client. The probed exploits are all `authenticated` PostgREST requests.
--
-- ── REVERSIBILITY (ADR-0006) ────────────────────────────────────────────────────────────────────
-- ⚑ NOT `supabase db reset` — v0.8.0 is in production and a reset there is destructive and
-- local-only. The manual reverse, statement for statement:
--   -- §1 (⚑ RESTORES THE VULNERABLE STATE — this is the hole: it re-opens the one-statement forged
--   --     Paid invoice AND the author-forgery that lets the body-writer clear their own submit)
--   drop trigger if exists sales_invoices_origination_guard on public.sales_invoices;
--   drop trigger if exists sales_invoices_audit_insert      on public.sales_invoices;
--   drop function if exists public.assert_sales_invoice_origination_insert();
--   drop function if exists public.audit_sales_invoice_insert();
--   grant insert, update on public.sales_invoices to authenticated;
--   -- §2 (⚑ likewise: it re-opens the forged-author document and the three-statement self-approval)
--   drop policy if exists project_documents_insert_self_author on public.project_documents;
--   alter table public.project_documents alter column author_id drop default;
--   revoke update on public.project_documents from authenticated;
--   grant update (id, org_id, project_id, code, category, title, revision, doc_date, author_id,
--                 file_path, created_at) on public.project_documents to authenticated;
--   -- and re-apply 0174 §3's audit_project_document_insert() body (drops the author_id detail).
--   -- §3 re-apply 0008 A4/A5's transition_project body (drops the audit row).
--   -- §4 drop trigger if exists budget_versions_origination_guard on public.budget_versions;
--   --    drop function if exists public.assert_budget_version_origination_insert();
--   --    grant insert on public.budget_versions to authenticated;
--   -- §5 re-apply 0100 §4's create_procurement_invoice body (drops the origination-status gate).
--   -- §6 re-apply 0175 §3/§5's and 0174 §2a/§3's guard bodies (restores the NULL fall-through).

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §1 — sales_invoices. THE SoD WAS DEFEATED END TO END.
--
-- 0123 handed `authenticated` a BLANKET `select, insert, update, delete` and relied on the per-command
-- flip policies as "the real gate". They are not a gate for an org that is not flipped — which is
-- every org today (`external_domain_ownership` is empty) — and the mirror guard (0123 §5, 0125) only
-- fires WHILE flipped. So on a normal org the whole table was writable by any Admin/Exec/PM/Finance
-- member. Two distinct forgeries, both probed live at 0175:
--
--   (a) `insert … values (…, 'Paid', 777777, 'SI-FORGED-001', erp_docstatus 1)` as a PROJECT MANAGER —
--       not even an AR role — in ONE statement, with ZERO audit rows.
--   (b) THE SoD ITSELF. `grant_sales_invoice_submit_clearance` / `submit_sales_invoice` read exactly
--       two sources: `sales_invoices.author_user_id` and the append-only `sales_invoice_authors` set.
--       Both are written ONLY inside `claim_sales_invoice_author` (0132/0133) and the service-role
--       mirror writer. Writing the invoice BODY through the direct table path bypassed both: the
--       writer set `author_user_id` to anyone they liked and created NO authors row, so the person who
--       chose the number cleared their own submit — defeating a rule 0132's own header states as
--       "NOBODY WHO EVER WROTE THE BODY MAY APPROVE". The elaborate row-lock / clearance / fencing-token
--       machinery of 0132+0133 was all downstream of an oracle a client could simply write.
--
-- WHY THIS BREAKS NO CALLER (verified by reading every one, 2026-07-29):
--   • FE DAL — `src/lib/db/revenue.ts` only SELECTs `sales_invoices` (listSalesInvoices /
--     getSalesInvoice / getRevenueByProject) and calls the `submit_sales_invoice` RPC. There is no
--     `.insert()`, `.update()` or `.upsert()` on the table anywhere in `pmo-portal/src` or
--     `pmo-portal/pages`.
--   • Edge functions — `adapter-dispatch/readModelWriters.ts` writes it with `ctx.serviceClient`
--     (service_role), which holds its own grants and BYPASSES RLS: untouched by a revoke from
--     `authenticated`. Its author stamp is the sanctioned one.
--   • e2e — every `sales_invoices` write in `pmo-portal/e2e` goes through the `admin` (service-role)
--     client (`_sarHelpers.ts`, AC-SAR-0*).
--   • Importers — `scripts/import-historical.mjs` never touches the table (see
--     `scripts/lib/historicalImportRecordInsert.mjs` RECORD_TABLE_BY_TYPE).
--
-- INSERT keeps a NARROW re-grant rather than a full revoke, because 0123 built this table with a
-- deliberate forward-compat seam for a future PMO-native revenue path (OQ-SAR-6). The seam survives
-- and is now SoD-safe: a client may originate a Draft BODY, but cannot name a status, an ERP document
-- number, any erp_* feed column, or an author — and an invoice with no author FAILS CLOSED at submit
-- (0127 §B's rule, preserved through 0133). UPDATE gets NO re-grant: every body column is one that
-- `claim_sales_invoice_author` must witness, so a direct table UPDATE of ANY of them is precisely the
-- bypass, and the caller survey found no client updater to preserve.
--
-- ⚑ STILL OPEN — DELETE. `authenticated` keeps the 0123 table DELETE grant plus a permissive DELETE
--   policy, so a plain PM can erase a mirror row — a Paid invoice included — with no audit row.
--   Verified live at 0175 (`delete from sales_invoices where id = <a Paid invoice>` -> DELETE 1).
--   Left open DELIBERATELY and identically to 0175's procure-to-pay child tables: the right shape is
--   an ADR-0018/ADR-0019 decision (soft-archive vs Admin-only destructive delete vs a definer RPC with
--   an audit write), not a grant tweak smuggled into a create-path slice. Pinned by 0169 AC-RES-019 so
--   closing it is a deliberate, test-visible act. Tracked in docs/backlog.md.
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- 1a. The grant layer — what a real attacker hits (42501 at the privilege check, before any trigger).
-- Same Postgres semantics as 0008 A6 / 0010 / 0174: a TABLE-level grant covers every column and is NOT
-- reduced by a column-level REVOKE, so the table-wide grant must be revoked and re-granted narrower.
-- Snapshot semantics (inherited, deliberately unchanged): a column added to sales_invoices in a FUTURE
-- migration is NOT insertable by `authenticated` until that migration grants it explicitly.
-- `anon` is re-asserted so the resulting state does not depend on a reader also finding 0105.
revoke insert on public.sales_invoices from authenticated, anon;
grant  insert (id, org_id, project_id, customer_id, reference_number, invoice_date, amount, created_at)
  on public.sales_invoices to authenticated;

revoke update on public.sales_invoices from authenticated, anon;

-- 1b. The trigger layer — defence in depth behind 1a, and the layer that NAMES the offending column
-- (the grant layer's 42501 names nothing). Each withheld column gets its own branch: a single combined
-- message would leave the caller guessing which of the eight was rejected.
create or replace function public.assert_sales_invoice_origination_insert() returns trigger
  language plpgsql set search_path = public as $$
begin
  -- Server-side authority (postgres / service_role / supabase_admin): exempt. See the header.
  if public.actor_bypasses_rls() then
    return new;
  end if;

  -- ⚑ NULL-SAFE (§6): `new.status <> 'Draft'` is NULL for an explicit `status => NULL`, and a NULL
  -- condition FALLS THROUGH. `is distinct from` is the total comparison.
  if new.status is distinct from 'Draft' then
    raise exception
      'sales_invoices.status "%" is not the origination status: an invoice is created as a Draft, and Submitted / Unpaid / Paid are reached only through the ERPNext mirror, whose submit is gated by grant_sales_invoice_submit_clearance (nobody who wrote the body may approve it)',
      new.status
      using errcode = 'P0001';
  end if;

  if new.si_number is not null then
    raise exception
      'sales_invoices.si_number cannot be set when a sales invoice is created: the ERP document number is written only by the mirror writer'
      using errcode = 'P0001';
  end if;

  if new.author_user_id is not null then
    raise exception
      'sales_invoices.author_user_id cannot be set when a sales invoice is created: authorship is recorded only by claim_sales_invoice_author, which is what the submit SoD reads'
      using errcode = 'P0001';
  end if;

  if new.erp_docstatus is not null then
    raise exception
      'sales_invoices.erp_docstatus cannot be set when a sales invoice is created: the ERP feed columns are written only by the mirror writer'
      using errcode = 'P0001';
  end if;

  if new.erp_outstanding_amount is not null then
    raise exception
      'sales_invoices.erp_outstanding_amount cannot be set when a sales invoice is created: the outstanding balance is the ERP''s paid-detection oracle, written only by the mirror writer'
      using errcode = 'P0001';
  end if;

  if new.erp_modified is not null then
    raise exception
      'sales_invoices.erp_modified cannot be set when a sales invoice is created: the ERP feed columns are written only by the mirror writer'
      using errcode = 'P0001';
  end if;

  if new.erp_amended_from is not null then
    raise exception
      'sales_invoices.erp_amended_from cannot be set when a sales invoice is created: the ERP feed columns are written only by the mirror writer'
      using errcode = 'P0001';
  end if;

  if new.erp_cancelled_at is not null then
    raise exception
      'sales_invoices.erp_cancelled_at cannot be set when a sales invoice is created: the ERP feed columns are written only by the mirror writer'
      using errcode = 'P0001';
  end if;

  return new;
end; $$;

drop trigger if exists sales_invoices_origination_guard on public.sales_invoices;
create trigger sales_invoices_origination_guard
  before insert on public.sales_invoices
  for each row execute function public.assert_sales_invoice_origination_insert();

-- 1c. Audit every create (0076 convention: a postgres-owned SECURITY DEFINER trigger fn calling
-- log_audit, which is granted to no client role, so the body may write the FORCE-RLS append-only
-- audit_events). Fires for ALL roles including the service-role mirror writer — a create is a create,
-- and for THIS table the mirror writer is the normal originator, so excluding it would audit only the
-- exotic path. auth.uid() is unaffected by the definer switch and is NULL for a service-role write,
-- per the audit_events.actor_id contract.
create or replace function public.audit_sales_invoice_insert() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  perform public.log_audit('sales_invoice.create', new.org_id, auth.uid(), new.id,
                           jsonb_build_object('status',         new.status,
                                              'amount',         new.amount,
                                              'project_id',     new.project_id,
                                              'si_number',      new.si_number,
                                              'author_user_id', new.author_user_id));
  return new;
end; $$;

drop trigger if exists sales_invoices_audit_insert on public.sales_invoices;
create trigger sales_invoices_audit_insert
  after insert on public.sales_invoices
  for each row execute function public.audit_sales_invoice_insert();

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §2 — project_documents: 0174's guard PROTECTED THE WRONG COLUMN.
--
-- 0174 §3 checked `new.status` only. `author_id` is the actual SoD subject — `transition_document_status`
-- refuses `Approved`/`Rejected` when `auth.uid()` IS the author — and it was INSERT-granted with nothing
-- pinning it to the caller. Probed live at 0175: a PM inserts a DRAFT document naming a COLLEAGUE as
-- author_id (which 0174's guard happily allows, the status being legal), then
-- transition_document_status(…,'Issued') -> (…,'Approved'). Self-approval in three statements, and
-- 0174's audit row recorded status/project_id/category but NOT author_id — so the forgery was not even
-- in the audit detail.
--
-- `procurements` has had the right control since 0051: a column DEFAULT of auth.uid() plus a RESTRICTIVE
-- INSERT policy pinning `requested_by_id = auth.uid()`, plus removal of the column from the UPDATE
-- grant. All three parts are mirrored here.
--
-- WHY THIS BREAKS NO CALLER (verified by reading every one, 2026-07-29):
--   • `createProjectDocument` and `createDocumentRevision` (src/lib/db/documents.ts) both send
--     `author_id: authorId`, and `useDocuments.ts` sources that from the CURRENT USER id — never from
--     the form. `updateProjectDocument` deliberately never touches author_id.
--   • Inserts that OMIT author_id (supabase/tests/0052 AC-DOC-101's shape) keep working: the column
--     DEFAULT stamps the caller, so they satisfy the restrictive policy instead of being rejected by it.
--     This is why the default is not optional — without it, the policy would break AC-DOC-101.
--   • An explicit NULL author IS now rejected. That is deliberate and is a second, smaller hole
--     closed: `transition_document_status` compares `v_uid is not distinct from v_author`, so a NULL
--     author made the SoD FAIL OPEN (anyone could approve an unattributable document). Compare
--     `submit_sales_invoice`, which fails CLOSED on the same condition.
--   • Fixtures/seed insert as postgres (BYPASSRLS) and are unaffected; the definer RPCs (0025's
--     set_document_file_path, 0076's transition) run as their postgres owner.
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- 2a. Server-stamp the author (the client may omit it entirely).
alter table public.project_documents alter column author_id set default auth.uid();

-- 2b. Restrictive INSERT policy: a SUPPLIED author_id MUST be the caller. Restrictive AND-combines
-- with the permissive project_documents_write (org + 4-role + parent-org), so INSERT now requires all
-- of those AND self-authorship. `(select auth.uid())` is the initplan-cached form (one evaluation per
-- statement rather than per row).
drop policy if exists project_documents_insert_self_author on public.project_documents;
create policy project_documents_insert_self_author on public.project_documents
  as restrictive
  for insert
  with check (author_id = (select auth.uid()));

comment on policy project_documents_insert_self_author on public.project_documents is
  'A document''s author_id is the SoD subject of transition_document_status (approver must not be the '
  'author), so it must be the caller — a PM could otherwise create a document naming a colleague as '
  'author and then approve it themselves. Mirrors procurements_insert_self_requester (0051).';

-- 2c. Close the edit path of the same column: `author_id` was in 0075's UPDATE grant, so a 4-role
-- insider could re-point it after the insert. The re-granted list is 0075's, MINUS author_id (status
-- was already removed by 0017 and stays removed). `anon` lost its write DML in 0105; re-asserted here.
revoke update on public.project_documents from authenticated, anon;
grant  update (id, org_id, project_id, code, category, title, revision, doc_date, file_path, created_at)
  on public.project_documents to authenticated;

-- 2d. The audit row now records the SoD subject. 0174's detail named status/project_id/category, so a
-- forged authorship left no trace anywhere. Every other line is 0174 §3's verbatim.
create or replace function public.audit_project_document_insert() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  perform public.log_audit('project_document.create', new.org_id, auth.uid(), new.id,
                           jsonb_build_object('status',     new.status::text,
                                              'project_id', new.project_id,
                                              'category',   new.category,
                                              'author_id',  new.author_id));
  return new;
end; $$;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §3 — projects: THE MONEY SoD IS STILL OPEN, AND 0173's HEADER SAID OTHERWISE.
--
-- ⚑ 0173's header justified leaving contract_value insertable with: "the SoD is about the WON value,
--   which transition_project + set_project_contract_value own." THAT CLAIM IS FALSE and is corrected
--   in place in 0173 by this change. `transition_project` (0008 A4/A5) never reads, requires or
--   re-validates `contract_value` on ANY branch — verified by reading it and by probe at 0175:
--
--     insert projects (…, 'Leads', contract_value 99999999)          -> INSERT 1   (as a plain PM)
--     transition_project(… ,'PQ Submitted') / ('Quotation Submitted')-> ok
--     transition_project(… ,'Won, Pending KoM','CPO-1','2026-03-02') -> ok
--     => 'Won, Pending KoM | 99999999.00', reached ALONE.
--
--   `set_project_contract_value`'s Admin/Executive/Finance gate (0014) binds only once the project is
--   ALREADY on-hand, so the value rides in under the pre-win branch and is never re-approved.
--
-- ⚑ STILL OPEN, DELIBERATELY. Closing it properly is a PRODUCT decision with two valid shapes and
--   real blast radius, and neither belongs in a create-path repair slice:
--     (a) gate the pipeline->Won edge on Admin/Executive/Finance — a true two-person rule, but it
--         removes "win the deal" from the Project Manager role that owns the pipeline, and changes
--         policy.ts, the Won affordance and the e2e journeys with it;
--     (b) require re-approval of the value on win — needs an authorship trail for contract_value
--         (who set it, and when) that does not exist today, plus a backfill and an FE surface.
--   The owner picks. Tracked in docs/backlog.md and pinned by 0169 AC-RES-032, which asserts the
--   CURRENT, vulnerable behaviour on purpose so that closing it is a test-visible act.
--
-- WHAT THIS FILE DOES FIX: the moment of elevation was UNRECORDED. `transition_project` wrote no
-- audit row at all (0076 wired log_audit to operator_grant_credits / set_project_contract_value /
-- transition_document_status / two AFTER DELETE triggers — never to this one), so a project arriving
-- at Won carried no trace of who moved it or what value moved with it. That is load-bearing here: it
-- is the only detection control over the open defect above. The row records the value that rode in.
--
-- Body is 0008 A4/A5's verbatim — the transition map, the org re-assertion, the coarse role gate, the
-- legality check and all three update branches — with TWO deltas, both marked inline: `contract_value`
-- is read under the existing row lock, and one log_audit call is made after the update.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
create or replace function transition_project(
  p_id uuid, p_to project_status, p_customer_contract_ref text default null, p_contract_date date default null)
  returns void language plpgsql security definer set search_path = public as $$
declare
  v_from project_status;
  v_org  uuid;
  v_role user_role := auth_role();
  v_value numeric;   -- ⚑ DELTA 1 (0176): read for the audit detail; never used as a gate (see the header).
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
  select status, org_id, contract_value into v_from, v_org, v_value
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

  -- ⚑ DELTA 2 (0176): the transition is on the audit trail. `contract_value` is recorded because the
  -- pipeline->Won edge does not validate it (see the header's STILL OPEN block) — this row is the only
  -- record that the value existed at the moment of elevation, and who elevated it.
  perform public.log_audit('project.transition', v_org, auth.uid(), p_id,
                           jsonb_build_object('from',                  v_from::text,
                                              'to',                    p_to::text,
                                              'contract_value',        v_value,
                                              'customer_contract_ref', p_customer_contract_ref,
                                              'contract_date',         p_contract_date));
end; $$;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §4 — budget_versions: THE SAME CLASS, UNTOUCHED BY SLICES 1-3.
--
-- `budget_versions_write` (0002) is a FOR ALL policy with the coarse 4-role gate, and 0075 granted a
-- table-wide INSERT covering `status` and `activated_at`. Probed live at 0175:
--   insert into budget_versions (…, status 'Active', activated_at now())  -> INSERT 1
-- which bypasses every control `activate_budget_version` (0005 + 0139) carries: its role gate, its
-- `is_active_member()` offboarding conjunct, its Draft-only legality rule, its parent-project org
-- re-assertion, and its archive-the-previous-Active step. Impact is bounded by
-- `budget_versions_one_active_idx` (a second Active hits 23505), so the reachable outcome is "the
-- FIRST Active version on a project is created ungated" — real, and it moves every budget KPI
-- (get_project_budget / get_budget_projection / margin / at-risk / S-curve).
--
-- `activated_at` also feeds the ADR-0059 §4 deterministic ERPNext budget-push key, so a client-chosen
-- value is a forged witness of an activation act the DB never performed.
--
-- WHY THIS BREAKS NO CALLER (verified by reading every one, 2026-07-29):
--   • `createBudgetVersion` (src/lib/db/budgets.ts) sends exactly (project_id, version, name,
--     status:'Draft') — the origination shape. `status` therefore STAYS insertable and the rule is
--     expressed as a trigger (a grant cannot say "only this value").
--   • `activated_at` is sent by NO caller: not budgets.ts, not `pmo-portal/e2e/serial/_budHelpers.ts`
--     (which inserts status 'Draft' via the service-role `admin` client), not seed.sql, not the
--     importer. It is written by exactly one writer, `activate_budget_version`. So it gets the grant
--     layer as well as a trigger branch.
--   • `archiveVersion` does a direct `update … set status='Archived'` — UNAFFECTED: this guard is
--     INSERT-only and no UPDATE grant is touched.
--   • `clone_budget_version` and `activate_budget_version` are SECURITY DEFINER owned by postgres, so
--     `actor_bypasses_rls()` exempts them.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
revoke insert on public.budget_versions from authenticated, anon;
grant  insert (id, org_id, project_id, version, name, status, created_at)
  on public.budget_versions to authenticated;

create or replace function public.assert_budget_version_origination_insert() returns trigger
  language plpgsql set search_path = public as $$
begin
  if public.actor_bypasses_rls() then
    return new;
  end if;

  -- NULL-safe (§6).
  if new.status is distinct from 'Draft' then
    raise exception
      'budget_versions.status "%" is not the origination status: a budget version is created as a Draft, and Active is reached only through activate_budget_version, which archives the previous Active version in the same transaction',
      new.status
      using errcode = 'P0001';
  end if;

  if new.activated_at is not null then
    raise exception
      'budget_versions.activated_at cannot be set when a budget version is created: the activation witness is stamped only by activate_budget_version, and the ERPNext budget push key is derived from it'
      using errcode = 'P0001';
  end if;

  return new;
end; $$;

drop trigger if exists budget_versions_origination_guard on public.budget_versions;
create trigger budget_versions_origination_guard
  before insert on public.budget_versions
  for each row execute function public.assert_budget_version_origination_insert();

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §5 — create_procurement_invoice: THE PROTECTED END STATE WAS A PARAMETER.
--
-- 0174/0175 made the `create_procurement_*` definer RPCs the SOLE client write path on the three
-- procure-to-pay child tables. That makes their PARAMETERS the entire remaining attack surface — and
-- `p_status` accepted 'Paid' with an arbitrary `p_amount`. Probed live at 0175: a PM minted a Paid
-- vendor invoice for 888888 in one call.
--
-- 'Paid' is not an origination status for a vendor invoice, and the app already says so — the FE's
-- RecordCaptureForm carries "N1 (AC-W3-N1): Paid is NOT offered here — 'Mark as Paid' is the sole
-- PR->Paid authority" and offers only Received/Scheduled. That was a TypeScript comment in front of a
-- public RPC. This puts the rule where it can be enforced (NFR-CPS-001).
--
-- WHY THIS BREAKS NO CALLER (verified by reading every one, 2026-07-29): `RecordCaptureForm.tsx`
-- offers Received/Scheduled only; `capture_vendor_invoice` (0056) forwards whatever the VI capture
-- panel sends, which is typed 'Received' | 'Scheduled'; every pgTAP call site (0107, 0129, 0167, 0168,
-- erpnext_money_flip_rls) passes 'Received'. The historical importer writes procurement_invoices
-- DIRECTLY with the service-role client (scripts/lib/historicalImportRecordInsert.mjs), never through
-- this RPC, so terminal-status historical rows still import.
--
-- ⚑ NOT FIXED HERE — `create_procurement_receipt`'s requester carve-out. It is role-gated to
--   Admin OR PM OR THE REQUESTER, so the Engineer who raised the request can record their own
--   'Complete' goods receipt (self-attested delivery, an input to the 3-way match). That is NOT the
--   same defect: 'Partial' and 'Complete' are BOTH origination values (the form offers both), so no
--   status constraint touches it — the carve-out itself is the issue, and it is a RATIFIED contract
--   (supabase/tests/0055_authz_hardening.test.sql AC-AUTHZ-007 asserts it deliberately). Narrowing it
--   is a product decision. Pinned by 0169 AC-RES-053 and reported to the Director.
--
-- Body is 0100 §4's verbatim (org + role gate + the externally-owned flip guard + the vi_number mint)
-- with ONE inserted check, marked inline.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
create or replace function create_procurement_invoice(
  p_procurement_id uuid, p_status procurement_invoice_status, p_invoice_date date, p_reference_number text default null, p_amount numeric default null,
  p_import_key text default null, p_import_batch_id uuid default null, p_imported_at timestamptz default null)
  returns procurement_invoices language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_row public.procurement_invoices;
begin
  select org_id into v_org from public.procurements where id = p_procurement_id;
  if v_org is null then raise exception 'procurement not found' using errcode = 'P0002'; end if;
  if v_org is distinct from auth_org_id()
     or auth_role() not in ('Admin','Executive','Project Manager','Finance')
  then raise exception 'not authorized' using errcode = '42501'; end if;
  -- Slice 6 addition (AC-ENA-072): a flipped org's invoice writes must route through the ERPNext adapter.
  if public.domain_externally_owned(v_org, 'procurement') then
    raise exception 'procurement is externally-owned — vendor invoices route through the ERPNext adapter'
      using errcode = '42501';
  end if;
  -- ⚑ 0176: the origination-status gate. NULL-safe by construction (`not in` over a NULL p_status is
  -- NULL, so the explicit null check comes first). A NULL p_status would otherwise have fallen through
  -- to the NOT NULL constraint — the wrong error, and the §6 class.
  if p_status is null or p_status::text not in ('Received','Scheduled') then
    raise exception
      'procurement_invoices.status "%" is not an origination status: a vendor invoice is recorded as Received or Scheduled, and Paid is reached only by paying it — the case transition that enforces that the approver does not pay their own request',
      p_status
      using errcode = 'P0001';
  end if;
  insert into public.procurement_invoices
    (procurement_id, status, invoice_date, vi_number, reference_number, amount,
     import_key, import_batch_id, imported_at)
    values (p_procurement_id, p_status, p_invoice_date,
            next_procurement_doc_number(v_org, 'VI'), p_reference_number, p_amount,
            p_import_key, p_import_batch_id, p_imported_at)
    returning * into v_row;
  return v_row;
end; $$;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §6 — THREE-VALUED LOGIC: every guard shipped so far FELL THROUGH on an explicit `status => NULL`.
--
-- `new.status not in ('Leads','Internal Project')` and `new.status <> 'Draft'` both evaluate to NULL
-- when new.status is NULL, and `if NULL then` does not fire — so the guard returned without raising
-- and the NOT NULL constraint caught the insert instead. Probed at 0175 on all four tables: the caller
-- got `23502 null value in column "status" … violates not-null constraint` where the origination rule
-- should have spoken. Two consequences, one cosmetic and one not:
--   • the wrong error is reported (a constraint, not the rule the caller broke);
--   • if ANY future migration relaxes one of those NOT NULLs, all four guards open SILENTLY.
-- Same family as `NaN >= 0` being TRUE in Postgres: a total-looking comparison that is not total.
--
-- The fix is `is distinct from` / an explicit `is null` branch. Every other line of every body below is
-- byte-for-byte the version it replaces — the messages are asserted verbatim by 0166/0167/0168 and by
-- 0169, and a NULL status now reaches the SAME message with `<NULL>` interpolated.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
create or replace function public.assert_project_origination_insert() returns trigger
  language plpgsql set search_path = public as $$
begin
  -- Server-side authority (postgres / service_role / supabase_admin): exempt. See 0173's header.
  if public.actor_bypasses_rls() then
    return new;
  end if;

  -- FR-PCS-001: origination status only. ⚑ 0176: `is null or` — see this file's §6.
  if new.status is null or new.status not in ('Leads','Internal Project') then
    raise exception
      'projects.status "%" is not an origination status: a project can only be created as a Lead or an Internal Project, and a won project is reached only by winning the deal',
      new.status
      using errcode = 'P0001';
  end if;

  -- FR-PCS-002: the win artifacts are written by transition_project, never supplied at create.
  if new.decided_at is not null then
    raise exception
      'projects.decided_at cannot be set when a project is created: the win artifacts (decided_at, customer_contract_ref, contract_date) are recorded only by winning the deal'
      using errcode = 'P0001';
  end if;

  if new.customer_contract_ref is not null then
    raise exception
      'projects.customer_contract_ref cannot be set when a project is created: the win artifacts (decided_at, customer_contract_ref, contract_date) are recorded only by winning the deal'
      using errcode = 'P0001';
  end if;

  if new.contract_date is not null then
    raise exception
      'projects.contract_date cannot be set when a project is created: the win artifacts (decided_at, customer_contract_ref, contract_date) are recorded only by winning the deal'
      using errcode = 'P0001';
  end if;

  return new;
end; $$;

create or replace function public.assert_procurement_origination_insert() returns trigger
  language plpgsql set search_path = public as $$
begin
  if public.actor_bypasses_rls() then
    return new;
  end if;

  -- ⚑ 0176: `is distinct from` — see this file's §6.
  if new.status is distinct from 'Draft' then
    raise exception
      'procurements.status "%" is not an origination status: a purchase request is created as a Draft, and every later state is reached only through transition_procurement, which enforces that the requester does not approve and the approver does not pay',
      new.status
      using errcode = 'P0001';
  end if;

  if new.approved_by_id is not null then
    raise exception
      'procurements.approved_by_id cannot be set when a purchase request is created: the approver is stamped only by transition_procurement, which enforces that the requester does not approve their own request'
      using errcode = 'P0001';
  end if;

  if new.po_number is not null then
    raise exception
      'procurements.po_number cannot be set when a purchase request is created: document numbers are minted only by next_procurement_doc_number, called from transition_procurement'
      using errcode = 'P0001';
  end if;

  if new.pr_number is not null then
    raise exception
      'procurements.pr_number cannot be set when a purchase request is created: document numbers are minted only by next_procurement_doc_number, called from transition_procurement'
      using errcode = 'P0001';
  end if;

  if new.approval_notes is not null then
    raise exception
      'procurements.approval_notes cannot be set when a purchase request is created: the approval and rejection decisions are recorded only by transition_procurement'
      using errcode = 'P0001';
  end if;

  if new.rejection_notes is not null then
    raise exception
      'procurements.rejection_notes cannot be set when a purchase request is created: the approval and rejection decisions are recorded only by transition_procurement'
      using errcode = 'P0001';
  end if;

  if new.vendor_invoiced_at is not null then
    raise exception
      'procurements.vendor_invoiced_at cannot be set when a purchase request is created: it is stamped only by transition_procurement'
      using errcode = 'P0001';
  end if;

  return new;
end; $$;

create or replace function public.assert_project_document_origination_insert() returns trigger
  language plpgsql set search_path = public as $$
begin
  if public.actor_bypasses_rls() then
    return new;
  end if;

  -- ⚑ 0176: `is distinct from` — see this file's §6. (The author_id half of this table's SoD is §2's
  -- restrictive policy, not a branch here: a policy denial is the stronger, RLS-native control and it
  -- is where the `procurements` precedent puts it.)
  if new.status is distinct from 'Draft' then
    raise exception
      'project_documents.status "%" is not the origination status: a document is created as a Draft, and Issued / Approved / Rejected are reached only through transition_document_status, which enforces that nobody approves their own document',
      new.status
      using errcode = 'P0001';
  end if;

  return new;
end; $$;

create or replace function public.assert_timesheet_origination_insert() returns trigger
  language plpgsql set search_path = public as $$
begin
  if public.actor_bypasses_rls() then
    return new;
  end if;

  -- ⚑ 0176: `is distinct from` — see this file's §6.
  if new.status is distinct from 'Draft' then
    raise exception
      'timesheets.status "%" is not the origination status: a timesheet is created as a Draft, and Submitted / Approved / Rejected are reached only through transition_timesheet, which enforces that nobody approves their own timesheet',
      new.status
      using errcode = 'P0001';
  end if;

  if new.approved_by is not null then
    raise exception
      'timesheets.approved_by cannot be set when a timesheet is created: the approver is stamped only by transition_timesheet, which enforces that nobody approves their own timesheet'
      using errcode = 'P0001';
  end if;

  if new.approved_at is not null then
    raise exception
      'timesheets.approved_at cannot be set when a timesheet is created: the approval timestamp is stamped only by transition_timesheet, which enforces that nobody approves their own timesheet'
      using errcode = 'P0001';
  end if;

  return new;
end; $$;
