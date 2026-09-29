# Execute RIS Admin route × state matrix (#688)

**Authority:** `docs/specs/ris-admin-route-matrix.spec.md`; the detailed source-level design in `docs/plans/2026-09-28-ris-admin-route-matrix.md`, including Design decisions D1–D7 and Appendix B's settled rulings.  
**Scope:** Execute canonical Tasks 1–13 and 15 only. Task 14 (rendered Discover) and Task 16 (final gates/reviews) belong to the Director. No migration, RLS, dependency, lockfile, ADR, route-table, or configuration change is permitted.

## Settled design and implementation constraints

- The tests close the matrix cells at their lowest sufficient layer: RTL/Vitest for Credits, tax-write pending, and project-create navigation; Playwright for responsive/axe/journey proof. New e2e files must have the specified `@e2e-isolation` class, a leading AC id in every test title, one `test()` per AC, no CI-environment gate, and use `scripts/e2e-local.sh` rather than raw Playwright for DB-backed runs.
- Shared M365 entitlement/status fixtures belong in `pmo-portal/e2e/helpers.ts`; they intercept a page-scoped `org_features` read and mocked `functions/v1/m365-token-custody` response, so read-only specs neither mutate the shared seed nor depend on an edge-function server.
- `AC-RAM-004` is a non-negotiable WCAG 2 A/AA axe oracle over settled populated surfaces. If it finds any violation, stop after Task 10; record `rule id · route · theme · target` for the Director. Do not suppress a rule, change tags, skip a surface, or weaken an assertion. Only a Director-admitted token-level or single-file fix may proceed; a broader fix is a separate issue.
- The only planned production-source change is `pmo-portal/pages/Projects.tsx` in Task 11b: after successful `/projects` creation, use the returned `ProjectRow.id` to navigate to `/projects/:id`. The repository contract already returns `Promise<ProjectRow>` (`pmo-portal/src/lib/repositories/types.ts`), so no DAL/repository change is needed. Failed creates retain the modal and do not navigate.
- The previously open F-4 decision is settled: creation opens the canonical record, following the Meetings precedent. Therefore the AC-RAM-001 journey deliberately goes directly from create success to `/projects/:id`, then uses **Back to Sales Pipeline**; it must not retain the obsolete detour that opens the card from `/sales` first.
- Every new proof whose behavior already exists needs a mutation red check: make the stated temporary mutation, observe the owning test fail, restore only that file, then rerun green. Never modify an existing assertion to make behavior pass. Do not regenerate `package-lock.json`.

## File map

| File | Exact change |
|---|---|
| `pmo-portal/e2e/helpers.ts` | Export M365 entitlement and unavailable-status read fixtures. |
| `pmo-portal/e2e/AC-M365SEP-018-integrations-route.spec.ts` | Replace its local entitlement helper with the shared export. |
| `pmo-portal/pages/__tests__/AdministrationCredits.states.test.tsx` | New AC-RAM-002 loading/error/retry unit proof. |
| `pmo-portal/pages/admin/OrgTaxDefault.test.tsx` | Add AC-RAM-005 pending-write disabled-control proof. |
| `pmo-portal/e2e/AC-MOBILE-OVERFLOW-001-no-horizontal-bleed.spec.ts` | Add entitled personal-integrations and pipeline-lens rows to the existing two-width sweep. |
| `pmo-portal/e2e/AC-RAM-004-ris-admin-axe.spec.ts` | New read-only nine-surface × light/dark axe gate. |
| `pmo-portal/pages/__tests__/Projects.createNavigation.test.tsx` | New AC-RAM-006 create success/failure unit proof using the existing Projects test mocks. |
| `pmo-portal/pages/Projects.tsx` | Navigate to the newly returned row after successful create (Task 11b only). |
| `pmo-portal/e2e/AC-RAM-001-ris-admin-first-project.spec.ts` | New self-isolated first-project cross-stack journey. |
| `docs/qa-portfolio.md` | Matrix pointer plus only Director-confirmed Discover graduation rows. |

## Implementation tasks

### 1. Add the shared M365 read-only fixtures (AC-RAM-003/004 support)

Append these exports to `pmo-portal/e2e/helpers.ts` (the file already imports `Page`):

```ts
export async function grantM365EntitlementFixture(page: Page): Promise<void> {
  await page.route('**/rest/v1/org_features*', async (route) => {
    const response = await route.fetch();
    if (!response.ok()) return route.fulfill({ response });
    const rows = (await response.json()) as Array<{ feature_key?: string; enabled?: boolean }>;
    await route.fulfill({
      response,
      json: [
        ...rows.filter((row) => row.feature_key !== 'm365_integration'),
        { feature_key: 'm365_integration', enabled: true },
      ],
    });
  });
}

export async function stubM365StatusUnavailable(page: Page): Promise<void> {
  const headers = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*',
    'access-control-allow-methods': 'POST, OPTIONS',
  };
  await page.route('**/functions/v1/m365-token-custody', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers });
      return;
    }
    await route.fulfill({
      status: 500,
      headers,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'INTERNAL_ERROR', message: 'stubbed' }),
    });
  });
}
```

