# Implementation plan — attendance rate against a target (#2706)

Spec: `docs/specs/attendance-rate.spec.md`. Branch `feat/2706-attendance-rate`. Migration numbers **1436–1439** (this ticket uses 1436 and 1437). Executor: Orca worker; the setting and the report are reads over shipped attendance, so no money or SoD path is touched.

## Shape

| Layer | File | What |
|---|---|---|
| Setting | `supabase/migrations/1436_attendance_target_rate.sql` (+ rollback) | `organizations.attendance_target_rate numeric(5,2)` nullable, `0..100`; column-scoped `grant update(…)`; the existing Admin-only row policy is the gate. |
| Report read | `supabase/migrations/1437_attendance_rate_by_crew.sql` (+ rollback) | `attendance_rate_by_crew(p_from date, p_to date)` — one row per crew with counts, rate, target. Security definer, org-scoped, role-gated. |
| DAL | `pmo-portal/src/lib/db/attendanceRate.ts` | Read target, set target (two-step org write, ambiguity refused), read the report; row shapes. |
| Seam | `pmo-portal/src/lib/repositories/crews.ts` | `attendanceRateRepository` over the DAL (ADR-0017). |
| Hooks | `pmo-portal/src/hooks/useAttendanceRate.ts` | `useAttendanceTarget`, `useSetAttendanceTarget`, `useAttendanceRate(from,to)`; keys carry org id. |
| Policy | `pmo-portal/src/auth/policy.ts` | `attendanceRate: { view }` (Admin/Executive/PM/Finance), `attendanceTarget: { manage }` (Admin) — UX only. |
| Admin UI | `pmo-portal/pages/admin/OrgAttendanceTarget.tsx` + test | Target field in Administration › Projects; save and clear. |
| Report UI | `pmo-portal/pages/crews/AttendanceRate.tsx` + test | Period fields, per-crew counts and rate against target, below-target mark; table on desktop, cards on a phone. |
| Page | `pmo-portal/pages/crews/Crews.tsx` | `?view=rate` tab, offered only when the target is set and the role may view it. |
| Strings | `pmo-portal/public/locales/{en,id}/crews.json`, `…/administration.json` | English and Bahasa Indonesia. |
| Types | `pmo-portal/src/lib/supabase/database.types.ts` | New column and the new function signature. |
| DB proof | `supabase/tests/attendance_rate.test.sql` | AC-ATR-001..007. |
| UI proof | `pmo-portal/pages/crews/AttendanceRate.test.tsx`, `pmo-portal/pages/admin/OrgAttendanceTarget.test.tsx`, `pmo-portal/src/lib/db/attendanceRate.test.ts` | AC-ATR-001, 008, 009. |
| Journey | `pmo-portal/e2e/AC-ATR-010-attendance-rate.spec.ts` | AC-ATR-010. |
| Words | `docs/glossary.md` | Attendance rate, target rate. |

## Rate definition (the one the tests bind to)

For a period `[from, to]` and a crew:

- **expected** — distinct (person, date) where the person is placed in the crew that date (newest placement covering the date wins, as `work_order_roster` reads it) **and** the crew is rostered on a work order that date. Counted once per (person, date).
- **present / absent / leave / off_rotation** — distinct (person, date) of that crew's attendance rows in those statuses, restricted to the expected member-days so a stray record cannot inflate a crew.
- **no record** — `expected − present − absent − leave − off_rotation`, floored at 0.
- **countable** — `expected − leave − off_rotation`, floored at 0.
- **rate** — `round(present × 100 / countable, 2)`, empty when `countable = 0`.
- **target** — the organisation's setting; **meets target** — empty when either side is empty, else `rate >= target`.

## Tasks

