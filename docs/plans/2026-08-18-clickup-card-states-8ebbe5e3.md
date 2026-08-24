# Plan — Fix ClickUp card defect pair (issue #449)

- **Session (adw_id):** `8ebbe5e3` · **Date:** 2026-08-18
- **Repo copy:** `docs/plans/2026-08-18-clickup-card-states-8ebbe5e3.md`
- **Requirement source:** GitHub issue #449 (dispatch prompt embeds the REQUIRED clauses). No
  `docs/specs/` entry exists for #449 — ACs below are minted issue-scoped (`AC-449-n`) so the
  tests trace back. Flagged for the Director in "Open questions".
- **Scope discipline:** exactly the two named defects, in the two named files (+ their existing
  test files). No new components, no refactor, no schema/RLS change, no new deps. DESIGN.md
  tokens only (the error branch already uses them).

## 1. Problem

1. **DEFECT 1 — lists query fires on every project page even when ClickUp is disconnected.**
   `src/hooks/useIntegrations.ts` (~line 52) runs the `external-lists` query with
   `enabled: Boolean(orgId)`. With no active org binding the edge fn has no credential, fails,
   `isListsError` goes true, and `renderClickUpCard` checks `isListsError` FIRST — so every
   project page shows an integration-error card, including projects not linked at all.
2. **DEFECT 2 — raw transport text reaches the DOM.** The error branch renders
   `listsError?.message`, which for a supabase-js transport failure is the literal
   `"Failed to send a request to the Edge Function…"` — machine diagnostics shown to users.

## 2. Design (small, follows shipped patterns)

