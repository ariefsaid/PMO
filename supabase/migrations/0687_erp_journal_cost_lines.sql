-- 0687 ERP journal cost lines on the project: list, attach to a purchase (link only), count once (#1919).
-- Spec docs/specs/erp-journal-costs-on-project.spec.md. Rollback: supabase/migrations/rollback/0687_erp_journal_cost_lines_down.sql
-- Read-side only towards the ERP: nothing here writes to ERPNext or to the ledger mirror.

create index if not exists erp_gl_entry_mirror_org_project_voucher_type_idx
  on public.erp_gl_entry_mirror (org_id, project, voucher_type);

-- A journal cost line = one journal × one PMO project × one mapped cost account (spec §3). Same project map as the
-- actuals snapshot (invertProjectMap: an ERP project name mapped by two PMO projects maps to none) and the same
-- non-cancelled rows, so the list and the actuals cannot disagree. Internal: callers below carry the role checks.
create function public.erp_journal_cost_lines(p_org_id uuid, p_project_id uuid, p_voucher_no text default null)
returns table (erp_doctype text, voucher_no text, project_id uuid, account text, category public.budget_category,
               posting_date date, amount numeric, remarks text, party text, is_cancelled boolean)
language sql stable security definer set search_path = public, pg_catalog as $$
  with map as (
    select m.value as erp_name, min(m.key)::uuid as project_id
      from public.external_org_bindings b, jsonb_each_text(coalesce(b.config->'project_map', '{}'::jsonb)) m
     where b.org_id = p_org_id and b.external_tier = 'erpnext' and b.activated_at is not null
       and m.key ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' and m.value <> ''
     group by m.value having count(*) = 1
  ), pmo_posted as (
    select e.erp_name from public.expense_posting_erp_mirror e where e.org_id = p_org_id and e.erp_name is not null
    union
    select i.erp_name from public.imprest_posting_erp_mirror i where i.org_id = p_org_id and i.erp_name is not null
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
   where g.org_id = p_org_id and g.voucher_type = 'Journal Entry'
     and (p_voucher_no is null or g.voucher_no = p_voucher_no)
     and not exists (select 1 from pmo_posted x where x.erp_name = g.voucher_no)
   group by g.voucher_type, g.voucher_no, map.project_id, g.account, cm.category
$$;
revoke all on function public.erp_journal_cost_lines(uuid, uuid, text) from public, anon, authenticated;

create table public.erp_journal_line_links (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations(id) on delete cascade,
  procurement_id uuid not null references public.procurements(id) on delete cascade,
  erp_doctype    text not null,
  voucher_no     text not null,
  project_id     uuid not null references public.projects(id) on delete restrict,
  account        text not null,
  linked_by      uuid references public.profiles(id),
  linked_at      timestamptz not null default now(),
  constraint erp_journal_line_links_one_purchase unique (org_id, erp_doctype, voucher_no, project_id, account)
);
create index erp_journal_line_links_procurement_idx on public.erp_journal_line_links (procurement_id);
alter table public.erp_journal_line_links enable row level security;
alter table public.erp_journal_line_links force row level security;
create policy erp_journal_line_links_select on public.erp_journal_line_links for select to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member())
         and (select public.auth_role()) in ('Admin','Executive','Project Manager','Finance'));
revoke all on public.erp_journal_line_links from anon, authenticated;
grant select on public.erp_journal_line_links to authenticated;

-- Defence in depth (the RPC checks first): purchase, project and link are one org, and the purchase is on the line's project.
create function public.guard_erp_journal_line_link() returns trigger
language plpgsql security definer set search_path = public, pg_catalog as $$
begin
  if not exists (select 1 from public.procurements p
                  where p.id = new.procurement_id and p.org_id = new.org_id and p.project_id = new.project_id) then
    raise exception 'A journal line can be attached only to a purchase of its own organization and project.' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function public.guard_erp_journal_line_link() from public, anon, authenticated;
create trigger erp_journal_line_links_guard before insert or update on public.erp_journal_line_links
  for each row execute function public.guard_erp_journal_line_link();

-- FR-JEC-001/030: the project's journal lines with their attachment. ERP-purchase audience; others get no rows.
create function public.project_erp_journal_lines(p_project_id uuid)
returns table (erp_doctype text, voucher_no text, project_id uuid, account text, category public.budget_category,
               posting_date date, amount numeric, currency text, remarks text, party text, is_cancelled boolean,
               erp_url text, link_id uuid, procurement_id uuid, procurement_title text)
language sql stable security definer set search_path = public, pg_catalog as $$
  select l.erp_doctype, l.voucher_no, l.project_id, l.account, l.category, l.posting_date, l.amount,
         o.default_currency, l.remarks, l.party, l.is_cancelled,
         case when b.site_url is not null
              then rtrim(b.site_url, '/') || '/app/journal-entry/' || l.voucher_no end,
         k.id, k.procurement_id, pr.title
    from public.erp_journal_cost_lines(public.auth_org_id(), p_project_id) l
    join public.organizations o on o.id = public.auth_org_id()
    left join public.external_org_bindings b
      on b.org_id = o.id and b.external_tier = 'erpnext' and b.activated_at is not null
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

