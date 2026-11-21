-- 1352_extend_rental_procurement_down.sql — reverses 1352 (#2697). Purchases it created stay; they are ordinary purchases.
drop function if exists public.extend_rental_procurement(uuid, uuid, date, date, jsonb);
