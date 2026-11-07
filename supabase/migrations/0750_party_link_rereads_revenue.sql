-- #1607 (FR-ECA-040 / NFR-ECA-002): an ERP invoice copied before its client was linked keeps no client, so it never pairs and counts
-- twice. The feed resolves the client once, at copy time, and its cursor is already past the invoice. Linking a party now rewinds this
-- org's ERP sales-invoice cursors (this tier only) whenever a copy still lacks its client, so the next sweep re-reads and fills it in.
-- A pass already in flight must not write its old cursor over the rewind: the Odoo page/census writes now take the cursor the pass
-- last saw (p_prev_cursor) and keep the stored one when it differs; the ERPNext sweep does the same with a conditional update.
-- Only the new-link branch of the party kind changes in apply_connect_link; every other line is the 0706 body.
drop function public.apply_odoo_revenue_page(uuid,text,jsonb,text);
drop function public.finish_odoo_revenue_census(uuid,text,timestamptz,text);
create or replace function public.apply_odoo_revenue_page(p_org_id uuid, p_domain text, p_rows jsonb, p_cursor text, p_prev_cursor text default null)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_model text := public.odoo_revenue_model(p_domain);
  v_doctype text;
  v_n integer;
  v_cur text;
begin
  if current_setting('role', true) <> 'service_role' then raise exception 'service role required' using errcode = '42501'; end if;
  perform public.assert_odoo_activated(p_org_id);
  if not exists (select 1 from public.external_domain_ownership o
                  where o.org_id = p_org_id and o.external_tier = 'odoo' and o.domain = 'revenue') then
    raise exception 'revenue is not employed under Odoo' using errcode = 'P0001';
  end if;
  if v_model is null then raise exception 'unknown revenue domain' using errcode = '22023'; end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then raise exception 'rows must be an array' using errcode = '22023'; end if;
  if exists (select 1 from jsonb_array_elements(p_rows) r
              where coalesce(r->>'external_id','') !~ '^[1-9][0-9]*$'
                 or coalesce(r->>'name','') = ''
                 or coalesce(r->>'source_write_date','') !~ '^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$'
                 or coalesce(r#>>'{attrs,docstatus}','') !~ '^[0-2]$'
                 or coalesce(r#>>'{attrs,state}','') = '') then
    raise exception 'malformed revenue row' using errcode = '22023';
  end if;

  v_doctype := case p_domain when 'sales-invoice' then 'Sales Invoice'
                             when 'credit-note' then 'Credit Note'
                             else 'Incoming Payment' end;

  -- Refresh linked PMO rows first. A failure in the later side-mirror write rolls these updates back with the cursor.
  if p_domain = 'sales-invoice' then
    update public.sales_invoices t set
      si_number = case when s.docstatus in (1,2) then s.name else t.si_number end,
      reference_number = coalesce(s.reference_number, t.reference_number),
      invoice_date = coalesce(s.doc_date, t.invoice_date),
      amount = case when s.amount_total is not null and s.amount_untaxed is not null and s.amount_tax is not null and s.residual is not null
                    then s.amount_total else t.amount end,
      tax_amount = case when s.amount_total is not null and s.amount_untaxed is not null and s.amount_tax is not null and s.residual is not null
                        then s.amount_tax else t.tax_amount end,
      tax_treatment = case when s.amount_total is not null and s.amount_untaxed is not null and s.amount_tax is not null and s.residual is not null
                           then 'inclusive' else t.tax_treatment end,
      erp_outstanding_amount = case when s.amount_total is not null and s.amount_untaxed is not null and s.amount_tax is not null and s.residual is not null
                                    then s.residual else t.erp_outstanding_amount end,
      status = case when s.amount_total is not null and s.amount_untaxed is not null and s.amount_tax is not null and s.residual is not null
                    then s.status
                    else t.status end,
      erp_docstatus = s.docstatus,
      erp_modified = s.wd,
      erp_cancelled_at = case when s.docstatus = 2 then coalesce(t.erp_cancelled_at, now()) else null end,
      odoo_state = case when s.state in ('cancel','cancelled','canceled') then 'cancel' else s.state end,
      odoo_attention = case
        when s.amount_total is null or s.amount_untaxed is null or s.amount_tax is null or s.residual is null then 'money-unreadable'
        when t.odoo_attention = 'money-unreadable' then null
        else t.odoo_attention end,
      odoo_read_at = now()
    from public.odoo_revenue_page_rows(p_domain,p_rows) s
    join public.external_refs r on r.org_id = p_org_id and r.domain = 'revenue' and r.external_tier = 'odoo'
                               and r.external_record_id = v_model || ':' || s.external_id
    where t.org_id = p_org_id and t.id::text = r.pmo_record_id
      and (t.erp_modified is null or t.erp_modified <= s.wd);
  elsif p_domain = 'incoming-payment' then
    update public.incoming_payments t set
      ip_number = case when s.docstatus in (1,2) then s.name else t.ip_number end,
      date = coalesce(s.doc_date, t.date),
      -- Odoo's payment amount is cash. A C5 receipt's PMO amount is settled gross (cash + withholding),
      -- so keep that authored gross when the row carries a withholding figure.
      amount = case when coalesce(t.withheld_amount, 0) <> 0 then t.amount else coalesce(s.amount, t.amount) end,
      status = s.status,
      erp_docstatus = s.docstatus,
      erp_modified = s.wd,
      erp_cancelled_at = case when s.docstatus = 2 then coalesce(t.erp_cancelled_at, now()) else null end
    from public.odoo_revenue_page_rows(p_domain,p_rows) s
    join public.external_refs r on r.org_id = p_org_id and r.domain = 'revenue' and r.external_tier = 'odoo'
                               and r.external_record_id = v_model || ':' || s.external_id
    where t.org_id = p_org_id and t.id::text = r.pmo_record_id
      and (t.erp_modified is null or t.erp_modified <= s.wd);
  end if;

  -- The side mirror owns Odoo-native documents and credit notes, never creates PMO revenue rows.
  insert into public.revenue_erp_mirror as d (
    org_id, erp_doctype, erp_name, external_ref, customer_external_id, customer_company_id, customer_name,
    doc_date, due_date, reference_number, currency, grand_total, untaxed_total, tax_total, outstanding_amount,
    erp_status, erp_state, erp_docstatus, erp_modified, erp_cancelled_at, erp_attention, erp_read_at,
    reversed_entry_ref, sales_invoice_id, pmo_owned, adoption_key, pair_candidates, updated_at
  )
  select p_org_id, v_doctype, s.name, v_model || ':' || s.external_id, s.partner,
         c.id, s.partner_name, s.doc_date, s.due_date, s.reference_number, s.currency,
         case when p_domain = 'credit-note' then -abs(s.amount_total)
              when p_domain = 'incoming-payment' then coalesce(ri.amount, s.amount) else s.amount_total end,
         case when p_domain = 'credit-note' then -abs(s.amount_untaxed) else s.amount_untaxed end,
         case when p_domain = 'credit-note' then -abs(s.amount_tax) else s.amount_tax end,
         case when p_domain = 'credit-note' then -abs(s.residual) else s.residual end,
         coalesce(s.status, s.state), s.state, s.docstatus, s.wd,
         case when s.docstatus = 2 then now() end,
         case when s.amount_total is null or s.amount_untaxed is null or s.amount_tax is null or s.residual is null
              then 'money-header-incomplete' end,
         now(), s.reversed_entry_ref,
         coalesce(reversed_invoice.id, anchor.invoice_id),
         (rp.id is not null or ri.id is not null or anchor.invoice_id is not null),
         case when anchor.invoice_id is not null then s.anchor_key end,
         case when anchor.invoice_id is not null then array[anchor.invoice_id]
              else coalesce(matches.ids, '{}'::uuid[]) end,
         now()
    from public.odoo_revenue_page_rows(p_domain,p_rows) s
    left join public.external_refs er on er.org_id = p_org_id and er.domain = 'companies' and er.external_tier = 'odoo'
                                     and er.external_record_id = 'Client:' || s.partner
    left join public.companies c on c.org_id = p_org_id and c.id::text = er.pmo_record_id
    left join public.external_refs rr on rr.org_id = p_org_id and rr.domain = 'revenue' and rr.external_tier = 'odoo'
                                     and rr.external_record_id = v_model || ':' || s.external_id
    left join public.sales_invoices rp on p_domain = 'sales-invoice' and rp.org_id = p_org_id and rp.id::text = rr.pmo_record_id
    left join public.incoming_payments ri on p_domain = 'incoming-payment' and ri.org_id = p_org_id and ri.id::text = rr.pmo_record_id
    left join public.external_refs reverse_ref on p_domain = 'credit-note' and reverse_ref.org_id = p_org_id
      and reverse_ref.domain = 'revenue' and reverse_ref.external_tier = 'odoo' and reverse_ref.external_record_id = s.reversed_entry_ref
    left join public.sales_invoices reversed_invoice on reversed_invoice.org_id = p_org_id
      and reversed_invoice.id::text = reverse_ref.pmo_record_id
    left join lateral (
      select i.id as invoice_id from public.sales_invoices i
       where p_domain = 'sales-invoice' and i.org_id = p_org_id
         and s.anchor_key ~* '^si:[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
         and i.id::text = substr(s.anchor_key,4)
         and not exists (select 1 from public.external_refs x where x.org_id=p_org_id and x.domain='revenue'
                          and x.external_tier='odoo' and x.pmo_record_id=i.id::text)
    ) anchor on true
    left join lateral (
      select array_agg(i.id order by i.id) as ids
        from public.sales_invoices i
       where p_domain = 'sales-invoice' and anchor.invoice_id is null and rp.id is null
         and i.org_id = p_org_id and c.id is not null and i.customer_id = c.id
         and ((s.reference_number is not null and i.reference_number = s.reference_number) or i.si_number = s.name)
         and i.currency is not distinct from s.currency
         and i.tax_amount is not distinct from s.amount_tax
         and case when i.tax_treatment = 'inclusive' then i.amount
                  when i.tax_treatment = 'exclusive' then i.amount + i.tax_amount end is not distinct from s.amount_total
         and date_trunc('month', i.invoice_date) = date_trunc('month', s.doc_date)
         and i.status <> 'Cancelled'
    ) matches on true
   where (p_domain = 'credit-note' or (rp.id is null and ri.id is null))
     and (s.docstatus in (1,2) or exists (select 1 from public.revenue_erp_mirror old
                                            where old.org_id=p_org_id and old.external_ref=v_model || ':' || s.external_id))
  on conflict (org_id, external_ref) do update set
    erp_name = excluded.erp_name, customer_external_id = excluded.customer_external_id,
    customer_company_id = excluded.customer_company_id, customer_name = excluded.customer_name,
    doc_date = excluded.doc_date, due_date = excluded.due_date, reference_number = excluded.reference_number,
    currency = excluded.currency, grand_total = excluded.grand_total, untaxed_total = excluded.untaxed_total,
    tax_total = excluded.tax_total, outstanding_amount = excluded.outstanding_amount,
    erp_status = excluded.erp_status, erp_state = excluded.erp_state, erp_docstatus = excluded.erp_docstatus,
    erp_modified = excluded.erp_modified, erp_cancelled_at = excluded.erp_cancelled_at,
    erp_attention = excluded.erp_attention, erp_read_at = now(), reversed_entry_ref = excluded.reversed_entry_ref,
    sales_invoice_id = excluded.sales_invoice_id,
    pmo_owned = excluded.pmo_owned, adoption_key = excluded.adoption_key,
    pair_candidates = excluded.pair_candidates, updated_at = now()
  where d.erp_modified <= excluded.erp_modified;

  -- A credit note can arrive before its original invoice; once that invoice is mirrored, resolve the in-org link.
  if p_domain = 'sales-invoice' then
    update public.revenue_erp_mirror d set sales_invoice_id = r.pmo_record_id::uuid, updated_at = now()
      from public.external_refs r
     where d.org_id = p_org_id and d.erp_doctype = 'Credit Note' and d.sales_invoice_id is null
       and r.org_id = p_org_id and r.domain = 'revenue' and r.external_tier = 'odoo'
       and r.external_record_id = d.reversed_entry_ref and d.reversed_entry_ref = any (
           select v_model || ':' || s.external_id from public.odoo_revenue_page_rows(p_domain,p_rows) s);
  end if;

  -- #1607: a pass that began before a party link rewound this cursor keeps the rewind (its rows above are idempotent).
  select watermark_cursor into v_cur from public.external_sync_watermarks
   where org_id = p_org_id and external_tier = 'odoo' and domain = 'revenue:' || p_domain for update;
  insert into public.external_sync_watermarks (org_id, external_tier, domain, watermark_cursor, updated_at)
  values (p_org_id, 'odoo', 'revenue:' || p_domain,
          case when found and p_prev_cursor is not null and v_cur is distinct from p_prev_cursor then v_cur else p_cursor end, now())
  on conflict (org_id, external_tier, domain) do update
    set watermark_cursor = excluded.watermark_cursor, updated_at = now();

  select count(*) into v_n from public.odoo_revenue_page_rows(p_domain,p_rows);
  return v_n;
end $$;
revoke all on function public.apply_odoo_revenue_page(uuid,text,jsonb,text,text) from public, anon, authenticated;
grant execute on function public.apply_odoo_revenue_page(uuid,text,jsonb,text,text) to service_role;

create or replace function public.finish_odoo_revenue_census(p_org_id uuid, p_domain text, p_run timestamptz, p_cursor text, p_prev_cursor text default null)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_model text := public.odoo_revenue_model(p_domain);
  v_doctype text;
  v_cut timestamptz := p_run - interval '10 minutes';
  v_n integer := 0;
  v_k integer;
  v_eligible integer;
  v_seen integer;
  v_cur text;
begin
  if current_setting('role', true) <> 'service_role' then raise exception 'service role required' using errcode = '42501'; end if;
  perform public.assert_odoo_activated(p_org_id);
  if v_model is null then raise exception 'unknown revenue domain' using errcode = '22023'; end if;
  if not exists (select 1 from public.external_domain_ownership o where o.org_id=p_org_id and o.external_tier='odoo' and o.domain='revenue') then
    raise exception 'revenue is not employed under Odoo' using errcode = 'P0001';
  end if;
  v_doctype := case p_domain when 'sales-invoice' then 'Sales Invoice' when 'credit-note' then 'Credit Note' else 'Incoming Payment' end;

  -- Count the pre-tombstone census population. Counting after the updates would exclude the
  -- side-mirror rows just marked missing and could make a valid large deletion look suspicious.
  select count(*) into v_eligible from (
    select d.external_ref as ref from public.revenue_erp_mirror d
     where d.org_id=p_org_id and d.erp_doctype=v_doctype and d.updated_at < v_cut
    union
    select r.external_record_id as ref from public.external_refs r
     where r.org_id=p_org_id and r.domain='revenue' and r.external_tier='odoo'
       and r.created_at < v_cut
       and ((p_domain='sales-invoice' and starts_with(r.external_record_id,'account.move:'))
         or (p_domain='incoming-payment' and starts_with(r.external_record_id,'account.payment:')))
  ) eligible;

  select count(*) into v_seen from public.odoo_revenue_census_seen s
   where s.org_id=p_org_id and s.domain=p_domain and s.run_at=p_run;
  if v_eligible > 0 and v_seen = 0 then
    raise exception 'revenue census saw no documents' using errcode='P0001';
  end if;

  update public.revenue_erp_mirror d set erp_attention = 'deleted-in-erp:' || d.erp_docstatus,
      erp_docstatus = 2, erp_cancelled_at = coalesce(d.erp_cancelled_at,now()), erp_read_at = now(), updated_at = now()
    where d.org_id=p_org_id and d.erp_doctype=v_doctype and d.updated_at < v_cut
      and d.erp_docstatus <> 2 and not exists (
        select 1 from public.odoo_revenue_census_seen s where s.org_id=p_org_id and s.domain=p_domain
          and s.run_at=p_run and s.external_ref=d.external_ref);
  get diagnostics v_n = row_count;

  if p_domain = 'sales-invoice' then
    update public.sales_invoices t set status='Cancelled', erp_docstatus=2,
      erp_cancelled_at=coalesce(t.erp_cancelled_at,now())
      from public.external_refs r
     where r.org_id=p_org_id and r.domain='revenue' and r.external_tier='odoo'
       and starts_with(r.external_record_id,'account.move:') and r.created_at < v_cut
       and t.org_id=p_org_id and t.id::text=r.pmo_record_id and t.erp_docstatus is distinct from 2
       and not exists (select 1 from public.odoo_revenue_census_seen s where s.org_id=p_org_id and s.domain=p_domain
                        and s.run_at=p_run and s.external_ref=r.external_record_id);
    get diagnostics v_k = row_count;
    v_n := v_n + v_k;
  elsif p_domain = 'incoming-payment' then
    update public.incoming_payments t set erp_docstatus=2, erp_cancelled_at=coalesce(t.erp_cancelled_at,now())
      from public.external_refs r
     where r.org_id=p_org_id and r.domain='revenue' and r.external_tier='odoo'
       and starts_with(r.external_record_id,'account.payment:') and r.created_at < v_cut
       and t.org_id=p_org_id and t.id::text=r.pmo_record_id and t.erp_docstatus is distinct from 2
       and not exists (select 1 from public.odoo_revenue_census_seen s where s.org_id=p_org_id and s.domain=p_domain
                        and s.run_at=p_run and s.external_ref=r.external_record_id);
    get diagnostics v_k = row_count;
    v_n := v_n + v_k;
  end if;

  if v_n > 10 and v_n * 2 > v_eligible then raise exception 'census saw implausibly few revenue documents' using errcode='P0001'; end if;

  select watermark_cursor into v_cur from public.external_sync_watermarks
   where org_id = p_org_id and external_tier = 'odoo' and domain = 'revenue:' || p_domain for update;
  insert into public.external_sync_watermarks (org_id,external_tier,domain,watermark_cursor,updated_at)
  values (p_org_id,'odoo','revenue:' || p_domain,
          case when found and p_prev_cursor is not null and v_cur is distinct from p_prev_cursor then v_cur else p_cursor end,now())
  on conflict (org_id,external_tier,domain) do update set watermark_cursor=excluded.watermark_cursor,updated_at=now();
  delete from public.odoo_revenue_census_seen where org_id=p_org_id and domain=p_domain and run_at=p_run;
  return v_n;
end $$;
revoke all on function public.finish_odoo_revenue_census(uuid,text,timestamptz,text,text) from public, anon, authenticated;
grant execute on function public.finish_odoo_revenue_census(uuid,text,timestamptz,text,text) to service_role;

-- ERPNext sweep: its cursor upsert states the cursor it last saw (expected_cursor); when the stored one has moved on (a party link
-- rewound it), the write keeps the stored cursor. The expectation is never stored on an update; a writer that sends none is unchanged.
alter table public.external_sync_watermarks add column expected_cursor text;
create function public.keep_rewound_cursor() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    if new.expected_cursor is not null and old.watermark_cursor is distinct from new.expected_cursor then
      new.watermark_cursor := old.watermark_cursor;
    end if;
    new.expected_cursor := null;
  end if;
  return new;
end $$;
revoke all on function public.keep_rewound_cursor() from public, anon, authenticated;
create trigger external_sync_watermarks_keep_rewound before insert or update on public.external_sync_watermarks
  for each row execute function public.keep_rewound_cursor();

create or replace function public.apply_connect_link(p_org uuid, p_tier text, p_kind text, p_pmo text, p_ext text, p_snapshot jsonb, p_actor uuid) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uuid uuid; v_n int; v_ref public.external_refs%rowtype; v_emp public.erp_employees%rowtype; v_email text; v_emps int;
        v_key text := p_snapshot->>'matchKey'; v_reviewed boolean := coalesce((p_snapshot->>'reviewed')::boolean, false);
begin
  -- A person's cost identity and a budget account link only on their strong key (the work email, the category code) or after a
  -- person has looked at the pair (decide_connect_review). A name, or a key this function cannot recheck, never links.
  if p_kind in ('employee', 'account') and not v_reviewed and v_key is distinct from 'code' then return 'This pairing needs a person to confirm it'; end if;
  if p_kind = 'party' then
    if not exists (select 1 from public.companies where id = p_pmo::uuid and org_id = p_org) then return 'This company is no longer in PMO'; end if;
    -- FR-ODC-052 (#1691): an Internal company is PMO's own org marker, never an ERP party; the candidate
    -- lists keep it out and the link step itself refuses it, so the rule holds in one place for every tier.
    if exists (select 1 from public.companies where id = p_pmo::uuid and org_id = p_org and type = 'Internal') then
      return 'An internal company cannot take an ERP link';
    end if;
    -- a tax-keyed link is only as good as the tax id: it must still be the one that was proposed
    if v_key = 'tax' and not v_reviewed and regexp_replace(lower(coalesce((select erp_tax_id from public.companies where id = p_pmo::uuid), '')), '[^0-9a-z]', '', 'g')
         is distinct from regexp_replace(lower(coalesce(p_snapshot->>'taxId', '')), '[^0-9a-z]', '', 'g') then
      return 'The ERP record changed since this was proposed';
    end if;
    insert into public.external_refs (org_id, domain, pmo_record_id, external_tier, external_record_id)
      values (p_org, 'companies', p_pmo, p_tier, p_ext) on conflict do nothing;
    get diagnostics v_n = row_count;
    if v_n = 1 then
      -- the tax id is filled, never overwritten; while companies belong to the ERP the feed owns the column
      if coalesce(p_snapshot->>'taxId', '') <> '' and not public.domain_externally_owned(p_org, 'companies') then
        update public.companies set erp_tax_id = coalesce(erp_tax_id, p_snapshot->>'taxId') where id = p_pmo::uuid and org_id = p_org;
      end if;
      -- #1607: re-read this tier's sales-invoice cursors when a copy still has no client. An Odoo copy names its partner, so only the
      -- partner just linked counts; an ERPNext copy keeps no customer name, so any client-less ERPNext copy counts (cost only: one
      -- bounded re-read). Receipts take their client from the invoice and are not re-read.
      if exists (select 1 from public.sales_invoices where org_id = p_org and not pmo_native and customer_id is null)
         or exists (select 1 from public.revenue_erp_mirror where org_id = p_org and customer_company_id is null
                      and customer_external_id is not null and 'Client:' || customer_external_id = p_ext) then
        update public.external_sync_watermarks set watermark_cursor = '', updated_at = now()
         where org_id = p_org and external_tier = p_tier and watermark_cursor <> ''
           and domain in ('revenue::Sales Invoice', 'revenue:sales-invoice', 'revenue:credit-note');
      end if;
      return null;
    end if;
    select * into v_ref from public.external_refs where org_id = p_org and domain = 'companies' and pmo_record_id = p_pmo;
    if found and v_ref.external_record_id = p_ext then return null; end if;   -- reconciled
    return 'This record is already linked to another ERP record';
  elsif p_kind = 'project' then
    if not exists (select 1 from public.projects where id = p_pmo::uuid and org_id = p_org) then return 'This project is no longer in PMO'; end if;
    return public.connect_link_project(p_org, p_tier, p_pmo, p_ext);
  elsif p_kind = 'item' then
    if public.connect_config_map_link(p_org, p_tier, 'item_map', p_pmo, p_ext, false) then return null; end if;
    if exists (select 1 from public.external_org_bindings where org_id = p_org and external_tier = p_tier and status = 'active'
                 and config->'item_map'->>p_pmo = p_ext) then return null; end if;
    return 'This item is already linked';
  elsif p_kind = 'employee' then
    -- employee_number is display-only and not unique: never guess between two rows
    select count(*) into v_emps from public.erp_employees where org_id = p_org and employee_number = p_ext;
    if v_emps = 0 then return 'This person has not been read from the ERP yet'; end if;
    if v_emps > 1 then return 'More than one ERP person has this number'; end if;
    select * into v_emp from public.erp_employees where org_id = p_org and employee_number = p_ext for update;
    v_uuid := p_pmo::uuid;
    select lower(email) into v_email from public.profiles where id = v_uuid and org_id = p_org;
    if v_email is null then return 'This person is no longer in PMO'; end if;
    if v_emp.link_state = 'confirmed' then
      return case when v_emp.profile_id = v_uuid then null else 'This ERP employee is already linked to another person' end;
    end if;
    if v_emp.link_state = 'rejected' then return 'An administrator declined this pairing'; end if;
    -- an email-keyed match is only as good as the email: the Desk can edit it, so it must still be what was proposed
    if not v_reviewed and lower(coalesce(nullif(v_emp.work_email, ''), v_emp.erp_user_id, '')) is distinct from v_email then
      return 'The ERP record changed since this was proposed';
    end if;
    begin
      update public.erp_employees set profile_id = v_uuid, link_state = 'confirmed', linked_by = p_actor, linked_at = now()
       where id = v_emp.id;
    exception when unique_violation then
      return 'This person is already linked to another ERP employee';
    end;
    return null;
  elsif p_kind = 'account' then
    -- the category code the ERP account was proposed under must still be the category being linked
    if not v_reviewed and p_snapshot->>'code' is distinct from p_pmo then return 'The ERP account changed since this was proposed'; end if;
    insert into public.budget_category_account_map (org_id, category, erp_account, updated_by)
      values (p_org, p_pmo::public.budget_category, p_ext, p_actor) on conflict do nothing;
    get diagnostics v_n = row_count;
    if v_n = 1 then return null; end if;
    if exists (select 1 from public.budget_category_account_map where org_id = p_org and category = p_pmo::public.budget_category and erp_account = p_ext) then
      return null;   -- reconciled
    end if;
    return 'This account is already used by another category';
  end if;
  return 'This kind cannot be linked';
end $$;
