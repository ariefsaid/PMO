-- 0105_clickup_adopt_external_org_bindings.sql
-- ClickUp adopts external_org_bindings (Phase 2, task 2.3)
-- Backfills external_org_bindings for orgs that have ClickUp ownership via external_domain_ownership
-- Creates Vault secrets for each org using the global CLICKUP_API_TOKEN GUC (when set)
-- CI-SAFE: guards current_setting('app.settings.clickup_api_token', true) with missing_ok=true
-- Reversibility: supabase db reset. Manual reverse (functions before tables, reverse order):
--   delete from public.external_org_bindings where external_tier = 'clickup' and secret_ref like 'global_clickup_token_%';
--   delete from vault.decrypted_secrets where name like 'global_clickup_token_%';

do $$
declare
  v_rec record;
  v_global_token text;
begin
  -- Read the global ClickUp token from GUC (missing_ok=true → returns NULL if not set)
  -- This is CI-SAFE: on a bare `supabase db reset` the GUC is unset, so we skip Vault creation
  -- but still create the binding row with the expected secret_ref name.
  v_global_token := current_setting('app.settings.clickup_api_token', true);

  for v_rec in
    select o.org_id, o.created_at as connected_at
    from public.external_domain_ownership o
    where o.external_tier = 'clickup' and o.domain = 'tasks'
  loop
    -- Insert binding row (idempotent via ON CONFLICT DO NOTHING on unique (org_id, external_tier))
    insert into public.external_org_bindings (org_id, external_tier, site_url, secret_ref, status, connected_by, connected_at)
    values (v_rec.org_id, 'clickup', 'https://api.clickup.com', 'global_clickup_token_' || v_rec.org_id, 'active', v_rec.org_id, v_rec.connected_at)
    on conflict (org_id, external_tier) do nothing;

    -- Create Vault secret only when the global token is available (not CI, not local without token)
    -- The secret_ref matches what we set above: 'global_clickup_token_<org_id>'
    if v_global_token is not null and v_global_token <> '' then
      perform vault.create_secret(v_global_token, 'global_clickup_token_' || v_rec.org_id);
    end if;
  end loop;
end $$;