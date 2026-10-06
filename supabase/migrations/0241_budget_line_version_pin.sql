-- 0241_budget_line_version_pin.sql — a budget line belongs to one version for life (FR-BV-011).
--
-- The draft guard (0005) resolved ONE version per row: the new one on insert/update, the old one on delete.
-- Moving a line between versions changes the contents of both, so the guard now also requires the line's
-- current version to be Draft on update, and the version id becomes immutable. Nothing in the app moves a
-- line between versions: clone_budget_version and the importers insert fresh rows.
--
-- Rollback: re-create 0005's enforce_draft_line_item() body (single coalesce(new, old) version check).

create or replace function public.enforce_draft_line_item()
  returns trigger language plpgsql set search_path = public as $$
declare v_status public.budget_status;
begin
  if tg_op = 'UPDATE' and new.budget_version_id is distinct from old.budget_version_id then
    raise exception 'a budget line cannot move to another version' using errcode = 'P0001';
  end if;
  select status into v_status from public.budget_versions
    where id = case when tg_op = 'DELETE' then old.budget_version_id else new.budget_version_id end;
  if v_status <> 'Draft' then
    raise exception 'line-items can only change while the owning version is Draft' using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end; $$;
