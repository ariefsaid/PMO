# Plan — `withTimeout` adoption: closing the UI-freeze class in FE mutation hooks

> **Context:** this session found a UI-freeze class — a `useMutation` whose `isPending`/`loading` state
> gates a `ConfirmDialog`'s Cancel/Esc/scrim-close and its confirm button disables for as long as
> `mutationFn`'s awaited promise is pending. The Supabase client (`src/lib/supabase/client.ts`) is
> created with no request timeout, so an RPC/`.from().select()`/edge-function `invoke()` that never
> settles (stalled connection, hung server, dropped response) freezes the dialog **forever**, with the
> user unable even to Cancel. `uploadTransport.ts`'s XHR `timeoutMs` (harden #5) already fixed this for
> file uploads; this plan is the same fix generalized.
>
> **The dispatch/adapter path is owned elsewhere — DO NOT TOUCH.** Another agent is fixing the specific
> ERPNext adapter-dispatch hang (`src/lib/adapterSeam/dispatchClient.ts`, `src/lib/db/budgets.ts`,
> `src/lib/budget/budgetPushConsequence.ts`, and the ADR-0056/0058/0059 adapter-dispatch path generally).
> This plan's util (`src/lib/withTimeout.ts`) is the GENERAL safety net for every OTHER mutation. Any
> hook whose write can route through `dispatchDomainCommand`/`dispatchTaskCommand` (companies,
> procurement, revenue, tasks, timesheet-push, budgets) is **excluded** below and left for that lane to
> resolve — a second independent timeout racing an in-flight commit/retry it doesn't know about could
> cause more harm than the freeze itself (e.g. reporting "timed out" over a write that actually landed).

## 0. What's already built (this issue's deliverable)

- **`src/lib/withTimeout.ts`** — `withTimeout<T>(promise: Promise<T>, ms: number, onTimeoutError?: string | (() => Error)): Promise<T>`.
  Races `promise` against a `ms` deadline timer (`setTimeout`/`clearTimeout`, no `AbortController` —
  it does not cancel the underlying call, only stops the caller waiting on it). On timeout, rejects
  with `new AppError(message, REQUEST_TIMEOUT_CODE)` by default (`REQUEST_TIMEOUT_CODE = 'REQUEST_TIMEOUT'`,
  exported), or the caller's own `onTimeoutError` message/factory. `DEFAULT_MUTATION_TIMEOUT_MS = 15_000`
  is the suggested default deadline for a plain repository-seam RPC.
- **`classifyMutationError.ts`** gained one case: `'REQUEST_TIMEOUT' → "Request timed out — try again."`
  — so every existing call site (`classifyMutationError(err)` in a mutation's `catch`) renders a
  `withTimeout` rejection as an ordinary recoverable toast, unchanged otherwise.
- **Tests:** `src/lib/withTimeout.test.ts` (resolves-before-deadline passes through; rejects-before-deadline
  passes the original error through unchanged; never-resolving rejects with the classified `AppError`
  after `ms`; custom message/factory overrides; timer is cleared on early settle) +
  a `classifyMutationError.test.ts` case for `REQUEST_TIMEOUT`.
- **2 reference adoptions** (see §3): `useUserViewMutations` (`src/hooks/useUserViews.ts`) and
  `useIncidentMutations` (`src/hooks/useIncidents.ts`) — both plain repository-seam CRUD, non-money,
  no adapter-dispatch involvement, so `withTimeout` was trivially safe to wire in as the pattern example.
  Each hook's test file gained one "hung repository call rejects with a timeout" case (fake timers,
  a `mockReturnValue(new Promise(() => {}))` mutation, `vi.advanceTimersByTimeAsync(15_000)`).

## 1. Method

`grep -rn "useMutation(\|mutationFn"` over `src/` + `pages/` found every mutation hook. For each, traced
whether its `mutationFn` ultimately calls a repository method that can route through
`routeDomainWrite(...)==='external'` → `dispatchDomainCommand` (or `routeTaskWrite` →
`dispatchTaskCommand` for tasks, one layer down in `src/lib/db/tasks.ts`) — the live map, read directly
from `src/lib/repositories/index.ts`:

| Domain (repository key) | Dispatches externally? |
|---|---|
| `company` (create/update) | **yes** — `routeDomainWrite('companies')` |
| `procurement` | **yes** — `routeDomainWrite('procurement')` (every method except `transition`, which is PMO-derived) |
| `revenue` | **yes** — `routeDomainWrite('revenue')` |
| `timesheet.pushApproved` | **yes** — `routeDomainWrite('timesheets')`. Reached from `useTimesheetApproval`'s `approve` (awaited inline via `pushAfterApprove`) and `usePushesNeedingAttention`'s `retry` (direct call). The rest of the timesheet-transition surface (`submit`/`reject`/`reopen`/`reopenApproved`/`attestNoErpDocument`/`confirmEmployeeLink`) is pure PMO, no dispatch. |
| `task` (via `src/lib/db/tasks.ts`) | **yes** — `routeTaskWrite(...)` → `dispatchTaskCommand`, all of create/update/updateStatus/archive/unarchive/delete |
| `budget` / anything in `db/budgets.ts`, `budgetPushConsequence.ts` | excluded per brief (owned elsewhere) |
| everything else (`project`, `document`, `incident`, `milestone`, `contact`, `userView`, `profile`, `procurementFiles`, `orgFeature`, `credits`, `integrations`) | **no** — plain Supabase RPC/`invoke()`, no adapter-dispatch |

