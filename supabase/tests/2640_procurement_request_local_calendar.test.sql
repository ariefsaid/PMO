-- Calendar conversion uses the timestamp being classified, including historical captures.
begin;
select plan(4);
insert into organizations(id,name,default_timezone) values
 ('26400000-0000-0000-0000-000000000001','Calendar test','Asia/Jakarta');
select is(public.native_org_date('26400000-0000-0000-0000-000000000001', '2026-01-01 18:00:00+00'), '2026-01-02'::date,
 'east of UTC: creation belongs to the following local day');
update organizations set default_timezone = 'America/Los_Angeles' where id = '26400000-0000-0000-0000-000000000001';
select is(public.native_org_date('26400000-0000-0000-0000-000000000001', '2026-01-02 02:00:00+00'), '2026-01-01'::date,
 'west of UTC: creation belongs to the previous local day');
select is(public.native_org_today('26400000-0000-0000-0000-000000000001'), public.native_org_date('26400000-0000-0000-0000-000000000001', now()),
 'transition and capture share the same calendar conversion');
set local timezone = 'Pacific/Kiritimati';
select is(public.native_org_date('26400000-0000-0000-0000-000000000001', '2026-01-02 02:00:00+00'), '2026-01-01'::date,
 'session timezone cannot change the organisation creation day');
select * from finish();
rollback;
