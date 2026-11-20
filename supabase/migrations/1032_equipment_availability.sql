-- 1032_equipment_availability.sql — #2526 slice 2a: ownership + rental terms, daily status with history, downtime
-- proof, the org working-hours setting. Spec: docs/specs/equipment-availability.spec.md; plan
-- docs/plans/2026-11-20-equipment-availability.md. Proven by supabase/tests/equipment_status.test.sql.
-- Reads/derivations are 1033 (metrics, downtime runs, escalation); the rental invoice check is 1034 (money, ships alone).
-- Writes are RPC-only (no INSERT/UPDATE grant) so the date rules, role gates and history cannot be bypassed.
-- Reverse: rollback/1032_equipment_availability_down.sql

-- ── asset ownership and in-service date. Written only by set_equipment_ownership (not in the 0447 column grants). ──
alter table public.equipment_assets
  add column ownership     text not null default 'owned' check (ownership in ('owned','rented')),
  add column in_service_on date;

-- ── organisation working hours per day (OQ-EAV-2 default 8): the utilisation denominator ──
alter table public.organizations
  add column equipment_working_hours numeric(4,2) not null default 8
    check (equipment_working_hours > 0 and equipment_working_hours <= 24);

-- ── rental terms: effective-dated, disjoint per asset (FR-EAV-001..003) ──
create table public.equipment_rental_terms (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  asset_id    uuid not null references public.equipment_assets(id) on delete restrict,
  vendor_id   uuid not null references public.companies(id) on delete restrict,
  rate        numeric(14,2) not null check (rate > 0),
  basis       text not null check (basis in ('day','month')),
  currency    text not null check (currency ~ '^[A-Z]{3}$'),
  rented_from date not null,
  rented_to   date,
  created_by  uuid references public.profiles(id) default auth.uid(),
  created_at  timestamptz not null default now(),
  constraint equipment_rental_terms_range check (rented_to is null or rented_to >= rented_from)
);
create index equipment_rental_terms_asset on public.equipment_rental_terms (org_id, asset_id, rented_from);
create index equipment_rental_terms_vendor on public.equipment_rental_terms (vendor_id);
create trigger equipment_rental_terms_stamp_org_id before insert on public.equipment_rental_terms
  for each row execute function public.stamp_org_id();

-- AC-EAV-006: periods of one asset never overlap. Serialised per asset so two concurrent saves cannot both pass.
create function public.equipment_rental_terms_no_overlap() returns trigger
  language plpgsql set search_path = public, pg_temp as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.asset_id::text, 2526));
  if exists (select 1 from public.equipment_rental_terms t
              where t.asset_id = new.asset_id and t.id <> new.id
                and t.rented_from <= coalesce(new.rented_to, 'infinity'::date)
                and new.rented_from <= coalesce(t.rented_to, 'infinity'::date)) then
    raise exception 'rental periods of one asset cannot overlap' using errcode = '23P01';
  end if;
  return new;
end $$;
revoke all on function public.equipment_rental_terms_no_overlap() from public, anon, authenticated;
create trigger equipment_rental_terms_no_overlap before insert or update on public.equipment_rental_terms
  for each row execute function public.equipment_rental_terms_no_overlap();

-- ── daily status (FR-EAV-004/005) and its history ──
create table public.equipment_status_days (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  asset_id    uuid not null references public.equipment_assets(id) on delete restrict,
  status_date date not null,
  status      text not null check (status in ('ready','standby','broken','at_vendor','waiting_parts')),
  note        text check (note is null or char_length(note) <= 500),
  set_by      uuid references public.profiles(id) default auth.uid(),
  set_at      timestamptz not null default now(),
  constraint equipment_status_one_per_day unique (asset_id, status_date)
);
create index equipment_status_org_date on public.equipment_status_days (org_id, status_date);

create table public.equipment_status_history (
  id          bigint generated always as identity primary key,
  org_id      uuid not null references public.organizations(id) on delete cascade,
  asset_id    uuid not null references public.equipment_assets(id) on delete cascade,
  status_date date not null,
  old_status  text,
  new_status  text not null,
  note        text,
  actor_id    uuid default auth.uid(),
  changed_at  timestamptz not null default now()
);
create index equipment_status_history_asset on public.equipment_status_history (asset_id, status_date, id);

