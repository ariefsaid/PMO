-- 0747 (#1507 S6, AC-ODA-016/020): an Odoo org reads the ledger basis only after an Admin switches it (OQ-ODA-2, FR-ODA-060),
-- and the project journal list reads Odoo `account.move` rows. Rollback: rollback/0747_odoo_ledger_basis_down.sql
-- The switch writes config.ledger_basis_at on the org's Odoo binding: the same key the sweep reads (odooLedgerFeed.ts) to
-- publish ledger actuals, so the feed and the money screens flip together.

-- Basis: an active ERPNext binding (0307, unchanged), or an active, activated Odoo binding whose Admin has switched it.
create or replace function public.org_reads_erp_ledger()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_active_member()
    and exists (
      select 1 from public.external_org_bindings b
      where b.org_id = public.auth_org_id()
        and b.status = 'active'
        and (b.external_tier = 'erpnext'
             or (b.external_tier = 'odoo' and b.activated_at is not null and nullif(b.config->>'ledger_basis_at', '') is not null))
    );
$$;
revoke all on function public.org_reads_erp_ledger() from public, anon;
grant execute on function public.org_reads_erp_ledger() to authenticated;

-- The Admin's switch. Caught up = the ledger cursor carries a finished census day (the pass writes it only after the feed reached
-- the present). The latest reconciliation check (S4) does not exist yet: until it records one, every switch is "not checked" and
-- needs the Admin's explicit p_confirm_difference. A second call changes nothing.
create or replace function public.switch_odoo_ledger_basis(p_confirm_difference boolean default false)
returns timestamptz
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_org uuid := public.auth_org_id();
  v_uid uuid := auth.uid();
  v_b public.external_org_bindings%rowtype;
  v_cursor text;
  v_at timestamptz;
begin
  if v_uid is null or v_org is null or not public.is_active_member() or public.auth_role()::text is distinct from 'Admin' then
    raise exception 'Only an Admin can switch the ledger basis.' using errcode = '42501';
  end if;
  select * into v_b from public.external_org_bindings
   where org_id = v_org and external_tier = 'odoo' and status = 'active' and activated_at is not null for update;
  if not found then raise exception 'Odoo connection not found' using errcode = 'P0002'; end if;
  if nullif(v_b.config->>'ledger_basis_at', '') is not null then
    return (v_b.config->>'ledger_basis_at')::timestamptz;
  end if;

  select w.watermark_cursor into v_cursor from public.external_sync_watermarks w
   where w.org_id = v_org and w.external_tier = 'odoo' and w.domain = 'ledger:odoo';
  if v_cursor is null or v_cursor !~ '^\{' or nullif((v_cursor::jsonb)->>'census_done_at', '') is null then
    raise exception 'ledger_not_caught_up' using errcode = 'P0001';
  end if;
  if not coalesce(p_confirm_difference, false) then
    raise exception 'ledger_not_checked' using errcode = 'P0001';
  end if;

  v_at := now();
  update public.external_org_bindings
     set config = coalesce(config, '{}'::jsonb) || jsonb_build_object('ledger_basis_at', v_at)
   where id = v_b.id;
  perform public.log_audit('odoo.ledger_basis_switch', v_org, v_uid, v_b.id,
    jsonb_build_object('confirmed_difference', coalesce(p_confirm_difference, false), 'check', 'not_checked', 'switched_at', v_at));
  return v_at;
end $$;
revoke all on function public.switch_odoo_ledger_basis(boolean) from public, anon;
grant execute on function public.switch_odoo_ledger_basis(boolean) to authenticated;

-- Journal cost lines (0687 body, widened). Project map: the ERPNext config map, or for an Odoo org the project links
-- (analytic account id → PMO project; an account two projects link maps to none, as invertProjectMap). Vouchers: ERPNext
-- 'Journal Entry' or Odoo 'account.move'. A voucher PMO posted itself is not a stray: the ERPNext journals PMO posted
-- (expense/imprest mirrors), and for Odoo the bills and invoices PMO pushed or adopted (purchase / revenue mirror rows).
create or replace function public.erp_journal_cost_lines(p_org_id uuid, p_project_id uuid, p_voucher_no text default null)
returns table (erp_doctype text, voucher_no text, project_id uuid, account text, category public.budget_category,
               posting_date date, amount numeric, remarks text, party text, is_cancelled boolean)
