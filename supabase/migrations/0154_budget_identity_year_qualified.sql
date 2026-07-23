-- 0154_budget_identity_year_qualified.sql — the budget identity re-key (FR-BFY-035/037, AC-BFY-018/020/021).
-- Spec: docs/specs/budget-fiscal-year-phasing.spec.md §4 step §5 + §4.5 (finding 4 of the round-2 review).
-- Plan: docs/plans/2026-07-23-budget-fiscal-year-phasing.md, Phase D (T18–T20).
--
-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- ⚑ WHAT THIS MIGRATION TOUCHES AND WHY IT IS THE RISKIEST ONE IN THE ISSUE.
--
-- 0153 gave a budget push a per-YEAR shape: one ERP `Budget` per project × fiscal year (ADR-0055 §6).
-- From this release the budget domain's OUTBOX/`external_refs` identity is year-qualified —
-- `<budget_version_id>:<encoded_fiscal_year>` — so the outbox's uniqueness/one-in-flight indexes
-- (0096/0134) and `external_refs` (0088) scope PER YEAR. Rows written BEFORE this release carry the
-- bare `<budget_version_id>`.
--
-- Every one of those bare rows is a POINTER TO A REAL ERP BUDGET. Leave one behind and the new code
-- resolves only `<vid>:<fy>`, finds no mapping, and `checkCreateTargetUnmapped` lets a `create` through
-- for a project-year ERPNext ALREADY HOLDS — a duplicate budget on a client's ledger, with its own
-- overspend controls. Re-key the wrong year and PMO points at the wrong ERP document.
--
-- So the re-key is: IN PLACE (never delete/re-create a pointer, never touch an ERP object), DETERMINISTIC
-- (the year comes from PMO's OWN `budget_version_erp_mirror` row, never invented — distinct from the
-- spec's no-backfill posture, which forbids inventing a year for a LINE ITEM), and FAIL-CLOSED (a row
-- whose year cannot be recovered unambiguously aborts the whole transaction, by name, before any write).
--
-- BLAST RADIUS (stated honestly): ERPNext is dark outside the local bench, so the real population today
-- is the bench plus demo data — `seed.sql` seeds no budget `external_refs`/outbox rows. The requirement
-- stands regardless; the fence exists for the day it is not true.
--
-- REVERSIBILITY (NFR-BFY-REV-001, honestly bounded — see 0154_..._down.sql):
--   • a SINGLE-FY version (one year-qualified row) reverts 1:1 to the bare `<vid>`;
--   • a MULTI-FY fan-out (two year-qualified rows for one version) CANNOT collapse to one bare key —
--     the bare identity cannot represent two ERP pointers — so the revert FAILS CLOSED naming the
--     version rather than silently dropping a year's pointer. Once a multi-FY push has happened the
--     identity is year-qualified FOR GOOD. That is a NAMED, accepted irreversibility (it is the
--     feature's own capability), never a silent loss.
--
-- Sections:
--   §preflight  fail closed on every unrecoverable shape        — T18, bfy_migration_preflight.test.sql
--   §rekey      the in-place, deterministic rewrite + the fence  — T19, bfy_external_refs_rekey.test.sql
--   §revert     the staged, fail-closed rollback                 — T20, bfy_migration_reversibility.test.sql
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- ⚑ WHY A FUNCTION AND NOT A BARE `DO $$ … $$` BLOCK. The preflight and the rewrite are the part of
-- this issue with the highest cost of being wrong, so they need a pgTAP proof — and pgTAP can only
-- assert about something it can CALL. A `DO` block runs once at migration time and is unobservable
-- afterwards; a function is the same code, invoked once by this migration (below) and again by the
-- tests against seeded pre-release populations. It is EXECUTE-revoked from every client role, so it is
-- reachable only by the migration/owner connection.
create or replace function public.bfy_migration_0154_rekey()
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  r_id      record;
  r_ver     record;
  r_key     record;
  v_years   int;
begin
  -- ── THE FENCE (FR-BFY-035a) ────────────────────────────────────────────────────────────────────
  -- An EXCLUSIVE advisory lock, held for this transaction. The budget outbox's insert trigger
  -- (§rekey) takes the SHARED half of the same lock, so while this transaction runs NO budget outbox
  -- row can be inserted by any other session — old code or new — and a request in flight between
  -- gate/ERP-commit and outbox-finalisation cannot land a bare `pmo_record_id` AFTER the rewrite.
  -- Shared/exclusive (not try/nowait on the writer side) is deliberate: concurrent budget pushes must
  -- NOT fence each other, only this migration fences them.
  -- Deploy-time quiescence (release-engineer drains budget dispatch + sweep) remains the PRIMARY
  -- mechanism; this lock is defence in depth for the window quiescence cannot cover.
  perform pg_advisory_xact_lock(hashtext('pmo_budget_identity_rekey'));

  -- ── §preflight (FR-BFY-035b) — every check runs BEFORE any rewrite, in this transaction ────────
  -- (1) shape: every budget-domain identity is either a bare UUID (to be re-keyed) or, if it already
  --     carries a ':', evidence of a PARTIAL PRIOR RUN — which is an operator decision, never a thing
  --     to re-run over. Anything else is unrecognised and is never quietly skipped.
  for r_id in
    select 'external_refs'::text as tbl, pmo_record_id from public.external_refs where domain = 'budget'
    union all
    select 'external_command_outbox'::text, pmo_record_id from public.external_command_outbox where domain = 'budget'
  loop
    if position(':' in r_id.pmo_record_id) > 0 then
      raise exception
        'BFY 0154 preflight: % holds an ALREADY year-qualified budget pmo_record_id "%" — a partial prior run. Resolve it by hand; this migration will not re-run over it.',
        r_id.tbl, r_id.pmo_record_id;
    end if;
    if r_id.pmo_record_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception
        'BFY 0154 preflight: % holds an UNRECOGNISED budget pmo_record_id "%" — neither a bare budget_version_id nor a year-qualified identity. Refusing to guess.',
        r_id.tbl, r_id.pmo_record_id;
    end if;
  end loop;

  -- (2) recoverability: the year is recovered from PMO's OWN mirror row (0137). Exactly one mirror
  --     fiscal year per version is recoverable; zero or many are not.
  for r_ver in
    select distinct pmo_record_id from public.external_refs where domain = 'budget'
    union
    select distinct pmo_record_id from public.external_command_outbox where domain = 'budget'
  loop
    select count(distinct m.fiscal_year) into v_years
      from public.budget_version_erp_mirror m
     where m.budget_version_id = r_ver.pmo_record_id::uuid;

    if v_years = 0 then
      raise exception
        'BFY 0154 preflight: budget mapping for version % has NO budget_version_erp_mirror row — there is no PMO-held fact from which to recover its fiscal year. Refusing to invent one.',
        r_ver.pmo_record_id;
    elsif v_years > 1 then
      raise exception
        'BFY 0154 preflight: budget mapping for version % has % distinct mirror fiscal years — the year is AMBIGUOUS and a guess would orphan an ERP Budget. Resolve by hand.',
        r_ver.pmo_record_id, v_years;
    end if;
  end loop;

  -- (3) the outbox key must be the old deterministic shape `bud:<vid>:<epochMs>`, because the re-key
  --     CARRIES ITS EPOCH FORWARD (a new epoch would be a new command identity, not the same one).
  for r_key in
    select pmo_record_id, idempotency_key from public.external_command_outbox where domain = 'budget'
  loop
    if r_key.idempotency_key !~ ('^bud:' || r_key.pmo_record_id || ':[0-9]+$') then
      raise exception
        'BFY 0154 preflight: budget outbox idempotency_key "%" is not the old bud:<budget_version_id>:<epochMs> shape — its epoch cannot be carried into the year-qualified key.',
        r_key.idempotency_key;
    end if;
  end loop;
end;
$$;

comment on function public.bfy_migration_0154_rekey() is
  'FR-BFY-035/037 — preflight + in-place deterministic re-key of the budget domain identity from the '
  'bare <budget_version_id> to <budget_version_id>:<encoded_fiscal_year>. Invoked once by 0154; '
  'EXECUTE-revoked from every client role. Proven by supabase/tests/bfy_migration_preflight.test.sql '
  'and bfy_external_refs_rekey.test.sql.';

revoke all on function public.bfy_migration_0154_rekey() from public;
revoke all on function public.bfy_migration_0154_rekey() from anon;
revoke all on function public.bfy_migration_0154_rekey() from authenticated;
revoke all on function public.bfy_migration_0154_rekey() from service_role;

-- Run it once, here, in this migration's own transaction (the fence is held for exactly that window).
select public.bfy_migration_0154_rekey();
