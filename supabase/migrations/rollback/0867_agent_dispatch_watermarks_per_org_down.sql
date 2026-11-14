-- 0867 rollback — collapse the per-organization dispatch cursors back to one row per source.
--
-- The merged cursor is the EARLIEST one among the source's organizations (by created_at, then id),
-- so the next tick re-selects every event any organization had not read yet — nothing is passed
-- over (the agent_automation_fires claim table keeps those re-reads at-most-once). Collapsing to
-- the latest cursor instead would skip events a behind-organization never saw.
--
-- Statement order matters: the collapsed row has no organization, so the org_id foreign key, the
-- (source, org_id) primary key and the NOT NULL constraint must all be released BEFORE the collapse
-- inserts it. The whole per-organization teardown is guarded on the column still existing, so the
-- script can be run again (a partial or repeated rollback) without error.
--
-- Restores the ADR-0046 shape: agent_dispatch_watermarks (source) primary key, no org_id column,
-- no foreign key. Grants and RLS are untouched.

do $$ begin
  -- Already collapsed (the organization column is gone): nothing left to reverse.
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'agent_dispatch_watermarks'
      and column_name = 'org_id'
  ) then
    return;
  end if;

  alter table agent_dispatch_watermarks
    drop constraint if exists agent_dispatch_watermarks_org_id_fkey;

  alter table agent_dispatch_watermarks
    drop constraint agent_dispatch_watermarks_pkey,
    alter column org_id drop not null;

  insert into agent_dispatch_watermarks (source, last_seen_id, last_seen_at, updated_at)
  select distinct on (source) source, last_seen_id, last_seen_at, updated_at
  from agent_dispatch_watermarks
  order by source, last_seen_at asc nulls first, last_seen_id asc nulls first;

  delete from agent_dispatch_watermarks where org_id is not null;

  alter table agent_dispatch_watermarks add primary key (source);

  alter table agent_dispatch_watermarks drop column org_id;
end $$;
