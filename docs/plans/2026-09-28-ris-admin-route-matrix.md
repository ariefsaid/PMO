# RIS Admin route × oracle matrix — design + implementation plan (#688)

**Spec:** `docs/specs/ris-admin-route-matrix.spec.md` (AC-RAM-001..005, matrix R1–R8 × O1–O12).
**Goal:** Prove, one lowest-layer test per outcome, the state, action, and return path of every screen on
the RIS Admin route from setup to first project. The issue adds only the tests that close unproved cells
and **one** curated cross-stack journey, and it records confirmed rendered findings. It changes no app
behavior.
**Executor tier:** a bounded tests-and-docs slice, so it goes to the SSSF ADW (`--builder fe_builder
--reviewer fe_reviewer`). It is not a money, auth, or SoD change.
**Tech:** Vitest + RTL (unit), Playwright + `@axe-core/playwright` (e2e), existing `e2e/helpers.ts`.

## Design (brainstormed decisions, one at a time)

**D1 — Where the matrix lives.** The matrix lives in the spec, which is the single source. The plan adds
one pointer paragraph to `docs/qa-portfolio.md`. No per-route table is copied into the portfolio, so the
two documents cannot drift apart.

**D2 — What "red first" means for proof tests.** Most new tests describe behavior that already ships, so
they are expected to pass on arrival. Their red step is a **mutation check**: break the exact line the test
claims to prove, watch the test fail, then revert. A test that stays green under the mutation does not bind
to shipped code and must be rewritten. This repeats the repository's dead-oracle lesson; it is not an
optional extra.

**D3 — The one curated journey (AC-RAM-001).** A new organization's first screen is the Projects teaching
empty state, and its call to action is **New project**, so the journey starts there. It then follows the
page's own copy ("Pre-win projects live in the Pipeline.") to Sales Pipeline, opens the canonical record,
and returns with the persistent "Back to Sales Pipeline" link (OD-W5-C3-B). A short Administration ›
Organization integrations prefix makes it a setup-to-first-project journey without repeating
AC-ADMIA-001's navigation oracles. The journey enters `/sales` unfiltered, so it holds before and after
#681–#683 add filtered return. The gap it exposes (the create success offers no route to the record) is
recorded as F-4 for a design decision. The test does not assert today's behavior as the goal.

**D4 — Accessible names and light/dark contrast at L1.** jsdom cannot compute color contrast, so the
lowest layer that can prove WCAG-AA contrast is a rendered axe run. One read-only spec covers nine settled
surfaces × two themes (18 cases), following the pattern of `AC-PR-026`/`AC-MTG-023`.

**D5 — Deterministic personal card.** The seed leaves `m365_integration` off, and edge functions are not
served in the ordinary lanes. Two shared helpers entitle the page through a read fixture and answer the
`m365-token-custody` call with a 500, so the card settles on its "unknown" state (AC-M365-023). The
existing entitlement fixture in `AC-M365SEP-018` moves into `helpers.ts`, leaving one copy instead of
three.

**D6 — Findings are recorded, not fixed here.** Each of F-1..F-6 needs an input that a proof slice
lacks: Bahasa copy review (F-1/F-2), the money tier (F-3), an owner design decision (F-4), or a hook
contract change (F-5/F-6). Appendix A has the failing test each follow-up starts with.

**D7 — No ADR.** No architectural, irreversible, or cross-cutting decision is made.

**Scaling / performance note.** The chromium lane gains 18 axe cases and 4 overflow cases, all read-only
and parallel-safe, plus one self-isolated journey. That adds roughly 1–2 minutes to a parallel run and
nothing to the serial lane.

**Stop rule for AC-RAM-004.** If axe reports violations (DESIGN.md already records a sub-AA dark
`text-primary` gap), the executor **stops after Task 10**. It records each violation (rule id, route,
theme, target) in the handback and returns to the Director. It must not weaken the tag set, exclude
rules, or skip a surface. The Director decides whether the fix lands in this issue (a token or one-file
fix) or in a split issue.

## File map

| File | Change |
|---|---|
| `pmo-portal/e2e/helpers.ts` | add `grantM365EntitlementFixture`, `stubM365StatusUnavailable` |
| `pmo-portal/e2e/AC-M365SEP-018-integrations-route.spec.ts` | import the shared entitlement fixture (behavior-preserving) |
| `pmo-portal/pages/__tests__/AdministrationCredits.states.test.tsx` | **new** — AC-RAM-002 |
| `pmo-portal/pages/admin/OrgTaxDefault.test.tsx` | append AC-RAM-005 |
| `pmo-portal/e2e/AC-MOBILE-OVERFLOW-001-no-horizontal-bleed.spec.ts` | two routes + optional `prepare`/`ready` — AC-RAM-003 |
| `pmo-portal/e2e/AC-RAM-004-ris-admin-axe.spec.ts` | **new** — AC-RAM-004 |
| `pmo-portal/e2e/AC-RAM-001-ris-admin-first-project.spec.ts` | **new** — AC-RAM-001 |
| `docs/qa-portfolio.md` | matrix pointer + graduation rows for confirmed findings |

