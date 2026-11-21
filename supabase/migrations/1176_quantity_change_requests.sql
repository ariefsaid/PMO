-- 1176_quantity_change_requests.sql — #2578: the request records, their files, the organisation limit, and raising / editing /
-- submitting / withdrawing a request. Approval, the client record and the decision are 1177; reads are 1178.
-- Spec: docs/specs/quantity-change-requests.spec.md (FR-QCR-004..010, 021, 023); AC-QCR-004..010, 022, 024.
-- Reversal: rollback/1176_quantity_change_requests_down.sql.
--   §1 organisations.quantity_change_limit (Admin only, audited before and after).
--   §2 quantity_change_requests / _lines / _events: clients read, only the functions write. `editor_ids` is the EDITOR SET
--      (everyone who ever changed the request) that approval separation of duties reads; `is_open` + a partial unique index make
--      "one open request per contract line" a database fact.
--   §3 quantity_change_request_files: typed file table in the procurement-file shape (0036/1027) + private bucket.
--   §4 qcr_raise / qcr_update_draft / qcr_submit / qcr_withdraw, under row locks (the request cap and the open-line rule
--      cannot be raced).

-- ── §1 the organisation limit ───────────────────────────────────────────────────────────────────────
alter table public.organizations add column quantity_change_limit integer
  constraint organizations_quantity_change_limit_check check (quantity_change_limit is null or quantity_change_limit >= 1);
comment on column public.organizations.quantity_change_limit is
  '#2578 / FR-QCR-021: maximum quantity change requests per work order; NULL = no limit. Admin-only, audited.';
create policy organizations_update_quantity_change_limit on public.organizations for update
  using (id = (select public.auth_org_id()) and (select public.is_active_member()) and (select public.auth_role()) = 'Admin')
  with check (id = (select public.auth_org_id()) and (select public.is_active_member()) and (select public.auth_role()) = 'Admin');
grant update (quantity_change_limit) on public.organizations to authenticated;

create function public.audit_org_quantity_change_limit() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if new.quantity_change_limit is distinct from old.quantity_change_limit then
    perform public.log_audit('org.quantity_change_limit.change', new.id, auth.uid(), new.id,
      jsonb_build_object('from', old.quantity_change_limit, 'to', new.quantity_change_limit));
  end if;
  return new;
end; $$;
revoke all on function public.audit_org_quantity_change_limit() from public, anon, authenticated;
create trigger organizations_audit_quantity_change_limit after update on public.organizations
  for each row execute function public.audit_org_quantity_change_limit();

-- ── §2 requests ─────────────────────────────────────────────────────────────────────────────────────
-- Note (FR-QCR-012 / plan M5 divergence): Entity changes are captured via dedicated append-only
-- quantity_change_request_events table instead of registration with record_history_config.
create table public.quantity_change_requests (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.organizations(id) default '00000000-0000-0000-0000-000000000001',
  project_id         uuid not null references public.projects(id),
  work_order_id      uuid not null references public.work_orders(id),
  client_request_id  uuid,
  status             text not null default 'draft' check (status in
    ('draft','pending_approval','returned','approved','sent_to_client','client_accepted','client_declined','withdrawn')),
  withdrawn_from     text check (withdrawn_from in ('draft','returned','approved')),
  note               text check (note is null or char_length(note) <= 1000),
  author_id          uuid not null references public.profiles(id),
  editor_ids         uuid[] not null,
  first_submitted_at timestamptz,
  submitted_by       uuid references public.profiles(id),
  submitted_at       timestamptz,
  approved_by        uuid references public.profiles(id),
  approved_at        timestamptz,
  returned_by        uuid references public.profiles(id),
  returned_at        timestamptz,
  return_reason      text check (return_reason is null or char_length(return_reason) <= 500),
  withdrawn_by       uuid references public.profiles(id),
  withdrawn_at       timestamptz,
  withdraw_reason    text check (withdraw_reason is null or char_length(withdraw_reason) <= 500),
  sent_date          date,
  client_reference   text check (client_reference is null or char_length(client_reference) <= 200),
  sent_by            uuid references public.profiles(id),
  sent_at            timestamptz,
  decision_date      date,
  decided_by         uuid references public.profiles(id),
  decided_at         timestamptz,
  decision_note      text check (decision_note is null or char_length(decision_note) <= 500),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint qcr_author_is_editor check (author_id = any (editor_ids)),
  constraint qcr_withdrawn_shape check ((status = 'withdrawn') = (withdrawn_from is not null and withdrawn_at is not null)),
  constraint qcr_approved_shape check (approved_by is null or approved_at is not null)
);
create unique index quantity_change_requests_client_request_idx on public.quantity_change_requests (org_id, client_request_id)
  where client_request_id is not null;
