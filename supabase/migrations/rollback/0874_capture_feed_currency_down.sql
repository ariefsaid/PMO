-- Restores the 0866 completion and health bodies, then removes the currency column and its writer.
create or replace function public.record_capture_feed_completion(p_org_id uuid,p_binding_id uuid,p_kind text,p_started_at timestamptz,p_run_id uuid)
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
drop function public.record_capture_feed_completion(uuid,uuid,text,timestamptz,uuid,text);
alter table public.erp_capture_feed_witnesses drop column ledger_currency;
