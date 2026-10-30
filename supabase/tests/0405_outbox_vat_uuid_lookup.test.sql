-- Outbox VAT context and project VAT lock reason resolve record IDs by validating the text
-- once and comparing the UUID columns directly, so the per-command lookups use the row keys'
-- indexes. Proof: identical outcomes against the previous definition (pinned verbatim as temp
-- twin triggers), index-eligible plans on populated tables, and the case-insensitive,
-- malformed-ID, conflict, witness, lock and scope rules unchanged.
begin;
select plan(30);

-- ── fixtures ────────────────────────────────────────────────────────────────────────────────
insert into organizations (id, name) values
  ('04050000-0000-0000-0000-000000000001', 'VAT UUID lookup'),
  ('04050000-0000-0000-0000-000000000002', 'VAT UUID other org');
insert into auth.users (id, email) values ('04050000-0000-0000-0000-0000000000a1', 'vat-uuid@0405.example');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('04050000-0000-0000-0000-0000000000a1', '04050000-0000-0000-0000-000000000001',
   'VAT UUID Fixture', 'vat-uuid@0405.example', 'Finance', 'active');
insert into projects (id, org_id, name, status, contract_value, tax_treatment, tax_amount, subject_to_vat) values
  ('04050000-0000-0000-0000-0000000000b1', '04050000-0000-0000-0000-000000000001', 'VAT UUID project', 'Ongoing Project', 1000, 'exclusive', 120, true),
  ('04050000-0000-0000-0000-0000000000b2', '04050000-0000-0000-0000-000000000001', 'Other VAT project', 'Ongoing Project', 500, 'exclusive', 60, true),
  ('04050000-0000-0000-0000-0000000000b3', '04050000-0000-0000-0000-000000000001', 'Volume project', 'Leads', 0, 'exclusive', 0, false),
  ('04050000-0000-0000-0000-0000000000b4', '04050000-0000-0000-0000-000000000002', 'Other org project', 'Ongoing Project', 500, 'exclusive', 60, true),
  ('04050000-0000-0000-0000-0000000000b5', '04050000-0000-0000-0000-000000000001', 'Claim only project', 'Ongoing Project', 500, 'exclusive', 60, true);

insert into sales_invoices (id, org_id, project_id, amount, tax_treatment, tax_amount) values
  ('04050000-0000-0000-0000-0000000000c1', '04050000-0000-0000-0000-000000000001', '04050000-0000-0000-0000-0000000000b1', 100, 'exclusive', 12),
  ('04050000-0000-0000-0000-0000000000c2', '04050000-0000-0000-0000-000000000002', '04050000-0000-0000-0000-0000000000b4', 100, 'exclusive', 12),
  ('04050000-0000-0000-0000-0000000000c3', '04050000-0000-0000-0000-000000000001', '04050000-0000-0000-0000-0000000000b2', 100, 'exclusive', 12);
insert into progress_claims (id, org_id, project_id, kind, currency, gross_amount, created_by) values
  ('04050000-0000-0000-0000-0000000000d1', '04050000-0000-0000-0000-000000000001', '04050000-0000-0000-0000-0000000000b1', 'progress', 'USD', 100, '04050000-0000-0000-0000-0000000000a1'),
  ('04050000-0000-0000-0000-0000000000d2', '04050000-0000-0000-0000-000000000001', '04050000-0000-0000-0000-0000000000b5', 'progress', 'USD', 100, '04050000-0000-0000-0000-0000000000a1'),
  ('04050000-0000-0000-0000-0000000000d3', '04050000-0000-0000-0000-000000000002', '04050000-0000-0000-0000-0000000000b4', 'progress', 'USD', 100, '04050000-0000-0000-0000-0000000000a1');

-- A real pending claim command must satisfy the separate billing-evidence fence.
insert into project_documents (id, org_id, project_id, category, title, status, revision, file_path)
values ('04050000-0000-0000-0000-0000000000e1', '04050000-0000-0000-0000-000000000001',
  '04050000-0000-0000-0000-0000000000b5', 'Report', 'Claim evidence', 'Issued', 'A',
  '04050000-0000-0000-0000-000000000001/04050000-0000-0000-0000-0000000000b5/04050000-0000-0000-0000-0000000000e1/report.pdf');
