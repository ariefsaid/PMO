-- 0190_profiles_org_id_immutable.sql — `profiles.org_id` is IMMUTABLE after insert.
--
-- DIRECTOR RULING DD-ORG-2 (2026-08-19, #441 → this guard #485): a user in the wrong org is handled
-- by OFFBOARD + REINVITE. Reassignment is ruled out — on tenancy-integrity grounds, not UX.
--
-- ── WHY A TRIGGER AND NOT A DOC ─────────────────────────────────────────────────────────────────
-- `profiles.org_id` is the tenancy anchor. `update profiles set org_id = ...` looks obviously
-- correct to anyone who has not read DD-ORG-2, and it is one line. Running it breaks three things
-- at once:
--   1. HISTORICAL AUTHORSHIP CROSSES A TENANCY LINE. Every approval, timesheet, budget activation
--      and procurement transition the user authored references profiles.id, and the authorization
--      story around those rows assumes the author sits in the record's org. After the update, rows
--      in org A are authored by a profile in org B — a shape no RLS policy anticipates, because it
--      cannot happen today.
--   2. IT LANDS ON THE KNOWN-WEAK SoD SURFACE. The recorded root cause of the create-path SoD class
--      is that the SoD asks WHO SET A VALUE and never validates that person's CURRENT standing. A
--      cross-org move is that same defect with a new trigger, introduced deliberately, into the
--      money path.
--   3. IT SILENTLY CARRIES ORG-SCOPED INTEGRATION CONNECTIONS ACROSS THE BOUNDARY. Offboarding
--      cascade-deletes ms_graph_connections and the external-connection set BY DESIGN (0114). A bare
--      `update` has no such step, so an org-A OAuth connection stays reachable from org B. That
--      arrives as an omission rather than a decision, which is what makes it the worst outcome here.
-- The repo's standing preference is that briefs advise and constraints enforce. This is the
-- constraint.
--
-- ── INTEGRITY INVARIANT, NOT AN AUTHORIZATION RULE (the load-bearing distinction) ────────────────
-- There is NO role for which this update is correct — not Admin, not `postgres`, and deliberately
-- NOT `service_role`. A bypass for the "trusted" path is exactly how such a guard gets used, so the
-- trigger takes no role into account at all and offers no exemption hook. If a future requirement
-- genuinely needs to change org_id, the answer is to revisit DD-ORG-2, not to add a carve-out here.
--   • errcode is 23514 (class 23, integrity constraint violation) and NOT 42501 (insufficient
--     privilege). 42501 would misdescribe this as "you lack the privilege", inviting the next reader
--     to go find a role that has it. Nobody has it.
--   • `enable always` (rather than the default `enable`) so the guard still fires under
--     `session_replication_role = 'replica'`, which otherwise silences ORIGIN triggers. Nothing in
--     this repo sets that today; the point is that a future restore/replication path cannot quietly
--     disarm the invariant. Safe here because the trigger is UPDATE-only — a data restore inserts.
--
-- ── WHY `AFTER` AND NOT `BEFORE` (deliberate, and it is tested) ──────────────────────────────────
-- org_id already has TWO layers above this one, and each is asserted by its own test:
--   layer 1 — COLUMN GRANT (0182/0184): `org_id` is absent from the client UPDATE allow-list, so
--             `authenticated` is refused 42501 at parse/rewrite time, before RLS. Asserted by
--             supabase/tests/0175_profiles_status_allowlist.test.sql §E.
--   layer 2 — RLS: profiles_update_self pins org_id (0007/0021) and profiles_hierarchy_update (0179)
--             pins `org_id = auth_org_id()` in BOTH `using` and `with check`. Asserted by
--             supabase/tests/0004_rls_remediation.test.sql, which temporarily grants the org_id
--             column so the RLS pin is reachable and then asserts the RLS message specifically.
-- Postgres runs BEFORE ROW triggers BEFORE the RLS `WITH CHECK` evaluation. A BEFORE trigger here
-- would therefore pre-empt layer 2 and turn 0004's RLS assertion into an assertion about THIS file —
-- the precise "the assertion used to pass for a DIFFERENT reason" failure 0004's own comment records
-- having already been caught once. An AFTER ROW trigger runs after `WITH CHECK`, so each layer stays
-- independently observable, which is what defence in depth requires. Aborting from AFTER is equally
-- total: the statement's effects are rolled back with the transaction.
--
-- ── NOTHING LEGITIMATELY UPDATES org_id TODAY (swept 2026-08-19, whole tree) ─────────────────────
-- INSERTs are untouched and stay free — that is how every profile row is created (seed.sql,
-- seed-admin.sql, the admin-invite-user edge function's service-role insert, and every pgTAP
-- fixture).
--   • No `update ... profiles ... org_id` exists in supabase/migrations, supabase/seed*.sql, any
--     edge function, any RPC, or the app tree. The only client-side profile UPDATEs are `role` and
--     `manager_id` (pmo-portal/src/lib/db/adminUsers.ts:51,61).
--   • admin_set_user_status (0065) writes `status` only.
--   • scripts/m365-deadlock-probe.sh and scripts/m365-race-probe.sh re-seed with
--     `insert ... on conflict (id) do update set org_id = excluded.org_id, ...`. That names org_id in
--     the SET list but writes the SAME value, so the `is distinct from` predicate is false and the
--     trigger does not fire. This is why the guard compares VALUES rather than rejecting any
--     statement that mentions the column — the difference matters, and over-blocking would break two
--     working probes for nothing.
--   • The one profiles upsert in the app/test tree
--     (pmo-portal/e2e/serial/AC-IXD-PROC-W5-3-approvals-inbox.spec.ts:196) targets a user created
--     moments earlier by auth.admin.createUser, so it always takes the INSERT branch — and there is
--     no auth.users → profiles trigger that could have pre-created the row.
--
-- ── REVERSIBILITY (ADR-0006) ────────────────────────────────────────────────────────────────────
-- ⚑ NOT `supabase db reset` — v0.8.0 is in production. The manual reverse restores a state in which
--   a bare cross-org `update` succeeds again, so do it only alongside a reversal of DD-ORG-2:
--     drop trigger if exists profiles_org_id_immutable on public.profiles;
--     drop function if exists public.reject_profiles_org_id_change();
--     comment on column public.profiles.org_id is null;
--   Nothing else in the schema depends on the trigger or the function, and no grant is altered by
--   this file, so that is the complete reverse.

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- The guard.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
create or replace function public.reject_profiles_org_id_change()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  raise exception
    'profiles.org_id is immutable (DD-ORG-2): profile % cannot be moved from org % to org %',
    old.id, old.org_id, new.org_id
    using errcode = '23514',
          hint = 'A user in the wrong org is handled by offboard + reinvite, never by reassigning '
                 'org_id. Offboard the profile in its current org (admin_set_user_status -> '
                 'disabled, which cascade-deletes the org-scoped integration connections), then '
                 'invite the user into the target org. The old profile stays put so its authorship '
                 'history remains inside the org it was created in. See docs/decisions.md DD-ORG-2 '
                 'and supabase/migrations/0190_profiles_org_id_immutable.sql.';
  return null;
end;
$$;

comment on function public.reject_profiles_org_id_change() is
  'DD-ORG-2 (#441/#485): raises 23514 on any UPDATE that changes profiles.org_id. An INTEGRITY '
  'invariant, not an authorization rule — it applies to every role including service_role and the '
  'table owner, and there is deliberately no exemption hook. The tenancy anchor cannot move because '
  'moving it strands historical authorship across a tenancy line and carries org-scoped integration '
  'connections over the boundary that offboarding exists to cascade-delete.';

drop trigger if exists profiles_org_id_immutable on public.profiles;

-- AFTER, not BEFORE: BEFORE would pre-empt the RLS WITH CHECK layer that 0004 asserts. See the
-- header. WHEN keeps the guard silent for an UPDATE that merely re-writes the same org_id (the
-- m365 probe scripts' `on conflict do update set org_id = excluded.org_id`), and is evaluated on
-- the final row so a BEFORE trigger cannot smuggle a change past it.
create trigger profiles_org_id_immutable
after update on public.profiles
for each row
when (new.org_id is distinct from old.org_id)
execute function public.reject_profiles_org_id_change();

-- Fires even under session_replication_role = 'replica'. See the header.
alter table public.profiles enable always trigger profiles_org_id_immutable;

comment on column public.profiles.org_id is
  '⚑ IMMUTABLE after insert (DD-ORG-2, trigger profiles_org_id_immutable, 0190). A user in the wrong '
  'org is handled by offboard + reinvite; reassigning org_id is ruled out on tenancy-integrity '
  'grounds. Enforced for EVERY role including service_role — this is an integrity invariant, not an '
  'authorization rule. Three layers now hold it: the 0182/0184 column allow-list (client roles), the '
  '0007/0179 RLS org_id pin, and this trigger (everything else).';
