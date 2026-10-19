-- 0324 rollback: remove only the additive reviewed project-link confirmation RPC.
drop function if exists public.confirm_erp_project_link(uuid,uuid,uuid,text,jsonb,text,text);
