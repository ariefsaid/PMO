-- 0961_retention.sql — retention: a share of each progress claim the client holds back, released later (#1572, #2522).
-- FR-RET-001..020, AC-RET-001..003 (docs/specs/billing-stages.spec.md); ADR-0103.
--
-- Retention is held on the receivable, NOT as an invoice line: the invoice built from the claim (native or ERP) and its VAT
-- stay at full value (DD-PBL-11), so no invoice builder changes. The claim stamps its retention once, at creation, from the
-- project's percentage (a BEFORE INSERT trigger: create_progress_claim is not redefined); assert_progress_claim_update (0250)
-- already refuses any later change to a claim column. Releases are scheduled, then recorded released, by Finance/Admin; the
-- scheduled-plus-released total never exceeds the claim's retention (checked under the claim row lock, and again by a trigger).

alter table public.projects
  add column retention_pct numeric(5,2) not null default 0 check (retention_pct >= 0 and retention_pct < 100);

alter table public.progress_claims
  add column retention_pct    numeric(5,2) not null default 0 check (retention_pct >= 0 and retention_pct < 100),
  add column retention_amount numeric(18,2) not null default 0 check (retention_amount >= 0);

-- FR-RET-002: stamped from the project, never from the caller.
create or replace function public.stamp_progress_claim_retention() returns trigger
  language plpgsql security definer set search_path = public as $$
declare v_pct numeric;
begin
  new.retention_pct := 0;
  new.retention_amount := 0;
  if new.kind = 'progress' then
    select p.retention_pct into v_pct from public.projects p where p.id = new.project_id and p.org_id = new.org_id;
    v_pct := coalesce(v_pct, 0);
    new.retention_pct := v_pct;
    new.retention_amount := greatest(least(round(new.gross_amount * v_pct / 100, 2), new.gross_amount - new.dp_recovery_amount), 0);
  end if;
  return new;
end; $$;
revoke all on function public.stamp_progress_claim_retention() from public, anon, authenticated;
create trigger progress_claims_zz_stamp_retention before insert on public.progress_claims
  for each row execute function public.stamp_progress_claim_retention();

-- FR-RET-001: Finance/Admin set the percentage; a Project Manager may still edit the rest of the project row.
create or replace function public.set_project_retention(p_project uuid, p_pct numeric) returns void
  language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.auth_org_id(); v_role user_role := public.auth_role();
begin
  perform public.assert_is_active_member();
  if v_role is null or v_role not in ('Admin','Finance') then
    raise exception 'only Finance or an Admin can set the retention percentage' using errcode = '42501';
  end if;
  if p_pct is null or p_pct < 0 or p_pct >= 100 or p_pct <> round(p_pct, 2) then
    raise exception 'retention is a percentage from 0 to under 100, with at most 2 decimals' using errcode = '22023', detail = 'retention-pct';
  end if;
  update public.projects p set retention_pct = p_pct where p.id = p_project and p.org_id = v_org;
  if not found then raise exception 'project not found' using errcode = 'P0002'; end if;
  perform public.log_audit('project.retention.set', v_org, auth.uid(), p_project, jsonb_build_object('retention_pct', p_pct));
end; $$;
revoke all on function public.set_project_retention(uuid, numeric) from public, anon;
grant execute on function public.set_project_retention(uuid, numeric) to authenticated, service_role;

-- Billing terms are one transaction: lock the project before replacing any of its terms.
create or replace function public.set_project_billing_terms(p_project uuid, p_stages jsonb, p_day integer, p_warn_days integer, p_pct numeric)
  returns void language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.auth_org_id(); v_role user_role := public.auth_role();
begin
  perform public.assert_is_active_member();
  if v_role is null or v_role not in ('Admin','Finance') then
    raise exception 'only Finance or an Admin can set billing terms' using errcode = '42501';
  end if;
  perform 1 from public.projects p where p.id = p_project and p.org_id = v_org for update;
  if not found then raise exception 'project not found' using errcode = 'P0002'; end if;
  perform public.set_billing_stage_template(p_project, p_stages);
  perform public.set_project_invoice_deadline(p_project, p_day, p_warn_days);
  perform public.set_project_retention(p_project, p_pct);
end; $$;
revoke all on function public.set_project_billing_terms(uuid, jsonb, integer, integer, numeric) from public, anon;
grant execute on function public.set_project_billing_terms(uuid, jsonb, integer, integer, numeric) to authenticated, service_role;

-- No client column grant on projects.retention_pct: it moves only through set_project_retention. Captured in record history.
update public.record_history_config
   set captured = captured || '{"retention_pct":"number"}'::jsonb
 where entity_type = 'project' and not (captured ? 'retention_pct');

-- ── releases ────────────────────────────────────────────────────────────────────────────────────────────────────────────
create table public.retention_releases (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id),
  claim_id     uuid not null references public.progress_claims(id) on delete cascade,
  project_id   uuid not null references public.projects(id) on delete cascade,
  amount       numeric(18,2) not null check (amount > 0),
  due_on       date not null,
  note         text check (note is null or length(note) <= 500),
  released_on  date,
  reference_no text check (reference_no is null or length(reference_no) <= 120),
  document_id  uuid references public.project_documents(id),
  created_by   uuid not null references auth.users(id),
  created_at   timestamptz not null default now(),
  released_by  uuid references auth.users(id),
  released_at  timestamptz,
  check ((released_on is null) = (released_by is null))
);
create index retention_releases_claim_idx on public.retention_releases (claim_id);
create index retention_releases_org_idx on public.retention_releases (org_id, project_id);
alter table public.retention_releases enable row level security;
alter table public.retention_releases force row level security;
revoke all on public.retention_releases from public, anon, authenticated;
grant select on public.retention_releases to authenticated;
grant all on public.retention_releases to service_role;
create policy retention_releases_select on public.retention_releases for select to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()));
create policy retention_releases_engineer_read_scope on public.retention_releases as restrictive for select to authenticated
  using ((select public.auth_role()) in ('Admin','Executive','Project Manager','Finance'));

