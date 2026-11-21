-- 1305_stock_two_step_settings.sql — #2690 (spec docs/specs/stock-two-step-transfer.spec.md; plan docs/plans/2026-11-21-stock-two-step-transfer.md).
-- Proven by supabase/tests/1305_stock_two_step_settings.test.sql.
--   §1 organisation settings: stock_transfer_mode (one_step default | two_step) and stock_proof_timing (before_posting default | may_follow),
--      each written only by an Admin RPC (columns are not in any client grant).
--   §2 the 'transit' location kind: written only by the two-step RPCs (system GUC), takes only transfer legs and a shortfall write-off.
--   §3 stock_items.needs_quality_check (default false).
--   §4 stock_tags.proof_required (none | paper | confirmation | either), kept in step with the legacy paper_required.
-- The posting engine is NOT edited. Nothing here writes the ledger. Default state = today's behaviour for every existing organisation.
--
-- ── REVERSE (also supabase/migrations/rollback/1305_stock_two_step_settings_down.sql) ──────────────────
--   transit locations (and 1306+ tables) must be removed first; drop the triggers, functions and columns below; restore the 1029 kind check
--   (central, site, yard, staging, vendor) and the 1029 audit_stock_tag body.

-- §1 settings ------------------------------------------------------------------------------------------
alter table public.organizations
  add column stock_transfer_mode text not null default 'one_step' check (stock_transfer_mode in ('one_step', 'two_step')),
  add column stock_proof_timing  text not null default 'before_posting' check (stock_proof_timing in ('before_posting', 'may_follow'));

create or replace function public.stock_transfer_mode_of(p_org uuid) returns text
  language sql stable security definer set search_path = public as $$
  select coalesce((select o.stock_transfer_mode from public.organizations o where o.id = p_org), 'one_step') $$;
create or replace function public.stock_proof_timing_of(p_org uuid) returns text
  language sql stable security definer set search_path = public as $$
  select coalesce((select o.stock_proof_timing from public.organizations o where o.id = p_org), 'before_posting') $$;
revoke all on function public.stock_transfer_mode_of(uuid), public.stock_proof_timing_of(uuid) from public, anon;
grant execute on function public.stock_transfer_mode_of(uuid), public.stock_proof_timing_of(uuid) to authenticated;

-- What stops a mode change (FR-TST-002). Tables of 1306 are read at run time, so this body is valid before they exist.
create or replace function public.stock_mode_blockers(p_org uuid, p_mode text) returns void
  language plpgsql stable security definer set search_path = public as $$
begin
  if p_mode = 'two_step' then
    if exists (select 1 from public.stock_documents d
                where d.org_id = p_org and d.kind = 'transfer' and d.status = 'Draft' and d.two_step_id is null
                  and not exists (select 1 from public.material_requests r where r.transfer_document_id = d.id)) then
      raise exception 'STK_MODE_BLOCKED: post or delete the Draft transfers first' using errcode = 'P0001';
    end if;
  else
    if exists (select 1 from public.stock_transfers t where t.org_id = p_org and t.status = 'Sent')
       or exists (select 1 from public.stock_transfer_lines l
                   where l.org_id = p_org and l.qty_counted is not null and l.qty_counted < l.qty_sent and l.short_resolution is null) then
      raise exception 'STK_MODE_BLOCKED: transfers are still in transit or short' using errcode = 'P0001';
    end if;
    if exists (select 1 from public.stock_tags t where t.org_id = p_org and t.proof_required in ('confirmation', 'either')) then
      raise exception 'STK_MODE_BLOCKED: a tag still needs a handover confirmation' using errcode = 'P0001';
    end if;
  end if;
end $$;
revoke all on function public.stock_mode_blockers(uuid, text) from public, anon, authenticated;

create or replace function public.set_stock_transfer_mode(p_mode text) returns text
  language plpgsql volatile security definer set search_path = public as $$
declare v_org uuid; v_old text;
begin
  perform public.assert_is_active_member();
  v_org := public.auth_org_id();
  if not coalesce(public.role_rank(public.auth_role()) >= 50, false) then                          -- mut:mode_admin
    raise exception 'STK_FORBIDDEN: only an Admin changes the transfer mode' using errcode = '42501'; end if;
  if p_mode is null or p_mode not in ('one_step', 'two_step') then
    raise exception 'STK_INVALID: the transfer mode is one_step or two_step' using errcode = 'P0001'; end if;
  perform public.stock_assert_standalone(v_org);
  select o.stock_transfer_mode into v_old from public.organizations o where o.id = v_org for update;
  if v_old = p_mode then return v_old; end if;
  perform public.stock_mode_blockers(v_org, p_mode);                                                 -- mut:mode_off_guard
  update public.organizations set stock_transfer_mode = p_mode where id = v_org;
  perform public.log_audit('stock.transfer_mode', v_org, auth.uid(), v_org, jsonb_build_object('from', v_old, 'to', p_mode));
  return p_mode;
end $$;

create or replace function public.set_stock_proof_timing(p_timing text) returns text
  language plpgsql volatile security definer set search_path = public as $$
