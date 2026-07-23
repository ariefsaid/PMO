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

  -- ── §rekey — IN PLACE, DETERMINISTIC, from data PMO already holds (FR-BFY-035c/037) ────────────
  -- Nothing is deleted, inserted or re-created: the SAME row keeps its id, its `external_record_id`
  -- (the ERP `Budget` name) and its `created_at`, and only the identity it is filed under changes.
  -- The year comes from the version's `budget_version_erp_mirror` row — the preflight above has
  -- already proven there is EXACTLY ONE distinct fiscal year per version, so the scalar subquery is
  -- total and unambiguous by construction (it is `min()` over a one-element set, never a choice).
  update public.external_refs er
     set pmo_record_id = er.pmo_record_id || ':' || public.budget_fiscal_year_token((
           select min(m.fiscal_year)
             from public.budget_version_erp_mirror m
            where m.budget_version_id = er.pmo_record_id::uuid))
   where er.domain = 'budget';

  -- The outbox row's identity AND its deterministic key. The key KEEPS ITS ORIGINAL EPOCH
  -- (`split_part(key,':',3)` of the old `bud:<vid>:<epochMs>` — a uuid contains no ':'): a fresh epoch
  -- would mint a DIFFERENT command identity, and the whole point is that this is the same command,
  -- migrated. `bud:<vid>:<token>:<epoch>` is byte-identical to what budgetPushKey.ts now derives.
  update public.external_command_outbox o
     set pmo_record_id   = o.pmo_record_id || ':' || y.tok,
         idempotency_key = 'bud:' || o.pmo_record_id || ':' || y.tok || ':' || split_part(o.idempotency_key, ':', 3)
    from (select distinct m.budget_version_id, public.budget_fiscal_year_token(m.fiscal_year) as tok
            from public.budget_version_erp_mirror m) y
   where o.domain = 'budget'
     and y.budget_version_id = o.pmo_record_id::uuid;

  -- `budget_version_erp_mirror` is deliberately UNTOUCHED: its FK stays the BARE budget_version_id
  -- (plan FENCE 5) and its recorded fiscal_year is the fact this migration READS, never rewrites.
  -- No other domain is touched — every statement above is `domain = 'budget'`.
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
-- ⚑ service_role MAY run it (and only service_role): AC-BFY-031 drives this migration end-to-end
-- against the live bench — seed a pre-release BARE mapping from a REAL push, run the re-key, then
-- re-activate through the served boundary and count the ERP Budgets. That proof is worth more than
-- the notional privilege: service_role bypasses RLS and can already UPDATE `external_refs` and
-- `external_command_outbox` directly, so calling the deterministic, preflighted version of the same
-- rewrite grants it nothing it does not already have. Every USER role stays revoked.
grant execute on function public.bfy_migration_0154_rekey() to service_role;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §revert — the STAGED rollback (NFR-BFY-REV-001), honestly bounded.
--
-- Defined HERE (with the up-migration) and CALLED by the staged
-- `supabase/migrations/rollback/0154_budget_identity_year_qualified_down.sql`, which `supabase db
-- reset` never applies. Two reasons it lives here: a rollback that only exists in an un-applied file
-- can never be tested before the night someone needs it, and its refusal logic is the part most worth
-- proving (bfy_migration_reversibility.test.sql).
--
-- ⚑ THE BOUNDARY, STATED PLAINLY. One year-qualified identity per version reverts 1:1 — the bare key
-- can represent it. TWO (a multi-FY fan-out) cannot: `external_refs` is unique on
-- (org_id, domain, pmo_record_id), so collapsing them would DROP one year's pointer to a live ERP
-- `Budget` that is still enforcing its own overspend controls. The revert therefore FAILS CLOSED and
-- NAMES the version. Once a multi-FY push has happened the identity is year-qualified for good.
create or replace function public.bfy_migration_0154_revert()
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  r_id  record;
  r_ver record;
