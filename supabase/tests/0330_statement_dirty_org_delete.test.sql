-- AC-RF-002: organization cascades remove ledger rows without leaving dirty-date children.
begin;
create extension if not exists pgtap;
select plan(4);

insert into public.organizations(id,name,default_currency,default_timezone) values
  ('03300000-0000-0000-0000-000000000001','Synthetic dirty-cascade org','IDR','UTC'),
  ('03300000-0000-0000-0000-000000000002','Synthetic dirty-cascade control org','IDR','UTC');
insert into public.erp_gl_entry_mirror(org_id,erp_name,company,account,posting_date,erp_modified)
values
  ('03300000-0000-0000-0000-000000000001','dirty-cascade-target','Cascade Test Co','Synthetic Account','2026-10-19','synthetic-target'),
  ('03300000-0000-0000-0000-000000000002','dirty-cascade-control','Cascade Test Co','Synthetic Account','2026-10-19','synthetic-control');

create temporary table dirty_cascade_control_before on commit drop as
select revision from public.erp_financial_statement_dirty_date
 where org_id='03300000-0000-0000-0000-000000000002'
   and company='Cascade Test Co' and posting_date='2026-10-19';

select lives_ok($$delete from public.organizations where id='03300000-0000-0000-0000-000000000001'$$,
  'AC-RF-002 deleting an organization with valid dated ledger rows completes its cascade');
select ok(not exists(select 1 from public.organizations where id='03300000-0000-0000-0000-000000000001')
    and not exists(select 1 from public.erp_gl_entry_mirror where org_id='03300000-0000-0000-0000-000000000001')
    and not exists(select 1 from public.erp_financial_statement_dirty_date where org_id='03300000-0000-0000-0000-000000000001')
    and exists(select 1 from public.organizations where id='03300000-0000-0000-0000-000000000002')
    and exists(select 1 from public.erp_gl_entry_mirror where org_id='03300000-0000-0000-0000-000000000002'),
  'AC-RF-002 the cascade removes only the deleted organization’s ledger and dirty-date rows');

select lives_ok($$delete from public.erp_gl_entry_mirror
  where org_id='03300000-0000-0000-0000-000000000002' and erp_name='dirty-cascade-control'$$,
  'AC-RF-002 ordinary ledger deletion remains available for a surviving organization');
select ok((select d.revision > b.revision
             from public.erp_financial_statement_dirty_date d
             cross join dirty_cascade_control_before b
            where d.org_id='03300000-0000-0000-0000-000000000002'
              and d.company='Cascade Test Co' and d.posting_date='2026-10-19')
    and (select count(*)=1 from public.erp_financial_statement_dirty_date
          where org_id='03300000-0000-0000-0000-000000000002'
            and company='Cascade Test Co' and posting_date='2026-10-19')
    and not exists(select 1 from public.erp_financial_statement_dirty_date
                    where org_id in ('03300000-0000-0000-0000-000000000001',
                                     '03300000-0000-0000-0000-000000000002')
                      and org_id<>'03300000-0000-0000-0000-000000000002'),
  'AC-RF-002 ordinary deletion advances only the surviving organization’s posting-date revision');

select * from finish();
rollback;