-- Belt and braces under any writer: the total of a claim's releases never exceeds its retention; a recorded one never changes.
create or replace function public.guard_retention_release() returns trigger
  language plpgsql set search_path = public as $$
declare v_ret numeric; v_total numeric;
begin
  if tg_op in ('UPDATE','DELETE') and old.released_on is not null then
    raise exception 'a recorded retention release cannot change' using errcode = '55000', detail = 'release-recorded';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  select pc.retention_amount into v_ret from public.progress_claims pc where pc.id = new.claim_id for update;
  select coalesce(sum(r.amount), 0) into v_total from public.retention_releases r where r.claim_id = new.claim_id and r.id <> new.id;
  if v_total + new.amount > coalesce(v_ret, 0) then
    raise exception 'the releases would exceed the retention held on this claim' using errcode = '23514', detail = 'retention-exceeded';
  end if;
  return new;
end; $$;
create trigger retention_releases_guard before insert or update or delete on public.retention_releases
  for each row execute function public.guard_retention_release();

-- Shared preamble: caller may manage retention; returns the locked claim.
create or replace function public.lock_retention_claim(p_claim uuid) returns public.progress_claims
  language plpgsql security definer set search_path = public as $$
declare v_c public.progress_claims; v_role user_role := public.auth_role();
begin
  perform public.assert_is_active_member();
  if v_role is null or v_role not in ('Admin','Finance') then
    raise exception 'only Finance or an Admin can manage retention' using errcode = '42501';
  end if;
  select * into v_c from public.progress_claims pc where pc.id = p_claim and pc.org_id = public.auth_org_id() for update;
  if not found then raise exception 'progress claim not found' using errcode = 'P0002'; end if;
  return v_c;
end; $$;
revoke all on function public.lock_retention_claim(uuid) from public, anon, authenticated;

create or replace function public.schedule_retention_release(p_claim uuid, p_amount numeric, p_due_on date, p_note text default null) returns uuid
  language plpgsql security definer set search_path = public as $$
declare v_c public.progress_claims; v_id uuid;
begin
  perform public.assert_is_active_member();
  v_c := public.lock_retention_claim(p_claim);
  if v_c.withdrawn_at is not null then
    raise exception 'this progress claim was withdrawn' using errcode = '55000', detail = 'claim-withdrawn';
  end if;
  if v_c.retention_amount <= 0 then
    raise exception 'this claim holds no retention' using errcode = '55000', detail = 'no-retention';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 2) then
    raise exception 'a release is a positive amount with at most 2 decimals' using errcode = '23514', detail = 'release-amount';
  end if;
  if p_due_on is null then
    raise exception 'a release needs the date it falls due' using errcode = '23514', detail = 'release-due-date';
  end if;
  insert into public.retention_releases (org_id, claim_id, project_id, amount, due_on, note, created_by)
  values (v_c.org_id, v_c.id, v_c.project_id, p_amount, p_due_on, nullif(btrim(p_note), ''), auth.uid())
  returning id into v_id;
  perform public.log_audit('retention_release.schedule', v_c.org_id, auth.uid(), v_c.id,
    jsonb_build_object('release_id', v_id, 'amount', p_amount, 'due_on', p_due_on));
  return v_id;