Commands below run from the executor's own worktree. `pmo-portal/` commands are shown as
`cd pmo-portal && …`, and repo-root commands have no `cd`. Every DB-touching command goes through
`scripts/e2e-local.sh`, which takes the DB lock itself.

---

## Tasks

### Task 1 — Shared personal-card fixtures (infra for AC-RAM-003/004) · 3 min

Append to the end of `pmo-portal/e2e/helpers.ts` (the file already imports `type Page`):

```ts
// -----------------------------------------------------------------------
// Personal Microsoft 365 card fixtures (read-only: no DB write, edge fn mocked).
// -----------------------------------------------------------------------

/**
 * The seed intentionally leaves `m365_integration` disabled. Entitle THIS page only by rewriting the
 * authenticated `org_features` read — the shared org row is never mutated and the route dies with the
 * page. Call after signIn and before the navigation that must see the card.
 */
export async function grantM365EntitlementFixture(page: Page): Promise<void> {
  await page.route('**/rest/v1/org_features*', async (route) => {
    const response = await route.fetch();
    if (!response.ok()) {
      await route.fulfill({ response });
      return;
    }
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

/**
 * Answers the personal card's `m365-token-custody` call with a 500 so the card settles on its
 * "status unknown" state (AC-M365-023) instead of depending on whether edge functions are served —
 * they are not, in the ordinary lanes (docs/e2e-parallel-conventions.md). Mocked, so a spec using it
 * stays `read-only`.
 */
export async function stubM365StatusUnavailable(page: Page): Promise<void> {
  const cors = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*',
    'access-control-allow-methods': 'POST, OPTIONS',
  };
  await page.route('**/functions/v1/m365-token-custody', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: cors });
      return;
    }
    await route.fulfill({
      status: 500,
      headers: cors,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'INTERNAL_ERROR', message: 'stubbed' }),
    });
  });
}
```

Verify: `cd pmo-portal && npx eslint e2e/helpers.ts --max-warnings=0 && npm run typecheck`

### Task 2 — Remove the duplicate fixture from AC-M365SEP-018 (behavior-preserving) · 3 min

In `pmo-portal/e2e/AC-M365SEP-018-integrations-route.spec.ts`:
- line 2: `import { test, expect, type Page } from '@playwright/test';` → `import { test, expect } from '@playwright/test';`
- line 3: `import { login } from './helpers';` → `import { login, grantM365EntitlementFixture } from './helpers';`
- delete lines 5–26 (the local doc comment and `async function useEntitledM365Fixture`).
- the call site `await useEntitledM365Fixture(page);` → `await grantM365EntitlementFixture(page);`

