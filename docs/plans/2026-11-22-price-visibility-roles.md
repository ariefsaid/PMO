# Plan: price visibility roles

Spec: `docs/specs/price-visibility-roles.spec.md`. Migrations 1850-1851 only. No new table, setting, switch or function.

## Design
ONE deciding function stays: `actor_may_see_prices_now()`. The list of who holds the right stays DATA: `built_in_role_capabilities` rows with capability `sees_prices`. The change is (a) rows for the 11 officer roles that lack one, (b) removal of the legacy-Engineer clause from the function. Foreman and Field user keep no row, so they are the only roles hidden.

## Migrations
1. `supabase/migrations/1850_price_right_office_roles.sql`: `insert into public.built_in_role_capabilities (role_key, capability) values ... on conflict do nothing`, one tuple per line `('key','sees_prices'),` for project_administrator, engineer, planner, quantity_surveyor, material_coordinator, storekeeper, site_supervisor, quality_inspector, safety_officer, equipment_officer, hr_officer. Rollback `supabase/migrations/rollback/1850_price_right_office_roles_down.sql`: delete exactly those 11 rows.
2. `supabase/migrations/1851_price_right_no_legacy_exception.sql`: `create or replace function public.actor_may_see_prices_now()`; body taken from 1215:36-44 (latest definition, verified: no later migration defines it) minus the clause `and not (public.actor_built_in_role() is null and public.auth_role() = 'Engineer')`; same security definer, search_path and grants (re-state the grants). Rollback `rollback/1851_price_right_no_legacy_exception_down.sql`: restore the 1215 body verbatim. Run `npm run check:restated-functions`. Check the merge ordering at integration: the missing gate migrations (1540-1544) may restate this function; if they land, 1851 restates the body from the highest-numbered one.
3. The inventory files `supabase/tests/inventory/anon-executable-definers/` need no change (no new function).

## Tests (written first, red before the migrations)
- pgTAP `supabase/tests/1850_price_visibility_roles.test.sql`: AC-PVR-001..006 (role table as a literal list inside the test, independent of the catalogue; one person per role created with the built-in roles setting on; a loop with `set local role authenticated` per role as `1215_hide_prices.test.sql` does) plus the mutation notes in its header.
- Edit the existing tests listed in spec section 6 in the same commit (1200 AC-008, 1202:133, 1215 truth table, 2720 actors).
- vitest: `pmo-portal/src/auth/priceVisibility.test.ts` (rows from the spec table), `pmo-portal/src/auth/builtInRoles.test.ts` (parity reads 1200 plus 1850 capability tuples; `roleSeesPrices` rows).
- No e2e: the hide setting's journey (AC-HP-001) keeps its owner; its Engineer actor becomes a Field user only if it uses the legacy Engineer as the hidden person (check `grep -rn "hide" pmo-portal/e2e`).

## Frontend
- `pmo-portal/src/auth/builtInRoles.ts`: add the 11 tuples to `ROLE_CAPABILITIES` in migration order (after the 1200 tuples).
- `pmo-portal/src/auth/priceVisibility.ts`: drop the legacy-Engineer clause and the now-unused `baseRole` input; update callers (`grep -rn canSeePrices`). Update the doc comment.

## Docs
`docs/decisions.md`: one dated line recording the ruling (office roles keep prices; the Foreman and Field user are the only hidden roles; a person with no job role sees). Reword `hide-prices.spec.md` requester definition and AC-002/008, `builtin-role-set.spec.md` FR-008/AC-008.

## Gates (pmo-portal/)
`npm run check:guards`, `npm run typecheck`, `npx eslint --max-warnings=0 <changed>`, `npx vitest related --run <changed source>`. Database tests are run by the orchestrator.
