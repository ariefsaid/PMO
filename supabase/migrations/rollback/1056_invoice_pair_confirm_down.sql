-- Remove the reviewed-confirmation RPC; the existing unpair RPC remains available.
drop function public.compare_and_unpair_invoice(uuid, uuid, timestamptz, integer, timestamptz);