create function public.attach_erp_journal_lines(p_rows jsonb, p_dry_run boolean default false)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_org uuid := public.auth_org_id(); v_uid uuid := auth.uid();
  v_currency text; v_results jsonb := '[]'::jsonb; v_row jsonb; v_n integer := 0;
  v_doctype text; v_voucher text; v_project uuid; v_account text; v_amount numeric;
  v_proc public.procurements%rowtype; v_existing uuid; v_outcome text; v_reason text;
begin
  perform public.assert_is_active_member();
  if coalesce(public.auth_role()::text, '') not in ('Admin','Executive','Project Manager','Finance') then
    raise exception 'Only Admin, Executive, Project Manager or Finance members can attach journal lines.' using errcode = '42501';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) not between 1 and 500 then
    raise exception 'Send 1 to 500 rows per call.' using errcode = '22023';
  end if;
  select o.default_currency into v_currency from public.organizations o where o.id = v_org;

  begin  -- the batch; a dry run is rolled back at the end of this block (FR-JEC-013)
    for v_row in select value from jsonb_array_elements(p_rows) loop
      v_n := v_n + 1; v_outcome := 'attach'; v_reason := null; v_proc := null; v_amount := null;
      begin  -- one row: a refusal rolls back this row only
        if jsonb_typeof(v_row) <> 'object' then raise exception using errcode = 'JEC02', message = 'line_key_missing'; end if;
        v_doctype := coalesce(nullif(btrim(v_row->>'erp_doctype'), ''), 'Journal Entry');
        v_voucher := nullif(btrim(v_row->>'voucher_no'), '');
        v_account := nullif(btrim(v_row->>'account'), '');
        v_project := nullif(btrim(v_row->>'project_id'), '')::uuid;
        if v_voucher is null or v_account is null or v_project is null then
          raise exception using errcode = 'JEC02', message = 'line_key_missing';
        end if;
        if exists (select 1 from public.expense_posting_erp_mirror e where e.org_id = v_org and e.erp_name = v_voucher)
           or exists (select 1 from public.imprest_posting_erp_mirror i where i.org_id = v_org and i.erp_name = v_voucher) then
          raise exception using errcode = 'JEC02', message = 'journal_posted_by_pmo';
        end if;
        select l.amount into v_amount from public.erp_journal_cost_lines(v_org, v_project, v_voucher) l
         where l.erp_doctype = v_doctype and l.account = v_account;
        if not found then raise exception using errcode = 'JEC02', message = 'line_not_found'; end if;
        if v_amount <= 0 then raise exception using errcode = 'JEC02', message = 'line_not_positive'; end if;

        select * into v_proc from public.procurements
         where id = nullif(btrim(v_row->>'procurement_id'), '')::uuid for update;
        if not found or v_proc.org_id is distinct from v_org then
          v_proc := null; raise exception using errcode = 'JEC02', message = 'purchase_not_found';
        end if;
        if v_proc.status::text in ('Cancelled','Rejected') then raise exception using errcode = 'JEC02', message = 'purchase_closed'; end if;
        if v_proc.project_id is distinct from v_project then raise exception using errcode = 'JEC02', message = 'project_mismatch'; end if;
        if v_proc.currency is distinct from v_currency then raise exception using errcode = 'JEC02', message = 'currency_mismatch'; end if;

        select k.procurement_id into v_existing from public.erp_journal_line_links k
         where k.org_id = v_org and k.erp_doctype = v_doctype and k.voucher_no = v_voucher
           and k.project_id = v_project and k.account = v_account
         for update;
        if found then
          if v_existing = v_proc.id then
            v_reason := 'already_attached'; raise exception using errcode = 'JEC03', message = 'skip';
          end if;
          raise exception using errcode = 'JEC02', message = 'line_attached_to_another_purchase';
        end if;

        insert into public.erp_journal_line_links (org_id, procurement_id, erp_doctype, voucher_no, project_id, account, linked_by)
        values (v_org, v_proc.id, v_doctype, v_voucher, v_project, v_account, v_uid);
        perform public.log_audit('procurement.journal_attach', v_org, v_uid, v_proc.id,
          jsonb_build_object('erp_doctype', v_doctype, 'voucher_no', v_voucher, 'project_id', v_project,
                             'account', v_account, 'amount', v_amount));
      exception
        when sqlstate 'JEC02' then v_outcome := 'refused'; v_reason := sqlerrm;
        when sqlstate 'JEC03' then v_outcome := 'skip';
        when invalid_text_representation then v_outcome := 'refused'; v_reason := 'invalid_id';
        when unique_violation then v_outcome := 'refused'; v_reason := 'line_attached_to_another_purchase';
      end;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'row', v_n, 'outcome', v_outcome, 'reason', v_reason, 'voucher_no', v_voucher,
        'procurement_id', v_proc.id, 'amount', v_amount));
    end loop;
    if p_dry_run then raise exception using errcode = 'JEC04', message = 'dry_run'; end if;
  exception when sqlstate 'JEC04' then null;
  end;
  return jsonb_build_object('dry_run', p_dry_run, 'results', v_results);