set local role authenticated;
set local request.jwt.claims = '{"sub":"04050000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select public.attach_claim_evidence('04050000-0000-0000-0000-0000000000d2', '04050000-0000-0000-0000-0000000000e1');
reset role;

-- Representative population so plan shapes reflect a real table, not a one-page toy.
insert into sales_invoices (id, org_id, project_id, amount, tax_treatment, tax_amount)
select md5('si-volume' || g::text)::uuid, '04050000-0000-0000-0000-000000000001', '04050000-0000-0000-0000-0000000000b3', 100, 'exclusive', 0
from generate_series(1, 4000) g;
insert into progress_claims (id, org_id, project_id, kind, currency, gross_amount, created_by)
select md5('pc-volume' || g::text)::uuid, '04050000-0000-0000-0000-000000000001', '04050000-0000-0000-0000-0000000000b3', 'progress', 'USD', 100, '04050000-0000-0000-0000-0000000000a1'
from generate_series(1, 4000) g;
analyze public.sales_invoices;
analyze public.progress_claims;

-- ── the shipped lookup shapes: the body itself must carry the direct comparison ─────────────
select is((select position('id::text' in prosrc) from pg_proc where proname = 'guard_outbox_vat_context'),
  0, 'the guard resolves record IDs by direct UUID comparison');
select is((select position('id::text' in prosrc) from pg_proc where proname = 'project_invoice_vat_lock_reason'),
  0, 'the lock reason resolves record IDs by direct UUID comparison');

-- ── previous definition, pinned verbatim (the twin every behavioral claim is compared to) ───
create function pg_temp.lock_reason_previous(p_org uuid, p_project uuid)
returns text language sql volatile set search_path = public as $$
  select case
    when exists (
      select 1 from public.sales_invoices si
       where si.org_id = p_org and si.project_id = p_project
         and not coalesce(si.status::text = 'Cancelled' and (
           si.pmo_native or si.erp_docstatus = 2
           or (si.si_number is null and si.erp_docstatus is null)), false)
    ) then 'vat-live-invoice'
    when exists (
      select 1 from public.external_command_outbox o
       where o.org_id = p_org and o.domain = 'revenue'
         and o.payload->>'erp_doc_kind' = 'sales-invoice'
         and o.state not in ('confirmed','failed')
         and (
           lower(o.payload->>'projectId') = lower(p_project::text)
           or exists (select 1 from public.sales_invoices si
                       where si.org_id = p_org and si.project_id = p_project
                         and lower(si.id::text) = lower(o.pmo_record_id))
           or exists (select 1 from public.progress_claims pc
                       where pc.org_id = p_org and pc.project_id = p_project
                         and lower(pc.id::text) = lower(o.pmo_record_id))
         )
    ) then 'vat-command-pending'
    else null end
$$;
create function pg_temp.guard_previous() returns trigger
language plpgsql security definer set search_path=public as $$
declare
  v_project uuid;
  v_invoice_project uuid;
  v_claim_project uuid;
  v_payload_project uuid;
  v_vat boolean;
  v_builds_body boolean;
  v_needs_witness boolean;
