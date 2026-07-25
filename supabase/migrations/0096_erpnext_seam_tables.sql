-- 0096_erpnext_seam_tables.sql — ERPNext P2 seam generalization (slice 1, ADR-0055/ADR-0058).
-- Three machine-written tables (org_id seam, stamp_org_id() trigger, RLS) + two SECURITY DEFINER RPCs
-- that are the ONLY non-service-role path to the outbox:
--   external_org_bindings     — per-org ERPNext binding (site URL + resolved Company defaults; secret_ref
--                                only, NO secret value ever stored — NFR-ENA-SEC-002, OQ-6).
--   external_command_outbox   — the durable money-idempotency provisional-ref (ADR-0058 R1/R3). The
--                                unique 4-tuple closes the INSERT race; claim_outbox_for_commit() closes
--                                the REISSUE race (at-most-once claim); claim_generation is the fencing
--                                token that closes the lease-expiry overlap (F4).
--   external_ref_lineage      — cancel/amend history (R2): repoint + supersede tracking.
--
-- Reversibility (ADR-0006): supabase db reset. Manual rollback (functions before tables, reverse order):
--   drop function if exists public.mark_outbox_held(uuid, int, text);
--   drop function if exists public.confirm_outbox(uuid, int);
--   drop function if exists public.record_outbox_ref(uuid, int, text, text, text, text);
--   drop function if exists public.outbox_reconcile_candidates(uuid);
--   drop function if exists public.quarantine_committing(uuid, interval, interval);
--   drop function if exists public.claim_outbox_for_commit(uuid, interval);
--   drop trigger if exists external_ref_lineage_stamp_org_id on public.external_ref_lineage;
--   drop trigger if exists external_command_outbox_stamp_org_id on public.external_command_outbox;
--   drop trigger if exists external_org_bindings_stamp_org_id on public.external_org_bindings;
--   drop table if exists public.external_ref_lineage;
--   drop table if exists public.external_command_outbox;
--   drop table if exists public.external_org_bindings;

-- ── external_org_bindings (OQ-6): per-org ERPNext binding. secret_ref points into vault AS/fn secrets —
-- NO secret value stored (NFR-ENA-SEC-002). ──────────────────────────────────────────────────────────
create table public.external_org_bindings (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null default coalesce(public.auth_org_id(),'00000000-0000-0000-0000-000000000001')
                        references public.organizations(id) on delete cascade,
  external_tier       text not null,
  site_url            text not null,
  secret_ref          text not null,
  version_major       int,
  config              jsonb not null default '{}'::jsonb,   -- {company, default_payable_account, default_cash_account, default_bank_account, default_expense_account, cost_center, default_warehouse, aging_report_names, report_filter_shape}
  webhook_secret_ref  text,
  activated_at        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (org_id, external_tier)
);

-- ── external_command_outbox (R1/R3): the durable provisional ref. unique 4-tuple = the idempotency
-- guard; claim_generation = the FENCING TOKEN (monotonic per claim) that invalidates a stale claimant's
-- write-back. ────────────────────────────────────────────────────────────────────────────────────────
create table public.external_command_outbox (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null default coalesce(public.auth_org_id(),'00000000-0000-0000-0000-000000000001')
                        references public.organizations(id) on delete cascade,
  domain              text not null,
  pmo_record_id       text not null,
  idempotency_key     text not null,
  external_tier       text not null,
  operation           text not null check (operation in ('create','update','transition')),
  -- 'held' (C-1 DIRECTOR RULING, ADR-0058 §4): the recovery-inconclusive terminal for a MUTABLE-anchor
  -- money doc (Payment Entry). A PE whose anchor (reference_no) can be ERP-side edited has NO conclusive
  -- absence — so if a post-window recovery composite-probe finds no doc, it is NEVER auto-reissued
  -- (that would risk a double-pay); it transitions to 'held' for ops resolution instead. Never a
  -- reconcile candidate (outbox_reconcile_candidates omits it) — resolved only by an operator.
  state               text not null check (state in ('pending','committing','committed','confirmed','failed','quarantined','held')),
  external_record_id  text,
  canonical           jsonb,                    -- F2: the adapter's REAL returned record, persisted at commit so recovery/finalize mirrors ERP-derived fields (not a {id} stub)
  -- C-1 composite-probe payload (ADR-0058 §4): the command inputs a MUTABLE-anchor recovery probe needs
  -- when the anchor alone is unreliable — party_type/party/paid_amount/reference names + the claim window
  -- start. Persisted at INSERT so the SWEEP recovery path (which reconstructs the command from the outbox
  -- row, never the live request) can run the same deterministic composite probe as the sync retry path.
  payload             jsonb,
  payload_digest      text,
  attempt_count       int not null default 0,
  claim_generation    int not null default 0,   -- fencing token: bumped on every claim; write-backs guard on it
  claimed_at          timestamptz,              -- when the current claimant entered the ERP-POST critical section
  reconcile_after     timestamptz,              -- F1 quarantine visibility window: a quarantined row is resolvable only after this
  last_error          text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (org_id, domain, pmo_record_id, idempotency_key)
);

