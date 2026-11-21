# Built-in role set: 28 roles in three levels

Ticket #2709 (map #902). Status: Draft, 2026-11-21, awaiting Director "build". Rulings: OD-SCOPE-3, OD-SCOPE-4, OD-SCOPE-2.
Reads: ADR-0103 (custom roles, Q1 2027, NOT built here), ADR-0070 (authority is rank), `approvals-unify-roles.spec.md`.
Covers the intent of #1407 and #1409.

**Job story.** When a contractor sets up PMO, I want roles for the functions it actually has, so each person sees and does what their job needs.

## 1. Design in one paragraph

`profiles.role` (the `user_role` enum, five values) stays the **base access level** and keeps driving every existing RLS policy,
RPC and `policy.ts` rule; none is rewritten. A new global catalogue `built_in_roles` holds 28 stable keys, each with exactly one
base level, one tier (manager / officer / field), one function and default English and Bahasa names. A new nullable
`profiles.built_in_role` holds the key. `built_in_role_base(key)` is the ONE mapping helper (SQL) with ONE frontend mirror
(`pmo-portal/src/auth/builtInRoles.ts`). A trigger keeps `profiles.role = built_in_role_base(built_in_role)` whenever a key is set.
Profiles with a NULL key (every existing person) are untouched: all new rules are inert for them.
The "differences from the base level" are **role capabilities** in a second catalogue, read through helper functions that other
tickets consume. No screen, no price hiding, no new approval flow is built here.

## 2. Roles (key -> tier, base level)

