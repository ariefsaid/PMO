-- 0173_project_create_origination_sod.sql — close the INSERT-side hole in the project money/status
-- SoD (docs/specs/project-create-sod.spec.md; FR-PCS-001/002/003/004, AC-PCS-001..007 + AC-PCS-020).
-- Proven by pgTAP supabase/tests/0166_project_create_sod.test.sql (19 assertions).
--
-- ── THE DEFECT ──────────────────────────────────────────────────────────────────────────────────
-- ADR-0019 requires that a project's money and WON status are not settable by the person who
-- originates the deal: the win is reached only through transition_project, which carries the SoD
-- checks and the win-artifact capture. 0008 A6 + 0014 enforce that on the UPDATE path by revoking
-- the table-wide UPDATE from `authenticated` and re-granting it on a narrower column list that
-- withholds contract_value / status / decided_at / customer_contract_ref / contract_date.
--
-- The INSERT path had no such treatment. `authenticated` held a BLANKET INSERT grant covering all
-- five withheld columns, so a Project Manager could `POST /rest/v1/projects` with a won status, an
-- arbitrary contract value and a forged decided_at — bypassing the state machine entirely. And
-- because log_audit (0076) is wired to the RPCs and to AFTER DELETE only, the forged row left NO
-- audit trail. Verified live against the local DB at 0172 (spec §1.1).
--
-- A FE check existed (src/lib/db/projects.ts restricts status to PROJECT_ORIGINATION_STATUSES) and
-- called itself "defence in depth". It is TypeScript in a browser in front of a public PostgREST
-- endpoint — it was the ONLY defence, at a layer the attacker does not have to pass through. This
-- migration puts the rule where it can be enforced.
--
-- ── WHAT IS AND IS NOT BLOCKED ──────────────────────────────────────────────────────────────────
-- contract_value REMAINS settable at INSERT (spec §4.1): it is the origination/opportunity value
-- that both create paths legitimately send (createProject and the bulk importer). The SoD is about
-- the WON value, which transition_project + set_project_contract_value own. Blocking it would break
-- every legitimate create for no security gain.
--
-- ── SCOPE: WHO IS ENFORCED ──────────────────────────────────────────────────────────────────────
-- The trigger enforces on roles that are SUBJECT to RLS (authenticated, anon) and exempts roles that
-- already BYPASS it (postgres, service_role, supabase_admin — `pg_roles.rolbypassrls`). It therefore
-- sits at exactly the RLS trust boundary: a BYPASSRLS role holds a server-side secret and is an
-- authority, not a client. This is not a loophole for the exploit, which is an `authenticated`
-- PostgREST request.
--
-- Enforcing on BYPASSRLS roles as well would break, with no security benefit:
--   • supabase/seed.sql (seeds projects across the whole status range),
--   • ~105 pgTAP fixture files (which insert Negotiation / Ongoing / Won rows as postgres),
--   • pmo-portal/e2e/serial/_sarHelpers.ts / _budHelpers.ts / _tspHelpers.ts (service-role inserts at
--     'Ongoing Project' for the ERPNext adapter lane),
--   • scripts/import-historical.mjs (service-role; legitimately imports historical WON projects).
-- The spec's §3 survey ("no server-side writer inserts into projects at all") scanned
-- supabase/functions/** and supabase/migrations/** only, and so did not see these four.
--
-- ── LAYERS (both, deliberately — FR-PCS-004) ────────────────────────────────────────────────────
-- §3 grant layer: naming decided_at / customer_contract_ref / contract_date in an INSERT column list
--   is denied at the privilege check (42501), before any trigger runs. This is what a real attacker
--   hits.
-- §2 trigger layer: enforces the origination-status rule (which cannot be expressed as a grant,
--   because `status` must stay insertable) and re-catches the win artifacts with a message that
--   names the offending column, for any future path that holds the grant.
--
-- ── AUDIT (FR-PCS-003) ──────────────────────────────────────────────────────────────────────────
-- Every INSERT now writes an audit_events row via log_audit(), following the 0076 convention exactly
-- (postgres-owned SECURITY DEFINER trigger fn → log_audit; no parallel mechanism). It fires for all
-- roles, including service_role/postgres backfills — a create is a create.
--
-- ── OD-PCS-1 (open owner decision) ──────────────────────────────────────────────────────────────
-- §1 below WARNS about pre-existing rows that could not have been created under the new rule and
-- does nothing else — no delete, no quarantine, no blocked apply. That is option (a), the spec's
-- recommended default while OD-PCS-1 is open.
--
-- Reversibility (ADR-0006). ⚑ NOT `supabase db reset` — v0.8.0 is in production and a reset there is
-- destructive and local-only. The manual reverse, statement for statement:
--   drop trigger if exists projects_origination_guard on public.projects;
--   drop trigger if exists projects_audit_insert     on public.projects;
--   drop function if exists public.assert_project_origination_insert();
--   drop function if exists public.audit_project_insert();
--   -- ⚑ THIS ONE RESTORES THE VULNERABLE STATE. The blanket INSERT grant is the hole §3 closes: it
--   -- re-exposes decided_at / customer_contract_ref / contract_date to a client INSERT, which is
--   -- exactly how a PM could forge a won project with an arbitrary contract value and no audit row.
--   -- Reverse only with that understood, and only together with the trigger drop above (the trigger
--   -- is the second layer; dropping the trigger alone leaves the grant layer, and vice versa).
--   grant insert on public.projects to authenticated;
-- ⚑ 0175 supersedes §2a's body (it delegates to the shared public.actor_bypasses_rls() helper instead
-- of carrying the inline pg_roles lookup below). Reversing this file does NOT restore that inline
-- copy — reverse 0175 first if that is what you want.

-- ============================================================================
-- 1. AC-PCS-020 — apply-time visibility for pre-existing violations. WARN ONLY (OD-PCS-1 option a).
--
-- A row's INSERT-time shape cannot be recovered after the fact: a project sitting at 'Ongoing
-- Project' today may have arrived there perfectly legitimately through transition_project. The one
-- available signal is that EVERY transition_project branch sets `last_update = now()` (0008 A4/A5),
-- so a row that is past origination yet still has `last_update = created_at` has never been through
-- the state machine — it was created directly at that status. The count is therefore a lower bound
-- (a forged row that was later edited is not counted); the non-origination total is reported
-- alongside it as context, NOT as a violation count.
-- ============================================================================
do $$
declare
  v_direct  bigint;
  v_nonorig bigint;
begin
  select count(*) into v_nonorig
    from public.projects
   where status not in ('Leads','Internal Project');

  select count(*) into v_direct
    from public.projects
   where last_update = created_at
     and (status not in ('Leads','Internal Project')
          or decided_at            is not null
          or customer_contract_ref is not null
          or contract_date         is not null);

  if v_direct > 0 then
    raise warning
      '0173 project-create SoD: % project row(s) could not have been created under the new rule '
      '(past origination or carrying a win artifact, and never updated since creation — so never '
      'through transition_project). % row(s) are past origination in total, most of them legitimately. '
      'Nothing was changed: OD-PCS-1 (what to do about them) is an open owner decision.',
      v_direct, v_nonorig;
  end if;
end $$;

-- ============================================================================
-- 2a. The guard — BEFORE INSERT, SECURITY INVOKER.
--
-- INVOKER (not DEFINER) is load-bearing: `current_user` must be the REAL calling role for the
-- BYPASSRLS exemption to mean anything. Under SECURITY DEFINER it would always read `postgres` and
-- the guard would exempt everyone, silently. The function needs no elevated privilege — it only
-- raises. `pg_roles` is world-readable, so the lookup works as `authenticated`.
--
-- coalesce(..., false): if current_user is somehow absent from pg_roles the guard ENFORCES
-- (fail-closed) rather than waving the insert through on a NULL.
-- ============================================================================
create or replace function public.assert_project_origination_insert() returns trigger
  language plpgsql set search_path = public as $$
begin
  -- Server-side authority (postgres / service_role / supabase_admin): exempt. See the header.
  if coalesce((select rolbypassrls from pg_roles where rolname = current_user), false) then
    return new;
  end if;

  -- FR-PCS-001: origination status only. A won/on-hand project is reached through the state machine.
  if new.status not in ('Leads','Internal Project') then
    raise exception
      'projects.status "%" is not an origination status: a project can only be created as a Lead or an Internal Project, and a won project is reached only by winning the deal',
      new.status
      using errcode = 'P0001';
  end if;

  -- FR-PCS-002: the win artifacts are written by transition_project, never supplied at create. Each
  -- branch names ITS OWN column (NFR-PCS-002) — a single combined message would leave the user
  -- guessing which of the three was rejected.
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

drop trigger if exists projects_origination_guard on public.projects;
create trigger projects_origination_guard
  before insert on public.projects
  for each row execute function public.assert_project_origination_insert();

-- ============================================================================
-- 2b. FR-PCS-003 — audit every create. Mirrors 0076 §4's AFTER DELETE convention exactly:
-- a postgres-owned SECURITY DEFINER trigger fn calling log_audit (which is granted to no client
-- role), so the trigger body may write to the FORCE-RLS, append-only audit_events. auth.uid() is
-- unaffected by the definer switch and records the acting user (NULL for a service-role/system
-- write, per the audit_events.actor_id contract).
-- ============================================================================
create or replace function public.audit_project_insert() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  perform public.log_audit('project.create', new.org_id, auth.uid(), new.id,
                           jsonb_build_object('status',         new.status::text,
                                              'contract_value', new.contract_value));
  return new;
end; $$;

drop trigger if exists projects_audit_insert on public.projects;
create trigger projects_audit_insert
  after insert on public.projects
  for each row execute function public.audit_project_insert();

-- ============================================================================
-- 3. FR-PCS-004 — the grant layer. Same Postgres semantics as 0008 A6: a TABLE-level INSERT grant
-- covers every column and is NOT reduced by a column-level REVOKE, so the table-wide grant must be
-- revoked and re-granted on the narrower list. The three omitted columns become insertable only by
-- a role that bypasses the grant (postgres / service_role) — i.e. by transition_project's own
-- security-definer UPDATE, never by a client INSERT.
--
-- Snapshot semantics (inherited from 0008 A6, deliberately not changed here): a column added to
-- projects in a FUTURE migration will NOT be insertable by `authenticated` until that migration
-- grants it explicitly. That is the same forcing function the UPDATE list has had since 0008.
--
-- `anon` is untouched: 0105 revoked its write DML outright, so there is nothing to narrow.
-- ============================================================================
revoke insert on public.projects from authenticated;
grant insert (id, org_id, code, name, status, client_id, project_manager_id, contract_value,
              budget, spent, start_date, end_date, last_update, created_at, archived_at,
              import_batch_id, imported_at, import_key)
  on public.projects to authenticated;
