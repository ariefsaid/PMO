-- Reverses 0975_erp_account_send.sql. Queued account sends are dismissed first so the drain never claims a kind it no longer links;
-- accounts already created in the ERP and their budget_category_account_map rows stay (they are ordinary mappings).
update public.erp_connect_proposals set state = 'dismissed' where kind = 'account' and outcome = 'send' and state = 'sending';
drop function if exists public.request_account_send(text, text, text, text);
drop function if exists public.account_send_groups(text);
-- connect_send_existing_link as 0741 shipped it
create or replace function public.connect_send_existing_link(p_org_id uuid, p_tier text, p_kind text, p_pmo text) returns text
language sql security definer set search_path = public, pg_temp as $$
  select case p_kind
    when 'party' then (select r.external_record_id from public.external_refs r
                        where r.org_id = p_org_id and r.domain = 'companies' and r.pmo_record_id = p_pmo)
    when 'project' then case when p_tier = 'odoo'
                          then (select b.external_container_id from public.external_project_bindings b
                                 where b.org_id = p_org_id and b.external_tier = 'odoo' and b.project_id::text = p_pmo)
                          else (select b.config->'project_map'->>p_pmo from public.external_org_bindings b
                                 where b.org_id = p_org_id and b.external_tier = p_tier and b.status = 'active')
                        end
    when 'item' then (select b.config->'item_map'->>p_pmo from public.external_org_bindings b
                       where b.org_id = p_org_id and b.external_tier = p_tier and b.status = 'active')
  end
$$;
-- record_connect_send_failure and record_connect_send_held as 0494 shipped them
create or replace function public.record_connect_send_failure(p_org_id uuid, p_id uuid) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare p public.erp_connect_proposals%rowtype;
begin
  select * into p from public.erp_connect_proposals where id = p_id and org_id = p_org_id for update;
  if not found then raise exception 'unknown proposal' using errcode = 'P0002'; end if;
  if p.state <> 'sending' or p.outcome <> 'send' then return false; end if;
  update public.erp_connect_proposals set send_failures = send_failures + 1 where id = p.id returning send_failures into p.send_failures;
  if p.send_failures < 5 then return false; end if;
  perform public.record_connect_send_result(p_org_id, p_id, null, 'We could not finish sending this record. Check it in the ERP, then try again.');
  return true;
end $$;

create or replace function public.record_connect_send_held(p_org_id uuid, p_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare p public.erp_connect_proposals%rowtype;
begin
  select * into p from public.erp_connect_proposals where id = p_id and org_id = p_org_id for update;
  if not found then raise exception 'unknown proposal' using errcode = 'P0002'; end if;
  if p.state <> 'sending' or p.outcome <> 'send' then return; end if;
  update public.erp_connect_proposals
     set outcome = 'review', reason = 'held', reason_text = 'We could not confirm whether the ERP created this record. Look for it in the ERP by name and tax id; if it is not there, send it again.', state = 'open', run_id = null,
         identity = 'review|' || to_jsonb(p.pmo_ids)::text || '|' || to_jsonb(p.external_ids)::text || '|send:' || p.id::text
   where id = p.id;
  perform public.settle_connect_run(p.org_id, p.external_tier);
end $$;
drop function if exists public.record_connect_send_result(uuid, uuid, text, text, text);
