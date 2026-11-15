-- 0887 — #895 accountant's desk piece 1: manual journals.
-- Plan: docs/plans/2026-11-15-manual-journals.md. Spec: docs/specs/accountants-desk.spec.md §5–§8.
--
-- A Finance member drafts a balanced journal in PMO, a DIFFERENT Finance-or-above member approves it, and it posts
-- once to the org's ledger through the existing money outbox. Owner rulings (2026-11-15):
--   1. Every manual journal needs a second approver before it posts (no threshold).
--   2. Approver = any Finance-or-above member of the org who did NOT write the journal (maker + every editor; for a
--      reversal, also anyone who wrote the original). Journals only — `may_approve_work_of` is deliberately NOT used,
--      because it requires the approver to outrank the author and so refuses peer-Finance approval. Enforced here,
--      server-side (ADR-0019), by `may_approve_journal` inside the definer RPCs. Exception (owner ruling): when the
--      org has exactly one member (one profile, any status) and has never had a second, that member may approve their own
--      journal (checked at approval). `org_second_member_marks` holds the permanent "has had a second member" marker.
--   3. The closed-month refusal ships later (piece 6); nothing here looks at accounting periods.
--   4. An Admin picks the Odoo journal for desk entries per company (`set_desk_journal`); until then the push read
--      refuses with a setup message naming what to set.
--
-- Clients can only SELECT the three tables (Finance-or-above, own org). Every write goes through the definer RPCs
-- below; `record_journal_outcome` is service-role only (the dispatch's finalize/hold writer). org_id is never taken
-- from the client: it comes from the caller's profile (auth_org_id()).
--
-- ROLLBACK: supabase/migrations/rollback/0887_manual_journals_down.sql — drops the RPCs, the policies, the three
-- journal tables, the second-member trigger, its function and marker table, and the two types, in that order, and
-- nothing else. It refuses while any journal exists.

create type public.journal_status as enum ('draft','submitted','approved','sending','posted','scheduled','held','refused');
create type public.journal_kind as enum ('fee','interest','tax-deposit','accrual','reclassification','correction',
                                         'funding','depreciation','revaluation','closing');

create table public.journal_entries (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid not null default public.auth_org_id() references public.organizations(id) on delete cascade,
  kind                 public.journal_kind not null,
  entry_date           date not null,
  memo                 text not null check (length(btrim(memo)) between 1 and 500),
  status               public.journal_status not null default 'draft',
  maker_id             uuid not null references public.profiles(id),
  approver_id          uuid references public.profiles(id),
  approved_at          timestamptz,
  return_reason        text,
  reverses_journal_id  uuid references public.journal_entries(id),
  reversal_reason      text,
  external_record_id   text,               -- the ledger's ref, written only by the finalize path
  external_name        text,               -- the ledger's document number (e.g. MISC/2026/0052), from the read-back
  posted_date          date,               -- the ledger's date, from the read-back
  held_reason          text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  check ((reverses_journal_id is null) = (reversal_reason is null))
);
create unique index journal_entries_one_reversal on public.journal_entries (reverses_journal_id)
  where reverses_journal_id is not null and status <> 'refused';
create index journal_entries_org_date on public.journal_entries (org_id, entry_date);
create index journal_entries_external_name on public.journal_entries (org_id, external_name) where external_name is not null;

create table public.journal_entry_lines (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null default public.auth_org_id() references public.organizations(id) on delete cascade,
  journal_id         uuid not null references public.journal_entries(id) on delete cascade,
  line_no            int  not null,
  account            text not null check (length(btrim(account)) between 1 and 140),
  debit              numeric(18,2) not null default 0 check (debit  >= 0),
  credit             numeric(18,2) not null default 0 check (credit >= 0),
  partner_company_id uuid references public.companies(id),
  project_id         uuid references public.projects(id),
  label              text not null default '' check (length(label) <= 500),
  check ((debit = 0) <> (credit = 0)),
  unique (journal_id, line_no)
);
create index journal_entry_lines_org on public.journal_entry_lines (org_id);

create table public.journal_entry_authors (
  journal_id uuid not null references public.journal_entries(id) on delete cascade,
  profile_id uuid not null references public.profiles(id),
  org_id     uuid not null default public.auth_org_id() references public.organizations(id) on delete cascade,
  primary key (journal_id, profile_id)
);
create index journal_entry_authors_profile on public.journal_entry_authors (profile_id);

-- ── RLS: select-only, Finance-or-above, own org ────────────────────────────────────────────────────
alter table public.journal_entries enable row level security;
alter table public.journal_entries force row level security;
alter table public.journal_entry_lines enable row level security;
alter table public.journal_entry_lines force row level security;
alter table public.journal_entry_authors enable row level security;
alter table public.journal_entry_authors force row level security;

create policy journal_entries_select on public.journal_entries for select to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member())
         and (select public.auth_role())::text in ('Admin','Executive','Finance'));
