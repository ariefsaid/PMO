-- reverse of 1373 (#2702)
drop function if exists public.clear_equipment_vendor_response(uuid, date);
drop function if exists public.record_equipment_vendor_response(uuid, date, timestamptz, timestamptz, text);
drop function if exists public.equipment_vendor_on(uuid, uuid, date);