create function public.equipment_status_record_history() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status and new.note is not distinct from old.note then
    return new;
  end if;
  insert into public.equipment_status_history (org_id, asset_id, status_date, old_status, new_status, note, actor_id)
  values (new.org_id, new.asset_id, new.status_date, case when tg_op = 'UPDATE' then old.status end, new.status, new.note, auth.uid());
  return new;
end $$;
revoke all on function public.equipment_status_record_history() from public, anon, authenticated;
create trigger equipment_status_days_history after insert or update on public.equipment_status_days
  for each row execute function public.equipment_status_record_history();

-- ── downtime proof (FR-EAV-007): a file in the private bucket, tied to a status date inside a downtime period ──
create table public.equipment_downtime_proofs (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  asset_id    uuid not null references public.equipment_assets(id) on delete restrict,
  proof_date  date not null,
  file_name   text not null check (char_length(btrim(file_name)) between 1 and 200 and file_name !~ '[/\\]'),
  file_path   text not null,
  note        text check (note is null or char_length(note) <= 500),
  uploaded_by uuid references public.profiles(id) default auth.uid(),
  created_at  timestamptz not null default now()
);
create index equipment_downtime_proofs_asset on public.equipment_downtime_proofs (asset_id, proof_date);
create index equipment_downtime_proofs_org on public.equipment_downtime_proofs (org_id);

-- one notice per downtime period per day (FR-EAV-009, OQ-EAV-4 default: repeat daily while still down)
create table public.equipment_escalation_log (
  org_id       uuid not null references public.organizations(id) on delete cascade,
  asset_id     uuid not null references public.equipment_assets(id) on delete cascade,
  period_start date not null,
  sent_on      date not null,
  down_days    int  not null,
  created_at   timestamptz not null default now(),
  primary key (asset_id, period_start, sent_on)
);
create index equipment_escalation_log_org on public.equipment_escalation_log (org_id);

-- ── RLS: reads by audience, no client write grant ──
alter table public.equipment_rental_terms enable row level security;      alter table public.equipment_rental_terms force row level security;
alter table public.equipment_status_days enable row level security;      alter table public.equipment_status_days force row level security;
alter table public.equipment_status_history enable row level security;   alter table public.equipment_status_history force row level security;
alter table public.equipment_downtime_proofs enable row level security;  alter table public.equipment_downtime_proofs force row level security;
alter table public.equipment_escalation_log enable row level security;   alter table public.equipment_escalation_log force row level security;

create policy equipment_status_days_select on public.equipment_status_days for select
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()));
create policy equipment_status_history_select on public.equipment_status_history for select
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()));
create policy equipment_downtime_proofs_select on public.equipment_downtime_proofs for select
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()));
-- rates are money: the approval audience reads them (matches EQUIPMENT_APPROVE on the client)
create policy equipment_rental_terms_select on public.equipment_rental_terms for select
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member())
         and (select public.auth_role()) in ('Admin','Finance','Executive','Project Manager'));
-- the escalation log has no client policy: read only by the definer jobs

revoke all on public.equipment_rental_terms, public.equipment_status_days, public.equipment_status_history,
  public.equipment_downtime_proofs, public.equipment_escalation_log from public, anon, authenticated;
grant select on public.equipment_rental_terms, public.equipment_status_days, public.equipment_status_history,
  public.equipment_downtime_proofs to authenticated;
grant all on public.equipment_rental_terms, public.equipment_status_days, public.equipment_status_history,
  public.equipment_downtime_proofs, public.equipment_escalation_log to service_role;

-- ── roles. Mirrored by pmo-portal/src/auth/policy.ts (UX only; these are the authority). ──
-- status + proof: the field role (Engineer) and the managers; terms/ownership: money roles.
create function public.equipment_can_set_status(p_role public.user_role) returns boolean
  language sql immutable set search_path = public, pg_temp as $$
  select coalesce(p_role in ('Admin','Project Manager','Engineer'), false) $$;