1. **Setting migration (1436).** Column, check, grant, comment naming the reverse file. Verify: `supabase/migrations/rollback/1436_attendance_target_rate_down.sql` exists and drops the column; `npm run check:migrations`.
2. **Report migration (1437).** Function + `revoke`/`grant execute` to `authenticated`; role gate and range checks in the body; return columns as above. Verify: pgTAP file below on the spare runner (`vps-pgtap.sh`).
3. **pgTAP** `supabase/tests/attendance_rate.test.sql`: fixtures (org, users, project, work orders, crews, placements, roster, attendance rows inserted with the service role/inside the test transaction), AC-ATR-001..007. Includes the cross-org read and the Engineer refusal.
4. **Types + DAL.** `database.types.ts` column and function; `src/lib/db/attendanceRate.ts`; DAL unit `attendanceRate.test.ts` for the two-step write, the ambiguity refusal and row mapping.
5. **Policy + hooks.** `policy.ts` entries; `useAttendanceRate.ts`.
6. **Admin panel.** `OrgAttendanceTarget.tsx` with `can('manage','attendanceTarget')`, number field 0–100, Save and Turn off; unit test for Admin/non-Admin.
7. **Rate view.** `AttendanceRate.tsx`, tab in `Crews.tsx` gated on target + `can('view','attendanceRate')`; default period = first of the current month to today; unit test (AC-ATR-008) with mocked hook.
8. **Strings + glossary.** en + id for both namespaces; glossary entries (canonical and the Bahasa section).
9. **Journey.** `e2e/AC-ATR-010-attendance-rate.spec.ts`, modelled on `AC-CRW-015`: seed crew, placements, roster and attendance through the service client under a unique name, set the target through `organizations`, restore it in `afterEach`; reviewer (PM) opens `/crews?view=rate`.
10. **Gates.** `npm run check:guards`, `npm run typecheck`, `npx eslint --max-warnings=0 <touched>`, `npx vitest related --run <changed source files>`; `vps-pgtap.sh feat/2706-attendance-rate supabase/tests/attendance_rate.test.sql`.

## Traceability

| AC | Owning test |
|---|---|
| AC-ATR-001 | `supabase/tests/attendance_rate.test.sql` + `pages/crews/Crews.test.tsx` + `pages/crews/AttendanceRate.test.tsx` |
| AC-ATR-002 | `supabase/tests/attendance_rate.test.sql` |
| AC-ATR-003 | `supabase/tests/attendance_rate.test.sql` |
| AC-ATR-004 | `supabase/tests/attendance_rate.test.sql` |
| AC-ATR-005 | `supabase/tests/attendance_rate.test.sql` |
| AC-ATR-006 | `supabase/tests/attendance_rate.test.sql` |
| AC-ATR-007 | `supabase/tests/attendance_rate.test.sql` |
| AC-ATR-008 | `pages/crews/AttendanceRate.test.tsx` |
| AC-ATR-009 | `pages/admin/OrgAttendanceTarget.test.tsx` + `src/lib/db/attendanceRate.test.ts` |
| AC-ATR-010 | `e2e/AC-ATR-010-attendance-rate.spec.ts` |

## Deviations recorded while building

- **AC-ATR-004 was re-cut.** The first draft asked for a crew rostered on two work orders on one day; the shipped
  exclusion constraint (1035, OD-CRW-2) forbids that. The criterion is now placement attribution across two crews,
  which is the real risk of double or missing member-days, and `expected` still de-duplicates defensively.
- **The journey is in the serial lane** (`pmo-portal/e2e/serial/AC-ATR-010-attendance-rate.spec.ts`): it sets and
  restores the organisation's target, an org-global singleton. It was not executed locally — the shared local database
  must not be reset and does not carry migrations 1436/1437 — so its first run is the release PR's `integration` job.
- **Type-check scope:** `npx vitest related --run <changed sources>` was attempted and exceeded 20 minutes under the
  parallel worker load on this machine, so the directly touched files were run instead (DAL, both panels, the Crews
  page, and the policy/permission suites they depend on).

## Build record

Migrations `1436_attendance_target_rate` (column, check, column grant) and `1437_attendance_rate_by_crew` (the read),
each with its rollback file. Migrations 1438/1439 are unused by this ticket.

Gate evidence (2026-11-21, this branch):

| Gate | Result |
|---|---|
| `npm run check:guards` | passed — i18n parity (en+id) passed, plain words 12468 strings clean, unpaged reads OK (39 allowlisted, 0 new), layout baseline none grew, migrations/ADRs/anon-definer/retention/module/ui-system self-tests green |
| `npm run typecheck` | passed (app, server, test, tooling projects) |
| `npx eslint --max-warnings=0 <changed files>` | passed, no output |
| `npx vitest run` on the touched files | `Test Files 6 passed (6)`, `Tests 209 passed (209)` — the DAL, the rate view, the Crews tab gate, the Admin panel, plus `policy.test.ts` and `usePermission.test.tsx` |
| pgTAP on the spare runner (`vps-pgtap.sh feat/2706-attendance-rate supabase/tests/attendance_rate.test.sql`) | `All tests successful. Files=1, Tests=29 ... Result: PASS` |
| Mutation check (role gate) | allowing `Engineer` in the RPC's role list reddens exactly test 25 (AC-ATR-007, "caught: no exception / wanted 42501"); restored |
