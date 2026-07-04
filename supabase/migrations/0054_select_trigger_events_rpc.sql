-- 0054_select_trigger_events_rpc.sql — SEC-HIGH-2: org-correct trigger-event selection RPC.
--
-- WHY: the agent-dispatch edge fn's dispatcher.selectTriggerMatches read procurement_status_events
-- directly under the service_role client (RLS-bypassing) and filtered org in JS. That violates the
-- "service_role never reads tenant business data" invariant (ADR-0036 §2, NFR-AAN-SEC-002): the raw
-- table (all orgs, every column of the projection) crossed the trust boundary into the edge fn, with
-- only a JS gate standing between it and a cross-org leak. The earlier RED-3 fix added that JS gate;
-- THIS is the architectural belt — move the selection into a SECURITY DEFINER RPC that returns ONLY
-- org-correct, status-matching events, so no cross-org row is ever materialised in the edge fn at all.
--
-- CONTRACT: select_trigger_events(p_source, p_last_seen_at, p_last_seen_id, p_filters) returns the
-- MINIMAL projection (id, created_at, to_status, org_id) of events for `p_source` that:
--   (1) come from an ALLOWLISTED source table (only procurement_status_events today; a non-allowlisted
--       source returns zero rows — no dynamic table access, the query is statically bound per source);
--   (2) match one of the caller-supplied p_filters pairs on BOTH org_id AND to_status — this is the
--       cross-org tenancy authority: an automation's filter carries its own org, so a cross-org event
--       can never satisfy any filter (SEC-HIGH-2, gpt-5.5 audit #1);
--   (3) are strictly AFTER the compound (created_at, id) watermark cursor (or all rows if the cursor is
--       null) — the same monotonic poll-since-watermark semantics dispatcher.ts had in JS, now in SQL
--       (gpt-5.5 audit #5). Ordered by (created_at, id) so the caller's max-attempted tracking is stable.
--
-- p_filters shape: jsonb array of {"org_id": <uuid text>, "event": <procurement_status text>}.
--
-- SECURITY: SECURITY DEFINER (bypasses RLS so a service_role-invoked call sees all orgs' events) but the
-- (org_id, to_status) filter join is the wall — only the caller's requested (org, status) pairs are ever
-- returned. search_path pinned. Granted to service_role only (the dispatcher's identity); NOT to
-- authenticated/anon — this is an internal dispatcher primitive, not a user-facing surface. pgTAP: 0104.
--
-- Reversibility (pre-production, ADR-0006): `supabase db reset`. Manual rollback:
--   drop function if exists select_trigger_events(text, timestamptz, uuid, jsonb);

create or replace function select_trigger_events(
  p_source        text,
  p_last_seen_at  timestamptz,
  p_last_seen_id  uuid,
  p_filters       jsonb
)
  returns table (id uuid, created_at timestamptz, to_status text, org_id uuid)
  language plpgsql
  stable
  security definer
  set search_path = public
as $$
begin
  -- (1) Allowlist gate — statically bound per source. Only procurement_status_events is a trigger
  -- source today; any other source returns zero rows (no dynamic SQL, no arbitrary table access).
  if p_source = 'procurement_status_events' then
    return query
      select e.id, e.created_at, e.to_status::text, e.org_id
      from procurement_status_events e
      -- (2) org+status filter join: an event is returned iff SOME requested filter pair matches its
      -- (org_id, to_status). Cross-org events satisfy no filter → never returned.
      join lateral (
        select 1
        from jsonb_array_elements(coalesce(p_filters, '[]'::jsonb)) f
        where (f->>'org_id')::uuid = e.org_id
          and (f->>'event')        = e.to_status::text
        limit 1
      ) matched on true
      -- (3) compound (created_at, id) cursor — strictly after the watermark, or all rows if null.
      where p_last_seen_at is null
         or e.created_at > p_last_seen_at
         or (e.created_at = p_last_seen_at and e.id > p_last_seen_id)
      order by e.created_at, e.id;
  end if;
  -- Non-allowlisted source: fall through, returning no rows.
  return;
end;
$$;

revoke all     on function select_trigger_events(text, timestamptz, uuid, jsonb) from public;
revoke execute on function select_trigger_events(text, timestamptz, uuid, jsonb) from authenticated, anon;
grant  execute on function select_trigger_events(text, timestamptz, uuid, jsonb) to   service_role;
