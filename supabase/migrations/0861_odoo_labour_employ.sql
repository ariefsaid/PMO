-- 0861_odoo_labour_employ.sql (#1510 L2, O7; FR-OLH-001/002, D3, D8, D14)
--
-- `timesheets` becomes an employable domain for tier `odoo`, guarded by the database like procurement / revenue / companies
-- (0505 / 0510 / 0743):
--   1. odoo_labour_employ_blocker  — the connection's stored capability snapshot must show every model labour writes (and
--                                    every field it reads), and the labour journal + accounts must be chosen (D8, FR-OLH-001).
--   2. admin_change_domain_ownership — 0743's body with `timesheets` in the guarded list and the labour blocker in the case.
--                                    The cross-tier rule ("one ERP at a time") is the shipped one and is what makes
--                                    AC-OLH-002 hold in BOTH directions — no second branch is added.
--   3. org_employs_odoo_timesheets — the read-only predicate the Odoo sweep's employee pass asks before it reads
--                                    `hr.employee` (FR-OLH-003), and the ERPNext backstop's mirror of D14.
--   4. set_odoo_labour_config      — Admin/Finance choose the journal, the labour-expense account, the payroll-payable
--                                    account and the cost basis (D3/D8). No default is invented: an id the org's own Odoo
--                                    mirror does not hold is refused. The UI that calls it arrives in L6; the blocker above
--                                    validates exactly these keys, so the two ship together.
--
-- The `odoo_labour_employ_blocker` walk order and its refusals are the SQL twin of
-- `pmo-portal/src/lib/adapterSeam/odoo/labour/capabilities.ts` (`labourCapabilityGap`); keep them in step.
-- Reversal: rollback/0861_odoo_labour_employ_down.sql (0743's ownership body restored verbatim, the three new functions
-- dropped).

-- ── 1. The labour employ blocker ───────────────────────────────────────────────────────────────────────────────────
-- Fail closed: an absent snapshot (an old connection, a discovery that never ran) names the FIRST model rather than
-- admitting the employ. `hr.employee` is read-only for PMO (D6 — PMO creates no employee), so only the write models and
-- the anchor model are asked for `create`/`write`.
create or replace function public.odoo_labour_employ_blocker(p_org_id uuid) returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_cfg jsonb;
  v_model text;
  v_probe jsonb;
begin
  if not exists (select 1 from public.external_org_bindings
                  where org_id = p_org_id and external_tier = 'odoo' and status = 'active' and activated_at is not null) then
    return 'Odoo connection is not activated';
  end if;
  select config into v_cfg from public.external_org_bindings
   where org_id = p_org_id and external_tier = 'odoo';
  -- Same order as LABOUR_MODELS / labourCapabilityGap.
  foreach v_model in array array['hr.employee','account.analytic.line','account.move','account.move.line','ir.model.data'] loop
    v_probe := v_cfg #> array['capabilities','labour',v_model];
    if v_probe is null or (v_probe->>'exists') is distinct from 'true' or (v_probe->>'read') is distinct from 'true' then
      return 'Odoo is missing ' || v_model;
    end if;
    if jsonb_typeof(v_probe->'fields_missing') = 'array' and jsonb_array_length(v_probe->'fields_missing') > 0 then
      return 'Odoo is missing ' || v_model || ':' || (v_probe->'fields_missing'->>0);
    end if;
    if v_model <> 'hr.employee' then
      if (v_probe->>'create') is distinct from 'true' then
        return 'Odoo is missing ' || v_model || ':create';
      end if;
      if v_model <> 'ir.model.data' and (v_probe->>'write') is distinct from 'true' then
        return 'Odoo is missing ' || v_model || ':write';
      end if;
    end if;
  end loop;
  -- D8: the org's chart is the org's decision — no journal or account is ever guessed.
  if nullif(btrim(coalesce(v_cfg->>'labour_journal_id', '')), '') is null
     or nullif(btrim(coalesce(v_cfg->>'labour_expense_account_id', '')), '') is null
     or nullif(btrim(coalesce(v_cfg->>'labour_payable_account_id', '')), '') is null then
    return 'Choose the labour journal and accounts in the Odoo setup first.';
  end if;
  return null;
end $$;
revoke all on function public.odoo_labour_employ_blocker(uuid) from public, anon, authenticated;
grant execute on function public.odoo_labour_employ_blocker(uuid) to service_role;

