-- 0194_dead_authenticated_write_grants.sql — #511. Sweep the CLASS that #484 found one instance of:
-- public tables where `authenticated` holds INSERT/UPDATE/DELETE that NO write policy can ever let
-- it use. `organizations` was the instance (revoked in 0192); this file closes the remaining ten.
--
-- ── HOW THE LIST WAS PRODUCED (catalog, not by reading migrations — DoD of #511) ────────────────
-- Run against the local stack at 0192. The query is reproduced verbatim as AC-DWG-011 in
-- supabase/tests/dead_authenticated_write_grants.test.sql, where it is the standing backstop:
--
--   with tbls as (select c.oid, c.relname from pg_class c
--                   join pg_namespace n on n.oid = c.relnamespace
--                  where n.nspname = 'public' and c.relkind = 'r'),
--   priv as (select t.*,
--            has_any_column_privilege('authenticated', t.oid, 'INSERT') as ins,
--            has_any_column_privilege('authenticated', t.oid, 'UPDATE') as upd,
--            has_table_privilege     ('authenticated', t.oid, 'DELETE') as del from tbls t),
--   pol  as (select p.polrelid,
--            bool_or(p.polcmd in ('a','*')) filter (where r.applies) as pol_ins,
--            bool_or(p.polcmd in ('w','*')) filter (where r.applies) as pol_upd,
--            bool_or(p.polcmd in ('d','*')) filter (where r.applies) as pol_del
--              from pg_policy p cross join lateral (select (p.polroles = '{0}'::oid[]
--                or 'authenticated'::regrole::oid = any(p.polroles)) as applies) r
--             group by p.polrelid)
--   select ... from priv p left join pol on pol.polrelid = p.oid
--    where (p.ins and not coalesce(pol.pol_ins,false))
--       or (p.upd and not coalesce(pol.pol_upd,false))
--       or (p.del and not coalesce(pol.pol_del,false));
--
-- ⚑ THREE THINGS THE QUERY GETS RIGHT AND AN OBVIOUS ONE WOULD NOT:
--   • has_any_column_privilege for INSERT/UPDATE — has_table_privilege alone returns FALSE when only
--     COLUMN grants remain (0182/0184 left profiles in exactly that shape), so a table narrowed to a
--     column allow-list would be invisible to the naive oracle. DELETE has no column form.
--   • polroles = '{0}' is the PUBLIC pseudo-role — every policy in this repo is written `to public`,
--     so a test that only matched the literal 'authenticated' would match NOTHING and report every
--     table as policy-less.
--   • polcmd '*' (FOR ALL) counts as a write policy for all three verbs.
-- Verified live before the change: the query returned 20 (table, privilege) pairs across the ten
-- tables below. Mutation-proved: re-granting insert/update/delete on `organizations` inside a
-- rolled-back transaction moved it to 23 and named `organizations` — i.e. the query does detect the
-- very instance #484 fixed, so it is not silently matching nothing.
--
-- ── WHY THESE ARE DEAD, AND WHY DEAD IS STILL WORTH REVOKING ────────────────────────────────────
-- All ten FORCE row security and none has a write policy for the verb being revoked, so every client
-- write already fails — RLS default-deny. But 0105's argument applies verbatim: the privilege check
-- runs BEFORE RLS, so an inert grant is one policy change away from being a live one. Revoking makes
-- the statement unattemptable (42501) instead of merely unsuccessful.
-- Root cause, for all ten: 0075_explicit_api_grants.sql's blanket re-grant (`grant delete, insert,
-- references, select, trigger, truncate ... to authenticated` on every table it knew about) — the
-- same line that put the grants on `organizations`. NOT the bootstrap DEFAULT PRIVILEGES: the
-- postgres creator's public-table defaults grant `authenticated` only MAINTAIN today, so a NEW table
-- does not inherit this. The residue is historical, finite, and enumerated below.
--
-- ── PER-TABLE DECISION (revoke vs. legitimately awaiting a policy) ──────────────────────────────
-- Every candidate was checked three ways before being called dead: (1) no write policy for the verb;
-- (2) no client writer anywhere in pmo-portal/src, pmo-portal/pages, pmo-portal/e2e or scripts/ —
-- the writers that DO exist use the service-role client, whose grants (0080) are untouched here;
-- (3) no SECURITY INVOKER function or trigger writes the table. (3) is the one that could have bitten:
-- an invoker trigger's DML is checked against the CALLING role, so revoking would have broken it
-- silently. Catalog sweep of every function in `public` whose body names one of these tables returned
-- exactly two invoker functions — `agent_events_feedback_only` (an append-only guard that only reads
-- OLD/NEW) and `stamp_agent_attachment_thread_scope` (SELECTs agent_threads; SELECT is untouched).
-- Every other writer is SECURITY DEFINER (next_procurement_doc_number, transition_procurement,
-- reserve_credits, operator_grant_credits, purge_error_events) and runs as the owner, to which grants
-- to `authenticated` are irrelevant. FK cascade deletes are likewise unaffected — referential actions
-- run as the constraint owner.
--
--   agent_attachments          DELETE           dead — the app soft-archives (archived_at, ADR-0018);
--                                               src/lib/db/agentAttachments.ts:123 UPDATEs, never deletes.
--   agent_events               DELETE           dead — append-only by trigger; the only client write is
--                                               the rating UPDATE (agentEvents.ts:50).
--   agent_runs                 DELETE           dead — no client delete; e2e cleanup is service-role.
--   agent_threads              DELETE           dead — no "delete conversation" feature exists. ⚑ If one
--                                               is built, it needs a DELETE POLICY; the grant goes back
--                                               in THAT migration, next to the policy, not before it.
--   agent_usage                UPDATE, DELETE   dead — append-only usage ledger (insert policy only).
--   credits                    UPDATE, DELETE   dead — append-only credit ledger; balance is a SUM
--                                               (org_credit_balance). Mutating a ledger row is not a
--                                               feature awaiting a policy, it is the thing the ledger
--                                               shape exists to prevent.
--   agent_dispatch_watermarks  INSERT, UPDATE, DELETE   dead — dispatcher bookkeeping, service-role only
--                                               (0109 already proves anon deny-default here).
--   error_events               INSERT, UPDATE, DELETE   dead — written by edge functions on service_role
--                                               (_shared/errorEvent.ts), drained by telegram-notify,
--                                               purged by the definer purge_error_events.
--   procurement_doc_counters   INSERT, UPDATE, DELETE   dead — allocated solely by the definer
--                                               next_procurement_doc_number.
--   procurement_status_events  INSERT, UPDATE, DELETE   dead — the audit trail is written by the definer
--                                               transition_procurement; the historical importer
--                                               (scripts/import-historical.mjs) uses service_role.
--
-- NONE of the twenty is legitimately awaiting a policy: in every case the write either has a
-- non-client owner (definer/service_role) or is forbidden by the table's shape (append-only ledger,
-- soft-archive). agent_threads DELETE is the only one with a plausible future feature behind it, and
-- the correct time to re-grant it is the migration that adds the policy.
--
-- ── FIX SHAPE — WHY REVOKE-THEN-RE-GRANT AND NOT A NARROW REVOKE (DD-CUR-4 / DD-WO-3) ───────────
-- A COLUMN-level revoke cannot subtract from a TABLE-level grant — it is a silent no-op (proved live
-- at 0182). The inverse holds and is what this file relies on: a TABLE-level REVOKE clears the
-- privilege whether it was held at table or column granularity. So each table below is revoked
-- table-wide for all three write verbs and then re-granted exactly what stays. That makes the end
-- state DECLARED IN FULL here — no reader has to reconstruct it from 0075 — and it is immune to a
-- column-level residue nobody remembered. (None of these ten carries a column-level write grant
-- today; the shape does not depend on that staying true.)
-- `anon` is named in every revoke for defence in depth only — 0105 removed its write DML repo-wide,
-- so that half is a correct no-op, and anon is never re-granted.
--
-- ── SCOPE — WHAT IS DELIBERATELY NOT TOUCHED ────────────────────────────────────────────────────
-- SELECT (all ten keep it — reads are RLS-gated and several of these tables are read by the UI) ·
-- service_role (0080/0137) · the postgres DEFAULT PRIVILEGES (already free of authenticated write
-- DML) · every table that HAS a matching write policy.
--
-- ⚑ PRODUCTION PARITY (#490) IS NOT DISCHARGED BY THIS FILE. The 0173/0185 lesson is that hosted
-- Supabase's grant defaults differ from local Docker, so a local-only proof certifies nothing about
-- prod. This migration and its pgTAP are verified on local only; running the discovery query and the
-- test against production is a separate, owner-gated step (it needs the 1Password-held prod DB URL).
-- The end state asserted here is what prod must be checked AGAINST, not evidence that it already is.
--
-- ── REVERSIBILITY (ADR-0006) ────────────────────────────────────────────────────────────────────
-- ⚑ NOT `supabase db reset` — v0.9.0 is in production. The manual reverse is an operation on THIS
--   file's text (do not name a migration number — 0075's grant list is not the current state):
--     grant insert, update, delete on public.agent_attachments, public.agent_events,
--       public.agent_runs, public.agent_threads, public.agent_usage, public.credits,
--       public.agent_dispatch_watermarks, public.error_events, public.procurement_doc_counters,
--       public.procurement_status_events to authenticated;
--   That restores a state in which `authenticated` may ATTEMPT these writes (still RLS-denied).
--   `anon` is deliberately NOT re-granted — 0105 stands.

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §1 — tables that KEEP a client write path: revoke all three verbs, re-grant the ones with a policy.
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- agent_attachments — keeps INSERT (agent_attachments_insert) + UPDATE (agent_attachments_update).
revoke insert, update, delete on public.agent_attachments from authenticated, anon;
grant  insert, update         on public.agent_attachments to   authenticated;

-- agent_events — keeps INSERT (agent_events_insert) + UPDATE (agent_events_update; the
-- agent_events_feedback_only trigger narrows that UPDATE to rating/downvote_reason).
revoke insert, update, delete on public.agent_events from authenticated, anon;
grant  insert, update         on public.agent_events to   authenticated;

-- agent_runs — keeps INSERT (agent_runs_insert) + UPDATE (agent_runs_update).
revoke insert, update, delete on public.agent_runs from authenticated, anon;
grant  insert, update         on public.agent_runs to   authenticated;

-- agent_threads — keeps INSERT (agent_threads_insert) + UPDATE (agent_threads_update).
revoke insert, update, delete on public.agent_threads from authenticated, anon;
grant  insert, update         on public.agent_threads to   authenticated;

-- agent_usage — append-only ledger: keeps INSERT (agent_usage_insert) only.
revoke insert, update, delete on public.agent_usage from authenticated, anon;
grant  insert                 on public.agent_usage to   authenticated;

-- credits — append-only ledger: keeps INSERT (credits_insert, operator-only per 0117) only.
revoke insert, update, delete on public.credits from authenticated, anon;
grant  insert                 on public.credits to   authenticated;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §2 — tables with NO client write path at all: revoke all three verbs, re-grant nothing.
-- SELECT is untouched on all four (each is read by the UI or by an operator surface).
-- ════════════════════════════════════════════════════════════════════════════════════════════════
revoke insert, update, delete on public.agent_dispatch_watermarks from authenticated, anon;
revoke insert, update, delete on public.error_events              from authenticated, anon;
revoke insert, update, delete on public.procurement_doc_counters  from authenticated, anon;
revoke insert, update, delete on public.procurement_status_events from authenticated, anon;

comment on table public.credits is
  '⚑ append-only credit ledger. `authenticated` holds INSERT only (credits_insert, operator-only — '
  '0117); UPDATE/DELETE were revoked in 0193 as dead 0075 grants. Balance is a SUM '
  '(org_credit_balance), never an in-place mutation. A re-grant of UPDATE or DELETE here fails '
  'AC-DWG-006 / AC-DWG-011.';

comment on table public.procurement_status_events is
  '⚑ append-only procurement audit trail, written ONLY by the security-definer transition_procurement '
  '(and by the service-role historical importer). `authenticated` holds SELECT only — its INSERT/'
  'UPDATE/DELETE were revoked in 0193 as dead 0075 grants. A re-grant fails AC-DWG-010 / AC-DWG-011.';
