-- 0871 #2195 B1: an active Admin places ERP invoices that carry no ERP project, or sets them aside as overhead.
-- This step holds the persisted decision table and the Admin-only entry point (preview only). Nothing here
-- writes to the ERP. Rollback arrives with the undo work: supabase/migrations/rollback/0871_capture_invoice_assignment_down.sql

-- §1 One row per decision; the row is the audit record.
create table public.erp_capture_invoice_assignments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  binding_id uuid not null references public.external_org_bindings(id),
  source_document_id uuid not null references public.erp_purchase_documents(id),
  request_id uuid not null,
  payload_digest text not null,
  decision text not null check (decision in ('project','set_aside')),
  project_id uuid references public.projects(id),
  procurement_id uuid references public.procurements(id),
  accept_set_aside boolean not null default false,
  allow_capital_as_overhead boolean not null default false,
  original_classification text,
  prior_mark_present boolean not null default false,
  prior_mark_set_aside_at timestamptz,
  prior_mark_set_aside_by uuid references public.profiles(id),
  prior_mark_note text,
  prior_mark_updated_at timestamptz,
  prior_mark_updated_by uuid references public.profiles(id),
  source_revision text,
  actor_id uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  undone_at timestamptz,
  undone_by uuid references public.profiles(id),
  undone_reason text,
  constraint erp_capture_invoice_assignments_request_key unique (org_id, request_id),
  constraint erp_capture_invoice_assignments_project_shape check ((decision = 'project') = (project_id is not null)),
  constraint erp_capture_invoice_assignments_undo_reason check ((undone_at is null) = (undone_reason is null))
);
-- Two active decisions for one source cannot exist; a new request is possible only after the earlier one is undone.
create unique index erp_capture_assignment_active_source_idx
  on public.erp_capture_invoice_assignments (org_id, binding_id, source_document_id) where undone_at is null;
create index erp_capture_assignment_active_project_idx
  on public.erp_capture_invoice_assignments (org_id, project_id, source_document_id) where undone_at is null and decision = 'project';

alter table public.erp_capture_invoice_assignments enable row level security;
alter table public.erp_capture_invoice_assignments force row level security;
create policy erp_capture_invoice_assignments_select on public.erp_capture_invoice_assignments for select to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member())
         and (select public.auth_role()) in ('Admin','Executive','Project Manager','Finance'));
revoke all on public.erp_capture_invoice_assignments from public, anon, authenticated, service_role;
grant select on public.erp_capture_invoice_assignments to authenticated;

-- §2 The public entry. The actor and organization come from the session; a row may carry only the six keys below.
create function public.assign_capture_invoices(p_rows jsonb, p_expected_revision text, p_dry_run boolean default true)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_actor uuid := auth.uid(); v_org uuid := public.auth_org_id();
  v_binding uuid; v_count integer; v_row jsonb; v_norm jsonb := '[]'::jsonb; v_results jsonb := '[]'::jsonb; v_revision text;
  v_source uuid; v_request uuid; v_i integer; v_item record;
begin
  if v_actor is null or v_org is null or not public.is_active_member() or public.auth_role()::text is distinct from 'Admin'
     or exists (select 1 from auth.users u where u.id = v_actor and u.banned_until is not null and u.banned_until > now()) then
    raise exception 'Only an active Admin can place invoices.' using errcode = '42501';
  end if;
  if p_dry_run is null or nullif(btrim(p_expected_revision),'') is null
     or jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 500 then
    raise exception 'invalid_assignment_rows' using errcode = '22023';
  end if;
  for v_row, v_i in select value, ordinality from jsonb_array_elements(p_rows) with ordinality loop
    if jsonb_typeof(v_row) is distinct from 'object'
       or exists (select 1 from jsonb_object_keys(v_row) k where k not in ('request_id','source_id','decision','project_id','accept_set_aside','allow_capital_as_overhead'))
       or coalesce(v_row->>'request_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or coalesce(v_row->>'source_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or v_row->>'decision' not in ('project','set_aside')
       or (v_row->>'decision' = 'project') is distinct from (coalesce(v_row->>'project_id','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
       or (v_row ? 'project_id' and v_row->>'decision' = 'set_aside')
       or (v_row ? 'accept_set_aside' and jsonb_typeof(v_row->'accept_set_aside') <> 'boolean')
       or (v_row ? 'allow_capital_as_overhead' and jsonb_typeof(v_row->'allow_capital_as_overhead') <> 'boolean') then
      raise exception 'invalid_assignment_row' using errcode = '22023';
    end if;
    v_norm := v_norm || jsonb_build_array(jsonb_build_object('i',v_i,'request_id',lower(v_row->>'request_id'),'source_id',lower(v_row->>'source_id'),
      'decision',v_row->>'decision','project_id',lower(v_row->>'project_id'),
      'accept_set_aside',coalesce((v_row->>'accept_set_aside')::boolean,false),'allow_capital_as_overhead',coalesce((v_row->>'allow_capital_as_overhead')::boolean,false)));
  end loop;
  if (select count(distinct r->>'request_id') from jsonb_array_elements(v_norm) r) <> jsonb_array_length(v_norm)
     or (select count(distinct r->>'source_id') from jsonb_array_elements(v_norm) r) <> jsonb_array_length(v_norm) then
    raise exception 'duplicate_assignment_row' using errcode = '22023';
  end if;
  -- The applied path (source validation, wrapper, mark, undo) is a later step; until it exists nothing may be applied.
  if not p_dry_run then raise exception 'assignment_effects_not_available' using errcode = '0A000'; end if;
  select count(*), (array_agg(id))[1] into v_count, v_binding from public.external_org_bindings
   where org_id = v_org and status = 'active' and activated_at is not null;
  if v_count <> 1 then return jsonb_build_object('complete',false,'reason','binding_unavailable','results','[]'::jsonb,'erp_write',false); end if;
  v_revision := public.purchase_capture_source_page(null,null,1)->>'revision';
  -- Rows run in source order so concurrent batches take their locks in one order.
  for v_item in select r.value as r from jsonb_array_elements(v_norm) r order by r.value->>'source_id' loop
    v_results := v_results || jsonb_build_array(jsonb_build_object('request_id',v_item.r->>'request_id','source_id',v_item.r->>'source_id','index',(v_item.r->>'i')::integer,'erp_write',false)
      || case when not exists (select 1 from public.erp_purchase_documents where org_id = v_org and id = (v_item.r->>'source_id')::uuid)
                or (v_item.r->>'project_id' is not null and not exists (select 1 from public.projects where org_id = v_org and id = (v_item.r->>'project_id')::uuid))
              then jsonb_build_object('outcome','not_found') else jsonb_build_object('outcome','preview','would_create',true) end);
  end loop;
  select coalesce(jsonb_agg(r order by (r->>'index')::integer),'[]'::jsonb) into v_results from jsonb_array_elements(v_results) r;
  return jsonb_build_object('complete',true,'dry_run',p_dry_run,'revision',v_revision,'results',v_results,'erp_write',false);
end $$;
revoke all on function public.assign_capture_invoices(jsonb,text,boolean) from public, anon;
grant execute on function public.assign_capture_invoices(jsonb,text,boolean) to authenticated;
