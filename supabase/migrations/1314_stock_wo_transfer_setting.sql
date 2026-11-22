-- 1314_stock_wo_transfer_setting.sql — #2691. The organisation setting "work-order transfers" (default off), written only by an Admin RPC, audited.
-- Proven by supabase/tests/1314_stock_wo_transfer_setting.test.sql. post_stock_wo_transfer (1312) refuses while it is off (STK_WOT_OFF).
-- ── REVERSE (also rollback/1314_stock_wo_transfer_setting_down.sql): drop the two functions, then the column.
alter table public.organizations add column stock_wo_transfers boolean not null default false;

create or replace function public.stock_wo_transfers_on(p_org uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce((select o.stock_wo_transfers from public.organizations o where o.id = p_org), false) $$;
revoke all on function public.stock_wo_transfers_on(uuid) from public, anon;
grant execute on function public.stock_wo_transfers_on(uuid) to authenticated;

create or replace function public.set_stock_wo_transfers(p_on boolean) returns boolean
  language plpgsql volatile security definer set search_path = public as $$
declare v_org uuid; v_old boolean;
begin
  perform public.assert_is_active_member();
  v_org := public.auth_org_id();
  if not coalesce(public.role_rank(public.auth_role()) >= 50, false) then                          -- mut:wot_setting_admin
    raise exception 'STK_FORBIDDEN: only an Admin changes work-order transfers' using errcode = '42501'; end if;
  if p_on is null then raise exception 'STK_INVALID: work-order transfers are on or off' using errcode = 'P0001'; end if;
  perform public.stock_assert_standalone(v_org);
  select o.stock_wo_transfers into v_old from public.organizations o where o.id = v_org for update;
  if v_old = p_on then return v_old; end if;
  update public.organizations set stock_wo_transfers = p_on where id = v_org;
  perform public.log_audit('stock.wo_transfers', v_org, auth.uid(), v_org, jsonb_build_object('from', v_old, 'to', p_on));
  return p_on;
end $$;
revoke all on function public.set_stock_wo_transfers(boolean) from public, anon;
grant execute on function public.set_stock_wo_transfers(boolean) to authenticated;
