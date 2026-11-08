-- LOCAL ONLY. Turns the seed organisation into an Odoo-bound one with a read copy of a small ledger (invented names and amounts),
-- so the project budget, the statements and the Odoo setup screen can be rendered with data (#1507 S7, scripts/ux-proof.sh).
-- Run inside scripts/with-db-lock.sh after `supabase db reset`:  psql ... -f scripts/seed-odoo-ledger-demo.sql
-- The ledger starts on the document basis (the Admin has not switched). scripts/seed-odoo-ledger-demo-switch.sql switches it.
-- Never run against a cloud database; seed.sql is not touched.
\set ON_ERROR_STOP on
begin;
do $$
declare
  v_org constant uuid := '00000000-0000-0000-0000-000000000001';
  v_proj uuid;
  v_snap uuid := gen_random_uuid();
begin
  select v.project_id into v_proj from budget_versions v join projects p on p.id = v.project_id
   where p.org_id = v_org and v.status = 'Active' order by p.created_at limit 1;
  if v_proj is null then select id into v_proj from projects where org_id = v_org order by created_at limit 1; end if;

  -- the seed organisation is bound to ERPNext; the Odoo screens show only for an organisation that is not
  update external_org_bindings set status = 'disconnected', disconnected_at = now() where org_id = v_org and external_tier = 'erpnext';
  insert into external_org_bindings (org_id, external_tier, site_url, secret_ref, status, config, activated_at)
  values (v_org, 'odoo', 'https://odoo.example.test', 'demo-fixture', 'active',
          jsonb_build_object('connection', jsonb_build_object('state','healthy','failures',0,'last_ok_at',now(),'last_checked_at',now(),'missing','[]'::jsonb),
                             'odoo_company_name','PT Contoh Demo','database','demo_db','capabilities', jsonb_build_object('missing','[]'::jsonb,'version_major',20)), now())
  on conflict (org_id, external_tier) do update set status = 'active', config = excluded.config, activated_at = now();

  insert into external_master_records (org_id, external_tier, kind, external_id, code, name, attrs, source_write_date) values
    (v_org,'odoo','company','1',null,'PT Contoh Demo','{"currency":"IDR"}', now()),
    (v_org,'odoo','account','11','1100','Bank','{"account_type":"asset_cash"}', now()),
    (v_org,'odoo','account','12','1200','Trade receivables','{"account_type":"asset_receivable"}', now()),
    (v_org,'odoo','account','21','2100','Trade payables','{"account_type":"liability_payable"}', now()),
    (v_org,'odoo','account','31','3100','Paid-in capital','{"account_type":"equity"}', now()),
    (v_org,'odoo','account','41','4100','Project revenue','{"account_type":"income"}', now()),
    (v_org,'odoo','account','51','5100','Site labour','{"account_type":"expense_direct_cost"}', now()),
    (v_org,'odoo','account','52','5200','Construction materials','{"account_type":"expense_direct_cost"}', now()),
    (v_org,'odoo','account','59','5900','Sundry site costs','{"account_type":"expense"}', now())
  on conflict do nothing;

  insert into external_project_bindings (org_id, project_id, external_tier, external_container_id) values (v_org, v_proj, 'odoo', '301')
  on conflict do nothing;
  -- the seed maps its own ERPNext accounts; the demo replaces them (both columns are unique per org)
  delete from budget_category_account_map where org_id = v_org;
  insert into budget_category_account_map (org_id, category, erp_account) values (v_org,'Labor','5100'), (v_org,'Materials','5200');

  -- Moves (one voucher each); amounts in IDR. Analytic 301 is the demo project's cost account, 999 is linked to nobody.
  insert into erp_gl_entry_mirror (org_id, erp_name, account, project, voucher_type, voucher_no, party, posting_date, debit, credit, is_cancelled, erp_docstatus, erp_modified) values
    (v_org,'odoo:1:-','1100',null,'account.move','OPEN/2026/0001',null,(current_date - 75),500000000,0,false,1,now()),
    (v_org,'odoo:2:-','3100',null,'account.move','OPEN/2026/0001',null,(current_date - 75),0,500000000,false,1,now()),
    (v_org,'odoo:3:301','5100','301','account.move','BILL/2026/0001','Bintang Tenaga',(current_date - 40),80000000,0,false,1,now()),
    (v_org,'odoo:4:-','2100',null,'account.move','BILL/2026/0001','Bintang Tenaga',(current_date - 40),0,80000000,false,1,now()),
    (v_org,'odoo:5:301','5200','301','account.move','BILL/2026/0002','Sumber Bahan',(current_date - 33),72300000,0,false,1,now()),
    (v_org,'odoo:5:-','5200',null,'account.move','BILL/2026/0002','Sumber Bahan',(current_date - 33),48200000,0,false,1,now()),
    (v_org,'odoo:6:-','2100',null,'account.move','BILL/2026/0002','Sumber Bahan',(current_date - 33),0,120500000,false,1,now()),
    (v_org,'odoo:7:301','4100','301','account.move','INV/2026/0001','Klien Utama',(current_date - 20),0,300000000,false,1,now()),
    (v_org,'odoo:8:-','1200',null,'account.move','INV/2026/0001','Klien Utama',(current_date - 20),300000000,0,false,1,now()),
    (v_org,'odoo:9:-','2100',null,'account.move','BNK/2026/0001','Bintang Tenaga',(current_date - 12),80000000,0,false,1,now()),
    (v_org,'odoo:10:-','1100',null,'account.move','BNK/2026/0001','Bintang Tenaga',(current_date - 12),0,80000000,false,1,now()),
    (v_org,'odoo:11:301','5900','301','account.move','MISC/2026/0001',null,(current_date - 8),4500000,0,false,1,now()),
    (v_org,'odoo:12:-','1100',null,'account.move','MISC/2026/0001',null,(current_date - 8),0,4500000,false,1,now()),
    (v_org,'odoo:13:999','5200','999','account.move','BILL/2026/0003','Toko Material Lain',(current_date - 5),9000000,0,false,1,now()),
    (v_org,'odoo:14:-','2100',null,'account.move','BILL/2026/0003','Toko Material Lain',(current_date - 5),0,9000000,false,1,now());

  -- What the sweep's actuals refresh writes: the demo project's net per account.
  insert into erp_actuals_snapshot (org_id, project_id, cost_center, account, fiscal_year, debit, credit, net, as_of, snapshot_id)
  select v_org, v_proj, null, m.account, extract(year from current_date)::text, sum(m.debit), sum(m.credit), sum(m.debit - m.credit), now(), v_snap
    from erp_gl_entry_mirror m where m.org_id = v_org and m.project = '301' and m.voucher_type = 'account.move' and not m.is_cancelled group by m.account;

  insert into external_sync_watermarks (org_id, external_tier, domain, watermark_cursor, updated_at) values
    (v_org,'odoo','ledger:odoo', jsonb_build_object('w', to_char(now() at time zone 'utc','YYYY-MM-DD HH24:MI:SS'), 'id', 14, 'census_done_at', now() - interval '1 hour')::text, now() - interval '4 minutes'),
    (v_org,'odoo','ledger-caught-up:odoo','true', now() - interval '4 minutes')
  on conflict (org_id, external_tier, domain) do update set watermark_cursor = excluded.watermark_cursor, updated_at = excluded.updated_at;
  insert into odoo_ledger_checks (org_id, cutoff, status, accounts_checked, feed_position, accounts)
  select v_org, now() - interval '10 minutes', 'matches', 8,
         (w.watermark_cursor::jsonb->>'w') || '|' || (w.watermark_cursor::jsonb->>'id'), '[]'::jsonb
    from external_sync_watermarks w where w.org_id = v_org and w.domain = 'ledger:odoo';
end $$;
commit;