end $$;
revoke all on function public.attach_erp_journal_lines(jsonb, boolean) from public, anon;
grant execute on function public.attach_erp_journal_lines(jsonb, boolean) to authenticated;

create function public.detach_erp_journal_line(p_link_id uuid) returns void
language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_link public.erp_journal_line_links%rowtype; v_proc uuid;
begin
  perform public.assert_is_active_member();
  if coalesce(public.auth_role()::text, '') not in ('Admin','Finance') then
    raise exception 'Only an Admin or Finance member can detach a journal line.' using errcode = '42501';
  end if;
  select k.procurement_id into v_proc from public.erp_journal_line_links k
   where k.id = p_link_id and k.org_id = public.auth_org_id();
  if not found then raise exception 'link not found' using errcode = 'P0002'; end if;
  perform 1 from public.procurements where id = v_proc for update;  -- the lock attach takes (0372 order)
  delete from public.erp_journal_line_links
   where id = p_link_id and org_id = public.auth_org_id() returning * into v_link;
  if not found then raise exception 'link not found' using errcode = 'P0002'; end if;
  perform public.log_audit('procurement.journal_detach', v_link.org_id, auth.uid(), v_link.procurement_id,
    jsonb_build_object('erp_doctype', v_link.erp_doctype, 'voucher_no', v_link.voucher_no,
                       'project_id', v_link.project_id, 'account', v_link.account));
end $$;
revoke all on function public.detach_erp_journal_line(uuid) from public, anon;
grant execute on function public.detach_erp_journal_line(uuid) to authenticated;

-- Count once (FR-JEC-021): the head bodies of 0372 / 0651 plus one term. Grants are unchanged by create or replace.
create or replace function public.procurement_ledger_held(p_procurement_id uuid)
 returns numeric
 language sql
 stable security definer
 set search_path to 'public', 'pg_catalog'
as $function$
  select coalesce((select sum(coalesce(d.net_total, d.grand_total))
                     from public.procurement_erp_links l
                     join public.erp_purchase_documents d on d.id = l.erp_purchase_document_id
                    where l.procurement_id = p.id and d.erp_doctype = 'Purchase Invoice' and d.erp_docstatus = 1), 0)
       + coalesce((select sum(case when i.tax_treatment = 'inclusive' then i.amount - coalesce(i.tax_amount, 0) else i.amount end)
                     from public.procurement_invoices i
                    where i.procurement_id = p.id and i.erp_docstatus = 1 and i.erp_cancelled_at is null and i.amount is not null), 0)
       + coalesce((select sum(greatest(l.amount, 0))                                        -- 0687 FR-JEC-021
                     from public.erp_journal_line_links k
                     cross join lateral public.erp_journal_cost_lines(k.org_id, k.project_id, k.voucher_no) l
                    where k.procurement_id = p.id
                      and l.erp_doctype = k.erp_doctype and l.account = k.account), 0)
    from public.procurements p
   where p.id = p_procurement_id and (auth.uid() is null or p.org_id = public.auth_org_id())
     -- 0350 Engineer purchasing scope: invoice money is for the four money roles only (else no row → null).
     and (auth.uid() is null
          or public.auth_role() in ('Admin', 'Executive', 'Project Manager', 'Finance'))
     and (auth.uid() is null or public.is_active_member())  -- 0372: an offboarded member's token reads nothing
$function$;

create or replace function public.procurement_ledger_held_many(p_ids uuid[])
 returns table(procurement_id uuid, held numeric)
 language sql
 stable security definer
 set search_path to 'public', 'pg_catalog'
as $function$
  select p.id,
         coalesce((select sum(coalesce(d.net_total, d.grand_total))
                     from public.procurement_erp_links l
                     join public.erp_purchase_documents d on d.id = l.erp_purchase_document_id
                    where l.procurement_id = p.id and d.erp_doctype = 'Purchase Invoice' and d.erp_docstatus = 1), 0)
       + coalesce((select sum(case when i.tax_treatment = 'inclusive' then i.amount - coalesce(i.tax_amount, 0) else i.amount end)
                     from public.procurement_invoices i
                    where i.procurement_id = p.id and i.erp_docstatus = 1 and i.erp_cancelled_at is null and i.amount is not null), 0)
       + coalesce((select sum(greatest(l.amount, 0))                                        -- 0687 FR-JEC-021
                     from public.erp_journal_line_links k
                     cross join lateral public.erp_journal_cost_lines(k.org_id, k.project_id, k.voucher_no) l
                    where k.procurement_id = p.id
                      and l.erp_doctype = k.erp_doctype and l.account = k.account), 0)
    from public.procurements p
   where p.id = any (p_ids) and (auth.uid() is null or p.org_id = public.auth_org_id())
     and (auth.uid() is null
          or public.auth_role() in ('Admin', 'Executive', 'Project Manager', 'Finance'))
     and (auth.uid() is null or public.is_active_member())
$function$;
