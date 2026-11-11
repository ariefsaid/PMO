drop trigger if exists require_timesheet_rejection_reason_trigger on public.timesheets;
drop trigger if exists require_expense_rejection_reason_trigger on public.expense_claims;
drop trigger if exists require_imprest_rejection_reason_trigger on public.imprest_replenishments;
drop trigger if exists require_equipment_rejection_reason_trigger on public.equipment_usage_entries;
drop function if exists public.require_timesheet_rejection_reason();
drop function if exists public.require_expense_rejection_reason();
drop function if exists public.require_imprest_rejection_reason();
drop function if exists public.require_equipment_rejection_reason();