create policy journal_entry_lines_select on public.journal_entry_lines for select to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member())
         and (select public.auth_role())::text in ('Admin','Executive','Finance'));
create policy journal_entry_authors_select on public.journal_entry_authors for select to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member())
         and (select public.auth_role())::text in ('Admin','Executive','Finance'));

revoke all on public.journal_entries, public.journal_entry_lines, public.journal_entry_authors from public, anon, authenticated;
grant select on public.journal_entries, public.journal_entry_lines, public.journal_entry_authors to authenticated;

-- ── The caller gate every client RPC starts with ───────────────────────────────────────────────────
create or replace function public.assert_journal_desk_member() returns uuid
  language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare v_org uuid := public.auth_org_id();
begin
  perform public.assert_is_active_member();
  if v_org is null or public.role_rank(public.auth_role()) is null
     or public.role_rank(public.auth_role()) < public.role_rank('Finance'::user_role) then
    raise exception 'only Finance, Executive or Admin can work with journals' using errcode = '42501';
  end if;
  return v_org;
end $$;
revoke all on function public.assert_journal_desk_member() from public, anon, authenticated;

-- ── "Has had a second member": a permanent per-organisation marker ─────────────────────────────────
-- A row exists once the organisation has ever held two or more profiles. A trigger on profiles writes it whenever a
-- profile lands in an organisation that then holds two or more; nothing deletes it except the organisation itself
-- going away (cascade). No client role can read or write it.
create table public.org_second_member_marks (
  org_id    uuid primary key references public.organizations(id) on delete cascade,
  marked_at timestamptz not null default now()
);
alter table public.org_second_member_marks enable row level security;
alter table public.org_second_member_marks force row level security;
revoke all on public.org_second_member_marks from public, anon, authenticated;

create or replace function public.mark_org_second_member() returns trigger
  language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if new.org_id is not null
     and (select count(*) from public.profiles p where p.org_id = new.org_id) >= 2 then
    insert into public.org_second_member_marks (org_id) values (new.org_id) on conflict (org_id) do nothing;
  end if;
  return null;
end $$;
revoke all on function public.mark_org_second_member() from public, anon, authenticated;
create trigger profiles_mark_org_second_member
  after insert or update of org_id on public.profiles
  for each row execute function public.mark_org_second_member();

-- Backfill: every organisation that holds two or more profiles today.
insert into public.org_second_member_marks (org_id)
select p.org_id from public.profiles p where p.org_id is not null group by p.org_id having count(*) >= 2
on conflict (org_id) do nothing;

-- ── Separation of duties (owner ruling 2): one predicate, journals only ───────────────────────────
-- The sole-member exemption: the organisation has exactly one profile row (whatever its status), that profile is
-- p_profile, and the organisation has never had a second member (no org_second_member_marks row).
create or replace function public.journal_org_sole_member(p_org uuid, p_profile uuid)
  returns boolean language sql stable security definer set search_path = pg_catalog, public as $$
  select not exists (select 1 from public.org_second_member_marks m where m.org_id = p_org)
     and (select count(*) from public.profiles p where p.org_id = p_org) = 1
     and exists (select 1 from public.profiles p where p.org_id = p_org and p.id = p_profile)
$$;
revoke all on function public.journal_org_sole_member(uuid, uuid) from public, anon, authenticated;

