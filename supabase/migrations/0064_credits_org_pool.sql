-- 0064_credits_org_pool.sql — credits org-pool refactor (FR-CRE-001/003, AC-CRE-002). NON-DESTRUCTIVE.
--   owner_id → nullable (legacy non-null grants STILL COUNT toward the org pool, FR-CRE-001; no
--   backfill UPDATE — attribution history is intact, and a non-null owner_id is now BOTH historical
--   attribution AND a live pool contribution).
--   credits_insert: auth_role()='Admin' → is_operator() ONLY (revenue-hole fix, cited against 0047).
--   credits_select: owner_id=auth.uid() → own-org Admin+Executive (grants VIEW only). An Operator
--     gets NO broadened credits SELECT — cross-org grant reads go ONLY through operator_grant_credits
--     (0065) / operator_usage_summary (FR-OPR-004).
--   + credits(org_id) index (NFR-PERF-001); credits(owner_id) from 0047 RETAINED for attribution.
-- Reversibility (ADR-0006): supabase db reset. Manual reverse:
--   drop index if exists public.credits_org_idx;
--   drop policy if exists credits_insert on public.credits; drop policy if exists credits_select on public.credits;
--   alter table public.credits alter column owner_id set not null;
--   (then re-create the 0047 policies verbatim to fully restore.)

alter table public.credits alter column owner_id drop not null;

create index if not exists credits_org_idx on public.credits (org_id);

-- own-org read for Admin+Executive (the grants view). Operator cross-org reads go via RPC only.
drop policy if exists credits_select on public.credits;
create policy credits_select on public.credits for select
  using (org_id = public.auth_org_id()
         and public.auth_role() in ('Admin','Executive')
         and public.is_active_member());

-- Operator-ONLY INSERT (revenue-hole fix). The append-only-by-omission contract (no UPDATE/DELETE
-- for anyone, FR-AUC-007) is unchanged. granted_by is server-stamped (default auth.uid() from 0047).
-- Owner-pinning is dropped: new grants write owner_id IS NULL (FR-CRE-001). is_active_member() is
-- retained as defense-in-depth (0061's conjunction is superseded here by an explicit restatement).
drop policy if exists credits_insert on public.credits;
create policy credits_insert on public.credits for insert
  with check (
    public.is_operator()
    and org_id = public.auth_org_id()       -- caller-org-pinned (Operator's home org; cross-org via RPC)
    and public.is_active_member()           -- defense-in-depth (FR-INV-003)
  );
