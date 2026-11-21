# Plan — cleared-for-site checklist (#2707)

Spec: `docs/specs/cleared-for-site-checklist.spec.md`. Migrations 1235-1239 only; rollbacks in `supabase/migrations/rollback/`.

## Database
| File | Content |
|---|---|
| `1235_clearance_items.sql` | `clearance_items` (org_id stamp trigger, name, is_required, sort_order, archived_at, live-name unique index); RLS read Admin/PM/Finance/Executive, write Admin; `(select helper())` wrapping; revoke-then-grant |
| `1236_person_clearances.sql` | `person_clearances` (person_id, item_id, done_on, expires_on, note, updated_by/at; unique person+item; same-org guard trigger; expiry>=done check); RLS read the four roles, write Admin/PM |
| `1237_person_clearance_status.sql` | `person_clearance_items(p_person)` per-item state and `person_clearance_summary()` per-person cleared; both SECURITY INVOKER (RLS applies), search_path pinned, today from `field_org_today` |
| `1238_clearance_manifest.sql` | only if the isolation guard needs rows (else unused, number released) |
| `1239` | reserved, unused unless needed |
Rollbacks: `rollback/1235..1237_*_down.sql` (refuse to drop tables holding rows).

## Frontend (`pmo-portal/`)
- `src/lib/db/clearance.ts` + `src/lib/repositories/clearance.ts` (no `org_id` sent); hooks via useQuery.
- `src/auth/policy.ts`: add `clearanceItem` (Admin manage) and `personClearance` (Admin/PM edit, four-role view).
- `pages/administration/Clearance.tsx` (items + people list) and `pages/administration/PersonClearance.tsx` (checklist); routes in `App.tsx`; shared form primitives, `ConfirmDialog`, DESIGN.md tokens; strings in en + id locale files.
- Evidence: `docs/evidence/1215/2707/` phone 390 and desktop 1440 screenshots per screen.
- Glossary: add "Cleared for site", "Clearance item".

## Tests per AC
AC-CLR-001..007 `supabase/tests/2707_cleared_for_site.test.sql` (+ mutation run); 008 `src/lib/repositories/__tests__/clearance.test.ts`, `src/auth/policy` test; 009/010 `pages/administration/__tests__/PersonClearance.test.tsx` + bahasa test; 011 `e2e/AC-CLR-011-cleared-for-site.spec.ts`; 012 existing suites untouched. Also isolation-denominator guard self-test and run.

## Settings added
None (default = unchanged behaviour). Roster blocking left out.

## Open questions
1. Entry point: a new "Clearance" tab under Administration is an additive nav entry on an existing screen. OK, or reach only by direct route and a link from the person record?
2. Cleared when no required items exist: spec says false. Confirm.
3. PM may record states (not define items); confirm, since people edit is also Admin+PM.