**Verify:** `cd pmo-portal && npx eslint e2e/helpers.ts --max-warnings=0 && npm run typecheck`.

### 2. Deduplicate AC-M365SEP-018’s entitlement fixture

In `pmo-portal/e2e/AC-M365SEP-018-integrations-route.spec.ts`, remove `Page` and the local `useEntitledM365Fixture`; import `grantM365EntitlementFixture` with `login` from `./helpers`; replace its one call before callback navigation. Preserve all five existing journey assertions and its read-only tag.

**Verify:** `cd pmo-portal && npx eslint e2e/AC-M365SEP-018-integrations-route.spec.ts --max-warnings=0`; then `scripts/e2e-local.sh --project=chromium AC-M365SEP-018` from repo root.

### 3. Write AC-RAM-002 Credits state tests first

Create `pmo-portal/pages/__tests__/AdministrationCredits.states.test.tsx`. Mock `repositories.credits.getOrgBalance` and `grant`, render `<AdministrationCredits isOperator={false} orgId="org-1" />` inside a fresh retry-disabled `QueryClientProvider`, `MemoryRouter`, and `ToastProvider`, and reset both mocks in `beforeEach`.

Add exactly these owning cases:

1. `AC-RAM-002: while the balance loads, a busy skeleton shows and no balance figure is claimed`: make `getOrgBalance` never resolve; assert `liststate-loading[aria-busy="true"]` and no `org-credit-balance`.
2. `AC-RAM-002: a failed balance read shows an error with Retry, and Retry re-reads to the balance`: reject once, then resolve `120`; assert **Couldn't load balance**, no balance figure, activate Retry, then assert `org-credit-balance` includes `120 credits` and the read mock was called twice.

**Verify:** `cd pmo-portal && npx vitest run pages/__tests__/AdministrationCredits.states.test.tsx`.

### 4. Bind AC-RAM-002 with two mutation red checks

Temporarily remove `onRetry={() => void balanceQuery.refetch()}` from the error `ListState` in `pmo-portal/pages/AdministrationCredits.tsx`; Task 3’s retry case must fail. Restore it. Then temporarily replace `{balanceQuery.isPending && (` with `{false && (`; the loading case must fail. Restore it. Rerun the Task 3 command after each restore; both tests must pass. If either mutation stays green, stop and strengthen the test before continuing.

### 5. Write AC-RAM-005’s pending-write test first

Append to the existing `OrgTaxDefault` describe in `pmo-portal/pages/admin/OrgTaxDefault.test.tsx`:

```tsx
it('AC-RAM-005: while the new default is being written, the control is disabled so a second change cannot race it', async () => {
  let finishWrite: () => void = () => {};
  setTaxDefault.mockReturnValue(new Promise<void>((resolve) => { finishWrite = resolve; }));
  renderPanel('Admin');
  await waitFor(() => expect(select().value).toBe('exclusive'));
  await userEvent.selectOptions(select(), 'inclusive');
  await waitFor(() => expect(select()).toBeDisabled());
  finishWrite();
  await waitFor(() => expect(select()).toBeEnabled());
});
```

**Verify:** `cd pmo-portal && npx vitest run pages/admin/OrgTaxDefault.test.tsx`.

### 6. Bind AC-RAM-005 with its mutation red check

Temporarily delete `disabled={mutation.isPending}` from `pmo-portal/pages/admin/OrgTaxDefault.tsx`. Run `cd pmo-portal && npx vitest run pages/admin/OrgTaxDefault.test.tsx -t "AC-RAM-005"`; it must fail. Restore the exact prop and rerun green. A passing mutant means stop and fix the test.

### 7. Extend the canonical phone no-bleed sweep (AC-RAM-003)

In `pmo-portal/e2e/AC-MOBILE-OVERFLOW-001-no-horizontal-bleed.spec.ts`:

- Import `Locator`, `grantM365EntitlementFixture`, and `stubM365StatusUnavailable`.
- Define `PIPELINE_LENS = '40000000-0000-0000-0000-000000000011'`.
- Expand each `ROUTES` item’s type with optional `prepare?: (page: Page) => Promise<void>` and `ready?: (page: Page) => Locator`.
- Add `/projects/${PIPELINE_LENS}` labelled `project-pipeline-lens (AC-RAM-003)`, whose ready locator is `getByLabel('Project stage journey')`.
- Add `/integrations` labelled `personal-integrations (AC-RAM-003)`, whose prepare calls both shared helpers and whose ready locator is `getByTestId('m365-connection-card')`.
- Between sign-in and the existing settle/measurement assertions, call `await route.prepare?.(page)`, navigate, then require `route.ready(page)` visible at 20 seconds when defined. This prevents an empty-shell axe/overflow false pass.

