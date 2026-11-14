alter table public.erp_purchase_captures drop constraint erp_purchase_captures_pkey;
alter table public.erp_purchase_captures add primary key (org_id, request_id);
create index erp_purchase_captures_procurement_idx on public.erp_purchase_captures(procurement_id);
create unique index erp_purchase_captures_one_journal_idx on public.erp_purchase_captures(procurement_id) where kind='journal';

-- Adapter normalization is private; callers receive only the normalized kind.
create function public.capture_source_kind(p_type text) returns text
language sql immutable set search_path = pg_catalog as $$
  select case p_type when 'Purchase Order' then 'order' when 'Purchase Invoice' then 'supplier_invoice'
    when 'Purchase Receipt' then 'receipt' when 'Payment Entry' then 'supplier_payment'
    when 'Journal Entry' then 'journal' else null end
$$;
revoke all on function public.capture_source_kind(text) from public, anon, authenticated, service_role;

-- Private adapter evidence, derived only from the selected binding and scoped mirror rows.
create function public.capture_source_evidence(p_org uuid,p_binding uuid,p_source_ids uuid[])
returns jsonb language sql stable security definer set search_path=public,pg_catalog as $$
  with binding as (
    select b.*, nullif(btrim(b.config->>'company'),'') as company
    from public.external_org_bindings b where b.org_id=p_org and b.id=p_binding
  ), documents as (
    select d.*, public.capture_source_kind(d.erp_doctype) as kind,
      case when d.erp_status in ('To Receive and Bill','To Receive','To Bill') and public.capture_source_kind(d.erp_doctype)='order' then 'ordered'
        when d.erp_status in ('Unpaid','Overdue') and public.capture_source_kind(d.erp_doctype)='supplier_invoice' then 'invoiced'
        when d.erp_status='Partly Paid' and public.capture_source_kind(d.erp_doctype)='supplier_invoice' then 'part_paid'
        when d.erp_status='Paid' and public.capture_source_kind(d.erp_doctype)='supplier_invoice' then 'paid' end as state,
      (select count(distinct c.id) from public.external_refs x join public.companies c on c.id::text=x.pmo_record_id and c.org_id=x.org_id
       where x.org_id=d.org_id and x.domain='companies' and x.external_tier='erpnext'
         and x.external_record_id in ('Supplier:'||d.supplier,d.supplier) and c.archived_at is null and c.type='Vendor') as vendor_count,
      (select (array_agg(distinct c.id))[1] from public.external_refs x join public.companies c on c.id::text=x.pmo_record_id and c.org_id=x.org_id
       where x.org_id=d.org_id and x.domain='companies' and x.external_tier='erpnext'
         and x.external_record_id in ('Supplier:'||d.supplier,d.supplier) and c.archived_at is null and c.type='Vendor') as vendor_id
    from public.erp_purchase_documents d where d.org_id=p_org and exists(select 1 from binding where external_tier='erpnext') and d.id=any(coalesce(p_source_ids,'{}'::uuid[]))
  )
  select jsonb_build_object(
    'supported',coalesce((select external_tier='erpnext' from binding),false),
    'missing',case when coalesce((select external_tier='erpnext' from binding),false) then '[]'::jsonb else jsonb_build_array('unsupported_adapter') end,
    'company_known',coalesce((select company is not null from binding),false),
    'mapped_projects',coalesce((select jsonb_agg(key) from binding b cross join lateral jsonb_each_text(case when jsonb_typeof(b.config->'project_map')='object' then b.config->'project_map' else '{}'::jsonb end) p where nullif(btrim(value),'') is not null),'[]'::jsonb),
    'assignment_origin','erp_project',
    'documents',coalesce((select jsonb_agg(jsonb_build_object(
      'id',d.id,'kind',d.kind,'state',d.state,'project_ids',to_jsonb(d.project_ids),'supplier_reference',d.supplier,
      'currency',d.currency,'net_total',d.net_total,'vendor_count',d.vendor_count,'vendor_id',d.vendor_id,
      'family_reference',d.erp_name,'family_references',to_jsonb(d.purchase_orders),
      'eligible',d.erp_docstatus=1 and not d.is_return and d.currency is not null and d.net_total is not null and d.net_total>0 and d.supplier is not null and not public.erp_document_recorded_by_pmo(d.org_id,d.erp_doctype,d.erp_name),
      'linker_source',jsonb_build_object('erp_name',d.erp_name,'erp_doctype',d.erp_doctype),
      'classification_unknown',exists(select 1 from public.erp_gl_entry_mirror g left join public.erp_account_mirror a on a.org_id=g.org_id and a.company=g.company and a.erp_name=g.account and not a.is_group
        where g.org_id=d.org_id and g.company=(select company from binding) and g.project=(select config->'project_map'->>d.project_ids[1]::text from binding)
          and g.voucher_type=d.erp_doctype and g.voucher_no=d.erp_name and not g.is_cancelled and (a.id is null or a.root_type is null)),
      'mapped_cost_present',exists(select 1 from public.erp_gl_entry_mirror g join public.budget_category_account_map m on m.org_id=g.org_id and m.erp_account=g.account
        join public.erp_account_mirror a on a.org_id=g.org_id and a.company=g.company and a.erp_name=g.account and not a.is_group and a.root_type='Expense'
        where g.org_id=d.org_id and g.company=(select company from binding) and g.project=(select config->'project_map'->>d.project_ids[1]::text from binding)
          and g.voucher_type=d.erp_doctype and g.voucher_no=d.erp_name and not g.is_cancelled),
      'family_incomplete',case when d.kind='supplier_invoice' then exists(select 1 from unnest(d.purchase_orders) order_name
        left join public.erp_purchase_documents orders on orders.org_id=d.org_id and public.capture_source_kind(orders.erp_doctype)='order' and orders.erp_name=order_name and orders.erp_docstatus=1
        where orders.id is null or not (orders.id=any(p_source_ids)))
        when d.kind='order' then exists(select 1 from public.erp_purchase_documents invoice where invoice.org_id=d.org_id and public.capture_source_kind(invoice.erp_doctype)='supplier_invoice'
          and d.erp_name=any(invoice.purchase_orders) and invoice.erp_docstatus=1 and not (invoice.id=any(p_source_ids))) else false end,
      'holds',coalesce((select jsonb_agg(jsonb_build_object('supplier_id',h.vendor_id,'project_id',h.project_id,'currency',h.currency,'purchase_id',h.id,
        'undo_command','node scripts/pmo.mjs purchases undo-record-only '||h.id::text||' --reason "Incorrect link"') order by h.id)
        from (select distinct p.id,d.vendor_id,d.project_ids[1] as project_id,d.currency from public.erp_purchase_captures cap
          join public.procurements p on p.id=cap.procurement_id and p.org_id=cap.org_id
          join public.procurement_erp_links l on l.procurement_id=p.id and l.org_id=cap.org_id
          join public.erp_purchase_documents original on original.id=l.erp_purchase_document_id and original.org_id=cap.org_id
          where cap.org_id=d.org_id and cap.undone_at is null and p.record_only and original.erp_docstatus=2
            and exists(select 1 from public.external_refs x where x.org_id=d.org_id and x.domain='companies' and x.external_tier='erpnext'
              and x.pmo_record_id=d.vendor_id::text and x.external_record_id in ('Supplier:'||original.supplier,original.supplier))
            and cardinality(original.project_ids)=1 and original.project_ids[1]=d.project_ids[1] and original.currency=d.currency) h),'[]'::jsonb)
    ) order by case when d.kind='order' then 0 else 1 end,d.erp_modified,d.id) from documents d),'[]'::jsonb)
  )