Managers (12): `executive` Executive; `administrator` Admin; `project_manager` PM; `deputy_project_manager` PM; `project_control_manager` PM;
`construction_manager` PM; `procurement_manager` PM; `finance_manager` Finance; `quality_manager` PM; `safety_manager` PM;
`equipment_manager` PM; `hr_manager` PM.
Officers (14), all Engineer base except where noted: `project_administrator`, `engineer`, `planner`, `quantity_surveyor`,
`billing_officer` (Finance), `site_supervisor`, `material_coordinator`, `storekeeper`, `buyer`, `finance_officer` (Finance),
`quality_inspector`, `safety_officer`, `equipment_officer`, `hr_officer`.
Field (2, light accounts, Engineer base): `foreman`, `field_user`.
Base choice rule: a manager approves, so it sits at Project Manager rank or above (ADR-0070 rank); an officer prepares, so it sits
below approval rank (Engineer), except the two finance-side officers who keep Finance. Project Administrator (#1409) is Engineer
base: requests without approval rights.

## 3. Requirements (EARS)

- **FR-001** The system shall provide a catalogue of exactly 28 built-in roles, each with a stable key, one base access level, one
  tier, one function, and default English and Bahasa Indonesia names; keys never change, names are defaults a client may rename (#2712).
- **FR-002** The system shall resolve a role key to its base level through one SQL function, `built_in_role_base(key)`, and one
  frontend mirror, `baseLevelOf(key)`; an unknown or NULL key resolves to NULL (never to a level).
- **FR-003** When a profile is created or its `built_in_role` changes to a key, the system shall set `profiles.role` to the key's base
  level in the same statement; while a key is held, a change of `role` alone shall be refused.
- **FR-004** While `profiles.built_in_role` is NULL, the system shall behave exactly as before (no new rule applies).
- **FR-005** When a role key is assigned, the existing profile-administration rule (ADR-0070, `may_administer_profile`) shall be
  evaluated on the resulting base level, so no one may assign a role whose base level they may not assign; no one may change their own key.
- **FR-006** The system shall expose a role capability catalogue and `role_has_capability(key, capability)` (false for NULL/unknown),
  with the capabilities below, and `actor_has_role_capability(capability)` for the real signed-in, active person.
- **FR-007** Capabilities: `stock_post` Storekeeper; `stock_approve` Material Coordinator; `daily_report_enter` Quantity Surveyor;
  `daily_report_validate` Site Supervisor and Project Control Manager; `crew_time_approve` Construction Manager;
  `billing_stage_run` Billing Officer; `invoice_raise` Finance Manager and Finance Officer; `people_documents_view` HR Manager,
  HR Officer, Administrator; `medical_documents_view` HR Manager, HR Officer, Administrator. Held by no other role.
- **FR-008** The system shall expose `built_in_role_sees_prices(key)` and `actor_sees_prices()`: true for every manager, Buyer,
  Finance Officer and Billing Officer; false for every other officer and field role; true for a NULL key (legacy people).
  Hiding prices is ticket #2699's setting and is NOT built here.
- **FR-009** Tier rules: `built_in_role_tier(key)`; managers approve, officers prepare (helpers `built_in_role_may_approve`,
  `built_in_role_may_prepare`); `built_in_role_may_stand_in(actor_key, absent_key)` is true only when both are managers and the
  actor's base level ranks at or above the absent manager's (never stands in upward).
- **FR-010** The catalogue and capability tables shall be readable by signed-in people and writable by nobody through the API.
- **FR-011** Frontend: `builtInRoles.ts` shall export the same 28 rows and capabilities, `roleHasCapability`, `roleSeesPrices`,
  `baseLevelOf`; a test shall fail if the frontend table and the migration seed differ.
- **NFR-001** Existing RLS, RPCs and `policy.ts` unchanged; existing tests untouched and green.

## 4. Acceptance criteria and owning layer

| ID | Given / When / Then | Owner |
|---|---|---|
| AC-001 | Given the catalogue, then 28 rows: 12 manager, 14 officer, 2 field, all keys unique, all names non-empty in both languages. | pgTAP |
| AC-002 | Given each of the 28 keys, `built_in_role_base` returns the level in section 2 (independent literal list); NULL and unknown give NULL. | pgTAP |
| AC-003 | Given the SQL seed and the TS table, then rows, base levels, tiers and capabilities are identical. | vitest |
| AC-004 | Given a profile insert with a key, then `role` equals the base; given a role-only change while a key is held, then refused (23514) and role persists. | pgTAP |
| AC-005 | Given an existing profile with a NULL key, when updated by any existing path, then behaviour is unchanged (role, other fields, RLS). | pgTAP |
| AC-006 | Given an Executive, when assigning `administrator`, then refused and persisted key unchanged; when assigning `finance_officer` to an Engineer, then it persists with role Finance only if Executive outranks Finance. Given any actor assigning a key to self, then refused. | pgTAP |
| AC-007 | Given each capability in FR-007, then exactly the listed keys hold it and no other (cell-by-cell over 28 x capabilities). | pgTAP |
| AC-008 | Given the 28 keys, `built_in_role_sees_prices` matches FR-008; NULL key is true. | pgTAP |
| AC-009 | Given a signed-in active person holding `storekeeper`, then `actor_has_role_capability('stock_post')` is true and `stock_approve` false; given a legacy person, all false and `actor_sees_prices()` true; given an inactive member, all false. | pgTAP |
| AC-010 | Given tiers, then `may_stand_in` is true for Deputy PM for PM, false for PM for Executive, false for any officer. | pgTAP |
| AC-011 | Given an authenticated client, when writing to the catalogue tables, then refused. | pgTAP |
| AC-012 | Given the existing five roles, then `policy.ts` outcomes are unchanged (existing tests untouched). | vitest |

Mutation checks (reported): change a base level in the seed; make the trigger skip the sync; drop the self-assign guard;
add `stock_approve` to Storekeeper. Each must turn a named AC red.

## 5. Settings

None added. Role names are defaults here; per-client rename belongs to #2712. Which role sees which document category stays the
client's existing Viewer-roles setting; this ticket only makes the keys available to point at.

## 6. Not in this ticket

Custom roles, custom approvals, automations, custom fields (Q1 2027). Light-account screens (separate ticket). Price hiding (#2699).
Role assignment UI. Daily report, billing-stage and stock screens consume the capability helpers in their own tickets.
