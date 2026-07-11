-- 0095_erpnext_seam_tables.sql — ERPNext P2 seam generalization (slice 1, ADR-0055/ADR-0057).
-- Three machine-written tables (org_id seam, stamp_org_id() trigger, RLS) + two SECURITY DEFINER RPCs
-- that are the ONLY non-service-role path to the outbox:
--   external_org_bindings     — per-org ERPNext binding (site URL + resolved Company defaults; secret_ref
--                                only, NO secret value ever stored — NFR-ENA-SEC-002, OQ-6).
--   external_command_outbox   — the durable money-idempotency provisional-ref (ADR-0057 R1/R3). The
--                                unique 4-tuple closes the INSERT race; claim_outbox_for_commit() closes
--                                the REISSUE race (at-most-once claim); claim_generation is the fencing
--                                token that closes the lease-expiry overlap (F4).
--   external_ref_lineage      — cancel/amend history (R2): repoint + supersede tracking.
--
-- Reversibility (ADR-0006): supabase db reset. Manual rollback (functions before tables, reverse order):
--   drop function if exists public.outbox_reconcile_candidates(uuid);
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
  state               text not null check (state in ('pending','committing','committed','confirmed','failed')),
  external_record_id  text,
  payload_digest      text,
  attempt_count       int not null default 0,
  claim_generation    int not null default 0,   -- fencing token: bumped on every claim; write-backs guard on it
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

-- ── The atomic commit claim (ADR-0057 §2): the ONLY gate from (pending|failed|stale-committing) →
-- committing. A conditional UPDATE under Postgres' row lock: two concurrent claims serialize, only the
-- winner transitions and RETURNs the row; the loser's UPDATE matches 0 rows (state 'committing',
-- updated_at fresh) → NULL. A 'committing' row past p_lease is re-claimable (recovers a process that
-- died holding the claim). Each win BUMPS claim_generation — the returned value is the caller's FENCING
-- TOKEN: every post-claim write-back (mark committed/confirmed/failed, external_record_id record) is
-- guarded `WHERE claim_generation = <token>`, so a lease-expired-but-still-running claimant that a
-- reclaimer already superseded matches 0 rows on its late write-back and its result is discarded (F4 —
-- closes the lease-expiry double-write). Its ERP POST may still have fired; that orphan is exactly what
-- the remarks-idempotency-key recovery reconciles (§4).
-- SECURITY DEFINER so the policy-less outbox is touched only here + by service_role.
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
           updated_at = now()
     where id = p_id
       and ( state in ('pending','failed')
             or (state='committing' and updated_at < now() - p_lease) )
    returning * into v;
    return v;   -- v.claim_generation is the caller's fencing token; null ⇒ another caller owns it
  end; $$;

-- ── Reconciler select helper (sweep + retry): the rows a given caller may need to reconcile for an
-- org. NOTE (F11): the state predicate is parenthesized as a whole so `org_id = p_org_id` constrains
-- EVERY branch (incl. the stale-'committing' branch) — without the parens, AND/OR precedence would leak
-- other orgs' stuck 'committing' rows into a caller's reconcile set. ───────────────────────────────────
create or replace function public.outbox_reconcile_candidates(p_org_id uuid)
  returns setof public.external_command_outbox
  language sql security definer set search_path = public as $$
  select * from public.external_command_outbox
   where org_id = p_org_id
     and ( state in ('pending','failed','committed')
           or (state='committing' and updated_at < now() - interval '60 seconds') );
  $$;

-- ── ACL discipline (mirrors 0005/0006/ADR-0009): revoke all from public, grant execute only to the
-- intended machine caller (service_role — the dispatch edge fn + the sweep, task 8.6). These RPCs are
-- SECURITY DEFINER over a policy-less table; they must NOT be callable by an ordinary authenticated
-- user (who could otherwise claim/mutate another org's outbox row — the function body does not itself
-- check org membership beyond p_org_id/p_id being passed in). ─────────────────────────────────────────
revoke all on function public.claim_outbox_for_commit(uuid, interval) from public;
grant execute on function public.claim_outbox_for_commit(uuid, interval) to service_role;
revoke all on function public.outbox_reconcile_candidates(uuid) from public;
grant execute on function public.outbox_reconcile_candidates(uuid) to service_role;
