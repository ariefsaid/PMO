-- #2259: the down for 0896 restores undo_captured_purchase to the exact 0882 body, with the same owner, properties and grants.
-- The script substitutes the 0882 definition (under a proof alias) and the down file. One transaction; nothing is left behind.
begin;
select plan(4);
-- @REF@
select isnt((select pg_get_functiondef('public.undo_captured_purchase(uuid,text,boolean)'::regprocedure)),
            (select replace(pg_get_functiondef('public.p0_proof_undo_ref(uuid,text,boolean)'::regprocedure),'p0_proof_undo_ref','undo_captured_purchase')),
            'AC-ROP-009 at head the undo body differs from 0882 (it carries the ordered kind read)');
select lives_ok($down$
@DOWN@
$down$,'AC-ROP-009 the down runs');
select is((select pg_get_functiondef('public.undo_captured_purchase(uuid,text,boolean)'::regprocedure)),
          (select replace(pg_get_functiondef('public.p0_proof_undo_ref(uuid,text,boolean)'::regprocedure),'p0_proof_undo_ref','undo_captured_purchase')),
          'AC-ROP-009 the down restores the 0882 body verbatim');
select ok((select (a.proowner,a.proconfig,a.prosecdef,a.provolatile,a.proparallel,a.prorettype,a.proargtypes,a.pronargdefaults,a.proacl) is not distinct from
                  (b.proowner,b.proconfig,b.prosecdef,b.provolatile,b.proparallel,b.prorettype,b.proargtypes,b.pronargdefaults,b.proacl)
             from pg_proc a, pg_proc b where a.oid='public.undo_captured_purchase(uuid,text,boolean)'::regprocedure and b.oid='public.p0_proof_undo_ref(uuid,text,boolean)'::regprocedure),
          'AC-ROP-009 owner, properties and grants match the 0882 definition');
select * from finish();
rollback;
