-- 1136_subcontract_certificates_down.sql — refused while a certificate or backcharge exists (NFR-SPC-005).
do $$ begin
  if exists (select 1 from public.subcontract_certificates) or exists (select 1 from public.subcontract_backcharges)
  then raise exception 'rollback refused: certificates or backcharges exist — export and remove them first'; end if;
end $$;
drop function if exists public.set_certificate_backcharge(uuid, uuid, boolean);
drop function if exists public.archive_subcontract_backcharge(uuid);
drop function if exists public.record_subcontract_backcharge(uuid, uuid, uuid, numeric, text, text, text, uuid);
drop function if exists public.set_certificate_deselection(uuid, date, uuid, uuid, boolean, text);
drop function if exists public.prepare_subcontract_certificate(uuid, date);
drop function if exists public.subcontract_certificate_view(uuid);
drop function if exists public.spc_derive(uuid);
drop table if exists public.subcontract_certificate_backcharges;
drop table if exists public.subcontract_backcharges;
drop table if exists public.subcontract_certificate_deselections;
drop table if exists public.subcontract_certificate_claims;
drop table if exists public.subcontract_certificate_lines;
drop table if exists public.subcontract_certificates;
drop function if exists public.spc_may_read(uuid);
drop function if exists public.spc_may_prepare(uuid);
drop function if exists public.guard_spc_backcharge();
drop function if exists public.guard_spc_certificate();
drop function if exists public.guard_spc_child();
