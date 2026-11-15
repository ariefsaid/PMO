-- Down for 0905 (#2286 PR B). Run this whole file in ONE transaction. It restores capture_history_batch to its 0866 body,
-- capture_history_apply_internal to its 0868 body and fence_capture_source_change to its 0866 body, verbatim, puts the
-- organizations fence trigger back on fence_capture_source_change and drops fence_capture_org_change.
-- restored: 0866 batch
create or replace function public.capture_history_batch(p_actor_id uuid,p_project_id uuid,p_request_id uuid,p_revision text,p_precision jsonb,p_groups jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_catalog as $$
declare
  v_org uuid; v_claims text := current_setting('request.jwt.claims',true); v_batch public.erp_capture_batches%rowtype;
  v_current text; v_health jsonb; v_group jsonb; v_result jsonb; v_group_project uuid; v_group_request uuid;
  v_processed integer := 0; v_processed_sources integer := 0; v_group_count integer; v_total_sources integer;
begin
  if coalesce(auth.jwt()->>'role','') <> 'service_role' then raise exception 'not authorized' using errcode='42501'; end if;
  select p.org_id into v_org from public.profiles p join auth.users u on u.id=p.id
    where p.id=p_actor_id and p.status='active' and p.role::text='Admin'
      and (u.banned_until is null or u.banned_until <= now());
  if v_org is null then raise exception 'not authorized' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('capture-fence:' || v_org::text,0));
  perform 1 from public.profiles p join auth.users u on u.id=p.id where p.id=p_actor_id and p.org_id=v_org
    and p.status='active' and p.role::text='Admin' and (u.banned_until is null or u.banned_until <= now()) for share of p,u;
  if not found then raise exception 'not authorized' using errcode='42501'; end if;
  perform public.assert_feature_on(v_org,'procurement');
  if p_request_id is null or nullif(btrim(p_revision),'') is null or jsonb_typeof(p_precision) is distinct from 'object' then
    raise exception 'invalid request' using errcode='22023';
  end if;
  if p_project_id is not null and not exists(select 1 from public.projects where id=p_project_id and org_id=v_org) then
    return jsonb_build_object('complete',false,'reason','project_not_found','erp_write',false);
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_org::text || ':batch:' || p_request_id::text,0));
  select * into v_batch from public.erp_capture_batches where org_id=v_org and request_id=p_request_id for update;
  if found then
    if v_batch.actor_id <> p_actor_id or v_batch.project_id is distinct from p_project_id or v_batch.reviewed_revision <> p_revision
       or (p_groups is not null and v_batch.groups is distinct from p_groups) then
      return jsonb_build_object('complete',false,'reason','request_conflict','erp_write',false);
    end if;
    if v_batch.precision is distinct from p_precision then return jsonb_build_object('complete',false,'reason','precision_changed','results',v_batch.results,'erp_write',false); end if;
    if exists (select 1 from generate_series(0, v_batch.next_index - 1) i
      join public.erp_purchase_captures c on c.org_id=v_org
        and c.request_id=md5(p_request_id::text || ':group:' || i::text)::uuid
      where c.undone_at is not null) then
      return jsonb_build_object('complete',false,'resume',false,'reason','batch_contains_undone_capture','results',v_batch.results,'erp_write',false);
    end if;
    if v_batch.next_index >= jsonb_array_length(v_batch.groups) then
      return jsonb_build_object('complete',true,'resume',false,'results',v_batch.results,'erp_write',false);
    end if;
  else
    if p_groups is null then return jsonb_build_object('complete',false,'resume',false,'reason','batch_not_found','erp_write',false); end if;
    if jsonb_typeof(p_groups) is distinct from 'array' or jsonb_array_length(p_groups)>10000 then raise exception 'invalid groups' using errcode='22023'; end if;
    if exists (select 1 from jsonb_array_elements(p_groups) g where jsonb_typeof(g) <> 'object'
       or jsonb_typeof(g->'source_ids') is distinct from 'array' or jsonb_array_length(g->'source_ids') not between 1 and 500
       or (p_project_id is not null and g->>'project_id' is distinct from p_project_id::text)) then
      raise exception 'invalid groups' using errcode='22023';
    end if;
    select count(*) into v_total_sources from jsonb_array_elements(p_groups) g cross join lateral jsonb_array_elements_text(g->'source_ids') s;
    if v_total_sources > 10000 or exists (select 1 from jsonb_array_elements(p_groups) g cross join lateral jsonb_array_elements_text(g->'source_ids') s group by s having count(*)>1) then
      raise exception 'invalid groups' using errcode='22023';
    end if;
    perform set_config('request.jwt.claims',jsonb_build_object('sub',p_actor_id,'role','authenticated')::text,true);
    v_current := public.purchase_capture_source_page(null,null,1)->>'revision';
    v_health := public.purchase_capture_feed_health();
    perform set_config('request.jwt.claims',coalesce(v_claims,''),true);
    if v_current is distinct from p_revision or coalesce((v_health->>'caught_up')::boolean,false) is not true
       or nullif(v_health->>'ledger_currency','') is null then
      return jsonb_build_object('complete',false,'resume',false,'reason','review_stale_or_incomplete','results','[]'::jsonb,'erp_write',false);
    end if;
    insert into public.erp_capture_batches(org_id,request_id,actor_id,project_id,reviewed_revision,current_revision,precision,groups)
      values(v_org,p_request_id,p_actor_id,p_project_id,p_revision,p_revision,p_precision,p_groups) returning * into v_batch;
  end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',p_actor_id,'role','authenticated')::text,true);
  v_current := public.purchase_capture_source_page(null,null,1)->>'revision';
  v_health := public.purchase_capture_feed_health();
  perform set_config('request.jwt.claims',coalesce(v_claims,''),true);
  if v_current is distinct from v_batch.current_revision or coalesce((v_health->>'caught_up')::boolean,false) is not true
     or nullif(v_health->>'ledger_currency','') is null then
    return jsonb_build_object('complete',false,'resume',false,'reason','review_stale_or_incomplete','results',v_batch.results,'erp_write',false);
  end if;
  v_group_count := jsonb_array_length(v_batch.groups);
  while v_batch.next_index < v_group_count and v_processed < 25 loop
    v_group := v_batch.groups->v_batch.next_index;
    if v_processed_sources + jsonb_array_length(v_group->'source_ids') > 500 then exit; end if;
    v_processed_sources := v_processed_sources + jsonb_array_length(v_group->'source_ids');
    begin v_group_project := (v_group->>'project_id')::uuid;
    exception when invalid_text_representation then raise exception 'invalid group project' using errcode='22023'; end;
    v_group_request := md5(p_request_id::text || ':group:' || v_batch.next_index::text)::uuid;
    v_result := public.capture_history_apply_internal(p_actor_id,v_group_project,v_group_request,v_batch.current_revision,v_group->'source_ids',p_precision,false,true);
    v_batch.results := v_batch.results || jsonb_build_array(v_result || jsonb_build_object('project_id',v_group_project,'source_ids',v_group->'source_ids'));
    v_batch.next_index := v_batch.next_index + 1;
    v_processed := v_processed + 1;
  end loop;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',p_actor_id,'role','authenticated')::text,true);
  v_batch.current_revision := public.purchase_capture_source_page(null,null,1)->>'revision';
  perform set_config('request.jwt.claims',coalesce(v_claims,''),true);
  update public.erp_capture_batches set next_index=v_batch.next_index,current_revision=v_batch.current_revision,results=v_batch.results
    where org_id=v_org and request_id=p_request_id;
  return jsonb_build_object('complete',v_batch.next_index >= v_group_count,'resume',v_batch.next_index < v_group_count,
    'next_index',v_batch.next_index,'results',v_batch.results,'erp_write',false);