begin
  if new.domain is distinct from 'revenue' or new.payload->>'erp_doc_kind' is distinct from 'sales-invoice'
     or new.state in ('confirmed','failed') then return new; end if;

  select project_id into v_invoice_project from public.sales_invoices
    where org_id=new.org_id and lower(id::text)=lower(new.pmo_record_id) limit 1;
  select project_id into v_claim_project from public.progress_claims
    where org_id=new.org_id and lower(id::text)=lower(new.pmo_record_id) limit 1;
  if coalesce(new.payload->>'projectId','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_payload_project := (new.payload->>'projectId')::uuid;
  elsif nullif(new.payload->>'projectId','') is not null then
    raise exception 'invalid project association' using errcode='P0001', detail='vat-context-unavailable';
  end if;
  if (v_invoice_project is not null and v_claim_project is not null and v_invoice_project<>v_claim_project)
     or (v_invoice_project is not null and v_payload_project is not null and v_invoice_project<>v_payload_project)
     or (v_claim_project is not null and v_payload_project is not null and v_claim_project<>v_payload_project) then
    raise exception 'conflicting project association' using errcode='P0001', detail='vat-context-changed';
  end if;
  v_project := coalesce(v_invoice_project,v_claim_project,v_payload_project);
  if v_project is null then return new; end if;
  perform 1 from public.projects where id=v_project and org_id=new.org_id for share;
  if not found then raise exception 'project not found' using errcode='P0001', detail='vat-context-unavailable'; end if;
  select subject_to_vat into v_vat from public.projects where id=v_project and org_id=new.org_id;

  v_builds_body := new.operation in ('create','update')
    or (new.operation='transition' and new.payload->>'verb'='amend');
  v_needs_witness := tg_op='INSERT';
  if tg_op='UPDATE' then v_needs_witness := old.state='failed'; end if;
  if v_builds_body and v_needs_witness then
    if jsonb_typeof(new.payload->'vat_flag_at_resolution') is distinct from 'boolean' then
      raise exception 'invoice VAT context could not be verified' using errcode='P0001', detail='vat-context-unavailable';
    end if;
    if (new.payload->>'vat_flag_at_resolution')::boolean is distinct from v_vat then
      raise exception 'project VAT changed before this invoice command could be sent' using errcode='P0001', detail='vat-context-changed';
    end if;
  end if;
  return new;
end;
$$;

-- ── twin probe tables: the previous and current guards as INSERT triggers ───────────────────
create temp table vat_guard_previous (like public.external_command_outbox including defaults);
create temp table vat_guard_current (like public.external_command_outbox including defaults);
create trigger vat_guard_previous_probe before insert on vat_guard_previous
  for each row execute function pg_temp.guard_previous();
create trigger vat_guard_current_probe before insert on vat_guard_current
  for each row execute function public.guard_outbox_vat_context();

create function pg_temp.probe_guard(r jsonb) returns table(prev jsonb, curr jsonb) language plpgsql as $$
declare v_detail text; v_row external_command_outbox;
begin
  v_row := jsonb_populate_record(null::external_command_outbox, r);
  begin
    insert into vat_guard_previous (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state, payload)
      select v_row.org_id, v_row.domain, v_row.pmo_record_id, v_row.idempotency_key, v_row.external_tier, v_row.operation, v_row.state, v_row.payload;
    prev := jsonb_build_object('outcome', 'accept');
  exception when others then
    get stacked diagnostics v_detail = PG_EXCEPTION_DETAIL;
    prev := jsonb_build_object('outcome', 'raise', 'code', SQLSTATE, 'detail', v_detail);
  end;
  begin
    insert into vat_guard_current (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state, payload)
      select v_row.org_id, v_row.domain, v_row.pmo_record_id, v_row.idempotency_key, v_row.external_tier, v_row.operation, v_row.state, v_row.payload;
    curr := jsonb_build_object('outcome', 'accept');
  exception when others then
    get stacked diagnostics v_detail = PG_EXCEPTION_DETAIL;
    curr := jsonb_build_object('outcome', 'raise', 'code', SQLSTATE, 'detail', v_detail);
  end;
  return next;
end $$;

create temp table vat_guard_probes as
select c.name, p.prev, p.curr
from (values
  ('base: mixed-case invoice record id with witness', jsonb_build_object(
    'org_id', '04050000-0000-0000-0000-000000000001', 'domain', 'revenue',
    'pmo_record_id', '04050000-0000-0000-0000-0000000000C1', 'idempotency_key', 'g1',
    'external_tier', 'erpnext', 'operation', 'create', 'state', 'pending',
    'payload', jsonb_build_object('erp_doc_kind', 'sales-invoice',
      'projectId', '04050000-0000-0000-0000-0000000000b1', 'vat_flag_at_resolution', true))),
  ('lowercase claim record id resolves', jsonb_build_object(
    'org_id', '04050000-0000-0000-0000-000000000001', 'domain', 'revenue',
    'pmo_record_id', '04050000-0000-0000-0000-0000000000d1', 'idempotency_key', 'g2',
    'external_tier', 'erpnext', 'operation', 'create', 'state', 'pending',
    'payload', jsonb_build_object('erp_doc_kind', 'sales-invoice', 'vat_flag_at_resolution', true))),
  ('malformed record id falls back to the payload project', jsonb_build_object(
    'org_id', '04050000-0000-0000-0000-000000000001', 'domain', 'revenue',
    'pmo_record_id', 'definitely-not-a-uuid', 'idempotency_key', 'g3',
    'external_tier', 'erpnext', 'operation', 'create', 'state', 'pending',
    'payload', jsonb_build_object('erp_doc_kind', 'sales-invoice',
      'projectId', '04050000-0000-0000-0000-0000000000b1', 'vat_flag_at_resolution', true))),
  ('another org''s record id never resolves', jsonb_build_object(
    'org_id', '04050000-0000-0000-0000-000000000001', 'domain', 'revenue',
    'pmo_record_id', '04050000-0000-0000-0000-0000000000C2', 'idempotency_key', 'g4',
    'external_tier', 'erpnext', 'operation', 'create', 'state', 'pending',
    'payload', jsonb_build_object('erp_doc_kind', 'sales-invoice',
      'projectId', '04050000-0000-0000-0000-0000000000b1', 'vat_flag_at_resolution', true))),
  ('payload conflicting with the invoice project raises', jsonb_build_object(
    'org_id', '04050000-0000-0000-0000-000000000001', 'domain', 'revenue',
    'pmo_record_id', '04050000-0000-0000-0000-0000000000C1', 'idempotency_key', 'g5',
    'external_tier', 'erpnext', 'operation', 'create', 'state', 'pending',
    'payload', jsonb_build_object('erp_doc_kind', 'sales-invoice',
      'projectId', '04050000-0000-0000-0000-0000000000b2', 'vat_flag_at_resolution', true))),
  ('claim requires witness', jsonb_build_object(
    'org_id', '04050000-0000-0000-0000-000000000001', 'domain', 'revenue',
    'pmo_record_id', '04050000-0000-0000-0000-0000000000D2', 'idempotency_key', 'g7',
    'external_tier', 'erpnext', 'operation', 'create', 'state', 'pending',
    'payload', jsonb_build_object('erp_doc_kind', 'sales-invoice'))),
  ('claim conflict', jsonb_build_object(
    'org_id', '04050000-0000-0000-0000-000000000001', 'domain', 'revenue',
    'pmo_record_id', '04050000-0000-0000-0000-0000000000D2', 'idempotency_key', 'g8',
    'external_tier', 'erpnext', 'operation', 'create', 'state', 'pending',
    'payload', jsonb_build_object('erp_doc_kind', 'sales-invoice',
      'projectId', '04050000-0000-0000-0000-0000000000b1', 'vat_flag_at_resolution', true))),
  ('other org claim', jsonb_build_object(
    'org_id', '04050000-0000-0000-0000-000000000001', 'domain', 'revenue',
    'pmo_record_id', '04050000-0000-0000-0000-0000000000D3', 'idempotency_key', 'g9',
    'external_tier', 'erpnext', 'operation', 'create', 'state', 'pending',
    'payload', jsonb_build_object('erp_doc_kind', 'sales-invoice'))),
  ('confirmed state skips the context resolution', jsonb_build_object(
    'org_id', '04050000-0000-0000-0000-000000000001', 'domain', 'revenue',
    'pmo_record_id', 'whatever', 'idempotency_key', 'g6',
    'external_tier', 'erpnext', 'operation', 'create', 'state', 'confirmed',
    'payload', jsonb_build_object('erp_doc_kind', 'sales-invoice')))
) as c(name, vec),
lateral pg_temp.probe_guard(c.vec) p;

select is((select count(*)::integer from vat_guard_probes where prev is distinct from curr),
  0, 'guard outcomes match the previous definition on every context vector');
select is((select curr->>'outcome' from vat_guard_probes where name like 'base:%'), 'accept',
  'a mixed-case record id resolves and accepts');
select is((select curr->>'outcome' from vat_guard_probes where name like 'lowercase%'), 'accept',
  'a lowercase claim record id resolves and accepts');
select is((select curr->>'outcome' from vat_guard_probes where name like 'malformed%'), 'accept',
  'a malformed record id keeps the payload-project path');
select is((select curr->>'outcome' from vat_guard_probes where name like 'another org%'), 'accept',
  'another org''s record id is never resolved into this org''s context');
select is((select curr->>'detail' from vat_guard_probes where name like 'payload conflicting%'), 'vat-context-changed',
  'a payload conflict still raises the context-changed outcome');

select is((select curr->>'detail' from vat_guard_probes where name = 'claim requires witness'), 'vat-context-unavailable',
  'a mixed-case claim record requires a VAT witness');
select is((select curr->>'detail' from vat_guard_probes where name = 'claim conflict'), 'vat-context-changed',
  'a claim and a different payload project produce a context conflict');
select is((select curr->>'outcome' from vat_guard_probes where name = 'other org claim'), 'accept',
  'a claim in another organization does not supply context');

-- ── plans: the record-ID lookup reaches the row keys' indexes on populated tables ───────────
create function pg_temp.explain_text(q text) returns text language plpgsql as $$
declare r record; out text := '';
begin
  for r in execute 'explain (costs off) ' || q loop
    out := out || r."QUERY PLAN" || E'\n';
  end loop;
  return out;
end $$;

select is(pg_temp.explain_text($q$select 1 from public.sales_invoices
  where org_id = '04050000-0000-0000-0000-000000000001'
    and lower(id::text) = lower('04050000-0000-0000-0000-0000000000c1')$q$) like '%Seq Scan on sales_invoices%',
  true, 'the previous text-comparison predicate cannot use the invoice row key');
select is(pg_temp.explain_text($q$select 1 from public.sales_invoices
  where org_id = '04050000-0000-0000-0000-000000000001'
    and id = '04050000-0000-0000-0000-0000000000c1'::uuid$q$) like '%Index Scan using sales_invoices_pkey%',
  true, 'the direct UUID comparison uses the invoice row key');
select is(pg_temp.explain_text($q$select 1 from public.progress_claims
  where org_id = '04050000-0000-0000-0000-000000000001'
    and id = '04050000-0000-0000-0000-0000000000d1'::uuid$q$) like '%Index Scan using progress_claims_pkey%',
  true, 'the direct UUID comparison uses the claim row key');

-- ── lock reason: decisive record-id resolution plus parity with the previous definition ─────
insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state, payload)
values ('04050000-0000-0000-0000-000000000001', 'revenue', '04050000-0000-0000-0000-0000000000C1', '0405-mixed', 'erpnext', 'create', 'pending',
        '{"erp_doc_kind":"sales-invoice","vat_flag_at_resolution":true}');