create index quantity_change_requests_wo_idx on public.quantity_change_requests (work_order_id, created_at desc, id desc);
create index quantity_change_requests_project_idx on public.quantity_change_requests (org_id, project_id, created_at desc, id desc);
create index quantity_change_requests_status_idx on public.quantity_change_requests (org_id, status);
create index quantity_change_requests_author_idx on public.quantity_change_requests (author_id);
create index quantity_change_requests_submitted_by_idx on public.quantity_change_requests (submitted_by);
create index quantity_change_requests_approved_by_idx on public.quantity_change_requests (approved_by);
create index quantity_change_requests_returned_by_idx on public.quantity_change_requests (returned_by);
create index quantity_change_requests_withdrawn_by_idx on public.quantity_change_requests (withdrawn_by);
create index quantity_change_requests_sent_by_idx on public.quantity_change_requests (sent_by);
create index quantity_change_requests_decided_by_idx on public.quantity_change_requests (decided_by);

create table public.quantity_change_request_lines (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.organizations(id) default '00000000-0000-0000-0000-000000000001',
  request_id         uuid not null references public.quantity_change_requests(id),
  boq_item_id        uuid not null references public.boq_items(id),
  requested_quantity numeric(14,3) not null check (requested_quantity > 0 and requested_quantity < 'Infinity'::numeric),
  reason             text not null check (char_length(btrim(reason)) between 1 and 500),
  trigger_kind       text not null check (trigger_kind in ('progress','forecast')),
  trigger_figure     numeric(14,3) not null,
  base_quantity      numeric(14,3) not null,
  base_version_no    integer not null,
  is_open            boolean not null default true,
  unique (request_id, boq_item_id)
);
create unique index quantity_change_request_lines_one_open_idx on public.quantity_change_request_lines (boq_item_id) where is_open;
create index quantity_change_request_lines_org_idx on public.quantity_change_request_lines (org_id);
create index quantity_change_request_lines_item_idx on public.quantity_change_request_lines (boq_item_id);

create table public.quantity_change_request_events (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) default '00000000-0000-0000-0000-000000000001',
  request_id  uuid not null references public.quantity_change_requests(id) on delete cascade,
  action      text not null,
  from_status text,
  to_status   text,
  actor_id    uuid references public.profiles(id) default auth.uid(),
  reason      text,
  created_at  timestamptz not null default clock_timestamp()
);
create index quantity_change_request_events_request_idx on public.quantity_change_request_events (request_id, created_at, id);
create index quantity_change_request_events_org_idx on public.quantity_change_request_events (org_id);
create index quantity_change_request_events_actor_idx on public.quantity_change_request_events (actor_id);

-- Versions point at the request that created them.
alter table public.boq_quantity_versions
  add constraint boq_quantity_versions_request_fkey foreign key (request_id) references public.quantity_change_requests(id);

