-- 0105_clickup_adopt_external_org_bindings.sql
-- ClickUp adopts external_org_bindings (Phase 2, task 2.3)
-- Backfills external_org_bindings for orgs that have ClickUp ownership via external_domain_ownership
-- Creates Vault secrets for each org using the global CLICKUP_API_TOKEN GUC (when set)
-- CI-SAFE: guards current_setting('app.settings.clickup_api_token', true) with missing_ok=true
-- REVISED: Only creates binding + secret when GUC is set (no active binding without secret).
-- Reversibility: supabase db reset. Manual reverse (functions before tables, reverse order):
--   delete from public.external_org_bindings where external_tier = 'clickup' and secret_ref like 'global_clickup_token_%';
--   delete from vault.decrypted_secrets where name like 'global_clickup_token_%';

do $$
  declare
    v_rec record;
    v_global_token text;
    v_has_created_by boolean;
  begin
    -- Read the global ClickUp token from GUC (missing_ok=true → returns NULL if not set)
    -- This is CI-SAFE: on a bare `supabase db reset` the GUC is unset, so we skip Vault creation
    -- AND skip binding creation (no active binding without a secret).
    v_global_token := current_setting('app.settings.clickup_api_token', true);

    -- Check if external_domain_ownership has a created_by column
    select exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'external_domain_ownership' and column_name = 'created_by'
    ) into v_has_created_by;

    for v_rec in
      select o.org_id, o.created_at as connected_at,
             case when v_has_created_by then o.created_by end as connected_by
      from public.external_domain_ownership o
      where o.external_tier = 'clickup' and o.domain = 'tasks'
    loop
      -- Only create binding + Vault secret when the global token is available
      -- (no active binding without a secret; CI/local stay clean)
      if v_global_token is not null and v_global_token <> '' then
        insert into public.external_org_bindings (org_id, external_tier, site_url, secret_ref, status, connected_by, connected_at)
        values (v_rec.org_id, 'clickup', 'https://api.clickup.com', 'global_clickup_token_' || v_rec.org_id, 'active',
                coalesce(v_rec.connected_by, v_rec.org_id), v_rec.connected_at)
        on conflict (org_id, external_tier) do nothing;

        perform vault.create_secret(v_global_token, 'global_clickup_token_' || v_rec.org_id);
      end if;
    end loop;
  end $$;