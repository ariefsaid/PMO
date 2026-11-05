-- 0689 one full ledger replay per ERPNext org so historical journal rows gain their GL remark (#1919 FR-JEC-002).
-- The remarks fetch (ledgerFetch / ledgerMirrorFeed) ships with this release; the flag is set here, not in 0686, so a
-- release that carries only the mirror column never spends the replay on a sweep that cannot read remarks.
-- The sweep's existing full-replay path (0294/0312) consumes the flag. Statements are not marked delayed: the replay
-- re-writes the same amounts. Rollback: supabase/migrations/rollback/0689_gl_remarks_replay_down.sql
update public.external_org_bindings set statement_full_ledger_replay_needed = true
 where external_tier = 'erpnext' and activated_at is not null;
