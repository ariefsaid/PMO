-- 0499: ECA3-T12 new items on open purchases are queued after setup (split from 0494 so the shipped migration stays as merged).
-- ECA3-T12 (FR-ECA-016, PD-ECA-15): once an Admin has accepted the item kind (or the census found no PMO items to accept), a new item name on an
-- approved-or-later purchase is queued as a send with no person: the sweep calls this once a tick before it claims. Only approved purchases, because
-- the send creates a permanent ERP Item: a Draft line can still be renamed and a Rejected one is never ordered. One proposal per name (identity,
-- plus the check for any proposal that names it), so a name already decided, linked (item_map) or waiting is never queued; the claim, the link
-- lookup and the outbox key keep the send once. The names are filtered by set difference first and limited last, so a large linked backlog never
-- hides a new name, and the plan stays hashed (linear) at 100,000 items.
create or replace function public.enqueue_new_item_sends(p_org_id uuid, p_tier text) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_binding public.external_org_bindings%rowtype; v_n int;
begin
  select * into v_binding from public.external_org_bindings
   where org_id = p_org_id and external_tier = p_tier and status = 'active' and activated_at is not null;
  if not found then return 0; end if;
  if not exists (select 1 from public.erp_connect_census c
                  where c.org_id = p_org_id and c.external_tier = p_tier and c.kind = 'item' and (c.accepted_at is not null or c.pmo_count = 0)) then return 0; end if;
  -- ponytail: 100 names a tick; the rest follow on the next ticks (they stay un-queued, so the next call reaches them)
  insert into public.erp_connect_proposals (org_id, binding_id, external_tier, run_id, kind, outcome, identity, pmo_ids, external_ids, snapshot, state, decided_at)
    select p_org_id, v_binding.id, p_tier, null, 'item', 'send', 'send|' || to_jsonb(array[n.name])::text || '|[]', array[n.name], '{}',
           '{"auto":true}'::jsonb, 'sending', now()
      from (select d.name from (
              select i.name from public.procurement_items i join public.procurements p on p.id = i.procurement_id
               where i.org_id = p_org_id and p.org_id = p_org_id and coalesce(i.name, '') <> ''
                 and p.status in ('Approved', 'Vendor Quoted', 'Quote Selected', 'Ordered', 'Received', 'Vendor Invoiced')
              except select jsonb_object_keys(coalesce(v_binding.config->'item_map', '{}'::jsonb))
              except select unnest(q.pmo_ids) from public.erp_connect_proposals q
                      where q.org_id = p_org_id and q.external_tier = p_tier and q.kind = 'item') d
             order by d.name limit 100) n
    on conflict (org_id, external_tier, kind, identity) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function public.enqueue_new_item_sends(uuid, text) from public, anon, authenticated;
grant execute on function public.enqueue_new_item_sends(uuid, text) to service_role;