$$;
revoke execute on function public.capture_source_evidence(uuid,uuid,uuid[]) from public, anon, authenticated, service_role;

-- Scoped history census. Monetary and ownership decisions are made from server evidence.
-- Rollback: rollback/0866_erp_purchase_capture_down.sql
create or replace function public.purchase_capture_source_page(p_cursor uuid default null, p_project_id uuid default null, p_limit integer default 500)
returns jsonb language plpgsql stable security definer set search_path = public, pg_catalog as $$
declare
  v_org uuid := public.auth_org_id();
  v_generation text;
  v_sources jsonb;
  v_last uuid;
  v_more boolean;
begin
  if auth.uid() is null or v_org is null or not public.is_active_member() or public.auth_role()::text is distinct from 'Admin' then
    raise exception 'Only an active Admin can read purchase history.' using errcode = '42501';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 500 then
    raise exception 'invalid page size' using errcode = '22023';
  end if;
  if p_project_id is not null and not exists (select 1 from public.projects where id = p_project_id and org_id = v_org) then
    raise exception 'project not found' using errcode = 'P0002';
  end if;
  -- Include every persisted fact used to decide source, scope, mapping and ownership.
  -- Each page rechecks this witness, so a changed read cannot be accepted as one census.
  select encode(extensions.digest(convert_to(concat_ws(E'\n',
    coalesce((select string_agg(to_jsonb(d)::text, E'\n' order by d.id) from public.erp_purchase_documents d where d.org_id = v_org), ''),
    coalesce((select string_agg(to_jsonb(l)::text, E'\n' order by l.id) from public.procurement_erp_links l where l.org_id = v_org), ''),
    coalesce((select string_agg(to_jsonb(m)::text, E'\n' order by m.erp_purchase_document_id) from public.erp_purchase_document_marks m where m.org_id = v_org), ''),
    coalesce((select string_agg(to_jsonb(g)::text, E'\n' order by g.id) from public.erp_gl_entry_mirror g where g.org_id = v_org), ''),
    coalesce((select string_agg(to_jsonb(j)::text, E'\n' order by j.id) from public.erp_journal_line_links j where j.org_id = v_org), ''),
    coalesce((select string_agg(to_jsonb(a)::text, E'\n' order by a.id) from public.budget_category_account_map a where a.org_id = v_org), ''),
    coalesce((select string_agg(to_jsonb(a)::text, E'\n' order by a.id) from public.erp_account_mirror a where a.org_id = v_org), ''),
    coalesce((select string_agg(to_jsonb(s)::text, E'\n' order by s.id) from public.erp_actuals_snapshot s where s.org_id = v_org), ''),
    coalesce((select string_agg(to_jsonb(s)::text, E'\n' order by s.id) from public.erp_financial_statement_snapshot s where s.org_id = v_org), ''),
    coalesce((select string_agg(to_jsonb(c)::text, E'\n' order by c.snapshot_id,c.company) from public.erp_financial_statement_published_context c where c.org_id = v_org), ''),
    coalesce((select string_agg(to_jsonb(b)::text, E'\n' order by b.id) from public.external_org_bindings b where b.org_id = v_org), ''),
    coalesce((select string_agg(to_jsonb(f)::text, E'\n' order by f.binding_id,f.feed_kind) from public.erp_capture_feed_witnesses f where f.org_id = v_org), ''),
    coalesce((select string_agg(to_jsonb(x)::text, E'\n' order by x.id) from public.external_refs x where x.org_id = v_org), ''),
    coalesce((select string_agg(to_jsonb(p)::text, E'\n' order by p.id) from public.projects p where p.org_id = v_org), ''),
    coalesce((select string_agg(to_jsonb(c)::text, E'\n' order by c.id) from public.companies c where c.org_id = v_org), ''),
    coalesce((select string_agg(to_jsonb(p)::text, E'\n' order by p.id) from public.procurements p where p.org_id = v_org), ''),
    coalesce((select string_agg(to_jsonb(t)::text, E'\n' order by t.id) from public.purchase_requests t where t.org_id = v_org), ''),
    coalesce((select string_agg(to_jsonb(t)::text, E'\n' order by t.id) from public.purchase_orders t where t.org_id = v_org), ''),
    coalesce((select string_agg(to_jsonb(t)::text, E'\n' order by t.id) from public.procurement_receipts t where t.org_id = v_org), ''),
    coalesce((select string_agg(to_jsonb(t)::text, E'\n' order by t.id) from public.procurement_invoices t where t.org_id = v_org), ''),
    coalesce((select string_agg(to_jsonb(t)::text, E'\n' order by t.id) from public.payments t where t.org_id = v_org), ''),
    coalesce((select string_agg(to_jsonb(c)::text, E'\n' order by c.procurement_id,c.request_id) from public.erp_purchase_captures c where c.org_id = v_org), ''),
    coalesce((select string_agg(to_jsonb(o)::text, E'\n' order by o.domain) from public.external_domain_ownership o where o.org_id = v_org), ''),
    coalesce((select to_jsonb(o)::text from public.organizations o where o.id = v_org), '')
  ), 'UTF8'), 'sha256'), 'hex') into v_generation;
  with candidates as (
    select d.*, l.procurement_id, public.erp_document_recorded_by_pmo(d.org_id,d.erp_doctype,d.erp_name) as recorded_by_pmo,
      case when public.capture_source_kind(d.erp_doctype)='supplier_invoice' then exists (
        select 1 from unnest(d.purchase_orders) order_name where not exists (
          select 1 from public.erp_purchase_documents orders where orders.org_id=d.org_id and public.capture_source_kind(orders.erp_doctype)='order'
            and orders.erp_name=order_name and orders.erp_docstatus=1 and (p_project_id is null or p_project_id=any(orders.project_ids) or cardinality(orders.project_ids)=0)))
      when public.capture_source_kind(d.erp_doctype)='order' then exists (
        select 1 from public.erp_purchase_documents invoice where invoice.org_id=d.org_id and public.capture_source_kind(invoice.erp_doctype)='supplier_invoice'
          and d.erp_name=any(invoice.purchase_orders) and invoice.erp_docstatus=1
          and not (p_project_id is null or p_project_id=any(invoice.project_ids) or cardinality(invoice.project_ids)=0)) else false end as family_incomplete,
      (select case when count(distinct c.id) = 1 then (array_agg(distinct c.id))[1] end
         from public.external_refs x join public.companies c on c.id::text=x.pmo_record_id and c.org_id=x.org_id
        where x.org_id=d.org_id and x.domain='companies' and x.external_tier='erpnext'
          and x.external_record_id in ('Supplier:' || d.supplier,d.supplier) and c.archived_at is null and c.type='Vendor') as supplier_id,
      case when p.record_only and p.status::text not in ('Cancelled','Rejected') and exists (
        select 1 from public.erp_purchase_captures c where c.org_id=p.org_id and c.procurement_id=p.id
          and c.undone_at is null and c.kind in ('order','supplier_invoice')) then 'captured'
        when p.origin='erp_link' then 'erp_link' when p.id is not null then 'ordinary' end as purchase_origin
      from public.erp_purchase_documents d
      left join public.procurement_erp_links l on l.erp_purchase_document_id = d.id
      left join public.procurements p on p.id=l.procurement_id and p.org_id=d.org_id
     where d.org_id = v_org and (p_cursor is null or d.id > p_cursor)
       and (p_project_id is null or p_project_id = any(d.project_ids) or cardinality(d.project_ids) = 0)
     order by d.id limit p_limit
  )
  select coalesce(jsonb_agg(to_jsonb(c) || jsonb_build_object('kind', public.capture_source_kind(c.erp_doctype), 'net_total', c.net_total::text,
    'grand_total', c.grand_total::text, 'outstanding_amount', c.outstanding_amount::text,
    'needs_undo', case when c.procurement_id is null or c.erp_docstatus=2 then coalesce((
      select jsonb_agg(jsonb_build_object('supplier_id',h.vendor_id,'project_id',h.project_id,
        'currency',h.currency,'purchase_id',h.id,'undo_command',
        'node scripts/pmo.mjs purchases undo-record-only ' || h.id::text || ' --reason "Incorrect link"') order by h.id)
      from (select distinct p.id,coalesce(c.supplier_id,p.vendor_id) as vendor_id,original.project_ids[1] as project_id,original.currency
        from public.erp_purchase_captures cap
        join public.procurements p on p.id=cap.procurement_id and p.org_id=cap.org_id
        join public.procurement_erp_links l on l.procurement_id=p.id and l.org_id=cap.org_id
        join public.erp_purchase_documents original on original.id=l.erp_purchase_document_id and original.org_id=cap.org_id
        where cap.org_id=v_org and cap.undone_at is null and p.record_only
          and original.erp_docstatus=2 and ((c.id=original.id and c.procurement_id=p.id)
            or (exists (select 1 from public.external_refs x where x.org_id=v_org and x.domain='companies'
                and x.external_tier='erpnext' and x.pmo_record_id=c.supplier_id::text
                and x.external_record_id in ('Supplier:' || original.supplier,original.supplier))
              and cardinality(c.project_ids)=1
              and cardinality(original.project_ids)=1 and original.project_ids[1]=c.project_ids[1] and original.currency=c.currency))) h
    ),'[]'::jsonb) else '[]'::jsonb end) order by c.id), '[]'::jsonb),
    max(c.id::text)::uuid into v_sources, v_last from candidates c;
  select exists(select 1 from public.erp_purchase_documents d where d.org_id = v_org and d.id > v_last
    and (p_project_id is null or p_project_id = any(d.project_ids) or cardinality(d.project_ids) = 0)) into v_more;
  return jsonb_build_object('sources', v_sources, 'revision', v_generation, 'next_cursor', case when v_more then v_last end);