declare v_org uuid; v_old text;
begin
  perform public.assert_is_active_member();
  v_org := public.auth_org_id();
  if not coalesce(public.role_rank(public.auth_role()) >= 50, false) then                          -- mut:timing_admin
    raise exception 'STK_FORBIDDEN: only an Admin changes the proof timing' using errcode = '42501'; end if;
  if p_timing is null or p_timing not in ('before_posting', 'may_follow') then
    raise exception 'STK_INVALID: the proof timing is before_posting or may_follow' using errcode = 'P0001'; end if;
  select o.stock_proof_timing into v_old from public.organizations o where o.id = v_org for update;
  if v_old = p_timing then return v_old; end if;
  update public.organizations set stock_proof_timing = p_timing where id = v_org;
  perform public.log_audit('stock.proof_timing', v_org, auth.uid(), v_org, jsonb_build_object('from', v_old, 'to', p_timing));
  return p_timing;
end $$;
revoke all on function public.set_stock_transfer_mode(text), public.set_stock_proof_timing(text) from public, anon;
grant execute on function public.set_stock_transfer_mode(text), public.set_stock_proof_timing(text) to authenticated;

-- §2 the transit kind --------------------------------------------------------------------------------------
alter table public.stock_warehouses drop constraint stock_warehouses_kind_check;
alter table public.stock_warehouses add constraint stock_warehouses_kind_check check (kind in ('central','site','yard','staging','vendor','transit'));
alter table public.stock_warehouses add constraint stock_warehouses_transit_shape check (kind <> 'transit' or (project_id is null and vendor_company_id is null));

-- Only the two-step RPCs (which set the GUC for their transaction) create, change or archive a transit location.
create or replace function public.stock_system_write_on() returns boolean
  language sql stable set search_path = public as $$ select coalesce(current_setting('pmo.stock_system_write', true), '') = 'on' $$;
revoke all on function public.stock_system_write_on() from public, anon;
grant execute on function public.stock_system_write_on() to authenticated;

create or replace function public.guard_stock_transit_location() returns trigger
  language plpgsql set search_path = public as $$
begin
  if (new.kind = 'transit' or (tg_op = 'UPDATE' and old.kind = 'transit')) and not public.stock_system_write_on() then   -- mut:transit_system_only
    raise exception 'STK_TRANSIT_LOCATION: a transit location is managed by the transfer, not by hand' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function public.guard_stock_transit_location() from public, anon, authenticated;
create trigger stock_warehouses_zz_transit before insert or update on public.stock_warehouses
  for each row execute function public.guard_stock_transit_location();

-- A document may name a transit location only when written by the two-step RPCs.
create or replace function public.guard_stock_document_transit() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.stock_system_write_on()
     and exists (select 1 from public.stock_warehouses w where w.kind = 'transit' and w.id in (new.warehouse_id, coalesce(new.to_warehouse_id, new.warehouse_id))) then
    raise exception 'STK_TRANSIT_LOCATION: a transit location takes only the legs of its own transfer' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function public.guard_stock_document_transit() from public, anon, authenticated;
create trigger stock_documents_zz_transit before insert or update of warehouse_id, to_warehouse_id on public.stock_documents
  for each row execute function public.guard_stock_document_transit();

-- §3 quality check flag ------------------------------------------------------------------------------------
alter table public.stock_items add column needs_quality_check boolean not null default false;
grant insert (needs_quality_check) on public.stock_items to authenticated;
grant update (needs_quality_check) on public.stock_items to authenticated;

-- §4 proof rule per tag -------------------------------------------------------------------------------------
alter table public.stock_tags add column proof_required text not null default 'none'
  check (proof_required in ('none', 'paper', 'confirmation', 'either'));
update public.stock_tags set proof_required = 'paper' where paper_required;

create or replace function public.sync_stock_tag_proof() returns trigger
  language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.proof_required <> 'none' then new.paper_required := (new.proof_required = 'paper');
    elsif new.paper_required then new.proof_required := 'paper'; end if;
  elsif new.proof_required is distinct from old.proof_required then
    new.paper_required := (new.proof_required = 'paper');                                              -- proof_required wins when both change
  elsif new.paper_required is distinct from old.paper_required then
    new.proof_required := case when new.paper_required then 'paper' else 'none' end;
  end if;
  return new;
end $$;
revoke all on function public.sync_stock_tag_proof() from public, anon, authenticated;
create trigger stock_tags_aa_sync_proof before insert or update on public.stock_tags
  for each row execute function public.sync_stock_tag_proof();

-- confirmation / either can only be met by a two-step handover (FR-TST-052).
create or replace function public.guard_stock_tag_proof_mode() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if new.proof_required in ('confirmation', 'either') and public.stock_transfer_mode_of(new.org_id) <> 'two_step' then
    raise exception 'STK_PROOF_MODE: a handover confirmation can only be required when transfers are two-step' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function public.guard_stock_tag_proof_mode() from public, anon, authenticated;
create trigger stock_tags_zz_proof_mode before insert or update of proof_required on public.stock_tags
  for each row execute function public.guard_stock_tag_proof_mode();

grant insert (proof_required) on public.stock_tags to authenticated;
grant update (proof_required) on public.stock_tags to authenticated;

create or replace function public.audit_stock_tag() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  perform public.log_audit('stock.tag.' || case when tg_op = 'INSERT' then 'create'
                                                when old.archived_at is null and new.archived_at is not null then 'archive'
                                                else 'update' end,
    new.org_id, auth.uid(), new.id,
    jsonb_build_object('name', new.name, 'zero_cost', new.zero_cost, 'paper_required', new.paper_required, 'proof_required', new.proof_required));
  return null;
end $$;