do $$ declare t text; begin
  foreach t in array array['quantity_change_requests','quantity_change_request_lines','quantity_change_request_events'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format($p$create policy %I on public.%I for select using (
      org_id = (select public.auth_org_id()) and (select public.is_active_member())
      and (select public.auth_role()) in ('Admin','Executive','Project Manager','Finance'))$p$, t || '_select', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('create trigger %I before insert on public.%I for each row execute function public.stamp_org_id()', t || '_stamp_org_id', t);
  end loop;
end $$;

-- Events are history: nobody updates or removes one.
create function public.refuse_qcr_event_change() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  -- the one exception: the cascade that removes the request itself (nothing in the application deletes a request)
  if tg_op = 'DELETE' and not exists (select 1 from public.quantity_change_requests r where r.id = old.request_id) then
    return old;
  end if;
  raise exception 'change request history is append-only' using errcode = '42501';
end; $$;
revoke all on function public.refuse_qcr_event_change() from public, anon, authenticated;
create trigger quantity_change_request_events_immutable before update or delete on public.quantity_change_request_events
  for each row execute function public.refuse_qcr_event_change();

-- ── §3 files (procurement-file shape) ───────────────────────────────────────────────────────────────
create table public.quantity_change_request_files (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organizations(id) default '00000000-0000-0000-0000-000000000001',
  request_id        uuid not null references public.quantity_change_requests(id) on delete cascade,
  kind              text not null check (kind in ('supporting','sent_letter','client_response')),
  title             text,
  file_path         text not null,
  storage_object_id uuid not null default gen_random_uuid(),
  constraint quantity_change_request_files_storage_object_fkey foreign key (storage_object_id) references storage.objects(id) on delete restrict,
  uploaded_by_id    uuid references public.profiles(id) default auth.uid(),
  created_at        timestamptz not null default now(),
  archived_at       timestamptz
);
create index quantity_change_request_files_parent_idx on public.quantity_change_request_files (request_id, created_at desc) where archived_at is null;
create index quantity_change_request_files_storage_object_idx on public.quantity_change_request_files (storage_object_id);
create index quantity_change_request_files_org_idx on public.quantity_change_request_files (org_id);
create index quantity_change_request_files_uploader_idx on public.quantity_change_request_files (uploaded_by_id);
alter table public.quantity_change_request_files enable row level security;
alter table public.quantity_change_request_files force row level security;
revoke all on public.quantity_change_request_files from public, anon, authenticated;
grant select, insert, update on public.quantity_change_request_files to authenticated;

-- Which kind may be added while the request is in which status; the same states gate archiving.
create function public.qcr_file_kind_open(p_status text, p_kind text) returns boolean
  language sql immutable set search_path = pg_catalog as $$
  select case p_kind
           when 'supporting' then p_status in ('draft','returned','pending_approval','approved')
           when 'sent_letter' then p_status = 'approved'
           when 'client_response' then p_status = 'sent_to_client'
           else false end
$$;
revoke all on function public.qcr_file_kind_open(text, text) from public, anon, authenticated;
grant execute on function public.qcr_file_kind_open(text, text) to authenticated;

create function public.can_add_qcr_file(p_request uuid, p_kind text) returns boolean
  language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.quantity_change_requests r
     where r.id = p_request and r.org_id = public.auth_org_id() and public.is_active_member()
       and public.auth_role() in ('Admin','Executive','Project Manager','Finance')
       and public.qcr_file_kind_open(r.status, p_kind))
$$;
revoke all on function public.can_add_qcr_file(uuid, text) from public, anon;
grant execute on function public.can_add_qcr_file(uuid, text) to authenticated;

create policy quantity_change_request_files_select on public.quantity_change_request_files for select
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member())
         and (select public.auth_role()) in ('Admin','Executive','Project Manager','Finance'));
create policy quantity_change_request_files_insert on public.quantity_change_request_files for insert
  with check (org_id = (select public.auth_org_id()) and (select public.is_active_member())
              and (select public.can_add_qcr_file(request_id, kind)));
create policy quantity_change_request_files_update on public.quantity_change_request_files for update
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member())
         and (select public.auth_role()) in ('Admin','Executive','Project Manager','Finance'))
  with check (org_id = (select public.auth_org_id()));

create function public.guard_qcr_file() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid; v_status text; v_object_id uuid;
begin
  select r.org_id, r.status into v_org, v_status from public.quantity_change_requests r where r.id = new.request_id for update;
  if tg_op = 'UPDATE' then
    if (to_jsonb(new) - 'archived_at') is distinct from (to_jsonb(old) - 'archived_at') then
      raise exception 'only archiving a file is allowed' using errcode = '42501';
    end if;
    -- A file that a recorded step relies on stays: it can be archived only while its own step is still open.
    if new.archived_at is not null and old.archived_at is null and not public.qcr_file_kind_open(v_status, new.kind) then
      raise exception 'this file belongs to a step that is already recorded' using errcode = '42501';
    end if;
    if new.archived_at is null and old.archived_at is not null then
      raise exception 'an archived file cannot be restored' using errcode = '42501';
    end if;
    return new;
  end if;
  if new.org_id is null or new.org_id = '00000000-0000-0000-0000-000000000001'::uuid then new.org_id := v_org; end if;
  if new.org_id is distinct from v_org then raise exception 'request not in this org' using errcode = '42501'; end if;
  if auth.uid() is not null then
    if v_org is distinct from public.auth_org_id() then raise exception 'request not in this org' using errcode = '42501'; end if;
    new.uploaded_by_id := auth.uid();
    if new.file_path not like (new.org_id::text || '/' || new.request_id::text || '/' || new.id::text || '/%') then
      raise exception 'file object is missing or invalid' using errcode = '23514';
    end if;
  end if;
  select o.id into v_object_id from storage.objects o
   where o.bucket_id = 'quantity-change-files' and o.name = new.file_path order by o.created_at desc, o.id limit 1;
  if v_object_id is null then raise exception 'file object is missing or invalid' using errcode = '23514'; end if;
  new.storage_object_id := v_object_id;
  if new.archived_at is null and (select count(*) from public.quantity_change_request_files f
        where f.request_id = new.request_id and f.kind = new.kind and f.archived_at is null) >= 10 then
    raise exception 'a request holds at most 10 files of one kind' using errcode = '23514';
  end if;
  return new;
