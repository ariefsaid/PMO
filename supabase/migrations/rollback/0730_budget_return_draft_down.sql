-- Reverses 0730.
update public.record_history_config
   set captured = captured - 'returned_at' - 'return_reason',
       omit_cols = array_remove(omit_cols, 'returned_by')
 where entity_type = 'budget_version';
drop trigger if exists budget_versions_not_returned on public.budget_versions;
drop function if exists public.assert_budget_version_not_returned();
drop function if exists public.resubmit_budget_version(uuid);
drop function if exists public.return_budget_version(uuid, text);
alter table public.budget_versions
  drop constraint if exists budget_versions_returned_all_or_none,
  drop column if exists return_reason,
  drop column if exists returned_by,
  drop column if exists returned_at;