create or replace function public.journal_approver_allows(p_journal_id uuid, p_approver uuid)
  returns boolean language sql stable security definer set search_path = pg_catalog, public as $$
  select coalesce((
    select public.role_rank(ap.role) >= public.role_rank('Finance'::user_role)
           and ap.org_id = j.org_id
           and public.is_active_member(ap.id)
           and (
             -- an org that has only ever had one member: that member may approve their own journal (owner ruling, #895)
             public.journal_org_sole_member(j.org_id, p_approver)
             or (
               -- not the maker or any editor of this journal
               not exists (select 1 from public.journal_entry_authors a
                            where a.journal_id = j.id and a.profile_id is not distinct from p_approver)
               and j.maker_id is distinct from p_approver
               -- for a reversal, not anyone who wrote the original either
               and (j.reverses_journal_id is null or not exists (
                     select 1 from public.journal_entry_authors oa
                      where oa.journal_id = j.reverses_journal_id and oa.profile_id = p_approver))))
      from public.journal_entries j
      join public.profiles ap on ap.id = p_approver
     where j.id = p_journal_id), false)
$$;
revoke all on function public.journal_approver_allows(uuid, uuid) from public, anon, authenticated;

-- The signed-in user's own answer; it takes no approver id.
create or replace function public.may_approve_journal(p_journal_id uuid)
  returns boolean language sql stable security definer set search_path = pg_catalog, public as $$
  select public.journal_approver_allows(p_journal_id, auth.uid())
$$;
comment on function public.may_approve_journal(uuid) is
  '#895 — may the signed-in user approve this journal: a Finance-or-above member of its org who is not in its author '
  'set (maker + every editor) and, for a reversal, not in the original''s author set — except that the only member of '
  'an organisation that has only ever had one member (one profile in total, any status) may approve their own journal.';
revoke all on function public.may_approve_journal(uuid) from public, anon;
grant execute on function public.may_approve_journal(uuid) to authenticated;

-- ── Drafting ───────────────────────────────────────────────────────────────────────────────────────
create or replace function public.save_journal_draft(p_id uuid, p_kind public.journal_kind, p_date date, p_memo text, p_lines jsonb)
  returns uuid language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_org uuid := public.assert_journal_desk_member();
  v_me  uuid := auth.uid();
  v_row public.journal_entries%rowtype;
  v_id  uuid;
  v_line record;
  v_no  int := 0;
  v_debit numeric(18,2);
  v_credit numeric(18,2);
begin
  perform public.assert_is_active_member();  -- explicit, ahead of every write (AC-AMG-001 reads the body)
  if p_kind is null or p_date is null then raise exception 'a journal needs a kind and a date' using errcode = '22023'; end if;
  if p_memo is null or length(btrim(p_memo)) not between 1 and 500 then
    raise exception 'a journal needs a memo of up to 500 characters' using errcode = '22023';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) > 200 then
    raise exception 'journal lines must be a list of up to 200 lines' using errcode = '22023';
  end if;

  if p_id is null then
    insert into public.journal_entries (org_id, kind, entry_date, memo, maker_id)
      values (v_org, p_kind, p_date, btrim(p_memo), v_me) returning id into v_id;
  else
    select * into v_row from public.journal_entries where id = p_id and org_id = v_org for update;
    if not found then raise exception 'journal not found' using errcode = '42501'; end if;
    if v_row.status <> 'draft' then raise exception 'only a draft can be edited' using errcode = 'P0001'; end if;
    if v_row.reverses_journal_id is not null then
      raise exception 'a reversal cannot be edited; it carries the original''s lines with their sides swapped' using errcode = 'P0001';
    end if;
    update public.journal_entries set kind = p_kind, entry_date = p_date, memo = btrim(p_memo), updated_at = now() where id = p_id;
    delete from public.journal_entry_lines where journal_id = p_id;
    v_id := p_id;
  end if;

  for v_line in select * from jsonb_array_elements(p_lines) as e(l) loop
    v_no := v_no + 1;
    begin
      v_debit  := coalesce(nullif(v_line.l->>'debit', ''), '0')::numeric(18,2);
      v_credit := coalesce(nullif(v_line.l->>'credit', ''), '0')::numeric(18,2);
    exception when others then
      raise exception 'line %: the amount is not a number', v_no using errcode = '22023';
    end;
    if v_debit < 0 or v_credit < 0 or (v_debit = 0) = (v_credit = 0) then
      raise exception 'line %: each line takes either a debit or a credit', v_no using errcode = '22023';
    end if;
    if coalesce(btrim(v_line.l->>'account'), '') = '' then
      raise exception 'line %: choose an account', v_no using errcode = '22023';
    end if;
    if nullif(v_line.l->>'project_id', '') is not null and not exists (
         select 1 from public.projects where id = (v_line.l->>'project_id')::uuid and org_id = v_org) then
      raise exception 'line %: the project is not in this organisation', v_no using errcode = '22023';
    end if;
    if nullif(v_line.l->>'partner_company_id', '') is not null and not exists (
         select 1 from public.companies where id = (v_line.l->>'partner_company_id')::uuid and org_id = v_org) then
      raise exception 'line %: the company is not in this organisation', v_no using errcode = '22023';
    end if;
    insert into public.journal_entry_lines (org_id, journal_id, line_no, account, debit, credit, partner_company_id, project_id, label)
      values (v_org, v_id, v_no, btrim(v_line.l->>'account'), v_debit, v_credit,
              nullif(v_line.l->>'partner_company_id', '')::uuid, nullif(v_line.l->>'project_id', '')::uuid,
              left(coalesce(v_line.l->>'label', ''), 500));
  end loop;

  insert into public.journal_entry_authors (journal_id, profile_id, org_id) values (v_id, v_me, v_org) on conflict do nothing;
  return v_id;