-- ── external_ref_lineage (R2): cancel/amend history. Index for the "is this ERP name superseded?"
-- lookup. ────────────────────────────────────────────────────────────────────────────────────────────
create table public.external_ref_lineage (
  id                              uuid primary key default gen_random_uuid(),
  org_id                          uuid not null default coalesce(public.auth_org_id(),'00000000-0000-0000-0000-000000000001')
                                    references public.organizations(id) on delete cascade,
  domain                          text not null,
  pmo_record_id                   text not null,
  superseded_external_record_id   text not null,
  successor_external_record_id    text,
  reason                          text not null check (reason in ('cancelled','amended')),
  erp_docstatus                   smallint,
  at                              timestamptz not null default now()
);
create index external_ref_lineage_lookup_idx on public.external_ref_lineage (org_id, domain, superseded_external_record_id);

-- ── RLS: machine-written (service-role write + org-member SELECT). No INSERT/UPDATE/DELETE policy is
-- created for org members — `force row level security` + a SELECT-only policy denies every user-JWT
-- write with 42501 (same idiom as external_refs/external_sync_watermarks, 0088/0089). ─────────────────
alter table public.external_org_bindings enable row level security;
alter table public.external_org_bindings force  row level security;
create policy external_org_bindings_select on public.external_org_bindings
  for select using (org_id = public.auth_org_id() and public.is_active_member());
grant select on public.external_org_bindings to authenticated, anon;

alter table public.external_command_outbox enable row level security;
alter table public.external_command_outbox force  row level security;
create policy external_command_outbox_select on public.external_command_outbox
  for select using (org_id = public.auth_org_id() and public.is_active_member());
grant select on public.external_command_outbox to authenticated, anon;

alter table public.external_ref_lineage enable row level security;
alter table public.external_ref_lineage force  row level security;
create policy external_ref_lineage_select on public.external_ref_lineage
  for select using (org_id = public.auth_org_id() and public.is_active_member());
grant select on public.external_ref_lineage to authenticated, anon;

-- ── stamp_org_id() trigger (0074 pattern) — belt-and-suspenders alongside the coalesce-default column,
-- consistent with every other seed-org-default table (0074's blanket coverage, incl. the agent tables
-- that already carry a coalesce-default). ───────────────────────────────────────────────────────────
create trigger external_org_bindings_stamp_org_id before insert on public.external_org_bindings
  for each row execute function public.stamp_org_id();
create trigger external_command_outbox_stamp_org_id before insert on public.external_command_outbox
  for each row execute function public.stamp_org_id();
create trigger external_ref_lineage_stamp_org_id before insert on public.external_ref_lineage
  for each row execute function public.stamp_org_id();

-- ── The atomic commit claim (ADR-0058 §2): the ONLY gate into the ERP-POST critical section. A
-- conditional UPDATE under Postgres' row lock: two concurrent claims serialize, only the winner
-- transitions and RETURNs the row; the loser's UPDATE re-evaluates the WHERE against the winner's
-- committed row, matches 0 rows (state 'committing') → NULL. Claimable = pending|failed, OR a
-- 'quarantined' row whose reconcile_after visibility window has ELAPSED (F1 — a stale 'committing' row
-- is NOT claimable here; it must first be quarantined, see quarantine_committing). Each win BUMPS
-- claim_generation — the returned value is the caller's FENCING TOKEN: every post-claim write-back (mark
-- committed/confirmed/failed) is guarded `WHERE claim_generation = <token>`, so a superseded claimant
-- matches 0 rows on its late write-back and its result is discarded (F4). SECURITY DEFINER so the
-- policy-less outbox is touched only here + by service_role.
create or replace function public.claim_outbox_for_commit(
  p_id uuid, p_lease interval default interval '60 seconds'
) returns public.external_command_outbox
  language plpgsql security definer set search_path = public as $$
  declare v public.external_command_outbox;
  begin
    update public.external_command_outbox
       set state='committing',
           attempt_count = attempt_count + 1,
           claim_generation = claim_generation + 1,   -- fencing token (F4): monotonic per claim
           claimed_at = now(),
           updated_at = now()
     where id = p_id
       and ( state in ('pending','failed')
             or (state='quarantined' and reconcile_after is not null and reconcile_after < now()) )
    returning * into v;
    return v;   -- v.claim_generation is the caller's fencing token; null ⇒ not claimable now
  end; $$;