-- ── 2. The employ verb: 0743's body + `timesheets` ─────────────────────────────────────────────────────────────────
create or replace function public.admin_change_domain_ownership(
  p_org_id uuid, p_external_tier text, p_domain text, p_action text, p_actor_id uuid default null)
  returns void language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid;
  v_is_admin boolean;
  v_is_operator boolean;
  v_blocker text;
begin
  -- Resolve effective actor: JWT path (auth.uid()) takes precedence; service_role path uses p_actor_id
  v_actor := coalesce(auth.uid(), p_actor_id);
  if v_actor is null then
    raise exception 'actor required' using errcode = '42501';
  end if;

  -- ⚑ 0180 (FR-AMG-002): the RESOLVED actor must be an active member.
  perform public.assert_is_active_member(p_actor_id);

  -- Gate: actor must be Admin of p_org_id OR platform Operator
  select exists (
    select 1 from public.profiles
    where id = v_actor
      and org_id = p_org_id
      and role = 'Admin'
  ) into v_is_admin;

  select exists (
    select 1 from public.platform_operators
    where user_id = v_actor
  ) into v_is_operator;

  if not (v_is_admin or v_is_operator) then
    raise exception 'insufficient privilege' using errcode = '42501';
  end if;

  -- Validate org exists (FK enforcement via 23503 on insert)
  if not exists (select 1 from public.organizations where id = p_org_id) then
    raise exception 'unknown_org' using errcode = '23503';
  end if;

  -- ⚑ 0505 (FR-OPP-001) / 0510 (FR-OCI-001..003) / 0861 (FR-OLH-001..002): a domain is employed under an ERP only when it
  -- can work, and under one ERP at a time. The cross-tier refusal is the shipped one — it is what makes AC-OLH-002 hold in
  -- both directions, so `timesheets` needs no branch of its own here.
  if p_action = 'employ' and p_domain in ('procurement', 'revenue', 'companies', 'timesheets') and p_external_tier in ('erpnext', 'odoo') then
    if exists (select 1 from public.external_domain_ownership
                where org_id = p_org_id and domain = p_domain and external_tier in ('erpnext', 'odoo')
                  and external_tier <> p_external_tier) then
      raise exception '% is already employed on another ERP', p_domain using errcode = 'P0001';
    end if;
    if p_external_tier = 'odoo' then
      v_blocker := case p_domain when 'procurement' then public.odoo_procurement_employ_blocker(p_org_id)
                                 when 'companies' then public.odoo_companies_employ_blocker(p_org_id)
                                 when 'timesheets' then public.odoo_labour_employ_blocker(p_org_id)
                                 else public.odoo_revenue_employ_blocker(p_org_id) end;
      if v_blocker is not null then raise exception '%', v_blocker using errcode = 'P0001'; end if;
    end if;
  end if;

  -- Perform the SAME ownership write as operator_set_domain_ownership
  if p_action = 'employ' then
    insert into public.external_domain_ownership (org_id, external_tier, domain, created_by)
      values (p_org_id, p_external_tier, p_domain, v_actor)
    on conflict (org_id, external_tier, domain) do nothing;
  elsif p_action = 'release' then
    delete from public.external_domain_ownership
    where org_id = p_org_id and external_tier = p_external_tier and domain = p_domain;
  else
    raise exception 'bad_action' using errcode = 'P0001';
  end if;

  perform public.log_audit(
    case p_action when 'employ' then 'integration.domain_ownership.employ'
                  when 'release' then 'integration.domain_ownership.release'
                  else 'integration.domain_ownership.unknown' end,
    p_org_id,
    v_actor,
    null,  -- entity_id
    jsonb_build_object(
      'tier', p_external_tier,
      'domain', p_domain,
      'action', p_action,
      'actor', v_actor
    )
  );
end;
$$;
-- Grants are those of 0210 §2 (anon revoked) and 0185 (allow-listed): `authenticated` keeps EXECUTE, so the in-body
-- Admin/Operator gate is the only gate on this JWT-callable writer. `create or replace` keeps the grants.