end $$;

-- ── Submit: balance, at least two lines, accounts live in the ledger chart ─────────────────────────
create or replace function public.submit_journal(p_id uuid) returns void
  language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_org uuid := public.assert_journal_desk_member();
  v_row public.journal_entries%rowtype;
  v_lines int;
  v_diff numeric(18,2);
  v_bad text;
  v_has_chart boolean;
begin
  perform public.assert_is_active_member();  -- explicit, ahead of every write (AC-AMG-001 reads the body)
  select * into v_row from public.journal_entries where id = p_id and org_id = v_org for update;
  if not found then raise exception 'journal not found' using errcode = '42501'; end if;
  if v_row.status <> 'draft' then raise exception 'only a draft can be submitted' using errcode = 'P0001'; end if;

  select count(*), coalesce(sum(debit), 0) - coalesce(sum(credit), 0) into v_lines, v_diff
    from public.journal_entry_lines where journal_id = p_id;
  if v_lines < 2 then raise exception 'a journal needs two or more lines' using errcode = 'P0001'; end if;
  if v_diff <> 0 then
    raise exception 'the journal does not balance by %', to_char(abs(v_diff), 'FM999999999999990.00') using errcode = 'P0001';
  end if;

  -- An account the ledger has archived is refused; so is one its mirrored chart does not hold. A chart that has not
  -- been read yet (no mirrored accounts) leaves the check to the ledger, whose refusal holds the journal.
  select l.account into v_bad from public.journal_entry_lines l
   where l.journal_id = p_id
     and not exists (select 1 from public.external_master_records m
                      where m.org_id = v_org and m.kind = 'account' and m.code = l.account and m.active and m.tombstoned_at is null)
     and not exists (select 1 from public.erp_account_mirror a
                      where a.org_id = v_org and a.erp_name = l.account and not a.disabled and not a.is_group)
     and (exists (select 1 from public.external_master_records m where m.org_id = v_org and m.kind = 'account' and m.code = l.account)
          or exists (select 1 from public.erp_account_mirror a where a.org_id = v_org and a.erp_name = l.account))
   order by l.line_no limit 1;
  if v_bad is not null then
    raise exception 'account % is archived in the ledger', v_bad using errcode = 'P0001';
  end if;
  v_has_chart := exists (select 1 from public.external_master_records where org_id = v_org and kind = 'account')
              or exists (select 1 from public.erp_account_mirror where org_id = v_org);
  if v_has_chart then
    select l.account into v_bad from public.journal_entry_lines l
     where l.journal_id = p_id
       and not exists (select 1 from public.external_master_records m where m.org_id = v_org and m.kind = 'account' and m.code = l.account)
       and not exists (select 1 from public.erp_account_mirror a where a.org_id = v_org and a.erp_name = l.account)
     order by l.line_no limit 1;
    if v_bad is not null then
      raise exception 'account % is not in the ledger''s chart of accounts', v_bad using errcode = 'P0001';
    end if;
  end if;

  update public.journal_entries set status = 'submitted', return_reason = null, updated_at = now() where id = p_id;
  perform public.log_audit('journal.submit', v_org, auth.uid(), p_id, jsonb_build_object('lines', v_lines));
