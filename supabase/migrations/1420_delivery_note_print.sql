-- 1420_delivery_note_print.sql — #2687 printable delivery note settings & terminology
-- Spec docs/specs/delivery-note-print.spec.md · plan docs/plans/2026-11-21-delivery-note-print.md.
--
-- Adds:
--   1. delivery_note_enabled & delivery_note_signature_blocks on material_request_settings
--   2. mrq_set_delivery_note_settings security-definer RPC (Admin only)
--   3. Adds 'deliveryNote' to org_terminology term_key check constraint
--
-- Reversal: supabase/migrations/rollback/1420_delivery_note_print_down.sql

-- 1. Extend org_terminology to accept deliveryNote
alter table public.org_terminology drop constraint if exists org_terminology_term_key_check;
alter table public.org_terminology add constraint org_terminology_term_key_check
  check (term_key in ('workOrder','project','clientSuppliedStock','purchaseRequest','discipline','materialRequest','deliveryNote'));

-- 2. Extend material_request_settings with delivery note settings
alter table public.material_request_settings
  add column if not exists delivery_note_enabled boolean not null default false,
  add column if not exists delivery_note_signature_blocks text[] not null default array['Dispatched by', 'Delivered by', 'Received by'];

-- 3. Security-definer RPC for Admin to update delivery note settings
create or replace function public.mrq_set_delivery_note_settings(
  p_enabled boolean,
  p_signature_blocks text[]
) returns void
  language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_org uuid;
  v_uid uuid := auth.uid();
  v_blocks text[];
begin
  perform public.assert_is_active_member();
  v_org := public.auth_org_id();
  if public.auth_role() is distinct from 'Admin' then
    raise exception 'MRQ_ADMIN_ONLY: only an Admin can change delivery note settings' using errcode = '42501';
  end if;

  if p_signature_blocks is null or cardinality(p_signature_blocks) = 0 then
    v_blocks := array['Dispatched by', 'Delivered by', 'Received by'];
  else
    v_blocks := p_signature_blocks;
  end if;

  insert into public.material_request_settings (
    org_id, delivery_note_enabled, delivery_note_signature_blocks, updated_by, updated_at
  )
  values (v_org, coalesce(p_enabled, false), v_blocks, v_uid, now())
  on conflict (org_id) do update set
    delivery_note_enabled = excluded.delivery_note_enabled,
    delivery_note_signature_blocks = excluded.delivery_note_signature_blocks,
    updated_by = excluded.updated_by,
    updated_at = now();

  perform public.log_audit(
    'material_request.delivery_note_settings_set',
    v_org,
    v_uid,
    null,
    jsonb_build_object('enabled', coalesce(p_enabled, false), 'signature_blocks', to_jsonb(v_blocks))
  );
end $$;

revoke all on function public.mrq_set_delivery_note_settings(boolean, text[]) from public, anon, authenticated;
grant execute on function public.mrq_set_delivery_note_settings(boolean, text[]) to authenticated;