end; $$;
revoke all on function public.guard_qcr_file() from public, anon, authenticated;
create trigger quantity_change_request_files_stamp_org_id before insert on public.quantity_change_request_files
  for each row execute function public.stamp_org_id();
create trigger quantity_change_request_files_zz_guard before insert or update on public.quantity_change_request_files
  for each row execute function public.guard_qcr_file();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('quantity-change-files', 'quantity-change-files', false, 15728640,
          array['image/jpeg','image/png','image/webp','image/heic','application/pdf'])
  on conflict (id) do nothing;
-- The storage policies call a definer helper instead of reading the request table: a policy is planned for EVERY role that selects
-- from storage.objects, and a direct reference would demand table privileges that anon (rightly) does not hold.
create function public.qcr_file_object_access(p_name text) returns boolean
  language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.quantity_change_requests r
                  where r.id::text = split_part(p_name, '/', 2) and r.org_id = public.auth_org_id()
                    and split_part(p_name, '/', 1) = r.org_id::text
                    and public.is_active_member()
                    and public.auth_role() in ('Admin','Executive','Project Manager','Finance'))
$$;
-- anon needs EXECUTE only because the policy is planned for it too; for anon the answer is always false (no organisation, no member).
revoke all on function public.qcr_file_object_access(text) from public;
grant execute on function public.qcr_file_object_access(text) to anon, authenticated;
create policy storage_objects_qcr_file_read on storage.objects for select
  using (bucket_id = 'quantity-change-files' and (select auth.uid()) is not null
    and split_part(name, '/', 1) = (select public.auth_org_id())::text
    and array_length(string_to_array(name, '/'), 1) = 4
    and (select public.qcr_file_object_access(name)));
create policy storage_objects_qcr_file_write on storage.objects for insert
  with check (bucket_id = 'quantity-change-files' and (select auth.uid()) is not null
    and split_part(name, '/', 1) = (select public.auth_org_id())::text
    and array_length(string_to_array(name, '/'), 1) = 4
    and (select public.qcr_file_object_access(name)));
create policy storage_objects_qcr_orphan_delete on storage.objects for delete
  using (bucket_id = 'quantity-change-files' and (select public.is_active_member())
    and owner_id = (select auth.uid())::text
    and split_part(name, '/', 1) = (select public.auth_org_id())::text
    and not exists (select 1 from public.quantity_change_request_files f where f.storage_object_id = objects.id));

-- ── §4 the writers ──────────────────────────────────────────────────────────────────────────────────
create function public.qcr_log(p_request uuid, p_action text, p_from text, p_to text, p_reason text default null) returns void
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.quantity_change_request_events (org_id, request_id, action, from_status, to_status, actor_id, reason)
  select r.org_id, r.id, p_action, p_from, p_to, auth.uid(), p_reason from public.quantity_change_requests r where r.id = p_request;
end; $$;
revoke all on function public.qcr_log(uuid, text, text, text, text) from public, anon, authenticated;

-- Requests that count toward the work order's limit: all but a draft withdrawn BEFORE it was ever submitted (OD-QCR-4).
create function public.qcr_request_count(p_work_order uuid) returns integer
  language sql stable security definer set search_path = public, pg_temp as $$
  select count(*)::integer from public.quantity_change_requests r
   where r.work_order_id = p_work_order
     and not (r.status = 'withdrawn' and r.withdrawn_from = 'draft' and r.first_submitted_at is null)
$$;
revoke all on function public.qcr_request_count(uuid) from public, anon, authenticated;

