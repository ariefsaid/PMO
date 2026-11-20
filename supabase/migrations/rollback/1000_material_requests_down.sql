-- Reverses 1000_material_requests.sql (after 1001's rollback). Drops material requests, their steps and history,
-- the approval chain, stand-ins and the cut-off setting. Stock documents created from requests are untouched.
drop table if exists public.material_request_events;
drop table if exists public.material_request_steps;
drop table if exists public.material_request_lines;
drop table if exists public.material_requests;
drop table if exists public.approval_stand_ins;
drop table if exists public.approval_chain_steps;
drop table if exists public.material_request_settings;
drop function if exists public.guard_material_request_events_append_only();
