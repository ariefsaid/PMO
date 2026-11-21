-- 1232_built_in_role_trigger_order.sql — #2709 follow-up (the 0215 class, #632).
-- profiles_built_in_role_sync (1202) is a BEFORE INSERT trigger that reads NEW.org_id
-- (org_built_in_roles_enabled(new.org_id)). BEFORE triggers fire in name order and its name sorts before
-- `profiles_stamp_org_id`, so it ran before the org stamp. Rename it into the `zz_` slot (the 0215/0187
-- convention) so it sorts after the stamp. Same timing, events and function; only the name changes.
-- Reversibility: rollback/1232_built_in_role_trigger_order_down.sql renames it back.

alter trigger profiles_built_in_role_sync on public.profiles rename to profiles_zz_built_in_role_sync;
