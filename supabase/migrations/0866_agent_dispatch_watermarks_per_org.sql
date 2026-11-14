-- 0866_agent_dispatch_watermarks_per_org.sql — one dispatch cursor per (event source, organization).
--
-- WHY: the agent-dispatch poll cursor was one row per event source (ADR-0046). With several
-- organizations on one hosted project (ADR-0101), each organization now keeps its OWN cursor for a
-- source, so:
--   • an organization whose assistant feature is briefly unreadable keeps its place in the event
--     log and resumes exactly there once it is readable again (its events are never walked over by
--     another organization's progress — the promise the dispatcher's entitlement gate already
--     makes, now backed by the data shape);
--   • the dispatcher's per-tick event budget is shared fairly across organizations (the split lives
--     in supabase/functions/agent-dispatch/dispatcher.ts; this migration carries the per-org rows).
--
-- SHAPE: agent_dispatch_watermarks (source, org_id) primary key; org_id references
-- organizations(id) on delete cascade — an organization's cursors are its bookkeeping and go with
-- it. Grants and RLS are untouched: RLS enabled + forced with no policy (service_role only, as
-- since 0048/0105/0194), anon/authenticated keep exactly the SELECT-level grant set they hold
-- today with no write verbs.
--
-- BACKFILL: every organization inherits the source's current cursor, then the source-only row is
-- removed — no row keeps a null organization, and no organization starts behind or ahead of where
-- the shared cursor stood (the dispatcher's fire-claim table keeps re-reads at-most-once).
--
-- Reversibility: rollback/0866_agent_dispatch_watermarks_per_org_down.sql collapses to one row per
-- source at the earliest organization cursor, so no event is passed over.

alter table agent_dispatch_watermarks
  add column org_id uuid references organizations(id) on delete cascade;

-- Backfill: one row per (source, organization) carrying the cursor the source had.
insert into agent_dispatch_watermarks (source, org_id, last_seen_id, last_seen_at, updated_at)
select w.source, o.id, w.last_seen_id, w.last_seen_at, w.updated_at
from agent_dispatch_watermarks w
cross join organizations o;

-- Remove the source-only row: every surviving row names its organization.
delete from agent_dispatch_watermarks where org_id is null;

alter table agent_dispatch_watermarks
  alter column org_id set not null,
  drop constraint agent_dispatch_watermarks_pkey,
  add primary key (source, org_id);