**Fix 1 lives in the hook (the query's owner), plus a defensive gate in the component.**

- **Hook:** gate the lists query on the *resolved, active* org binding:
  `enabled: Boolean(orgId) && getBinding('clickup')?.status === 'active'`.
  `getBinding` is already defined above the query in the hook, so no reordering. While bindings
  are loading the gate is closed (no premature fetch); it opens the moment the binding resolves
  `active` (e.g. right after a successful `connect` invalidates the bindings query). When the
  org disconnects, the gate closes.
- **Component:** the lists-error branch renders only when the org binding is **active**
  (`isListsError && clickupConnected`). Rationale: react-query keeps a disabled query's last
  error state, so a late/stale lists failure can still surface `isListsError: true` *after* a
  disconnect; the component must then show the quiet "Not connected" card, never an error.
- **Consumer safety check (why the hook gate is safe app-wide):** the only other consumer of
  `clickupLists`/`isListsError` is `IntegrationsView.tsx`, whose binding map is already hidden
  unless `getBinding('clickup')?.status === 'active'` (line 205/217) and which renders its own
  human copy for lists errors (line 420). Its tests mock the hook directly, so nothing changes
  for it. The existing hook test `listProjectLists returns ClickUp lists for the org` uses an
  `active` binding — it stays green and doubles as the anti-over-gating guard.

**Fix 2 follows the `classifyMutationError` house pattern (AC-ERR-002): human copy only in the
DOM; raw detail to the DEV console as diagnostics.** We do **not** call `classifyMutationError`
itself, for two reasons: (a) its default `detail` passes code-less errors through *verbatim*
(`detail = rawDetail`), so it would not even fix the transport case; (b) it fires a
`save_failed` friction event (ADR-0067) — a read failure must not pollute save-failure metrics.
The copy uses the app's established "Couldn't …" voice (`Couldn't load your projects`, etc.):
**`Couldn't reach ClickUp. Check the connection, then retry.`**

## 3. Requirements (EARS, restated from #449) and acceptance criteria

| ID | EARS | Acceptance criterion (Given/When/Then) |
|---|---|---|
| FR-449-1 | While the org's ClickUp binding status is not `active`, the system shall not issue the `external-lists` query. | **AC-449-1** — Given an org whose ClickUp binding is disconnected (or absent), when the project integrations card mounts, then `repositories.integrations.listProjectLists` is never called. |
| FR-449-2 | While the org's ClickUp binding is not active, the ProjectIntegrationsCard shall render the not-connected state and shall not render integration-error UI. | **AC-449-2** — Given ClickUp disconnected at org level and a project with no ClickUp link, when the card renders (even with a stale `isListsError: true`), then the quiet "Not connected" state is shown and no error pill / error copy / Retry button appears. |
| FR-449-3 | When the ClickUp lists query fails while the org binding is active, the card shall display human copy only and shall never render a verbatim transport error message. | **AC-449-3** — Given an active org binding and a lists failure carrying `Failed to send a request to the Edge Function…`, when the card renders, then human copy ("Couldn't reach ClickUp") is shown and the DOM contains no "Edge Function" wording. |

## 4. Traceability (ADR-0010 — one owning test per AC, lowest sufficient layer)

| AC | Owning layer | Owning test |
|---|---|---|
| AC-449-1 | Unit (hook, mocked repo) | `pmo-portal/src/hooks/useIntegrations.test.tsx` — `it('AC-449-1: …')` |
| AC-449-2 | Unit (RTL, hook mocked) | `pmo-portal/src/components/projects/__tests__/ProjectIntegrationsCard.test.tsx` — `it('AC-449-2: …')` |
| AC-449-3 | Unit (RTL, hook mocked) | same file — `it('AC-449-3: …')` |

No pgTAP (no schema/RLS change), no new e2e (pure FE gating + copy; existing integration e2e
journeys are unaffected). Both test files already exist — tests are added in-file, in style.

## 5. Tasks

All commands run from `pmo-portal/`. Inner-loop vitest is per-file (allowed inside the TDD
loop); the FULL gate before hand-off is `npm run verify:locked` (shared machine — bare
`npm run verify` is for CI only). Work on a feature branch off `dev` in a dedicated worktree.

---

### Task 1 — RED: hook tests for the fetch gate (AC-449-1)

**File:** `pmo-portal/src/hooks/useIntegrations.test.tsx`
**Change:** append two tests inside the existing top-level `describe('useIntegrations', …)`
block, after the `listProjectBindings filters out tombstoned…` test. Reuse the file's existing
`freshClient`, `wrap`, `mockBinding` fixtures — already imported.

```tsx
  // --- Issue #449: gate the ClickUp lists fetch on the ACTIVE org binding ---

  it('AC-449-1: does not fetch ClickUp lists when the org ClickUp binding is disconnected', async () => {
    integrations.listBindings.mockResolvedValue([{ ...mockBinding, status: 'disconnected' }]);

    const client = freshClient();
    const { result } = renderHook(() => useIntegrations(), { wrapper: wrap(client) });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // Flush one cycle so a wrongly-enabled query would have fired by now (the red state).
    await act(async () => { await Promise.resolve(); });

    expect(integrations.listProjectLists).not.toHaveBeenCalled();
  });

  it('AC-449-1: does not fetch ClickUp lists when the org has no bindings at all', async () => {
    integrations.listBindings.mockResolvedValue([]);

    const client = freshClient();
    const { result } = renderHook(() => useIntegrations(), { wrapper: wrap(client) });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    await act(async () => { await Promise.resolve(); });

    expect(integrations.listProjectLists).not.toHaveBeenCalled();
  });
```

Notes for the implementer: do **not** wait on `isListsPending` here — a disabled react-query v5
query never settles out of `pending`, that wait would time out. The anti-over-gating guard is
the pre-existing test above (`listProjectLists returns ClickUp lists for the org`, fixture
`status: 'active'`) which must stay green throughout.

**Verify (expect RED — both new tests fail with "expected … not to be called"):**

```bash
npx vitest run src/hooks/useIntegrations.test.tsx
```

---

### Task 2 — GREEN: gate the lists query in the hook (AC-449-1)

**File:** `pmo-portal/src/hooks/useIntegrations.ts`
**Change:** in the "Query: list ClickUp lists for the org" block (~line 51), replace
`enabled: Boolean(orgId),` with the binding-gated version, adding the explanatory comment:

```ts
  // Query: list ClickUp lists for the org
  // AC-449-1 (issue #449): gate on the ACTIVE org ClickUp binding — the external-lists edge fn
  // needs the org credential, so invoking it while no binding is active always fails and used
  // to poison every project page's integration card with a transport error. While bindings are
  // still loading the gate is closed; it opens the moment the binding resolves 'active'.
  const { data: clickupLists = [], isPending: isListsPending, isError: isListsError, error: listsError, refetch: refetchLists } = useQuery<ClickUpListItem[]>({
    queryKey: ['integrations', 'clickup-lists', orgId],
    queryFn: () => repositories.integrations.listProjectLists(orgId!),
    enabled: Boolean(orgId) && getBinding('clickup')?.status === 'active',
  });
```

`getBinding` is declared earlier in the same function (~line 45) — no reorder needed. Nothing
else in the hook changes; the returned surface (`clickupLists`, `isListsError`, …) is
unchanged, so no consumer signature drift.

**Verify (expect GREEN):**

```bash
npx vitest run src/hooks/useIntegrations.test.tsx
```

All tests in the file pass — including the pre-existing active-binding lists test.

---

### Task 3 — RED: component tests for the quiet state and human copy (AC-449-2, AC-449-3)

**File:** `pmo-portal/src/components/projects/__tests__/ProjectIntegrationsCard.test.tsx`
**Change:** append a new `describe` block as the last child of the top-level
`describe('ProjectIntegrationsCard', …)`, after the `A11y` block. Reuse `baseMockReturn`,
`mockClickUpBinding`, `wrapWithRole` — already in file.

```tsx
  describe('Issue #449: disconnected org never shows an integration error; transport text never reaches the DOM', () => {
    const transportError = new Error('Failed to send a request to the Edge Function: fetch failed');

    it("AC-449-2: unlinked project + disconnected org + stale lists error renders the quiet Not connected state, never an error card", async () => {
      vi.mocked(useIntegrations).mockReturnValue({
        ...baseMockReturn,
        getBinding: vi.fn(() => undefined), // org ClickUp NOT active
        projectBindings: [],                // project not linked
        isListsError: true,                 // a late/stale lists failure must not hijack the card
        listsError: transportError,
        refetchLists: vi.fn(),
      } as any);

      wrapWithRole('Admin', <ProjectIntegrationsCard projectId="proj-1" />);

      await waitFor(() => expect(screen.getByText('ClickUp')).toBeInTheDocument());

      // Quiet state
      expect(screen.getByText('Not connected')).toBeInTheDocument();
      // No integration-error UI of any kind
      expect(screen.queryByText('Failed to load lists')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Retry/i })).not.toBeInTheDocument();
      expect(screen.queryByText(/Edge Function/i)).not.toBeInTheDocument();
      // Not connected ⇒ no Link affordance
      expect(screen.queryByRole('button', { name: /^Link to ClickUp$/i })).not.toBeInTheDocument();
    });

    it('AC-449-3: lists failure on a connected org shows human copy, never the raw transport message', async () => {
      vi.mocked(useIntegrations).mockReturnValue({
        ...baseMockReturn,
        getBinding: vi.fn((tier: string) => (tier === 'clickup' ? mockClickUpBinding : undefined)),
        projectBindings: [],
        isListsError: true,
        listsError: transportError,
        refetchLists: vi.fn(),
      } as any);

      wrapWithRole('Admin', <ProjectIntegrationsCard projectId="proj-1" />);

      await waitFor(() => expect(screen.getByText('Failed to load lists')).toBeInTheDocument());
      // Human copy in the app's established "Couldn't …" voice
      expect(screen.getByText(/Couldn't reach ClickUp/i)).toBeInTheDocument();
      // Raw transport string never reaches the DOM
      expect(screen.queryByText(/Edge Function/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/Failed to send a request/i)).not.toBeInTheDocument();
      // Retry affordance is preserved
      expect(screen.getByRole('button', { name: /Retry/i })).toBeInTheDocument();
    });
  });
```

**Verify (expect RED):**

```bash
npx vitest run src/components/projects/__tests__/ProjectIntegrationsCard.test.tsx
```

- AC-449-2 fails today: `isListsError` is checked first, so the error card wins over
  "Not connected".
- AC-449-3 fails today: the rendered `<p>` contains the verbatim `listsError.message`
  ("Edge Function" wording present, "Couldn't reach ClickUp" absent).

---

### Task 4 — GREEN: gate the error branch on the active binding + human copy (AC-449-2, AC-449-3)

**File:** `pmo-portal/src/components/projects/ProjectIntegrationsCard.tsx`
**Change:** in `renderClickUpCard` (~line 180), replace the lists-error branch with the version
below. Two deltas: (1) the condition gains `&& clickupConnected` (`clickupConnected` is already
derived above, ~line 66); (2) the `<p>` renders fixed human copy instead of
`listsError?.message`, with the raw error logged to the DEV console only — the same
diagnostics-never-UI rule as `classifyMutationError` (AC-ERR-002). Header, StatusPill, and
Retry button are unchanged.

```tsx
  const renderClickUpCard = () => {
    // Error state for lists query — ONLY while the org binding is ACTIVE (issue #449). A
    // not-connected org renders the quiet "Not connected" card below instead: a late/stale
    // lists failure (the query is disabled when the binding is inactive, but react-query keeps
    // its last error state) must never hijack an unlinked project's card.
    if (isListsError && clickupConnected) {
      // AC-449-3: human copy ONLY. Never render `listsError.message` — supabase-js transport
      // text ("Failed to send a request to the Edge Function…") is diagnostics, not product
      // copy. Raw detail goes to the DEV console, same rule as classifyMutationError (AC-ERR-002).
      if (import.meta.env.DEV) console.debug('[clickup-lists-error]', listsError);
      return (
        <Card key="clickup" className="p-4" data-tier="clickup">
          <div className="flex items-center gap-2">
            <Icon name="plug" />
            <h3 className="text-[15px] text-foreground font-semibold">{tierLabel('clickup')}</h3>
            <StatusPill variant="neutral" className="bg-destructive/10 text-destructive">
              Failed to load lists
            </StatusPill>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <p className="text-sm text-destructive">Couldn't reach ClickUp. Check the connection, then retry.</p>
            <Button variant="outline" size="sm" onClick={() => refetchLists()}>
              <Icon name="refresh" className="size-3.55" aria-hidden="true" />
              Retry
            </Button>
          </div>
        </Card>
      );
    }
```

The `isBindingsError` branch, the normal card, and everything after it are untouched. All
classes are existing DESIGN.md tokens already used in this branch (`text-sm text-destructive`,
`mt-3 flex items-center gap-2`).

**Verify (expect GREEN):**

```bash
npx vitest run src/components/projects/__tests__/ProjectIntegrationsCard.test.tsx
```

All 20+ tests in the file pass (existing role/view/a11y coverage included — the change only
narrows the error branch).

---

### Task 5 — Adjacent-consumer sweep + full verify gate

1. Run the sibling consumer's suite (the hook gate is app-wide; its tests mock the hook so
   nothing should change, but run it to prove it):

   ```bash
   npx vitest run src/components/integrations/IntegrationsView.test.tsx
   ```

