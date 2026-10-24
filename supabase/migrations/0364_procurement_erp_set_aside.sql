-- 0364 set aside unlinked ERP purchase documents as overhead + notes (#1319 AC-13; spec procurement-flexible-entry).
-- State lives in its own table keyed by the ERP document, so the mirror's upsert (which overwrites the document row)
-- never touches it. Writes go through one definer RPC (Admin/Finance); nothing is sent to ERPNext, nothing moves actuals.
-- Rollback: supabase/migrations/rollback/0364_procurement_erp_set_aside_down.sql

-- §1 The marks. A row exists while a document is set aside OR carries a note.
create table public.erp_purchase_document_marks (
  erp_purchase_document_id uuid primary key references public.erp_purchase_documents(id) on delete cascade,
  org_id        uuid not null references public.organizations(id) on delete cascade,
  set_aside_at  timestamptz,
  set_aside_by  uuid references public.profiles(id),
  note          text,
  updated_at    timestamptz not null default now(),
  updated_by    uuid references public.profiles(id),
  constraint erp_purchase_document_marks_note_len check (note is null or char_length(note) between 1 and 500),
  constraint erp_purchase_document_marks_not_empty check (set_aside_at is not null or note is not null)
);
create index erp_purchase_document_marks_org_idx on public.erp_purchase_document_marks (org_id);

-- org_id is stamped from the document, whatever the writer sends.
create function public.stamp_erp_purchase_document_mark_org() returns trigger
language plpgsql security definer set search_path = public, pg_catalog as $$
begin
  select d.org_id into new.org_id from public.erp_purchase_documents d where d.id = new.erp_purchase_document_id;
  return new;
end $$;
revoke all on function public.stamp_erp_purchase_document_mark_org() from public, anon, authenticated;
create trigger erp_purchase_document_marks_org before insert or update on public.erp_purchase_document_marks
  for each row execute function public.stamp_erp_purchase_document_mark_org();

alter table public.erp_purchase_document_marks enable row level security;
alter table public.erp_purchase_document_marks force row level security;
create policy erp_purchase_document_marks_select on public.erp_purchase_document_marks for select to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member())
         and (select public.auth_role()) in ('Admin','Executive','Project Manager','Finance'));
revoke all on public.erp_purchase_document_marks from anon, authenticated;
grant select on public.erp_purchase_document_marks to authenticated;

-- A document that gets linked stops being set aside (the note stays).
create function public.clear_erp_set_aside_on_link() returns trigger
language plpgsql security definer set search_path = public, pg_catalog as $$
begin
  update public.erp_purchase_document_marks set set_aside_at = null, set_aside_by = null, updated_by = null, updated_at = now()
   where erp_purchase_document_id = new.erp_purchase_document_id and set_aside_at is not null and note is not null;
  delete from public.erp_purchase_document_marks
   where erp_purchase_document_id = new.erp_purchase_document_id and set_aside_at is not null and note is null;
  return new;
end $$;
revoke all on function public.clear_erp_set_aside_on_link() from public, anon, authenticated;
create trigger procurement_erp_links_clear_set_aside after insert on public.procurement_erp_links
  for each row execute function public.clear_erp_set_aside_on_link();

-- §2 Read models. orphans = the default list (set-aside hidden, note shown); orphans_all adds the set-aside ones, flagged.
create view public.erp_purchase_orphans_all with (security_invoker = true) as
  select o.id, o.org_id, o.erp_doctype, o.erp_name, o.supplier, o.supplier_name, o.doc_date, o.due_date, o.bill_no, o.currency,
         o.grand_total, o.net_total, o.outstanding_amount, o.erp_status, o.is_return, o.erp_project, o.project_ids,
         (m.set_aside_at is not null) as set_aside, m.set_aside_at, m.note
    from public.erp_purchase_documents_linked o
    left join public.erp_purchase_document_marks m on m.erp_purchase_document_id = o.id
   where o.erp_docstatus = 1 and not o.pmo_owned and o.procurement_id is null;