select is(public.project_invoice_vat_lock_reason('04050000-0000-0000-0000-000000000001', '04050000-0000-0000-0000-0000000000b1'),
  'vat-live-invoice', 'while the invoice is live it still leads the lock reasons');
select is((select count(*)::integer from (values
    ('04050000-0000-0000-0000-0000000000b1'::uuid), ('04050000-0000-0000-0000-0000000000b2'::uuid)) p(project)
  where public.project_invoice_vat_lock_reason('04050000-0000-0000-0000-000000000001', p.project)
    is distinct from pg_temp.lock_reason_previous('04050000-0000-0000-0000-000000000001', p.project)),
  0, 'lock reason parity with the previous definition on the populated state');
select is(public.project_invoice_vat_lock_reason('04050000-0000-0000-0000-000000000001', '04050000-0000-0000-0000-0000000000b2'),
  'vat-live-invoice', 'a project with a live invoice keeps that lock');
select is(public.project_invoice_vat_lock_reason('04050000-0000-0000-0000-000000000002', '04050000-0000-0000-0000-0000000000b1'),
  null, 'lookups stay inside their organization');

-- This project has no invoice; the pending claim is the only possible lock source.
insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state, payload)
values ('04050000-0000-0000-0000-000000000001', 'revenue', '04050000-0000-0000-0000-0000000000D2', '0405-claim', 'erpnext', 'create', 'pending',
        '{"erp_doc_kind":"sales-invoice","vat_flag_at_resolution":true}');