2. **Full gate (binding — the whole suite, never just touched files; shared machine ⇒ locked):**

   ```bash
   npm run verify:locked
   ```

   (= `check:migrations && check:e2e-isolation && check:edge-test-binding && typecheck &&
   typecheck:edge && lint:ci && test && build`, serialized across agents). Zero typecheck
   errors, zero lint errors/warnings, all tests green, build succeeds. If any gate is red: fix
   the code, never the test (mutation-check sanity for AC-449-3: temporarily render
   `listsError?.message` again and confirm the AC-449-3 test goes red — then revert).

**Done when:** the 3 new tests pass, `npm run verify:locked` is green end-to-end, and the
diff touches exactly 4 files (2 prod, 2 test).

## 6. Out of scope (flagged, not fixed)

- `bindingsError?.message` in the same component (line ~199) renders raw PostgREST text — same
  *class* of defect 2 but a different error source, explicitly outside the #449 scope
  instruction ("do not refactor beyond the two defects"). Recommend a follow-up issue.
- `classifyMutationError` is NOT extended with a read/transport family (its `save_failed`
  friction side effect makes it wrong for read errors — see §2).

## 7. Open questions for the Director

1. **No spec doc for #449.** This plan treats the issue prompt as the requirement source and
   mints `AC-449-1..3` issue-scoped. If you want a formal `docs/specs/` entry for defect
   tickets, say so — as written, the plan is self-contained and traceable without one.
2. Copy review: `Couldn't reach ClickUp. Check the connection, then retry.` — matches the house
   "Couldn't …" voice; shout if you want different wording before build.
