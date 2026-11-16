-- Reverses 0910_erp_company_defaults.sql: the request and result functions, the request rows and the cost-centre mirror.
-- Defaults already recorded on a binding stay as they are (they are what the ERP read back).
drop function if exists public.record_company_defaults_result(uuid, uuid, jsonb, text);
drop function if exists public.request_company_defaults(text, jsonb);
drop function if exists public.company_default_target_problem(uuid, text, text, text);
drop function if exists public.replace_erp_cost_centre_mirror(uuid, text, jsonb);
drop table if exists public.erp_company_default_requests;
drop sequence if exists public.erp_company_default_request_seq;
drop table if exists public.erp_cost_centre_mirror;
