-- 1021_billing_stages.sql — measurement to invoice: a project's ordered billing stages, copied onto each progress claim, each
-- with a document checklist; the claim's invoice cannot be raised (native or ERP) until every stage is complete.
-- FR-BST-001..031, AC-BST-001..006 (docs/specs/billing-stages.spec.md); #2522.
--
-- Model: billing_stage_templates (+ _documents) is the project's list, replaced whole by set_billing_stage_template (Finance/Admin).
-- A progress claim gets a snapshot (claim_billing_stages + claim_billing_stage_documents) from an AFTER INSERT trigger, so a
-- later edit of the list never changes a claim already made. Every write is a SECURITY DEFINER function; no client write grant.
-- The gate is two BEFORE INSERT triggers, on the ERP outbox (domain revenue) and on sales_invoices (the native raise and any
-- mirror insert share the claim id as the invoice id): neither path can mint an invoice for a claim with an open stage.
-- Also: projects.invoice_deadline_day / invoice_deadline_warn_days (the monthly cut-off), set only by set_project_invoice_deadline.

-- ── the monthly invoice deadline on the project (the contract) ─────────────────────────────────────────────────────────
alter table public.projects
  add column invoice_deadline_day smallint check (invoice_deadline_day between 1 and 31),
  add column invoice_deadline_warn_days smallint not null default 5 check (invoice_deadline_warn_days between 0 and 27);

-- ── the project's list ──────────────────────────────────────────────────────────────────────────────────────────────────
create table public.billing_stage_templates (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id),
  project_id  uuid not null references public.projects(id) on delete cascade,
  position    smallint not null check (position between 1 and 20),
  name        text not null check (btrim(name) <> '' and length(name) <= 120),
  client_side boolean not null default false,
  created_at  timestamptz not null default now(),
  unique (project_id, position)
);
create index billing_stage_templates_org_idx on public.billing_stage_templates (org_id, project_id);

create table public.billing_stage_template_documents (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id),
  template_id uuid not null references public.billing_stage_templates(id) on delete cascade,
  position    smallint not null check (position between 1 and 20),
  name        text not null check (btrim(name) <> '' and length(name) <= 120),
  required    boolean not null default true,
  unique (template_id, position)
);
create index billing_stage_template_documents_org_idx on public.billing_stage_template_documents (org_id, template_id);

-- ── a claim's stage plan ────────────────────────────────────────────────────────────────────────────────────────────────
create table public.claim_billing_stages (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations(id),
  claim_id         uuid not null references public.progress_claims(id) on delete cascade,
  project_id       uuid not null references public.projects(id) on delete cascade,
  position         smallint not null check (position between 1 and 20),
  name             text not null,
  client_side      boolean not null,
  started_on       date,
  completed_on     date,
  client_reference text check (client_reference is null or length(client_reference) <= 120),
  note             text check (note is null or length(note) <= 1000),
  completed_by     uuid references auth.users(id),
  completed_at     timestamptz,
  unique (claim_id, position),
  check (completed_on is null or (started_on is not null and completed_on >= started_on and completed_by is not null))
);
create index claim_billing_stages_org_idx on public.claim_billing_stages (org_id, project_id);

create table public.claim_billing_stage_documents (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id),
  stage_id    uuid not null references public.claim_billing_stages(id) on delete cascade,
  claim_id    uuid not null references public.progress_claims(id) on delete cascade,
  position    smallint not null,
  name        text not null,
  required    boolean not null,
  document_id uuid references public.project_documents(id),   -- NO ACTION: a cited document cannot be deleted (as evidence)
  attached_by uuid references auth.users(id),
  attached_at timestamptz,
  unique (stage_id, position),
  check ((document_id is null) = (attached_by is null))
);
create index claim_billing_stage_documents_claim_idx on public.claim_billing_stage_documents (claim_id);
create index claim_billing_stage_documents_doc_idx on public.claim_billing_stage_documents (document_id) where document_id is not null;

