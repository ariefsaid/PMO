-- Reverses 0480_erp_connect_setup.sql: the trigger and the seventeen functions, then the four tables (staged and proposals reference runs).
-- Data loss is limited to setup state (runs, census, proposals); no PMO record is changed. Links already applied
-- (external_refs, project_map / item_map, the account map, confirmed employees) stay.
drop trigger if exists erp_connect_purge_on_disconnect on public.external_org_bindings;
drop function if exists public.purge_connect_setup_on_disconnect();
drop function if exists public.unlink_connect_match(uuid);
drop function if exists public.decide_connect_review(uuid, jsonb);
drop function if exists public.accept_connect_proposals(text, text, uuid[], int);
drop function if exists public.apply_connect_outcome(uuid, text, text, text, text, text, jsonb);
drop function if exists public.apply_connect_bring_in(uuid, text, text, text, jsonb);
drop function if exists public.apply_connect_link(uuid, text, text, text, text, jsonb, uuid);
drop function if exists public.connect_link_project(uuid, text, text, text);
drop function if exists public.connect_map_link_check(uuid, text, text, text, text, jsonb, jsonb);
drop function if exists public.connect_config_map_link(uuid, text, text, text, text, boolean);
drop function if exists public.settle_connect_run(uuid, text);
drop function if exists public.fail_connect_run(uuid, uuid, text, boolean);
drop function if exists public.record_connect_review(uuid, text, text, text[], text[], text, text);
drop function if exists public.replace_connect_proposals(uuid, text, uuid, text, jsonb, boolean);
drop function if exists public.stage_connect_master_page(uuid, uuid, text, jsonb, text);
drop function if exists public.write_connect_census(uuid, text, jsonb);
drop function if exists public.start_connect_run(uuid, text, uuid);
drop function if exists public.connect_link_in_use(uuid, text, text);
drop table if exists public.erp_connect_proposals;
drop table if exists public.erp_connect_census;
drop table if exists public.erp_connect_staged;
drop table if exists public.erp_connect_runs;