end $$;
revoke all on function public.purchase_capture_source_page(uuid, uuid, integer) from public, anon;
grant execute on function public.purchase_capture_source_page(uuid, uuid, integer) to authenticated;

-- The caller is the served adapter: it verifies the JWT and obtains precision once per run.
-- Only the service role can invoke this entry; org and source facts are re-read here.
create function public.capture_history_apply_internal(
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
    insert into public.erp_purchase_captures(org_id,binding_id,request_id,procurement_id,payload,kind,stage,captured_by)
      values(v_org,v_binding.id,p_request_id,v_purchase,v_payload,case when v_has_invoice then 'supplier_invoice' else 'order' end,v_stage,p_actor_id);
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
create function public.capture_history_apply(p_actor_id uuid,p_project_id uuid,p_request_id uuid,p_revision text,p_source_ids jsonb,p_precision jsonb,p_dry_run boolean default false)
returns jsonb language sql security definer set search_path=public,pg_catalog as $$
  select public.capture_history_apply_internal(p_actor_id,p_project_id,p_request_id,p_revision,p_source_ids,p_precision,p_dry_run,false)
$$;
revoke all on function public.capture_history_apply(uuid,uuid,uuid,text,jsonb,jsonb,boolean) from public, anon, authenticated;
grant execute on function public.capture_history_apply(uuid,uuid,uuid,text,jsonb,jsonb,boolean) to service_role;

create or replace function public.purchase_capture_ledger_page(p_cursor uuid default null, p_limit integer default 500, p_project_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public, pg_catalog as $$
declare v_org uuid := public.auth_org_id(); v_lines jsonb; v_last uuid; v_more boolean; v_revision text; v_binding uuid; v_count integer; v_tier text; v_company text;
begin
  if auth.uid() is null or v_org is null or not public.is_active_member() or public.auth_role()::text is distinct from 'Admin' then
    raise exception 'Only an active Admin can read purchase history.' using errcode='42501';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 500 then raise exception 'invalid page size' using errcode='22023'; end if;
  if p_project_id is not null and not exists(select 1 from public.projects where id=p_project_id and org_id=v_org) then raise exception 'project not found' using errcode='P0002'; end if;
  select count(*), (array_agg(id))[1], (array_agg(external_tier))[1], (array_agg(nullif(btrim(config->>'company'),'')))[1] into v_count, v_binding, v_tier, v_company
    from public.external_org_bindings where org_id=v_org and status='active' and activated_at is not null;
  if v_count <> 1 then return jsonb_build_object('outcome','refused','reason','binding_unavailable','erp_write',false); end if;
  if v_tier <> 'erpnext' then return jsonb_build_object('outcome','refused','reason','unsupported_adapter','erp_write',false); end if;
  v_revision := public.purchase_capture_source_page(null,null,1)->>'revision';
  with candidates as (
    select g.*, d.id as document_id, l.procurement_id as document_purchase_id,
      project.project_id, journal.procurement_id as journal_purchase_id,
      case when a.id is null then 'unknown'
        when a.root_type='Asset' then 'capital_spending'
        when a.root_type='Expense' and exists(select 1 from public.budget_category_account_map m where m.org_id=g.org_id and m.erp_account=g.account) then 'mapped'
        else 'unmapped' end as classification
    from public.erp_gl_entry_mirror g
    left join public.erp_purchase_documents d on g.company=v_company and d.org_id=g.org_id and d.erp_doctype=g.voucher_type and d.erp_name=g.voucher_no
    left join public.procurement_erp_links l on l.erp_purchase_document_id=d.id
    left join lateral (
      select case when count(distinct entry.key) = 1 then min(entry.key)::uuid end as project_id
      from public.external_org_bindings b cross join lateral jsonb_each_text(coalesce(b.config->'project_map','{}'::jsonb)) entry
      where b.org_id=g.org_id and b.id=v_binding
        and v_company=g.company and entry.value=g.project
        and entry.key ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
    ) project on true
    left join public.erp_journal_line_links journal on journal.org_id=g.org_id and journal.project_id=project.project_id
      and journal.erp_doctype=g.voucher_type and journal.voucher_no=g.voucher_no and journal.account=g.account
    left join public.erp_account_mirror a on a.org_id=g.org_id and a.company=g.company and a.erp_name=g.account and not a.is_group
    where g.org_id=v_org and not g.is_cancelled and (p_cursor is null or g.id>p_cursor)
      and (p_project_id is null or project.project_id=p_project_id)
    order by g.id limit p_limit + 1
  ), page as (select * from candidates order by id limit p_limit)
  select coalesce(jsonb_agg(to_jsonb(c) || jsonb_build_object('kind',public.capture_source_kind(c.voucher_type),'debit',c.debit::text,'credit',c.credit::text) order by c.id),'[]'::jsonb), max(c.id::text)::uuid,
    (select count(*) > p_limit from candidates)
    into v_lines,v_last,v_more from page c;
  return jsonb_build_object('lines',v_lines,'revision',v_revision,'next_cursor',case when v_more then v_last end);
end $$;
revoke all on function public.purchase_capture_ledger_page(uuid,integer,uuid) from public, anon;
grant execute on function public.purchase_capture_ledger_page(uuid,integer,uuid) to authenticated;

create table public.erp_capture_feed_witnesses (
  binding_id uuid not null references public.external_org_bindings(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  feed_kind text not null check (feed_kind in ('purchases','ledger')),
  started_at timestamptz not null,
  run_id uuid not null default gen_random_uuid(),
  completed boolean not null default true,
  primary key (binding_id,feed_kind)
);
alter table public.erp_capture_feed_witnesses enable row level security;
alter table public.erp_capture_feed_witnesses force row level security;
revoke all on public.erp_capture_feed_witnesses from public, anon, authenticated, service_role;

create function public.record_capture_feed_start(p_org_id uuid,p_binding_id uuid,p_kind text,p_started_at timestamptz,p_run_id uuid)
returns void language plpgsql security definer set search_path = public, pg_catalog as $$
begin
  if coalesce(auth.jwt()->>'role','') <> 'service_role' then raise exception 'not authorized' using errcode='42501'; end if;
  if p_kind not in ('purchases','ledger') or p_run_id is null or p_started_at is null or p_started_at > clock_timestamp()
    or not exists (select 1 from public.external_org_bindings b where b.id=p_binding_id and b.org_id=p_org_id
      and b.status='active' and b.activated_at is not null and p_started_at >= b.activated_at) then
    raise exception 'invalid feed start' using errcode='22023';
  end if;
  insert into public.erp_capture_feed_witnesses(org_id,binding_id,feed_kind,started_at,run_id,completed)
    values(p_org_id,p_binding_id,p_kind,p_started_at,p_run_id,false)
  on conflict (binding_id,feed_kind) do update set started_at=excluded.started_at,run_id=excluded.run_id,completed=false
    where erp_capture_feed_witnesses.org_id=excluded.org_id and erp_capture_feed_witnesses.started_at <= excluded.started_at;
end $$;
revoke all on function public.record_capture_feed_start(uuid,uuid,text,timestamptz,uuid) from public,anon,authenticated;
grant execute on function public.record_capture_feed_start(uuid,uuid,text,timestamptz,uuid) to service_role;

create function public.record_capture_feed_completion(p_org_id uuid,p_binding_id uuid,p_kind text,p_started_at timestamptz,p_run_id uuid)
returns void language plpgsql security definer set search_path = public, pg_catalog as $$
begin
  if coalesce(auth.jwt()->>'role','') <> 'service_role' then raise exception 'not authorized' using errcode='42501'; end if;
  update public.erp_capture_feed_witnesses set completed=true
    where org_id=p_org_id and binding_id=p_binding_id and feed_kind=p_kind and started_at=p_started_at and run_id=p_run_id
      and exists (select 1 from public.external_org_bindings b where b.id=p_binding_id and b.org_id=p_org_id
        and b.status='active' and b.activated_at is not null and p_started_at >= b.activated_at);
end $$;
revoke all on function public.record_capture_feed_completion(uuid,uuid,text,timestamptz,uuid) from public,anon,authenticated;
grant execute on function public.record_capture_feed_completion(uuid,uuid,text,timestamptz,uuid) to service_role;

create or replace function public.purchase_capture_feed_health()
returns jsonb language plpgsql stable security definer set search_path = public, pg_catalog as $$
declare v_org uuid := public.auth_org_id(); v_binding uuid; v_count integer; v_since timestamptz; v_purchase timestamptz; v_ledger timestamptz; v_caught boolean; v_currency text; v_currency_count integer;
begin
  if auth.uid() is null or v_org is null or not public.is_active_member() or public.auth_role()::text is distinct from 'Admin' then
    raise exception 'Only an active Admin can read capture health.' using errcode='42501';
  end if;
  select count(*),(array_agg(id))[1],(array_agg(activated_at))[1] into v_count,v_binding,v_since
    from public.external_org_bindings where org_id=v_org and status='active' and activated_at is not null;
  if v_count <> 1 then return jsonb_build_object('caught_up',false,'reason','binding_unavailable'); end if;
  select max(started_at) filter (where feed_kind='purchases'), max(started_at) filter (where feed_kind='ledger')
    into v_purchase,v_ledger from public.erp_capture_feed_witnesses where org_id=v_org and binding_id=v_binding and completed;
  v_caught := coalesce(v_purchase >= greatest(v_since,now()-interval '30 minutes') and v_ledger >= greatest(v_since,now()-interval '30 minutes'),false);
  select count(distinct s.currency),min(s.currency) into v_currency_count,v_currency
    from public.erp_financial_statement_snapshot s
    join public.erp_financial_statement_published_context c on c.org_id=s.org_id and c.company=s.company
      and c.snapshot_id=s.snapshot_id and c.source_generation=s.source_generation
    join public.external_org_bindings b on b.id=v_binding and b.org_id=s.org_id and b.config->>'company'=s.company
   where s.org_id=v_org and s.published_at >= greatest(v_since,now()-interval '30 minutes')
     and c.context#>>'{presentation,context,raw,company,name}'=s.company
     and c.context#>>'{presentation,context,raw,company,currency}'=s.currency;
  if v_currency_count <> 1 then v_currency := null; end if;
  return jsonb_build_object('caught_up',v_caught,'purchases_started_at',v_purchase,'ledger_started_at',v_ledger,
    'ledger_currency',v_currency,'reason',case when v_caught then null else 'feed_not_current' end);
end $$;
revoke all on function public.purchase_capture_feed_health() from public,anon;
grant execute on function public.purchase_capture_feed_health() to authenticated;

-- Preserve the established journal undo while adding the document-family branch.
alter function public.undo_captured_purchase(uuid,text,boolean) rename to undo_captured_journal_purchase;
revoke all on function public.undo_captured_journal_purchase(uuid,text,boolean) from public,anon,authenticated,service_role;
create function public.guard_capture_document_link() returns trigger
language plpgsql security definer set search_path=public,pg_catalog as $$
begin
  if exists (select 1 from public.procurements p where p.record_only and
    (p.id=new.procurement_id or (tg_op='UPDATE' and p.id=old.procurement_id))) then
    raise exception 'record_only_use_capture' using errcode='PFE02';
  end if;
  return new;
end $$;
revoke all on function public.guard_capture_document_link() from public,anon,authenticated,service_role;
create trigger z_record_only_capture_link_guard before insert or update on public.procurement_erp_links
for each row execute function public.guard_capture_document_link();

create function public.undo_captured_purchase(p_procurement_id uuid,p_reason text,p_dry_run boolean default false)
returns jsonb language plpgsql security definer set search_path=public,pg_catalog as $$
declare v_org uuid := public.auth_org_id(); v_kind text; v_proc public.procurements%rowtype; v_history jsonb;
begin
  select kind into v_kind from public.erp_purchase_captures where org_id=v_org and procurement_id=p_procurement_id;
  if v_kind is null or v_kind='journal' then
    return public.undo_captured_journal_purchase(p_procurement_id,p_reason,p_dry_run);
  end if;
  perform public.assert_is_active_member();
  if public.auth_role()::text is distinct from 'Admin' then raise exception 'not authorized' using errcode='42501'; end if;
  if nullif(btrim(p_reason),'') is null then raise exception 'reason_required' using errcode='22023'; end if;
  select * into v_proc from public.procurements where id=p_procurement_id and org_id=v_org for update;
  if not found or not v_proc.record_only or v_kind not in ('order','supplier_invoice') then raise exception 'purchase_not_found' using errcode='P0002'; end if;
  perform 1 from public.erp_purchase_captures where org_id=v_org and procurement_id=p_procurement_id for update;
  select coalesce(jsonb_agg(distinct s.value order by s.value),'[]'::jsonb) into v_history
    from public.erp_purchase_captures c cross join lateral jsonb_array_elements(c.payload->'source_ids') s(value)
    where c.org_id=v_org and c.procurement_id=p_procurement_id;
  if v_proc.status='Cancelled' then return jsonb_build_object('outcome','skip','reason','already_undone'); end if;
  if exists(select 1 from public.purchase_requests where procurement_id=p_procurement_id)
    or exists(select 1 from public.rfqs where procurement_id=p_procurement_id)
    or exists(select 1 from public.procurement_quotations where procurement_id=p_procurement_id)
    or exists(select 1 from public.purchase_orders where procurement_id=p_procurement_id)
    or exists(select 1 from public.procurement_receipts where procurement_id=p_procurement_id)
    or exists(select 1 from public.procurement_invoices where procurement_id=p_procurement_id)
    or exists(select 1 from public.payments where procurement_id=p_procurement_id) then
    raise exception 'has_later_pmo_steps' using errcode='55000';
  end if;
  if not p_dry_run then
    update public.procurement_documents set record_kind=null,record_id=null
      where procurement_id=p_procurement_id and record_kind='erp_document';
    delete from public.procurement_erp_links where org_id=v_org and procurement_id=p_procurement_id;
    update public.procurements set status='Cancelled',updated_at=now() where id=p_procurement_id;
    update public.erp_purchase_captures set undone_at=now(),undo_reason=p_reason where org_id=v_org and procurement_id=p_procurement_id;
    perform public.log_audit('procurement.record_only_undo',v_org,auth.uid(),p_procurement_id,
      jsonb_build_object('project_id',v_proc.project_id,'vendor_id',v_proc.vendor_id,'sources',v_history,
        'reason',p_reason,'assignment_origin','erp_project','actuals_delta',0));
  end if;
  return jsonb_build_object('outcome','undo','dry_run',p_dry_run,'procurement_id',p_procurement_id,'erp_write',false);
end $$;
revoke all on function public.undo_captured_purchase(uuid,text,boolean) from public,anon;
grant execute on function public.undo_captured_purchase(uuid,text,boolean) to authenticated;

alter function public.unlink_erp_purchase_document(uuid) rename to unlink_erp_purchase_document_unchecked;
revoke all on function public.unlink_erp_purchase_document_unchecked(uuid) from public,anon,authenticated,service_role;
create function public.unlink_erp_purchase_document(p_link_id uuid) returns void
language plpgsql security definer set search_path=public,pg_catalog as $$
declare v_proc uuid; v_record_only boolean;
begin
  perform public.assert_is_active_member();
  if coalesce(public.auth_role()::text,'') not in ('Admin','Finance') then raise exception 'not authorized' using errcode='42501'; end if;
  select l.procurement_id into v_proc from public.procurement_erp_links l where l.id=p_link_id and l.org_id=public.auth_org_id();
  if not found then raise exception 'link not found' using errcode='P0002'; end if;
  select p.record_only into v_record_only from public.procurements p where p.id=v_proc and p.org_id=public.auth_org_id() for update;
  if v_record_only then raise exception 'record_only_use_undo' using errcode='42501'; end if;
  perform public.unlink_erp_purchase_document_unchecked(p_link_id);
end $$;
revoke all on function public.unlink_erp_purchase_document(uuid) from public,anon;
grant execute on function public.unlink_erp_purchase_document(uuid) to authenticated;

-- Per-organization shared writer fences keep canonical apply from accepting a changed census.
create function public.fence_capture_source_change() returns trigger
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
do $$
declare v_table text;
begin
  foreach v_table in array array['erp_purchase_documents','procurement_erp_links','erp_purchase_document_marks',
    'erp_gl_entry_mirror','erp_journal_line_links','budget_category_account_map','erp_account_mirror',
    'erp_actuals_snapshot','erp_financial_statement_snapshot','erp_financial_statement_published_context',
    'external_org_bindings','external_refs','projects','companies','procurements','external_domain_ownership',
    'organizations','erp_capture_feed_witnesses','erp_purchase_captures','purchase_requests','purchase_orders',
    'procurement_receipts','procurement_invoices','payments'] loop
    execute format('create trigger capture_census_fence before insert or update or delete on public.%I for each row execute function public.fence_capture_source_change()',v_table);
  end loop;
end $$;

-- A request owns its reviewed source groups and durable continuation checkpoint.
create table public.erp_capture_batches (
  org_id uuid not null references public.organizations(id),
  request_id uuid not null,
  actor_id uuid not null references public.profiles(id),
  project_id uuid references public.projects(id),
  reviewed_revision text not null,
  current_revision text not null,
  precision jsonb not null,
  groups jsonb not null,
  next_index integer not null default 0,
  results jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  primary key (org_id,request_id)
);
alter table public.erp_capture_batches enable row level security;
alter table public.erp_capture_batches force row level security;
revoke all on public.erp_capture_batches from public,anon,authenticated,service_role;

create function public.capture_history_batch(p_actor_id uuid,p_project_id uuid,p_request_id uuid,p_revision text,p_precision jsonb,p_groups jsonb)
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
