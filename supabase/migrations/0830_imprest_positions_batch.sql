-- 0830_imprest_positions_batch.sql — #2106 (AC-PERF-2106-1): the /imprest list's positions in ONE request.
--
-- Before: pages/ImprestFloats.tsx rendered one PositionFigure per money cell and each called
-- get_imprest_position(float) — up to 200 identities' worth of separate ledger aggregates for one list, with every
-- money column reading "…" until its own request landed. After: one get_imprest_positions(uuid[]) call fills the
-- whole page. Same per-float figures, same RLS, one round trip.
--
-- SECURITY INVOKER on purpose (the 0424 §2 precedent): every internal read is the caller's, so a float the caller
-- may not see yields no row (AC-IMP-050 / imprest_positions_batch.test.sql). It must NOT be converted to DEFINER —
-- that would let a caller name any float id and read a position RLS would otherwise withhold.
-- Rollback: rollback/0830_imprest_positions_batch_down.sql
begin;

-- The batched twin of get_imprest_position: identical output row, one row per DISTINCT requested id, in the order
-- the ids were asked for. The 200 bound mirrors the list's LIST_LIMIT (src/lib/db/imprest.ts) so a caller cannot
-- turn one request into an unbounded ledger scan.
create or replace function public.get_imprest_positions(p_float_ids uuid[])
returns table (float_id uuid, float_amount numeric, cash_book numeric, advances_out numeric, receipts_waiting numeric,
               replenishment_in_flight numeric, gap numeric, last_count_at timestamptz, last_count_variance numeric,
               month date, plan_lines jsonb, funded_total numeric)
language plpgsql stable security invoker set search_path = public, pg_temp as $$
begin
  if p_float_ids is null or cardinality(p_float_ids) = 0 then
    return;
  end if;
  if cardinality(p_float_ids) > 200 then
    raise exception 'at most 200 floats per position read' using errcode = 'P0001';
  end if;
  return query
    with req as (
      select t.id, min(t.ord) as ord
        from unnest(p_float_ids) with ordinality as t(id, ord)
       group by t.id
    )
    select p.*
      from req
      join lateral public.get_imprest_position(req.id) p on true
     order by req.ord;
end; $$;
revoke all on function public.get_imprest_positions(uuid[]) from public, anon;
grant execute on function public.get_imprest_positions(uuid[]) to authenticated;

commit;
