-- 0160_budget_push_status_binding_gate.sql — AC-BUD-003 / FR-BUD-006(a) / FR-BUD-010.
--
-- ⚑ SUPERSEDES the `get_budget_push_status` gate shipped in 0149 (do NOT edit 0149 in place). Budget is
-- Posture B: PMO stays SoT and NO `external_domain_ownership` row for 'budget' is ever created
-- (FR-BUD-006(a)). The spec is explicit and twice-stated (FR-BUD-010): "⚑ `domain_externally_owned` does
-- NOT gain a `budget` row — employment is asserted by the BINDING + the push route, not by a flip."
--
-- The 0149 `unrecorded` CTE gated the never-pushed / unstamped-activation inference on
-- `public.domain_owned_by_tier(p.org_id,'budget','erpnext')`, which reads exactly that forbidden
-- `external_domain_ownership` row (0135). This migration moves the gate to the SPEC-NAMED signal: an
-- ACTIVE ERPNext binding — byte-for-byte the shape the served boundary's `orgEmploysErpnext` predicate
-- uses (`external_org_bindings` with `external_tier='erpnext'` and `activated_at is not null`). Nothing
-- else about the function changes: SECURITY INVOKER, the recorded-wins ordering, the MEDIUM-1 outbox
-- hold-releasable read and every column are preserved exactly.
--
-- SECURITY INVOKER (unchanged): RLS on `external_org_bindings`
-- (`org_id = auth_org_id() and is_active_member()`) is the org boundary for the exists() probe, exactly
-- as it was for `domain_owned_by_tier` — a cross-org read cannot see another org's binding and so never
-- infers a push banner for it.
--
-- Reversibility (ADR-0006): re-run 0149's `create or replace function public.get_budget_push_status(uuid)`.

-- ⚑ The SPEC-NAMED employ predicate for Posture-B budget, as an RPC so the dispatch's server-side
-- authorization gate (`adapter-dispatch/authGuard.ts`) can assert it the same way it asserts
-- `domain_owned_by_tier` for the Posture-A domains. Budget NEVER has a `domain_externally_owned('budget')`
-- row (FR-BUD-006(a)); its employment is the ACTIVE ERPNext binding (FR-BUD-010) — this is byte-for-byte
-- the shape the served boundary's `orgEmploysErpnext` helper uses (`external_org_bindings` with
-- `external_tier='erpnext'` and `activated_at is not null`).
--
-- SECURITY INVOKER: under the caller's JWT (the deputy client on the synchronous push) RLS on
-- `external_org_bindings` restricts to the caller's own org, so a cross-org push cannot fabricate
-- employment; under service_role (the sweep's recovery pass) RLS is bypassed and it reads the row
-- directly — exactly the dual-caller posture `domain_owned_by_tier` already relies on.
--
-- Reversibility (ADR-0006): drop function if exists public.org_has_active_erpnext_binding(uuid);
create or replace function public.org_has_active_erpnext_binding(p_org_id uuid)
  returns boolean
  language sql stable security invoker set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.external_org_bindings
     where org_id = p_org_id and external_tier = 'erpnext' and activated_at is not null
  )
$$;

revoke all on function public.org_has_active_erpnext_binding(uuid) from public;
grant execute on function public.org_has_active_erpnext_binding(uuid) to authenticated;
grant execute on function public.org_has_active_erpnext_binding(uuid) to service_role;
revoke execute on function public.org_has_active_erpnext_binding(uuid) from anon;

