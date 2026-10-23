-- Rollback of 0370_cli_ops_writes.sql. Links already written stay: they are ordinary evidence rows.
drop function if exists public.link_budget_version_sharepoint_item(uuid, jsonb);