end; $$;
revoke all on function public.schedule_retention_release(uuid, numeric, date, text) from public, anon;
grant execute on function public.schedule_retention_release(uuid, numeric, date, text) to authenticated, service_role;

create or replace function public.release_retention(p_release uuid, p_released_on date, p_reference text default null,
                                                    p_document uuid default null) returns void
  language plpgsql security definer set search_path = public as $$
declare
  v_r      public.retention_releases;
  v_c      public.progress_claims;
  v_status text;
  v_date   date;
  v_d_org  uuid; v_d_proj uuid; v_d_status public.doc_status; v_file text;
begin
  perform public.assert_is_active_member();
  select * into v_r from public.retention_releases r where r.id = p_release and r.org_id = public.auth_org_id();
  if not found then
    perform public.lock_retention_claim(null);   -- role refusal first for a caller who may not manage retention
  end if;
  v_c := public.lock_retention_claim(v_r.claim_id);
  select * into v_r from public.retention_releases r where r.id = p_release for update;
  if v_r.released_on is not null then
    raise exception 'this release is already recorded' using errcode = '55000', detail = 'release-recorded';
  end if;
  select si.status, si.invoice_date into v_status, v_date from public.sales_invoices si where si.id = v_c.id and si.org_id = v_c.org_id;
  if v_status is null or v_status not in ('Submitted','Unpaid','Paid') then
    raise exception 'retention is released on a submitted invoice: raise and approve the claim''s invoice first'
      using errcode = '55000', detail = 'invoice-not-submitted';
  end if;
  if p_released_on is null or p_released_on > public.native_org_today(v_c.org_id) or p_released_on < coalesce(v_date, p_released_on) then
    raise exception 'the release date must be between the invoice date and today' using errcode = '22023', detail = 'release-date';
  end if;
  if p_document is not null then
    select d.org_id, d.project_id, d.status, d.file_path into v_d_org, v_d_proj, v_d_status, v_file
      from public.project_documents d where d.id = p_document;
    if not found or v_d_org is distinct from v_c.org_id or v_d_proj is distinct from v_c.project_id then
      raise exception 'the proof must be one of the claim''s project documents' using errcode = '23514', detail = 'document-other-project';
    end if;
    if v_d_status not in ('Issued','Approved') then
      raise exception 'only an issued or approved document can be the proof' using errcode = '55000', detail = 'document-not-issued';
    end if;
    if v_file is null or btrim(v_file) = '' then
      raise exception 'the proof document has no file attached' using errcode = '55000', detail = 'document-without-file';
    end if;
  end if;
  update public.retention_releases r
     set released_on = p_released_on, reference_no = nullif(btrim(p_reference), ''), document_id = p_document,
         released_by = auth.uid(), released_at = now()
   where r.id = p_release;
  perform public.log_audit('retention_release.release', v_c.org_id, auth.uid(), v_c.id,
    jsonb_build_object('release_id', p_release, 'amount', v_r.amount, 'released_on', p_released_on, 'document_id', p_document));
end; $$;
revoke all on function public.release_retention(uuid, date, text, uuid) from public, anon;
grant execute on function public.release_retention(uuid, date, text, uuid) to authenticated, service_role;

create or replace function public.cancel_retention_release(p_release uuid) returns void
  language plpgsql security definer set search_path = public as $$
declare v_r public.retention_releases; v_c public.progress_claims;
begin
  perform public.assert_is_active_member();
  select * into v_r from public.retention_releases r where r.id = p_release and r.org_id = public.auth_org_id();
  if not found then perform public.lock_retention_claim(null); end if;
  v_c := public.lock_retention_claim(v_r.claim_id);
  delete from public.retention_releases r where r.id = p_release;   -- the guard refuses a recorded one
  perform public.log_audit('retention_release.cancel', v_c.org_id, auth.uid(), v_c.id,
    jsonb_build_object('release_id', p_release, 'amount', v_r.amount));
end; $$;
revoke all on function public.cancel_retention_release(uuid) from public, anon;
grant execute on function public.cancel_retention_release(uuid) to authenticated, service_role;

-- FR-RET-020: per claim — retention, scheduled (all planned releases), released, held (retention less released).
create view public.claim_retention with (security_invoker = true) as
select pc.id as claim_id, pc.org_id, pc.project_id, pc.work_order_id, pc.retention_pct, pc.retention_amount,
       coalesce(sum(r.amount), 0)                                        as scheduled,
       coalesce(sum(r.amount) filter (where r.released_on is not null), 0) as released,
       pc.retention_amount - coalesce(sum(r.amount) filter (where r.released_on is not null), 0) as held
  from public.progress_claims pc
  left join public.retention_releases r on r.claim_id = pc.id
 group by pc.id;
grant select on public.claim_retention to authenticated, service_role;
