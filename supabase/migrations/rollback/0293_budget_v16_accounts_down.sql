begin;
select public.bv16_migration_0293_revert();
drop function public.bv16_migration_0293_revert();
commit;
