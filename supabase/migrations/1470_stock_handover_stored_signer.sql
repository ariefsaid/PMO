-- 1470_stock_handover_stored_signer.sql — a late handover confirmation is checked on the values the row stores (FR-TST-044).
-- An empty signer kind or proof type means the account / in-app value, so the sender-is-not-the-receiver rule refuses them
-- exactly as the explicit values are refused. The check now lives in stock_insert_handover, after normalisation, so the
-- receive RPC and the late-confirmation RPC share one rule instead of each testing the raw payload.
-- Changes only those two functions (whole, from 1308); every other body and gate is unchanged.
-- REVERSE: rollback/1470_stock_handover_stored_signer_down.sql
create or replace function public.stock_insert_handover(p_t public.stock_transfers, p_conf jsonb) returns uuid
  language plpgsql volatile security definer set search_path = public as $$
declare v_id uuid; v_stage text; v_type text; v_kind text; v_name text; v_counts jsonb; v_uid uuid := auth.uid();
begin
  if p_conf is null or jsonb_typeof(p_conf) <> 'object' then raise exception 'STK_INVALID: the confirmation is malformed' using errcode = 'P0001'; end if;
  v_id := coalesce(nullif(p_conf->>'id', '')::uuid, gen_random_uuid());
  v_stage := p_conf->>'stage'; v_type := coalesce(nullif(p_conf->>'proof_type', ''), 'in_app'); v_kind := coalesce(nullif(p_conf->>'signer_kind', ''), 'account');
  if v_stage not in ('send', 'receive') or v_type not in ('in_app', 'paper') or v_kind not in ('account', 'guest') then
    raise exception 'STK_INVALID: the confirmation names an unknown stage, proof or signer' using errcode = 'P0001'; end if;
  -- The stored values decide: an account signer on an in-app proof at the receive stage is the person recording it.
  if v_stage = 'receive' and v_kind = 'account' and v_type = 'in_app' then
    perform public.stock_assert_not_self_receive(p_t);
  end if;
  if p_t.status = 'Cancelled' then raise exception 'STK_INVALID: a cancelled transfer takes no confirmation' using errcode = 'P0001'; end if;
  if v_stage = 'receive' and exists (select 1 from public.stock_transfer_lines l where l.transfer_id = p_t.id and l.qty_counted is null) then
    raise exception 'STK_INVALID: a receive confirmation needs the count first' using errcode = 'P0001'; end if;
  if v_kind = 'guest' then v_name := btrim(coalesce(p_conf->>'signer_name', ''));
  else select p.full_name into v_name from public.profiles p where p.id = v_uid; end if;
  select jsonb_agg(jsonb_build_object('line_id', l.id, 'item_id', l.item_id,
                                      'quantity', case when v_stage = 'send' then l.qty_sent else l.qty_counted end) order by l.line_no)
    into v_counts from public.stock_transfer_lines l where l.transfer_id = p_t.id;
  insert into public.stock_handover_confirmations (id, org_id, transfer_id, stage, proof_type, signer_kind, signer_name, signer_user_id, recorded_by,
                                                   counts, goods_photo_path, signer_photo_path, paper_photo_path)
  values (v_id, p_t.org_id, p_t.id, v_stage, v_type, v_kind, coalesce(v_name, ''), case when v_kind = 'account' then v_uid end, v_uid, v_counts,
          nullif(p_conf->>'goods_photo_path', ''), nullif(p_conf->>'signer_photo_path', ''), nullif(p_conf->>'paper_photo_path', ''));
  perform public.log_audit('stock.handover', p_t.org_id, v_uid, p_t.id,
            jsonb_build_object('confirmation_id', v_id, 'stage', v_stage, 'proof_type', v_type, 'signer_kind', v_kind));
  return v_id;
end $$;

create or replace function public.record_stock_handover(p_transfer uuid, p_confirmation jsonb) returns uuid
  language plpgsql volatile security definer set search_path = public as $$
declare t public.stock_transfers; v_stage text;
begin
  t := public.stock_lock_transfer(p_transfer, false);
  v_stage := p_confirmation->>'stage';
  if v_stage not in ('send', 'receive') then raise exception 'STK_INVALID: the confirmation names a stage' using errcode = 'P0001'; end if;
  if not public.stock_transfer_actor_ok(t, case when v_stage = 'send' then 'send' else 'receive' end) then              -- mut:late_actor
    raise exception 'STK_NOT_RECEIVER: you cannot confirm this handover' using errcode = 'P0001'; end if;
  return public.stock_insert_handover(t, p_confirmation);
end $$;