select is((select count(*)::integer from public.sales_invoices where project_id = '04050000-0000-0000-0000-0000000000b5'),
  0, 'claim-only project has no invoice');
select is(public.project_invoice_vat_lock_reason('04050000-0000-0000-0000-000000000001', '04050000-0000-0000-0000-0000000000b5'),
  'vat-command-pending', 'a mixed-case claim record alone produces a pending lock');
select is(public.project_invoice_vat_lock_reason('04050000-0000-0000-0000-000000000001', '04050000-0000-0000-0000-0000000000b5'),
  pg_temp.lock_reason_previous('04050000-0000-0000-0000-000000000001', '04050000-0000-0000-0000-0000000000b5'),
  'pending claim lock matches the previous definition');

-- ── live trigger: insert-level semantics unchanged ──────────────────────────────────────────
select lives_ok($$insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state, payload)
  values ('04050000-0000-0000-0000-000000000001', 'revenue', 'still not a uuid', '0405-live-1', 'erpnext', 'create', 'pending',
          jsonb_build_object('erp_doc_kind', 'sales-invoice', 'projectId', '04050000-0000-0000-0000-0000000000b1',
            'vat_flag_at_resolution', true))$$,
  'a malformed record id with a valid payload project is accepted');
select throws_ok($$insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state, payload)
  values ('04050000-0000-0000-0000-000000000001', 'revenue', '04050000-0000-0000-0000-0000000000c1', '0405-live-2', 'erpnext', 'create', 'pending',
          jsonb_build_object('erp_doc_kind', 'sales-invoice', 'projectId', '04050000-0000-0000-0000-0000000000b1'))$$,
  'P0001', 'invoice VAT context could not be verified',
  'a revenue create still needs its VAT witness');
