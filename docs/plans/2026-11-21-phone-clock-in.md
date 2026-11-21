# Plan: clock in by phone at the work location (#2705)

Spec: `docs/specs/phone-clock-in.spec.md`. Branch `feat/2705-phone-clock-in` (stacked on #2710). Test-first; the orchestrator runs the database.

## Migrations (range 1210-1214, rollbacks in `supabase/migrations/rollback/<n>_<slug>_down.sql`)
| # | File | Content |
|---|---|---|
| 1210 | `1210_phone_clock_in_area.sql` | `work_orders.area_lat/area_lng/area_radius_m` + all-or-none check; `organizations.phone_check_in_supervisor_role` (FK `built_in_roles(key)`, NULL default); Admin-only setting RPC `set_phone_check_in_supervisor_role(text)`. |
| 1211 | `1211_phone_clock_in_table.sql` | `phone_check_ins` (org_id stamped, work_order, worker, requester profile, crew, work_date, lat/lng/accuracy/distance, outcome, status recorded/pending/approved/rejected, decided_by/at/reason, attendance_day_id); RLS read-only (person, crew controller, Admin; `(select ...)` wrapped), no write grants; indexes. |
| 1212 | `1212_phone_clock_in_rpc.sql` | `geo_distance_m(lat1,lng1,lat2,lng2)` immutable haversine; `phone_check_in(...)` definer (no `assert_not_light`); `attendance_record` re-created with one extra allowance: a `phone_check_in` row for another person is accepted only when a request in status `approving` for that worker/work order/date, decided by the caller, exists (rollback restores the 1110 body). |
| 1213 | `1213_phone_clock_in_decide.sql` | `phone_check_in_eligible_supervisor(request)`, `phone_check_in_decide(id, approve, reason)` (guards: not light, not requester, same org, eligible, pending once), `phone_check_in_requests()` list. |
| 1214 | `1214_phone_clock_in_audit_grants.sql` | grants/revokes (authenticated execute only), audit entries via `log_audit`, helper indexes. |

Inventory: `supabase/tests/inventory/anon-executable-definers/2705-phone-clock-in.txt`; `scripts/isolation-probe-denominator.d/2705-phone-clock-in.json`.

## Tests first
- pgTAP `supabase/tests/2705_phone_clock_in.test.sql` (AC-PCI-001..012), mutation note per rule inline.
- vitest: `pmo-portal/test/phoneClockInHeaders.test.ts` (AC-PCI-013), `pmo-portal/src/lib/repositories/phoneCheckIn.test.ts`, `pmo-portal/src/components/my/ClockInSection.location.test.tsx` (AC-PCI-014), `pmo-portal/src/components/attendance/CheckInRequests.test.tsx` (AC-PCI-015).
- E2E `pmo-portal/e2e/AC-PCI-E2E-phone-clock-in.spec.ts` (written, not run; mocked geolocation via context permissions).

## Frontend
- `public/_headers`: `/my` rule (section 5 of the spec).
- `src/lib/repositories/phoneCheckIn.ts` (new standalone module), `src/hooks/usePhoneCheckIn.ts`, `src/lib/readPosition.ts` (single `getCurrentPosition` wrapper, timeout 15s).
- `ClockInSection`: where the work order has an area (added to `my_home` payload by 1212 as `area_radius_m` presence only, no coordinates), read position on tap, call `phone_check_in`; crew chooser; denied/unavailable shows message and request action. Without area: today's code path untouched.
- Decision list `CheckInRequests` on the existing Attendance screen, rendering nothing when empty. Area fields on the work-order edit form (only shown to who can edit).
- Locales `myHome` and attendance namespace, English and Bahasa. `docs/glossary.md`: work-order area, check-in request.

## Gates (static only)
`npm run check:guards`, `npm run typecheck`, `npx eslint --max-warnings=0 <changed>`, vitest on the new files and affected directories.