create or replace view public.erp_purchase_orphans with (security_invoker = true) as
  select id, org_id, erp_doctype, erp_name, supplier, supplier_name, doc_date, due_date, bill_no, currency,
         grand_total, net_total, outstanding_amount, erp_status, is_return, erp_project, project_ids, note
    from public.erp_purchase_orphans_all
   where not set_aside;
revoke all on public.erp_purchase_orphans_all, public.erp_purchase_orphans from anon;
grant select on public.erp_purchase_orphans_all, public.erp_purchase_orphans to authenticated;

-- §3 Write path: set aside / undo / note, one or many, optional dry run. Admin and Finance only.
create function public.mark_erp_purchase_documents(p_rows jsonb, p_action text default 'set_aside', p_dry_run boolean default false)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_org uuid := public.auth_org_id();
  v_uid uuid := auth.uid();
  v_results jsonb := '[]'::jsonb;
  v_row jsonb; v_n integer := 0; v_matches integer;
  v_doc public.erp_purchase_documents%rowtype;
  v_mark public.erp_purchase_document_marks%rowtype;
  v_outcome text; v_reason text; v_has_note boolean; v_note text;
  v_aside_at timestamptz; v_aside_by uuid;
begin
  perform public.assert_is_active_member();
  if coalesce(public.auth_role()::text, '') not in ('Admin','Finance') then
    raise exception 'Only an Admin or Finance member can set ERP documents aside.' using errcode = '42501';
  end if;
  if p_action is null or p_action not in ('set_aside','undo','note') then
    raise exception 'Action must be set_aside, undo or note.' using errcode = '22023';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) not between 1 and 500 then
    raise exception 'Send 1 to 500 rows per call.' using errcode = '22023';
  end if;

  begin  -- a dry run is rolled back at the end of this block
    for v_row in select value from jsonb_array_elements(p_rows) loop
      v_n := v_n + 1;
      v_outcome := 'apply'; v_reason := null; v_doc := null; v_mark := null;
      begin  -- one row: a refusal rolls back this row only
        if jsonb_typeof(v_row) <> 'object' or coalesce(btrim(v_row->>'erp_name'), '') = '' then
          raise exception using errcode = 'PFE02', message = 'erp_name_missing';
        end if;
        select count(*) into v_matches from public.erp_purchase_documents d
         where d.org_id = v_org and d.erp_name = btrim(v_row->>'erp_name')
           and (nullif(btrim(v_row->>'erp_doctype'), '') is null or d.erp_doctype = btrim(v_row->>'erp_doctype'));
        if v_matches = 0 then raise exception using errcode = 'PFE02', message = 'document_not_found'; end if;
        if v_matches > 1 then raise exception using errcode = 'PFE02', message = 'document_ambiguous'; end if;
        select * into v_doc from public.erp_purchase_documents d
         where d.org_id = v_org and d.erp_name = btrim(v_row->>'erp_name')
           and (nullif(btrim(v_row->>'erp_doctype'), '') is null or d.erp_doctype = btrim(v_row->>'erp_doctype'))
         for update;
        if exists (select 1 from public.procurement_erp_links l where l.erp_purchase_document_id = v_doc.id) then
          raise exception using errcode = 'PFE02', message = 'document_linked';
        end if;
        if p_action = 'set_aside' then
          if v_doc.erp_docstatus <> 1 then raise exception using errcode = 'PFE02', message = 'document_cancelled'; end if;
          if v_doc.pmo_owned then raise exception using errcode = 'PFE02', message = 'document_recorded_by_pmo'; end if;
        end if;

        v_has_note := coalesce(jsonb_typeof(v_row->'note') in ('string','null'), false);
        if p_action = 'note' and not v_has_note then raise exception using errcode = 'PFE02', message = 'note_missing'; end if;
        if v_row ? 'note' and not v_has_note then raise exception using errcode = 'PFE02', message = 'note_invalid'; end if;
        v_note := nullif(btrim(v_row->>'note'), '');
        if char_length(coalesce(v_note, '')) > 500 then raise exception using errcode = 'PFE02', message = 'note_too_long'; end if;

        select * into v_mark from public.erp_purchase_document_marks where erp_purchase_document_id = v_doc.id for update;
        if not v_has_note then v_note := v_mark.note; end if;
        v_aside_at := v_mark.set_aside_at; v_aside_by := v_mark.set_aside_by;
        if p_action = 'set_aside' and v_aside_at is null then v_aside_at := now(); v_aside_by := v_uid;
        elsif p_action = 'undo' then v_aside_at := null; v_aside_by := null; end if;

        if v_aside_at is not distinct from v_mark.set_aside_at and v_note is not distinct from v_mark.note then
          v_outcome := 'skip'; v_reason := 'no_change';
        elsif v_aside_at is null and v_note is null then
          delete from public.erp_purchase_document_marks where erp_purchase_document_id = v_doc.id;
        else
          insert into public.erp_purchase_document_marks (erp_purchase_document_id, org_id, set_aside_at, set_aside_by, note, updated_by)
          values (v_doc.id, v_org, v_aside_at, v_aside_by, v_note, v_uid)
          on conflict (erp_purchase_document_id) do update
            set set_aside_at = excluded.set_aside_at, set_aside_by = excluded.set_aside_by, note = excluded.note,
                updated_at = now(), updated_by = excluded.updated_by;
        end if;
        if v_outcome = 'apply' then
          perform public.log_audit('procurement.erp_' || p_action, v_org, v_uid, v_doc.id,
            jsonb_build_object('erp_doctype', v_doc.erp_doctype, 'erp_name', v_doc.erp_name));
        end if;
      exception
        when sqlstate 'PFE02' then v_outcome := 'refused'; v_reason := sqlerrm;
        when others then v_outcome := 'refused'; v_reason := 'internal_error';
          raise log 'mark_erp_purchase_documents row %: % %', v_n, sqlstate, sqlerrm;
      end;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'row', v_n, 'erp_doctype', v_doc.erp_doctype, 'erp_name', coalesce(v_doc.erp_name, v_row->>'erp_name'),
        'outcome', v_outcome, 'reason', v_reason));
    end loop;
    if p_dry_run then raise exception using errcode = 'PFE01', message = 'dry run'; end if;
  exception when sqlstate 'PFE01' then null;
  end;
  return jsonb_build_object(
    'dry_run', p_dry_run, 'action', p_action,
    'counts', jsonb_build_object(
      'apply',   (select count(*) from jsonb_array_elements(v_results) r where r->>'outcome' = 'apply'),
      'skip',    (select count(*) from jsonb_array_elements(v_results) r where r->>'outcome' = 'skip'),
      'refused', (select count(*) from jsonb_array_elements(v_results) r where r->>'outcome' = 'refused')),
    'results', v_results);
