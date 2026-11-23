-- reverse 1651: no client grant again (the body keeps the field-account guard, which only refuses a field account)
revoke all on function public.end_equipment_rental_term(uuid, date) from public, anon, authenticated;
