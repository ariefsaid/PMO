# Price visibility: who holds the price right

Status: Draft for Director sign-off (phase 1). Rulings it rests on: OD-SCOPE-3 (28 built-in roles), OD-SCOPE-4 (Foreman and Field user are light accounts and see no price), DD-R1215-1 (the hide setting ships off). Builds on `hide-prices.spec.md` (#2699) and `builtin-role-set.spec.md` section 2.

**Job story.** When an Admin turns on hiding prices, I want prices hidden from foremen and field users only, so that office roles (planners, buyers, storekeepers, project administrators) keep seeing the figures they work with.

## 1. Today (verified in code, 2026-11-22)

- The one deciding function is `actor_may_see_prices_now()` (`supabase/migrations/1215_hide_prices_setting.sql:36-44`; no later migration redefines it). `actor_may_see_prices()` and `get_may_see_prices()` (1215:45-52) only call it. The frontend mirror is `canSeePrices` (`pmo-portal/src/auth/priceVisibility.ts`), which reads `get_may_see_prices` through `pmo-portal/src/lib/db/hidePrices.ts:22`.
- Setting off (`organizations.hide_prices_from_requesters`, `not null default false`, 1215:7): everyone sees prices.
- Setting on: an inactive member sees none; otherwise the person sees prices only if `actor_sees_prices()` (`1203_role_capability_actor_helpers.sql:16-22`) AND NOT (no job role AND base level Engineer) (1215:41-42).
- `actor_sees_prices()` reads `built_in_role_sees_prices(key)` (`1200_builtin_role_catalogue.sql:150-153`): a NULL key (no job role) is true; a job role is true only when `built_in_role_capabilities` holds a `sees_prices` row for it. The list is DATA: 15 rows at `1200_builtin_role_catalogue.sql:80-94` (the 12 managers, Buyer, Finance Officer, Billing Officer). The frontend carries a parity mirror in `pmo-portal/src/auth/builtInRoles.ts` (`ROLE_CAPABILITIES`), checked against migration 1200 by `builtInRoles.test.ts`.
- So with the setting on, these lose prices today: 11 officer roles (Project Administrator, Engineer, Planner, Quantity Surveyor, Material Coordinator, Storekeeper, Site Supervisor, Quality Inspector, Safety Officer, Equipment Officer, HR Officer), Foreman, Field user, and any active person with no job role at the Engineer base level. The claim in the item is correct.
- The base does not already answer the ask: the list and the legacy-Engineer clause both have to change.
- The setting is off everywhere: default false; the only writer is `set_hide_prices_enabled` (Admin); the Administration card is held back by `HIDE_PRICES_SETTING_AVAILABLE = false` (`pmo-portal/src/lib/db/hidePrices.ts:5`, used at `pmo-portal/pages/Administration.tsx:297`; DD-R1215-1). No organisation is using the older behaviour, so this change moves no one's current view.
- The database gate on the priced base tables (`feat/hide-prices-db-gate`) has not landed and is not carried here. If it later restates `actor_may_see_prices_now()`, migration 1851 must be re-based on its body.

## 2. Requirements (EARS)

- **FR-001** While the hide setting is on, the system shall show prices to every active person except one holding the Foreman or Field user job role.
- **FR-002** While the hide setting is on, the system shall show prices to an active person with no job role at every base level (the legacy-Engineer exception is removed).
- **FR-003** While the hide setting is off, the system shall show prices to everyone exactly as before.
- **FR-004** The list of job roles that hold the price right shall be data (`built_in_role_capabilities` rows with capability `sees_prices`), not a function body. The deciding function shall name no role.
- **FR-005** There shall be one deciding function, `actor_may_see_prices_now()`; no second path, no new per-feature switch, and no new setting. The hide setting keeps its default off.
- **FR-006** An inactive member shall see no price while the setting is on (unchanged).
- **FR-007** The frontend `canSeePrices` shall give the same answer as the database for every role, from the same data.
- **FR-008** A job role not in the catalogue (unknown key) shall fail closed (unchanged).
- No refusal message is introduced: hidden prices read as NULL through the masked views; no new error a person can meet, so no `refusals.ts` entry is needed.

## 3. Settings and defaults

`organizations.hide_prices_from_requesters` stays default false. Who holds the price right is data in `built_in_role_capabilities` (a role holds the right only if a row says so); nothing else is configurable here. Owner custom-role editing stays Q1 2027 (OD-SCOPE-3).

## 4. Per-role proof (setting on; setting off = everyone sees, no exceptions)

| Role (base level) | Sees prices, setting on |
|---|---|
| Executive, Administrator, Project Manager, Deputy Project Manager, Project Control Manager, Construction Manager, Procurement Manager, Finance Manager, Quality Manager, Safety Manager, Equipment Manager, HR Manager (12 managers) | yes |
| Buyer, Finance Officer, Billing Officer | yes |
| Project Administrator, Engineer, Planner, Quantity Surveyor, Material Coordinator, Storekeeper, Site Supervisor, Quality Inspector, Safety Officer, Equipment Officer, HR Officer (new: 11 officers) | yes |
| Foreman, Field user | no |
| No job role at Engineer / Project Manager / Finance / Executive / Admin | yes (Engineer changes from no) |
| Inactive member (any) | no |

## 5. Acceptance criteria

| ID | Given / When / Then | Owner |
|---|---|---|
| AC-PVR-001 | Given the setting on and one active person per each of the 28 job roles, when `actor_may_see_prices_now()` runs, then it is false only for foreman and field_user (the table above, one assertion per role, 28 rows plus the count). | pgTAP |
| AC-PVR-002 | Given the setting on and an active person with no job role at each of the five base levels, then each sees prices. | pgTAP |
| AC-PVR-003 | Given the setting off, then all 28 roles, the five no-role levels see prices, and no role loses anything. | pgTAP |
| AC-PVR-004 | Given the setting on, an inactive member sees none; a person of another organisation whose setting is off is unaffected. | pgTAP |
| AC-PVR-005 | Given the catalogue, then `sees_prices` rows are exactly the 26 non-field roles, and the deciding function body names no role key (catalogue-driven: adding or deleting a row changes the answer with no function change). | pgTAP |
| AC-PVR-006 | Given the setting on and a Planner, Buyer, Storekeeper and Project Administrator, then each reads a non-NULL rate through `procurement_items_masked`; a Foreman reads NULL. | pgTAP |
| AC-PVR-007 | Given the frontend table, then `canSeePrices` equals the database table for all 28 roles, the no-role levels, setting off and inactive; `ROLE_CAPABILITIES` equals the union of the migrations that insert capability rows. | vitest |
| AC-PVR-MUT | Mutation checks (each turns the named test red, then restore): delete one added `sees_prices` row (AC-PVR-001); restore the legacy-Engineer clause (AC-PVR-002); make the function return true (AC-PVR-001 foreman/field_user); drop the setting test (AC-PVR-003). | pgTAP |

## 6. Existing tests whose steps change, and why

- `supabase/tests/1200_builtin_role_catalogue.test.sql` AC-008 (who sees prices list, and the "storekeeper ... do not" assertion): the list is now 26 roles; the check is rewritten to the new ruling.
- `supabase/tests/1202_profiles_built_in_role.test.sql:133` (Site Supervisor does not see prices): now sees.
- `supabase/tests/1215_hide_prices.test.sql` truth table (`e1` legacy Engineer hidden, `a2` Storekeeper hidden, plan counts): both now see; the hidden actor becomes a Foreman or Field user.
- When the gate lands, its test `2720_hide_prices_base_tables.test.sql` names the legacy Engineer and the Storekeeper as hidden actors; it must then use a Field user and a Foreman as the hidden actors.
- `pmo-portal/src/auth/priceVisibility.test.ts` (legacy Engineer, Storekeeper, Site Supervisor rows) and `pmo-portal/src/auth/builtInRoles.test.ts` (parity source, `roleSeesPrices('storekeeper')`).
- `docs/specs/hide-prices.spec.md` AC-002/AC-008 and the requester definition, `builtin-role-set.spec.md` FR-008/AC-008: reworded to point here.
- The goal of each test is kept; only the ruling the expectation encodes changed.
