# Report: flaky "status filter narrows the list (Paid only)" (#1129)

Branch `fix/1129-procurement-filter-test`. Tests only; no app code changed.

## Cause

The Status picker writes the filter to the address (`useUrlFilters.setFilter` -> `setSearchParams`), and the list
reads it back from the location (`useListWorkingSet` parses `location.search`; `Procurement.tsx` filters on that).
`MemoryRouter` (react-router 8) commits every location change inside `React.startTransition`
(`lib/components.js`, `useTransitions` defaults on). So after `await pickOption(...)` returns, the filtered list is
not guaranteed to be on screen: the new location commits as a low-priority transition. The test asserted the
absence of the old row at once (`queryByText(...).not.toBeInTheDocument()`), before that commit.

Evidence:
- Reproduced on unchanged code under load (4 copies of the file at once, 4 cores): 1 failure in 32 runs, always this
  test, assertion at line 335, `Workstations & AV` still present at 303 ms.
- With the assertion wrapped in `waitFor` (default 1 s) a second load round still failed once in 32: the address was
  still `?tab=all&view=grouped` after 1 s, i.e. the transition had not committed in that time.
- Measured timing on the same test under the same load (40 runs): address commit 2-7 ms after the pick returned,
  rows gone 5-10 ms later. So the commit is normally immediate; the failures are rare stalls of a starved worker,
  longer than a retry window can be trusted to cover.
- Alone: 30/30 pass. `pickOption` itself is fine (click, click option, no wait for the outcome).

Is it the app? No defect found. A person's browser commits the same transition in a few milliseconds
(the measured case) and the old rows stay visible only for the render that replaces them. I could not produce a
1 s+ stall in a real browser; the long stall only appeared in a starved jsdom worker. 89ff3dced did not change this
path (it changed a count prop and the block's page state; the failing test uses the grouped view, which it does
not touch). The test was already racy; the extra render weight from recent changes only makes the stall more likely.
This last point is inference, not measured on the parent commit.

## Fix (tests only; no assertion weakened or deleted, no timeout raised)

1. The `MemoryRouter` in the page tests now has `useTransitions={false}`, so an address change commits inside the
   click's own `act`, and `await pickOption` returns with the list already updated. This removes the wait instead of
   guessing how long it takes.
2. Where a test judges the outcome of a filter pick, the same assertion is now awaited (`waitFor` / `findBy`):
   - `pages/Procurement.test.tsx`: "status filter narrows the list" and "filter round-trips through the URL".
   - `pages/Procurement.floor.test.tsx`: the six filter tests (category, project, supplier, raised by, phone disclosure).
   - `pages/Procurement.restructure.test.tsx`: grouped Status filter.
   - `src/components/ui/__tests__/FilterBar.test.tsx`: the address after picking Project.
   - `pages/procurement/list/__tests__/ProcurementBlock.window.test.tsx` (came with 89ff3dced): Next/Previous, paging
     twice (the second click now waits for page 2's button), and search-from-page-2. Same transition race.
Not changed: `Procurement.test.tsx` "AC-LRC-001" (asserts only rows that are present before and after the pick).

## Results (`npx vitest run pages/Procurement.test.tsx`)

| Setup | Before | After |
|---|---|---|
| Alone, 30 runs | 0 failed | not repeated (alone was already clean) |
| 4 copies at once, 4 cores | 1 / 32 failed (first round); 1 / 32 with `waitFor` only | 0 / 32 and 0 / 32 (64 runs) |

Also green: the 5 changed files together (77 tests). `npm run typecheck` clean; `eslint --max-warnings=0` clean on
the changed files. With a ~3% failure rate, 64 clean runs is encouraging, not a proof; CI's next runs are the check.