select throws_ok($$insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state, payload)
  values ('04050000-0000-0000-0000-000000000001', 'revenue', '04050000-0000-0000-0000-0000000000c1', '0405-live-3', 'erpnext', 'create', 'pending',
          jsonb_build_object('erp_doc_kind', 'sales-invoice', 'projectId', '04050000-0000-0000-0000-0000000000b1',
            'vat_flag_at_resolution', false))$$,
  'P0001', 'project VAT changed before this invoice command could be sent',
  'a witness that disagrees with the project still raises');
select lives_ok($$insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state, payload)
  values ('04050000-0000-0000-0000-000000000001', 'revenue', '04050000-0000-0000-0000-0000000000c1', '0405-live-4', 'erpnext', 'create', 'confirmed',
          jsonb_build_object('erp_doc_kind', 'sales-invoice', 'projectId', '04050000-0000-0000-0000-0000000000b1'))$$,
  'a confirmed command stays out of the guard''s scope');

-- ── project lock and editability semantics unchanged ────────────────────────────────────────
select throws_ok($$update public.projects set subject_to_vat = false where id = '04050000-0000-0000-0000-0000000000b1'$$,
  '42501', 'this project VAT setting is locked by its invoice state',
  'the project VAT lock still holds while an invoice is live');
update public.sales_invoices set status = 'Cancelled', erp_docstatus = 2
  where id = '04050000-0000-0000-0000-0000000000c1';
select is(public.project_invoice_vat_lock_reason('04050000-0000-0000-0000-000000000001', '04050000-0000-0000-0000-0000000000b1'),
  'vat-command-pending', 'after cancellation the mixed-case record id alone still locks the project');
update public.external_command_outbox set state = 'confirmed' where org_id = '04050000-0000-0000-0000-000000000001' and state = 'pending';
select is(public.project_invoice_vat_lock_reason('04050000-0000-0000-0000-000000000001', '04050000-0000-0000-0000-0000000000b1'),
  null, 'once every blocker settles the project unlocks');
select lives_ok($$update public.projects set subject_to_vat = false where id = '04050000-0000-0000-0000-0000000000b1'$$,
  'the VAT flag can change once invoices are cancelled and commands settled');

set local role authenticated;
set local request.jwt.claims = '{"sub":"04050000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is(public.get_project_vat_editability('04050000-0000-0000-0000-0000000000b1'),
  '{"eligible": true, "reason": null, "hasInvoices": true}'::jsonb,
  'the editability RPC reports the settled project as eligible');
reset role;

select * from finish();
rollback;