end $$;

-- ── Approve / return (owner rulings 1 and 2) ───────────────────────────────────────────────────────
create or replace function public.approve_journal(p_id uuid) returns void
  language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_org uuid := public.assert_journal_desk_member();
  v_row public.journal_entries%rowtype;
begin
  perform public.assert_is_active_member();  -- explicit, ahead of every write (AC-AMG-001 reads the body)
  select * into v_row from public.journal_entries where id = p_id and org_id = v_org for update;
  if not found then raise exception 'journal not found' using errcode = '42501'; end if;
  if not public.journal_approver_allows(p_id, auth.uid()) then
    raise exception 'a journal is approved by a Finance, Executive or Admin member who did not write it' using errcode = '42501';
  end if;
  if v_row.status <> 'submitted' then raise exception 'only a submitted journal can be approved' using errcode = 'P0001'; end if;
  update public.journal_entries set status = 'approved', approver_id = auth.uid(), approved_at = now(), updated_at = now() where id = p_id;
  perform public.log_audit('journal.approve', v_org, auth.uid(), p_id,
    jsonb_build_object('sole_member', public.journal_org_sole_member(v_org, auth.uid())));
end $$;

create or replace function public.return_journal(p_id uuid, p_reason text) returns void
  language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_org uuid := public.assert_journal_desk_member();
  v_row public.journal_entries%rowtype;
begin
  perform public.assert_is_active_member();  -- explicit, ahead of every write (AC-AMG-001 reads the body)
  if p_reason is null or length(btrim(p_reason)) not between 1 and 500 then
    raise exception 'say why the journal is returned' using errcode = '22023';
  end if;
  select * into v_row from public.journal_entries where id = p_id and org_id = v_org for update;
  if not found then raise exception 'journal not found' using errcode = '42501'; end if;
  if not public.journal_approver_allows(p_id, auth.uid()) then
    raise exception 'a journal is returned by a Finance, Executive or Admin member who did not write it' using errcode = '42501';
  end if;
  if v_row.status <> 'submitted' then raise exception 'only a submitted journal can be returned' using errcode = 'P0001'; end if;
  update public.journal_entries set status = 'draft', return_reason = btrim(p_reason), updated_at = now() where id = p_id;
  perform public.log_audit('journal.return', v_org, auth.uid(), p_id, jsonb_build_object('reason', btrim(p_reason)));
end $$;

-- ── Reversal: a new draft journal with each line's sides swapped ───────────────────────────────────
create or replace function public.request_journal_reversal(p_original uuid, p_date date, p_reason text) returns uuid
  language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_org uuid := public.assert_journal_desk_member();
  v_row public.journal_entries%rowtype;
  v_id uuid;
begin
  perform public.assert_is_active_member();  -- explicit, ahead of every write (AC-AMG-001 reads the body)
  if p_date is null then raise exception 'a reversal needs a date' using errcode = '22023'; end if;
  if p_reason is null or length(btrim(p_reason)) not between 1 and 500 then
    raise exception 'say why the journal is reversed' using errcode = '22023';
  end if;
  select * into v_row from public.journal_entries where id = p_original and org_id = v_org for update;
  if not found then raise exception 'journal not found' using errcode = '42501'; end if;
  if v_row.status <> 'posted' then raise exception 'only a posted journal can be reversed' using errcode = 'P0001'; end if;
  if v_row.reverses_journal_id is not null then raise exception 'a reversal cannot itself be reversed' using errcode = 'P0001'; end if;
  begin
    insert into public.journal_entries (org_id, kind, entry_date, memo, maker_id, reverses_journal_id, reversal_reason)
      values (v_org, v_row.kind, p_date, left('Reversal: ' || v_row.memo, 500), auth.uid(), p_original, btrim(p_reason))
      returning id into v_id;
  exception when unique_violation then
    raise exception 'this journal is already reversed, or its reversal is waiting' using errcode = 'P0001';
  end;
  insert into public.journal_entry_lines (org_id, journal_id, line_no, account, debit, credit, partner_company_id, project_id, label)
    select v_org, v_id, line_no, account, credit, debit, partner_company_id, project_id, label
      from public.journal_entry_lines where journal_id = p_original;
  insert into public.journal_entry_authors (journal_id, profile_id, org_id) values (v_id, auth.uid(), v_org);
  perform public.log_audit('journal.reversal_requested', v_org, auth.uid(), v_id, jsonb_build_object('original', p_original));
  return v_id;