Verify (the journey's goal oracles are unchanged; all five cases must still pass):
`cd pmo-portal && npx eslint e2e/AC-M365SEP-018-integrations-route.spec.ts --max-warnings=0`
then from repo root: `scripts/e2e-local.sh --project=chromium AC-M365SEP-018`

### Task 3 — AC-RAM-002: Credits loading and error+retry (write the test) · 4 min

Create `pmo-portal/pages/__tests__/AdministrationCredits.states.test.tsx`:

```tsx
/**
 * AC-RAM-002 (#688) — Administration › Credits owns its loading and recoverable-error states.
 * Matrix cells R4 × O1 and R4 × O3 (docs/specs/ris-admin-route-matrix.spec.md): nothing proved them.
 * A loading or failed balance must never render a balance figure, and a failure must be recoverable
 * in place.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/src/components/ui';

const { getOrgBalance, grant } = vi.hoisted(() => ({
  getOrgBalance: vi.fn(),
  grant: vi.fn(),
}));

vi.mock('@/src/lib/repositories', () => ({
  repositories: { credits: { getOrgBalance, grant } },
}));

import AdministrationCredits from '../AdministrationCredits';

const renderSection = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ToastProvider>
          <AdministrationCredits isOperator={false} orgId="org-1" />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  getOrgBalance.mockReset();
  grant.mockReset();
});

describe('AdministrationCredits — loading and error states (AC-RAM-002)', () => {
  it('AC-RAM-002: while the balance loads, a busy skeleton shows and no balance figure is claimed', () => {
    getOrgBalance.mockReturnValue(new Promise(() => {}));
    renderSection();
    expect(screen.getByTestId('liststate-loading')).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByTestId('org-credit-balance')).not.toBeInTheDocument();
  });

  it('AC-RAM-002: a failed balance read shows an error with Retry, and Retry re-reads to the balance', async () => {
    getOrgBalance.mockRejectedValueOnce(new Error('network down')).mockResolvedValueOnce(120);
    renderSection();

    expect(await screen.findByText("Couldn't load balance")).toBeInTheDocument();
    expect(screen.queryByTestId('org-credit-balance')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /retry/i }));

    await waitFor(() =>
      expect(screen.getByTestId('org-credit-balance')).toHaveTextContent(/120\s*credits/i),
    );
    expect(getOrgBalance).toHaveBeenCalledTimes(2);
  });
});
```

Verify (expected: 2 passed): `cd pmo-portal && npx vitest run pages/__tests__/AdministrationCredits.states.test.tsx`

### Task 4 — AC-RAM-002 mutation check (the red step) · 3 min

1. In `pmo-portal/pages/AdministrationCredits.tsx`, delete the line `onRetry={() => void balanceQuery.refetch()}` (in the `balanceQuery.isError` `ListState`).
2. Run `cd pmo-portal && npx vitest run pages/__tests__/AdministrationCredits.states.test.tsx`. The expected result is that the Retry test **fails** because it cannot find the retry button.
3. Restore the line (`git checkout -- pmo-portal/pages/AdministrationCredits.tsx`) and rerun: 2 passed.
4. Repeat with `{balanceQuery.isPending && (` changed to `{false && (`. The loading test must fail. Restore it and rerun: 2 passed.

If either mutation leaves the suite green, the test does not bind to the shipped code: stop and rewrite it.

### Task 5 — AC-RAM-005: tax default disabled while writing (write the test) · 3 min

Append inside the existing `describe('OrgTaxDefault — the org-wide pre-selection …')` block in
`pmo-portal/pages/admin/OrgTaxDefault.test.tsx`, just before its closing `});` (currently line 105):

```tsx
  it('AC-RAM-005: while the new default is being written, the control is disabled so a second change cannot race it', async () => {
    let finishWrite: () => void = () => {};
    setTaxDefault.mockReturnValue(
      new Promise<void>((resolve) => {
        finishWrite = resolve;
      }),
    );
    renderPanel('Admin');
    await waitFor(() => expect(select().value).toBe('exclusive'));

    await userEvent.selectOptions(select(), 'inclusive');
    await waitFor(() => expect(select()).toBeDisabled());

    finishWrite();
    await waitFor(() => expect(select()).toBeEnabled());
  });
```

Verify (expected: all OrgTaxDefault tests pass, including the new one): `cd pmo-portal && npx vitest run pages/admin/OrgTaxDefault.test.tsx`

### Task 6 — AC-RAM-005 mutation check · 2 min

1. In `pmo-portal/pages/admin/OrgTaxDefault.tsx`, delete `disabled={mutation.isPending}` (line 90).
2. `cd pmo-portal && npx vitest run pages/admin/OrgTaxDefault.test.tsx -t "AC-RAM-005"`. The expected result is **fail**.
3. `git checkout -- pmo-portal/pages/admin/OrgTaxDefault.tsx`, then rerun: pass.

### Task 7 — AC-RAM-003: extend the no-bleed sweep (write the change) · 4 min

In `pmo-portal/e2e/AC-MOBILE-OVERFLOW-001-no-horizontal-bleed.spec.ts`:

(a) line 27: `import { test, expect, type Page } from '@playwright/test';` → `import { test, expect, type Page, type Locator } from '@playwright/test';`
(b) line 28: `import { signIn } from './helpers';` → `import { signIn, grantM365EntitlementFixture, stubM365StatusUnavailable } from './helpers';`
(c) after the `PROC_SHOWCASE` constant (line 33), add:

```ts
// AC-RAM-003 (#688): P011 "Highfield Bridge Survey" — a pre-win seed row, read only here — is where a
// RIS Admin's first project lives (pipeline lens). The on-hand MERIDIAN routes cover the delivery lens.
const PIPELINE_LENS = '40000000-0000-0000-0000-000000000011';
```

(d) change the `ROUTES` type from `{ path: string; label: string }[]` to:

```ts
const ROUTES: {
  path: string;
  label: string;
  /** Page-scoped read fixtures installed after sign-in, before navigation. */
  prepare?: (page: Page) => Promise<void>;
  /** Must be visible before measuring — guards against sweeping an empty shell. */
  ready?: (page: Page) => Locator;
}[] = [
```

(e) directly after the `project-tasks` entry, add:

```ts
  { path: `/projects/${PIPELINE_LENS}`, label: 'project-pipeline-lens (AC-RAM-003)', ready: (p) => p.getByLabel('Project stage journey') },
```

(f) directly after the `administration` entry, add:

```ts
  {
    path: '/integrations',
    label: 'personal-integrations (AC-RAM-003)',
    prepare: async (p) => {
      await grantM365EntitlementFixture(p);
      await stubM365StatusUnavailable(p);
    },
    ready: (p) => p.getByTestId('m365-connection-card'),
  },
```

(g) in the test body, replace `await page.goto(route.path);` with:

```ts
        await route.prepare?.(page);
        await page.goto(route.path);
        if (route.ready) await expect(route.ready(page)).toBeVisible({ timeout: 20_000 });
```

Verify: `cd pmo-portal && npx eslint e2e/AC-MOBILE-OVERFLOW-001-no-horizontal-bleed.spec.ts --max-warnings=0`

### Task 8 — AC-RAM-003 run + mutation check · 5 min

1. Repo root: `scripts/e2e-local.sh --project=chromium AC-MOBILE-OVERFLOW-001 -g "AC-RAM-003"`. Expected: 4 passed (2 routes × 390/360).
2. Mutation (bleed): in `pmo-portal/pages/Integrations.tsx`, change `<div className="mt-4 max-w-xl">` to `<div className="mt-4 w-[640px]">`. Rerun step 1. Expected: the `personal-integrations` cases **fail** with the card listed as a bleeder. `git checkout -- pmo-portal/pages/Integrations.tsx`.
3. Mutation (dead-oracle guard): temporarily delete the `prepare:` property from the `/integrations` entry. Rerun step 1. Expected: **fail** on `ready` because the card is absent. This proves the sweep cannot pass over an empty shell. Restore the entry.
4. Full sweep still green: `scripts/e2e-local.sh --project=chromium AC-MOBILE-OVERFLOW-001`.

### Task 9 — AC-RAM-004: axe in light and dark (write the spec) · 5 min

Create `pmo-portal/e2e/AC-RAM-004-ris-admin-axe.spec.ts`:

```ts
// @e2e-isolation: read-only — signs in the seed Admin and runs axe-core over nine settled RIS-Admin surfaces in light and dark themes; the only interceptions are an org_features read fixture and a mocked personal Microsoft 365 status call. No DB writes.
import { test, expect, type Page, type Locator } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { signIn, grantM365EntitlementFixture, stubM365StatusUnavailable } from './helpers';

/**
 * AC-RAM-004 (#688) — the RIS Admin setup-to-first-project surfaces pass axe-core WCAG 2 A/AA in BOTH
 * themes. Owns matrix cells O8 (accessible names) and O10 (light/dark contrast) for R1–R8
 * (docs/specs/ris-admin-route-matrix.spec.md). jsdom cannot compute contrast, so this is the lowest
 * sufficient layer. Same builder + tag set as AC-PR-026 / AC-MTG-023.
 *
 * Every scan waits for a POPULATED surface first — an axe pass over a skeleton certifies a shell.
 * Code proof on the seed-org sample Admin only; it says nothing about live RIS connections.
 */

const ADMIN = 'admin@acme.test';
/** P011 "Highfield Bridge Survey" — a pre-win seed row (pipeline lens), read only. */
const PIPELINE_LENS = '40000000-0000-0000-0000-000000000011';
/** SP-2401 "Meridian Steelworks 4.2 MW Rooftop PV" — an on-hand seed row (delivery lens), read only. */
const DELIVERY_LENS = '41000000-0000-0000-0000-000000000001';

interface Surface {
  label: string;
  path: string;
  ready: (page: Page) => Locator;
  prepare?: (page: Page) => Promise<void>;
}

const SURFACES: Surface[] = [
  { label: 'administration-users', path: '/administration/users', ready: (p) => p.getByRole('searchbox', { name: 'Search users' }) },
  {
    label: 'administration-integrations',
    path: '/administration/integrations',
    ready: (p) => p.getByRole('heading', { level: 2, name: 'Organization integrations' }),
  },
  { label: 'administration-accounting', path: '/administration/accounting', ready: (p) => p.locator('#budget-account-map') },
  { label: 'administration-credits', path: '/administration/credits', ready: (p) => p.getByTestId('org-credit-balance') },
  {
    label: 'personal-integrations',
    path: '/integrations',
    prepare: async (p) => {
      await grantM365EntitlementFixture(p);
      await stubM365StatusUnavailable(p);
    },
    ready: (p) => p.getByTestId('m365-unknown-msg'),
  },
  { label: 'projects', path: '/projects', ready: (p) => p.getByText('Meridian Steelworks 4.2 MW Rooftop PV').first() },
  { label: 'sales', path: '/sales', ready: (p) => p.getByText('Highfield Bridge Survey').first() },
  { label: 'project-pipeline-lens', path: `/projects/${PIPELINE_LENS}`, ready: (p) => p.getByLabel('Project stage journey') },
  {
    label: 'project-delivery-lens',
    path: `/projects/${DELIVERY_LENS}/overview`,
    ready: (p) => p.getByRole('heading', { name: /Meridian Steelworks 4\.2 MW Rooftop PV/ }),
  },
];

for (const theme of ['light', 'dark'] as const) {
  for (const s of SURFACES) {
    test(`AC-RAM-004 ${s.label} @${theme} passes axe-core (WCAG-AA)`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 800 });
      await signIn(page, ADMIN);
      await s.prepare?.(page);
      // index.html reads the `theme` key before first paint (same mechanism as AC-ADMIA-005).
      await page.evaluate((t) => localStorage.setItem('theme', t), theme);
      await page.goto(s.path);
      if (theme === 'dark') await expect(page.locator('html')).toHaveClass(/dark/);
      else await expect(page.locator('html')).not.toHaveClass(/dark/);

      await expect(s.ready(page)).toBeVisible({ timeout: 20_000 });
      await page.waitForLoadState('networkidle').catch(() => {});

      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
      expect(
        results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`),
        `axe WCAG-AA violations on ${s.path} (${theme})`,
      ).toEqual([]);
    });
  }
}
```

Verify: `cd pmo-portal && npx eslint e2e/AC-RAM-004-ris-admin-axe.spec.ts --max-warnings=0 && cd .. && scripts/check-e2e-isolation.sh`

### Task 10 — AC-RAM-004 run · 4 min

Repo root: `scripts/e2e-local.sh --project=chromium AC-RAM-004`. Expected: 18 passed.
**If any case fails, apply the stop rule** (Design § Stop rule). Put the failure list (rule id · surface ·
theme · target) in the handback and do not continue to Task 11.

### Task 11 — AC-RAM-004 mutation check · 3 min

1. In `pmo-portal/pages/Integrations.tsx`, change the description `<p className="mt-1 max-w-xl text-sm text-muted-foreground">` to `<p className="mt-1 max-w-xl text-sm text-muted-foreground/30">`.
2. `scripts/e2e-local.sh --project=chromium AC-RAM-004 -g "personal-integrations"`. Expected: **fail** with `color-contrast` in both themes.
3. `git checkout -- pmo-portal/pages/Integrations.tsx`, then rerun: 2 passed.

### Task 11b — AC-RAM-006 / FR-RAM-009: create opens the new record (F-4 ruling) · 5 min

Ruling 2026-09-28 (Director, revisitable): a successful create on `/projects` opens `/projects/:id`, matching `pages/Meetings.tsx`'s create handler.

1. **Red:** create `pmo-portal/pages/__tests__/Projects.createNavigation.test.tsx` (copy the render/mocking setup of the nearest existing Projects create test, e.g. the AC-PRJ-003 file). Case `AC-RAM-006: a successful create names the project and opens its record`: mock the create mutation to resolve `{ id: 'p-new', ... }`, submit a valid form, assert the success toast carries the name and the router location is `/projects/p-new`. Case `AC-RAM-006: a failed create stays on /projects with the modal open`. Run `npx vitest run pages/__tests__/Projects.createNavigation.test.tsx` from `pmo-portal/`; confirm the first case fails.
2. **Green:** in `pmo-portal/pages/Projects.tsx` `createModal.onSubmit`, use the row returned by `create.mutateAsync(input)` and `navigate(\`/projects/${row.id}\`)` after the toast and `setCreateOpen(false)`. If the repository create does not return the row, stop and report.
3. Rerun the file green. Update Task 12's journey: after "Create project", expect the URL `/projects/:id` directly (no detour through Sales to find it), then use "Back to Sales Pipeline" and assert `/sales` lists the project. The goal oracles do not change.

### Task 12 — AC-RAM-001: the curated first-project journey (write the spec) · 5 min

Create `pmo-portal/e2e/AC-RAM-001-ris-admin-first-project.spec.ts`:

```ts
// @e2e-isolation: self-isolated — the Admin creates one project named with the exclusive prefix "E2E RAM-001 " plus a run id; beforeEach and afterEach service-role-delete that prefix in the seed org (the AC-PRJ-006 cleanup pattern). No shared seed row is written.
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { signIn, pickComboboxOption, openPipelineCard, requireServiceRoleKey } from './helpers';

/**
 * AC-RAM-001 (#688) — the ONE curated cross-stack journey for the RIS Admin route (ADR-0010):
 * organization setup → first project → its canonical record → back to the list that holds it.
 *
 * The journey is the natural one for a new organization: Projects' "New project" is the first action
 * a new org is offered, and the Projects page itself says "Pre-win projects live in the Pipeline." — so
 * that is where the user goes to find what they created. GOAL ORACLES: the success message names the
 * project; the record opens at the canonical /projects/:id in its pipeline lens; the return link lands on
 * a list that contains the project.
 *
 * Code proof with the seed-org sample Admin. It does NOT prove live RIS Microsoft 365 / ERPNext data
 * transfer (LIVE-1..4 in docs/specs/ris-admin-route-matrix.spec.md stay manual).
 */

const ADMIN = 'admin@acme.test';
const SEED_ORG = '00000000-0000-0000-0000-000000000001';
const NAME_PREFIX = 'E2E RAM-001 ';
const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321';

function adminClient() {
  const host = new URL(SUPABASE_URL).hostname;
  if (host !== '127.0.0.1' && host !== 'localhost') {
    throw new Error('AC-RAM-001 cleanup requires the local Supabase stack');
  }
  const key = requireServiceRoleKey();
  if (!key) throw new Error('AC-RAM-001 requires the local Supabase service role key; run through scripts/e2e-local.sh');
  return createClient(SUPABASE_URL, key, { auth: { persistSession: false } });
}

async function deleteOwnedProjects() {
  const { error } = await adminClient()
    .from('projects')
    .delete()
    .eq('org_id', SEED_ORG)
    .like('name', `${NAME_PREFIX}%`);
  if (error) throw new Error(`AC-RAM-001 cleanup failed: ${error.message}`);
}

test.setTimeout(120_000);
test.beforeEach(deleteOwnedProjects);
test.afterEach(deleteOwnedProjects);

test('AC-RAM-001: a RIS Admin goes from organization setup to a first project, opens its record, and returns to the list that holds it', async ({
  page,
}) => {
  const name = `${NAME_PREFIX}${Date.now()}`;
  await page.setViewportSize({ width: 1280, height: 800 });
  await signIn(page, ADMIN);

  // 1 — Setup: Administration opens on Users; the Admin checks Organization integrations.
  await page.getByRole('link', { name: 'Administration', exact: true }).click();
  await expect(page).toHaveURL(/\/administration\/users$/);
  await page
    .getByRole('navigation', { name: 'Administration sections' })
    .getByRole('link', { name: 'Organization integrations' })
    .click();
  await expect(page).toHaveURL(/\/administration\/integrations$/);
  await expect(page.getByRole('heading', { level: 2, name: 'Organization integrations' })).toBeVisible();

  // 2 — Work: Projects from the primary rail.
  const rail = page.getByRole('navigation', { name: 'Primary navigation' });
  await rail.getByRole('link', { name: 'Projects', exact: true }).click();
  await expect(page).toHaveURL(/\/projects$/);
  await expect(page.getByTestId('projects-loading')).not.toBeVisible({ timeout: 20_000 });

  // 3 — Create the first project.
  await page.getByRole('button', { name: /new project/i }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 8_000 });
  await dialog.getByLabel(/project name/i).fill(name);
  await pickComboboxOption(dialog, page, /client company/i, 'first');
  await dialog.getByRole('button', { name: /^Create project$/i }).click();
  await expect(dialog).not.toBeVisible({ timeout: 15_000 });
  // GOAL: success names the created record.
  await expect(page.getByRole('status').filter({ hasText: 'Project created' })).toContainText(name);

  // 4 — The page's own guidance says where a new (pre-win) project lives; the Admin follows it.
  await expect(page.getByText(/Pre-win projects live in the Pipeline\./)).toBeVisible();
  await rail.getByRole('link', { name: 'Sales Pipeline', exact: true }).click();
  await expect(page).toHaveURL(/\/sales$/);
  await openPipelineCard(page, name);

  // 5 — GOAL: the canonical record, in its pipeline lens.
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+/);
  await expect(page.getByRole('heading', { name })).toBeVisible();
  await expect(page.getByLabel('Project stage journey')).toBeVisible();

  // 6 — GOAL: the return link lands on the list that holds the project.
  await page.getByRole('link', { name: /Back to Sales Pipeline/ }).click();
  await expect(page).toHaveURL(/\/sales$/);
  await expect(page.getByText(name).first()).toBeVisible({ timeout: 15_000 });
});
```

Verify: `cd pmo-portal && npx eslint e2e/AC-RAM-001-ris-admin-first-project.spec.ts --max-warnings=0 && cd .. && scripts/check-e2e-isolation.sh`

### Task 13 — AC-RAM-001 run, flake check, mutation check · 5 min

1. Repo root: `scripts/e2e-local.sh --project=chromium AC-RAM-001 --repeat-each=3`. Expected: 3 passed.
2. Mutation (return oracle): in `pmo-portal/pages/project-detail/PipelineLens.tsx`, change `href="/sales"` to `href="/projects"`. Run `scripts/e2e-local.sh --project=chromium AC-RAM-001`. Expected: **fail** at the final `toHaveURL(/\/sales$/)`. Restore it with `git checkout -- pmo-portal/pages/project-detail/PipelineLens.tsx`.
3. Mutation (success oracle): in `pmo-portal/pages/Projects.tsx:333`, change `toast(t('projects.toast.created', 'Project created'), input.name, 'success');` to `toast(t('projects.toast.created', 'Project created'), '', 'success');`. Rerun. Expected: **fail** at the toast `toContainText(name)`. Restore it with `git checkout -- pmo-portal/pages/Projects.tsx`.
4. Rerun step 1's command once more: pass.

### Task 14 — Rendered Discover pass: confirm F-1..F-6 (design-reviewer, opus) · 5 min per finding

Render the running app. Use the Playwright CLI or the agent-browser CLI, **never the Playwright MCP**.
First, `scripts/with-db-lock.sh supabase db reset`. Then start `cd pmo-portal && npm run dev`. Sign in as
`admin@acme.test` with the seed password in `pmo-portal/e2e/helpers.ts`. For each finding, record the
route, viewport, theme, language, expected result, observed result, and a screenshot path in the
handback:

- **F-1:** In Profile & preferences, set Interface language to Bahasa Indonesia. Then open
  `/administration/users`, `/administration/accounting`, and `/administration/credits` at 1440px and
  390px. English panel copy confirms the finding. Afterwards, set the language back to Organization
  default.
- **F-2:** In Bahasa, open `/projects` → New project (form labels), then `/sales`. Also inspect the board
  region's accessible name in the accessibility tree.
- **F-3:** Open `/projects` → New project → the Estimated value field. A `$` adornment in this org's
  currency context confirms the finding.
- **F-4:** Create a project from `/projects` → New project in English. Observe whether the success
  message and the list give a route to the new record. Afterwards, archive it from its record.
- **F-5:** In a scratch Playwright script (not committed), route `**/rest/v1/projects*` to status 503.
  Both the list read and the by-id read (`src/lib/db/opportunity.ts`) use this table. Then open
  `/projects/40000000-0000-0000-0000-000000000011` and wait for the app's query retries to end.
  "Project not found" with no Retry confirms the finding.
- **F-6:** In the same way, route `**/rest/v1/organizations*` to 503 and open `/administration/accounting`.
  A tax-default skeleton that remains after the query retries end confirms the finding.

Any new unknown-unknown found on R1–R8 during the pass is recorded in the same format.

### Task 15 — docs/qa-portfolio.md: matrix pointer + graduation rows · 4 min

(a) In `docs/qa-portfolio.md`, after the paragraph beginning "**Administration IA cells:**", insert:

```markdown
**RIS Admin setup-to-first-project cells (#688):** the route × oracle matrix for `/administration/users`,
`/administration/integrations`, `/administration/accounting`, `/administration/credits`, `/integrations`,
`/projects`, `/sales` and `/projects/:id` — with the deciding test per cell and the code-proof vs
live-RIS-proof split — lives in `docs/specs/ris-admin-route-matrix.spec.md`. Re-derive a cell from its
cited test, never from this pointer.
```

(b) Append one row to the graduation registry table for **each finding Task 14 confirmed**. Omit any
finding that was not confirmed. Use these exact rows:

```markdown
| Administration panels render English under Bahasa; the i18n gate named only the shell file (F-1, #688) — 2026-09-28 | follow-up: `/administration/:section` in `src/lib/i18n/launch-scope-routes.txt` names every panel file → `npm run check:i18n` | EN/ID × `/administration/users`, `/administration/integrations`, `/administration/accounting`, `/administration/credits` | DD-I18N-9: an entry covers only the files it names — list each component that renders the screen's copy | ☐ |
| First-project create form and Sales board render English under Bahasa (F-2, #688) — 2026-09-28 | follow-up: `/projects` and `/sales` entries name `components/ProjectFormModal.tsx` and `components/SalesKanbanBoard.tsx` → `npm run check:i18n` | EN/ID × `/projects`, `/sales` | DD-I18N-9 (as above) | ☐ |
| Money inputs show a hard-coded `$` adornment (F-3, #688) — 2026-09-28 | follow-up unit test: the create form's Estimated value adornment equals `currencySymbol(orgCurrency)` | data-correctness × `/projects`, `/projects/:id` | FR-L10N-020: a money adornment comes from the currency, never a literal | ☐ |
| Creating a project from Projects gives no route to the new record; the list omits pre-win projects (F-4, #688) — 2026-09-28 | pending owner design decision; AC-RAM-001 follows the page's Pipeline guidance meanwhile | success × `/projects` | brief: "success names the changed record and next useful action" | ☐ |
| Project record shows "not found" when its read fails, with no Retry (F-5, #688) — 2026-09-28 | follow-up: `ProjectDetail.test.tsx` failed-read case expects an error with Retry, distinct from not-found | error+retry × `/projects/:id` | DESIGN.md Organization integration readiness principle: an unavailable source is never presented as absent | ☐ |
| Default tax treatment shows a loading skeleton indefinitely when its read fails (F-6, #688) — 2026-09-28 | follow-up: `OrgTaxDefault.test.tsx` rejected read expects an error with Retry | error+retry × `/administration/accounting` | DESIGN.md Navigation: an unavailable check has a recoverable error state | ☐ |
```

Verify: `grep -n "ris-admin-route-matrix" docs/qa-portfolio.md` (≥1 line), and every appended row has 5 cells.

### Task 16 — Final gates · 5 min

1. `cd pmo-portal && npm run verify:locked`. Every gate must be green; read the output body, not the exit code through a pipe.
2. Repo root: `scripts/e2e-local.sh --project=chromium AC-RAM-001 AC-RAM-004 AC-M365SEP-018 AC-MOBILE-OVERFLOW-001`. All must be green.
3. `grep -rn "AC-RAM-00[1-5]" pmo-portal --include=*.ts --include=*.tsx`. Each of AC-RAM-001..005 must appear in at least one test title.
4. Do not commit. The Director commits. Hand back the changed-file list, the Task 4/6/8/11/13 mutation results, and the Task 14 confirmation table.

---

## Traceability

| AC | Owning test (layer) | Tasks | Matrix cells closed |
|---|---|---|---|
| AC-RAM-001 | `e2e/AC-RAM-001-ris-admin-first-project.spec.ts` › "AC-RAM-001: a RIS Admin goes from organization setup to a first project, opens its record, and returns to the list that holds it" (E2E) | 12, 13 | R7 O12 (plus supporting proof for R6 O6 and R8 O12) |
| AC-RAM-002 | `pages/__tests__/AdministrationCredits.states.test.tsx` › two `AC-RAM-002:` cases (Unit) | 3, 4 | R4 O1, R4 O3 |
| AC-RAM-003 | `e2e/AC-MOBILE-OVERFLOW-001-no-horizontal-bleed.spec.ts` › "AC-MOBILE-OVERFLOW-001 personal-integrations (AC-RAM-003) @390/@360", "… project-pipeline-lens (AC-RAM-003) @390/@360" (E2E L1) | 1, 2, 7, 8 | R5 O9, R8 O9 |
| AC-RAM-004 | `e2e/AC-RAM-004-ris-admin-axe.spec.ts` › "AC-RAM-004 <surface> @light/@dark passes axe-core (WCAG-AA)" × 18 (E2E L1) | 1, 9, 10, 11 | O8 and O10 for R1–R8 (16 cells) |
| AC-RAM-005 | `pages/admin/OrgTaxDefault.test.tsx` › "AC-RAM-005: while the new default is being written, the control is disabled so a second change cannot race it" (Unit) | 5, 6 | R3 O5 |
| AC-RAM-006 | `pages/__tests__/Projects.createNavigation.test.tsx` › two `AC-RAM-006:` cases (Unit) | 11b | R6 O6 (F-4) |
| FR-RAM-001/002 | spec review (spec-reviewer) | — | whole matrix |
| FR-RAM-008 | `docs/qa-portfolio.md` rows (review) | 14, 15 | F-1..F-6 |

The 22 N cells are closed by AC-RAM-001..005. The 8 F cells go to Appendix A. The 3 D cells stay with #689.

---

## Appendix A — follow-ups for the Director to file (not part of this issue)

Each follow-up starts with the failing test named here. Suggested routing is in brackets.

- **F-1 + F-2, i18n completion on the RIS Admin route** [ADW, fe_builder; Bahasa copy needs a reviewer].
  Failing test: edit `pmo-portal/src/lib/i18n/launch-scope-routes.txt` as follows.
  - `/administration/:section` gets `pages/Administration.tsx pages/AdminUsers.tsx pages/AdministrationCredits.tsx pages/admin/OrgTaxDefault.tsx pages/admin/BudgetAccountMap.tsx src/components/integrations/IntegrationsView.tsx`.
  - `/projects` gains `components/ProjectFormModal.tsx`.
  - `/sales` becomes `pages/SalesPipeline.tsx components/SalesKanbanBoard.tsx components/ProjectFormModal.tsx`.
  - Correct the Administration comment that claims the shell alone keeps every label inside the gate.

  `cd pmo-portal && npm run check:i18n` then goes red with the exact unextracted list. The follow-up
  extracts each string to `t(key, default)` and adds non-empty `id` values. Coordinate the
  `/integrations` line with #689, which should add `src/components/integrations/M365ConnectionCard.tsx`.
- **F-3, currency adornment** [separate issue; #684 is already large and in flight].
  Failing unit test in `pmo-portal/components/ProjectFormModal.contractTax.test.tsx`: given an org
  currency of `IDR`, the Estimated value field's adornment is `currencySymbol('IDR')` (`'IDR'`), not
  `'$'`. Add the matching case for `ProjectDetailHeader`'s Contract value, using the project's own
  currency.
- **F-4, next action after create** [owner decision first, then an ADW]. There is no test until the ruling.
  The candidate rulings are to navigate to `/projects/:id` on create, per the Record-Open Rule, or to add
  an "Open project" action to the success message. Either ruling changes AC-RAM-001's step 4 deliberately
  and leaves its goal oracles unchanged.
- **F-5 + F-6, failed read presented as absent/pending** [one ADW issue].
  - F-5 failing test in `pages/project-detail/__tests__/ProjectDetail.test.tsx`: with the projects list
    and the by-id read both in error, expect an error state with a **Retry** button, and do not show
    "Project not found".
  - F-6 failing test in `pages/admin/OrgTaxDefault.test.tsx`: `getTaxDefault.mockRejectedValue(new Error('x'))`
    → expect a Retry button, and `org-tax-default-loading` is absent.
  - Both fixes need the hook to expose its query state. `useOrgTaxDefault`'s value-only contract is used by
    the forms and must stay as it is, so add a sibling `useOrgTaxDefaultQuery`.

## Appendix B — open questions for the Director

1. **Answered 2026-09-28:** create opens the new record (Meetings precedent); built here as Task 11b / AC-RAM-006.
2. **Answered:** token-level or one-file axe fixes land inside #688; anything larger is split out.
3. **Answered:** yes — #689 adds it.
4. **Answered:** refresh-only recovery is acceptable for the RIS Admin test; revisit if live use shows the state recurring.
