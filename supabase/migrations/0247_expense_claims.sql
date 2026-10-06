-- 0247_expense_claims.sql — #775 expense claims and cash advances (phase A: the PMO process).
-- Spec: docs/specs/expense-claims.spec.md · ADR-0078 · Plan: docs/plans/2026-10-06-expense-claims.md (+ part2..6)
-- Depends on 0243 (#803: spend_approval_route, holds_spend_approval_authority, spend_approvers) and 0237 (#788).
-- Proven by supabase/tests/expense_claims_schema_rls.test.sql, expense_claims_transition.test.sql,
--   expense_claims_routing.test.sql, expense_claims_line_lock.test.sql, expense_advances.test.sql,
--   expense_claims_notify.test.sql, and the 0178 allow-list.
--
-- §1 types + tables · §2 stamps and guards · §3 claim amount = Σ lines · §4 RLS + grants
-- §5 receipts bucket + storage policies · §6 expense_advance_outstanding · §7 transition_expense_claim
-- §8 spend_approval_route (+claims) and get_expense_claim_approval_routes · §9 advance return + aging
-- §10 notifications
--
-- ── REVERSE (manual, in this order — not `db reset`; prod data may exist) ───────────────────────────
--   drop trigger if exists expense_claims_notify_transition_trg on public.expense_claims;
--   drop function if exists public.notify_expense_claim_transition();
--   drop function if exists public.get_expense_advance_aging();
--   drop function if exists public.record_expense_advance_return(uuid, numeric, text);
--   drop function if exists public.get_expense_claim_approval_routes(uuid[]);
--   -- §8: re-create spend_approval_route from THIS file's §8 text minus every line marked `-- 0247`
--   --     (that text is 0243 §5 verbatim). Reverse by editing this text, never by re-applying a migration.
--   drop function if exists public.transition_expense_claim(uuid, public.expense_claim_status, text, text);
--   drop function if exists public.expense_advance_outstanding(uuid);
--   drop policy if exists storage_objects_expense_receipt_write on storage.objects;
--   drop policy if exists storage_objects_expense_receipt_read  on storage.objects;
--   -- bucket: only once it holds no objects (remove them through the Storage API first):
--   delete from storage.buckets where id = 'expense-receipts';
--   drop table if exists public.expense_claim_files;   -- drops its policies and triggers
--   drop table if exists public.expense_claim_lines;
--   drop table if exists public.expense_claims;
--   drop function if exists public.sync_expense_claim_amount();
--   drop function if exists public.stamp_expense_claim_child_org();
--   drop function if exists public.check_expense_claim_advance_link();
--   drop function if exists public.assert_expense_claim_update();
--   drop function if exists public.assert_expense_claim_origination();
--   drop type if exists public.expense_type;
--   drop type if exists public.expense_kind;
--   drop type if exists public.expense_claim_status;
--   (procurement_doc_counters rows with prefix EXP/ADV are harmless; leave them.)

-- ════════════════════════════════════════════════════════════════════════════════════════════════════
-- §1 — types and tables. One record, two kinds (DD-EXP-1). Money is numeric(14,2) with a range CHECK whose
-- upper bound rejects NaN ('NaN' sorts above every number, so `>= 0` alone admits it — 0193's lesson).
-- ════════════════════════════════════════════════════════════════════════════════════════════════════
create type public.expense_claim_status as enum ('Draft','Submitted','Approved','Rejected','Paid','Cancelled');
create type public.expense_kind as enum ('claim','advance');
create type public.expense_type as enum ('Travel','Accommodation','Meals','Local transport','Other');

create table public.expense_claims (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organizations(id)
                      default '00000000-0000-0000-0000-000000000001',
  kind              public.expense_kind not null default 'claim',
  claim_number      text,
  claimant_id       uuid not null references public.profiles(id) default auth.uid(),
  project_id        uuid references public.projects(id),
  budget_category   public.budget_category,
  title             text not null,
  purpose           text,
  currency          text not null default 'XXX',
  amount            numeric(14,2) not null default 0,
  advance_id        uuid references public.expense_claims(id),
  advance_applied   numeric(14,2) not null default 0,
  returned_amount   numeric(14,2) not null default 0,
  status            public.expense_claim_status not null default 'Draft',
  submitted_at      timestamptz,
  approved_by_id    uuid references public.profiles(id),
  approved_at       timestamptz,
  approval_notes    text,
  rejection_notes   text,
  paid_by_id        uuid references public.profiles(id),
  paid_at           timestamptz,
  paid_on           date,
  payment_reference text,
  cancelled_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint expense_claims_number_unique          unique (org_id, claim_number),
  constraint expense_claims_title_present          check (btrim(title) <> ''),
  constraint expense_claims_amount_range           check (amount >= 0 and amount < 'Infinity'::numeric),
  constraint expense_claims_applied_range          check (advance_applied >= 0 and advance_applied <= amount),
  constraint expense_claims_returned_range         check (returned_amount >= 0 and returned_amount <= amount),
  constraint expense_claims_advance_link_on_claims check (advance_id is null or kind = 'claim'),
  constraint expense_claims_returns_on_advances    check (returned_amount = 0 or kind = 'advance'),
  constraint expense_claims_currency_iso4217       check (currency ~ '^[A-Z]{3}$' and currency <> 'XXX')
);
create index expense_claims_org_status_idx  on public.expense_claims (org_id, status, created_at desc);
create index expense_claims_claimant_idx    on public.expense_claims (claimant_id);
create index expense_claims_line_idx        on public.expense_claims (project_id, budget_category);
create index expense_claims_advance_idx     on public.expense_claims (advance_id) where advance_id is not null;
create index expense_claims_approved_by_idx on public.expense_claims (approved_by_id);
create index expense_claims_paid_by_idx     on public.expense_claims (paid_by_id);
comment on table public.expense_claims is
  '#775 — staff expense claims (kind=claim, amount = Σ lines) and cash advances (kind=advance, entered amount). '
  'Not procurement (OD-PROC-5). Status moves only through transition_expense_claim.';
comment on column public.expense_claims.advance_applied is
  'DD-EXP-6 — how much of the linked advance settled this claim; stamped once at →Paid under a lock on the advance.';

create table public.expense_claim_lines (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) default '00000000-0000-0000-0000-000000000001',
  claim_id      uuid not null references public.expense_claims(id) on delete cascade,
  expense_date  date not null,
  expense_type  public.expense_type not null,
  description   text not null,
  amount        numeric(14,2) not null,
  created_at    timestamptz not null default now(),
  constraint expense_claim_lines_description_present check (btrim(description) <> ''),
  constraint expense_claim_lines_amount_range check (amount > 0 and amount < 'Infinity'::numeric)
);
create index expense_claim_lines_claim_idx on public.expense_claim_lines (claim_id, expense_date);

create table public.expense_claim_files (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations(id) default '00000000-0000-0000-0000-000000000001',
  claim_id       uuid not null references public.expense_claims(id) on delete cascade,
  title          text,
  file_path      text not null,
  uploaded_by_id uuid references public.profiles(id) default auth.uid(),
  created_at     timestamptz not null default now(),
  archived_at    timestamptz
);
create index expense_claim_files_claim_idx       on public.expense_claim_files (claim_id, created_at desc);
create index expense_claim_files_uploaded_by_idx on public.expense_claim_files (uploaded_by_id);

-- ════════════════════════════════════════════════════════════════════════════════════════════════════
-- §2 — stamps and guards. BEFORE-row triggers fire in NAME order, so the names are load-bearing:
--   expense_claims_origination_guard (o) → expense_claims_stamp_org_id (s) → expense_claims_zz_stamp_currency
--   (needs org) → expense_claims_zz_zcheck_advance_link (needs org). Do not rename them "tidier".
-- Server writers (SECURITY DEFINER owned by a BYPASSRLS role: the transition RPC, the line-sum trigger, an
-- importer) are exempt from the client-only rules via actor_bypasses_rls() (0174).
-- ════════════════════════════════════════════════════════════════════════════════════════════════════
create or replace function public.assert_expense_claim_origination() returns trigger
  language plpgsql set search_path = public as $$
begin
  if public.actor_bypasses_rls() then
    return new;
  end if;
  if new.status is distinct from 'Draft' then
    raise exception 'expense_claims.status "%" is not the origination status: a claim or advance is created as a Draft and moves only through transition_expense_claim',
      coalesce(new.status::text, '<NULL>') using errcode = 'P0001';
  end if;
  if new.claim_number is not null or new.submitted_at is not null or new.approved_by_id is not null
     or new.approved_at is not null or new.paid_by_id is not null or new.paid_at is not null
     or new.paid_on is not null or new.payment_reference is not null or new.cancelled_at is not null
     or new.advance_applied <> 0 or new.returned_amount <> 0 then
    raise exception 'expense_claims numbers and stamps cannot be set when a record is created: they are written only by transition_expense_claim and record_expense_advance_return'
      using errcode = 'P0001';
  end if;
  if new.kind = 'claim' and new.amount <> 0 then
    raise exception 'an expense claim''s amount is the sum of its lines: create the claim, then add lines'
      using errcode = 'P0001';
  end if;
  return new;
end; $$;
revoke all on function public.assert_expense_claim_origination() from public, anon, authenticated;
create trigger expense_claims_origination_guard before insert on public.expense_claims
  for each row execute function public.assert_expense_claim_origination();

create trigger expense_claims_stamp_org_id before insert on public.expense_claims
  for each row execute function public.stamp_org_id();
create trigger expense_claims_zz_stamp_currency before insert on public.expense_claims
  for each row execute function public.stamp_currency();

create or replace function public.check_expense_claim_advance_link() returns trigger
  language plpgsql set search_path = public as $$
declare v_adv record;
begin
  if new.advance_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.advance_id is not distinct from old.advance_id then
    return new;
  end if;
  if new.kind is distinct from 'claim' then
    raise exception 'only a claim can be settled against an advance' using errcode = '23514';
  end if;
  -- Runs as the writer: a claimant can see only their own advances, so another person's is "not found".
  select a.kind, a.org_id, a.claimant_id, a.status into v_adv
    from public.expense_claims a where a.id = new.advance_id;
  if not found or v_adv.kind is distinct from 'advance' or v_adv.org_id is distinct from new.org_id
     or v_adv.claimant_id is distinct from new.claimant_id or v_adv.status is distinct from 'Paid' then
    raise exception 'a claim can be settled only against one of the claimant''s own paid advances'
      using errcode = '23514';
  end if;
  return new;
end; $$;
revoke all on function public.check_expense_claim_advance_link() from public, anon, authenticated;
create trigger expense_claims_zz_zcheck_advance_link before insert or update of advance_id on public.expense_claims
  for each row execute function public.check_expense_claim_advance_link();

create or replace function public.assert_expense_claim_update() returns trigger
  language plpgsql set search_path = public as $$
begin
  if new.id is distinct from old.id or new.org_id is distinct from old.org_id or new.kind is distinct from old.kind
     or new.claimant_id is distinct from old.claimant_id or new.created_at is distinct from old.created_at
     or new.currency is distinct from old.currency then
    raise exception 'expense_claims identity columns (id, org_id, kind, claimant_id, created_at, currency) are immutable'
      using errcode = '42501';
  end if;
  if old.claim_number is not null and new.claim_number is distinct from old.claim_number then
    raise exception 'expense_claims.claim_number is minted once and never changes' using errcode = '42501';
  end if;
  new.updated_at := now();
  if public.actor_bypasses_rls() then
    return new;
  end if;
  if new.kind = 'claim' and new.amount is distinct from old.amount then
    raise exception 'an expense claim''s amount is the sum of its lines: add, change or remove a line instead'
      using errcode = '42501';
  end if;
  -- Defence in depth behind the RLS update policy (which already hides non-Draft rows): DD-EXP-10.
  if old.status not in ('Draft','Rejected') then
    raise exception 'this % is % and can no longer be changed: approval routing is decided on its content — reject it back to Draft or cancel it',
      old.kind, old.status using errcode = '42501';
  end if;
  return new;
end; $$;
revoke all on function public.assert_expense_claim_update() from public, anon, authenticated;
create trigger expense_claims_assert_update before update on public.expense_claims
  for each row execute function public.assert_expense_claim_update();

-- Children inherit org from the parent claim (the 0028 idiom). Runs as the writer, so a claim the writer
-- cannot see leaves the seed default — and the child's RLS WITH CHECK then refuses it.
create or replace function public.stamp_expense_claim_child_org() returns trigger
  language plpgsql set search_path = public as $$
begin
  if new.org_id is null or new.org_id = '00000000-0000-0000-0000-000000000001'::uuid then
    select c.org_id into new.org_id from public.expense_claims c where c.id = new.claim_id;
  end if;
  return new;
end; $$;
revoke all on function public.stamp_expense_claim_child_org() from public, anon, authenticated;
create trigger expense_claim_lines_stamp_org before insert on public.expense_claim_lines
  for each row execute function public.stamp_expense_claim_child_org();
create trigger expense_claim_files_stamp_org before insert on public.expense_claim_files
  for each row execute function public.stamp_expense_claim_child_org();

-- ════════════════════════════════════════════════════════════════════════════════════════════════════
-- §3 — a claim's amount is the sum of its lines (FR-EXP-004). DEFINER so the header write passes the
-- client-only refusal in §2; EXECUTE revoked so nothing calls it but the trigger.
-- ════════════════════════════════════════════════════════════════════════════════════════════════════
create or replace function public.sync_expense_claim_amount() returns trigger
  language plpgsql security definer set search_path = public as $$
declare v_claim uuid := coalesce(new.claim_id, old.claim_id);
begin
  update public.expense_claims c
     set amount = coalesce((select sum(l.amount) from public.expense_claim_lines l where l.claim_id = v_claim), 0)
   where c.id = v_claim and c.kind = 'claim';
  return null;
end; $$;
revoke all on function public.sync_expense_claim_amount() from public, anon, authenticated;
create trigger expense_claim_lines_sync_amount after insert or update or delete on public.expense_claim_lines
  for each row execute function public.sync_expense_claim_amount();

-- ════════════════════════════════════════════════════════════════════════════════════════════════════
-- §4 — RLS and grants. FORCE everywhere; is_active_member() conjoined in every policy (0203 rule).
-- Visibility (DD-EXP-4): the claimant, or anyone holding approval rank. Writes: the claimant, Draft/Rejected.
-- No DELETE on claims (Cancelled is the soft delete) or receipts (archived_at). Column grants are the first
-- layer; the triggers in §2 are the second.
-- ════════════════════════════════════════════════════════════════════════════════════════════════════
alter table public.expense_claims      enable row level security;
alter table public.expense_claims      force  row level security;
alter table public.expense_claim_lines enable row level security;
alter table public.expense_claim_lines force  row level security;
alter table public.expense_claim_files enable row level security;
alter table public.expense_claim_files force  row level security;

create policy expense_claims_select on public.expense_claims for select
  using (org_id = public.auth_org_id() and public.is_active_member()
         and (claimant_id = auth.uid() or public.holds_spend_approval_authority(public.auth_role())));
create policy expense_claims_insert on public.expense_claims for insert
  with check (org_id = public.auth_org_id() and public.is_active_member() and claimant_id = auth.uid()
              and (project_id is null or exists (select 1 from public.projects p
                                                  where p.id = expense_claims.project_id and p.org_id = public.auth_org_id())));
create policy expense_claims_update on public.expense_claims for update
  using (org_id = public.auth_org_id() and public.is_active_member() and claimant_id = auth.uid()
         and status in ('Draft','Rejected'))
  with check (org_id = public.auth_org_id() and public.is_active_member() and claimant_id = auth.uid()
              and status in ('Draft','Rejected')
              and (project_id is null or exists (select 1 from public.projects p
                                                  where p.id = expense_claims.project_id and p.org_id = public.auth_org_id())));
revoke all on public.expense_claims from anon, authenticated;
grant select on public.expense_claims to authenticated;
grant insert (id, kind, title, purpose, project_id, budget_category, amount, advance_id) on public.expense_claims to authenticated;
grant update (title, purpose, project_id, budget_category, amount, advance_id) on public.expense_claims to authenticated;

create policy expense_claim_lines_select on public.expense_claim_lines for select
  using (org_id = public.auth_org_id() and public.is_active_member()
         and exists (select 1 from public.expense_claims c where c.id = expense_claim_lines.claim_id));
create policy expense_claim_lines_write on public.expense_claim_lines for all
  using (org_id = public.auth_org_id() and public.is_active_member()
         and exists (select 1 from public.expense_claims c
                      where c.id = expense_claim_lines.claim_id and c.org_id = public.auth_org_id()
                        and c.claimant_id = auth.uid() and c.kind = 'claim' and c.status in ('Draft','Rejected')))
  with check (org_id = public.auth_org_id() and public.is_active_member()
         and exists (select 1 from public.expense_claims c
                      where c.id = expense_claim_lines.claim_id and c.org_id = public.auth_org_id()
                        and c.claimant_id = auth.uid() and c.kind = 'claim' and c.status in ('Draft','Rejected')));
revoke all on public.expense_claim_lines from anon, authenticated;
grant select, delete on public.expense_claim_lines to authenticated;
grant insert (id, claim_id, expense_date, expense_type, description, amount) on public.expense_claim_lines to authenticated;
grant update (expense_date, expense_type, description, amount) on public.expense_claim_lines to authenticated;

create policy expense_claim_files_select on public.expense_claim_files for select
  using (org_id = public.auth_org_id() and public.is_active_member()
         and exists (select 1 from public.expense_claims c where c.id = expense_claim_files.claim_id));
create policy expense_claim_files_write on public.expense_claim_files for all
  using (org_id = public.auth_org_id() and public.is_active_member()
         and exists (select 1 from public.expense_claims c
                      where c.id = expense_claim_files.claim_id and c.org_id = public.auth_org_id()
                        and c.claimant_id = auth.uid() and c.status in ('Draft','Rejected')))
  with check (org_id = public.auth_org_id() and public.is_active_member()
         and exists (select 1 from public.expense_claims c
                      where c.id = expense_claim_files.claim_id and c.org_id = public.auth_org_id()
                        and c.claimant_id = auth.uid() and c.status in ('Draft','Rejected')));
revoke all on public.expense_claim_files from anon, authenticated;
grant select on public.expense_claim_files to authenticated;
grant insert (id, claim_id, title, file_path) on public.expense_claim_files to authenticated;
grant update (title, archived_at) on public.expense_claim_files to authenticated;

-- ════════════════════════════════════════════════════════════════════════════════════════════════════
-- §5 — receipts bucket (private, 5 MB) at {org}/{claim}/{file}/{filename}. Read follows claim visibility (the
-- subquery runs under the caller's RLS); write = the claimant while Draft/Rejected (0028 pattern).
-- ════════════════════════════════════════════════════════════════════════════════════════════════════
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('expense-receipts', 'expense-receipts', false, 5242880,
          array['application/pdf', 'image/png', 'image/jpeg', 'image/webp'])
  on conflict (id) do nothing;

-- TO authenticated: anon holds no grant on expense_claims, and policies on storage.objects are evaluated
-- for EVERY bucket, so an anon read of any bucket would otherwise fail with 42501 on this subquery.
create policy storage_objects_expense_receipt_read on storage.objects for select to authenticated
  using (bucket_id = 'expense-receipts' and auth.uid() is not null
         and split_part(name, '/', 1) = public.auth_org_id()::text
         and array_length(string_to_array(name, '/'), 1) = 4
         and exists (select 1 from public.expense_claims c where c.id::text = split_part(name, '/', 2)));
create policy storage_objects_expense_receipt_write on storage.objects for all to authenticated
  using (bucket_id = 'expense-receipts' and auth.uid() is not null
         and split_part(name, '/', 1) = public.auth_org_id()::text
         and array_length(string_to_array(name, '/'), 1) = 4
         and exists (select 1 from public.expense_claims c
                      where c.id::text = split_part(name, '/', 2) and c.org_id = public.auth_org_id()
                        and c.claimant_id = auth.uid() and c.status in ('Draft','Rejected')))
  with check (bucket_id = 'expense-receipts' and auth.uid() is not null
         and split_part(name, '/', 1) = public.auth_org_id()::text
         and array_length(string_to_array(name, '/'), 1) = 4
         and exists (select 1 from public.expense_claims c
                      where c.id::text = split_part(name, '/', 2) and c.org_id = public.auth_org_id()
                        and c.claimant_id = auth.uid() and c.status in ('Draft','Rejected')));

-- ════════════════════════════════════════════════════════════════════════════════════════════════════
-- §6 — outstanding on an advance (DD-EXP-6): amount − returned − Σ applied by PAID claims. Derived, never
-- stored. SECURITY INVOKER: under the UI it sees what the caller sees (a claimant sees all claims on their own
-- advance; approval rank sees all); under §7/§9 (definers) it sees everything.
-- ════════════════════════════════════════════════════════════════════════════════════════════════════
create or replace function public.expense_advance_outstanding(p_id uuid) returns numeric
  language sql stable security invoker set search_path = public, pg_temp as $$
  select a.amount - a.returned_amount
         - coalesce((select sum(c.advance_applied) from public.expense_claims c
                      where c.advance_id = a.id and c.status = 'Paid'), 0)
    from public.expense_claims a
   where a.id = p_id and a.kind = 'advance'
$$;
revoke all on function public.expense_advance_outstanding(uuid) from public, anon;
grant execute on function public.expense_advance_outstanding(uuid) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════════════════════════════
-- §7 — transition_expense_claim: the single authority for every status move, the number mint, the SoD and
-- settlement. Order is load-bearing: active member → load (row lock) → org → legality → stray-reference
-- refusal → SoD (outside any Admin skip, DD-EXP-3) → per-move rules → one UPDATE → audit.
-- ════════════════════════════════════════════════════════════════════════════════════════════════════
create or replace function public.transition_expense_claim(
  p_id                uuid,
  p_to                public.expense_claim_status,
  p_notes             text default null,
  p_payment_reference text default null
) returns void
  language plpgsql security definer set search_path = public as $$
declare
  v_row      public.expense_claims%rowtype;
  v_uid      uuid      := auth.uid();
  v_role     user_role := auth_role();
  v_is_admin boolean;
  v_route    record;
  v_lines    int;
  v_adv      public.expense_claims%rowtype;
  v_applied  numeric   := 0;
  v_today    date;
  v_legal    jsonb := jsonb_build_object(
    'Draft',     jsonb_build_array('Submitted','Cancelled'),
    'Submitted', jsonb_build_array('Approved','Rejected','Cancelled'),
    'Approved',  jsonb_build_array('Paid','Cancelled'),
    'Rejected',  jsonb_build_array('Draft'),
    'Paid',      jsonb_build_array(),
    'Cancelled', jsonb_build_array()
  );
begin
  perform public.assert_is_active_member();
  v_is_admin := (v_role = 'Admin');

  select * into v_row from public.expense_claims where id = p_id for update;
  if not found then
    raise exception 'expense claim not found' using errcode = 'P0002';
  end if;
  if v_row.org_id is distinct from auth_org_id() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if not (v_legal -> v_row.status::text) ? p_to::text then
    raise exception 'illegal transition % -> %', v_row.status, p_to using errcode = 'P0001';
  end if;
  if p_payment_reference is not null and p_to is distinct from 'Paid' then
    raise exception 'a payment reference belongs only to the payment step' using errcode = 'P0001';
  end if;

  -- SoD (DD-EXP-3), for every actor including an Admin (the OD-PROC-8 shape).
  if v_row.status = 'Submitted' and p_to in ('Approved','Rejected') and v_uid = v_row.claimant_id then
    raise exception 'separation of duties: a claimant cannot approve or reject their own expense claim' using errcode = '42501';
  end if;
  if p_to = 'Paid' and v_uid = v_row.claimant_id then
    raise exception 'separation of duties: a claimant cannot pay their own expense claim' using errcode = '42501';
  end if;
  if p_to = 'Paid' and v_uid = v_row.approved_by_id then
    raise exception 'separation of duties: the approver cannot also pay this expense claim' using errcode = '42501';
  end if;

  if p_to = 'Submitted' then
    if v_uid is distinct from v_row.claimant_id then
      raise exception 'only the claimant can submit this expense claim' using errcode = '42501';
    end if;
    if v_row.kind = 'claim' then
      select count(*) into v_lines from public.expense_claim_lines l where l.claim_id = p_id;
      if v_lines = 0 then
        raise exception 'an expense claim needs at least one line before it can be submitted' using errcode = 'P0001';
      end if;
    end if;
    if not (v_row.amount > 0) then
      raise exception 'the amount must be greater than zero before submitting' using errcode = 'P0001';
    end if;
  elsif v_row.status = 'Rejected' and p_to = 'Draft' then
    if v_uid is distinct from v_row.claimant_id then
      raise exception 'only the claimant can send a rejected expense claim back to Draft' using errcode = '42501';
    end if;
  elsif p_to = 'Cancelled' then
    if not ((v_row.status in ('Draft','Submitted') and v_uid = v_row.claimant_id) or v_is_admin or v_role = 'Finance') then
      raise exception 'not authorized for transition % -> %', v_row.status, p_to using errcode = '42501';
    end if;
  elsif p_to in ('Approved','Rejected') then
    -- #803 routing, called — never copied (ADR-0075 §3). Same lock key as transition_procurement (0243 §7) so a
    -- claim and a purchase request on one line serialize (FR-EXP-022). Classification runs AFTER the lock is held.
    if v_row.project_id is not null and v_row.budget_category is not null then
      perform pg_advisory_xact_lock(
        hashtextextended('spend-line:' || v_row.project_id::text || ':' || v_row.budget_category::text, 0));
    end if;
    select * into v_route
      from public.spend_approval_route(v_row.org_id, v_row.project_id, v_row.budget_category, v_row.amount,
                                       v_row.currency, v_row.claimant_id, v_uid, v_row.submitted_at);
    -- coalesce: a NULL route must refuse, never pass (DD-APR-5).
    if coalesce(v_route.route, 'senior') <> 'flat' and not v_is_admin
       and not coalesce(v_uid = any (v_route.approver_ids), false) then
      if v_route.route = 'admin' then
        raise exception 'approval routing: % requires an Admin (no senior approver is eligible)', v_route.reason
          using errcode = '42501';
      end if;
      raise exception 'approval routing: % requires a named approver', coalesce(v_route.reason, 'unknown')
        using errcode = '42501';
    end if;
    -- The flat floor still applies to everyone but an Admin (named approvers hold this rank by construction).
    if not v_is_admin and not public.holds_spend_approval_authority(v_role) then
      raise exception 'not authorized for transition % -> %', v_row.status, p_to using errcode = '42501';
    end if;
    perform public.log_audit('expense_claim.approval_route', v_row.org_id, v_uid, p_id,
      jsonb_build_object('to', p_to::text, 'route', v_route.route, 'reason', v_route.reason,
        'request_amount', v_row.amount, 'line_budget', v_route.line_budget, 'line_used', v_route.line_used,
        'budget_category', v_row.budget_category::text,
        'break_glass', (coalesce(v_route.route, 'senior') <> 'flat' and v_is_admin
                        and not coalesce(v_uid = any (v_route.approver_ids), false))));
  elsif p_to = 'Paid' then
    if not (v_is_admin or v_role = 'Finance') then
      raise exception 'not authorized for transition % -> %', v_row.status, p_to using errcode = '42501';
    end if;
    v_today := (now() at time zone coalesce(
                 (select o.default_timezone from public.organizations o where o.id = v_row.org_id), 'UTC'))::date;
    if v_row.advance_id is not null then
      -- Lock order is always claim → advance; record_expense_advance_return locks only the advance.
      select * into v_adv from public.expense_claims where id = v_row.advance_id for update;
      if v_adv.status is distinct from 'Paid' or v_adv.claimant_id is distinct from v_row.claimant_id then
        raise exception 'the linked advance is not a paid advance of this claimant' using errcode = 'P0001';
      end if;
      v_applied := least(v_row.amount, greatest(public.expense_advance_outstanding(v_row.advance_id), 0));
    end if;
  end if;

  update public.expense_claims set
    status            = p_to,
    claim_number      = case when p_to = 'Submitted'
                             then coalesce(claim_number, public.next_procurement_doc_number(org_id,
                                    case kind when 'advance' then 'ADV' else 'EXP' end))
                             else claim_number end,
    submitted_at      = case when p_to = 'Submitted' then now() else submitted_at end,
    approved_by_id    = case when p_to = 'Approved' then v_uid when p_to = 'Draft' then null else approved_by_id end,
    approved_at       = case when p_to = 'Approved' then now() when p_to = 'Draft' then null else approved_at end,
    approval_notes    = case when p_to = 'Approved' then p_notes else approval_notes end,
    rejection_notes   = case when p_to = 'Rejected' then p_notes else rejection_notes end,
    paid_by_id        = case when p_to = 'Paid' then v_uid else paid_by_id end,
    paid_at           = case when p_to = 'Paid' then now() else paid_at end,
    paid_on           = case when p_to = 'Paid' then v_today else paid_on end,
    payment_reference = case when p_to = 'Paid' then nullif(btrim(p_payment_reference), '') else payment_reference end,
    advance_applied   = case when p_to = 'Paid' then v_applied else advance_applied end,
    cancelled_at      = case when p_to = 'Cancelled' then now() else cancelled_at end
  where id = p_id;

  perform public.log_audit('expense_claim.transition', v_row.org_id, v_uid, p_id,
    jsonb_build_object('from', v_row.status::text, 'to', p_to::text, 'notes', p_notes, 'advance_applied', v_applied));
end; $$;
revoke all on function public.transition_expense_claim(uuid, public.expense_claim_status, text, text) from public, anon;
grant execute on function public.transition_expense_claim(uuid, public.expense_claim_status, text, text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════════════════════════════
-- §8 — spend_approval_route: 0243 §5 VERBATIM plus the lines marked `0247` (ADR-0075 §3 contract: claims
-- extend only this function's "line used"). Reverse = this text minus the `0247` lines.
-- ════════════════════════════════════════════════════════════════════════════════════════════════════

create or replace function public.spend_approval_route(
  p_org_id       uuid,
  p_project_id   uuid,
  p_category     public.budget_category,
  p_amount       numeric,
  p_currency     text,
  p_requester_id uuid,
  p_decider_id   uuid        default null,
  p_submitted_at timestamptz default null
) returns table (route text, reason text, approver_ids uuid[], line_budget numeric, line_used numeric)
  language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare
  v_reason       text;
  v_budget       numeric;
  v_used         numeric;
  v_currency     text;
  v_foreign      boolean;
  v_rows         int;
  v_eligible     uuid[];
  v_version      uuid;
  v_activated_at timestamptz;
begin
  -- 1. Classify (DD-APR-2). A missing or negative amount can never be "within" (DD-APR-5).
  if p_project_id is null then
    v_reason := 'no_project';
  elsif p_category is null then
    v_reason := 'no_category';
  elsif p_amount is null or p_amount < 0 then
    v_reason := 'amount_invalid';
  else
    select v.id, v.currency, v.activated_at into v_version, v_currency, v_activated_at
      from public.budget_versions v
     where v.org_id = p_org_id and v.project_id = p_project_id and v.status = 'Active';
    if not found then
      v_reason := 'no_active_budget';
    else
      select coalesce(sum(li.budgeted_amount), 0) into v_budget
        from public.budget_line_items li
        join public.budget_versions v on v.id = li.budget_version_id
       where v.org_id = p_org_id and v.project_id = p_project_id and v.status = 'Active'
         and li.category = p_category;
      -- Reserved (ADR-0034) ∪ Committed (OD-BUDGET-2) on this line. The request being decided is
      -- 'Requested', so it is never in its own sum. DD-APR-5: each request counts at least zero, so a
      -- negative row that predates the CHECKs cannot make room on the line.
      select coalesce(sum(greatest(0, pr.total_value,
               coalesce((select sum(i.amount) from public.procurement_items i where i.procurement_id = pr.id), 0))), 0),
             coalesce(bool_or(pr.currency is distinct from v_currency), false)
        into v_used, v_foreign
        from public.procurements pr
       where pr.org_id = p_org_id and pr.project_id = p_project_id and pr.budget_category = p_category
         and pr.status in ('Approved','Vendor Quoted','Quote Selected','Ordered','Received','Vendor Invoiced','Paid');
      -- 0247 (#775, DD-EXP-2): approved and paid expense CLAIMS on this line are spend too. Advances are not:  -- 0247
      -- cash in custody is not cost, and counting it and the claims that settle it would count twice.          -- 0247
      -- The claim being decided is 'Submitted', so it is never in its own sum.                                  -- 0247
      select v_used + coalesce(sum(greatest(0, c.amount)), 0),                                                  -- 0247
             v_foreign or coalesce(bool_or(c.currency is distinct from v_currency), false)                      -- 0247
        into v_used, v_foreign                                                                                   -- 0247
        from public.expense_claims c                                                                             -- 0247
       where c.org_id = p_org_id and c.project_id = p_project_id and c.budget_category = p_category              -- 0247
         and c.kind = 'claim' and c.status in ('Approved','Paid');                                               -- 0247
      -- Explicit `<=` for "within": anything not provably within (a NULL included) is not within.
      if p_currency is distinct from v_currency or v_foreign then
        v_reason := 'currency_mismatch';
      elsif v_used + p_amount <= v_budget then
        -- DD-APR-3: the budget the request fits must not have been set by the decider, or after submission.
        if (p_submitted_at is not null and v_activated_at > p_submitted_at)
           or (p_decider_id is not null and exists (
                 select 1 from public.audit_events a
                  where a.org_id = p_org_id and a.entity_id = v_version
                    and a.action = 'budget_version.update'
                    and a.detail->>'to_status' = 'Active'
                    and a.detail->>'from_status' is distinct from 'Active'
                    and a.actor_id = p_decider_id))
        then
          v_reason := 'budget_changed';
        else
          v_reason := 'within_budget';
        end if;
      else
        v_reason := 'exceeds_line';
      end if;
    end if;
  end if;

  -- 2. Within budget → the project's approvers (FR-APR-012/013/014).
  if v_reason = 'within_budget' then
    select count(*),
           coalesce(array_agg(sa.profile_id order by sa.profile_id) filter (
             where sa.profile_id is distinct from p_requester_id
               and pf.status = 'active'
               and pf.org_id = p_org_id
               and public.holds_spend_approval_authority(pf.role)), '{}')
      into v_rows, v_eligible
      from public.spend_approvers sa
      join public.profiles pf on pf.id = sa.profile_id
     where sa.org_id = p_org_id and sa.project_id = p_project_id;
    if v_rows = 0 then
      return query select 'flat'::text, v_reason, null::uuid[], v_budget, v_used;  -- unconfigured
      return;
    elsif cardinality(v_eligible) > 0 then
      return query select 'project'::text, v_reason, v_eligible, v_budget, v_used;
      return;
    end if;
    -- configured, nobody eligible → escalate to the senior set (FR-APR-014)
  end if;

  -- 3. The senior set (FR-APR-012/015). DD-APR-4: the flat matrix applies only when no senior set is
  -- configured at all; a configured set with nobody eligible leaves the decision to an Admin.
  select count(*),
         coalesce(array_agg(sa.profile_id order by sa.profile_id) filter (
           where sa.profile_id is distinct from p_requester_id
             and pf.status = 'active'
             and pf.org_id = p_org_id
             and public.holds_spend_approval_authority(pf.role)), '{}')
    into v_rows, v_eligible
    from public.spend_approvers sa
    join public.profiles pf on pf.id = sa.profile_id
   where sa.org_id = p_org_id and sa.project_id is null;
  if cardinality(v_eligible) > 0 then
    return query select 'org'::text, v_reason, v_eligible, v_budget, v_used;
    return;
  elsif v_rows > 0 then
    return query select 'admin'::text, v_reason, '{}'::uuid[], v_budget, v_used;
    return;
  end if;
  return query select 'flat'::text, v_reason, null::uuid[], v_budget, v_used;
end; $$;
revoke all on function public.spend_approval_route(uuid, uuid, public.budget_category, numeric, text, uuid, uuid, timestamptz) from public, anon;
grant execute on function public.spend_approval_route(uuid, uuid, public.budget_category, numeric, text, uuid, uuid, timestamptz) to authenticated;

-- §8b — the UI read for claims (FR-EXP-031), the twin of 0243 §6. SECURITY INVOKER: RLS on expense_claims is
-- the org boundary; an id the caller cannot see yields no row. Decider = the viewer unless they are the claimant.
create or replace function public.get_expense_claim_approval_routes(p_ids uuid[])
returns table (claim_id uuid, route text, reason text, approvers jsonb,
               request_amount numeric, line_budget numeric, line_used numeric)
  language sql stable security invoker set search_path = public, pg_temp as $$
  select c.id, r.route, r.reason,
         coalesce((select jsonb_agg(jsonb_build_object('id', pf.id, 'full_name', pf.full_name) order by pf.full_name)
                     from public.profiles pf where pf.id = any (r.approver_ids)), '[]'::jsonb),
         c.amount, r.line_budget, r.line_used
    from public.expense_claims c
    cross join lateral public.spend_approval_route(c.org_id, c.project_id, c.budget_category, c.amount, c.currency,
                                                   c.claimant_id, nullif(auth.uid(), c.claimant_id), c.submitted_at) r
   where c.id = any (p_ids) and c.status = 'Submitted'
$$;
revoke all on function public.get_expense_claim_approval_routes(uuid[]) from public, anon;
grant execute on function public.get_expense_claim_approval_routes(uuid[]) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════════════════════════════
-- §9 — cash returned on an advance (FR-EXP-041) and aging (FR-EXP-042, DD-EXP-7).
-- `p_amount > 0 and < Infinity` also rejects NaN ('NaN' > 0 is TRUE in Postgres; NaN < Infinity is FALSE).
-- ════════════════════════════════════════════════════════════════════════════════════════════════════
create or replace function public.record_expense_advance_return(p_id uuid, p_amount numeric, p_reference text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_row  public.expense_claims%rowtype;
  v_out  numeric;
  v_uid  uuid      := auth.uid();
  v_role user_role := auth_role();
begin
  perform public.assert_is_active_member();
  select * into v_row from public.expense_claims where id = p_id for update;
  if not found then
    raise exception 'expense advance not found' using errcode = 'P0002';
  end if;
  if v_row.org_id is distinct from auth_org_id() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_row.kind is distinct from 'advance' or v_row.status is distinct from 'Paid' then
    raise exception 'only a paid advance can have cash returned against it' using errcode = 'P0001';
  end if;
  if v_uid = v_row.claimant_id then
    raise exception 'separation of duties: a claimant cannot record a return of their own advance' using errcode = '42501';
  end if;
  if v_role is distinct from 'Finance' and v_role is distinct from 'Admin' then
    raise exception 'only Finance or an Admin records an advance return' using errcode = '42501';
  end if;
  if p_amount is null or not (p_amount > 0 and p_amount < 'Infinity'::numeric) then
    raise exception 'a return amount must be greater than zero' using errcode = 'P0001';
  end if;
  v_out := public.expense_advance_outstanding(p_id);
  if p_amount > v_out then
    raise exception 'a return of % exceeds the % still outstanding on this advance', round(p_amount, 2), round(v_out, 2)
      using errcode = 'P0001';
  end if;
  update public.expense_claims set returned_amount = returned_amount + p_amount where id = p_id;
  perform public.log_audit('expense_advance.return', v_row.org_id, v_uid, p_id,
    jsonb_build_object('amount', p_amount, 'reference', nullif(btrim(p_reference), ''), 'outstanding_after', v_out - p_amount));
end; $$;
revoke all on function public.record_expense_advance_return(uuid, numeric, text) from public, anon;
grant execute on function public.record_expense_advance_return(uuid, numeric, text) to authenticated;

-- Aging: every visible Paid advance with money outstanding, oldest first. A Paid advance with no paid date (an
-- import) ages as 90+. SECURITY INVOKER — RLS decides whose advances the caller sees.
create or replace function public.get_expense_advance_aging()
returns table (advance_id uuid, claim_number text, claimant_id uuid, claimant_name text,
               project_id uuid, project_name text, currency text, amount numeric, settled numeric,
               returned numeric, outstanding numeric, paid_on date, age_days int, bucket text)
  language sql stable security invoker set search_path = public, pg_temp as $$
  with adv as (
    select a.*,
           (now() at time zone coalesce(o.default_timezone, 'UTC'))::date as org_today,
           coalesce((select sum(c.advance_applied) from public.expense_claims c
                      where c.advance_id = a.id and c.status = 'Paid'), 0) as settled_sum
      from public.expense_claims a
      join public.organizations o on o.id = a.org_id
     where a.kind = 'advance' and a.status = 'Paid'
  )
  select adv.id, adv.claim_number, adv.claimant_id, pf.full_name, adv.project_id, p.name, adv.currency,
         adv.amount, adv.settled_sum, adv.returned_amount,
         adv.amount - adv.settled_sum - adv.returned_amount,
         adv.paid_on,
         (adv.org_today - adv.paid_on)::int,
         case when adv.paid_on is null then '90+'
              when adv.org_today - adv.paid_on <= 30 then '0-30'
              when adv.org_today - adv.paid_on <= 60 then '31-60'
              when adv.org_today - adv.paid_on <= 90 then '61-90'
              else '90+' end
    from adv
    left join public.profiles pf on pf.id = adv.claimant_id
    left join public.projects p  on p.id = adv.project_id
   where adv.amount - adv.settled_sum - adv.returned_amount > 0
   order by adv.paid_on nulls first, adv.id
$$;
revoke all on function public.get_expense_advance_aging() from public, anon;
grant execute on function public.get_expense_advance_aging() to authenticated;

-- ════════════════════════════════════════════════════════════════════════════════════════════════════
-- §10 — hand-offs (FR-EXP-050/051), the 0237 / 0243 §9 pattern. Recipients on submit = the route's people, from
-- the SAME function the transition enforces with (one copy of the rule). notify_workflow_user drops the actor,
-- other orgs and inactive members itself.
-- ════════════════════════════════════════════════════════════════════════════════════════════════════
create or replace function public.notify_expense_claim_transition() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r       record;
  v_route record;
  v_noun  text := case new.kind when 'advance' then 'Cash advance' else 'Expense claim' end;
  v_label text := coalesce(new.claim_number, new.title);
begin
  if new.status is not distinct from old.status then
    return new;
  end if;
  if old.status = 'Draft' and new.status = 'Submitted' then
    select * into v_route
      from public.spend_approval_route(new.org_id, new.project_id, new.budget_category, new.amount, new.currency,
                                       new.claimant_id, null, new.submitted_at);
    for r in select p.id from public.profiles p
              where p.org_id = new.org_id
                and p.id is distinct from new.claimant_id
                and case coalesce(v_route.route, 'admin')
                      when 'flat'  then public.holds_spend_approval_authority(p.role)
                      when 'admin' then p.role = 'Admin'
                      else p.id = any (v_route.approver_ids)
                    end
    loop
      perform public.notify_workflow_user(new.org_id, r.id, v_noun || ' awaiting your approval',
        new.title, 'info', 'expense_claim', new.id, v_label);
    end loop;
  elsif old.status = 'Submitted' and new.status = 'Approved' then
    perform public.notify_workflow_user(new.org_id, new.claimant_id, 'Your ' || lower(v_noun) || ' was approved',
      coalesce(nullif(btrim(new.approval_notes), ''), new.title), 'info', 'expense_claim', new.id, v_label);
    for r in select p.id from public.profiles p
              where p.org_id = new.org_id and p.role = 'Finance'
                and p.id is distinct from new.claimant_id and p.id is distinct from new.approved_by_id
    loop
      perform public.notify_workflow_user(new.org_id, r.id, v_noun || ' ready to pay',
        new.title, 'info', 'expense_claim', new.id, v_label);
    end loop;
  elsif old.status = 'Submitted' and new.status = 'Rejected' then
    perform public.notify_workflow_user(new.org_id, new.claimant_id, 'Your ' || lower(v_noun) || ' was rejected',
      coalesce(nullif(btrim(new.rejection_notes), ''), new.title), 'warning', 'expense_claim', new.id, v_label);
  elsif old.status = 'Approved' and new.status = 'Paid' then
    perform public.notify_workflow_user(new.org_id, new.claimant_id, 'Your ' || lower(v_noun) || ' was paid',
      new.title, 'info', 'expense_claim', new.id, v_label);
  end if;
  return new;
end; $$;
revoke execute on function public.notify_expense_claim_transition() from public, anon, authenticated;
create trigger expense_claims_notify_transition_trg
  after update of status on public.expense_claims
  for each row execute function public.notify_expense_claim_transition();