end $$;

-- ── Owner ruling 4: an Admin picks the Odoo journal for desk entries ──────────────────────────────
create or replace function public.set_desk_journal(p_journal_id text) returns void
  language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_org uuid := public.assert_journal_desk_member();
begin
  perform public.assert_is_active_member();  -- explicit, ahead of every write (AC-AMG-001 reads the body)
  if public.auth_role() <> 'Admin'::user_role then
    raise exception 'only an Admin chooses the journal for desk entries' using errcode = '42501';
  end if;
  perform 1 from public.external_org_bindings where org_id = v_org and external_tier = 'odoo' and status = 'active' for update;
  if not found then raise exception 'Odoo is not connected' using errcode = 'P0001'; end if;
  if p_journal_id is null or p_journal_id !~ '^[0-9]{1,9}$' or not exists (
       select 1 from public.external_master_records where org_id = v_org and external_tier = 'odoo' and kind = 'journal'
          and external_id = p_journal_id and active and tombstoned_at is null and attrs ->> 'type' = 'general') then
    raise exception 'not a general journal of this connection' using errcode = 'P0001';
  end if;
  update public.external_org_bindings
     set config = coalesce(config, '{}'::jsonb) || jsonb_build_object(
           'desk_journal_id', p_journal_id::int, 'desk_journal_id_set_by', auth.uid(), 'desk_journal_id_set_at', now())
   where org_id = v_org and external_tier = 'odoo' and status = 'active';
  perform public.log_audit('integration.odoo.desk_journal', v_org, auth.uid(), null, jsonb_build_object('journal', p_journal_id));
end $$;

