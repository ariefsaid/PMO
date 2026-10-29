begin;
select plan(9);
insert into organizations (id, name, default_currency) values
 ('f0300000-0000-0000-0000-000000000001','Reserved position A','USD'),
 ('f0300000-0000-0000-0000-000000000002','Reserved position B','USD');
insert into auth.users (id, email) values
 ('f0300000-0000-0000-0000-000000000011','reserved-a@example.test'),
 ('f0300000-0000-0000-0000-000000000012','reserved-b@example.test'),
 ('f0300000-0000-0000-0000-000000000013','reserved-engineer@example.test');
insert into profiles (id, org_id, full_name, email, role, status) values
 ('f0300000-0000-0000-0000-000000000011','f0300000-0000-0000-0000-000000000001','A','reserved-a@example.test','Finance','active'),
 ('f0300000-0000-0000-0000-000000000012','f0300000-0000-0000-0000-000000000002','B','reserved-b@example.test','Finance','active'),
 ('f0300000-0000-0000-0000-000000000013','f0300000-0000-0000-0000-000000000001','E','reserved-engineer@example.test','Engineer','active');
insert into projects (id, org_id, name, status, currency) values
 ('f0300000-0000-0000-0000-000000000021','f0300000-0000-0000-0000-000000000001','A','Ongoing Project','USD'),
 ('f0300000-0000-0000-0000-000000000022','f0300000-0000-0000-0000-000000000001','Many','Ongoing Project','USD');
insert into procurements (org_id, project_id, title, status, total_value, currency, requested_by_id)
select 'f0300000-0000-0000-0000-000000000001','f0300000-0000-0000-0000-000000000021',
 'Reserved ' || n, 'Approved', 0.25, 'USD','f0300000-0000-0000-0000-000000000011'
from generate_series(1,1001) n;
insert into procurements (org_id, project_id, title, status, total_value, currency, requested_by_id)
select 'f0300000-0000-0000-0000-000000000001','f0300000-0000-0000-0000-000000000022',
 'Currency ' || n, 'Approved', 1,
 chr(65 + n / 676) || chr(65 + (n / 26) % 26) || chr(65 + n % 26),
 'f0300000-0000-0000-0000-000000000011'
from generate_series(0,1000) n;
insert into procurements (org_id, project_id, title, status, total_value, currency, requested_by_id) values
 ('f0300000-0000-0000-0000-000000000001','f0300000-0000-0000-0000-000000000021','Own','Approved',10,'USD','f0300000-0000-0000-0000-000000000013'),
 ('f0300000-0000-0000-0000-000000000001','f0300000-0000-0000-0000-000000000021','EUR','Quote Selected',19.75,'EUR','f0300000-0000-0000-0000-000000000011'),
 ('f0300000-0000-0000-0000-000000000001','f0300000-0000-0000-0000-000000000021','Quoted','Vendor Quoted',7.75,'EUR','f0300000-0000-0000-0000-000000000011'),
 ('f0300000-0000-0000-0000-000000000001','f0300000-0000-0000-0000-000000000021','Draft','Requested',500,'USD','f0300000-0000-0000-0000-000000000011');
set local role authenticated;
set local request.jwt.claims = '{"sub":"f0300000-0000-0000-0000-000000000011","role":"authenticated"}';
select is((select (p->>'amount')::numeric from public.project_reserved_position('f0300000-0000-0000-0000-000000000021') r cross join lateral jsonb_array_elements(r.positions) p where p->>'currency' = 'USD'),260.25::numeric,'all 1001 reserved rows and the additional request contribute');
select is((select (p->>'amount')::numeric from public.project_reserved_position('f0300000-0000-0000-0000-000000000021') r cross join lateral jsonb_array_elements(r.positions) p where p->>'currency' = 'EUR'),27.50::numeric,'foreign currency has a separate position');
select is((select project_currency from public.project_reserved_position('f0300000-0000-0000-0000-000000000021') limit 1),'USD'::text,'project currency is explicit');
select is((select jsonb_array_length(positions) from public.project_reserved_position('f0300000-0000-0000-0000-000000000022')),1001,'all currency positions fit in one response row');
select is((select budget_currency from public.project_reserved_position('f0300000-0000-0000-0000-000000000021') limit 1),null::text,'missing active budget has no currency');
reset role;
insert into budget_versions (org_id, project_id, version, name, status, currency) values
 ('f0300000-0000-0000-0000-000000000001','f0300000-0000-0000-0000-000000000021',1,'Active','Active','EUR');
set local role authenticated;
select is((select budget_currency from public.project_reserved_position('f0300000-0000-0000-0000-000000000021') limit 1),'EUR'::text,'active budget currency remains explicit');
set local request.jwt.claims = '{"sub":"f0300000-0000-0000-0000-000000000013","role":"authenticated"}';
select is((select coalesce(sum((p->>'amount')::numeric),0) from public.project_reserved_position('f0300000-0000-0000-0000-000000000021') r cross join lateral jsonb_array_elements(r.positions) p),10::numeric,'restricted role sees only its own purchasing rows');
set local request.jwt.claims = '{"sub":"f0300000-0000-0000-0000-000000000012","role":"authenticated"}';
select is((select count(*) from public.project_reserved_position('f0300000-0000-0000-0000-000000000021')),0::bigint,'other organization sees no position');
reset role;
select ok(not has_function_privilege('anon','public.project_reserved_position(uuid)','execute') and has_function_privilege('authenticated','public.project_reserved_position(uuid)','execute'),'position is available to authenticated callers');
select * from finish();
rollback;
