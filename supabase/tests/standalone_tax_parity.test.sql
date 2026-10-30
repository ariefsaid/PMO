-- Shared standalone-tax vectors consumed by the SQL and Vitest parity tests: one
-- inclusive/exclusive, full/reduced-base fixture set binds the Postgres RPC and the stored
-- trigger result to the TypeScript calculator's answers (midpoint and boundary values).
begin;
select plan(3);
create temporary table standalone_tax_vectors (data jsonb);
insert into standalone_tax_vectors values ($vectors$[
 {"name":"exclusive half-cent rounds up","amount":1.15,"treatment":"exclusive","rate":10,"numerator":1,"denominator":1,"tax":0.12,"net":1.15,"gross":1.27},
 {"name":"inclusive half-cent rounds up","amount":0.05,"treatment":"inclusive","rate":100,"numerator":1,"denominator":1,"tax":0.03,"net":0.02,"gross":0.05},
 {"name":"inclusive odd-cent gross splits at the half","amount":0.03,"treatment":"inclusive","rate":100,"numerator":1,"denominator":1,"tax":0.02,"net":0.01,"gross":0.03},
 {"name":"reduced exclusive base keeps 11/12 exact","amount":1000,"treatment":"exclusive","rate":12,"numerator":11,"denominator":12,"tax":110,"net":1000,"gross":1110},
 {"name":"reduced inclusive base extracts 11/12","amount":1110,"treatment":"inclusive","rate":12,"numerator":11,"denominator":12,"tax":110,"net":1000,"gross":1110},
 {"name":"thousandth-rate half-cent rounds up","amount":100,"treatment":"exclusive","rate":10.125,"numerator":1,"denominator":1,"tax":10.13,"net":100,"gross":110.13},
 {"name":"zero rate taxes nothing","amount":1234.56,"treatment":"inclusive","rate":0,"numerator":11,"denominator":12,"tax":0,"net":1234.56,"gross":1234.56},
 {"name":"zero amount taxes nothing","amount":0,"treatment":"exclusive","rate":11,"numerator":1,"denominator":1,"tax":0,"net":0,"gross":0},
 {"name":"upper amount bound rounds the last cent","amount":999999999999.99,"treatment":"exclusive","rate":12,"numerator":1,"denominator":1,"tax":120000000000,"net":999999999999.99,"gross":1119999999999.99},
 {"name":"maximal fraction keeps the sub-cent rational","amount":425917589.99,"treatment":"exclusive","rate":12,"numerator":2147483646,"denominator":2147483647,"tax":51110110.77,"net":425917589.99,"gross":477027700.76},
 {"name":"inclusive full rate halves the gross","amount":2500,"treatment":"inclusive","rate":100,"numerator":1,"denominator":1,"tax":1250,"net":1250,"gross":2500}
]$vectors$::jsonb);

select is((select count(*)::integer from standalone_tax_vectors v, jsonb_array_elements(v.data) x
  where public.calculate_standalone_tax_amount((x->>'amount')::numeric, x->>'treatment', (x->>'rate')::numeric,
          (x->>'numerator')::integer, (x->>'denominator')::integer) is distinct from (x->>'tax')::numeric),
  0, 'standalone tax RPC matches the shared vectors');

insert into organizations (id, name) values ('26f50000-0000-0000-0000-000000000001', 'Standalone tax parity');
do $$
declare v jsonb; new_id uuid; stored numeric;
begin
  for v in select x from standalone_tax_vectors, jsonb_array_elements(data) x loop
    insert into projects (id, org_id, name, status, contract_value, tax_treatment, tax_amount,
                          tax_rate, tax_base_numerator, tax_base_denominator)
      values (gen_random_uuid(), '26f50000-0000-0000-0000-000000000001', v->>'name', 'Leads',
              (v->>'amount')::numeric, v->>'treatment', 0, (v->>'rate')::numeric,
              (v->>'numerator')::integer, (v->>'denominator')::integer)
      returning id into new_id;
    select tax_amount into stored from projects where id = new_id;
    if stored is distinct from (v->>'tax')::numeric then
      raise exception 'vector % stored %', v->>'name', stored;
    end if;
  end loop;
end $$;
select is((select count(*)::integer from standalone_tax_vectors v, jsonb_array_elements(v.data) x
    join projects p on p.name = x->>'name'
    where p.tax_amount is distinct from (x->>'tax')::numeric
      or p.contract_value is distinct from (x->>'amount')::numeric),
  0, 'stored contract tax matches the shared vectors');
select is((select count(distinct p.name)::integer from projects p
    join standalone_tax_vectors v on true, jsonb_array_elements(v.data) x where p.name = x->>'name'),
  (select count(*)::integer from standalone_tax_vectors v, jsonb_array_elements(v.data) x),
  'every shared vector is exercised once by name');

select * from finish();
rollback;