-- ── quarantine_committing (F1 — the in-flight-POST-overlap fix). A stale (past-lease) 'committing' row
-- is NEVER auto-reissued: its ERP POST may still be in flight and not yet visible to the remarks-key
-- probe, so a blind re-POST would mint a DUPLICATE money document. Instead this fenced conditional
-- UPDATE transitions it to 'quarantined', BUMPS claim_generation (invalidating the stale claimant's late
-- write-back, F4), and sets a visibility window `reconcile_after = coalesce(claimed_at, now()) + p_window`.
-- A quarantined row is resolved ONLY by the reconciliation path (claim after the window → probe the
-- remarks key → adopt the original POST, or with no ERP hit reissue under the SAME idempotency key). A
-- fresh 'committing' row (a live owner within lease) is left untouched → NULL. SECURITY DEFINER.
create or replace function public.quarantine_committing(
  p_id uuid, p_lease interval default interval '60 seconds', p_window interval default interval '5 minutes'
) returns public.external_command_outbox
  language plpgsql security definer set search_path = public as $$
  declare v public.external_command_outbox;
  begin
    update public.external_command_outbox
       set state='quarantined',
           claim_generation = claim_generation + 1,   -- fence the stale claimant (F4)
           reconcile_after = coalesce(claimed_at, now()) + p_window,
           updated_at = now()
     where id = p_id
       and state='committing' and updated_at < now() - p_lease
    returning * into v;
    return v;   -- null ⇒ the row is fresh-committing (live owner) or not committing
  end; $$;

-- ── Reconciler select helper (sweep + retry): the rows a given caller may need to reconcile for an
-- org. NOTE (F11): the state predicate is parenthesized as a whole so `org_id = p_org_id` constrains
-- EVERY branch — without the parens, AND/OR precedence would leak other orgs' stuck rows into a caller's
-- reconcile set. A stale 'committing' row is a candidate so the sweep can QUARANTINE it (F1); a
-- 'quarantined' row past its window is a candidate so the sweep can resolve it (probe → adopt-or-reissue).
create or replace function public.outbox_reconcile_candidates(p_org_id uuid)
  returns setof public.external_command_outbox
  language sql security definer set search_path = public as $$
  select * from public.external_command_outbox
   where org_id = p_org_id
     and ( state in ('pending','failed','committed')
           or (state='committing' and updated_at < now() - interval '60 seconds')
           or (state='quarantined' and reconcile_after is not null and reconcile_after < now()) );
  $$;

