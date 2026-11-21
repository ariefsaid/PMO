# Plan: light accounts (#2710)

Spec: `docs/specs/light-accounts.spec.md`. Branch `feat/2710-light-accounts` (stacked on `feat/2709-role-set`). Test-first throughout.

## Migrations (range 1205-1209, each with `supabase/migrations/rollback/<n>_<slug>_down.sql`)
| # | File | Content |
|---|---|---|
| 1205 | `1205_light_accounts_helpers.sql` | `profile_seat_type(uuid)`, `actor_is_light()` (stable, definer), `actor_is_light_foreman()`; revoke public/anon. |
| 1206 | `1206_light_accounts_restrictive_policies.sql` | one restrictive policy per covered table (spec section 5): `as restrictive for all to authenticated using ((select actor_is_light()) is not true or <own>) with check (same)` (select-only where the table is read-only to Engineers). Table list finalised from `pg_policies`/`role_table_grants` at head. |
| 1207 | `1207_light_accounts_my_home.sql` | `my_home()` definer RPC (own tasks, rostered work orders today, reported issues, foreman crew roster); no price/budget fields; execute to authenticated only. |
| 1208 | `1208_light_accounts_seat_report.sql` | `org_seat_report()` (Admin/Executive of own org): active seats split full/light plus `seat_limit`. |
| 1209 | reserved (own-row indexes on `tasks(assignee_id)`, `incident_reports(reported_by)` if absent). |

Settings: none; default behaviour unchanged. Inventory files: `supabase/tests/inventory/anon-executable-definers/2710-light-accounts.txt`
(`my_home`, `org_seat_report`; helpers revoked), `scripts/isolation-probe-denominator.d/2710-light-accounts.json`.

## Tests (written first)
- pgTAP `supabase/tests/light_accounts.test.sql`: AC-LA-001..008 (fixtures: legacy Engineer, `engineer`, `foreman`, `field_user`, two orgs, a
  crew/roster, tasks and issues of several people). Each rule carries a mutation note naming the red assertion.
- vitest `pmo-portal/src/auth/lightAccount.test.ts` (AC-LA-009), `pmo-portal/src/lib/repositories/myHome.test.ts`,
  `pmo-portal/pages/MyHome.test.tsx` (AC-LA-011), `pmo-portal/src/components/shell/lightRedirect.test.tsx` (AC-LA-010),
  seat report in `pmo-portal/pages/AdministrationUsage` area test (AC-LA-012).
- E2E `pmo-portal/e2e/AC-LA-E2E-light-account-home.spec.ts` (written, not run).

## Frontend files
- `pmo-portal/src/auth/lightAccount.ts`: `seatTypeOf`, `isLightAccount`.
- `pmo-portal/src/lib/repositories/myHome.ts` (new standalone module over `my_home()`, `attendance_record`; plus `seatReport.ts`).
- `pmo-portal/pages/MyHome.tsx` and `src/components/my/{MyTasks,ClockInSection,DeliveriesSection,MyIssues,CrewRoster}.tsx`.
- `pmo-portal/App.tsx`: `/my` route and the redirect guard for light accounts (small, additive); Rail/search/palette hidden for light accounts.
- i18n keys in the en and id common namespaces; `docs/glossary.md`: light account, seat type.

## Order
1. pgTAP + vitest red; 2. 1205, 1207, 1208, 1206; 3. FE helpers, repository, screens; 4. route guard; 5. static gates only
(`check:guards`, `typecheck`, eslint on changed files, vitest on new files and affected directories); DB, e2e not run (orchestrator's wave).
