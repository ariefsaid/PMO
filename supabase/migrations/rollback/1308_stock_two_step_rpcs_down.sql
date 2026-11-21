-- 1308_stock_two_step_rpcs_down.sql — reverse 1308.
drop function if exists public.record_stock_handover(uuid, jsonb);
drop function if exists public.resolve_stock_transfer_shortfall(uuid, text, text);
drop function if exists public.recall_stock_transfer(uuid, text);
drop function if exists public.receive_stock_transfer(uuid, jsonb, jsonb);
drop function if exists public.send_stock_transfer(jsonb, jsonb, uuid, uuid);
drop function if exists public.stock_lock_transfer(uuid, boolean);
drop function if exists public.stock_insert_handover(public.stock_transfers, jsonb);
drop function if exists public.stock_post_leg(public.stock_transfers, text, uuid, uuid, jsonb, uuid, text, uuid);
drop function if exists public.stock_close_transit(public.stock_transfers);
drop function if exists public.stock_proof_missing(uuid);
drop function if exists public.stock_assert_not_self_receive(public.stock_transfers);
drop function if exists public.stock_transfer_actor_ok(public.stock_transfers, text);
