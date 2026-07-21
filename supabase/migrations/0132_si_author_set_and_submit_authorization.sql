-- 0132_si_author_set_and_submit_authorization.sql — two separation-of-duties defects on the Sales
-- Invoice money path. Both let ONE human set the money AND approve it: the exact thing the two-person
-- rule exists to prevent.
--
-- ── DEFECT 1 (cross-family audit, finding 5): authorship was LAST-WRITER-WINS.
-- `readModelWriters.ts` re-stamps `sales_invoices.author_user_id` to the caller on EVERY body-building
-- write, and 0127 §B's `submit_sales_invoice` compared only that single current value. So:
--     A creates a 1,000,000 invoice                     → author = A
--     A asks B (the designated approver) to fix a field → B's update rebuilds the body → author = B
--     B is now SoD-blocked, so **A submits it**          → author B ≠ submitter A → PASS
-- A both set the money and approved it. The invariant must be "NOBODY WHO EVER WROTE THE BODY MAY
-- APPROVE", not "not the last writer".
-- Fix (§A/§B): an APPEND-ONLY `sales_invoice_authors` set, written by the mirror writer on every
-- body-building write, and the RPC refusing any submitter present in that set.
--
-- ── DEFECT 2 (sequence audit): the SoD was TOCTOU-raceable.
-- `index.ts` authorized the submit BEFORE the ERP body was constructed, and the author re-stamp
-- happened LATER, in the (post-ERP) writer. An approver could issue an `update` rewriting the amount
-- and, concurrently, a `submit`: the submit's check read the authorship as it stood before the
-- rewrite, passed, and the rewrite then landed the approver's own numbers — the approver's amount
-- carrying the approver's own approval.
-- Fix (§C/§D): put BOTH halves behind the SAME invoice row lock IN THE DB — the serialization point
-- and the enforcement authority (a stateless edge function holds no transaction across the ERP HTTP
-- call, so edge-function ordering can never be atomic).
--     submit_sales_invoice(si)       : `select … for update` → check the author SET → RECORD the
--                                      authorization (§C ledger)
--     claim_sales_invoice_author(si) : `select … for update` → REFUSE (55006) while an authorization
--                                      is outstanding → else APPEND the caller to the author set
-- and `adapter-dispatch/index.ts` calls the claim BEFORE the ERP body write. The two possible
-- serialization orders are both safe:
--   claim wins  → the rewriter is in the author set → the submit is refused as self-approval;
--   submit wins → the claim blocks on the lock, then sees the authorization → the rewrite is refused
--                 with 55006 and NEVER reaches ERP.
--
-- ⚑ `author_user_id` is KEPT (0125's mirror guard and other code reference it) and is still honoured
--   as a member of the author set, so pre-0132 rows carrying only the scalar stay covered — but it is
--   no longer the SoD oracle.
-- ⚑ 0127 §B's NULL-author fail-closed rule survives as "an EMPTY author set refuses submit".
-- ⚑ 0130's `is_active_member()` conjunct and 0124's org/role guard are preserved VERBATIM.
--
-- Reversibility (ADR-0006, pre-production): `supabase db reset`. Manual reverse:
--   drop function if exists public.claim_sales_invoice_author(uuid);
--   -- re-create 0130 §B's submit_sales_invoice body (the author_user_id-scalar variant);
--   drop table if exists public.sales_invoice_submit_authorizations;
--   drop table if exists public.sales_invoice_authors;

-- ============================================================================
-- §A — sales_invoice_authors: the APPEND-ONLY authorship set (DEFECT 1).
--
-- One row per (invoice, body-writer). Written by the service-role read-model writer
-- (adapter-dispatch/readModelWriters.ts, `insert … on conflict do nothing`) and by
-- claim_sales_invoice_author (§D). Users may READ their org's rows and nothing else: with no
-- INSERT/UPDATE/DELETE policy and no write grant, an author cannot erase their own authorship to
-- re-enable self-approval.
-- ============================================================================

create table if not exists public.sales_invoice_authors (
  org_id           uuid not null references public.organizations(id) on delete cascade,
  sales_invoice_id uuid not null references public.sales_invoices(id) on delete cascade,
  user_id          uuid not null references auth.users(id),
  at               timestamptz not null default now(),
  primary key (sales_invoice_id, user_id)
);
create index if not exists sales_invoice_authors_org_idx on public.sales_invoice_authors (org_id, sales_invoice_id);

comment on table public.sales_invoice_authors is
  'Append-only set of every user who has BUILT a sales invoice''s ERP body (create / update / amend). '
  'The submit SoD oracle: nobody in this set may approve the invoice. Supersedes the last-writer-wins '
  'sales_invoices.author_user_id scalar, which a co-worker edit could hand back to the real author.';

alter table public.sales_invoice_authors enable row level security;
-- FORCE (AC-LOW-1, 0005_force_rls): the policy binds the table OWNER too. The service-role writer is
-- unaffected (BYPASSRLS), and the SECURITY DEFINER RPCs below run as the bypassing owner role.
alter table public.sales_invoice_authors force row level security;

-- Org-scoped read for ACTIVE members only (the 0128/0130 idiom — a disabled user with a live JWT is
-- no longer a member). No write policy: every write is service-role / SECURITY DEFINER.
create policy sales_invoice_authors_select on public.sales_invoice_authors for select
  using (org_id = auth_org_id() and is_active_member());

revoke all on public.sales_invoice_authors from anon, authenticated;
grant select on public.sales_invoice_authors to authenticated;

-- Backfill the scalar authors already recorded, so existing invoices are covered by the set oracle
-- from the moment this migration lands (not only from their next body write).
insert into public.sales_invoice_authors (org_id, sales_invoice_id, user_id)
select org_id, id, author_user_id from public.sales_invoices where author_user_id is not null
on conflict do nothing;

-- ============================================================================
-- §C — sales_invoice_submit_authorizations: the submit-clearance ledger (DEFECT 2).
--
-- At most one outstanding authorization per invoice. Recorded by submit_sales_invoice UNDER the
-- invoice row lock, and read by claim_sales_invoice_author under the same lock — that pairing is what
-- makes the check-then-write atomic with respect to a concurrent body rewrite.
--
-- Deliberately a SEPARATE machine-only table rather than columns on sales_invoices: the
-- sales_invoices UPDATE policy (0128) lets any approver-role member write that table, and 0125's
-- native mirror guard pins only its enumerated columns — so a clearance column there could simply be
-- nulled by the very approver it constrains.
-- ============================================================================

create table if not exists public.sales_invoice_submit_authorizations (
  sales_invoice_id uuid primary key references public.sales_invoices(id) on delete cascade,
  org_id           uuid not null references public.organizations(id) on delete cascade,
  user_id          uuid not null references auth.users(id),
  authorized_at    timestamptz not null default now()
);

comment on table public.sales_invoice_submit_authorizations is
  'The most recent submit clearance granted by submit_sales_invoice, recorded under the invoice row '
  'lock. While it is outstanding (within the TTL and the invoice still unsubmitted) a body rewrite is '
  'refused 55006 — closing the check-then-act race between an in-flight submit and a concurrent edit.';

alter table public.sales_invoice_submit_authorizations enable row level security;
alter table public.sales_invoice_submit_authorizations force row level security;

create policy sales_invoice_submit_authorizations_select on public.sales_invoice_submit_authorizations for select
  using (org_id = auth_org_id() and is_active_member());

revoke all on public.sales_invoice_submit_authorizations from anon, authenticated;
grant select on public.sales_invoice_submit_authorizations to authenticated;

-- ============================================================================
-- §B — submit_sales_invoice: the author SET is the oracle, under a row lock.
--
-- Byte-identical to 0130 §B except: (1) `for update` on the invoice select, (2) the authorship check
-- reads the SET (union the legacy scalar) instead of the scalar alone, (3) the clearance is recorded.
-- ============================================================================

create or replace function public.submit_sales_invoice(p_si_id uuid)
returns public.sales_invoices language plpgsql security definer set search_path = public as $$
declare
  v_row      public.sales_invoices;
  v_org      uuid;
  v_uid      uuid := auth.uid();
  v_authors  int;
begin
  -- DEFECT 2: `for update` makes the authorship check and the clearance record ATOMIC with respect to
  -- a concurrent body write — claim_sales_invoice_author (§D) takes the SAME lock, so a rewrite can
  -- never interleave between this check and its consequence. The DB is the serialization point; the
  -- edge function cannot be (it holds no transaction across the ERP HTTP call).
  select * into v_row from public.sales_invoices where id = p_si_id for update;
  if not found then
    raise exception 'sales invoice not found' using errcode = 'P0002';
  end if;

  v_org := v_row.org_id;
  -- (0124/0130, predicates unchanged) org + approver-role + still-an-active-member.
  if v_org is distinct from auth_org_id()
     or auth_role() not in ('Admin','Executive','Project Manager','Finance')
     or not is_active_member()
  then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  -- The authorship SET = every recorded body-writer, UNION the legacy `author_user_id` scalar (rows
  -- written before 0132, and the scalar the mirror writer still stamps).
  select count(*) into v_authors
    from public.sales_invoice_authors a
   where a.sales_invoice_id = p_si_id;

  -- (0127 §B, preserved) FAIL CLOSED on an unknown author: an invoice we cannot attribute is exactly
  -- an invoice with no two-person control. An empty set AND a null scalar ⇒ refuse.
  if v_authors = 0 and v_row.author_user_id is null then
    raise exception 'sales invoice has no recorded author — SoD cannot be verified'
      using errcode = '42501',
            detail = 'sod-author-missing';
  end if;

  -- DEFECT 1 (FR-SAR-195): NOBODY WHO EVER WROTE THE BODY MAY APPROVE. Comparing against the single
  -- current `author_user_id` was last-writer-wins: a co-worker's edit moved the scalar off the real
  -- author and handed the approval right back to the person who chose the number.
  if v_row.author_user_id = v_uid
     or exists (select 1 from public.sales_invoice_authors a
                 where a.sales_invoice_id = p_si_id and a.user_id = v_uid)
  then
    raise exception 'approver must differ from author (SoD)'
      using errcode = '42501',
            detail = 'sod-self-approval';
  end if;

  -- DEFECT 2: record the clearance while the row is still locked. A body rewrite that arrives after
  -- this commit is refused by §D; one that arrived before it is already in the author set above.
  insert into public.sales_invoice_submit_authorizations (sales_invoice_id, org_id, user_id, authorized_at)
  values (p_si_id, v_org, v_uid, now())
  on conflict (sales_invoice_id) do update
    set user_id = excluded.user_id, authorized_at = excluded.authorized_at;

  return v_row;
end; $$;

revoke all on function public.submit_sales_invoice(uuid) from public;
grant execute on function public.submit_sales_invoice(uuid) to authenticated;

-- ============================================================================
-- §D — claim_sales_invoice_author: the PRE-ERP authorship claim (DEFECT 2).
--
-- `adapter-dispatch/index.ts` calls this under the CALLER's JWT before dispatching any command that
-- REBUILDS a sales invoice's ERP body (`update`, `transition{verb:'amend'}` — sodGuard's
-- `requiresSiAuthorClaim`). It both records authorship BEFORE the money is set (rather than after,
-- where the submit could no longer see it) and refuses to proceed while a submit clearance is
-- outstanding.
-- ============================================================================

