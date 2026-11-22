-- 1561 down.
drop trigger if exists equipment_plans_notify_requester on public.equipment_plans;
drop trigger if exists subcontract_certificates_notify_requester on public.subcontract_certificates;
drop trigger if exists daily_site_reports_notify_requester on public.daily_site_reports;
drop trigger if exists material_requests_notify_requester_approved on public.material_requests;
drop trigger if exists material_request_steps_notify_requester on public.material_request_steps;
drop function if exists public.notify_requester_equipment_plan();
drop function if exists public.notify_requester_certificate_returned();
drop function if exists public.notify_requester_dsr_returned();
drop function if exists public.notify_requester_mrq_approved();
drop function if exists public.notify_requester_mrq_step();
