-- Connected inventory uses the existing outbox and keeps the stock document as intent.
create function public.stock_command_actor_rank(p_org uuid, p_actor uuid) returns integer
language sql stable security definer set search_path = public, pg_temp as $$
  select public.role_rank(p.role) from public.profiles p
   where p.id=p_actor and p.org_id=p_org and public.is_active_member(p_actor)
$$;
revoke all on function public.stock_command_actor_rank(uuid,uuid) from public, anon, authenticated, service_role;

create function public.guard_stock_employment() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.domain='inventory' and exists (select 1 from public.stock_documents d where d.org_id=new.org_id and d.status='Draft') then
    raise exception 'STK_DRAFTS_EXIST: resolve draft stock documents before employing inventory' using errcode='P0001';
  end if;
  return new;
end $$;
revoke all on function public.guard_stock_employment() from public, anon, authenticated, service_role;
create trigger external_domain_ownership_stock_drafts before insert on public.external_domain_ownership
for each row execute function public.guard_stock_employment();

create function public.guard_stock_command() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare d public.stock_documents; v_rank integer; v_keeper boolean; v_company text;
begin
  if new.domain <> 'inventory' then return new; end if;
  if tg_op='UPDATE' and new.claim_generation <= old.claim_generation and not (new.state='committing' and old.state is distinct from 'committing') then return new; end if;
  select * into d from public.stock_documents where id::text=new.pmo_record_id for update;
  if not found or d.org_id is distinct from new.org_id then
    raise exception 'STK_NOT_FOUND: the document is not in this organisation' using errcode='P0001';
  end if;
  if new.idempotency_key is distinct from 'stock:'||new.pmo_record_id or new.external_tier is distinct from 'odoo'
     or new.operation is distinct from 'create' or new.actor_user_id is null then
    raise exception 'STK_COMMAND: invalid command identity or actor' using errcode='P0001';
  end if;
  perform 1 from public.external_domain_ownership where org_id=new.org_id and domain='inventory' and external_tier=new.external_tier for share;
  if not found then raise exception 'STK_OWNERSHIP: inventory is not employed by this ERP' using errcode='P0001'; end if;
  select config->>'odoo_company_id' into v_company from public.external_org_bindings
   where org_id=new.org_id and external_tier='odoo' and status='active' and activated_at is not null for share;
  if v_company is null or jsonb_typeof(new.payload->'odooCompanyId') is distinct from 'number' or new.payload->>'odooCompanyId' is distinct from v_company then
    raise exception 'STK_COMPANY: connected company does not match' using errcode='P0001';
  end if;
  if d.status <> 'Draft' or d.kind not in ('transfer','issue')
     or new.payload->>'stockDocumentId' is distinct from d.id::text
     or new.payload->'documentRevision' is distinct from to_jsonb(d.revision) then
    raise exception 'STK_COMMAND: document is not a current eligible draft' using errcode='P0001';
  end if;
  v_rank := public.stock_command_actor_rank(new.org_id,new.actor_user_id);
  if v_rank is null then raise exception 'STK_ACTOR: actor is not an active organisation member' using errcode='42501'; end if;
  select exists (select 1 from public.stock_warehouse_keepers k where k.org_id=new.org_id and k.warehouse_id=d.warehouse_id and k.user_id=new.actor_user_id) into v_keeper;
  if not v_keeper and v_rank < 50 then raise exception 'STK_NOT_KEEPER: you do not keep this warehouse' using errcode='P0001'; end if;
  if d.occurred_on > public.stock_org_today(d.org_id) then raise exception 'STK_BACKDATE: a stock movement cannot be dated in the future' using errcode='P0001'; end if;
  if d.occurred_on < public.stock_org_today(d.org_id)-31 and v_rank < 50 then raise exception 'STK_BACKDATE: only an Admin may date a movement more than 31 days back' using errcode='P0001'; end if;
  if d.kind='issue' then perform public.stock_apply_issue(d,false); end if;
  perform 1 from public.stock_warehouses w where w.id in (d.warehouse_id, coalesce(d.to_warehouse_id,d.warehouse_id)) order by w.id for share;
  perform 1 from public.stock_items i where i.id in (select l.item_id from public.stock_document_lines l where l.document_id=d.id) order by i.id for share;
  if exists (select 1 from public.stock_warehouses w where w.id in (d.warehouse_id,coalesce(d.to_warehouse_id,d.warehouse_id)) and w.archived_at is not null)
     or exists (select 1 from public.stock_document_lines l join public.stock_items i on i.id=l.item_id where l.document_id=d.id and i.archived_at is not null) then
    raise exception 'STK_ARCHIVED: a warehouse or item on this document was archived' using errcode='P0001'; end if;
  if tg_op='INSERT' and not v_keeper then
    perform public.log_audit('stock.admin_post',d.org_id,new.actor_user_id,d.id,jsonb_build_object('kind',d.kind,'warehouse_id',d.warehouse_id,'number',d.number));
  end if;
  return new;
end $$;
revoke all on function public.guard_stock_command() from public, anon, authenticated, service_role;
create trigger external_command_outbox_zz_stock_command before insert or update of claim_generation, state on public.external_command_outbox
for each row execute function public.guard_stock_command();

create function public.guard_stock_command_document() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_doc uuid; v_org uuid; v_confirmed boolean;
begin
  if tg_table_name='stock_documents' then v_doc:=old.id; v_org:=old.org_id;
  else
    if tg_op='INSERT' then v_doc:=new.document_id; v_org:=new.org_id; else v_doc:=old.document_id; v_org:=old.org_id; end if;
    if tg_op='UPDATE' then
      perform 1 from public.stock_documents where id in (old.document_id,new.document_id) order by id for update;
      if (new.document_id,new.org_id) is distinct from (old.document_id,old.org_id)
         and exists(select 1 from public.external_command_outbox o where o.domain='inventory' and o.org_id=(select d.org_id from public.stock_documents d where d.id=new.document_id) and o.pmo_record_id=new.document_id::text and o.state<>'failed') then
        raise exception 'STK_PENDING: a connected stock command is live' using errcode='P0001';
      end if;
    else
      perform 1 from public.stock_documents where id=v_doc for update;
    end if;
    select d.org_id into v_org from public.stock_documents d where d.id=v_doc;
  end if;
  if exists(select 1 from public.external_command_outbox o where o.domain='inventory' and o.org_id=v_org and o.pmo_record_id=v_doc::text and o.state<>'failed') then
    if tg_table_name='stock_documents' and tg_op='UPDATE' then
      select exists(select 1 from public.external_command_outbox o where o.domain='inventory' and o.org_id=v_org and o.pmo_record_id=v_doc::text and o.state='confirmed' and o.actor_user_id=new.posted_by) into v_confirmed;
      if v_confirmed and old.status='Draft' and new.status='Posted' and new.posted_at is not null
         and (to_jsonb(new)-array['status','posted_by','posted_at']) = (to_jsonb(old)-array['status','posted_by','posted_at']) then return new; end if;
    end if;
    raise exception 'STK_PENDING: a connected stock command is live' using errcode='P0001';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
revoke all on function public.guard_stock_command_document() from public, anon, authenticated, service_role;
create trigger stock_documents_command_guard before update or delete on public.stock_documents for each row execute function public.guard_stock_command_document();
create trigger stock_document_lines_command_guard before insert or update or delete on public.stock_document_lines for each row execute function public.guard_stock_command_document();
