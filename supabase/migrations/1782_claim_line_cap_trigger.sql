-- 1782_claim_line_cap_trigger.sql — survey-cap-stop (part B): while organizations.claim_quantity_over_cap = 'block', a claim line above
-- the headroom of its work-order line is refused. A trigger, so every path that creates claim lines is covered (today only
-- create_progress_claim, 0924:353), for every role and for service paths alike. Lines are immutable (0250), so insert is the only write.
-- 'warn' returns at once: no lock, no read of claim totals. Reversal: rollback/1782_claim_line_cap_trigger_down.sql.
-- Lock order: lock_work_order_billing is the same advisory lock create_progress_claim already holds (0924:199), taken before any claimed
-- total is read, so two claims racing for one headroom serialise and the second sees the first's lines; no new lock edge.
create function public.enforce_claim_line_cap() returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  v_wo uuid; v_mode text; v_ceiling numeric; v_basis text; v_head numeric; v_unit text;
begin
  select c.work_order_id into v_wo from public.progress_claims c where c.id = new.claim_id;
  if v_wo is null then return new; end if;                              -- a project-level claim has no per-order facts
  select o.claim_quantity_over_cap into v_mode from public.organizations o where o.id = new.org_id;
  if v_mode is distinct from 'block' then return new; end if;
  select b.unit into v_unit from public.boq_items b where b.id = new.boq_item_id and b.earning_basis <> 'lump_sum';
  if not found then return new; end if;                                  -- a lump-sum line is a fraction of one lot
  perform public.lock_work_order_billing(v_wo);
  select h.ceiling, h.basis, h.headroom into v_ceiling, v_basis, v_head
    from public.work_order_line_headroom(v_wo, new.boq_item_id, new.claim_id) h;
  if not found then return new; end if;
  if round(new.quantity * 1000) > round(v_head * 1000) then
    raise exception 'CLM_OVER_CAP: only % % still claimable on this work-order line (% %, already claimed %); lower the quantity or confirm the next acceptance',
      v_head, v_unit, v_basis, v_ceiling, public.work_order_line_claimed_quantity(v_wo, new.boq_item_id, new.claim_id)
      using errcode = '23514';
  end if;
  return new;
end; $$;
revoke all on function public.enforce_claim_line_cap() from public, anon, authenticated;
create trigger progress_claim_lines_cap before insert on public.progress_claim_lines
  for each row execute function public.enforce_claim_line_cap();
