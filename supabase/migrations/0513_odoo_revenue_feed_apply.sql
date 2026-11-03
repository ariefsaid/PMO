-- #1506 C6 — transactional inbound Odoo revenue feed and census.
-- The binding org is passed by the verified Odoo resolver; no JSON field selects an org.
-- Native invoices and inbound receipts, plus credit notes, live in the read-only side mirror until paired.
begin;

create table public.revenue_erp_mirror (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references public.organizations(id) on delete cascade,
  erp_doctype           text not null check (erp_doctype in ('Sales Invoice','Credit Note','Incoming Payment')),
  erp_name              text not null,
  external_ref          text not null,
  customer_external_id  text,
  customer_company_id   uuid references public.companies(id) on delete set null,
  customer_name         text,
  doc_date              date,
  due_date              date,
  reference_number      text,
  currency              text,
  grand_total           numeric(18,2),
  untaxed_total         numeric(18,2),
  tax_total             numeric(18,2),
  outstanding_amount    numeric(18,2),
  erp_status            text not null,
  erp_state             text not null,
  erp_docstatus         smallint not null check (erp_docstatus in (0,1,2)),
  erp_modified          text not null,
  erp_cancelled_at      timestamptz,
  erp_attention         text,
  erp_read_at           timestamptz not null default now(),
  reversed_entry_ref   text,
  payment_invoice_ref   text,
  sales_invoice_id      uuid references public.sales_invoices(id) on delete set null,
  pmo_owned             boolean not null default false,
  adoption_key          text,
  pair_candidates       uuid[] not null default '{}',
  erp_census_seen_at    timestamptz,
  updated_at            timestamptz not null default now(),
  unique (org_id, external_ref)
);
create index revenue_erp_mirror_invoice_idx on public.revenue_erp_mirror (org_id, sales_invoice_id, erp_doctype);
create index revenue_erp_mirror_customer_idx on public.revenue_erp_mirror (org_id, customer_company_id, reference_number);

alter table public.revenue_erp_mirror enable row level security;
alter table public.revenue_erp_mirror force row level security;
create policy revenue_erp_mirror_select on public.revenue_erp_mirror for select to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member())
         and (select public.auth_role()) in ('Admin','Executive','Project Manager','Finance'));
revoke all on public.revenue_erp_mirror from anon, authenticated;
grant select on public.revenue_erp_mirror to authenticated;
grant select, insert, update, delete on public.revenue_erp_mirror to service_role;

-- Census pages stage only ids, so an interrupted census cannot tombstone unseen rows. This is an internal,
-- org-scoped table; the RPCs own its writes and the JWT role policy allows only service-role requests.
create table public.odoo_revenue_census_seen (
  org_id uuid not null references public.organizations(id) on delete cascade,
  domain text not null check (domain in ('sales-invoice','credit-note','incoming-payment')),
  run_at timestamptz not null,
  external_ref text not null,
  primary key (org_id, domain, run_at, external_ref)
);
alter table public.odoo_revenue_census_seen enable row level security;
alter table public.odoo_revenue_census_seen force row level security;
create policy odoo_revenue_census_seen_service on public.odoo_revenue_census_seen
  for all using ((auth.jwt() ->> 'role') = 'service_role')
  with check ((auth.jwt() ->> 'role') = 'service_role');
revoke all on public.odoo_revenue_census_seen from public, anon, authenticated;
revoke all on public.odoo_revenue_census_seen from service_role;

create or replace function public.odoo_revenue_model(p_domain text) returns text
  language sql immutable set search_path = public as $$
  select case p_domain when 'sales-invoice' then 'account.move' when 'credit-note' then 'account.move'
                       when 'incoming-payment' then 'account.payment' end
$$;