-- Validate and snapshot the lines of one request. The contract lines are locked in id order, so two requests that touch
-- the same line serialise instead of deadlocking, and the figures read below cannot move under the check.
create function public.qcr_prepare_lines(p_org uuid, p_project uuid, p_work_order uuid, p_lines jsonb)
returns table (item_id uuid, req_qty numeric, line_reason text, kind text, figure numeric, base_qty numeric, base_version integer)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r record; v_item record; f record; v_kind text; v_figure numeric; v_version integer;
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'a change request needs at least one line' using errcode = '23502';
  end if;
  if exists (select 1 from jsonb_to_recordset(p_lines) as x(boq_item_id uuid, requested_quantity numeric, reason text)
              where x.boq_item_id is null or x.requested_quantity is null or nullif(btrim(x.reason), '') is null
                 or char_length(btrim(x.reason)) > 500) then
    raise exception 'each line needs a contract line, a requested quantity and a reason (up to 500 characters)' using errcode = '23502';
  end if;
  if (select count(*) from jsonb_to_recordset(p_lines) as x(boq_item_id uuid)) <>
     (select count(distinct x.boq_item_id) from jsonb_to_recordset(p_lines) as x(boq_item_id uuid)) then
    raise exception 'each contract line may appear once per request' using errcode = '23514';
  end if;
  for r in select x.boq_item_id as bid, x.requested_quantity as rq, btrim(x.reason) as rs
             from jsonb_to_recordset(p_lines) as x(boq_item_id uuid, requested_quantity numeric, reason text)
            order by x.boq_item_id loop
    select b.id, b.item_code, b.earning_basis, b.quantity into v_item
      from public.boq_items b where b.id = r.bid and b.project_id = p_project and b.org_id = p_org for update;
    if not found then
      raise exception 'contract line not found on this project' using errcode = 'P0002';
    end if;
    if not (r.rq > 0 and r.rq < 'Infinity'::numeric and r.rq = round(r.rq, 3)) then
      raise exception 'the requested quantity for % must be positive with at most 3 decimals', v_item.item_code using errcode = '23514';
    end if;
    if v_item.earning_basis = 'lump_sum' then
      raise exception '% is a lump-sum line: its quantity is fixed at one, so a value change is not a quantity change', v_item.item_code
        using errcode = '23514';
    end if;
    if not exists (select 1 from public.work_order_lines wl where wl.work_order_id = p_work_order and wl.boq_item_id = r.bid) then
      raise exception '% is not allocated to this work order', v_item.item_code using errcode = '23514';
    end if;
    if exists (select 1 from public.quantity_change_request_lines l where l.boq_item_id = r.bid and l.is_open) then
      raise exception '% already has an open quantity change request', v_item.item_code using errcode = '23505';
    end if;
    select * into f from public.qcr_figures(array[r.bid]);
    if not (f.over_progress or f.over_forecast) then
      raise exception '% is not over its contract quantity, so it cannot be raised', v_item.item_code using errcode = '23514';
    end if;
    v_kind := case when f.over_progress then 'progress' else 'forecast' end;
    v_figure := case when f.over_progress then f.progress_quantity else f.forecast_quantity end;
    if r.rq <= f.contract_quantity then
      raise exception 'the requested quantity for % (%) must be above the contract quantity (%)', v_item.item_code, r.rq, f.contract_quantity
        using errcode = '23514';
    end if;
    if r.rq < v_figure then
      raise exception 'the requested quantity for % (%) cannot be below the % figure (%)', v_item.item_code, r.rq, v_kind, v_figure
        using errcode = '23514';
    end if;
    select coalesce(max(v.version_no), 0) into v_version from public.boq_quantity_versions v where v.boq_item_id = r.bid;
    item_id := r.bid; req_qty := r.rq; line_reason := r.rs; kind := v_kind; figure := v_figure;
    base_qty := f.contract_quantity; base_version := v_version;
    return next;
  end loop;
end; $$;
revoke all on function public.qcr_prepare_lines(uuid, uuid, uuid, jsonb) from public, anon, authenticated;