language sql stable security definer set search_path = public, pg_catalog as $$
  with map as (
    select m.value as erp_name, min(m.key)::uuid as project_id
      from public.external_org_bindings b, jsonb_each_text(coalesce(b.config->'project_map', '{}'::jsonb)) m
     where b.org_id = p_org_id and b.external_tier = 'erpnext' and b.activated_at is not null
       and m.key ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' and m.value <> ''
     group by m.value having count(*) = 1
    union all
    select pb.external_container_id, (array_agg(pb.project_id))[1]
      from public.external_project_bindings pb
     where pb.org_id = p_org_id and pb.external_tier = 'odoo' and pb.external_container_id <> ''
       and exists (select 1 from public.external_org_bindings b
                    where b.org_id = p_org_id and b.external_tier = 'odoo' and b.activated_at is not null)
     group by pb.external_container_id having count(*) = 1
  ), pmo_posted as (
    select e.erp_name from public.expense_posting_erp_mirror e where e.org_id = p_org_id and e.erp_name is not null
    union
    select i.erp_name from public.imprest_posting_erp_mirror i where i.org_id = p_org_id and i.erp_name is not null
    union
    select d.erp_name from public.erp_purchase_documents d
     where d.org_id = p_org_id and d.external_ref is not null
       and (d.pmo_owned or public.erp_document_recorded_by_pmo(p_org_id, d.erp_doctype, d.erp_name))
    union
    select r.erp_name from public.revenue_erp_mirror r
     where r.org_id = p_org_id and (r.pmo_owned or r.sales_invoice_id is not null)
  )
  select g.voucher_type, g.voucher_no, map.project_id, g.account, cm.category,
         min(g.posting_date),
         coalesce(sum(coalesce(g.debit, 0) - coalesce(g.credit, 0)) filter (where not g.is_cancelled), 0),
         string_agg(distinct nullif(btrim(g.remarks), ''), ' · '),
         string_agg(distinct g.party, ', '),
         bool_and(g.is_cancelled)
    from public.erp_gl_entry_mirror g
    join map on map.erp_name = g.project and map.project_id = p_project_id
    join public.projects p on p.id = map.project_id and p.org_id = p_org_id
    join public.budget_category_account_map cm on cm.org_id = g.org_id and cm.erp_account = g.account
   where g.org_id = p_org_id and g.voucher_type in ('Journal Entry', 'account.move')
     and (p_voucher_no is null or g.voucher_no = p_voucher_no)
     and not exists (select 1 from pmo_posted x where x.erp_name = g.voucher_no)
   group by g.voucher_type, g.voucher_no, map.project_id, g.account, cm.category
$$;
revoke all on function public.erp_journal_cost_lines(uuid, uuid, text) from public, anon, authenticated;

-- The project's journal lines (0687 body) with the ERP link for either tier. An Odoo move opens at
-- <site>/odoo/action-account.action_move_journal_line/<move id>; the move id is known only where a purchase or revenue mirror row
-- carries the move's ref ('account.move:<id>'). Anything else is shown as plain text.
create or replace function public.project_erp_journal_lines(p_project_id uuid)
returns table (erp_doctype text, voucher_no text, project_id uuid, account text, category public.budget_category,
               posting_date date, amount numeric, currency text, remarks text, party text, is_cancelled boolean,
               erp_url text, link_id uuid, procurement_id uuid, procurement_title text, possibly_reversed boolean)
language sql stable security definer set search_path = public, pg_catalog as $$
  with ln as (select * from public.erp_journal_cost_lines(public.auth_org_id(), p_project_id))
  select l.erp_doctype, l.voucher_no, l.project_id, l.account, l.category, l.posting_date, l.amount,
         o.default_currency, l.remarks, l.party, l.is_cancelled,
         case when b.site_url is null then null
              when b.external_tier = 'erpnext' then rtrim(b.site_url, '/') || '/app/journal-entry/' || l.voucher_no
              when mv.move_id is not null
                then rtrim(b.site_url, '/') || '/odoo/action-account.action_move_journal_line/' || mv.move_id end,
         k.id, k.procurement_id, pr.title,
         k.id is not null and not l.is_cancelled and exists (
           select 1 from ln r where r.account = l.account and r.voucher_no <> l.voucher_no
              and r.amount < 0 and not r.is_cancelled and r.posting_date >= l.posting_date)
    from ln l
    join public.organizations o on o.id = public.auth_org_id()
    left join public.external_org_bindings b
      on b.org_id = o.id and b.external_tier = case when l.erp_doctype = 'account.move' then 'odoo' else 'erpnext' end
     and b.activated_at is not null
    left join lateral (
      select substr(x.ref, 14) as move_id
        from (select d.external_ref as ref from public.erp_purchase_documents d where d.org_id = o.id and d.erp_name = l.voucher_no
              union all
              select r.external_ref from public.revenue_erp_mirror r where r.org_id = o.id and r.erp_name = l.voucher_no) x
       where x.ref ~ '^account\.move:[1-9][0-9]*$' limit 1) mv on true
    left join public.erp_journal_line_links k
      on k.org_id = o.id and k.erp_doctype = l.erp_doctype and k.voucher_no = l.voucher_no
     and k.project_id = l.project_id and k.account = l.account
    left join public.procurements pr on pr.id = k.procurement_id
   where public.is_active_member()
     and public.auth_role() in ('Admin','Executive','Project Manager','Finance')
     and public.org_reads_erp_ledger()
   order by l.posting_date desc, l.voucher_no, l.account
$$;
revoke all on function public.project_erp_journal_lines(uuid) from public, anon;
grant execute on function public.project_erp_journal_lines(uuid) to authenticated;

notify pgrst, 'reload schema';
