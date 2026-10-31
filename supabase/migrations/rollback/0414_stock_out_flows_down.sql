-- Reverses 0414_stock_out_flows.sql (#1512 S2b): restores the S2a stubs verbatim. Pre-production reversal is also `supabase db reset`.
create or replace function public.stock_apply_issue(p_doc public.stock_documents, p_post boolean) returns void language plpgsql as $$
begin raise exception 'STK_KIND_UNAVAILABLE: issue posting is not enabled yet' using errcode = 'P0001'; end $$;
create or replace function public.stock_apply_return(p_doc public.stock_documents, p_post boolean) returns void language plpgsql as $$
begin raise exception 'STK_KIND_UNAVAILABLE: return posting is not enabled yet' using errcode = 'P0001'; end $$;
revoke all on function public.stock_apply_issue(public.stock_documents, boolean), public.stock_apply_return(public.stock_documents, boolean)
  from public, anon, authenticated, service_role;
