# Former-staff filter — implementation plan (#2703)

Spec: `docs/specs/former-staff-filter.spec.md`. Branch: `feat/2703-former-staff-filter` off `origin/dev`.
No migration: `people.archived_at` and the existing `people_select` policy already carry the behaviour; this is a
read-shape and screen increment.

## Files and why

| Path | Change |
|---|---|
| `pmo-portal/src/lib/db/people.ts` | `PeopleListStatus` (`active` \| `former` \| `all`) and `listPeople(status = 'active')`; select `archived_at`. Default query stays `.is('archived_at', null)`. |
| `pmo-portal/src/lib/repositories/people.ts` | Pass the status through the seam (contract already uses `typeof dal.listPeople`). |
| `pmo-portal/src/hooks/usePeople.ts` | `usePeople(status = 'active')`, query key carries the status so each view caches separately. |
| `pmo-portal/pages/admin/People.tsx` | URL-owned `staff` filter (`useUrlFilters`), `ViewToggle` segmented control, per-row status, former rows read-only, view-aware empty state, truthful archive copy. Tokens and shared primitives only. |
| `pmo-portal/public/locales/en/administration.json` | `people.staffStatus`, `active`, `former`, `all`, `formerBadge`, `formerEmpty`; archive confirmation truthful. |
| `pmo-portal/public/locales/id/administration.json` | Same keys in Bahasa Indonesia. |
| `pmo-portal/src/lib/db/__tests__/people.list.test.ts` (new) | AC-FSF-001, AC-FSF-002. |
| `pmo-portal/pages/admin/People.formerStaff.test.tsx` (new) | AC-FSF-003..008. |
| `pmo-portal/pages/admin/People.formerStaff.bahasa.test.tsx` (new) | AC-FSF-009. |
| `supabase/tests/people_former_staff.test.sql` (new) | AC-FSF-010. |
| `docs/specs/people-register.spec.md` | One sentence: archive removes a person from the active view, not the record. |
| `docs/glossary.md` | **Former staff** definition beside **People register**. |

Existing tests (`People.test.tsx`, `People.bahasa.test.tsx`, `people.test.ts`, pgTAP `people_register.test.sql`) are
not edited; the new default keeps their behaviour.

## Tasks (TDD, file order)

1. **DAL red→green** — add `people.list.test.ts` with a chain mock that records `.is` / `.not`. RED: default asks
   `archived_at is null`; former asks `archived_at not is null`; all applies neither. Implement status handling and
   `archived_at` in `COLUMNS`. Run `npx vitest related --run src/lib/db/people.ts`.
2. **Repository + hook** — pass the status through; `usePeople` signature is additive with the old default, so callers
   and mocks keep working. Typecheck.
3. **Page red→green** — `People.formerStaff.test.tsx` renders with a mocked `usePeople` that records its argument,
   asserts the default call, each choice, the pill, former-row read-only links, the former empty state and URL
   (`?staff=`). RED first, then add `ViewToggle`, status column and empty-state branch. Use `DESIGN.md` tokens via the
   shared `ViewToggle`/`StatusPill`; phone = `w-full md:w-auto` on the segment wrapper, `flex-wrap` on the toolbar.
4. **Bahasa** — add strings and `People.formerStaff.bahasa.test.tsx`; RED if a key falls back to English.
5. **Copy truth** — `archiveBody` now says the person leaves the active view and stays on record under Former staff.
6. **pgTAP** — new file: seed two orgs, one archived person each plus an active one; Admin/PM/Finance/Executive read the
   archived own-org row (2 rows total incl. active), Engineer reads none unless linked, second-org Admin reads none.
   `plan()` count must match. Run on the spare VPS: `docs/private/vps-pgtap.sh feat/2703-former-staff-filter
   supabase/tests/people_former_staff.test.sql`.
7. **Docs** — spec, this plan, the one-line update to `people-register.spec.md`, glossary term.

## Gates (each result line goes in the report)
- `npm run check:guards`
- `npm run typecheck`
- `npx eslint --max-warnings=0` on every changed `.ts`/`.tsx`
- `npx vitest related --run` on every changed source file
- `docs/private/vps-pgtap.sh feat/2703-former-staff-filter supabase/tests/people_former_staff.test.sql`
- `scripts/ux-proof.sh /administration/people` against a running dev server (no DB change), if the local app serves.

## Traceability (one owning layer per AC)

| AC | Owning test | Layer |
|---|---|---|
| AC-FSF-001 | `people.list.test.ts` default status | Unit |
| AC-FSF-002 | `people.list.test.ts` former/all | Unit |
| AC-FSF-003 | `People.formerStaff.test.tsx` default + choices | Unit (RTL) |
| AC-FSF-004 | `People.formerStaff.test.tsx` former choice + pill | Unit (RTL) |
| AC-FSF-005 | `People.formerStaff.test.tsx` all + statuses | Unit (RTL) |
| AC-FSF-006 | `People.formerStaff.test.tsx` read-only former row | Unit (RTL) |
| AC-FSF-007 | `People.formerStaff.test.tsx` former empty | Unit (RTL) |
| AC-FSF-008 | `People.formerStaff.test.tsx` URL | Unit (RTL) |
| AC-FSF-009 | `People.formerStaff.bahasa.test.tsx` | Unit (RTL) |
| AC-FSF-010 | `people_former_staff.test.sql` | Integration (pgTAP) |
