# Crew Tools Register Implementation Plan (#2581)

> Fresh Orca worker per slice. Spec: `docs/specs/crew-tools-register.spec.md`. Blocked by the crew master of #2528 (`crews`). No money path. Sign OD-CTR and answer OQ-CTR first.

## Design summary
A small register of counted hand tools per crew, with a one-call report that reduces usable quantity, creates a replacement task for the equipment coordinator and notifies them. Reuses: `crews` (#2528), `tasks` (0001, project optional per 0199), `notifications` (0048), the shared private attachment mechanism used for downtime and site-report photos (Task 1 confirms its table and bucket names by reading `supabase/migrations`), `record_history_config` (0260), `stamp_org_id`, `can()` and the role matrix. Not reused, with reasons in the spec: `equipment_assets` (usage, costing, availability), `stock_items` and the stock ledger (warehouse issue/receipt).

## Migrations (numbers assigned by the Director; each with a rollback file; RLS plus force RLS; `stamp_org_id`)
- Migration A: `crew_tool_lines` (org_id, crew_id, name, code, serial, held_qty int >= 1, note, archived_at, created_by; partial unique index on (org_id, lower(serial)) where live; check serial implies qty 1; record history config). Rollback: drop table.
- Migration B: `crew_tool_reports` (org_id, line_id, kind damaged|lost, qty, note, status open|closed, resolution, task_id, client_key unique per org, reported_by, reported_on, closed_by, closed_at) and `crew_tool_report_photos` (report id, attachment id). Rollback: drop both.
- Migration C: org setting for equipment coordinator user and task due days; RPCs `report_crew_tool` (security definer; checks crew ownership, usable quantity, photo rule; inserts report, task, notification in one transaction; idempotent on client key), `close_crew_tool_report`, and a usable-quantity view. Rollback: drop functions, view, setting columns.
- Archive guard extends the crew archive check (FR-CRW-002) in the crew migration owner's trigger; note the dependency, do not edit it blind.

## Files
- Create: `pmo-portal/src/lib/crewToolQuantity.ts` + `src/lib/__tests__/crewToolQuantity.test.ts`; `src/lib/db/crewTools.ts`; `src/lib/repositories/crewTools.ts`; `pmo-portal/pages/CrewTools.tsx` (or a tab on the crew page); `pmo-portal/e2e/AC-CTR-012-report-damaged-tool.spec.ts`; `supabase/tests/crew_tools.test.sql`.
- Modify: `pmo-portal/src/auth/policy.ts` (+ `policy.test.ts`) for `crewTool` actions; settings page for the coordinator; i18n files for en and id; the crew page route.

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