begin
  perform pg_advisory_xact_lock(hashtext('pmo_budget_identity_rekey'));

  -- (1) shape: everything in the budget domain must be year-qualified `<uuid>:<token>`. A bare or
  --     unrecognised row means the database is in a state this rollback did not produce and cannot
  --     reason about — refuse it by name rather than half-revert.
  for r_id in
    select 'external_refs'::text as tbl, pmo_record_id from public.external_refs where domain = 'budget'
    union all
    select 'external_command_outbox'::text, pmo_record_id from public.external_command_outbox where domain = 'budget'
  loop
    if r_id.pmo_record_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:.+$' then
      raise exception
        'BFY 0154 rollback: % holds budget pmo_record_id "%" which is not year-qualified — this database is not in the state 0154 leaves behind. Refusing to half-revert.',
        r_id.tbl, r_id.pmo_record_id;
    end if;
  end loop;

  -- (2) the named irreversibility: >1 DISTINCT year-qualified identity for one version.
  for r_ver in
    select vid, count(*) as n from (
      select distinct split_part(pmo_record_id, ':', 1) as vid, pmo_record_id
        from public.external_refs where domain = 'budget'
      union
      select distinct split_part(pmo_record_id, ':', 1), pmo_record_id
        from public.external_command_outbox where domain = 'budget'
    ) s group by vid having count(*) > 1
  loop
    raise exception
      'BFY 0154 rollback: budget version % has % year-qualified identities (a multi-FY fan-out). The bare identity is unique per version and can hold only ONE ERP pointer, so this rollback would silently drop a year of a live ERP Budget. Refused — this irreversibility is named in NFR-BFY-REV-001.',
      r_ver.vid, r_ver.n;
  end loop;

  -- (3) the 1:1 revert, in place. The uuid is everything before the FIRST ':' (a uuid contains none);
  --     the epoch is everything after the LAST ':' (the encoded token itself may contain one).
  update public.external_refs
     set pmo_record_id = split_part(pmo_record_id, ':', 1)
   where domain = 'budget';

  update public.external_command_outbox
     set pmo_record_id   = split_part(pmo_record_id, ':', 1),
         idempotency_key = 'bud:' || split_part(pmo_record_id, ':', 1) || ':' || regexp_replace(idempotency_key, '^.*:', '')
   where domain = 'budget';
end;
$$;

comment on function public.bfy_migration_0154_revert() is
  'NFR-BFY-REV-001 — the staged, fail-closed rollback of the budget identity re-key. Single-FY rows '
  'revert 1:1; a multi-FY fan-out is REFUSED by name (two ERP pointers cannot collapse into one bare '
  'unique key). Called by supabase/migrations/rollback/0154_budget_identity_year_qualified_down.sql.';

revoke all on function public.bfy_migration_0154_revert() from public;
revoke all on function public.bfy_migration_0154_revert() from anon;
revoke all on function public.bfy_migration_0154_revert() from authenticated;
revoke all on function public.bfy_migration_0154_revert() from service_role;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §fence — the write-side half of FR-BFY-035a, honoured by OLD AND NEW CODE ALIKE.
--
-- The spec asks for "quiescence OR a DB fence honoured by both old and new code". Deploy-time
-- quiescence (release-engineer drains budget dispatch + sweep) is the PRIMARY mechanism and this does
-- not replace it. But the race it must close is a request already in flight between the ERP commit and
-- the outbox insert — a window no deploy step can see — and the write path reaches Postgres through
-- PostgREST, one statement per transaction, so application code CANNOT hold a lock across it.
--
-- The only fence a PostgREST-mediated writer can honour is one enforced BY THE DATABASE, on the write
-- itself. This trigger is exactly the "attempt the advisory lock before any budget outbox insert" the
-- plan specifies, relocated to the one place both the old and the new binary must pass through.
--
-- SHARED, not exclusive: concurrent budget pushes must never fence EACH OTHER (a multi-year fan-out is
-- several inserts, and two operators may push at once). Only the re-key, which takes the EXCLUSIVE
-- half, can make this acquisition fail — and while it does, a bare `pmo_record_id` cannot land after
-- the rewrite. `try`/nowait, so a fenced writer fails fast and retryably instead of queueing behind a
-- migration. 55P03 = lock_not_available: an honest, retryable classification, not a data error.
create or replace function public.enforce_budget_identity_rekey_fence()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if not pg_try_advisory_xact_lock_shared(hashtext('pmo_budget_identity_rekey')) then
    raise exception
      'budget dispatch is fenced: the budget identity re-key migration is running. Retry once it completes.'
      using errcode = '55P03';
  end if;
  return new;