**Verify:** `cd pmo-portal && npx eslint e2e/AC-MOBILE-OVERFLOW-001-no-horizontal-bleed.spec.ts --max-warnings=0`.

### 8. Run and mutation-bind the AC-RAM-003 rows

Run `scripts/e2e-local.sh --project=chromium AC-MOBILE-OVERFLOW-001 -g "AC-RAM-003"`; expect four cases (two routes × 390/360). Mutate the Integrations card wrapper from `max-w-xl` to `w-[640px]`; the personal-integrations cases must report bleeders, then restore. Separately delete the `/integrations` entry’s `prepare` field; its `ready` assertion must fail because the entitled card is absent, then restore. Finally run `scripts/e2e-local.sh --project=chromium AC-MOBILE-OVERFLOW-001` green.

### 9. Write the AC-RAM-004 light/dark axe gate

Create `pmo-portal/e2e/AC-RAM-004-ris-admin-axe.spec.ts` with the read-only isolation header. Import Playwright `test`, `expect`, `Page`, `Locator`, `AxeBuilder`, and the sign-in/M365 helpers. Define the seed Admin, pipeline id `40000000-0000-0000-0000-000000000011`, delivery id `41000000-0000-0000-0000-000000000001`, and a typed `Surface { label; path; ready; prepare? }` list covering exactly:

1. `/administration/users` → searchbox **Search users**;
2. `/administration/integrations` → H2 **Organization integrations**;
3. `/administration/accounting` → `#budget-account-map`;
4. `/administration/credits` → `org-credit-balance`;
5. `/integrations` with both fixtures → `m365-unknown-msg`;
6. `/projects` → seeded Meridian title;
7. `/sales` → seeded Highfield title;
8. pipeline project → **Project stage journey**;
9. delivery overview → Meridian heading.

For each `light` and `dark` theme and each surface, create one test titled `AC-RAM-004 <label> @<theme> passes axe-core (WCAG-AA)`: set 1280×800, sign in, install fixture before navigation, set localStorage `theme`, navigate, assert the expected `<html>` dark class state and visible populated ready locator, wait for network idle (catch timeout), and assert `new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze().violations` is empty. The failure message must include violation id/node targets, route, and theme.

**Verify:** `cd pmo-portal && npx eslint e2e/AC-RAM-004-ris-admin-axe.spec.ts --max-warnings=0 && cd .. && scripts/check-e2e-isolation.sh`.

### 10. Run AC-RAM-004 and apply its stop rule

Run `scripts/e2e-local.sh --project=chromium AC-RAM-004`; expect 18 cases. If any case fails, stop here and hand the Director the complete `rule id · route · theme · target` list. Do not proceed to Task 11 or make an unapproved fix.

### 11. Bind AC-RAM-004 with a contrast mutation

Temporarily change the personal-integrations description in `pmo-portal/pages/Integrations.tsx` from `text-muted-foreground` to `text-muted-foreground/30`. Run `scripts/e2e-local.sh --project=chromium AC-RAM-004 -g "personal-integrations"`; both themes must fail with `color-contrast`. Restore the source and rerun two passing cases. A green mutant is a stop-and-rewrite condition.

### 11b. TDD AC-RAM-006: open the newly created project

Create `pmo-portal/pages/__tests__/Projects.createNavigation.test.tsx` by using the same real-Projects render/mocking seam as `pmo-portal/pages/Projects.test.tsx`: mock `useProjects`, auth/impersonation, task/delivery/transition hooks, and `react-router`’s `useNavigate`; render Projects in `MemoryRouter` with `ToastProvider`. Give the create mutation a resolved row `{ id: 'p-new', name: 'New project', status: 'Leads' }`.

Write two cases before production code:

- `AC-RAM-006: a successful create names the project and opens its record`: open **New project**, fill a valid name and selected client, submit, assert the status toast contains the submitted name and `navigate` was called with `/projects/p-new`.
- `AC-RAM-006: a failed create stays on /projects with the modal open`: reject the create mock, submit valid input, assert the dialog remains visible and `navigate` was not called.

Run `cd pmo-portal && npx vitest run pages/__tests__/Projects.createNavigation.test.tsx`; the success case must be red against current source. Then change only `pmo-portal/pages/Projects.tsx`’s `createModal.onSubmit` to save `const row = await create.mutateAsync(input)`, toast using `input.name`, close the modal, and call `navigate(\`/projects/${row.id}\`)` after the successful mutation. Do not catch the error there: `ProjectFormModal.onError` retains failed-create behavior. Rerun green. If the mutation result does not have `id`, stop rather than changing the repository contract.