## 2. The enumerated hooks

### 2a. Adopt now (repository-seam only, no dispatch — freeze risk, safe to wrap)

| Hook (file) | Mutations | Freeze risk | Adopt `withTimeout`? |
|---|---|---|---|
| `useUserViewMutations` (`src/hooks/useUserViews.ts`) | create/update/archive/delete | Yes | **Done** (reference adoption, §3) |
| `useIncidentMutations` (`src/hooks/useIncidents.ts`) | create/update/transition/delete | Yes | **Done** (reference adoption, §3) |
| `useCompanyMutations` archive/delete only (`src/hooks/useCompanies.ts`) — create/update EXCLUDED (dispatch) | archive/delete | Yes | Should adopt (archive/delete never dispatch — only create/update carry `isExternal` push state) |
| `useContactMutations` (`src/hooks/useContacts.ts`) | create/update/archive/delete + CRM activity create/update/delete | Yes | Should adopt |
| `useDocumentMutations` (`src/hooks/useDocuments.ts`) | create/update/transition/delete | Yes | Should adopt |
| `useMilestoneMutations` (`src/hooks/useMilestones.ts`) | create/update/delete/setTaskMilestone | Yes | Should adopt |
| `useProjectMutations` (`src/hooks/useProjects.ts`) | create/updateHeader/archive/delete/setContractValue | Yes | Should adopt |
| `useUserMutations` (`src/hooks/useUsers.ts`) | updateUserRole/assignManager/inviteUser/setUserStatus | Yes (invite goes through an edge fn — `admin-invite-user`) | Should adopt |
| `useRevisionMutations` (`src/hooks/useRevision.ts`) | create revision | Yes | Should adopt |
| `useTimesheetEntryMutations` (`src/hooks/useTimesheetEntries.ts`) | save week / delete entry | Yes | Should adopt |
| `useTimesheetApproval`'s `submit`/`reject`/`reopen`/`reopenApproved`/`attestNoErpDocument` (`src/hooks/useTimesheetApproval.ts`) — `approve` EXCLUDED (see §2b) | 5 mutations | Yes | Should adopt |
| `useEmployeeLinkConfirm`'s `confirm` (`src/hooks/useTimesheetApproval.ts`, a separate exported hook in the same file — `confirmEmployeeLink` is a plain DB write in `src/lib/db/timesheetPush.ts`, no dispatch) | confirm | Yes | Should adopt |
| `useIntegrations` connect/disconnect/link/unlink/setCompany (`src/hooks/useIntegrations.ts`) | 5 mutations | Yes, and likely the highest-latency case (an external ClickUp/ERPNext OAuth/ping round trip) — needs a **longer** deadline than `DEFAULT_MUTATION_TIMEOUT_MS` (suggest 30–45s) | Should adopt, with a larger `ms` |
| `useProcurementFileMutations` archive only (`src/hooks/useProcurementFiles.ts`) — upload already timeout-guarded by `uploadTransport.ts` | archive | Yes | Should adopt for archive; the upload mutation's `prepareUpload`/`confirmUpload` legs (surrounding the already-timeout-guarded XHR transport) are a freeze risk too but need care not to double-wrap the transport call itself — see §4 |
| `useFileUpload` upload/replace (`src/hooks/useFileUpload.ts`) | upload/replace | Partial — same `prepareUpload`/`confirmUpload` gap as above | Should adopt for the `prepareUpload`/`confirmUpload` legs only, not the XHR transport call |
| `pages/AdministrationFeatures.tsx` (`toggleMutation`) | org-feature toggle | Yes | Should adopt |
| `pages/AdministrationCredits.tsx` (`grantMutation`) | credits grant | Yes | Should adopt |

### 2b. Excluded — routes through the adapter-dispatch path (owned elsewhere, do not touch here)

