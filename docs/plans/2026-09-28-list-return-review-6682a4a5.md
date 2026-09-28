# Plan: review fixes for the shared list-return seam (#681)

**Scope:** repair only the shared seam introduced by the commit "Add the shared list working-set and record-return seam (#681)". Do not adopt it in `pmo-portal/pages/**` (that remains #682/#683), add dependencies, regenerate `package-lock.json`, change routes, or add an ADR. The existing URL/return design remains valid; this is a correctness, type-safety, and test-quality follow-up.

> **Correction (review round 2, 2026-09-28).** Tasks 5–9 below originally said a Sales source is "always allowed" for a Projects owner and that the mount replace canonicalizes the whole URL. Both contradict the spec (decisions 1 and 3, FR-LRC-004/006) and were fixed: reading return context is **owner-only** (a project's BackBar/breadcrumb goes to `/projects`; only its Sales Pipeline link reads Sales context, via `listReturnNavigation(state, 'sales')`), and the Sales→Projects allowance survives only in `openRecord`'s capture check (`canCaptureFromList`). The hook's only unprompted write is materializing a nondefault session view when the URL has no `view`, gated on `ready` and keeping router state; no other key is canonicalized.

## Design

- Keep six explicit codecs, but place their parser/serializer pairs in one typed `LIST_WORKING_SET_SCHEMAS` table keyed by `ListName`. The public parse/serialize APIs remain generic, while each schema owns its own concrete working-set type. Parsers validate URL input; serializers trust their typed working set and only omit/default-encode values.
- Add `useListWorkingSet` as the small React Router adapter over `parseListWorkingSet`/`serializeListWorkingSet`/`materializeSessionView`. It returns the effective value plus a typed setter, replaces rather than pushes edits, retains unrelated search keys, and performs one mount-time replace only when the URL has no `view` and a valid persisted nondefault view needs materializing (once `ready`).
- Make `listReturnContext.ts` the sole source for safe local paths, owner/source eligibility, owning index lookup, and the return navigation descriptor. A descriptor has the validated list path plus state containing only unrelated state and the optional one-shot scroll restore; it never carries `pmoListReturn` onto the returned list entry. Both `useListReturn.returnToList` and the App breadcrumb consume that descriptor and use a push navigation.
- Preserve the canonical detail target constraint: `openRecord` accepts only `/module/:id` (with an optional query), not tab/deep paths such as `/procurement/:id/approvals`. A rejected target returns `false` and emits a development-only warning.
- Keep the current scroll design: native Back uses the source entry; explicit return puts restore state on the newly pushed list entry; restoration waits for `ready`, then runs on the next timer tick exactly once and clamps to the rendered range.

## Tasks

1. **Document the corrected vocabulary.**
   - Edit `docs/specs/list-working-set-return.spec.md` only. In the Sales Pipeline row, state that only `scope=Lost` conflicts with an open funnel `status`; `Needs attention` and an open stage intersect. In the Procurement row, state that `group:Ordered` represents the broad Ordered segment, whereas group Vendor Invoiced and Paid use their plain `status=<value>` tokens because their group/exact result sets are identical.
   - Verify: `git diff --check -- docs/specs/list-working-set-return.spec.md`.

2. **Red: extend the pure codec contract before refactoring it.**
   - Update `pmo-portal/src/lib/listWorkingSet.test.ts` to replace the obsolete storage-reader test with typed codec cases, retaining equivalent persisted-view behavior for the new hook task rather than deleting coverage. Prefix every test that proves a list-working-set AC with `AC-LRC-001/002:`.
   - Add typed (no `Record<string, string>` casts) tests that: preserve `Needs attention` with `status=Leads`; force Open only for Lost plus an open stage; reject invalid Sales scope, stage, and view; round-trip `statusMode: 'group'` for `Ordered`, `ProcurementStatus.VendorInvoiced`, and `ProcurementStatus.Paid`; reject `group:bogus`; round-trip Contacts and Meetings identifiers/search; and reject control-character client/PM/company/project identifiers while retaining unrelated keys.
   - Change the existing lifecycle-drill loop to derive its values from `Object.values(ProcurementStatus)`, so a future enum member is exercised rather than silently omitted. Keep the expected exact behavior for statuses whose group semantics differ.
   - Verify the test is red before production changes: `cd pmo-portal && npx vitest run src/lib/listWorkingSet.test.ts`.

3. **Green: make the codec table-driven and canonical-type based.**
   - Update `pmo-portal/components/salesPipeline.ts` to export the literal open-funnel stage tuple/type used by `SALES_COLUMNS`; use `satisfies` to keep the tuple literal rather than widening it.
   - Refactor `pmo-portal/src/lib/listWorkingSet.ts` to import `ProjectView`, `PipelineView`, and `ProcurementView` from `src/hooks/useProjectView.ts`, `src/hooks/usePipelineView.ts`, and `src/hooks/useProcurementView.ts`; import `ProcurementStatus` from `pmo-portal/types.ts`; and import the Sales stage type/tuple from `components/salesPipeline.ts`. Remove the copied view/lifecycle/stage unions, `LIST_VIEW_STORAGE_KEY`, and `readListViewPreference`.
   - Replace both six-arm switches and their `as ListWorkingSetByName[K]` casts with one `LIST_WORKING_SET_SCHEMAS` table containing six explicit, type-checked parse/serialize pairs. Keep parser validation in `enumValue`/identifier handling, but have serializers write their already-typed fields directly (no serializer-side enum revalidation). Build lifecycle status coverage from `Object.values(ProcurementStatus)` and use `satisfies` on literal filter arrays.
   - Serialize `group:Ordered` only for grouped Ordered. Serialize grouped Vendor Invoiced/Paid as their plain values and parse those plain values as the semantically equivalent segment mode; preserve exact lifecycle drill links for statuses whose result set differs from a group. Rerun `cd pmo-portal && npx vitest run src/lib/listWorkingSet.test.ts` and require green.

4. **Red: specify the shared URL writer at the router boundary.**
   - Create `pmo-portal/src/hooks/useListWorkingSet.test.tsx` with a small BrowserRouter/MemoryRouter harness and a location/history probe. Give AC-owning titles the leading `AC-LRC-001:` or `AC-LRC-002:` token.
   - Prove that three setter calls for search/filter/view use replacements (the browser entry index does not grow); that an unrelated `campaign` key survives; and that mounting a Projects working set with `readProjectView()` returning `calendar` replaces a URL lacking `view` exactly once, without a replace loop. Also prove an explicit URL view wins over the session fallback.
   - Verify the new test is red: `cd pmo-portal && npx vitest run src/hooks/useListWorkingSet.test.tsx`.

5. **Green: add the thin typed URL hook.**
   - Create `pmo-portal/src/hooks/useListWorkingSet.ts`. Its generic `useListWorkingSet(list, options)` must call `resolveListWorkingSet` using a caller-supplied session view (the adopting pages will pass `readProjectView()`, `readPipelineView()`, or `readProcurementView()`), return `{ workingSet, setWorkingSet }`, and use `useLocation`/`useNavigate` to replace only this list’s owned keys while preserving every unrelated key.
   - Use an effect guarded by the canonical serialized search so a nondefault effective session view is materialized once; do not change history on an already canonical URL. Keep it independent of page code and do not write session storage here.
   - Rerun `cd pmo-portal && npx vitest run src/hooks/useListWorkingSet.test.tsx` and require green.

6. **Red: pin the shared return-navigation contract.**
   - Update `pmo-portal/src/lib/listReturnContext.test.ts`. Prefix the rejection parameter-table title and its cases with `AC-LRC-010:`; prefix scroll-return-state cases with `AC-LRC-005:`.
   - Replace the option-based Sales test with a proof that return context is read only from the record's owning list (a Sales source never resolves for a Projects owner), that `listReturnNavigation(state, 'sales')` yields the captured Sales URL, and that only the capture rule allows Sales to open a Projects record. Add tests for exported `listIndexPath`, the exported common local-path sanitizer (external/protocol-relative/hash/backslash/control-character paths reject), and the explicit return descriptor: valid context emits the list path and `pmoListScrollRestore` but no `pmoListReturn`; absent/tampered context emits the owner index with neither seam key while preserving unrelated state.
   - Verify red: `cd pmo-portal && npx vitest run src/lib/listReturnContext.test.ts`.

7. **Green: centralize safe paths and explicit-return state.**
   - Refactor `pmo-portal/src/lib/listReturnContext.ts` to export `listIndexPath(list)`, the capture-only rule `canCaptureFromList(source, owner)`, and one `safeLocalPath(value)` helper used by list-context validation and record-target validation. Remove `ListReturnContextOptions` and the `allowSalesForProject` option; `readListReturnContext` accepts only a context whose list equals the owner.
   - Add an exported return-navigation resolver (for an owner, and for a recognized detail pathname) returning `{ path, state }`. It must call `readListReturnContext`, fall back through `listIndexPath`, retain unrelated state, delete both `LIST_RETURN_CONTEXT_KEY` and stale restore state, and add a validated one-shot restore only when an offset exists. Make `withListScrollRestore` perform that stripping as well.
   - Rerun `cd pmo-portal && npx vitest run src/lib/listReturnContext.test.ts` and require green.

8. **Red: make hook timing and target rejection observable.**
   - Update `pmo-portal/src/hooks/useListReturn.test.tsx`; convert all `setTimeout(..., 10)` negative/timing assertions to `vi.useFakeTimers()` plus `act(() => vi.advanceTimersByTime(0))` (or the exact scheduled tick), and restore real timers in cleanup.
   - Add a leading `AC-LRC-005:` test that keeps `ready=false`, advances the restore tick, and proves scroll remains zero; then sets `ready=true`, advances the tick, and proves the clamped offset restores. This test must fail if `!ready ||` is removed from the effect guard.
   - Add leading `AC-LRC-009:` browser-history tests proving explicit return pushes a new entry, a subsequent browser Back reaches the detail entry, restore state is carried, and the returned list state has no `pmoListReturn`. Add leading `AC-LRC-010:` tests for a control-character id and a tab target rejection, with a `console.warn` spy in development.
   - Add a Sales fixture proving `useListReturn({ list: 'sales' }).openRecord('/projects/project-1', 'projects')` captures Sales context, `returnToList('projects')` returns to `/projects`, and `returnToList('sales')` returns to the captured Sales URL. Keep direct Company fallback coverage. Verify red: `cd pmo-portal && npx vitest run src/hooks/useListReturn.test.tsx`.

9. **Green: route every explicit return through the seam.**
   - Update `pmo-portal/src/hooks/useListReturn.ts` to consume `canCaptureFromList`, `safeLocalPath`, `listIndexPath`, and the return-navigation resolver from `listReturnContext.ts`; delete the duplicate `safeRecordTarget` local-path checks and the `allowSalesForProject` option. Validate canonical record path after the shared sanitizer.
   - Change `returnToList` to navigate with `{ state }` and no `replace`, using the same resolver that the breadcrumb will use. Replace the anonymous fallback IIFE with a named state-cleanup helper. Document on `openRecord` that only canonical `/module/:id` paths are accepted and tab paths are intentionally rejected; in development, warn when validation rejects the target.
   - Rerun `cd pmo-portal && npx vitest run src/hooks/useListReturn.test.tsx` and require green.

10. **Red: test the rendered shell breadcrumb return path/state boundary.**
   - Update `pmo-portal/src/components/shell/__tests__/routeMatch.test.ts` and `pmo-portal/src/components/shell/__tests__/AppShell.test.tsx`. Add an AppShell-level MemoryRouter harness that renders `ContextBar`/the parent breadcrumb from detail `location.state`, invokes the breadcrumb, and exposes destination path/state.
   - Give the tests leading `AC-LRC-005:`/`AC-LRC-010:` titles. Assert a valid Companies context navigates to `/companies?...` with scroll-restore state and no `pmoListReturn`; assert a tampered Companies context navigates to `/companies` with no restore context. Retain the canonical Projects breadcrumb assertion and add the navigation-state assertion to it.
   - Verify red: `cd pmo-portal && npx vitest run src/components/shell/__tests__/routeMatch.test.ts src/components/shell/__tests__/AppShell.test.tsx`.

11. **Green: thread typed return state through App and route matching.**
   - Update `pmo-portal/src/components/shell/routeMatch.ts` so its breadcrumb navigation callback accepts a path plus optional router state, and its contextual parent argument is the shared return-navigation descriptor rather than a bare path. Its parent crumb must forward both values.
   - Update `pmo-portal/App.tsx` to obtain the contextual descriptor from `listReturnContext.ts` and pass a callback that calls React Router `navigate(path, { state })`; this is the same shared resolver used by `useListReturn`, so desktop breadcrumb and mobile BackBar push identical clean return entries.
   - Rerun `cd pmo-portal && npx vitest run src/components/shell/__tests__/routeMatch.test.ts src/components/shell/__tests__/AppShell.test.tsx` and require green.

12. **Run the required whole-slice gates without changing unrelated files.**
   - Confirm only the planned seam, shell, canonical type export, spec, and test files changed; specifically confirm no `pmo-portal/pages/**` file and no `package-lock.json` change: `git diff --name-only`.
   - From `pmo-portal/`, run `npm run typecheck`, `npm run lint:ci`, `npm test`, and `npm run test:coverage`. Inspect changed-file coverage and require at least 80% lines for each changed source file.
   - Run the binding full gate under the shared-machine lock: `cd pmo-portal && npm run verify:locked`.

## Traceability

| Acceptance criterion | Owning/review proof in this slice |
|---|---|
| AC-LRC-001 | `src/lib/listWorkingSet.test.ts`; `src/hooks/useListWorkingSet.test.tsx` verifies replacement URL writing. |
| AC-LRC-002 | `src/lib/listWorkingSet.test.ts`; `src/hooks/useListWorkingSet.test.tsx` verifies URL precedence and session-view materialization. |
| AC-LRC-005 | `src/lib/listReturnContext.test.ts`, `src/hooks/useListReturn.test.tsx`, and rendered `src/components/shell/__tests__/AppShell.test.tsx` checks. |
| AC-LRC-009 | `src/hooks/useListReturn.test.tsx` explicit-push/native-Back checks. |
| AC-LRC-010 | `src/lib/listReturnContext.test.ts`, `src/hooks/useListReturn.test.tsx`, and rendered breadcrumb fallback check. |

The browser owners for AC-LRC-003/004/006/007/008 and their page adoption remain #682/#683; this plan neither changes nor weakens those proofs.
