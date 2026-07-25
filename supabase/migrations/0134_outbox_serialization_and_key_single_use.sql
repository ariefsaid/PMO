-- 0134_outbox_serialization_and_key_single_use.sql — round-7 cross-family B3 + B7 (duplicate money /
-- key replay). The outbox is where a money command becomes serializable; 0096's single unique
-- 4-tuple (org_id, domain, pmo_record_id, idempotency_key) was not enough to make it one.
--
-- B3 — CONCURRENT CREATES FOR ONE PMO RECORD WERE NOT SERIALIZED.
--   `checkCreateTargetUnmapped` (transitionTargetGuard.ts) + the dispatch's read-then-insert are a
--   read-then-write race: two requests naming the SAME `record.id` with DIFFERENT idempotency keys both
--   resolve "no mapping", both insert an outbox row, and both POST — TWO ERP documents. For an incoming
--   Payment Entry both become submitted cash/AR documents; finalization then races through
--   `record_outbox_ref` and either 23505s or strands one row permanently `committed`. No edge function
--   can close this: it holds no transaction across the ERP HTTP call. The DB must.
--   The fix is a PARTIAL unique index — AT MOST ONE NON-TERMINAL outbox row per (org, domain, pmo record).
--   The loser's INSERT raises 23505 BEFORE any ERP write, and `dispatchMoneyWrite`'s existing 23505
--   branch re-reads by the 4-tuple, finds nothing (different key) and surfaces the error — refused, no
--   money minted. The two paths that MUST keep working are untouched:
--     • the legitimate SAME-KEY retry never inserts (it reads its own row by the 4-tuple and claims it), and
--     • the sweep's recovery cycle only TRANSITIONS that one row (claim/quarantine/finalize).
--   NON-TERMINAL = the states in which an ERP document may already exist or may still be created:
--   pending (about to POST), committing (POST in flight), committed (finalize pending), quarantined
--   (in-flight overlap), held (mutable-anchor, operator-resolved). Deliberately NOT blocking:
--     • `confirmed` — done; the create's successor commands (submit/cancel/amend) must be admitted;
--     • `failed`    — a CLASSIFIED rejection: no ERP document was minted, and `payload_digest` binds the
--                     burned key to the OLD payload, so a corrected retry can only proceed under a NEW
--                     key. Blocking it would dead-end the record forever.
--
-- B7 — IDEMPOTENCY KEYS WERE REUSABLE ACROSS PMO RECORDS.
--   Uniqueness was per-4-tuple while every active member could SELECT the keys and payloads, so a key
--   lifted off an orphaned `committing` row could be re-presented with a NEW `pmo_record_id`: the
--   ERPNext recovery probe (`%key%` on the doctype anchor) then adopts the ORIGINAL ERP document and
--   attributes its amount to attacker-chosen PMO links. Two changes:
--     • the key becomes SINGLE-USE per (org_id, domain) — a full unique index, not a partial one: a
--       key anchors an ERP document that lives forever, so it stays burned after the row is terminal;
--     • members lose column SELECT on `idempotency_key` — the field the replay actually needs. The row
--       itself stays member-visible (state/last_error/record id — the operator view) and no PMO code
--       reads the key with a user JWT (the dispatch/sweep read it as service_role, which is exempt from
--       column privileges). `payload` is deliberately LEFT readable: 0128's
--       `block_delete_with_inflight_external_command` trigger reads `payload ->> '<link>'` under the
--       DELETING USER's privileges, so revoking it would break the in-flight-link delete guard on
--       projects/companies/sales_invoices. The payload carries this org's own money-command inputs,
--       which its active members can already see in the mirrors.
--
-- Data note: `create unique index` (not CONCURRENTLY — Supabase migrations run in a transaction) FAILS
-- LOUDLY if existing rows already violate either rule. That is the intended behavior for a money table:
-- a pre-existing duplicate is exactly the defect this closes and must be resolved by an operator, never
-- silently indexed around. No org employs the ERPNext tier in production today.
--
-- Reversibility (ADR-0006): supabase db reset. Manual rollback:
--   drop index if exists public.external_command_outbox_one_inflight_per_record;
--   drop index if exists public.external_command_outbox_key_single_use;
--   grant select on public.external_command_outbox to authenticated, anon;

-- ── B3: at most one NON-TERMINAL outbox row per (org, domain, pmo_record_id). ────────────────────────
create unique index external_command_outbox_one_inflight_per_record
  on public.external_command_outbox (org_id, domain, pmo_record_id)
  where state in ('pending','committing','committed','quarantined','held');

-- ── B7: an idempotency key is single-use per (org, domain) — across ALL states and ALL records. ──────
create unique index external_command_outbox_key_single_use
  on public.external_command_outbox (org_id, domain, idempotency_key);

-- ── B7: drop member SELECT on the replay-enabling columns. Postgres has no column-level REVOKE that
-- narrows a table-level grant, so the table grant is revoked and re-issued per column. The list is
-- every column of 0096 + 0127's actor_user_id, MINUS idempotency_key/payload. A future column addition
-- is intentionally NOT auto-granted (fail closed for a machine-written money table; add it here
-- deliberately if members must see it).
revoke select on public.external_command_outbox from authenticated, anon;
grant select (
  id, org_id, domain, pmo_record_id, external_tier, operation, state, external_record_id,
  canonical, payload, payload_digest, attempt_count, claim_generation, claimed_at, reconcile_after,
  last_error, actor_user_id, created_at, updated_at
) on public.external_command_outbox to authenticated, anon;
