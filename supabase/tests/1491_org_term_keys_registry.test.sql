-- 1491_org_term_keys_registry.test.sql — the overridable term keys are a seeded table with a foreign key
-- (#2744, architecture pass C1).
-- AC-TX-002: the 16 accepted terms are rows in org_term_keys; an unknown key is refused at the constraint
--   layer (23503) exactly as it used to be by the CHECK (23514); a term added by one insert is accepted with no
--   DDL; the key table is code-owned and unreadable by clients; and a key an override uses cannot be deleted.
-- Mutation notes (each must turn a named assertion red):
--   · drop a key from the 1491 seed → the count and the 16-key write go red (1/2);
--   · drop the foreign key and restore no CHECK → the unknown-key refusal goes red (3);
--   · change the FK to on delete cascade → the in-use delete goes red (7);
--   · grant select on org_term_keys to authenticated → the client-read refusal goes red (6).
-- Migration under test: 1491_org_term_keys_registry.sql.
begin;
create extension if not exists pgtap;
select plan(9);

insert into organizations (id, name) values
  ('14910000-0000-0000-0000-000000000001', 'OTK Org A');
insert into auth.users (id, email) values
  ('14910000-0000-0000-0000-0000000000a1', 'otk-a-admin@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('14910000-0000-0000-0000-0000000000a1', '14910000-0000-0000-0000-000000000001', 'OTK A Admin', 'otk-a-admin@example.com', 'Admin', 'active');

-- ── the seed is the accepted set ─────────────────────────────────────────────────────────────────
select is((select count(*)::int from public.org_term_keys where term_key = any(array['workOrder','project','clientSuppliedStock','purchaseRequest','discipline','materialRequest','billOfQuantities','contractItem','dailyRevenue','acceptedQuantity','costVariation','deliveryNote','stockCount','imprest','standIn','progressClaim'])), 16,
  'AC-TX-002 the key table carries the 16 original nameable terms (1903 adds more)');
select is(
  (select string_agg(term_key, ',' order by term_key) from public.org_term_keys where term_key = any(array['workOrder','project','clientSuppliedStock','purchaseRequest','discipline','materialRequest','billOfQuantities','contractItem','dailyRevenue','acceptedQuantity','costVariation','deliveryNote','stockCount','imprest','standIn','progressClaim'])),
  'acceptedQuantity,billOfQuantities,clientSuppliedStock,contractItem,costVariation,dailyRevenue,deliveryNote,discipline,imprest,materialRequest,progressClaim,project,purchaseRequest,standIn,stockCount,workOrder',
  'AC-TX-002 and they are the same 16 the CHECK accepted (offenders are named by the diff)');
select is(
  (select string_agg(conname || ':' || contype::text || ':' || confrelid::regclass::text, ',' order by conname)
     from pg_constraint
    where conrelid = 'public.org_terminology'::regclass and contype in ('c', 'f') and conname like '%term_key%'),
  'org_terminology_term_key_fkey:f:org_term_keys',
  'AC-TX-002 term_key is a foreign key to the key table, and the inline CHECK is gone');

set local role authenticated;
set local request.jwt.claims = '{"sub":"14910000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select lives_ok($$
  insert into org_terminology (term_key, locale, singular, plural)
  select k, 'en', 'X ' || k, 'Xs ' || k from unnest(array[
    'workOrder','project','clientSuppliedStock','purchaseRequest','discipline','materialRequest',
    'billOfQuantities','contractItem','dailyRevenue','acceptedQuantity','costVariation','deliveryNote',
    'stockCount','imprest','standIn','progressClaim']) as k
$$, 'AC-TX-002 an Admin writes every one of the 16 keys');
select throws_ok($$insert into org_terminology (term_key, locale, singular, plural) values ('progressAssessment','en','X','Xs')$$,
  '23503', null, 'AC-TX-002 a key outside the table is refused at the constraint layer, as before');
select throws_ok($$select * from public.org_term_keys$$,
  '42501', null, 'AC-TX-002 the key table is code-owned: a client cannot read it');

reset role;
set local request.jwt.claims = '';

-- ── a key in use cannot be deleted, and a new key needs one insert, never DDL ─────────────────────
select throws_ok($$delete from public.org_term_keys where term_key = 'project'$$,
  '23503', null, 'AC-TX-002 a key an override uses cannot be deleted (no orphan override)');

savepoint plant;
insert into public.org_term_keys (term_key) values ('progressAssessment');
set local role authenticated;
set local request.jwt.claims = '{"sub":"14910000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok($$insert into org_terminology (term_key, locale, singular, plural) values ('progressAssessment','en','Assessment','Assessments')$$,
  'AC-TX-002 a term added by one insert is accepted with no constraint change');
reset role;
set local request.jwt.claims = '';
rollback to savepoint plant;

select is((select count(*)::int from public.org_term_keys where term_key = 'progressAssessment'), 0,
  'AC-TX-002 (control) the planted key is gone after the rollback');

select * from finish();
rollback;