create or replace function public.odoo_revenue_page_rows(p_domain text, p_rows jsonb)
returns table (
  external_id text, name text, wd text, state text, docstatus smallint,
  partner text, partner_name text, doc_date date, due_date date, reference_number text, currency text,
  amount_total numeric, amount_untaxed numeric, amount_tax numeric, residual numeric, amount numeric,
  status text, reversed_entry_ref text, payment_invoice_ref text, anchor_key text
)
language sql stable set search_path = public as $$
  with newest as (
    select distinct on (x->>'external_id') x
      from jsonb_array_elements(p_rows) x
     order by x->>'external_id', x->>'source_write_date' desc, x->>'name' desc
  )
  select x->>'external_id', x->>'name', x->>'source_write_date', x#>>'{attrs,state}',
         (x#>>'{attrs,docstatus}')::smallint,
         nullif(x#>>'{attrs,partner}',''), nullif(x#>>'{attrs,partner_name}',''),
         public.odoo_safe_date(x#>>'{attrs,date}'), public.odoo_safe_date(x#>>'{attrs,due_date}'),
         nullif(x#>>'{attrs,reference_number}',''), nullif(x#>>'{attrs,currency}',''),
         public.odoo_num(x#>>'{attrs,amount_total}'), public.odoo_num(x#>>'{attrs,amount_untaxed}'),
         public.odoo_num(x#>>'{attrs,amount_tax}'), public.odoo_num(x#>>'{attrs,residual}'),
         public.odoo_num(x#>>'{attrs,amount}'), nullif(x#>>'{attrs,status}',''),
         nullif(x#>>'{attrs,reversed_entry_ref}',''), nullif(x#>>'{attrs,payment_invoice_ref}',''),
         nullif(x#>>'{attrs,anchor_key}','')
    from newest
$$;

create or replace function public.apply_odoo_revenue_page(p_org_id uuid, p_domain text, p_rows jsonb, p_cursor text)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_model text := public.odoo_revenue_model(p_domain);
  v_doctype text;
  v_n integer;
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
      erp_outstanding_amount = case when s.amount_total is not null and s.amount_untaxed is not null and s.amount_tax is not null and s.residual is not null
                                    then s.residual else t.erp_outstanding_amount end,
      status = case when s.amount_total is not null and s.amount_untaxed is not null and s.amount_tax is not null and s.residual is not null
                    then case when s.docstatus = 2 then 'Cancelled'
                              when s.docstatus = 1 and s.residual = 0 then 'Paid'
                              when s.docstatus = 1 and s.residual > 0 then 'Unpaid'
                              else t.status end
                    else t.status end,
      erp_docstatus = s.docstatus,
      erp_modified = s.wd,
      erp_cancelled_at = case when s.docstatus = 2 then coalesce(t.erp_cancelled_at, now()) else null end
    from public.odoo_revenue_page_rows(p_domain,p_rows) s
    join public.external_refs r on r.org_id = p_org_id and r.domain = 'revenue' and r.external_tier = 'odoo'
                               and r.external_record_id = v_model || ':' || s.external_id
    where t.org_id = p_org_id and t.id::text = r.pmo_record_id
      and (t.erp_modified is null or t.erp_modified <= s.wd);
  elsif p_domain = 'incoming-payment' then
    update public.incoming_payments t set
      ip_number = case when s.docstatus in (1,2) then s.name else t.ip_number end,
      date = coalesce(s.doc_date, t.date),
      amount = coalesce(s.amount, t.amount),
      status = case when s.docstatus = 1 and s.state = 'paid' then 'Paid' else 'Scheduled' end,
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
    reversed_entry_ref, payment_invoice_ref, sales_invoice_id, pmo_owned, adoption_key, pair_candidates, updated_at
  )
  select p_org_id, v_doctype, s.name, v_model || ':' || s.external_id, s.partner,
         c.id, s.partner_name, s.doc_date, s.due_date, s.reference_number, s.currency,
         case when p_domain = 'credit-note' then -abs(s.amount_total)
              when p_domain = 'incoming-payment' then s.amount else s.amount_total end,
         case when p_domain = 'credit-note' then -abs(s.amount_untaxed) else s.amount_untaxed end,
         case when p_domain = 'credit-note' then -abs(s.amount_tax) else s.amount_tax end,
         case when p_domain = 'credit-note' then -abs(s.residual) else s.residual end,
         coalesce(s.status, s.state), s.state, s.docstatus, s.wd,
         case when s.docstatus = 2 then now() end,
         case when s.amount_total is null or s.amount_untaxed is null or s.amount_tax is null or s.residual is null
              then 'money-header-incomplete' end,
         now(), s.reversed_entry_ref, s.payment_invoice_ref,
         coalesce(reversed_invoice.id, payment_invoice.id, anchor.invoice_id),
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
    left join public.external_refs payment_ref on p_domain = 'incoming-payment' and payment_ref.org_id = p_org_id
      and payment_ref.domain = 'revenue' and payment_ref.external_tier = 'odoo' and payment_ref.external_record_id = s.payment_invoice_ref
    left join public.sales_invoices payment_invoice on payment_invoice.org_id = p_org_id
      and payment_invoice.id::text = payment_ref.pmo_record_id
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
    payment_invoice_ref = excluded.payment_invoice_ref, sales_invoice_id = excluded.sales_invoice_id,
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

  insert into public.external_sync_watermarks (org_id, external_tier, domain, watermark_cursor, updated_at)
  values (p_org_id, 'odoo', 'revenue:' || p_domain, p_cursor, now())
  on conflict (org_id, external_tier, domain) do update
    set watermark_cursor = excluded.watermark_cursor, updated_at = now();

  select count(*) into v_n from public.odoo_revenue_page_rows(p_domain,p_rows);
  return v_n;
end $$;
revoke all on function public.apply_odoo_revenue_page(uuid,text,jsonb,text) from public, anon, authenticated;
grant execute on function public.apply_odoo_revenue_page(uuid,text,jsonb,text) to service_role;

create or replace function public.mark_odoo_revenue_census_seen(p_org_id uuid, p_domain text, p_run timestamptz, p_ids text[])
returns void language plpgsql security definer set search_path = public as $$
declare v_model text := public.odoo_revenue_model(p_domain);
begin
  if current_setting('role', true) <> 'service_role' then raise exception 'service role required' using errcode = '42501'; end if;
  perform public.assert_odoo_activated(p_org_id);
  if v_model is null then raise exception 'unknown revenue domain' using errcode = '22023'; end if;
  if not exists (select 1 from public.external_domain_ownership o where o.org_id=p_org_id and o.external_tier='odoo' and o.domain='revenue') then
    raise exception 'revenue is not employed under Odoo' using errcode = 'P0001';
  end if;
  if exists (select 1 from unnest(coalesce(p_ids,'{}')) id where id !~ '^[1-9][0-9]*$') then
    raise exception 'malformed revenue census id' using errcode = '22023';
  end if;
  insert into public.odoo_revenue_census_seen (org_id,domain,run_at,external_ref)
    select p_org_id,p_domain,p_run,v_model || ':' || id from unnest(coalesce(p_ids,'{}')) id
    on conflict do nothing;
  delete from public.odoo_revenue_census_seen where org_id=p_org_id and domain=p_domain and run_at < p_run - interval '1 day';
end $$;
revoke all on function public.mark_odoo_revenue_census_seen(uuid,text,timestamptz,text[]) from public, anon, authenticated;
grant execute on function public.mark_odoo_revenue_census_seen(uuid,text,timestamptz,text[]) to service_role;

create or replace function public.finish_odoo_revenue_census(p_org_id uuid, p_domain text, p_run timestamptz, p_cursor text)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_model text := public.odoo_revenue_model(p_domain);
  v_doctype text;
  v_cut timestamptz := p_run - interval '10 minutes';
  v_n integer := 0;
  v_k integer;
  v_eligible integer;
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

  insert into public.external_sync_watermarks (org_id,external_tier,domain,watermark_cursor,updated_at)
  values (p_org_id,'odoo','revenue:' || p_domain,p_cursor,now())
  on conflict (org_id,external_tier,domain) do update set watermark_cursor=excluded.watermark_cursor,updated_at=now();
  delete from public.odoo_revenue_census_seen where org_id=p_org_id and domain=p_domain and run_at=p_run;
  return v_n;
end $$;
revoke all on function public.finish_odoo_revenue_census(uuid,text,timestamptz,text) from public, anon, authenticated;
grant execute on function public.finish_odoo_revenue_census(uuid,text,timestamptz,text) to service_role;

-- Extend O2's actor-checked held-row path to Odoo revenue sends. It still never marks a command successful:
-- the ordinary recovery probes the named anchor after the Admin/Finance decision.
create or replace function public.resolve_held_outbox_command(
  p_outbox_id uuid, p_resolution text, p_external_record_id text default null, p_reason text default null)
  returns void language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_org uuid;
  v_state text;
  v_domain text;
  v_tier text;
  v_creator uuid;
  v_record text;
  v_payload jsonb;
  v_expected_model text;
begin
  if v_actor is null then raise exception 'not authenticated' using errcode='42501'; end if;
  select o.org_id,o.state,o.domain,o.external_tier,o.actor_user_id,o.pmo_record_id,o.payload
    into v_org,v_state,v_domain,v_tier,v_creator,v_record,v_payload
    from public.external_command_outbox o where o.id=p_outbox_id for update;
  if v_org is null then raise exception 'outbox command not found' using errcode='P0002'; end if;
  if v_org is distinct from public.auth_org_id() or public.auth_role() not in ('Admin','Finance')
     or not public.is_active_member() or v_creator is null or v_creator=v_actor then
    raise exception 'not authorized' using errcode='42501';
  end if;
  if v_state is distinct from 'held' then
    raise exception 'outbox command is % — only a held command can be resolved',v_state using errcode='P0001';
  end if;
  if v_tier is distinct from 'odoo' or not (
       (v_domain='procurement' and v_payload->>'erp_doc_kind'='payment')
       or (v_domain='revenue' and v_payload->>'erp_doc_kind' in ('sales-invoice','incoming-payment'))
     ) then
    raise exception 'only a held Odoo invoice or payment can be resolved here' using errcode='P0001';
  end if;
  v_expected_model := case when v_payload->>'erp_doc_kind'='sales-invoice' then 'account.move' else 'account.payment' end;
  if p_resolution='adopt' then
    if p_external_record_id is null or p_external_record_id !~ ('^' || replace(v_expected_model,'.','\.') || ':[1-9][0-9]*$') then
      raise exception 'adopt must name the matching model-qualified Odoo document' using errcode='22023';
    end if;
    if exists (select 1 from public.external_refs r where r.org_id=v_org and r.external_tier='odoo'
                and r.external_record_id=p_external_record_id
                and not (r.domain=v_domain and r.pmo_record_id=v_record)) then
      raise exception '% is already linked to another record',p_external_record_id using errcode='P0001';
    end if;
    v_payload := v_payload || jsonb_build_object('odoo_adopted_ref',p_external_record_id);
  elsif p_resolution='absent' then
    if p_external_record_id is not null then raise exception 'absent names no document' using errcode='22023'; end if;
    v_payload := v_payload || jsonb_build_object('odoo_absent_confirmed',true);
  else
    raise exception 'resolution must be adopt or absent' using errcode='22023';
  end if;

  update public.external_command_outbox set state='failed', payload=v_payload,
    last_error='hold resolved (' || p_resolution || ') by operator ' || v_actor::text || ': ' || coalesce(p_reason,''),
    claim_generation=claim_generation+1, updated_at=now()
   where id=p_outbox_id;
  perform public.log_audit('resolve_held_outbox_command',v_org,v_actor,p_outbox_id,
    jsonb_build_object('resolution',p_resolution,'external_record_id',p_external_record_id,'reason',p_reason,'resolved_from',v_state));
end;
$$;

revoke all on function public.odoo_revenue_model(text), public.odoo_revenue_page_rows(text,jsonb) from public, anon, authenticated;
grant execute on function public.odoo_revenue_model(text), public.odoo_revenue_page_rows(text,jsonb) to service_role;

commit;