end;
$$;

comment on function public.enforce_budget_identity_rekey_fence() is
  'FR-BFY-035a — the DB-side migration fence. Every budget outbox INSERT takes the SHARED half of the '
  'pmo_budget_identity_rekey advisory lock; bfy_migration_0154_rekey() takes the EXCLUSIVE half for its '
  'whole transaction, so no in-flight push can land a bare pmo_record_id after the rewrite.';

drop trigger if exists enforce_budget_identity_rekey_fence on public.external_command_outbox;
create trigger enforce_budget_identity_rekey_fence
  before insert on public.external_command_outbox
  for each row when (new.domain = 'budget')
  execute function public.enforce_budget_identity_rekey_fence();

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §finalize-fence — record_outbox_ref DERIVES its identity from the LOCKED outbox row (FR-BFY-035, FU-2
-- BLOCKER 4). The §fence trigger above stops a BARE outbox INSERT during the re-key, but finalization is
-- NOT an outbox insert — it is `record_outbox_ref` inserting into `external_refs`. An old in-flight
-- binary that inserted a bare budget outbox row BEFORE this migration, then finalizes AFTER it, would
-- (with 0096's original body) write a BARE external_refs mapping from its stale caller-supplied
-- `p_pmo_record_id` — orphaning the qualified mapping the new identity lookup/create-guard reason from,
-- and leaving a live ERP Budget unreachable by the year-qualified identity.
--
-- So the ref's (domain, pmo_record_id) are now taken from the LOCKED outbox row `v` — which 0154 has
-- already re-keyed to `<vid>:<encoded_fy>` — never from the caller. The mapping therefore always matches
-- the command it finalizes. This is BYTE-FOR-BYTE for every already-consistent caller
-- (v.pmo_record_id = p_pmo_record_id, v.domain = p_domain — true for every domain in steady state); only
-- the deploy-race window is corrected. The fence + row lock + generation/state guard are all retained.
-- The signature is unchanged (callers/types stay valid); p_domain/p_pmo_record_id become advisory.
create or replace function public.record_outbox_ref(
  p_id uuid, p_generation int,
  p_domain text, p_pmo_record_id text, p_external_tier text, p_external_record_id text
) returns int
  language plpgsql security definer set search_path = public as $$
  declare v public.external_command_outbox;
  begin
    select * into v from public.external_command_outbox where id = p_id for update;
    -- Fence: only the CURRENT generation on a still-`committed` row may write the ref (0 = superseded).
    if v.id is null or v.claim_generation is distinct from p_generation or v.state <> 'committed' then
      return 0;
    end if;
    -- ⚑ FU-2 BLOCKER 4 — DERIVE (domain, pmo_record_id) from the LOCKED row, NOT the caller. The locked
    -- row's pmo_record_id is authoritative (0154 re-keyed it); a stale bare p_pmo_record_id from an old
    -- in-flight finalizer can no longer land a bare mapping after the re-key.
    insert into public.external_refs (org_id, domain, pmo_record_id, external_tier, external_record_id)
      values (v.org_id, v.domain, v.pmo_record_id, p_external_tier, p_external_record_id)
      on conflict (org_id, domain, pmo_record_id)
        do update set external_record_id = excluded.external_record_id, external_tier = excluded.external_tier;
    return 1;
  end; $$;

comment on function public.record_outbox_ref(uuid, int, text, text, text, text) is
  'FR-BFY-035 (FU-2 BLOCKER 4) — fenced external_refs finalization. Derives (domain, pmo_record_id) from '
  'the LOCKED outbox row so an old in-flight finalizer cannot write a stale bare mapping after the 0154 '
  're-key. Proven by supabase/tests/bfy_outbox_ref_rekey_race.test.sql.';

-- Run it once, here, in this migration's own transaction (the fence is held for exactly that window).
select public.bfy_migration_0154_rekey();
