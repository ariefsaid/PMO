# Built-in role set: 28 roles in three levels

Ticket #2709 (map #902). Status: Approved by the Director 2026-11-21 (rulings 1-5 applied), built. Rulings: OD-SCOPE-3, OD-SCOPE-4, OD-SCOPE-2.
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

## 2. The 28 roles (key -> tier, base access level)

Base-level rule: a manager approves, so it sits at Project Manager rank or above (ADR-0070 rank); an officer prepares, so it sits
below approval rank (Engineer), except the finance-side roles that keep Finance. Project Administrator (#1409, requests without
approval rights) is Engineer base. Deputy Project Manager is a manager (stands in for the Project Manager); Site Supervisor is an officer.

| # | Key | Tier | Function | Base access level |
|---|---|---|---|---|
| 1 | `executive` | manager | leadership | Executive |
| 2 | `administrator` | manager | administration | Admin |
| 3 | `project_manager` | manager | project | Project Manager |
| 4 | `deputy_project_manager` | manager | project | Project Manager |
| 5 | `project_administrator` | officer | project | Engineer |
| 6 | `project_control_manager` | manager | project control | Project Manager |
| 7 | `engineer` | officer | project control | Engineer |
| 8 | `planner` | officer | project control | Engineer |
| 9 | `quantity_surveyor` | officer | project control | Engineer |
| 10 | `billing_officer` | officer | project control | Finance |
| 11 | `construction_manager` | manager | construction | Project Manager |
| 12 | `site_supervisor` | officer | construction | Engineer |
| 13 | `foreman` | field | construction | Engineer |
| 14 | `material_coordinator` | officer | materials | Engineer |
| 15 | `storekeeper` | officer | materials | Engineer |
| 16 | `procurement_manager` | manager | procurement | Project Manager |
| 17 | `buyer` | officer | procurement | Engineer |
| 18 | `finance_manager` | manager | finance | Finance |
| 19 | `finance_officer` | officer | finance | Finance |
| 20 | `quality_manager` | manager | quality | Project Manager |
| 21 | `quality_inspector` | officer | quality | Engineer |
| 22 | `safety_manager` | manager | safety | Project Manager |
| 23 | `safety_officer` | officer | safety | Engineer |
| 24 | `equipment_manager` | manager | equipment | Project Manager |
| 25 | `equipment_officer` | officer | equipment | Engineer |
| 26 | `hr_manager` | manager | hr | Project Manager |
| 27 | `hr_officer` | officer | hr | Engineer |
| 28 | `field_user` | field | field | Engineer |

12 managers, 14 officers, 2 field. Default English and Bahasa Indonesia names are in migration 1200 and `builtInRoles.ts`.

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
- **FR-007** Capabilities: `sees_prices` (FR-008); `people_documents_view` HR Manager, HR Officer, Administrator (reads, adds and renews
  every person's non-medical documents and reads the person list); `medical_documents_view` HR Manager, HR Officer, Administrator
  (reads medical-document status and dates, in the app and in the expiry email; writes stay Admin only). `daily_report_enter`
  Quantity Surveyor and `daily_report_validate` Site Supervisor and Project Control Manager are held in the catalogue for a ruling.
  `billing_steps_view` and `billing_steps_run` (migration 1771, `billing-steps.spec.md` §3) decide who reads and who acts on a work order's
  billing steps; neither is held by a field role.
  Held by no other role. Each read capability is read by one database gate function that every channel calls (`supabase/tests/2716`).
- **FR-008** The system shall expose `built_in_role_sees_prices(key)` and `actor_sees_prices()`: true for every manager, Buyer,
  Finance Officer and Billing Officer; false for every other officer and field role; true for a NULL key (legacy people).
  Hiding prices is ticket #2699's setting and is NOT built here.
- **FR-009** Each role has a tier (manager, officer, field) in the catalogue; field roles are light accounts.
- **FR-010** The catalogue and capability tables shall be readable by signed-in people and writable by nobody through the API.
- **FR-011** Frontend: `builtInRoles.ts` shall export the same 28 rows and capabilities, `roleHasCapability`, `roleSeesPrices`,
  `baseLevelOf`; a test shall fail if the frontend table and the migration seed differ.
- **FR-012** The organization setting `built_in_roles_enabled` (default false) shall gate assignment: while false the database
  refuses to set a built-in role key for any profile of that organization (insert or update); clearing a key is always allowed.
  Only an Admin of the organization turns it on or off. Turning it off keeps keys already held.
- **FR-013** Where the setting is on, the Administration Users "Edit role" form shall offer the 28 roles grouped by tier with English
  or Bahasa names, show the resulting access level read-only, and save through the repository seam; where it is off the form and
  the directory are unchanged. The Users directory shows a held role's name with its access level.
- **FR-014** The setting is switched on Administration > People > Built-in roles (Admin-only affordance, server enforced).
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
| AC-009 | Given a signed-in active person holding `site_supervisor`, then `actor_has_role_capability('daily_report_validate')` is true and `medical_documents_view` false; given a legacy person, all false and `actor_sees_prices()` true; given an inactive member, all false. | pgTAP |
| AC-010 | Given the catalogue, then each read capability has one gate function and the held ones are listed (`2716`); the medical and people-documents rules are proved in `2717` and `2718`. | pgTAP |
| AC-011 | Given an authenticated client, when writing to the catalogue tables, then refused. | pgTAP |
| AC-012 | Given the existing five roles, then `policy.ts` outcomes are unchanged (existing tests untouched). | vitest |
| AC-013 | Given the setting off, when a key is set (update or insert, any actor), then refused (P0001) and the persisted key stays NULL; given a non-Admin or another organization's Admin, then the setting cannot be turned on; given the setting on, an Admin assigns and the key persists. | pgTAP |
| AC-014 | Given the setting, then it reads Off by default, an Admin turns it on and off, a non-Admin sees the state and no control; the DAL sends only the flag. | vitest |
| AC-015 | Given Edit role with the setting off, then the plain form saves the access level as before; with it on, 28 roles are offered by tier, the base level is shown read-only, and a held role can be cleared. | vitest |
| AC-BIR-001 | Given an Admin in the browser, when the setting is turned on, a person is given a role, shown in the directory and cleared, and the setting turned off, then the Edit role form returns to the plain one. | E2E (serial lane) |

Mutation checks (reported in the build report): change a base level in the seed (AC-002); add `stock_approve` to Storekeeper (AC-007);
skip the trigger's level sync (AC-004); drop the self-assign guard (AC-006); drop the setting gate (AC-013); allow a role-only change
while a key is held (AC-004). Each turns the named AC red and is restored.

## 5. Settings

`organizations.built_in_roles_enabled`, default false = unchanged behaviour. Role names are defaults here; per-client rename belongs
to #2712. Which role sees which document category stays the client's setting.

**Pointing approvals, notifications and document categories at a role.** No existing config table targets a `user_role` value
(spend-approver routes name people; document categories and viewer roles are not on `dev` yet), so nothing is retrofitted. The seam is
`actor_has_role_capability(capability)` (SQL, called by one gate function per capability) and `roleHasCapability` / the stable role keys
(frontend); a later config table can store a role key with an FK to `built_in_roles(key)`.
Built since: `docs/specs/roles-that-decide.spec.md` stores a role key with that FK on material-request approval steps and in the
purchase-order ordering setting, and decides "fills the role" through one function, `holds_job_role(profile, key)`.

## 6. Not in this ticket

Custom roles, custom approvals, automations, custom fields (Q1 2027). Light-account screens (separate ticket). Price hiding (#2699).
A screen that needs a new capability adds one catalogue row and one gate in its own ticket.
