-- Reverses 0416_stock_adjust_count.sql (#1512 S4): restores the S2a stubs verbatim and drops the write-off rule. Pre-production reversal is also `supabase db reset`.
create or replace function public.stock_apply_adjustment(p_doc public.stock_documents, p_post boolean) returns void language plpgsql as $$
begin raise exception 'STK_KIND_UNAVAILABLE: adjustment posting is not enabled yet' using errcode = 'P0001'; end $$;
create or replace function public.stock_apply_count(p_doc public.stock_documents, p_post boolean) returns void language plpgsql as $$
begin raise exception 'STK_KIND_UNAVAILABLE: count posting is not enabled yet' using errcode = 'P0001'; end $$;
revoke all on function public.stock_apply_adjustment(public.stock_documents, boolean), public.stock_apply_count(public.stock_documents, boolean)
  from public, anon, authenticated, service_role;
drop function if exists public.stock_assert_writeoff_approver(public.stock_documents, uuid);