-- ── 3. The read-only ownership predicate (invoker: it reads only what RLS already shows the caller) ────────────────
create or replace function public.org_employs_odoo_timesheets(p_org uuid) returns boolean
language sql stable security invoker set search_path = public as $$
  select exists (
    select 1 from public.external_domain_ownership
     where org_id = p_org and external_tier = 'odoo' and domain = 'timesheets'
  )
$$;
revoke all on function public.org_employs_odoo_timesheets(uuid) from public, anon;
grant execute on function public.org_employs_odoo_timesheets(uuid) to authenticated, service_role;

-- ── 4. The labour journal, accounts and cost basis (D3, D8) ────────────────────────────────────────────────────────
-- Client-callable (0178's retained set): the body re-asserts the caller's org, active membership and Admin/Finance, so the
-- edge function's own guard is not the only gate. Every id must be a LIVE row of THIS org's Odoo mirror — the
-- `set_odoo_payment_journal_default` precedent — so an org can never post labour cost to an account it does not hold.
create or replace function public.set_odoo_labour_config(
  p_org_id uuid, p_journal_id text, p_expense_account_id text, p_payable_account_id text, p_basis text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  -- SECURITY DEFINER bypasses RLS: re-assert org + active membership + role in the body, never in the caller.
  if p_org_id is distinct from public.auth_org_id()
     or not public.is_active_member()
     or (public.auth_role() is distinct from 'Admin' and public.auth_role() is distinct from 'Finance') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_basis is null or p_basis not in ('payroll', 'odoo-rate') then
    raise exception 'unknown cost basis' using errcode = '22023';
  end if;
  if p_journal_id is null or p_journal_id !~ '^[0-9]{1,9}$'
     or not exists (select 1 from public.external_master_records
                     where org_id = p_org_id and external_tier = 'odoo' and kind = 'journal'
                       and external_id = p_journal_id and active and tombstoned_at is null) then
    raise exception 'not a journal of this connection' using errcode = '22023';
  end if;
  if p_expense_account_id is null or p_expense_account_id !~ '^[0-9]{1,9}$'
     or not exists (select 1 from public.external_master_records
                     where org_id = p_org_id and external_tier = 'odoo' and kind = 'account'
                       and external_id = p_expense_account_id and active and tombstoned_at is null) then
    raise exception 'not an account of this connection' using errcode = '22023';
  end if;
  if p_payable_account_id is null or p_payable_account_id !~ '^[0-9]{1,9}$'
     or not exists (select 1 from public.external_master_records
                     where org_id = p_org_id and external_tier = 'odoo' and kind = 'account'
                       and external_id = p_payable_account_id and active and tombstoned_at is null) then
    raise exception 'not an account of this connection' using errcode = '22023';
  end if;

  update public.external_org_bindings
     set config = coalesce(config, '{}'::jsonb) || jsonb_build_object(
           'labour_journal_id', p_journal_id,
           'labour_expense_account_id', p_expense_account_id,
           'labour_payable_account_id', p_payable_account_id,
           'labour_cost_basis', p_basis)
   where org_id = p_org_id and external_tier = 'odoo';
  if not found then
    raise exception 'no Odoo binding for this organization' using errcode = 'P0002';
  end if;

  perform public.log_audit('integration.odoo.labour_config', p_org_id, v_actor, null,
    jsonb_build_object('basis', p_basis, 'journal', p_journal_id,
                       'expense_account', p_expense_account_id, 'payable_account', p_payable_account_id));
end $$;
revoke all on function public.set_odoo_labour_config(uuid, text, text, text, text) from public, anon;
grant execute on function public.set_odoo_labour_config(uuid, text, text, text, text) to authenticated;

-- ── 5. Self-assertion: the blocker stays machine-only, the config writer stays client-callable ─────────────────────
do $$
begin
  if has_function_privilege('authenticated', 'public.odoo_labour_employ_blocker(uuid)', 'execute')
     or has_function_privilege('anon', 'public.odoo_labour_employ_blocker(uuid)', 'execute') then
    raise exception 'odoo_labour_employ_blocker must be service-role only';
  end if;
  if not has_function_privilege('authenticated', 'public.set_odoo_labour_config(uuid,text,text,text,text)', 'execute')
     or has_function_privilege('anon', 'public.set_odoo_labour_config(uuid,text,text,text,text)', 'execute') then
    raise exception 'set_odoo_labour_config must be client-callable and never anon-callable';
  end if;
end $$;
