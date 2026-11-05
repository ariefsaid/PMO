-- 0683 — lease for trigger-fire claims (T-09 / FN3R01-010). Reversible: rollback/0683_automation_fire_lease_down.sql.
--
-- A tick that dies after claiming an event (agent_automation_fires insert) but before it fires leaves the
-- event claimed and never fired. `settled_at` is stamped by the dispatcher the moment the unit is decided:
-- just before the fire starts (from then on the event is never fired again), or when the unit ends without
-- firing. A claim that is still unsettled after the lease (fired_at is the claim time) may be re-claimed once
-- by a single conditional UPDATE; a settled claim never is. Existing rows are history: all settled.
alter table public.agent_automation_fires add column settled_at timestamptz;
update public.agent_automation_fires set settled_at = fired_at;
