-- 0854_odoo_equipment_adoption.sql (#1511 F3): adopting the Odoo register into the PMO asset book, once, and keeping the
-- book out of reach while Odoo owns it (D8/D9, FR-OFM-020..022).
--   1. list_equipment_asset_matches — the proposal an Admin reviews: every unlinked mirrored vehicle / equipment item,
--      matched by code (trimmed, case-insensitive) to exactly one live unlinked PMO asset, else proposed as new. Two
--      candidates on either side are proposed as new, never linked (never auto-merge, OQ-9).
--   2. odoo_adoption_code — the one rule both writers use for the PMO code an adopted asset takes: Odoo's plate /
--      serial when it is free in the org, else the made-up `ODOO-<kind initial><odoo id>`. A code that is already live
--      is never taken away from the asset that holds it, and never refuses the batch (D10: the code is the key).
--   3. accept_equipment_asset_matches — Admin only, one transaction for the whole batch, audited: links the accepted
--      pairs and adds the rest as new PMO assets. Called by the asset-matching screen, whose "Accept all" sends the
--      proposal back exactly as the read returned it.
--   4. record_odoo_asset_created — service role only: a confirmed Odoo create of a vehicle / equipment item lands in
--      the mirror and as one linked PMO asset under the id the outbox command reserved.
--   5. equipment_assets_odoo_owned_{insert,update,delete} — restrictive RLS: while the org employs `equipment` under
--      Odoo, no client may insert, rename or delete an asset; the register is the only way in (D8). Before employ the
--      shipped rules apply unchanged.
-- Reversal: rollback/0854_odoo_equipment_adoption_down.sql.
-- ── REVERSE ─────────────────────────────────────────────────────────────────────────────────────────────
--   drop the three restrictive policies and the four functions. The links already made (external_tier /
--   external_ref on equipment_assets) are NOT cleared: the columns predate 0854 (#1519 OQ-9), and a down migration
--   must not lose what people adopted in use.

-- ── 1. the proposal read ─────────────────────────────────────────────────────────────────────────────────────────
-- Reads only, and the two tables are already readable by every active member (0447 / 0421), so the role gate lives
-- on the screen (Admin) and not here; the org always comes from the session.
create function public.list_equipment_asset_matches()
returns table (ref text, kind text, external_id text, odoo_name text, odoo_code text,
               action text, asset_id uuid, asset_code text, asset_name text, reason text)
language sql stable security invoker set search_path = public as $$
  with org as (select public.auth_org_id() as id),
  m as (
    select r.kind, r.external_id, r.name as odoo_name, nullif(btrim(r.code), '') as odoo_code,
           case when nullif(btrim(r.code), '') is null then null else lower(btrim(r.code)) end as code_key
      from public.external_master_records r, org
     where r.org_id = org.id and r.external_tier = 'odoo' and r.kind in ('vehicle','equipment')
       and r.active and r.tombstoned_at is null
       and not exists (select 1 from public.equipment_assets l
                        where l.org_id = org.id and l.external_tier = 'odoo'
                          and l.external_ref = r.kind || ':' || r.external_id)
  ),
  a as (
    select x.id, x.code, x.name, lower(btrim(x.code)) as code_key
      from public.equipment_assets x, org
     where x.org_id = org.id and x.archived_at is null and x.external_ref is null
  ),
  mcnt as (select code_key, count(*)::int as n from m where code_key is not null group by code_key),
  acnt as (select code_key, count(*)::int as n from a group by code_key),
  hit as (
    select mm.*, aa.id as hit_id, aa.code as hit_code, aa.name as hit_name,
           coalesce(acnt.n, 0)::int as asset_n, coalesce(mcnt.n, 0)::int as mirror_n
      from m mm
      left join a aa on aa.code_key = mm.code_key
      left join mcnt on mcnt.code_key = mm.code_key
      left join acnt on acnt.code_key = mm.code_key
  ),
  one as (select h.*, (h.hit_id is not null and h.mirror_n = 1 and h.asset_n = 1) as is_link from hit h)
  select o.kind || ':' || o.external_id as ref, o.kind, o.external_id, o.odoo_name, o.odoo_code,
         case when o.is_link then 'link' else 'add' end,
         case when o.is_link then o.hit_id end,
         case when o.is_link then o.hit_code end,
         case when o.is_link then o.hit_name end,
         -- A tie is named a tie whether or not a PMO asset carries the code: two Odoo rows over one code are never
         -- merged, and the Admin is told why the row is being added (the accept falls back to a made-up code).
         case when o.mirror_n > 1 then 'two-codes'
              when o.hit_id is null then 'no-code'
              when o.is_link then 'same-code'
              else 'two-codes' end
    from one o
   order by o.kind, length(o.external_id), o.external_id;
$$;
revoke all on function public.list_equipment_asset_matches() from public, anon;
grant execute on function public.list_equipment_asset_matches() to authenticated;

-- ── 2. the code an adopted asset takes, shared by the accept RPC and the recorder ────────────────────────────────
-- Odoo's plate / serial when it is still free in the org, else the made-up `ODOO-<kind initial><odoo id>` (unique per
-- kind and id, so two Odoo rows that share a code both land). A live code is never taken from the asset that holds it
-- (D10: the code is the key in T&M, costing and the CLI), and taking one never refuses the batch (D9 "Accept all").
-- 23505 only when even the made-up code is taken — then something is genuinely wrong with the book.
-- p_exclude_id is the asset being written, so a replayed finalize sees its own code as free.
create function public.odoo_adoption_code(p_org_id uuid, p_kind text, p_external_id text, p_code text, p_exclude_id uuid default null)
returns text language plpgsql stable security invoker set search_path = public as $$
declare v_code text; v_taken boolean;
begin
  v_code := nullif(btrim(p_code), '');
  if v_code is not null then
    select exists (select 1 from public.equipment_assets a
                    where a.org_id = p_org_id and a.archived_at is null
                      and lower(btrim(a.code)) = lower(btrim(v_code))
                      and a.id is distinct from p_exclude_id) into v_taken;
    if not v_taken then return v_code; end if;
  end if;
  v_code := 'ODOO-' || upper(left(p_kind, 1)) || p_external_id;
  if exists (select 1 from public.equipment_assets a
              where a.org_id = p_org_id and a.archived_at is null
                and lower(btrim(a.code)) = lower(btrim(v_code))
                and a.id is distinct from p_exclude_id) then
    raise exception 'a PMO asset with code % already exists', v_code using errcode = '23505';
  end if;
  return v_code;
end $$;
revoke all on function public.odoo_adoption_code(uuid,text,text,text,uuid) from public, anon, authenticated;

-- ── 3. accept the proposals, once ────────────────────────────────────────────────────────────────────────────────
create function public.accept_equipment_asset_matches(p_pairs jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.auth_org_id();
  v_actor uuid := auth.uid();
  p jsonb;
  v_ref text; v_kind text; v_ext text; v_action text; v_asset_id uuid;
  m public.external_master_records%rowtype;
  v_asset public.equipment_assets%rowtype;
  v_code text; v_name text; v_unit text;
  v_linked int := 0; v_added int := 0;
begin
  perform public.assert_is_active_member();
  -- FR-OFM-021 / D9: the asset book is the Admin's to reconcile.
  if public.auth_role() is distinct from 'Admin' then
    raise exception 'only an Admin matches Odoo assets to PMO assets' using errcode = '42501';
  end if;
  if v_org is null then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_pairs is null or jsonb_typeof(p_pairs) <> 'array' then
    raise exception 'matches must be a JSON array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_pairs) > 1000 then
    raise exception 'at most 1000 matches at a time' using errcode = '22023';
  end if;
  if not public.org_employs_odoo_equipment(v_org) then
    raise exception 'Odoo does not keep the equipment register for this organization' using errcode = 'P0001';
  end if;
  for p in select value from jsonb_array_elements(p_pairs) loop
    if jsonb_typeof(p) <> 'object' then raise exception 'each match must be a JSON object' using errcode = '22023'; end if;
    v_ref := p->>'ref';
    v_action := coalesce(nullif(btrim(coalesce(p->>'action', '')), ''), 'skip');
    if v_ref is null or v_ref !~ '^(vehicle|equipment):[0-9]+$' then
      raise exception 'a match names a vehicle:<id> or equipment:<id>, not %', v_ref using errcode = '22023';
    end if;
    if v_action not in ('link','add','skip') then
      raise exception 'unknown match action %', v_action using errcode = '22023';
    end if;
    if v_action = 'skip' then continue; end if;
    v_kind := split_part(v_ref, ':', 1);
    v_ext := split_part(v_ref, ':', 2);
    select * into m from public.external_master_records r
     where r.org_id = v_org and r.external_tier = 'odoo' and r.kind = v_kind and r.external_id = v_ext
       and r.active and r.tombstoned_at is null;   -- archived in Odoo: never adopt it (the proposal hides it too)
    if not found then
      raise exception 'Odoo asset % is not an active asset in this organization', v_ref using errcode = 'P0002';
    end if;
    if exists (select 1 from public.equipment_assets l
                where l.org_id = v_org and l.external_tier = 'odoo' and l.external_ref = v_ref) then
      raise exception 'Odoo asset % is already linked to a PMO asset', v_ref using errcode = '23505';
    end if;
    if v_action = 'link' then
      begin
        v_asset_id := (p->>'asset_id')::uuid;
      exception when others then
        raise exception 'a link needs the PMO asset id' using errcode = '22023';
      end;
      select * into v_asset from public.equipment_assets a where a.id = v_asset_id for update;
      if not found or v_asset.org_id is distinct from v_org then
        raise exception 'PMO asset not found' using errcode = 'P0002';
      end if;
      if v_asset.archived_at is not null then
        raise exception 'PMO asset % is archived', v_asset.code using errcode = 'P0002';
      end if;
      if v_asset.external_ref is not null then
        raise exception 'PMO asset % is already linked', v_asset.code using errcode = '23505';
      end if;
      update public.equipment_assets set external_tier = 'odoo', external_ref = v_ref where id = v_asset.id;
      v_linked := v_linked + 1;
    else
      -- A proposed code that is already live (a tie the Admin accepted, a legacy row, an asset the feed linked) is
      -- never refused: the asset takes the made-up code instead, so "Accept all" of the proposal always lands (I1).
      v_code := public.odoo_adoption_code(v_org, v_kind, v_ext, m.code);
      v_name := coalesce(nullif(left(btrim(m.name), 120), ''), v_code);
      v_unit := coalesce(nullif(btrim(coalesce(p->>'default_unit', '')), ''), 'hours');
      if v_unit not in ('hours','days') then
        raise exception 'the default unit is hours or days' using errcode = '22023';
      end if;
      if char_length(v_code) > 40 then
        raise exception 'the PMO code % is longer than 40 characters', v_code using errcode = '22023';
      end if;
      insert into public.equipment_assets (org_id, code, name, default_unit, external_tier, external_ref, created_by)
      values (v_org, v_code, v_name, v_unit, 'odoo', v_ref, v_actor);
      v_added := v_added + 1;
    end if;
  end loop;
  perform public.log_audit('equipment.register.matched', v_org, v_actor, null,
    jsonb_build_object('linked', v_linked, 'added', v_added));
  return jsonb_build_object('linked', v_linked, 'added', v_added);
end $$;
revoke all on function public.accept_equipment_asset_matches(jsonb) from public, anon, authenticated;
grant execute on function public.accept_equipment_asset_matches(jsonb) to authenticated;

-- ── 4. the created-asset recorder (a confirmed Odoo create) ─────────────────────────────────────────────────────
create function public.record_odoo_asset_created(p_org_id uuid, p_kind text, p_row jsonb, p_asset_id uuid, p_default_unit text)
returns void language plpgsql security definer set search_path = public as $$
declare v_ext text; v_ref text; v_code text; v_name text; v_unit text;
begin
  if current_setting('role', true) <> 'service_role' then raise exception 'service role required' using errcode = '42501'; end if;
  if p_org_id is null or p_asset_id is null then
    raise exception 'the organization and the PMO asset id are required' using errcode = '22023';
  end if;
  if p_kind is null or p_kind not in ('vehicle','equipment') then
    raise exception 'the kind is vehicle or equipment' using errcode = '22023';
  end if;
  if p_row is null or jsonb_typeof(p_row) <> 'object' then
    raise exception 'the Odoo row must be a JSON object' using errcode = '22023';
  end if;
  v_ext := nullif(btrim(coalesce(p_row->>'external_id', '')), '');
  if v_ext is null or v_ext !~ '^[0-9]+$' then
    raise exception 'the Odoo row needs a numeric external id' using errcode = '22023';
  end if;
  v_ref := p_kind || ':' || v_ext;
  perform public.apply_odoo_master_rows(p_org_id, p_kind, jsonb_build_array(p_row));
  if exists (select 1 from public.equipment_assets a
              where a.org_id = p_org_id and a.external_tier = 'odoo' and a.external_ref = v_ref
                and a.id <> p_asset_id) then
    raise exception 'Odoo asset % is already linked to a PMO asset', v_ref using errcode = '23505';
  end if;
  -- A plate / serial that is already a live PMO code must not pin the finalize forever: the asset lands under the
  -- made-up code, exactly as the accept RPC's add path does (I2 — one rule, one place).
  v_code := public.odoo_adoption_code(p_org_id, p_kind, v_ext, p_row->>'code', p_asset_id);
  v_name := coalesce(nullif(left(btrim(p_row->>'name'), 120), ''), v_code);
  v_unit := coalesce(nullif(btrim(coalesce(p_default_unit, '')), ''), 'hours');
  if v_unit not in ('hours','days') then
    raise exception 'the default unit is hours or days' using errcode = '22023';
  end if;
  if char_length(v_code) > 40 then
    raise exception 'the PMO code % is longer than 40 characters', v_code using errcode = '22023';
  end if;
  -- A replayed finalize is a no-op: the asset already exists under the id the command reserved.
  insert into public.equipment_assets (id, org_id, code, name, default_unit, external_tier, external_ref)
  values (p_asset_id, p_org_id, v_code, v_name, v_unit, 'odoo', v_ref)
  on conflict (id) do nothing;
  -- The reserved id is the command's identity, so a replay must land the same record in the same org. An id that
  -- already belongs to another org, or to a different Odoo record, is reported and never counted as done (M3).
  if not exists (select 1 from public.equipment_assets a
                  where a.id = p_asset_id and a.org_id = p_org_id and a.external_ref = v_ref) then
    raise exception 'the PMO asset id % is already in use', p_asset_id using errcode = '23505';
  end if;
end $$;
revoke all on function public.record_odoo_asset_created(uuid,text,jsonb,uuid,text) from public, anon, authenticated;
grant execute on function public.record_odoo_asset_created(uuid,text,jsonb,uuid,text) to service_role;

-- ── 5. the PMO-asset guard (D8, FR-OFM-022) ─────────────────────────────────────────────────────────────────────
-- 0646 initplan form, and the whole test is the scalar sub-select: `org_employs_odoo_equipment` is `set search_path`,
-- so it cannot be inlined and would otherwise run once per row; wrapped, the ownership test and the `auth_org_id()`
-- inside it resolve once per statement. The F3 definer writers above are unaffected (they run as the owner, which
-- bypasses RLS); clients are the only audience of these.
create policy equipment_assets_odoo_owned_insert on public.equipment_assets as restrictive for insert to authenticated
  with check ((select not public.org_employs_odoo_equipment((select public.auth_org_id()))));
create policy equipment_assets_odoo_owned_update on public.equipment_assets as restrictive for update to authenticated
  using ((select not public.org_employs_odoo_equipment((select public.auth_org_id()))))
  with check ((select not public.org_employs_odoo_equipment((select public.auth_org_id()))));
create policy equipment_assets_odoo_owned_delete on public.equipment_assets as restrictive for delete to authenticated
  using ((select not public.org_employs_odoo_equipment((select public.auth_org_id()))));

do $$ begin
  if has_function_privilege('anon', 'public.accept_equipment_asset_matches(jsonb)', 'execute')
     or has_function_privilege('anon', 'public.list_equipment_asset_matches()', 'execute')
     or has_function_privilege('authenticated', 'public.record_odoo_asset_created(uuid,text,jsonb,uuid,text)', 'execute')
     or has_function_privilege('authenticated', 'public.odoo_adoption_code(uuid,text,text,text,uuid)', 'execute') then
    raise exception 'the accept RPC and the proposal read are client-only; the recorder and the code rule are internal';
  end if;
end $$;
