# E2E parallel-safety conventions (binding)

One-page checklist for **every new/edited `pmo-portal/e2e/*.spec.ts`**, so the `workers:4` parallel
lane stays green. This is the authoring contract; the mechanism (why/how it works) is documented once
in `docs/superpowers/specs/2026-07-11-e2e-parallel-isolation-design.md` and enforced by
`pmo-portal/playwright.config.ts` + `scripts/check-e2e-isolation.sh` — don't re-derive it, link it.

## 1. Default to parallel-safe — pick the LOWEST class that fits

Preference order: **read-only > self-isolated > dedicated-row > serial**. `serial` is a **last
resort**: it must be justified in a one-line comment in the spec header (why the journey is
intrinsically org-global), never chosen as the default or to dodge a race you could isolate away
instead.

| Class | Definition | Lane |
|---|---|---|
| `read-only` | Only navigates/asserts; no DB write (incl. `page.route`-mocked edge fns) | `chromium`, parallel |
| `self-isolated` | Creates its own uniquely-named data; cleans up | `chromium`, parallel |
| `dedicated-row` | Owns an expendable seed row nobody else reads (P012/P013…) | `chromium`, parallel |
| `serial` | Mutates org-global singletons (feature flags, entitlements, shared user roles, org-wide budget/version state) | `e2e/serial/`, `--workers=1` |

## 2. How to be `self-isolated`