-- The ledger the desk posts to, and whether it is ready (the Journals page's setup notice).
create or replace function public.journal_ledger_setup() returns jsonb
  language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare
  v_org uuid := public.assert_journal_desk_member();
  v_tier text;
  v_cfg jsonb;
begin
  select external_tier, config into v_tier, v_cfg from public.external_org_bindings
   where org_id = v_org and status = 'active' and external_tier in ('odoo','erpnext')
   order by (external_tier = 'odoo') desc limit 1;
  return jsonb_build_object(
    'tier', v_tier,
    'desk_journal_id', v_cfg ->> 'desk_journal_id',
    'needs_desk_journal', v_tier = 'odoo' and coalesce(v_cfg ->> 'desk_journal_id', '') = '');
end $$;

-- ── FR-MJE-022: the dispatch gate's re-read, under the caller's JWT ───────────────────────────────
create or replace function public.approved_journal_for_push(p_id uuid) returns jsonb
  language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare
  v_org uuid := public.assert_journal_desk_member();
  v_row public.journal_entries%rowtype;
  v_tier text;
  v_cfg jsonb;
  v_orig public.journal_entries%rowtype;
  v_lines jsonb;
  v_missing text;
begin
  select * into v_row from public.journal_entries where id = p_id and org_id = v_org;
  if not found or v_row.status not in ('approved','sending','held') then
    raise exception 'only an approved journal can be posted' using errcode = '42501';
  end if;
  select external_tier, config into v_tier, v_cfg from public.external_org_bindings
   where org_id = v_org and status = 'active' and external_tier in ('odoo','erpnext')
   order by (external_tier = 'odoo') desc limit 1;
  if v_tier is null then
    raise exception 'Connect a ledger (Odoo or ERPNext) before journals can post' using errcode = 'P0001';
  end if;
  if v_tier = 'odoo' and coalesce(v_cfg ->> 'desk_journal_id', '') = '' then
    raise exception 'An Admin must choose the Odoo journal for desk entries in Odoo setup before journals can post'
      using errcode = 'P0001';
  end if;

  select p.name into v_missing from public.journal_entry_lines l join public.projects p on p.id = l.project_id
   where l.journal_id = p_id and not exists (
     select 1 from public.external_project_bindings b
      where b.org_id = v_org and b.project_id = l.project_id and b.external_tier = v_tier and b.disconnected_at is null)
   order by l.line_no limit 1;
  if v_missing is not null then raise exception 'project % is not linked to the ledger', v_missing using errcode = 'P0001'; end if;

  select c.name into v_missing from public.journal_entry_lines l join public.companies c on c.id = l.partner_company_id
   where l.journal_id = p_id and not exists (
     select 1 from public.external_refs r
      where r.org_id = v_org and r.domain = 'companies' and r.pmo_record_id = l.partner_company_id::text and r.external_tier = v_tier)
   order by l.line_no limit 1;
  if v_missing is not null then raise exception 'company % is not linked to the ledger', v_missing using errcode = 'P0001'; end if;

  select jsonb_agg(jsonb_build_object(
           'account', l.account,
           'account_id', (select m.external_id from public.external_master_records m
                           where m.org_id = v_org and m.external_tier = v_tier and m.kind = 'account' and m.code = l.account
                             and m.active and m.tombstoned_at is null limit 1),
           'debit', to_char(l.debit, 'FM999999999999990.00'),
           'credit', to_char(l.credit, 'FM999999999999990.00'),
           'partner', (select r.external_record_id from public.external_refs r
                        where r.org_id = v_org and r.domain = 'companies' and r.pmo_record_id = l.partner_company_id::text
                          and r.external_tier = v_tier limit 1),
           'analytic', (select b.external_container_id from public.external_project_bindings b
                         where b.org_id = v_org and b.project_id = l.project_id and b.external_tier = v_tier and b.disconnected_at is null),
           'label', l.label) order by l.line_no)
    into v_lines from public.journal_entry_lines l where l.journal_id = p_id;

  if v_row.reverses_journal_id is not null then
    select * into v_orig from public.journal_entries where id = v_row.reverses_journal_id;
  end if;

  return jsonb_build_object(
    'id', v_row.id,
    'key', case when v_row.reverses_journal_id is null then 'journal:' else 'journal-rev:' end || v_row.id::text,
    'date', to_char(v_row.entry_date, 'YYYY-MM-DD'),
    'memo', v_row.memo,
    'tier', v_tier,
    'desk_journal_id', v_cfg ->> 'desk_journal_id',
    'status', v_row.status,
    'reverses', case when v_row.reverses_journal_id is null then null
                     else jsonb_build_object('journal_id', v_orig.id, 'external_record_id', v_orig.external_record_id,
                                             'reason', v_row.reversal_reason) end,
    'lines', coalesce(v_lines, '[]'::jsonb));
end $$;

-- ── FR-MJE-116: the finalize/hold writer — service role only ──────────────────────────────────────
create or replace function public.record_journal_outcome(p_id uuid, p_status public.journal_status, p_external_record_id text,
                                                         p_external_name text, p_posted_date date, p_reason text) returns void
  language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_row public.journal_entries%rowtype;
begin
  if current_setting('role', true) is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  select * into v_row from public.journal_entries where id = p_id for update;
  if not found then raise exception 'journal not found' using errcode = 'P0002'; end if;
  if v_row.status not in ('approved','sending','held','scheduled') then
    raise exception 'journal % is %, not waiting for the ledger', p_id, v_row.status using errcode = 'P0001';
  end if;
  if p_status = 'sending' then
    update public.journal_entries set status = 'sending', updated_at = now() where id = p_id;
  elsif p_status in ('posted','scheduled') then
    if coalesce(p_external_record_id, '') = '' then raise exception 'a ledger ref is required' using errcode = '22023'; end if;
    update public.journal_entries
       set status = p_status, external_record_id = p_external_record_id, external_name = coalesce(p_external_name, external_name),
           posted_date = case when p_status = 'posted' then p_posted_date else null end,
           held_reason = null, updated_at = now()
     where id = p_id;
  elsif p_status in ('held','refused') then
    update public.journal_entries
       set status = p_status, held_reason = coalesce(nullif(btrim(p_reason), ''), 'the ledger did not confirm the post'),
           updated_at = now()
     where id = p_id;
  else
    raise exception 'not a ledger outcome: %', p_status using errcode = '22023';
  end if;
end $$;

-- ── AC-MJE-006/-007: the desk list — PMO journals once, ledger moves PMO did not write as outside PMO ──
create or replace function public.list_journals(p_from date, p_to date) returns jsonb
  language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare v_org uuid := public.assert_journal_desk_member();
begin
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 400 then
    raise exception 'choose a date range of up to 400 days' using errcode = '22023';
  end if;
  return coalesce((select jsonb_agg(x order by x->>'date' desc, x->>'ledger_name') from (
    select jsonb_build_object(
             'origin', 'pmo', 'id', j.id, 'kind', j.kind, 'date', to_char(j.entry_date, 'YYYY-MM-DD'), 'memo', j.memo,
             'status', j.status, 'maker_id', j.maker_id, 'approver_id', j.approver_id,
             'ledger_name', j.external_name, 'external_record_id', j.external_record_id,
             'posted_date', j.posted_date, 'held_reason', j.held_reason, 'return_reason', j.return_reason,
             'reverses_journal_id', j.reverses_journal_id,
             'total', to_char((select coalesce(sum(debit), 0) from public.journal_entry_lines l where l.journal_id = j.id), 'FM999999999999990.00')) x
      from public.journal_entries j
     where j.org_id = v_org and j.entry_date between p_from and p_to
    union all
    select jsonb_build_object(
             'origin', 'outside-pmo', 'id', null, 'kind', null, 'date', to_char(min(g.posting_date), 'YYYY-MM-DD'),
             'memo', min(g.remarks), 'status', 'posted', 'ledger_name', g.voucher_no,
             'total', to_char(sum(coalesce(g.debit, 0)), 'FM999999999999990.00'))
      from public.erp_gl_entry_mirror g
     where g.org_id = v_org and g.voucher_type in ('account.move','Journal Entry') and not g.is_cancelled
       and g.posting_date between p_from and p_to
       and not exists (select 1 from public.journal_entries j where j.org_id = v_org and j.external_name = g.voucher_no)
     group by g.voucher_no) s), '[]'::jsonb);
end $$;

-- ── Grants ──────────────────────────────────────────────────────────────────────────────────────────
revoke all on function public.save_journal_draft(uuid, public.journal_kind, date, text, jsonb) from public, anon;
revoke all on function public.submit_journal(uuid) from public, anon;
revoke all on function public.approve_journal(uuid) from public, anon;
revoke all on function public.return_journal(uuid, text) from public, anon;
revoke all on function public.request_journal_reversal(uuid, date, text) from public, anon;
revoke all on function public.set_desk_journal(text) from public, anon;
revoke all on function public.journal_ledger_setup() from public, anon;
revoke all on function public.approved_journal_for_push(uuid) from public, anon;
revoke all on function public.list_journals(date, date) from public, anon;
revoke all on function public.record_journal_outcome(uuid, public.journal_status, text, text, date, text) from public, anon, authenticated;
grant execute on function public.save_journal_draft(uuid, public.journal_kind, date, text, jsonb) to authenticated;
grant execute on function public.submit_journal(uuid) to authenticated;
grant execute on function public.approve_journal(uuid) to authenticated;
grant execute on function public.return_journal(uuid, text) to authenticated;
grant execute on function public.request_journal_reversal(uuid, date, text) to authenticated;
grant execute on function public.set_desk_journal(text) to authenticated;
grant execute on function public.journal_ledger_setup() to authenticated;
grant execute on function public.approved_journal_for_push(uuid) to authenticated;
grant execute on function public.list_journals(date, date) to authenticated;
grant execute on function public.record_journal_outcome(uuid, public.journal_status, text, text, date, text) to service_role;

-- ── ROLLBACK (manual; the executable form is rollback/0887_manual_journals_down.sql) ─────────────────
--   Refuse while any journal exists, then drop, in order: list_journals, record_journal_outcome,
--   approved_journal_for_push, journal_ledger_setup, set_desk_journal, request_journal_reversal, return_journal,
--   approve_journal, submit_journal, save_journal_draft, may_approve_journal, journal_approver_allows, journal_org_sole_member, assert_journal_desk_member; the three
--   select policies; journal_entry_authors, journal_entry_lines, journal_entries; trigger profiles_mark_org_second_member,
--   mark_org_second_member, org_second_member_marks; types journal_kind, journal_status.