-- RLS: active members of the org read (Engineers excluded, as for claims); nobody writes directly.
do $$
declare t text;
begin
  foreach t in array array['billing_stage_templates','billing_stage_template_documents','claim_billing_stages','claim_billing_stage_documents'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format($p$create policy %I on public.%I for select to authenticated
                      using (org_id = (select public.auth_org_id()) and (select public.is_active_member()))$p$, t || '_select', t);
    execute format($p$create policy %I on public.%I as restrictive for select to authenticated
                      using ((select public.auth_role()) in ('Admin','Executive','Project Manager','Finance'))$p$, t || '_engineer_read_scope', t);
  end loop;
end $$;

-- ── replace the project's list (Finance/Admin) ──────────────────────────────────────────────────────────────────────────
create or replace function public.set_billing_stage_template(p_project uuid, p_stages jsonb) returns integer
  language plpgsql security definer set search_path = public as $$
declare
  v_org   uuid      := public.auth_org_id();
  v_role  user_role := public.auth_role();
  v_stage jsonb;
  v_doc   jsonb;
  v_pos   int := 0;
  v_dpos  int;
  v_tid   uuid;
begin
  -- SECURITY: membership, role and org re-assertions MUST stay: a SECURITY DEFINER body bypasses RLS.
  perform public.assert_is_active_member();
  if v_role is null or v_role not in ('Admin','Finance') then
    raise exception 'only Finance or an Admin can set a project''s billing stages' using errcode = '42501';
  end if;
  perform 1 from public.projects p where p.id = p_project and p.org_id = v_org for update;
  if not found then raise exception 'project not found' using errcode = 'P0002'; end if;
  if p_stages is null or jsonb_typeof(p_stages) <> 'array' or jsonb_array_length(p_stages) > 20 then
    raise exception 'the billing stages are a list of at most 20 stages' using errcode = '22023', detail = 'stages-shape';
  end if;

  delete from public.billing_stage_templates t where t.project_id = p_project;
  for v_stage in select x from jsonb_array_elements(p_stages) x loop
    v_pos := v_pos + 1;
    if jsonb_typeof(v_stage) <> 'object' or coalesce(btrim(v_stage ->> 'name'), '') = '' then
      raise exception 'every billing stage needs a name' using errcode = '23514', detail = 'stage-name-missing';
    end if;
    insert into public.billing_stage_templates (org_id, project_id, position, name, client_side)
    values (v_org, p_project, v_pos, btrim(v_stage ->> 'name'), coalesce((v_stage ->> 'client_side')::boolean, false))
    returning id into v_tid;
    v_dpos := 0;
    if jsonb_typeof(v_stage -> 'documents') = 'array' then
      if jsonb_array_length(v_stage -> 'documents') > 20 then
        raise exception 'a billing stage lists at most 20 documents' using errcode = '22023', detail = 'stages-shape';
      end if;
      for v_doc in select x from jsonb_array_elements(v_stage -> 'documents') x loop
        v_dpos := v_dpos + 1;
        if jsonb_typeof(v_doc) <> 'object' or coalesce(btrim(v_doc ->> 'name'), '') = '' then
          raise exception 'every checklist document needs a name' using errcode = '23514', detail = 'document-name-missing';
        end if;
        insert into public.billing_stage_template_documents (org_id, template_id, position, name, required)
        values (v_org, v_tid, v_dpos, btrim(v_doc ->> 'name'), coalesce((v_doc ->> 'required')::boolean, true));
      end loop;
    end if;
  end loop;

  perform public.log_audit('billing_stage_template.set', v_org, auth.uid(), p_project, jsonb_build_object('stages', v_pos));
  return v_pos;
end; $$;
revoke all on function public.set_billing_stage_template(uuid, jsonb) from public, anon;
grant execute on function public.set_billing_stage_template(uuid, jsonb) to authenticated, service_role;

-- ── the monthly invoice deadline (Finance/Admin) ────────────────────────────────────────────────────────────────────────
create or replace function public.set_project_invoice_deadline(p_project uuid, p_day integer, p_warn_days integer default 5) returns void
  language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.auth_org_id(); v_role user_role := public.auth_role();
begin
  perform public.assert_is_active_member();
  if v_role is null or v_role not in ('Admin','Finance') then
    raise exception 'only Finance or an Admin can set the invoice deadline' using errcode = '42501';
  end if;
  if p_day is not null and p_day not between 1 and 31 then
    raise exception 'the invoice deadline is a day of the month, 1 to 31' using errcode = '22023', detail = 'deadline-day';
  end if;
  if p_warn_days is null or p_warn_days not between 0 and 27 then
    raise exception 'warn between 0 and 27 days ahead' using errcode = '22023', detail = 'deadline-warn-days';
  end if;
  update public.projects p set invoice_deadline_day = p_day, invoice_deadline_warn_days = p_warn_days
   where p.id = p_project and p.org_id = v_org;
  if not found then raise exception 'project not found' using errcode = 'P0002'; end if;
  perform public.log_audit('project.invoice_deadline.set', v_org, auth.uid(), p_project,
    jsonb_build_object('day', p_day, 'warn_days', p_warn_days));
end; $$;
revoke all on function public.set_project_invoice_deadline(uuid, integer, integer) from public, anon;
grant execute on function public.set_project_invoice_deadline(uuid, integer, integer) to authenticated, service_role;

-- No client column grant is added on projects (it grants per column): the deadline moves only through the function above.
-- Change-capture registry (AC-CHG-011): who changed a project's invoice deadline is history worth keeping.
update public.record_history_config
   set captured = captured || '{"invoice_deadline_day":"number","invoice_deadline_warn_days":"number"}'::jsonb
 where entity_type = 'project' and not (captured ? 'invoice_deadline_day');

-- ── snapshot the list onto a new progress claim ─────────────────────────────────────────────────────────────────────────
create or replace function public.instantiate_claim_billing_stages() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if new.kind <> 'progress' then return new; end if;
  insert into public.claim_billing_stages (org_id, claim_id, project_id, position, name, client_side, started_on)
  select new.org_id, new.id, new.project_id, t.position, t.name, t.client_side,
         case when t.position = (select min(t2.position) from public.billing_stage_templates t2 where t2.project_id = new.project_id)
              then public.native_org_today(new.org_id) end
    from public.billing_stage_templates t
   where t.project_id = new.project_id and t.org_id = new.org_id;
  insert into public.claim_billing_stage_documents (org_id, stage_id, claim_id, position, name, required)
  select new.org_id, s.id, new.id, d.position, d.name, d.required
    from public.claim_billing_stages s
    join public.billing_stage_templates t on t.project_id = new.project_id and t.position = s.position
    join public.billing_stage_template_documents d on d.template_id = t.id
   where s.claim_id = new.id;
  return new;
end; $$;
revoke all on function public.instantiate_claim_billing_stages() from public, anon, authenticated;
create trigger progress_claims_zz_billing_stages after insert on public.progress_claims
  for each row execute function public.instantiate_claim_billing_stages();

-- ── shared: lock a stage's claim and check the caller may record it ─────────────────────────────────────────────────────
create or replace function public.lock_billing_stage_claim(p_stage uuid) returns public.claim_billing_stages
  language plpgsql security definer set search_path = public as $$
declare
  v_org   uuid      := public.auth_org_id();
  v_role  user_role := public.auth_role();
  v_s     public.claim_billing_stages;
  v_claim uuid;
  v_wd    timestamptz;
begin
  perform public.assert_is_active_member();
  if v_role is null or v_role not in ('Admin','Finance','Project Manager') then
    raise exception 'only Finance, an Admin or a Project Manager can record billing stages' using errcode = '42501';
  end if;
  select s.claim_id into v_claim from public.claim_billing_stages s where s.id = p_stage and s.org_id = v_org;
  if not found then raise exception 'billing stage not found' using errcode = 'P0002'; end if;
  -- Same row lock as attach_claim_evidence, withdraw_progress_claim and the outbox fence.
  select pc.withdrawn_at into v_wd from public.progress_claims pc where pc.id = v_claim for update;
  if v_wd is not null then
    raise exception 'this progress claim was withdrawn' using errcode = '55000', detail = 'claim-withdrawn';
  end if;
  select * into v_s from public.claim_billing_stages s where s.id = p_stage for update;
  if v_s.completed_on is not null then
    raise exception 'this billing stage is already completed' using errcode = '55000', detail = 'stage-already-completed';
  end if;
  return v_s;
end; $$;
revoke all on function public.lock_billing_stage_claim(uuid) from public, anon, authenticated;

-- ── attach a project document to a checklist item (it also becomes the claim's billing evidence) ────────────────────────
create or replace function public.attach_billing_stage_document(p_item uuid, p_document uuid) returns void
  language plpgsql security definer set search_path = public as $$
declare
  v_org     uuid := public.auth_org_id();
  v_stage   uuid;
  v_s       public.claim_billing_stages;
  v_d_org   uuid;
  v_d_proj  uuid;
  v_status  public.doc_status;
  v_file    text;
  v_rev     text;
begin
  select d.stage_id into v_stage from public.claim_billing_stage_documents d where d.id = p_item and d.org_id = v_org;
  if not found then
    perform public.assert_is_active_member();
    if coalesce(public.auth_role()::text, '') not in ('Admin','Finance','Project Manager') then
      raise exception 'only Finance, an Admin or a Project Manager can record billing stages' using errcode = '42501';
    end if;
    raise exception 'checklist item not found' using errcode = 'P0002';
  end if;
  v_s := public.lock_billing_stage_claim(v_stage);
  select d.org_id, d.project_id, d.status, d.file_path, d.revision into v_d_org, v_d_proj, v_status, v_file, v_rev
    from public.project_documents d where d.id = p_document;
  if not found or v_d_org is distinct from v_org or v_d_proj is distinct from v_s.project_id then
    raise exception 'the document must be one of the claim''s project documents' using errcode = '23514', detail = 'document-other-project';
  end if;
  if v_status not in ('Issued','Approved') then
    raise exception 'only an issued or approved document can be attached: its content is frozen from issue'
      using errcode = '55000', detail = 'document-not-issued';
  end if;
  if v_file is null or btrim(v_file) = '' then
    raise exception 'the document has no file attached' using errcode = '55000', detail = 'document-without-file';
  end if;
  update public.claim_billing_stage_documents d set document_id = p_document, attached_by = auth.uid(), attached_at = now()
   where d.id = p_item;
  insert into public.progress_claim_evidence (org_id, claim_id, document_id, document_status, document_revision, attached_by)
  values (v_org, v_s.claim_id, p_document, v_status, v_rev, auth.uid())
  on conflict (claim_id, document_id) do nothing;
  perform public.log_audit('billing_stage.document.attach', v_org, auth.uid(), v_s.claim_id,
    jsonb_build_object('stage_id', v_s.id, 'item_id', p_item, 'document_id', p_document, 'document_status', v_status));
end; $$;
revoke all on function public.attach_billing_stage_document(uuid, uuid) from public, anon;
grant execute on function public.attach_billing_stage_document(uuid, uuid) to authenticated, service_role;

-- ── note on an open stage (a client step's interim status, recorded by hand) ────────────────────────────────────────────
create or replace function public.note_billing_stage(p_stage uuid, p_note text) returns void
  language plpgsql security definer set search_path = public as $$
declare v_s public.claim_billing_stages;
begin
  perform public.assert_is_active_member();
  if p_stage is null then raise exception 'billing stage not found' using errcode = 'P0002'; end if;
  v_s := public.lock_billing_stage_claim(p_stage);
  update public.claim_billing_stages s set note = nullif(btrim(p_note), '') where s.id = p_stage;
  perform public.log_audit('billing_stage.note', v_s.org_id, auth.uid(), v_s.claim_id, jsonb_build_object('stage_id', p_stage));
end; $$;
revoke all on function public.note_billing_stage(uuid, text) from public, anon;
grant execute on function public.note_billing_stage(uuid, text) to authenticated, service_role;

-- ── complete a stage ────────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.complete_billing_stage(p_stage uuid, p_completed_on date, p_client_reference text default null,
                                                         p_note text default null) returns void
  language plpgsql security definer set search_path = public as $$
declare
  v_s    public.claim_billing_stages;
  v_prev date;
  v_ref  text := nullif(btrim(p_client_reference), '');
begin
  perform public.assert_is_active_member();
  if p_stage is null then raise exception 'billing stage not found' using errcode = 'P0002'; end if;
  v_s := public.lock_billing_stage_claim(p_stage);
  if exists (select 1 from public.claim_billing_stages s where s.claim_id = v_s.claim_id and s.position < v_s.position and s.completed_on is null) then
    raise exception 'complete the earlier billing stages first' using errcode = '55000', detail = 'stage-out-of-order';
  end if;
  if exists (select 1 from public.claim_billing_stage_documents d where d.stage_id = v_s.id and d.required and d.document_id is null) then
    raise exception 'attach every required document before completing this stage' using errcode = '55000', detail = 'stage-documents-missing';
  end if;
  if p_completed_on is null or p_completed_on > public.native_org_today(v_s.org_id) then
    raise exception 'the completion date cannot be in the future' using errcode = '22023', detail = 'stage-date-future';
  end if;
  select max(s.completed_on) into v_prev from public.claim_billing_stages s where s.claim_id = v_s.claim_id and s.position < v_s.position;
  if p_completed_on < coalesce(v_prev, v_s.started_on) then
    raise exception 'a stage cannot complete before the previous one' using errcode = '22023', detail = 'stage-date-before-previous';
  end if;
  if v_s.client_side and v_ref is null then
    raise exception 'record the client''s document number for a step done in the client''s system'
      using errcode = '23514', detail = 'client-reference-missing';
  end if;

  update public.claim_billing_stages s
     set completed_on = p_completed_on, client_reference = v_ref, note = coalesce(nullif(btrim(p_note), ''), s.note),
         completed_by = auth.uid(), completed_at = now()
   where s.id = v_s.id;
  update public.claim_billing_stages s set started_on = p_completed_on
   where s.claim_id = v_s.claim_id
     and s.position = (select min(s2.position) from public.claim_billing_stages s2 where s2.claim_id = v_s.claim_id and s2.position > v_s.position);
  perform public.log_audit('billing_stage.complete', v_s.org_id, auth.uid(), v_s.claim_id,
    jsonb_build_object('stage_id', v_s.id, 'position', v_s.position, 'completed_on', p_completed_on, 'client_reference', v_ref));
end; $$;
revoke all on function public.complete_billing_stage(uuid, date, text, text) from public, anon;
grant execute on function public.complete_billing_stage(uuid, date, text, text) to authenticated, service_role;

-- ── the invoice gate ────────────────────────────────────────────────────────────────────────────────────────────────────
-- FR-BST-020: a progress claim with an open stage cannot mint an invoice. One predicate for both paths.
create or replace function public.billing_stages_open(p_claim uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.claim_billing_stages s where s.claim_id = p_claim and s.completed_on is null)
$$;
revoke all on function public.billing_stages_open(uuid) from public, anon, authenticated;
grant execute on function public.billing_stages_open(uuid) to service_role;

create or replace function public.assert_claim_billing_stages_complete() returns trigger
  language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if tg_table_name = 'external_command_outbox' then
    if new.pmo_record_id !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then return new; end if;
    v_id := new.pmo_record_id::uuid;
  else
    v_id := new.id;
  end if;
  -- Hold the stages stable against a concurrent completion: the same claim row lock every stage writer takes.
  perform 1 from public.progress_claims pc where pc.id = v_id for share;
  if public.billing_stages_open(v_id) then
    raise exception 'complete every billing stage of this claim (with its documents) before raising its invoice'
      using errcode = '55000', detail = 'billing-stages-incomplete';
  end if;
  return new;
end; $$;
revoke all on function public.assert_claim_billing_stages_complete() from public, anon, authenticated;
create trigger external_command_outbox_zz_billing_stages before insert on public.external_command_outbox
  for each row when (new.domain = 'revenue') execute function public.assert_claim_billing_stages_complete();
create trigger sales_invoices_zz_billing_stages before insert on public.sales_invoices
  for each row execute function public.assert_claim_billing_stages_complete();

comment on table public.claim_billing_stages is
  'A progress claim''s billing stages, copied from the project''s list at claim creation (1021). Written only by complete_billing_stage / note_billing_stage.';