### 12. Write the self-isolated AC-RAM-001 first-project journey

Create `pmo-portal/e2e/AC-RAM-001-ris-admin-first-project.spec.ts` with `// @e2e-isolation: self-isolated` explaining its unique-name service-role cleanup. Import Playwright, `createClient`, and `signIn`, `pickComboboxOption`, `requireServiceRoleKey` from helpers. Use seed Admin and org ids, prefix `E2E RAM-001 `, local-only Supabase URL validation, and `beforeEach`/`afterEach` deletion scoped to the seed org and `like('${prefix}%')`; throw for cleanup errors. Do not add a CI gate.

Add exactly one `test()` with leading title `AC-RAM-001: a RIS Admin goes from organization setup to a first project, opens its record, and returns to the list that holds it`:

1. At desktop, sign in; use Administration → Organization integrations and assert its route and H2.
2. Use the primary rail to Projects; wait for the Projects loading state to settle.
3. Open **New project**, create a unique `E2E RAM-001 ${Date.now()}` project using the real client-company combobox helper.
4. Assert the dialog closes and the success status names that project.
5. **Deliberate AC-RAM-006 step:** assert the app immediately reaches `/projects/<uuid>` (no Sales detour), its heading has the project name, and the pipeline lens exposes **Project stage journey**.
6. Activate **Back to Sales Pipeline**, assert `/sales`, and assert its first matching project text is visible.

Set a 120-second test timeout. This preserves the AC’s goal oracles while using the settled direct-open decision.

**Verify:** `cd pmo-portal && npx eslint e2e/AC-RAM-001-ris-admin-first-project.spec.ts --max-warnings=0 && cd .. && scripts/check-e2e-isolation.sh`.

### 13. Flake- and mutation-bind AC-RAM-001

Run `scripts/e2e-local.sh --project=chromium AC-RAM-001 --repeat-each=3`; all three must pass. Mutate `pmo-portal/pages/project-detail/PipelineLens.tsx` from `href="/sales"` to `href="/projects"`; the final `/sales` URL oracle must fail, then restore. Mutate the `Projects.tsx` create toast’s detail argument from `input.name` to `''`; the success-name oracle must fail, then restore. Run the repeat-three command again green. Report all mutation outcomes to the Director.

### 15. Record the QA portfolio pointer and only graduated Discover findings

In `docs/qa-portfolio.md`, insert immediately after the **Administration IA cells** paragraph this pointer:

```md
**RIS Admin setup-to-first-project cells (#688):** the route × oracle matrix for `/administration/users`,
`/administration/integrations`, `/administration/accounting`, `/administration/credits`, `/integrations`,
`/projects`, `/sales` and `/projects/:id` — with the deciding test per cell and the code-proof vs
live-RIS-proof split — lives in `docs/specs/ris-admin-route-matrix.spec.md`. Re-derive a cell from its
cited test, never from this pointer.
```

After receiving the Director’s Task 14 confirmation table, append the corresponding exact five-cell rows from canonical plan Task 15 for every confirmed F-1 through F-6, and omit every unconfirmed finding. In particular, F-4’s row must reflect the settled AC-RAM-006 direct-record ruling, not claim that it remains pending. Do not conduct or fabricate the rendered pass.

**Verify:** `grep -n "ris-admin-route-matrix" docs/qa-portfolio.md`; inspect every newly appended table row has five cells.

## Traceability and handback

| AC | Owning proof | Tasks |
|---|---|---|
| AC-RAM-001 | `e2e/AC-RAM-001-ris-admin-first-project.spec.ts` single curated self-isolated journey | 12–13 |
| AC-RAM-002 | `pages/__tests__/AdministrationCredits.states.test.tsx` | 3–4 |
| AC-RAM-003 | labelled rows in `e2e/AC-MOBILE-OVERFLOW-001-no-horizontal-bleed.spec.ts` | 1–2, 7–8 |
| AC-RAM-004 | `e2e/AC-RAM-004-ris-admin-axe.spec.ts` 18 cases | 1, 9–11 |
| AC-RAM-005 | `pages/admin/OrgTaxDefault.test.tsx` pending-write case | 5–6 |
| AC-RAM-006 | `pages/__tests__/Projects.createNavigation.test.tsx` success/failure cases | 11b |

Do not run the Director-owned rendered Discover pass, reviews, or final gate. Hand back: changed-file list; the red/green result of Tasks 4, 6, 8, 11, and 13; AC-RAM-004’s full failure list if its stop rule fired; and the Task 14 confirmation inputs used for conditional Task 15 rows.
