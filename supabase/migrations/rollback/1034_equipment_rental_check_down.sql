-- 1034_equipment_rental_check_down.sql — reverse of 1034 (#2526). Loses the stored include-unproven reasons.
drop function if exists public.equipment_rental_check(uuid, date, date, numeric, text);
drop function if exists public.equipment_rental_day_rates(uuid, uuid, date, date);
drop table if exists public.equipment_rental_checks;
