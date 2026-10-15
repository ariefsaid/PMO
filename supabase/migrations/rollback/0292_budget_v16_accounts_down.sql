begin;
select public.bv16_migration_0292_revert();
drop function public.bv16_migration_0292_revert();
commit;
