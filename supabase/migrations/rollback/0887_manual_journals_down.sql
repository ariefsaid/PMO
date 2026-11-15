-- Rollback for 0887_manual_journals.sql (#895). Drops the RPCs, the policies, the three tables and the two types, in
-- that order, and nothing else. Refuses while any journal exists: a posted journal is a ledger fact PMO must keep.
-- The `desk_journal_id` keys an Admin saved into external_org_bindings.config are left in place (inert without 0887).
begin;
do $$ begin
  if exists (select 1 from public.journal_entries) then
    raise exception 'manual journals rollback refused: journals exist' using errcode = 'P0001';
  end if;
end $$;
drop function if exists public.list_journals(date, date);
drop function if exists public.record_journal_outcome(uuid, public.journal_status, text, text, date, text);
drop function if exists public.approved_journal_for_push(uuid);
drop function if exists public.journal_ledger_setup();
drop function if exists public.set_desk_journal(text);
drop function if exists public.request_journal_reversal(uuid, date, text);
drop function if exists public.return_journal(uuid, text);
drop function if exists public.approve_journal(uuid);
drop function if exists public.submit_journal(uuid);
drop function if exists public.save_journal_draft(uuid, public.journal_kind, date, text, jsonb);
drop function if exists public.may_approve_journal(uuid);
drop function if exists public.journal_approver_allows(uuid, uuid);
drop function if exists public.journal_org_sole_member(uuid, uuid);
drop function if exists public.assert_journal_desk_member();
drop policy if exists journal_entry_authors_select on public.journal_entry_authors;
drop policy if exists journal_entry_lines_select on public.journal_entry_lines;
drop policy if exists journal_entries_select on public.journal_entries;
drop table if exists public.journal_entry_authors;
drop table if exists public.journal_entry_lines;
drop table if exists public.journal_entries;
drop type if exists public.journal_kind;
drop type if exists public.journal_status;
commit;