create function public.qcr_raise(p_work_order_id uuid, p_client_request_id uuid, p_lines jsonb, p_note text default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid(); v_org uuid := public.auth_org_id(); v_wo record; v_limit integer; v_count integer; v_id uuid;
  v_existing record;
begin
  perform public.assert_is_active_member();
  if public.auth_role() not in ('Admin','Executive','Project Manager','Finance') then
    raise exception 'not authorized to raise a quantity change request' using errcode = '42501';
  end if;
  -- ⚑ the work order row is the lock: the cap check and the insert below run under it, so two simultaneous requests
  --   cannot both pass the count (FR-QCR-006).
  select w.id, w.org_id, w.project_id, w.status into v_wo from public.work_orders w where w.id = p_work_order_id for update;
  if not found or v_wo.org_id is distinct from v_org then
    raise exception 'work order not found' using errcode = 'P0002';
  end if;
  if p_client_request_id is not null then
    select r.id, r.work_order_id, r.author_id into v_existing from public.quantity_change_requests r
     where r.org_id = v_org and r.client_request_id = p_client_request_id;
    if found then
      if v_existing.work_order_id is distinct from p_work_order_id or v_existing.author_id is distinct from v_uid then
        raise exception 'this client request id was already used for another request' using errcode = '23505';
      end if;
      return v_existing.id;
    end if;
  end if;
  if v_wo.status in ('Closed','Cancelled') then
    raise exception 'a % work order cannot take a quantity change request', v_wo.status using errcode = 'P0001';
  end if;
  select o.quantity_change_limit into v_limit from public.organizations o where o.id = v_org;
  v_count := public.qcr_request_count(p_work_order_id);
  if v_limit is not null and v_count >= v_limit then
    raise exception 'this work order already has % quantity change requests; the limit is %', v_count, v_limit using errcode = 'P0001';
  end if;
  v_id := gen_random_uuid();
  insert into public.quantity_change_requests (id, org_id, project_id, work_order_id, client_request_id, note, author_id, editor_ids)
  values (v_id, v_org, v_wo.project_id, p_work_order_id, p_client_request_id, nullif(btrim(p_note), ''), v_uid, array[v_uid]);
  insert into public.quantity_change_request_lines (org_id, request_id, boq_item_id, requested_quantity, reason, trigger_kind,
                                                    trigger_figure, base_quantity, base_version_no)
  select v_org, v_id, l.item_id, l.req_qty, l.line_reason, l.kind, l.figure, l.base_qty, l.base_version
    from public.qcr_prepare_lines(v_org, v_wo.project_id, p_work_order_id, p_lines) l;
  perform public.qcr_log(v_id, 'raised', null, 'draft');
  return v_id;
end; $$;

-- Edit a draft (or reopen a returned request). The caller joins the EDITOR SET — that is what keeps them from approving it.
create function public.qcr_update_draft(p_request_id uuid, p_lines jsonb default null, p_note text default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_org uuid := public.auth_org_id(); v_req record; v_wo_status text;
begin
  perform public.assert_is_active_member();
  if public.auth_role() not in ('Admin','Executive','Project Manager','Finance') then
    raise exception 'not authorized to edit a quantity change request' using errcode = '42501';
  end if;
  select r.* into v_req from public.quantity_change_requests r where r.id = p_request_id for update;
  if not found or v_req.org_id is distinct from v_org then raise exception 'request not found' using errcode = 'P0002'; end if;
  if v_req.status not in ('draft','returned') then
    raise exception 'a % request can no longer be edited', v_req.status using errcode = 'P0001';
  end if;
  select w.status into v_wo_status from public.work_orders w where w.id = v_req.work_order_id for update;
  if v_wo_status in ('Closed','Cancelled') then
    raise exception 'a % work order cannot take a quantity change request', v_wo_status using errcode = 'P0001';
  end if;
  if p_lines is not null then
    delete from public.quantity_change_request_lines where request_id = p_request_id;
    insert into public.quantity_change_request_lines (org_id, request_id, boq_item_id, requested_quantity, reason, trigger_kind,
                                                      trigger_figure, base_quantity, base_version_no)
    select v_org, p_request_id, l.item_id, l.req_qty, l.line_reason, l.kind, l.figure, l.base_qty, l.base_version
      from public.qcr_prepare_lines(v_org, v_req.project_id, v_req.work_order_id, p_lines) l;
  end if;
  update public.quantity_change_requests
     set editor_ids = case when v_uid = any (editor_ids) then editor_ids else array_append(editor_ids, v_uid) end,
         note = case when p_note is null then note else nullif(btrim(p_note), '') end,
         status = 'draft', updated_at = now()
   where id = p_request_id;
  perform public.qcr_log(p_request_id, 'edited', v_req.status, 'draft');
end; $$;

create function public.qcr_submit(p_request_id uuid) returns void
  language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_org uuid := public.auth_org_id(); v_req record; v_wo_status text; r record;
begin
  perform public.assert_is_active_member();
  if public.auth_role() not in ('Admin','Executive','Project Manager','Finance') then
    raise exception 'not authorized to submit a quantity change request' using errcode = '42501';
  end if;
  select q.* into v_req from public.quantity_change_requests q where q.id = p_request_id for update;
  if not found or v_req.org_id is distinct from v_org then raise exception 'request not found' using errcode = 'P0002'; end if;
  if v_uid <> all (v_req.editor_ids) then
    raise exception 'only the author or an editor of this request can submit it' using errcode = '42501';
  end if;
  if v_req.status <> 'draft' then
    raise exception 'only a draft can be submitted; this request is %', v_req.status using errcode = 'P0001';
  end if;
  select w.status into v_wo_status from public.work_orders w where w.id = v_req.work_order_id;
  if v_wo_status in ('Closed','Cancelled') then
    raise exception 'a % work order cannot take a quantity change request', v_wo_status using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.quantity_change_request_lines l where l.request_id = p_request_id) then
    raise exception 'a change request needs at least one line' using errcode = '23502';
  end if;
  update public.quantity_change_requests
     set status = 'pending_approval', submitted_by = v_uid, submitted_at = now(),
         first_submitted_at = coalesce(first_submitted_at, now()), updated_at = now()
   where id = p_request_id;
  perform public.qcr_log(p_request_id, 'submitted', 'draft', 'pending_approval');
  -- Tell everyone who could approve it (never the people it is separated from).
  for r in select p.id from public.profiles p
            where p.org_id = v_org and p.role in ('Admin','Executive','Finance') and public.is_active_member(p.id)
              and p.id <> v_req.author_id and p.id <> v_uid and p.id <> all (v_req.editor_ids) loop
    perform public.notify_workflow_user(v_org, r.id, 'Quantity change request awaiting approval',
      'A quantity change request has been submitted for your approval.', 'info', 'quantity_change_request', p_request_id, 'Quantity change request');
  end loop;
end; $$;

-- Withdraw before the request reaches the client. The reason is required and the status it was withdrawn FROM is stamped:
-- the limit count cannot be answered from the terminal status alone (OD-QCR-4).
create function public.qcr_withdraw(p_request_id uuid, p_reason text) returns void
  language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_org uuid := public.auth_org_id(); v_req record;
begin
  perform public.assert_is_active_member();
  if public.auth_role() not in ('Admin','Executive','Project Manager','Finance') then
    raise exception 'not authorized to withdraw a quantity change request' using errcode = '42501';
  end if;
  if nullif(btrim(p_reason), '') is null or char_length(btrim(p_reason)) > 500 then
    raise exception 'a reason is required to withdraw a request (up to 500 characters)' using errcode = '23502';
  end if;
  select q.* into v_req from public.quantity_change_requests q where q.id = p_request_id for update;
  if not found or v_req.org_id is distinct from v_org then raise exception 'request not found' using errcode = 'P0002'; end if;
  if v_uid <> all (v_req.editor_ids) and public.auth_role() not in ('Admin','Executive','Finance') then
    raise exception 'only the author, an editor or an approver role can withdraw this request' using errcode = '42501';
  end if;
  if v_req.status not in ('draft','returned','approved') then
    raise exception 'a % request cannot be withdrawn', v_req.status using errcode = 'P0001';
  end if;
  update public.quantity_change_requests
     set status = 'withdrawn', withdrawn_from = v_req.status, withdrawn_by = v_uid, withdrawn_at = now(),
         withdraw_reason = btrim(p_reason), updated_at = now()
   where id = p_request_id;
  update public.quantity_change_request_lines set is_open = false where request_id = p_request_id;
  perform public.qcr_log(p_request_id, 'withdrawn', v_req.status, 'withdrawn', btrim(p_reason));
end; $$;

do $$ declare f text; begin
  foreach f in array array['qcr_raise(uuid,uuid,jsonb,text)','qcr_update_draft(uuid,jsonb,text)','qcr_submit(uuid)','qcr_withdraw(uuid,text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
