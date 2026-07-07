-- 0076_audit_events.sql — durable audit trail for security-sensitive events (audit finding C-3,
-- CRITICAL). Proven by pgTAP 0133_audit_events.test.sql (28 assertions).
--
-- A new append-only `audit_events` table records who did what, org-scoped, on the SUCCESS path of:
--   • operator_grant_credits     (0067) — action 'credits.grant'
--   • set_project_contract_value (0014) — action 'project.contract_value.set' (captures from→to)
--   • transition_document_status (0017) — action 'project_document.transition' (captures from→to)
--   • companies AFTER DELETE     (0013) — action 'company.delete'   (Admin-only hard-delete, no RPC)
--   • projects  AFTER DELETE     (0052) — action 'project.delete'    (Admin-only hard-delete, no RPC)
--
-- ── WRITE PATH (the crux) ───────────────────────────────────────────────────────────────────────
-- audit_events has FORCE RLS + EXACTLY ONE policy (SELECT only) → no INSERT/UPDATE/DELETE policy.
-- The SOLE writer is `log_audit(...)`: a SECURITY DEFINER function owned by `postgres` (superuser,
-- BYPASSRLS). A definer owned by a BYPASSRLS role is NOT subject to RLS, so its INSERT succeeds
-- despite FORCE RLS + no INSERT policy. (Correct fix = the function owner, NOT an INSERT policy —
-- an INSERT policy would break the "exactly one policy / append-only" contract the test asserts.)
-- `log_audit` is `revoke ... from public` and granted to NO client role: only security-definer RPCs
-- and security-definer AFTER-DELETE triggers (owned by postgres) call it, and postgres (owner)
-- retains implicit EXECUTE. No client (authenticated/anon) can forge a row.
--
-- ── GRANTS (append-only, defense-in-depth — Director hardening 2026-07-07) ───────────────────────
-- ONLY `select` is granted (to authenticated; the policy then scopes reads to own-org Admin/Operator).
-- INSERT/UPDATE/DELETE are granted to NO client role, so a direct write is denied at the PRIVILEGE
-- check (42501) — a stronger barrier for an audit trail than relying on RLS-default-deny to yield
-- 0 rows. AC-AUDIT-009/010/011/012 all assert throws_ok 42501. (This tightens the test's original
-- "UPDATE/DELETE affects 0 rows" oracle into a privilege-denied one; immutability is now guarded by
-- BOTH the absent grant AND FORCE-RLS's absent policy.)
--
-- ── entity_type column ───────────────────────────────────────────────────────────────────────────
-- AC-AUDIT-009/012 INSERT-denial statements reference `audit_events (action, entity_type)`. Without
-- an `entity_type` column those statements fail at PARSE with 42703 (undefined_column), not the
-- expected 42501. So the column exists (nullable; no assertion reads it).
--
-- Reversibility (ADR-0006, pre-production): `supabase db reset`. Forward-only/additive. Manual
-- rollback: drop the 2 triggers + 2 trigger fns + log_audit + the 3 RPCs are `create or replace`
-- (their prior bodies are restored by db reset) + drop the table.

-- ============================================================================
-- 1. Table + FORCE RLS + the ONE (SELECT) policy.
-- ============================================================================
create table public.audit_events (
  id          uuid        primary key default gen_random_uuid(),
  org_id      uuid        not null,
  actor_id    uuid,                       -- the acting user; NULL for a system event
  action      text        not null,
  entity_type text,                       -- see header: required so the INSERT-denial proofs hit 42501, not 42703
  entity_id   uuid,                       -- the affected row, when a single entity applies
  detail      jsonb       not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

comment on table public.audit_events is
  'Durable, append-only audit trail for security-sensitive events (audit finding C-3). '
  'Org-scoped; readable by own-org Admin/Operator only; written solely by log_audit() '
  '(security definer) — no client role may INSERT/UPDATE/DELETE.';

alter table public.audit_events enable row level security;
alter table public.audit_events force  row level security;

-- The ONE policy: SELECT, scoped to the caller's OWN org AND to Admin or platform-Operator AND to an
-- active member. A non-admin in-org user reads ZERO; any cross-org user reads ZERO (proven 0133 §b).
create policy audit_events_select on public.audit_events
  for select
  using (org_id = public.auth_org_id()
         and (public.auth_role() = 'Admin' or public.is_operator())
         and public.is_active_member());

-- ============================================================================
-- 2. Grants (see header). Append-only, defense-in-depth: SELECT scopes reads via the policy;
--    INSERT/UPDATE/DELETE are granted to NO client role → a direct write hits 42501 at the privilege
--    check (a stronger barrier than relying on RLS-default-deny for an audit trail). log_audit() (a
--    postgres-owned SECURITY DEFINER, below) is the sole write path.
-- ============================================================================
grant select on public.audit_events to authenticated;

-- ============================================================================
-- 3. log_audit() — the SOLE writer. SECURITY DEFINER (postgres owner → BYPASSRLS) so its INSERT
--    bypasses FORCE RLS + the absent INSERT policy. Revoked from public, granted to no client role.
-- ============================================================================
create or replace function public.log_audit(
  p_action    text,
  p_org_id    uuid,
  p_actor_id  uuid,
  p_entity_id uuid,
  p_detail    jsonb
) returns void
  language plpgsql security definer set search_path = public as $$
begin
  insert into public.audit_events (org_id, actor_id, action, entity_id, detail)
    values (p_org_id, p_actor_id, p_action, p_entity_id, p_detail);
end; $$;

revoke all on function public.log_audit(text, uuid, uuid, uuid, jsonb) from public;
-- Deliberately NO `grant execute ... to authenticated/anon`: only security-definer RPCs + the
-- security-definer AFTER-DELETE triggers below (all owned by postgres) call this internally, and
-- postgres (owner) retains implicit EXECUTE. No client role may invoke it directly.

-- ============================================================================
-- 4. AFTER DELETE triggers → log_audit() for the policy-gated destructive deletes (no RPC exists).
--    SECURITY DEFINER (postgres owner) so the trigger body may call log_audit without a client grant.
--    auth.uid() reads the live JWT (unaffected by definer) → records the deleting actor.
-- ============================================================================
create or replace function public.audit_company_delete() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  perform public.log_audit('company.delete', old.org_id, auth.uid(), old.id,
                           jsonb_build_object('name', old.name));
  return old;
end; $$;

drop trigger if exists companies_audit_delete on public.companies;
create trigger companies_audit_delete
  after delete on public.companies
  for each row execute function public.audit_company_delete();

create or replace function public.audit_project_delete() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  perform public.log_audit('project.delete', old.org_id, auth.uid(), old.id,
                           jsonb_build_object('name', old.name));
  return old;
end; $$;

drop trigger if exists projects_audit_delete on public.projects;
create trigger projects_audit_delete
  after delete on public.projects
  for each row execute function public.audit_project_delete();

-- ============================================================================
-- 5. operator_grant_credits (0067) — add the audit write AFTER the INSERT (success path). Body is
--    copied verbatim from 0067; only the trailing `perform log_audit(...)` is added. All guards,
--    errcodes, and grants are unchanged (create or replace preserves the existing execute grants).
-- ============================================================================
create or replace function public.operator_grant_credits(
  p_org_id uuid,
  p_amount numeric,
  p_note   text
) returns void
  language plpgsql security definer set search_path = public as $$
begin
  -- is_active_member() entry guard (security review M1): platform_operators is intentionally exempt
  -- from the 0063 RLS conjunction, so a disabled Operator's cached JWT still drives auth.uid() in
  -- PostgREST (GoTrue stops issuing NEW JWTs via banned_until, but cannot revoke a cached one).
  -- Re-asserting is_active_member() here closes the disabled-Operator elevation on every Operator
  -- power, mirroring org_credit_balance / admin_set_user_status. (Inverse-consistent with 0064.)
  if not public.is_active_member() then
    raise exception 'inactive' using errcode = '42501';
  end if;
  if not public.is_operator() then
    raise exception 'operator_only' using errcode = '42501';
  end if;
  if not exists (select 1 from public.organizations where id = p_org_id) then
    raise exception 'unknown_org' using errcode = '23503';   -- Operators cannot grant into a nonexistent org
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'amount_positive' using errcode = '23514'; -- maps to the CHECK-violation toast
  end if;
  insert into public.credits (org_id, owner_id, amount, note, granted_by)
    values (p_org_id, null, p_amount, p_note, auth.uid());
  -- audit (C-3): durable record of the credit grant on the success path.
  perform public.log_audit('credits.grant', p_org_id, auth.uid(), null,
                           jsonb_build_object('amount', p_amount));
end $$;

-- ============================================================================
-- 6. set_project_contract_value (0014) — capture the OLD value, then audit after the UPDATE. Body
--    copied verbatim from 0014; only additions are `v_old` (declare), `contract_value` (select list),
--    and the trailing `perform log_audit(...)`. The org/role/status SoD guards + errcodes are intact.
-- ============================================================================
create or replace function set_project_contract_value(p_id uuid, p_value numeric)
  returns void language plpgsql security definer set search_path = public as $$
declare
  v_status project_status;
  v_org    uuid;
  v_old    numeric;                          -- audit (C-3): capture the pre-change contract_value
  v_role   user_role := auth_role();
  -- The four WON/on-hand statuses past the pre-win boundary (mirror of ON_HAND_STATUSES in
  -- src/lib/db/projectTransitions.ts + policy.ts). EXACT enum spelling (note the comma).
  v_on_hand constant text[] := array['Won, Pending KoM','Ongoing Project','On Hold','Close Out'];
begin
  -- Load + lock the row (serializes concurrent value edits on the SAME project). P0002 if absent.
  select status, org_id, contract_value
    into v_status, v_org, v_old
    from public.projects where id = p_id for update;
  if v_status is null then
    raise exception 'project not found' using errcode = 'P0002';
  end if;

  -- Tenant isolation: proven independently of RLS (definer bypasses it).
  -- SECURITY: this org re-assertion MUST stay — removing it leaks cross-org writes.
  if v_org is distinct from auth_org_id() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  -- SoD role gate, conditioned on the win boundary (ADR-0019).
  -- SECURITY: this role/status gate MUST stay — removing it lets a PM change a won value (the
  -- segregation of duties being enforced) or any authenticated user write the column.
  if v_status::text = any(v_on_hand) then
    -- WON / on-hand: money authority only (Exec/Finance, Admin break-glass).
    if v_role is null or v_role not in ('Admin','Executive','Finance') then
      raise exception 'changing the contract value on a won project requires Executive or Finance'
        using errcode = '42501';
    end if;
  else
    -- Pre-win: delivery origination roles set/estimate the value.
    if v_role is null or v_role not in ('Admin','Executive','Project Manager') then
      raise exception 'not authorized to set the contract value' using errcode = '42501';
    end if;
  end if;

  update public.projects
    set contract_value = p_value,
        last_update    = now()
  where id = p_id;

  -- audit (C-3): durable record of the value change (from→to) on the success path.
  perform public.log_audit('project.contract_value.set', v_org, auth.uid(), p_id,
                           jsonb_build_object('from', v_old, 'to', p_value));
end; $$;

-- ============================================================================
-- 7. transition_document_status — audit after the UPDATE. Body copied from the CURRENT canonical
--    definition in 0025_document_file_upload.sql (which SUPERSEDED 0017: adds the 'Superseded' legal
--    entry + the auto-Supersede-parent block — proven by 0066_document_superseded). v_from already
--    holds the OLD status; only the trailing `perform log_audit(...)` is added. All guards intact.
--    (Director fix 2026-07-07: GLM's first pass copied the STALE 0017 body and dropped the supersede
--    logic → 0066 regressed; re-based on 0025.)
-- ============================================================================
create or replace function transition_document_status(p_doc_id uuid, p_to doc_status)
  returns void language plpgsql security definer set search_path = public as $$
declare
  v_from      doc_status;
  v_org       uuid;
  v_author    uuid;
  v_parent_id uuid;
  v_uid       uuid      := auth.uid();
  v_role      user_role := auth_role();
  v_legal jsonb := jsonb_build_object(
    'Draft',      jsonb_build_array('Issued'),
    'Issued',     jsonb_build_array('Approved','Rejected'),
    'Approved',   jsonb_build_array('Closed'),
    'Rejected',   jsonb_build_array('Draft','Closed'),
    'Closed',     jsonb_build_array(),
    'Superseded', jsonb_build_array()
  );
begin
  -- Load + lock the row (serializes concurrent transitions on the SAME document). P0002 if absent.
  select status, org_id, author_id, parent_document_id
    into v_from, v_org, v_author, v_parent_id
    from public.project_documents where id = p_doc_id for update;
  if v_from is null then
    raise exception 'document not found' using errcode = 'P0002';
  end if;

  -- Tenant isolation: proven independently of RLS (definer bypasses it).
  -- SECURITY: this org re-assertion MUST stay — removing it leaks cross-org writes.
  if v_org is distinct from auth_org_id() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  -- Role gate: only the master-data write-roles move a document's workflow.
  -- SECURITY: this role gate MUST stay — removing it lets any authenticated user transition a document.
  if v_role is null or v_role not in ('Admin','Executive','Project Manager','Finance') then
    raise exception 'not authorized to transition this document' using errcode = '42501';
  end if;

  -- Status-map legality: (from,to) must be in the data map, else P0001.
  if not (v_legal -> v_from::text) ? p_to::text then
    raise exception 'illegal document transition % -> %', v_from, p_to using errcode = 'P0001';
  end if;

  -- approver≠author SoD: the actor approving/rejecting a document may not be its author.
  -- SECURITY: this MUST stay — it is the segregation of duties being enforced.
  if p_to in ('Approved','Rejected') and v_uid is not distinct from v_author then
    raise exception 'separation of duties: cannot approve or reject your own document'
      using errcode = '42501';
  end if;

  update public.project_documents
    set status = p_to
  where id = p_doc_id;

  -- audit (C-3): durable record of the workflow transition (from→to) on the success path.
  -- ::text casts the doc_status enum to its label so detail->>'from'/'to' read as 'Draft'/'Issued'.
  perform public.log_audit('project_document.transition', v_org, v_uid, p_doc_id,
                           jsonb_build_object('from', v_from::text, 'to', p_to::text));

  -- Auto-Superseded (from 0025): when a child revision is Approved, mark the parent Superseded.
  -- Parent must be in ('Issued','Approved') — both valid starting states for a new revision.
  if p_to = 'Approved' and v_parent_id is not null then
    perform 1 from public.project_documents where id = v_parent_id for update;
    update public.project_documents
      set status = 'Superseded'
    where id = v_parent_id
      and status in ('Issued','Approved');
    -- Idempotent: no error if the parent was not Issued/Approved (already superseded/closed).
  end if;
end; $$;
