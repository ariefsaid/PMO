# Crew Tools Register Implementation Plan (#2581)

> Fresh Orca worker per slice. Spec: `docs/specs/crew-tools-register.spec.md`. Blocked by #2528 landing on `dev` (crew master, `0988_crews_roster.sql`: `crews`, `crew_members`, `work_order_crews`, `guard_crew_refs()`, `crew_can_manage()`). No money path. Sign OD-CTR and answer OQ-CTR first.

## Design summary
A small register of counted hand tools per crew, with a one-call report that reduces usable quantity, creates a replacement task for the equipment coordinator and notifies them. Reuses: `crews` (#2528), `tasks` (0001, project optional per 0199), `notifications` (0048), a new `crew_tool_report_files` table plus private bucket `crew-tool-files`, copied from `0036_procurement_record_files.sql` and the `0028` storage policies, `org_crew_tool_settings` (one row per organisation, like `material_request_settings`), `record_history_config` (0260), `stamp_org_id`, `can()` and the role matrix. Not reused, with reasons in the spec: `equipment_assets` (usage, costing, availability), `stock_items` and the stock ledger (warehouse issue/receipt).

## Migrations (numbers assigned by the Director; each with a rollback file; RLS plus force RLS; `stamp_org_id`)
- Migration A: `crew_tool_lines` (org_id, crew_id, name, code, serial, held_qty int >= 1, note, archived_at, created_by; partial unique index on (org_id, lower(serial)) where live; check serial implies qty 1; record history config). Rollback: drop table.
- Migration B: `crew_tool_reports` (org_id, line_id, kind damaged|lost, qty, note, status open|closed, resolution, task_id, client_key unique per org, reported_by, reported_on, closed_by, closed_at) and `crew_tool_report_files` (id, org_id, report_id, title, file_path, uploaded_by_id, created_at, archived_at; force RLS; org stamp from the report) with the `crew-tool-files` bucket and its storage read/write policies. Rollback: drop both tables, the policies and the bucket.
- Migration C: `org_crew_tool_settings(org_id pk, coordinator_id, task_due_days, updated_by, updated_at)`; RPCs `report_crew_tool` (security definer; checks crew ownership, usable quantity, photo rule; inserts report, task, notification in one transaction; idempotent on client key), `close_crew_tool_report`, and a usable-quantity view. Rollback: drop functions, view, settings table.
- Archive guard: `create or replace public.guard_crew_refs()` copying the #2528 body verbatim and adding the `crew_tool_lines` `exists` to the `CRW_ARCHIVE_IN_USE` condition of the `crews` branch (FR-CTR-005). Re-read the function on `dev` first; do not edit without #2528 landed.

## Files
- Create: `pmo-portal/src/lib/crewToolQuantity.ts` + `src/lib/__tests__/crewToolQuantity.test.ts`; `src/lib/db/crewTools.ts`; `src/lib/repositories/crewTools.ts`; `pmo-portal/pages/CrewTools.tsx` (or a tab on the crew page); `pmo-portal/e2e/AC-CTR-012-report-damaged-tool.spec.ts`; `supabase/tests/crew_tools.test.sql`.
- Modify: `pmo-portal/src/auth/policy.ts` (+ `policy.test.ts`) adding entity `crewTool` (view, manage, report, close, configure; roles in FR-CTR-016); settings page for the coordinator; i18n files for en and id; the crew page route.

## Slice 1 — pure quantity rules (Orca)
- [ ] Failing test first: the hammer example (AC-CTR-001, AC-CTR-011) in `crewToolQuantity.test.ts`. `npx vitest run src/lib/__tests__/crewToolQuantity.test.ts`.
- [ ] Implement held / damaged / lost / usable and the overdue flag; whole numbers only.

## Slice 2 — database (Orca)
- [ ] Write `supabase/tests/crew_tools.test.sql` first: AC-CTR-001..010. Run chained: `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/crew_tools.test.sql'`.
- [ ] Migrations A to C and RPCs. Mutation check: remove the field-controller ownership test and the usable-quantity test in turn; AC-CTR-008 and AC-CTR-001 must go red; restore.
- [ ] DAL, repository, `policy.ts` actions, role-matrix registration, `policy.test.ts`.

## Slice 3 — screen (ui-implementer; `restructure`)
- [ ] Crew tools screen: lines with held/damaged/lost/usable, add and move lines, report sheet (kind, quantity, photo, note), open reports with overdue flag; phone first; en + id.
- [ ] Coordinator setting; E2E `AC-CTR-012-report-damaged-tool.spec.ts` via `scripts/e2e-local.sh AC-CTR-012`.

## Traceability
| AC | Layer | Test file |
|---|---|---|
| AC-CTR-001 | Unit + pgTAP | `crewToolQuantity.test.ts`, `crew_tools.test.sql` |
| AC-CTR-002..010 | pgTAP | `crew_tools.test.sql` |
| AC-CTR-011 | Unit | `crewToolQuantity.test.ts` |
| AC-CTR-012 | E2E | `e2e/AC-CTR-012-report-damaged-tool.spec.ts` |

## ADR candidate
Why hand tools are a separate light register rather than a kind of equipment asset or stock item (OD-CTR-1). Write only if the owner confirms.

## Final gate
`npm run check:guards`, `npm run typecheck`, `npx eslint --max-warnings=0 <touched>`, touched vitest, touched pgTAP, touched e2e; `scripts/ux-proof.sh` on the touched route.