create or replace function public.get_budget_push_status(p_project_id uuid)
returns table (
  push_state          text,
  push_error          text,
  unmapped_categories text[],
  -- C-5: the ERP `Budget` document the push created. Stored since 0137, read by nothing until now — so
  -- a successful push could not even be shown to have produced anything.
  erp_budget_name     text,
  -- The fiscal year this status is ABOUT, so the banner names it rather than being suppressed on every
  -- other year.
  fiscal_year         text,
  pushed_at           timestamptz,
  -- ⚑ MEDIUM-1 (money-safety audit round 7) — IS THERE ACTUALLY A HOLD TO RELEASE?
  --
  -- `budget_version_erp_mirror.push_state = 'held'` has TWO producers, and only one of them leaves a
  -- releasable command behind:
  --   (a) the dispatch's real `command-held` outcome — the `external_command_outbox` row genuinely IS
  --       `held`, it wedges `external_command_outbox_one_inflight_per_record`, and releasing it is the
  --       operator's only route out;
  --   (b) the SWEEP parking a row it may not re-drive (`budget-push-attempts-exhausted` /
  --       `budget-push-no-outbox-candidate`, `erpnext-sweep/index.ts`) — here the outbox row is
  --       `failed`/`pending`/absent, so there is nothing in a `held` state at all.
  -- The mirror alone cannot tell them apart, so the banner offered "Release the hold" in BOTH, and in
  -- (b) the click could only ever fail ("There is no held ERP command to release for this project.") —
  -- on the screen that is telling the operator ERPNext is enforcing the wrong budget, or none. A button
  -- whose only outcome is an error is worse than no button: it costs the reader their remaining trust in
  -- the screen. So the surface asks the OUTBOX, which is the only thing that knows.
  --
  -- Read under `security invoker`, so `external_command_outbox_select` (`org_id = auth_org_id() and
  -- is_active_member()`) is the org boundary exactly as it is for the repository's own lookup — another
  -- org's held row is not visible here and would be refused by the RPC regardless.
  hold_releasable     boolean
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with active_version as (
    select v.id, v.activated_at
      from public.budget_versions v
     where v.project_id = p_project_id and v.status = 'Active'
     limit 1
  ),
  recorded as (
    select em.push_state, em.push_error, em.unmapped_categories, em.erp_budget_name, em.fiscal_year, em.pushed_at
      from public.budget_version_erp_mirror em
      join active_version av on av.id = em.budget_version_id
     -- Under the deferred single-FY default there is exactly one row; ordering makes the choice
     -- DETERMINISTIC rather than incidental should OQ-BUD-3(c) ever fan it out, and prefers the most
     -- recently settled year.
     order by em.pushed_at desc nulls last, em.fiscal_year desc
     limit 1
  ),
  -- ⚑ HIGH-C (Luna re-audit round 2, 2026-07-21) — "no row" is a STATE, not an absence of news.
  -- EVERY writer of `budget_version_erp_mirror` lives inside the `adapter-dispatch` edge function, so a
  -- dispatch that never REACHES it (dropped connection, tab closed mid-request, platform 502) leaves NO
  -- mirror row at all — and the sweep backstop's work queue IS that mirror, so nothing re-drives it and
  -- nobody is ever notified. `push_state` then came back NULL, which the operator surface renders as a
  -- perfectly clean screen while ERPNext keeps enforcing the previous budget (or none) indefinitely.
  --
  -- ⚑ FR-BUD-010 / AC-BUD-003 (mig 0160) — GATED ON AN ACTIVE ERPNext BINDING, not a domain-ownership
  -- flip. Employment is the binding + the push route (spec §7, twice-stated); budget NEVER gains an
  -- `external_domain_ownership('budget')` row (FR-BUD-006(a)). This exists() is byte-for-byte the shape
  -- `orgEmploysErpnext` uses, so a non-employing org — which has no ERP to push to — never sees a push
  -- banner at all. A RECORDED push state always wins (this is only consulted when `recorded` is empty).
  --
  -- ⚑ H-3 (Luna audit round 3, 2026-07-22) — the alarm does not require an activation STAMP.
  -- `0139` added `budget_versions.activated_at` nullable with NO backfill, so every version already
  -- Active at migration time carries NULL. Requiring the stamp made that entire population INVISIBLE.
  -- The stamp is not what makes an Active version real; it is what makes it PUSHABLE — so an unstamped
  -- Active version gets its OWN state, because its route out is different: `budgetPushKey` AND the
  -- server-side budget gate both refuse it (deliberately — a money command keyed on an invented
  -- timestamp is worse than one that never runs), so Retry cannot help and is not offered. Activating a
  -- fresh version records a REAL activation act, which is both truthful and pushable.
  unrecorded as (
    select case when (select av.activated_at from active_version av) is null
                then 'unstamped-activation'
                else 'never-pushed' end as state
     where exists (select 1 from active_version)
       and not exists (select 1 from recorded)
       and exists (
             select 1 from public.projects p
              where p.id = p_project_id
                and exists (
                      select 1 from public.external_org_bindings b
                       where b.org_id = p.org_id
                         and b.external_tier = 'erpnext'
                         and b.activated_at is not null))
  ),
  -- MEDIUM-1: a genuinely `held` outbox command for THIS project's Active version. `pmo_record_id` is
  -- `text` (0096), so the version id is cast rather than the column — the index stays usable.
  releasable as (
    select 1
      from public.external_command_outbox o
      join active_version av on o.pmo_record_id = av.id::text
     where o.domain = 'budget' and o.state = 'held'
     limit 1
  )
  select coalesce((select r.push_state from recorded r), (select u.state from unrecorded u)),
         (select r.push_error          from recorded r),
         -- Only ever from a RECORDED push row (NEW-6). The `unrecorded` inference is derived from the
         -- ABSENCE of a mirror row, so by construction it has no names to offer — NULL is the truth.
         (select r.unmapped_categories from recorded r),
         (select r.erp_budget_name     from recorded r),
         (select r.fiscal_year         from recorded r),
         (select r.pushed_at           from recorded r),
         exists (select 1 from releasable);
$$;

revoke all on function public.get_budget_push_status(uuid) from public;
grant execute on function public.get_budget_push_status(uuid) to authenticated;
revoke execute on function public.get_budget_push_status(uuid) from anon;
