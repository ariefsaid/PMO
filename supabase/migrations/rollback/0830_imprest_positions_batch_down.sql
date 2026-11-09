-- rollback/0830_imprest_positions_batch_down.sql — reverse of 0830_imprest_positions_batch.sql.
-- The batched read is additive: nothing else depends on it, and get_imprest_position is untouched, so the
-- pre-0830 behaviour (one position request per float) returns as soon as the FE stops calling this function.
begin;

drop function if exists public.get_imprest_positions(uuid[]);

commit;