end $$;
revoke all on function public.mark_erp_purchase_documents(jsonb, text, boolean) from public, anon;
grant execute on function public.mark_erp_purchase_documents(jsonb, text, boolean) to authenticated;

-- §4 API-client guard: 0363's body plus an Admin/Finance tier for the mark RPC and the include-set-aside view.
-- Lines marked 0364 are new.
create or replace function public.api_client_request_guard()
  returns void
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  -- API CLIENT SURFACE — keep in step with scripts/pmo.mjs.
  write_tables constant text[] := array['projects', 'project_milestones', 'tasks', 'meetings', 'crm_activities', 'companies', 'contacts'];
  read_only_tables constant text[] := array['profiles', 'external_domain_ownership'];
  rpcs constant text[] := array['get_project_milestones'];
  -- ACTIVE-ADMIN TIER (`pmo load`, #796) — keep in step with scripts/pmo.mjs LOAD_TABLES / LOAD_RPCS.
  admin_write_tables constant text[] := array['budget_versions', 'budget_line_items', 'boq_items'];
  admin_rpcs constant text[] := array['set_project_contract_value', 'transition_project'];
  -- PROCUREMENT-WRITER TIER (`pmo purchases`, #1319) — keep in step with scripts/lib/pmo-purchases.mjs.
  purchase_rpcs constant text[] := array['link_erp_purchase_documents', 'link_procurement_sharepoint_item'];
  purchase_read_views constant text[] := array['erp_purchase_orphans', 'erp_purchase_orphans_all'];  -- 0364
  -- ADMIN/FINANCE TIER (`pmo purchases set-aside`, #1319 AC-13)  -- 0364
  set_aside_rpcs constant text[] := array['mark_erp_purchase_documents'];  -- 0364
  claims jsonb := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  headers jsonb := coalesce(nullif(current_setting('request.headers', true), '')::jsonb, '{}'::jsonb);
  method text := current_setting('request.method', true);
  path text := coalesce(current_setting('request.path', true), '');
  target text;
begin
  if claims is null or not (claims ? 'client_id') then
    return; -- not an OAuth API client: nothing to decide here
  end if;

  if coalesce(headers ->> 'accept-profile', 'public') <> 'public'
     or coalesce(headers ->> 'content-profile', 'public') <> 'public' then
    raise exception using errcode = '42501',
      message = 'OAuth API clients may use the public schema only';
  end if;

  -- `Prefer: resolution=merge-duplicates|ignore-duplicates` turns a POST into an upsert (an UPDATE on
  -- conflict), which would let a POST-only grant edit rows. The CLI never sends it; refuse it everywhere.
  if coalesce(headers ->> 'prefer', '') ilike '%resolution=%' then
    raise exception using errcode = '42501',
      message = 'OAuth API clients may not upsert (Prefer: resolution=)';
  end if;

  if path like '/rpc/%' then
    target := substr(path, 6);
    if method = 'POST' and target = any (rpcs) then
      return;
    end if;
    if method = 'POST' and target = any (admin_rpcs) then
      if coalesce(public.auth_role() = 'Admin'::public.user_role and public.is_active_member(), false) then
        return;
      end if;
    end if;
    if method = 'POST' and target = any (purchase_rpcs) then
      if coalesce(public.auth_role()::text in ('Admin', 'Executive', 'Project Manager', 'Finance') and public.is_active_member(), false) then
        return;
      end if;
    end if;
    if method = 'POST' and target = any (set_aside_rpcs) then  -- 0364
      if coalesce(public.auth_role()::text in ('Admin', 'Finance') and public.is_active_member(), false) then  -- 0364
        return;  -- 0364
      end if;  -- 0364
    end if;  -- 0364
  else
    target := substr(path, 2); -- exact table name; anything longer matches no list entry
    if method = 'GET' and (target = any (write_tables) or target = any (read_only_tables)) then
      return;
    end if;
    if method in ('POST', 'PATCH') and target = any (write_tables) then
      return;
    end if;
    if method in ('GET', 'POST') and target = any (admin_write_tables) then
      if coalesce(public.auth_role() = 'Admin'::public.user_role and public.is_active_member(), false) then
        return;
      end if;
    end if;
    if method = 'GET' and target = any (purchase_read_views) then
      if coalesce(public.auth_role()::text in ('Admin', 'Executive', 'Project Manager', 'Finance') and public.is_active_member(), false) then
        return;
      end if;
    end if;
  end if;

  raise exception using errcode = '42501',
    message = format('%s %s is not available to OAuth API clients', method, path),
    hint = 'The API client surface is documented in docs/runbooks/pmo-cli.md';
end;
$$;

revoke all on function public.api_client_request_guard() from public;
grant execute on function public.api_client_request_guard() to anon, authenticated, service_role;
notify pgrst, 'reload config';