create or replace function public.claim_sales_invoice_author(p_si_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  -- How long a granted clearance blocks body rewrites. Long enough to cover the ERP submit round trip
  -- the dispatch performs immediately after the RPC returns; short enough that a submit which never
  -- completed does not freeze the invoice (a lapsed clearance stops blocking).
  c_clearance_ttl constant interval := interval '5 minutes';
  v_row  public.sales_invoices;
  v_uid  uuid := auth.uid();
begin
  -- SAME lock as §B — this is the whole mechanism.
  select * into v_row from public.sales_invoices where id = p_si_id for update;
  -- No PMO row yet (a create's mirror has not landed, or the invoice was never mirrored): there is
  -- nothing to protect and no submit can race an invoice that does not exist. The mirror writer
  -- records the creator's authorship on the insert instead.
  if not found then
    return;
  end if;

  if v_row.org_id is distinct from auth_org_id()
     or auth_role() not in ('Admin','Executive','Project Manager','Finance')
     or not is_active_member()
  then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  -- Refuse while a submit clearance is OUTSTANDING: granted within the TTL, on an invoice that has
  -- not yet reached the ERP (docstatus 1 = submitted, 2 = cancelled — both mean the clearance was
  -- consumed or is moot, and the amend path must stay open).
  if exists (
    select 1 from public.sales_invoice_submit_authorizations s
     where s.sales_invoice_id = p_si_id
       and s.authorized_at > now() - c_clearance_ttl
       and coalesce(v_row.erp_docstatus, 0) < 1
  ) then
    raise exception 'a submit authorization is outstanding for this sales invoice — its body cannot be rewritten'
      using errcode = '55006',  -- object_in_use
            detail = 'si-submit-in-progress';
  end if;

  insert into public.sales_invoice_authors (org_id, sales_invoice_id, user_id)
  values (v_row.org_id, p_si_id, v_uid)
  on conflict do nothing;
end; $$;

revoke all on function public.claim_sales_invoice_author(uuid) from public;
grant execute on function public.claim_sales_invoice_author(uuid) to authenticated;