create function public.equipment_can_edit_terms(p_role public.user_role) returns boolean
  language sql immutable set search_path = public, pg_temp as $$
  select coalesce(p_role in ('Admin','Finance'), false) $$;
revoke all on function public.equipment_can_set_status(public.user_role), public.equipment_can_edit_terms(public.user_role)
  from public, anon, authenticated;

-- ── set_equipment_ownership (FR-EAV-001) ──
create function public.set_equipment_ownership(p_asset uuid, p_ownership text, p_in_service_on date default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid := public.auth_org_id();
begin
  perform public.assert_is_active_member();
  if public.auth_role() not in ('Admin','Project Manager','Finance') then raise exception 'not authorized' using errcode = '42501'; end if;
  if p_ownership is null or p_ownership not in ('owned','rented') then raise exception 'ownership must be owned or rented' using errcode = '22023'; end if;
  if p_ownership = 'rented' and not exists (select 1 from public.equipment_rental_terms t where t.asset_id = p_asset and t.org_id = v_org) then
    raise exception 'a rented asset needs a rental period' using errcode = '22023';
  end if;
  if p_ownership = 'owned' and exists (select 1 from public.equipment_rental_terms t where t.asset_id = p_asset and t.org_id = v_org) then
    raise exception 'an asset with rental periods stays rented' using errcode = '22023';
  end if;
  if p_in_service_on is not null and exists (select 1 from public.equipment_status_days d where d.org_id = v_org and d.asset_id = p_asset and d.status_date < p_in_service_on) then
    raise exception 'in-service date follows an existing status' using errcode = '22023';
  end if;
  update public.equipment_assets a set ownership = p_ownership, in_service_on = p_in_service_on
   where a.id = p_asset and a.org_id = v_org;
  if not found then raise exception 'asset not found' using errcode = 'P0002'; end if;
  perform public.log_audit('equipment_asset.ownership', v_org, auth.uid(), p_asset,
    jsonb_build_object('ownership', p_ownership, 'in_service_on', p_in_service_on));
end $$;

-- ── rental terms: add a period, change the rate from a date, end a period (FR-EAV-001..003, AC-EAV-006/007) ──
create function public.save_equipment_rental_term(p_term jsonb) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_org uuid := public.auth_org_id(); v_asset uuid; v_vendor uuid; v_rate numeric; v_basis text; v_cur text;
  v_from date; v_to date; v_id uuid;
begin
  perform public.assert_is_active_member();
  if not public.equipment_can_edit_terms(public.auth_role()) then raise exception 'not authorized' using errcode = '42501'; end if;
  if p_term is null or jsonb_typeof(p_term) <> 'object' then raise exception 'term must be a JSON object' using errcode = '22023'; end if;
  begin
    v_asset := (p_term->>'asset_id')::uuid; v_vendor := (p_term->>'vendor_id')::uuid; v_rate := (p_term->>'rate')::numeric;
    v_from := (p_term->>'rented_from')::date; v_to := nullif(p_term->>'rented_to','')::date;
  exception when others then raise exception 'asset, vendor, rate or dates are malformed' using errcode = '22023';
  end;
  v_basis := p_term->>'basis'; v_cur := upper(coalesce(p_term->>'currency',''));
  if v_vendor is null or v_rate is null then raise exception 'a rented asset needs a vendor and a rate' using errcode = '22023'; end if;
  if v_rate::text in ('NaN','Infinity') or v_rate <= 0 or round(v_rate, 2) <> v_rate then raise exception 'rate must be positive with at most 2 decimals' using errcode = '22023'; end if;
  if v_basis is null or v_basis not in ('day','month') then raise exception 'basis must be day or month' using errcode = '22023'; end if;
  if v_cur !~ '^[A-Z]{3}$' then raise exception 'currency must be a 3-letter code' using errcode = '22023'; end if;
  if v_from is null or (v_to is not null and v_to < v_from) then raise exception 'the rental period is invalid' using errcode = '22023'; end if;
  if not exists (select 1 from public.equipment_assets a where a.id = v_asset and a.org_id = v_org and a.archived_at is null) then
    raise exception 'asset not found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.companies c where c.id = v_vendor and c.org_id = v_org) then
    raise exception 'vendor not found' using errcode = 'P0002';   -- SECURITY: the org re-assertion MUST stay
  end if;
  insert into public.equipment_rental_terms (org_id, asset_id, vendor_id, rate, basis, currency, rented_from, rented_to)
  values (v_org, v_asset, v_vendor, v_rate, v_basis, v_cur, v_from, v_to) returning id into v_id;   -- 23P01 on overlap
  update public.equipment_assets set ownership = 'rented' where id = v_asset and ownership <> 'rented';
  perform public.log_audit('equipment_rental.create', v_org, auth.uid(), v_id, jsonb_build_object('asset_id', v_asset, 'vendor_id', v_vendor,
    'rate', v_rate, 'basis', v_basis, 'currency', v_cur, 'from', v_from, 'to', v_to));
  return v_id;
end $$;

-- AC-EAV-007: a rate change ends the open term the day before and starts a new one; the earlier term keeps its rate.
create function public.change_equipment_rental_rate(p_asset uuid, p_effective_on date, p_new_rate numeric) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid := public.auth_org_id(); v_cur public.equipment_rental_terms; v_id uuid;
begin
  perform public.assert_is_active_member();
  if not public.equipment_can_edit_terms(public.auth_role()) then raise exception 'not authorized' using errcode = '42501'; end if;
  if p_new_rate is null or p_new_rate::text in ('NaN','Infinity') or p_new_rate <= 0 or round(p_new_rate, 2) <> p_new_rate then
    raise exception 'rate must be positive with at most 2 decimals' using errcode = '22023';
  end if;
  select * into v_cur from public.equipment_rental_terms t
   where t.asset_id = p_asset and t.org_id = v_org and t.rented_from <= p_effective_on and (t.rented_to is null or t.rented_to >= p_effective_on)
   for update;
  if not found then raise exception 'no rental period covers that date' using errcode = 'P0002'; end if;
  if p_effective_on = v_cur.rented_from then raise exception 'the rate change must start after the period starts' using errcode = '22023'; end if;
  update public.equipment_rental_terms set rented_to = p_effective_on - 1 where id = v_cur.id;
  insert into public.equipment_rental_terms (org_id, asset_id, vendor_id, rate, basis, currency, rented_from, rented_to)
  values (v_org, v_cur.asset_id, v_cur.vendor_id, p_new_rate, v_cur.basis, v_cur.currency, p_effective_on, v_cur.rented_to)
  returning id into v_id;
  perform public.log_audit('equipment_rental.rate_change', v_org, auth.uid(), v_id,
    jsonb_build_object('asset_id', p_asset, 'effective_on', p_effective_on, 'old_rate', v_cur.rate, 'new_rate', p_new_rate));
  return v_id;
end $$;

create function public.end_equipment_rental_term(p_id uuid, p_to date) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid := public.auth_org_id(); v_t public.equipment_rental_terms;
begin
  perform public.assert_is_active_member();
  if not public.equipment_can_edit_terms(public.auth_role()) then raise exception 'not authorized' using errcode = '42501'; end if;
  select * into v_t from public.equipment_rental_terms t where t.id = p_id and t.org_id = v_org for update;
  if not found then raise exception 'rental period not found' using errcode = 'P0002'; end if;
  if p_to is null or p_to < v_t.rented_from then raise exception 'the end precedes the start' using errcode = '22023'; end if;
  update public.equipment_rental_terms set rented_to = p_to where id = p_id;
  perform public.log_audit('equipment_rental.end', v_org, auth.uid(), p_id, jsonb_build_object('before', v_t.rented_to, 'after', p_to));
end $$;

-- ── set_equipment_status (FR-EAV-004/005, AC-EAV-005): date rules in the database ──
create function public.equipment_set_status_core(p_asset uuid, p_date date, p_status text, p_note text) returns void
language plpgsql set search_path = public, pg_temp as $$
declare v_org uuid := public.auth_org_id(); v_in date; v_note text := nullif(btrim(coalesce(p_note,'')), '');
begin
  if p_status is null or p_status not in ('ready','standby','broken','at_vendor','waiting_parts') then
    raise exception 'status must be ready, standby, broken, at_vendor or waiting_parts' using errcode = '22023';
  end if;
  if v_note is not null and char_length(v_note) > 500 then raise exception 'the note is at most 500 characters' using errcode = '22023'; end if;
  if p_date is null or p_date > public.equipment_org_today(v_org) then raise exception 'the status date is in the future' using errcode = '22023'; end if;
  select a.in_service_on into v_in from public.equipment_assets a where a.id = p_asset and a.org_id = v_org and a.archived_at is null;
  if not found then raise exception 'asset not found' using errcode = 'P0002'; end if;   -- SECURITY: the org re-assertion MUST stay
  if v_in is not null and p_date < v_in then raise exception 'the status date precedes the asset''s in-service date' using errcode = '22023'; end if;
  insert into public.equipment_status_days (org_id, asset_id, status_date, status, note)
  values (v_org, p_asset, p_date, p_status, v_note)
  on conflict (asset_id, status_date) do update set status = excluded.status, note = excluded.note, set_by = auth.uid(), set_at = now();
end $$;
revoke all on function public.equipment_set_status_core(uuid, date, text, text) from public, anon, authenticated;

create function public.set_equipment_status(p_asset uuid, p_date date, p_status text, p_note text default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.assert_is_active_member();
  if not public.equipment_can_set_status(public.auth_role()) then raise exception 'not authorized' using errcode = '42501'; end if;
  perform public.equipment_set_status_core(p_asset, p_date, p_status, p_note);
end $$;

-- FR-EAV-008: the bulk "set today's status" screen; [{asset_id, status, note}] for one date, all or nothing
create function public.set_equipment_status_bulk(p_date date, p_items jsonb) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_i jsonb; v_n int := 0;
begin
  perform public.assert_is_active_member();
  if not public.equipment_can_set_status(public.auth_role()) then raise exception 'not authorized' using errcode = '42501'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 200 then
    raise exception 'items must be an array of at most 200' using errcode = '22023';
  end if;
  for v_i in select * from jsonb_array_elements(p_items) loop
    perform public.equipment_set_status_core((v_i->>'asset_id')::uuid, p_date, v_i->>'status', v_i->>'note');
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- ── downtime proof (FR-EAV-007): registers the file row; the client then uploads to the returned path ──
create function public.add_equipment_downtime_proof(p_asset uuid, p_proof_date date, p_file_name text, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid := public.auth_org_id(); v_id uuid := gen_random_uuid(); v_name text := btrim(coalesce(p_file_name,'')); v_st text;
begin
  perform public.assert_is_active_member();
  if not public.equipment_can_set_status(public.auth_role()) then raise exception 'not authorized' using errcode = '42501'; end if;
  if char_length(v_name) not between 1 and 200 or v_name ~ '[/\\]' then raise exception 'file name is invalid' using errcode = '22023'; end if;
  if not exists (select 1 from public.equipment_assets a where a.id = p_asset and a.org_id = v_org) then
    raise exception 'asset not found' using errcode = 'P0002';
  end if;
  select s.status into v_st from public.equipment_status_days s where s.asset_id = p_asset and s.org_id = v_org and s.status_date = p_proof_date;
  if v_st is null or v_st in ('ready','standby') then raise exception 'proof attaches to a down day' using errcode = '22023'; end if;
  insert into public.equipment_downtime_proofs (id, org_id, asset_id, proof_date, file_name, file_path, note)
  values (v_id, v_org, p_asset, p_proof_date, v_name, v_org::text || '/' || p_asset::text || '/' || v_id::text || '/' || v_name, nullif(btrim(coalesce(p_note,'')), ''));
  return jsonb_build_object('id', v_id, 'path', v_org::text || '/' || p_asset::text || '/' || v_id::text || '/' || v_name);
end $$;

-- ── private bucket (5 MB) at {org}/{asset}/{proof}/{file}; read = org member with the proof row visible; write = status roles ──
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('equipment-proof', 'equipment-proof', false, 5242880, array['application/pdf', 'image/png', 'image/jpeg', 'image/webp'])
  on conflict (id) do nothing;
create policy storage_objects_equipment_proof_read on storage.objects for select to authenticated
  using (bucket_id = 'equipment-proof' and (select auth.uid()) is not null
         and split_part(name, '/', 1) = (select public.auth_org_id())::text
         and array_length(string_to_array(name, '/'), 1) = 4
         and exists (select 1 from public.equipment_downtime_proofs p where p.id::text = split_part(name, '/', 3)));
create policy storage_objects_equipment_proof_write on storage.objects for insert to authenticated
  with check (bucket_id = 'equipment-proof' and (select auth.uid()) is not null
         and split_part(name, '/', 1) = (select public.auth_org_id())::text
         and array_length(string_to_array(name, '/'), 1) = 4
         and (select public.is_active_member())
         and (select public.auth_role()) in ('Admin','Project Manager','Engineer')
         and exists (select 1 from public.equipment_downtime_proofs p
                      where p.id::text = split_part(name, '/', 3) and p.org_id = (select public.auth_org_id()) and p.file_path = name));

-- ── working hours (OQ-EAV-2) ──
create function public.set_equipment_working_hours(p_hours numeric) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.assert_is_active_member();
  if public.auth_role() <> 'Admin' then raise exception 'not authorized' using errcode = '42501'; end if;
  if p_hours is null or p_hours <= 0 or p_hours > 24 or round(p_hours, 2) <> p_hours then raise exception 'working hours must be between 0 and 24' using errcode = '22023'; end if;
  update public.organizations set equipment_working_hours = p_hours where id = public.auth_org_id();
end $$;

alter function public.set_equipment_ownership(uuid, text, date) owner to postgres;
alter function public.save_equipment_rental_term(jsonb) owner to postgres;
alter function public.change_equipment_rental_rate(uuid, date, numeric) owner to postgres;
alter function public.end_equipment_rental_term(uuid, date) owner to postgres;
alter function public.set_equipment_status(uuid, date, text, text) owner to postgres;
alter function public.set_equipment_status_bulk(date, jsonb) owner to postgres;
alter function public.add_equipment_downtime_proof(uuid, date, text, text) owner to postgres;
alter function public.set_equipment_working_hours(numeric) owner to postgres;
revoke all on function public.set_equipment_ownership(uuid, text, date), public.save_equipment_rental_term(jsonb),
  public.change_equipment_rental_rate(uuid, date, numeric), public.end_equipment_rental_term(uuid, date),
  public.set_equipment_status(uuid, date, text, text), public.set_equipment_status_bulk(date, jsonb),
  public.add_equipment_downtime_proof(uuid, date, text, text), public.set_equipment_working_hours(numeric) from public, anon, authenticated;
grant execute on function public.set_equipment_ownership(uuid, text, date), public.save_equipment_rental_term(jsonb),
  public.change_equipment_rental_rate(uuid, date, numeric), public.end_equipment_rental_term(uuid, date),
  public.set_equipment_status(uuid, date, text, text), public.set_equipment_status_bulk(date, jsonb),
  public.add_equipment_downtime_proof(uuid, date, text, text), public.set_equipment_working_hours(numeric) to authenticated;

-- ── self-assertion: internals stay internal; nothing here is executable by anon or PUBLIC ──
do $$
declare v_bad text;
begin
  select string_agg(p.oid::regprocedure::text, ', ') into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('equipment_set_status_core','equipment_can_set_status','equipment_can_edit_terms','equipment_rental_terms_no_overlap','equipment_status_record_history')
     and (p.prosecdef and p.proname not in ('equipment_status_record_history') or has_function_privilege('authenticated', p.oid, 'execute'));
  if v_bad is not null then raise exception '1032: internal helper is a definer or client-executable: %', v_bad; end if;
end $$;
