-- rollback/1232_built_in_role_trigger_order_down.sql
alter trigger profiles_zz_built_in_role_sync on public.profiles rename to profiles_built_in_role_sync;