- Create your **own** data with a unique name/id every run — `` `Test View ${Date.now()}` ``, a
  `crypto.randomUUID()` suffix, etc. Never mutate a shared seed row (P001, P002, SP-2401, the seed
  org's shared users) — another worker may be reading it concurrently.
- Clean up in `afterEach` (or a service-role delete) so the spec is safe under `retries: 2` — a
  retry must find the same starting state, not a leftover from attempt 1.
- Need data scoped **per worker** rather than per test? Use `testInfo.workerIndex` /
  `process.env.TEST_WORKER_INDEX` to namespace it (worker-scoped fixture, `scope: 'worker'`) —
  workers are separate processes with separate browser contexts and cannot share state or globals.

## 3. When `serial` is truly required

Only for journeys that mutate state shared across the whole org/suite — entitlement toggles,
operator/incident flags, ClickUp domain-ownership flips, budget-version activation on a shared
project, admin user-role changes. Then:

1. Put the file under `pmo-portal/e2e/serial/` (dir = lane; the guard checks tag↔dir consistency).
2. Tag `// @e2e-isolation: serial` with a one-line why.
3. Reset whatever you mutated in `afterEach` so the spec is retry-safe and doesn't poison the next
   run.

`test.describe.configure({ mode: 'serial' })` is for genuinely *dependent* tests only (per
Playwright's own guidance, it's discouraged) — it is not a substitute for the `e2e/serial/` lane.

## 4. Every spec MUST carry the tag

Line 1 (or near it): `// @e2e-isolation: read-only | self-isolated | dedicated-row | serial`.
`scripts/check-e2e-isolation.sh` (wired into `npm run verify` + all 3 CI jobs) blocks merge on: a
missing/invalid tag, a lane/tag mismatch, a `read-only` spec that writes, or a non-`serial`/
non-`dedicated-row` spec that service-role-writes a known shared seed id. Name the class **and** a
one-line why in the same comment or the line above it.

## 5. Money / ERP UI flows — never hang a worker on a live call

Don't let a test block on a real served-function or external-ERP round-trip. Mock the call via
`page.route` (this keeps the spec `read-only` or `self-isolated`, and fast); only the dedicated
"served"/live-bench specs are allowed to drive the real integration lane, and those must be
`dedicated-row` or `serial` per their actual blast radius, never assumed `read-only` just because
they don't touch Postgres directly.

## 6. Running locally

```bash
npm run e2e
# == playwright test --project=chromium && playwright test --project=serial --workers=1
```

**Why two phases, not one run:** Playwright's `workers` setting is **global** to an invocation — a
single run cannot pin the `serial` project to 1 worker while `chromium` uses 4. Two invocations is
the simplest way to guarantee `serial` specs never overlap the parallel batch or each other; both
reuse the same dev server (`reuseExistingServer: true`).

## 7. Before every PR→`main`: simulate CI locally (binding, owner directive 2026-07-24)

Run **`scripts/verify-main-pr.sh`** from the repo root before creating, pushing, or refreshing any
PR that targets `main`. It reproduces the promotion gates in CI's order and semantics — full verify,
CI-equivalent coverage + changed-lines ≥80, repo contract tests, Deno boot-smoke + unit suites, a
**fresh** Supabase stack, complete pgTAP, the whole Playwright portfolio under `CI=true`
(`chromium` parallel then `serial --workers=1`, both `--fail-on-flaky-tests`), and the
served-function smoke **last**.

Why the ordering is load-bearing: `scripts/serve-functions.sh` tears down its temporary
edge-runtime container on exit, but **Kong keeps routing `functions/v1/*` to the vanished upstream
until the stack restarts** — so any e2e that runs *after* a served lane hangs on
`functions.invoke`. That mis-ordering in CI is what kept the 2026-07 dev→main promote (#370) red;
`scripts/ci-integration-order.test.mjs` now asserts the order in **both** `ci.yml` and
`verify-main-pr.sh`, so neither can regress silently.

### ⚑ Edge functions are NOT served in either environment by default

`supabase/config.toml` sets `[edge_runtime] enabled = false` — for **CI and local alike**. The only
thing that serves `functions/v1/*` is `scripts/serve-functions.sh`, which starts its own container
and exports **`SUPABASE_FUNCTIONS_URL`**. That variable — never `process.env.CI` — is the signal a
spec must gate on.

Gating on `CI` gets the polarity backwards in both directions, and we have shipped it twice:
- the bench specs threw *in* CI because they assumed CI had an ERPNext bench (fixed #371/#372);
- `AC-INV-001` skipped *in* CI and ran locally, where it 503'd on every run — passing CI by absence
  while being permanently red on a developer machine.

The canonical form (matches the bench specs):
```ts
const FUNCTIONS_URL = process.env.SUPABASE_FUNCTIONS_URL ?? '';
const READY = Boolean(FUNCTIONS_URL && /* whatever else the lane needs */);
if (FUNCTIONS_URL && !READY) throw new Error('served lane is up but misconfigured — never a silent skip');
(READY ? test : test.skip)(...)
```
Skip when the lane is absent; **throw** when it is present but broken. A spec that mocks
`functions/v1` via `page.route` needs no gate at all — prefer that.

Targeted failing-spec reruns and `scripts/e2e-local.sh` are inner-loop tools — never a substitute
for this gate. Environment gotchas the script enforces/documents: node ≥22 (node 18 fails inside
vitest with a misleading `node:util`/`styleText` error), and `SUPABASE_FUNCTIONS_URL` stays UNSET
for the ordinary lane (so bench-only specs skip).

For CI-parity locally (DB lock + `.env.local`), use `scripts/e2e-local.sh` from the repo root instead
of calling `playwright test` directly.

## Source of truth (don't duplicate, link)

- Design & rationale: `docs/superpowers/specs/2026-07-11-e2e-parallel-isolation-design.md`
- Config: `pmo-portal/playwright.config.ts` (the `setup` / `chromium` / `serial` projects)
- Guard: `scripts/check-e2e-isolation.sh`
- QA-portfolio summary: `docs/qa-portfolio.md` ("e2e parallel-isolation contract")
- Quick table for authors: `pmo-portal/e2e/README.md`

## Sources (Playwright best practice)

- https://playwright.dev/docs/test-parallel
- https://www.checklyhq.com/docs/learn/playwright/testing-in-parallel/
- https://www.browserstack.com/guide/playwright-parallel-test
