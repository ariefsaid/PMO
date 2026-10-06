# Record history tab — UI plan (#719, spec D5)

Spec: `docs/specs/record-change-history.spec.md` (D5, FR-CHG-010/011/012, AC-CHG-015..019). Data layer shipped in #872
(migration `0260`, `list_record_history` invoker RPC). **No migration, no write UI, no `org_id` from the client.**

## Decisions
- **Repository seam (ADR-0017):** DAL `src/lib/db/recordChanges.ts` (one `supabase.rpc('list_record_history')`) → repository
  `src/lib/repositories/recordHistory.ts` (`recordHistoryRepository.list`, also wired as `repositories.recordHistory`) →
  hook `src/hooks/useRecordHistory.ts` (`useInfiniteQuery`, org-scoped key, cursor = the page's minimum `seq` + earliest `created_at` of the change rows — never the last row's, since rows come back by `created_at` and `seq` can disagree).
  A full page of change rows (`>= limit`) means "load older" exists.
- **Field kinds client-side:** `record_history_config` has no client grant, so `src/components/history/historyFields.ts`
  mirrors the registry's captured `col → kind` per entity type. Labels: `history.field.<col>` with humanized fallback; a column the record's own form/rail already names reuses that key.
- **Locale file:** the app ships one namespace (`common.json`, en + id); keys live under `history.*` there (the handoff's
  rule), not a new `history.json`.
- **Values:** money `formatCurrency(v, event.currency)`; date `formatDateOnly`; timestamp `formatDateTime`; number `formatNumber`;
  enum / closed-set values through the module label helpers (`useProjectStatusLabel`, `useProcurementStageLabel` +
  `stageLabelForStatus`, `classificationValueLabel`, `budgetCategoryLabel`, `useTaxTreatmentOptions`, and the task /
  work-order / budget-version / company-type keys); ref resolved from the cached org profiles / companies lists (archived
  companies by id) and, on the project History, the project's tasks / milestones / procurements lists, else "Unavailable";
  a ref with no cheap source (`project_id`, `budget_version_id`, `meeting_id`, `invoice_id`) → "<label> changed"; empty → "empty".
  Child events on the project History name their record (`Task · <name>`, procurement linked).
  Flagged `{changed:true}` → "<label> changed", no values. `archived_at` → "Archived" / "Restored". Actor null → "System";
  unresolvable → "Unknown user".
- **Placement:** project → `History` tab (`/projects/:id/history`), child roll-up on, kind filter All / Project / Budget /
  Work orders / Procurement / Tasks. Procurement → `History` tab (its own events only: the data layer files PR/RFQ/PO/payment events under the project,
  so they show on the project History; a procurement roll-up needs a data-layer change, filed separately). Company + contact →
  collapsed `Card` section at the end (fetches only when opened). Budget versions/lines, work orders and tasks have no record
  page of their own; their history is the project tab's kind filters (Q7).

## Tasks (commit per group)
1. Plan (this file).
2. Data + repository + hook — `src/lib/db/recordChanges.ts`, `src/lib/repositories/{recordHistory.ts,types.ts,index.ts}`,
   `src/hooks/useRecordHistory.ts`. Test: `src/lib/repositories/__tests__/recordHistory.test.ts` (**AC-CHG-017**: mapping,
   cursor, admin audit lines pass through / none when the RPC returns none).
3. Component — `src/components/history/{RecordHistory.tsx,HistorySection.tsx,historyFields.ts}` + en/id `history.*`.
   Test: `src/components/history/__tests__/RecordHistory.test.tsx` (**AC-CHG-015** formatting en/id, **AC-CHG-016**
   loading/empty/error+retry/load older).
4. Pages — `ProjectDetail.tsx` (`TAB_VALUES` + tab), `ProcurementDetails.tsx` (`ProcTab`), `CompanyDetail.tsx`,
   `ContactDetail.tsx`. Tests: `pages/project-detail/__tests__/ProjectDetail.history.test.tsx`,
   `pages/__tests__/ProcurementDetails.history.test.tsx` (**AC-CHG-018**).
5. e2e — `e2e/AC-CHG-019-project-change-history.spec.ts` (`@e2e-isolation: self-isolated` — creates its own project, edits
   client + end date, archives it at the end; `waitForFonts` before the 390px no-overflow measure).

## AC traceability (UI scope; AC-CHG-001..014, 020, 021 are the merged pgTAP proofs)
| AC | Owner |
|---|---|
| AC-CHG-015, 016 | `src/components/history/__tests__/RecordHistory.test.tsx` |
| AC-CHG-017 | `src/lib/repositories/__tests__/recordHistory.test.ts` |
| AC-CHG-018 | `ProjectDetail.history.test.tsx`, `ProcurementDetails.history.test.tsx` |
| AC-CHG-019 | `e2e/AC-CHG-019-project-change-history.spec.ts` |