end $$;
revoke all on function public.capture_history_batch(uuid,uuid,uuid,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.capture_history_batch(uuid,uuid,uuid,text,jsonb,jsonb) to service_role;
-- restored: 0868 apply
create or replace function public.capture_history_apply_internal(
  p_actor_id uuid, p_project_id uuid, p_request_id uuid, p_revision text,
  p_source_ids jsonb, p_precision jsonb, p_dry_run boolean, p_skip_revision boolean
) returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_org uuid; v_binding public.external_org_bindings%rowtype; v_binding_count integer;
  v_claims text := current_setting('request.jwt.claims', true);
  v_existing public.erp_purchase_captures%rowtype;
  v_ids uuid[]; v_count integer; v_doc jsonb; v_evidence jsonb;
  v_supplier text; v_currency text; v_order text; v_vendor uuid; v_vendor_count integer;
  v_kind text; v_stage text := 'ordered'; v_rows jsonb := '[]'::jsonb;
  v_result jsonb; v_reason text; v_purchase uuid; v_payload jsonb;
  v_has_invoice boolean := false; v_scale integer;
  v_link_count integer; v_purchase_count integer; v_linked uuid; v_holds jsonb; v_attach boolean := false;
begin
  if coalesce(auth.jwt()->>'role','') <> 'service_role' then raise exception 'not authorized' using errcode = '42501'; end if;
  select p.org_id into v_org from public.profiles p join auth.users u on u.id = p.id
   where p.id = p_actor_id and p.role::text = 'Admin' and p.status = 'active'
     and (u.banned_until is null or u.banned_until <= now());
  if v_org is null then raise exception 'not authorized' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('capture-fence:' || v_org::text,0));
  perform 1 from public.profiles p join auth.users u on u.id=p.id
   where p.id=p_actor_id and p.org_id=v_org and p.status='active' and p.role::text='Admin'
     and (u.banned_until is null or u.banned_until <= now()) for share of p,u;
  if not found then raise exception 'not authorized' using errcode='42501'; end if;
  perform public.assert_feature_on(v_org, 'procurement');
  if p_project_id is null or p_request_id is null or nullif(btrim(p_revision),'') is null
     or jsonb_typeof(p_source_ids) <> 'array' or jsonb_array_length(p_source_ids) not between 1 and 500
     or jsonb_typeof(p_precision) <> 'object' then
    raise exception 'invalid request' using errcode = '22023';
  end if;
  if not exists (select 1 from public.projects where id = p_project_id and org_id = v_org) then
    return jsonb_build_object('outcome','refused','reason','project_not_found','erp_write',false);
  end if;
  select count(*), (array_agg(id))[1] into v_binding_count, v_binding.id from public.external_org_bindings
   where org_id = v_org and status = 'active' and activated_at is not null;
  if v_binding_count <> 1 then return jsonb_build_object('outcome','refused','reason','binding_unavailable','erp_write',false); end if;
  select * into v_binding from public.external_org_bindings where id = v_binding.id and org_id = v_org;
  v_evidence := public.capture_source_evidence(v_org,v_binding.id,null);
  if not (v_evidence->>'supported')::boolean then return jsonb_build_object('outcome','refused','reason','unsupported_adapter','erp_write',false); end if;
  if not (v_evidence->>'company_known')::boolean or not ((v_evidence->'mapped_projects') ? p_project_id::text) then return jsonb_build_object('outcome','refused','reason','binding_evidence_missing','erp_write',false); end if;
  begin
    select array_agg(value::uuid order by value::uuid), count(*) into v_ids, v_count from jsonb_array_elements_text(p_source_ids);
  exception when invalid_text_representation then return jsonb_build_object('outcome','refused','reason','invalid_source','erp_write',false);
  end;
  if cardinality(v_ids) <> (select count(distinct x) from unnest(v_ids) x) then
    return jsonb_build_object('outcome','refused','reason','duplicate_source','erp_write',false);
  end if;
  v_payload := jsonb_build_object('project_id',p_project_id,'source_ids',to_jsonb(v_ids),'revision',p_revision);
  perform pg_advisory_xact_lock(hashtextextended(v_org::text || ':' || p_request_id::text, 0));
  select * into v_existing from public.erp_purchase_captures where org_id = v_org and request_id = p_request_id;
  if found then
    if v_existing.payload is distinct from v_payload then return jsonb_build_object('outcome','refused','reason','request_conflict','erp_write',false); end if;
    if v_existing.undone_at is not null then return jsonb_build_object('outcome','refused','reason','undone','erp_write',false); end if;
    return jsonb_build_object('outcome','skip','procurement_id',v_existing.procurement_id,'erp_write',false);
  end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub',p_actor_id,'role','authenticated')::text, true);
  if not p_skip_revision and public.purchase_capture_source_page(null,null,1)->>'revision' is distinct from p_revision then
    perform set_config('request.jwt.claims',coalesce(v_claims,''),true);
    return jsonb_build_object('outcome','refused','reason','source_stale','erp_write',false);
  end if;
  if coalesce((public.purchase_capture_feed_health()->>'caught_up')::boolean,false) is not true then
    perform set_config('request.jwt.claims',coalesce(v_claims,''),true);
    return jsonb_build_object('outcome','refused','reason','feed_not_current','erp_write',false);
  end if;
  if nullif(public.purchase_capture_feed_health()->>'ledger_currency','') is null then
    perform set_config('request.jwt.claims',coalesce(v_claims,''),true);
    return jsonb_build_object('outcome','refused','reason','ledger_currency_unknown','erp_write',false);
  end if;
  perform 1 from public.erp_purchase_documents where org_id = v_org and id = any(v_ids) order by id for update;
  select count(*) into v_count from public.erp_purchase_documents where org_id = v_org and id = any(v_ids);
  if v_count <> cardinality(v_ids) then
    perform set_config('request.jwt.claims',coalesce(v_claims,''),true);
    return jsonb_build_object('outcome','refused','reason','source_not_found','erp_write',false);
  end if;
  v_evidence := public.capture_source_evidence(v_org,v_binding.id,v_ids);
  for v_doc in select value from jsonb_array_elements(v_evidence->'documents') loop
    v_kind := v_doc->>'kind';
    if (v_kind is null or v_kind not in ('order','supplier_invoice')) or not coalesce((v_doc->>'eligible')::boolean,false)
       or jsonb_array_length(v_doc->'project_ids') <> 1 or v_doc->'project_ids'->>0 <> p_project_id::text then
      v_reason := 'source_not_eligible'; exit;
    end if;
    if v_doc->>'state' is null then v_reason := 'state_unknown'; exit; end if;
    if jsonb_typeof(p_precision->v_kind) = 'number' and coalesce(p_precision->>v_kind,'') ~ '^([3-9]|[1-9][0-9]+)$' then
      v_reason := 'source_precision_exceeds_mirror'; exit;
    end if;
    if jsonb_typeof(p_precision->v_kind) is distinct from 'number' or coalesce(p_precision->>v_kind,'') !~ '^[0-2]$' then
      v_reason := 'source_precision_unknown'; exit;
    end if;
    v_scale := (p_precision->>v_kind)::integer;
    if trunc((v_doc->>'net_total')::numeric,v_scale) <> (v_doc->>'net_total')::numeric then v_reason := 'source_precision_mismatch'; exit; end if;
    if v_supplier is null then v_supplier := v_doc->>'supplier_reference'; elsif v_supplier <> v_doc->>'supplier_reference' then v_reason := 'supplier_mismatch'; exit; end if;
    if v_currency is null then v_currency := v_doc->>'currency'; elsif v_currency <> v_doc->>'currency' then v_reason := 'currency_mismatch'; exit; end if;
    if v_kind = 'order' then
      if v_order is not null and v_order <> v_doc->>'family_reference' then v_reason := 'family_ambiguous'; exit; end if;
      v_order := v_doc->>'family_reference';
    else
      v_has_invoice := true; v_stage := v_doc->>'state';
      if (v_doc->>'classification_unknown')::boolean then v_reason := 'account_classification_unknown'; exit; end if;
      if not (v_doc->>'mapped_cost_present')::boolean then v_reason := 'invoice_has_no_mapped_cost'; exit; end if;
    end if;
    v_rows := v_rows || jsonb_build_array((v_doc->'linker_source') || jsonb_build_object('project_id',p_project_id,'group',p_request_id::text));
  end loop;
  if v_reason is null then
    v_vendor_count := (v_evidence->'documents'->0->>'vendor_count')::integer;
    v_vendor := (v_evidence->'documents'->0->>'vendor_id')::uuid;
    if v_vendor_count <> 1 then v_reason := 'supplier_unknown'; end if;
  end if;
  if v_reason is null and v_has_invoice and v_order is not null and exists (
      select 1 from jsonb_array_elements(v_evidence->'documents') d where d->>'kind'='supplier_invoice'
       and (jsonb_array_length(d->'family_references') <> 1 or d->'family_references'->>0 <> v_order)) then
    v_reason := 'family_ambiguous';
  end if;
  if v_reason is null and exists (select 1 from jsonb_array_elements(v_evidence->'documents') d where (d->>'family_incomplete')::boolean) then v_reason := 'family_incomplete'; end if;
  if v_reason is null then
    select count(*), count(distinct l.procurement_id), (array_agg(l.procurement_id))[1]
      into v_link_count, v_purchase_count, v_linked
      from public.procurement_erp_links l where l.org_id = v_org and l.erp_purchase_document_id = any(v_ids);
    if v_link_count > 0 then
      if v_purchase_count <> 1 or not exists (select 1 from public.procurements p
          where p.id = v_linked and p.org_id = v_org and p.project_id = p_project_id
            and p.vendor_id = v_vendor and p.currency = v_currency and p.status::text not in ('Cancelled','Rejected')) then
        v_reason := 'family_conflict';
      elsif v_link_count <> cardinality(v_ids) then
        if exists (select 1 from public.procurements p where p.id=v_linked and p.org_id=v_org and p.record_only)
          and exists (select 1 from public.erp_purchase_captures c where c.org_id=v_org and c.procurement_id=v_linked
            and c.undone_at is null and c.kind in ('order','supplier_invoice'))
          and not exists (select 1 from public.erp_purchase_captures c where c.org_id=v_org and c.procurement_id=v_linked and c.kind='journal') then
          v_attach := true;
        else v_reason := 'ordinary_purchase_requires_decision'; end if;
      else
        perform set_config('request.jwt.claims',coalesce(v_claims,''),true);
        return jsonb_build_object('outcome','matched','procurement_id',v_linked,'erp_write',false);
      end if;
    end if;
  end if;
  if v_reason is null then
    v_holds := v_evidence->'documents'->0->'holds';
    if jsonb_array_length(v_holds)>0 then
      perform set_config('request.jwt.claims',coalesce(v_claims,''),true);
      return jsonb_build_object('outcome','refused','reason','needs_undo','needs_undo',v_holds,'erp_write',false);
    end if;
  end if;
  if v_reason is not null then
    perform set_config('request.jwt.claims',coalesce(v_claims,''),true);
    return jsonb_build_object('outcome','refused','reason',v_reason,'erp_write',false);
  end if;
  begin
    if v_attach then
      perform 1 from public.procurements where id=v_linked and org_id=v_org for update;
      update public.procurements set record_only=false where id=v_linked and org_id=v_org;
      select coalesce(jsonb_agg((d->'linker_source') || jsonb_build_object('project_id',p_project_id,'group',p_request_id::text,'procurement_id',v_linked)),'[]'::jsonb)
        into v_rows from jsonb_array_elements(v_evidence->'documents') d
        where not exists(select 1 from public.procurement_erp_links l where l.org_id=v_org and l.erp_purchase_document_id=(d->>'id')::uuid);
    end if;
    v_result := public.link_erp_purchase_documents(v_rows,false);
    if coalesce((v_result#>>'{counts,refused}')::integer,0) > 0 or coalesce((v_result#>>'{counts,skip}')::integer,0) > 0 then
      v_reason := coalesce(v_result#>>'{results,0,reason}','family_requires_decision');
      raise exception 'family_refused' using errcode = 'PFE02';
    end if;
    v_purchase := (v_result#>>'{results,0,procurement_id}')::uuid;
    update public.procurements set record_only = true, record_only_stage = v_stage,
      record_only_reference = v_order where id = v_purchase and org_id = v_org;
    perform set_config('request.jwt.claims',v_claims,true);
    insert into public.erp_purchase_captures(org_id,binding_id,request_id,procurement_id,payload,kind,stage,captured_by)
      values(v_org,v_binding.id,p_request_id,v_purchase,v_payload,case when v_has_invoice then 'supplier_invoice' else 'order' end,v_stage,p_actor_id);
    perform set_config('request.jwt.claims',jsonb_build_object('sub',p_actor_id,'role','authenticated')::text,true);
    perform public.log_audit('procurement.record_only_create',v_org,p_actor_id,v_purchase,
      jsonb_build_object('project_id',p_project_id,'source_ids',to_jsonb(v_ids),'assignment_origin',v_evidence->>'assignment_origin'));
    if p_dry_run then raise exception 'preview rollback' using errcode = 'PFE01'; end if;
  exception
    when sqlstate 'PFE01' then v_purchase := null;
    when sqlstate 'PFE02' then
      perform set_config('request.jwt.claims',coalesce(v_claims,''),true);
      return jsonb_build_object('outcome','refused','reason',v_reason,'erp_write',false);
  end;
  perform set_config('request.jwt.claims',coalesce(v_claims,''),true);
  return jsonb_build_object('outcome','create','procurement_id',v_purchase,'dry_run',p_dry_run,'erp_write',false);
end $$;
revoke all on function public.capture_history_apply_internal(uuid,uuid,uuid,text,jsonb,jsonb,boolean,boolean) from public,anon,authenticated,service_role;
-- restored: 0866 fence
create or replace function public.fence_capture_source_change() returns trigger
language plpgsql security definer set search_path=public,pg_catalog as $$
declare v_old uuid; v_new uuid; v_org uuid;
begin
  if tg_op <> 'INSERT' then
    v_old := case when tg_table_name='organizations' then (to_jsonb(old)->>'id')::uuid else (to_jsonb(old)->>'org_id')::uuid end;
  end if;
  if tg_op <> 'DELETE' then
    v_new := case when tg_table_name='organizations' then (to_jsonb(new)->>'id')::uuid else (to_jsonb(new)->>'org_id')::uuid end;
  end if;
  for v_org in select distinct x from unnest(array[v_old,v_new]) x where x is not null order by x loop
    perform pg_advisory_xact_lock_shared(hashtextextended('capture-fence:' || v_org::text,0));
  end loop;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
revoke all on function public.fence_capture_source_change() from public,anon,authenticated,service_role;
drop trigger capture_census_fence on public.organizations;
create trigger capture_census_fence before insert or update or delete on public.organizations
  for each row execute function public.fence_capture_source_change();
drop function public.fence_capture_org_change();
