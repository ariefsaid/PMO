-- 0701 (#1902): the fenced committed -> held transition for an Odoo procurement row whose Odoo document is
-- anchored to another PMO record. Recovery never drives such a row, so this moves it from silent in-flight to
-- the operator held queue. The slot stays occupied until release: held remains inside the per-bill slot and
-- one-in-flight predicates (0134/0508/0682), which is correct for money — an Odoo document exists, so the slot
-- must stay blocked until an operator decides.
-- Same shape as mark_outbox_held (0096): guarded on claim_generation and state, reason in last_error, returns
-- 1 when held else 0, service_role only. The audited release_outbox_hold (0137 §4) is the route out.
-- Reversibility: rollback/0701_hold_committed_outbox_down.sql.

create or replace function public.hold_committed_outbox(
  p_id uuid, p_generation int, p_reason text
) returns int
  language plpgsql security definer set search_path = public as $$
  declare v_n int;
  begin
    update public.external_command_outbox
       set state = 'held', last_error = p_reason, updated_at = now()
     where id = p_id and claim_generation = p_generation and state = 'committed'
    returning 1 into v_n;
    return coalesce(v_n, 0);
  end; $$;

revoke all on function public.hold_committed_outbox(uuid, int, text) from public, anon, authenticated;
grant execute on function public.hold_committed_outbox(uuid, int, text) to service_role;
