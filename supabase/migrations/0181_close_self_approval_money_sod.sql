-- 0181_close_self_approval_money_sod.sql — closes a LIVE money-SoD bypass that is already on main.
--
-- THE DEFECT. `public.may_approve_work_of(p_approver_id, p_author_id)` (0178, ADR-0070) has as its
-- LINE-MANAGEMENT limb:
--     (author.manager_id is not null and author.manager_id = p_approver_id)
-- with NO approver<>author guard. So may_approve_work_of(X, X) is TRUE whenever X.manager_id = X.id —
-- a profile that is its own manager can approve its OWN work. `transition_project`'s win-gate (also
-- 0178) reads:
--     or (v_set_by is not null and not public.may_approve_work_of(v_set_by, auth.uid()))
-- i.e. "did someone with authority over the WINNER set the value?" — and never asks whether that
-- someone IS the winner.
--
-- THE EXPLOIT (reproduced end-to-end on this DB by the Director). A Project Manager with no manager
-- is correctly refused: "this deal's contract value was not set by anyone senior to you...". After
-- ONE profile edit by an Admin/Executive —
--     update profiles set manager_id = '<pm_id>' where id = '<pm_id>';
-- — the SAME PM, alone, runs set_project_contract_value(project, 99000000) then transitions
-- Leads -> PQ Submitted -> Quotation Submitted -> 'Won, Pending KoM' and it SUCCEEDS:
--     status='Won, Pending KoM'  contract_value=99000000.00
-- A 99M deal booked with one signature. No audit row is written for the enabling profile edit.
--
-- THE FIX (defence in depth — three independent layers, each catches the exploit on its own):
--   §1  may_approve_work_of — add `and p_approver_id is distinct from p_author_id` to the
--        line-management limb, so self can NEVER approve self regardless of the graph. NULL-safe
--        (`is distinct from`, not `<>`): a NULL on either side fails CLOSED.
--   §2  profiles_manager_not_self CHECK — `manager_id is distinct from id`. The exploit's enabling
--        step is `set manager_id = id`; this makes that step itself a 23514. Preceded by a census
--        DO block that raises a DIAGNOSABLE exception naming the offending profile ids if any
--        exist (local count is 0; production may differ — a bare constraint violation at 3am is
--        not good enough).
--   §3  transition_project win-gate — the win now additionally requires the value-setter to be a
--        DISTINCT person from the winner (v_set_by is distinct from auth.uid()). In this REFUSAL
--        gate that permit conjunct appears De Morgan-negated as a new OR branch
--        `v_set_by is not distinct from auth.uid()`, so the SoD is not reachable through the
--        identity predicate at all — even if a future bug ever made may_approve_work_of(X, X)
--        true again, a self-authored win is still refused here.
--
-- CALLER SWEEP (run before editing may_approve_work_of, 2026-07-30):
--   grep -rn "may_approve_work_of" supabase/ pmo-portal/src pmo-portal/pages supabase/functions
--   -> exactly FOUR SQL references, ZERO app/edge references:
--        0178:707  the definition (this file re-creates it)
--        0178:722  the COMMENT (text only)
--        0178:732  the execute GRANT (unchanged by this file)
--        0178:917  the single live caller: transition_project's win-gate, may_approve_work_of(
--                  v_set_by, auth.uid()) — the exploit site; fix §3 makes the win independent of it
--        0171:638-639  two pgTAP NULL-arg assertions: may_approve_work_of(null, X) and
--                  may_approve_work_of(X, null). Both still return FALSE after §1 (a NULL id
--                  matches no profiles row, so the subquery is empty and coalesces to FALSE) —
--                  verified by re-running 0171 green after this migration.
--   No caller — not the win-gate, not a test, not the app, not an edge function — legitimately
--   relies on may_approve_work_of(X, X) being TRUE. The only non-NULL same-arg call is the exploit.
--
-- ── REVERSIBILITY (ADR-0006) ────────────────────────────────────────────────────────────────────
-- ⚑ NOT `supabase db reset` — v0.8.0 is in production. The manual reverse is an operation on THIS
--   file (every statement below restores a VULNERABLE state — do not run it expecting safety):
--     -- §3  re-create transition_project from 0178's body VERBATIM (this file's only change to it
--     --     is the single added OR branch `or v_set_by is not distinct from auth.uid()` inside
--     --     the win-gate's refusal clause; drop that one branch and the body is 0178's again).
--     -- §2  alter table public.profiles drop constraint if exists profiles_manager_not_self;
--     --     (the census DO block is one-shot and needs no reverse of its own.)
--     -- §1  re-create may_approve_work_of from 0178's body VERBATIM (this file's only change to
--     --     it is the single conjunct `and p_approver_id is distinct from p_author_id` on the
--     --     line-management limb; drop that one conjunct and the body is 0178's again).
--   ⚑ Do NOT reverse by "re-apply migration NNN": the live bodies of these two functions are owned
--     by THIS file as of 0181, and a later migration may re-create them again — naming a migration
--     number is how 0180's rollback list named the wrong source for 14 of 15 functions. Reverse by
--     editing the current file's text, as above.

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §1 — may_approve_work_of: self can never approve self, regardless of the graph.
-- Body is 0178's VERBATIM with ONE added conjunct on the line-management limb, marked inline.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
create or replace function public.may_approve_work_of(p_approver_id uuid, p_author_id uuid)
  returns boolean language sql stable security definer set search_path = pg_catalog, public as $$
  select coalesce(
    (select
         -- (1) LINE MANAGEMENT — unconditional, whatever the two roles are. `author.manager_id is
         --     not null` is explicit: a NULL manager must never match a NULL approver id.
         -- ⚑ 0181: `and p_approver_id is distinct from p_author_id` — a profile must never approve
         --     its OWN work. Before this, a row with manager_id = id satisfied this limb for itself,
         --     and (combined with §3's absence) let a single PM book a 99M won deal alone. NULL-safe:
         --     `is distinct from`, never `<>`, so a NULL on either side fails CLOSED.
         (author.manager_id is not null and author.manager_id = p_approver_id
                                    and p_approver_id is distinct from p_author_id)
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
  '⚑ 0181: self can never approve self — the line-management limb requires p_approver_id is '
  'distinct from p_author_id, so a self-managing profile (manager_id = id) can no longer ratify its '
  'own work. Coalesces to FALSE, so a missing profile, a cross-org pair or a NULL manager_id FAILS '
  'CLOSED. ⚑ profiles_update_self pins BOTH role and manager_id, so a user cannot self-grant this — '
  'that pin is load-bearing for every rule built on this function.';

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §2 — profiles_manager_not_self CHECK, with a diagnoseable census first.
-- The exploit's enabling step is `update profiles set manager_id = id`. This makes that step a 23514
-- regardless of who issues it (a CHECK is enforced on EVERY writer, owner included — RLS never sees
-- it). The census raises a NAMED exception if any self-managing row already exists, because a bare
-- constraint violation at 3am on a production deploy tells the on-call nothing.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
do $$
declare v_offenders text;
begin
  select string_agg(p.id::text, ', ' order by p.id)
    into v_offenders
    from public.profiles p
   where p.manager_id = p.id;
  if v_offenders is not null then
    raise exception
      'profiles_manager_not_self CHECK cannot be added: % profile(s) currently have manager_id = id '
      '(self-management), which the new constraint would reject. Clear or re-point manager_id on '
      'these rows before re-running this migration: %',
      (select count(*) from public.profiles where manager_id = id), v_offenders
      using errcode = '23514';
  end if;
end $$;

alter table public.profiles
  add constraint profiles_manager_not_self check (manager_id is distinct from id);

comment on constraint profiles_manager_not_self on public.profiles is
  '⚑ 0181 — a profile must never be its own manager. The money-SoD approval predicate '
  'may_approve_work_of treats manager_id as an authorisation input; a self-managing row let a single '
  'PM book a 99M won deal alone (set_project_contract_value then transition_project to Won). This is '
  'the layer that refuses the enabling profile edit itself, before may_approve_work_of or the '
  'transition win-gate are ever reached. manager_id is distinct from id (NULL-safe: a NULL '
  'manager_id is allowed and means "no line manager").';

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §3 — transition_project win-gate: a self-authored win is refused, independent of the identity
-- predicate. Body is 0178's VERBATIM (taken from the live catalog via pg_get_functiondef on
-- 2026-07-30, NOT from an older migration file) with ONE added OR branch in the win-gate's refusal
-- clause, marked inline. The transition map, org re-assertion, active-membership conjunct, coarse
-- role gate, legality check, all three update branches and the log_audit call are unchanged.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
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
    --
    -- ⚑ 0181 — the win now ADDITIONALLY requires the value-setter to be a DISTINCT person from the
    --   winner: the conjunct "v_set_by is distinct from auth.uid()" is the PERMIT requirement (the
    --   setter must be someone other than the winner). This is a REFUSAL gate, so that permit
    --   conjunct appears here De Morgan-negated as a new OR branch:
    --       or (v_set_by is not distinct from auth.uid())
    --   which fires (refuses) ONLY when the winner set the value themselves — NULL-safe, so a
    --   server-side NULL setter (v_set_by is null) is still permitted (AC-PMS-019), and a legitimate
    --   senior setter (v_set_by != winner) is still permitted. This branch is INDEPENDENT of
    --   may_approve_work_of: even if a future bug ever made may_approve_work_of(X, X) TRUE again,
    --   a self-authored win is refused here, so the SoD is not reachable through the identity
    --   predicate at all. (§1 and §3 are defence in depth — §1 is the primary; §3 is the backstop.)
    if coalesce(v_value, 0) > 0
       and not public.holds_won_value_authority(v_role)
       and (    v_set_at is null                                          -- no witness -> FAIL CLOSED
             or v_set_by is not distinct from auth.uid()                  -- ⚑ 0181: winner self-authored
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
