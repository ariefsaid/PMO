-- 1223_email_settings_rpcs.sql — #2711: the only write paths for the email settings.
-- Admin sets events/extra roles/language for their own org; any active member sets their own opt-out.
-- Reverse: rollback/1223_email_settings_rpcs_down.sql

create function public.set_email_event_setting(p_event text, p_enabled boolean, p_extra_roles text[] default '{}') returns void
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.assert_is_active_member();
  if public.auth_role() <> 'Admin' then raise exception 'admin only' using errcode = '42501'; end if;
  if p_event not in ('approval_request','billing_step','overdue_item','document_expiry') then
    raise exception 'unknown email event' using errcode = '22023';
  end if;
  if p_enabled is null or cardinality(coalesce(p_extra_roles, '{}')) > 30 then raise exception 'invalid setting' using errcode = '22023'; end if;
  insert into public.email_event_settings (org_id, event_key, enabled, extra_roles)
    values (public.auth_org_id(), p_event, p_enabled,
            coalesce((select array_agg(distinct btrim(r)) from unnest(p_extra_roles) r where btrim(r) <> ''), '{}'))
    on conflict (org_id, event_key) do update set enabled = excluded.enabled, extra_roles = excluded.extra_roles, updated_at = now();
end $$;
revoke all on function public.set_email_event_setting(text, boolean, text[]) from public, anon;
grant execute on function public.set_email_event_setting(text, boolean, text[]) to authenticated;

create function public.set_email_locale(p_locale text) returns void
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.assert_is_active_member();
  if public.auth_role() <> 'Admin' then raise exception 'admin only' using errcode = '42501'; end if;
  if p_locale not in ('en','id') then raise exception 'unknown language' using errcode = '22023'; end if;
  insert into public.email_org_settings (org_id, locale) values (public.auth_org_id(), p_locale)
    on conflict (org_id) do update set locale = excluded.locale, updated_at = now();
end $$;
revoke all on function public.set_email_locale(text) from public, anon;
grant execute on function public.set_email_locale(text) to authenticated;

create function public.set_my_email_opt_out(p_opted_out boolean) returns void
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.assert_is_active_member();
  if p_opted_out is null then raise exception 'invalid setting' using errcode = '22023'; end if;
  insert into public.email_user_prefs (user_id, org_id, opted_out) values (auth.uid(), public.auth_org_id(), p_opted_out)
    on conflict (user_id) do update set opted_out = excluded.opted_out, updated_at = now();
end $$;
revoke all on function public.set_my_email_opt_out(boolean) from public, anon;
grant execute on function public.set_my_email_opt_out(boolean) to authenticated;