| Hook (file) | Why excluded |
|---|---|
| `useCompanyMutations` create/update (`src/hooks/useCompanies.ts`) | `routeDomainWrite('companies')==='external'` → `dispatchDomainCommand` |
| `useTaskMutations` (`src/hooks/useTasks.ts`) | every method routes through `src/lib/db/tasks.ts` → `routeTaskWrite`/`dispatchTaskCommand` |
| `useMyTasks` status-update mutation (`src/hooks/useMyTasks.ts`) | calls the SAME `updateTaskStatus` in `src/lib/db/tasks.ts` as above |
| `useProcurementCrud*` (`src/hooks/useProcurementCrud.ts`) | `routeDomainWrite('procurement')==='external'` |
| `useProcurementMutations` (`src/hooks/useProcurementDetail.ts`) | same |
| `useProcurementRecordMutations` (`src/hooks/useProcurementRecords.ts`) | same |
| `useRevenue` sales-invoice / incoming-payment mutations (`src/hooks/useRevenue.ts`) | `routeDomainWrite('revenue')==='external'` |
| `useTimesheetApproval`'s `approve` (`src/hooks/useTimesheetApproval.ts`) | its `mutationFn` `await`s `pushAfterApprove(id)`, which calls `repositories.timesheet.pushApproved` — `routeDomainWrite('timesheets')==='external'` → dispatch. The docstring notes the push failure is swallowed (approval never rolls back on ERP failure), but a HANG (not a rejection) still hangs the outer `await` — that's this exact dispatch-owner's fix to make, not this plan's. The other 5 mutations in the same file, plus `usePushesNeedingAttention`'s `retry` (also `pushApproved` directly) and `useEmployeeLinkConfirm`'s `confirm` (NOT dispatch — see §2a), are unaffected. |
| `usePushesNeedingAttention`'s `retry` (`src/hooks/useTimesheetApproval.ts`) | calls `repositories.timesheet.pushApproved` directly — same dispatch path as `approve` above |
| `useBudget*` (`src/hooks/useBudget.ts`) | imports `src/lib/db/budgets.ts` directly (explicitly excluded file) |
| `pages/BudgetProjection.tsx` (etc/retry-push/release-hold mutations) | budget domain, imports `budgetPushConsequence`-adjacent modules |
| `pages/admin/BudgetAccountMap.tsx` | budget domain |

### 2c. Already protected (no action needed)

| Hook (file) | Why safe already |
|---|---|
| `useFileUpload` / `useProcurementFiles` — the XHR transport leg only | `uploadWithProgress` (`src/lib/uploadTransport.ts`) already has its own `timeoutMs` (harden #5) |

## 3. Reference adoptions (done in this issue)

`useUserViewMutations` and `useIncidentMutations` were chosen because they are (a) plain
repository-seam CRUD with zero adapter-dispatch involvement, (b) non-money, and (c) already follow the
`classifyMutationError` convention at their call sites, so the change is a pure drop-in:

```ts
// before
mutationFn: (id: string) => repositories.userView.delete(id),

// after
mutationFn: (id: string) =>
  withTimeout(repositories.userView.delete(id), DEFAULT_MUTATION_TIMEOUT_MS),
```

No call-site (`pages/*.tsx`) changes were needed — `classifyMutationError(err)` already handles the new
`REQUEST_TIMEOUT` code, and `ConfirmDialog`'s `loading` prop is still driven by the same
`mutation.isPending`.

## 4. Sequencing for the rest of §2a (owner to prioritize / assign)

Suggested order — highest freeze-frequency first, independent 2–5 min tasks per hook:

1. `useCompanyMutations` archive/delete, `useContacts`, `useDocuments`, `useMilestones`, `useProjects`,
   `useUsers` — highest-traffic CRUD surfaces (Companies/Contacts/Documents/Projects pages are used
   every session).
2. `useTimesheetApproval`'s 5 non-dispatch mutations + `useEmployeeLinkConfirm`'s `confirm` — approval-queue actions are exactly the "disabled button
   in a confirm dialog" freeze pattern this issue targets.
3. `useRevision`, `useTimesheetEntries`, `pages/AdministrationFeatures.tsx`, `pages/AdministrationCredits.tsx`
   — lower traffic, same mechanical change.
4. `useIntegrations` — needs its own longer deadline (30–45s; an OAuth/ping round trip legitimately
   takes longer than a DB RPC) rather than `DEFAULT_MUTATION_TIMEOUT_MS`. Size the deadline with
   whoever owns the ClickUp/ERPNext connect flow before wiring it in.
5. `useFileUpload` / `useProcurementFiles` `prepareUpload`/`confirmUpload` legs — needs a small
   surgical change (wrap only the two RPC legs, never the `uploadWithProgress` XHR call, which
   intentionally allows longer for big files and already times out on its own).

Each task: add `withTimeout(repositories.X.method(...), DEFAULT_MUTATION_TIMEOUT_MS)` around the
`mutationFn` body, add one "hung call times out" test per hook test file (fake timers +
`mockReturnValue(new Promise(() => {}))`, mirroring §3's example), run `npm run verify`.

## 5. Non-goals of this plan

- Does **not** touch `src/lib/adapterSeam/dispatchClient.ts`, `src/lib/db/budgets.ts`,
  `src/lib/budget/budgetPushConsequence.ts`, or any of §2b — that hang is a different, coordinated fix
  (idempotency-key-aware, retry-aware) and a generic client-side race could report a false "timed out"
  over a write that actually committed.
- Does **not** centralize the timeout inside `src/lib/repositories/index.ts`'s shared `wrap()` helper —
  that function is shared by every domain including the dispatch ones in §2b, so a blanket change there
  would re-introduce the exact collision this plan avoids. Per-hook `withTimeout` at the `mutationFn`
  call site keeps the two lanes independent.
- Does **not** change any UI copy/behavior beyond the new "Request timed out — try again." toast headline
  for the timeout case specifically.