-- ── record_outbox_ref + confirm_outbox (H-1 DIRECTOR RULING — DB-side FENCED finalization). The audit
-- found a finalization TOCTOU: the old verify-then-write sequenced `verifyClaimGeneration()` →
-- `writeReadModel` → `recordExternalRef` → `markOutboxConfirmed` as SEPARATE steps, so a reclaimer could
-- supersede the claim AFTER the verify and BEFORE the external_refs/confirm writes — stamping a STALE
-- mapping over the reclaimer's correct one. Both the external_refs write AND the confirm are now FENCED
-- RPCs (row lock + `claim_generation` + `state='committed'` guard) so a superseded claimant writes
-- NOTHING (each returns 0). The finalization ORDER is: `record_outbox_ref` (fenced ref upsert, state
-- stays `committed`) → the caller writes the per-domain read-model MIRROR (issued ONLY when the ref RPC
-- returned 1 → the mirror is generation-conditional too, per the ruling) → `confirm_outbox` (fenced
-- committed→confirmed). Keeping the confirm LAST means a crash between the ERP commit and the mirror
-- leaves the row `committed` (NOT confirmed), so the retry re-runs the mirror (finalize-only, AC-ENA-010)
-- — a confirm-first design would strand the row confirmed-but-unmirrored. `confirm_outbox` is the ONLY
-- committed→confirmed path (markOutboxConfirmed is retired). SECURITY DEFINER over the policy-less outbox
-- (+ external_refs). Each returns 1 when THIS caller owned+applied, else 0.
create or replace function public.record_outbox_ref(
  p_id uuid, p_generation int,
  p_domain text, p_pmo_record_id text, p_external_tier text, p_external_record_id text
) returns int
  language plpgsql security definer set search_path = public as $$
  declare v public.external_command_outbox;
  begin
    select * into v from public.external_command_outbox where id = p_id for update;
    -- Fence: only the CURRENT generation on a still-`committed` row may write the ref (0 = superseded →
    -- nothing written; the caller then skips the mirror too, so the ENTIRE finalization is a no-op).
    if v.id is null or v.claim_generation is distinct from p_generation or v.state <> 'committed' then
      return 0;
    end if;
    -- external_refs upsert (moved in from refs.ts's recordExternalRef so it is FENCED — a stale claimant
    -- can no longer overwrite the mapping). State stays `committed`; confirm is a separate fenced RPC so
    -- the mirror write sits BETWEEN them (crash-before-mirror leaves `committed` → retry re-mirrors).
    insert into public.external_refs (org_id, domain, pmo_record_id, external_tier, external_record_id)
      values (v.org_id, p_domain, p_pmo_record_id, p_external_tier, p_external_record_id)
      on conflict (org_id, domain, pmo_record_id)
        do update set external_record_id = excluded.external_record_id, external_tier = excluded.external_tier;
    return 1;
  end; $$;

create or replace function public.confirm_outbox(
  p_id uuid, p_generation int
) returns int
  language plpgsql security definer set search_path = public as $$
  declare v_n int;
  begin
    update public.external_command_outbox
       set state = 'confirmed', updated_at = now()
     where id = p_id and claim_generation = p_generation and state = 'committed'
    returning 1 into v_n;
    return coalesce(v_n, 0);
  end; $$;

-- ── mark_outbox_held (C-1 DIRECTOR RULING): the fenced committed-recovery-inconclusive → 'held'
-- transition for a MUTABLE-anchor money doc (Payment Entry). Guarded on claim_generation (F4) so only
-- the current claimant may hold it; records the reason in last_error for ops visibility. Never
-- auto-resolved (not a reconcile candidate) — an operator clears it. Returns 1 when held, else 0.
create or replace function public.mark_outbox_held(
  p_id uuid, p_generation int, p_reason text
) returns int
  language plpgsql security definer set search_path = public as $$
  declare v_n int;
  begin
    update public.external_command_outbox
       set state = 'held', last_error = p_reason, updated_at = now()
     where id = p_id and claim_generation = p_generation and state = 'committing'
    returning 1 into v_n;
    return coalesce(v_n, 0);
  end; $$;

-- ── ACL discipline (mirrors 0005/0006/ADR-0009): revoke all from public, grant execute only to the
-- intended machine caller (service_role — the dispatch edge fn + the sweep, task 8.6). These RPCs are
-- SECURITY DEFINER over a policy-less table; they must NOT be callable by an ordinary authenticated
-- user (who could otherwise claim/mutate another org's outbox row — the function body does not itself
-- check org membership beyond p_org_id/p_id being passed in). ─────────────────────────────────────────
revoke all on function public.claim_outbox_for_commit(uuid, interval) from public;
grant execute on function public.claim_outbox_for_commit(uuid, interval) to service_role;
revoke all on function public.quarantine_committing(uuid, interval, interval) from public;
grant execute on function public.quarantine_committing(uuid, interval, interval) to service_role;
revoke all on function public.outbox_reconcile_candidates(uuid) from public;
grant execute on function public.outbox_reconcile_candidates(uuid) to service_role;
revoke all on function public.record_outbox_ref(uuid, int, text, text, text, text) from public;
grant execute on function public.record_outbox_ref(uuid, int, text, text, text, text) to service_role;
revoke all on function public.confirm_outbox(uuid, int) from public;
grant execute on function public.confirm_outbox(uuid, int) to service_role;
revoke all on function public.mark_outbox_held(uuid, int, text) from public;
grant execute on function public.mark_outbox_held(uuid, int, text) to service_role;
