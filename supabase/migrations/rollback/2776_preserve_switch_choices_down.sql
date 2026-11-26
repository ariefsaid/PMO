CREATE OR REPLACE FUNCTION public.apply_org_switch_defaults(p_org uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog', 'pg_temp'
AS $function$
begin
  insert into public.idle_cost_settings (org_id, enabled) values (p_org, true)
    on conflict (org_id) do update set enabled = true;
  insert into public.org_revenue_plan_settings (org_id, enabled) values (p_org, true)
    on conflict (org_id) do update set enabled = true;
  insert into public.org_purchase_type_settings (org_id, enabled) values (p_org, true)
    on conflict (org_id) do update set enabled = true;
  insert into public.org_payment_channel_settings (org_id, enabled, enabled_at) values (p_org, true, now())
    on conflict (org_id) do update set enabled = true, enabled_at = coalesce(org_payment_channel_settings.enabled_at, now());
  insert into public.issue_closing_report_settings (org_id, enabled) values (p_org, true)
    on conflict (org_id) do update set enabled = true;
  insert into public.purchase_order_settings (org_id, print_enabled) values (p_org, true)
    on conflict (org_id) do update set print_enabled = true;
  insert into public.material_request_settings (org_id, delivery_note_enabled) values (p_org, true)
    on conflict (org_id) do update set delivery_note_enabled = true;
  perform public.seed_purchase_line_categories(p_org);
  perform public.seed_purchase_types(p_org);
  perform public.seed_payment_channels(p_org);
end $function$;
