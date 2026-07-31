-- 0183_transition_project_witness_must_be_active.sql — closes a LIVE money-SoD bypass that 0181 missed.
--
-- THE DEFECT (reproduced end-to-end on this DB by the Director, AFTER 0181). 0181 closed the
-- SELF-approval hole three ways, but `may_approve_work_of`'s line-management limb is just
-- `(author.manager_id = p_approver_id)` and never asks whether the APPROVER is a currently active
-- member. So the money SoD's required "second person" can be an OFFBOARDED account:
--   1. Manager D (active, Project Manager) is W's `manager_id`. D calls
--      set_project_contract_value(project, 77000000) — the witness trigger stamps v_set_by = D.
--   2. D is offboarded (`profiles.status='disabled'`).
--   3. W alone walks Leads -> PQ Submitted -> Quotation Submitted -> 'Won, Pending KoM'.
--   RESULT: Won, Pending KoM, contract_value 77,000,000 — booked on an OFFBOARDED witness.
-- 0181 does NOT cover this: D != W, so the `v_set_by is not distinct from auth.uid()` self-backstop
-- never fires; and `may_approve_work_of(D, W)` is TRUE (D is W's `manager_id`), so the "senior"
-- limb passes too. The whole SoD collapses to a rubber-stamp by someone who is no longer employed.
--
-- THE FIX (one layer, the WIN-GATE ONLY — see SCOPE). transition_project's win-gate now additionally
-- refuses when the value's witness is not a CURRENTLY ACTIVE member, via the resolved-actor overload
-- `public.is_active_member(p_user_id uuid)` that 0180 added. That overload carries the WHOLE rule —
-- `profiles.status='active'` AND 0095's `auth.users.banned_until` check — which a bare
-- `profiles.status` lookup would miss (the exact half-coverage bug 0180 was written to close). The
-- refusal MESSAGE is its own and distinguishable from the existing "not set by anyone senior to you"
-- text, per FR-AMG-004: an offboarded witness is a different diagnosis (the setter HAD authority but
-- is no longer active) and the operator must be able to tell them apart. transition_project is
-- SECURITY DEFINER, so it runs as its owner; the uuid overload is revoked from `authenticated`
-- (0180), which is fine — the owner calls its own function.
--
-- ⚑ SCOPE — the WIN-GATE ONLY, NOT `may_approve_work_of`. Luna's caller sweep (confirmed by the
--   Director) found `transition_project` is the ONLY production caller of `may_approve_work_of`, but
--   the predicate is general and a FUTURE caller may legitimately want historical approval (e.g. an
--   audit report "who could have approved this at time T"). Adding `is_active_member` to the predicate
--   itself would silently change that predicate's meaning for every caller. The win-gate is the one
--   place the active-witness requirement is real, so the check lives here and only here.
--
-- ⚑ KEEP 0181's defences exactly as they are. This migration adds ONE conjunct to the win-gate's
--   refusal clause and ONE message branch; it does NOT touch §1 (`may_approve_work_of` self-guard),
--   §2 (`profiles_manager_not_self` CHECK), or 0181's `v_set_by is not distinct from auth.uid()`
--   self-backstop. Defence in depth: even with this conjunct removed, the self case is still refused
--   by §1 + 0181's backstop; the offboarded-witness case is what THIS layer alone owns.
--
-- ── REVERSIBILITY (ADR-0006) ────────────────────────────────────────────────────────────────────
-- ⚑ NOT `supabase db reset` — v0.8.0 is in production. The manual reverse is an operation on THIS
--   file (it RESTORES THE VULNERABLE STATE in which an offboarded witness can ratify a win):
--     -- Re-create transition_project from ITS CURRENT live-catalog definition (pg_get_functiondef)
--     -- with this file's ONE added conjunct and ONE added message branch removed:
--     --   · in the win-gate refusal clause, delete the OR branch:
--     --       or (v_set_by is not null and not public.is_active_member(v_set_by))  -- ⚑ 0183
--     --   · in the message selection, delete the ELSIF branch that names the offboarded witness
--     --     (its raise ... 'no longer an active member ...'), collapsing selection back to the
--     --     two-branch (v_set_at is null / else) form 0181 shipped.
--     -- Everything else in the body is byte-for-byte the live definition as of this file.
--   ⚑ Do NOT reverse by naming a migration number: the live body of transition_project is owned by
--     THIS file as of 0183 (it re-created the function), and a later migration may re-create it
--     again — naming a number is how 0180's rollback list named the wrong source for 14 of 15
--     functions. Reverse by editing the current file's text, as above.

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- transition_project — body taken VERBATIM from the live catalog via pg_get_functiondef on
-- 2026-07-30 (it is currently owned by 0181, whose body == the live definition), with TWO additions
-- marked inline (⚑ 0183): one conjunct in the win-gate refusal clause, one branch in the message
-- selection. The transition map, org re-assertion, active-membership-of-the-CALLER conjunct, coarse
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
    --   seeded and imported deal. Pinned by 0170 AC-PMS-019. (The 0183 witness-active conjunct below
    --   is guarded by `v_set_by is not null`, so a NULL server-side witness still passes here.)
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
    --
    -- ⚑ 0183 — the win now ADDITIONALLY requires the value-setter to be a CURRENTLY ACTIVE member.
    --   may_approve_work_of answers "could this person approve the winner's work?" by rank + line
    --   management ALONE; it does NOT ask whether the person is employed today, so an OFFBOARDED
    --   manager (or any offboarded outranker) still satisfies it. The permit requirement is therefore
    --   "v_set_by is null OR is_active_member(v_set_by)" (NULL-safe for the server-side witness), and
    --   in this REFUSAL gate it appears De Morgan-negated as a new OR branch guarded by
    --   `v_set_by is not null` so the server-side NULL witness is unaffected (AC-PMS-019). This uses
    --   the uuid overload of is_active_member (0180) — the WHOLE rule (status + banned_until), run as
    --   the definer's owner since the overload is revoked from authenticated. Its refusal MESSAGE is
    --   its own (see the elsif below), distinguishable from "not set by anyone senior to you": the
    --   setter HAD authority but is no longer active, which is a different, more actionable diagnosis.
    if coalesce(v_value, 0) > 0
       and not public.holds_won_value_authority(v_role)
       and (    v_set_at is null                                          -- no witness -> FAIL CLOSED
             or v_set_by is not distinct from auth.uid()                  -- ⚑ 0181: winner self-authored
             or (v_set_by is not null and not public.is_active_member(v_set_by))  -- ⚑ 0183: witness offboarded
             or (v_set_by is not null and not public.may_approve_work_of(v_set_by, auth.uid())) )
    then
      if v_set_at is null then
        raise exception
          'this deal''s contract value has no recorded author, so you cannot win it: the value must be set by your supervisor or by someone who outranks you, through set_project_contract_value (which records who set it) — or ask them to win the deal'
          using errcode = '42501';
      elsif v_set_by is not null and not public.is_active_member(v_set_by) then
        -- ⚑ 0183 (FR-AMG-004): the witness exists and HAD authority over the winner, but is no
        -- longer an active member. Distinct from the "senior" branch below: that one says the setter
        -- never had authority; this one says they did but are gone. Ordered BEFORE the senior branch
        -- so the offboarded diagnosis wins when both would fire (an offboarded peer is offboarded
        -- first, not-senior second — the operator needs "get someone who is still here").
        raise exception
          'this deal''s contract value was set by someone who is no longer an active member of this organisation, so you cannot win it: the value must be re-set by your supervisor or by someone who outranks you who is currently active, through set_project_contract_value (which records who set it) — or ask them to win the deal'
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
