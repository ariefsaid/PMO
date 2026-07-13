# Plan: e2e storageState auth reuse (#306)

**Issue:** #306 — reuse authenticated session so Playwright e2e stops paying a real bcrypt
sign-in per spec (the root cause that forces `workers: 1`).

**Branch:** `perf/e2e-storagestate` (off `dev`). Test-infrastructure only — no product `AC-###`
changes owner or layer (ADR-0010); every e2e journey keeps its exact goal-oracle.

## Operating constraint (binding)
**e2e cannot run in this container** — the Supabase stack images are registry-blocked here (proven
during the ADR-0036 spike). Local verification is limited to `npm run verify` (typecheck + lint +
Vitest + build) and `npx playwright test --list` (config parses + all specs still enumerate). The
**binding parallel-green proof (AC-2) runs in CI** — the `integration` job on a PR→`main` promotion.

## Design — reimplement `signIn`, keep the signature (zero spec churn)

72 specs call `signIn(page, email)` / `login(page, email)` with 8 seed emails; several call it 2–4×
to **switch users mid-test**. So the session-reuse must live *behind the existing `signIn` signature*,
not in per-project `storageState` (a project has one session → would break user-switching).

1. **`e2e/auth.setup.ts`** — a Playwright **`setup` project**. For each seed email, do ONE real
   browser form sign-in and save `page.context().storageState({ path: 'e2e/.auth/<email>.json' })`.
   This captures the EXACT localStorage the app uses (no key-guessing). 8 logins, serial, once per
   run — vs ~130 today. Small retry kept for the documented transient GoTrue flake.
2. **`e2e/helpers.ts` `signIn(page, email)`** — reimplement: read `e2e/.auth/<email>.json`, `goto('/')`,
   inject its localStorage entries via `page.evaluate`, `reload()`, assert `toHaveURL(/\/$/)`. Clear any
   prior session first so mid-test **user-switching** works (re-inject different email → reload). Keep
   the `login` alias. **Remove** the `SIGN_IN_MAX_ATTEMPTS` retry loop — its root cause (per-spec
   bcrypt under load) is gone. Signature unchanged → **72 specs untouched**.
3. **Untouched auth-journey specs** — the login-flow tests drive the form / Mailpit directly and do
   NOT rely on `signIn` for the step under test: `AC-AUTH-005` (magic-link), `AC-AUTHF-005`
   (password-reset — also mutates pm's password; injection uses the token so it still works),
   `AC-AUTHF-020` / `AC-INV-001` (invite). Confirm none regress via `--list` + read.
4. **`.gitignore`** — add `pmo-portal/e2e/.auth/`.

## The `workers` flip — separate, reversible, CI-proven
`playwright.config.ts`: add the `setup` project + `dependencies: ['setup']` on chromium. Flip
`workers` from `process.env.CI ? 1` to `process.env.CI ? 4` (runner core count) **in its own commit**,
with a comment: *if CI surfaces data-race flakes (shared-DB, not auth), revert this line to `1` — the
auth-reuse win stands regardless, and shared-DB data isolation is a separate follow-up.* AC-2's
"≥3 green runs at workers>1" is the gate; if it can't hold, workers→1 and we file the follow-up.

## Acceptance criteria (from #306)
- **AC-1** setup produces a valid `storageState` per seed role; a spec lands authenticated with no
  `/login` round-trip (injection).
- **AC-2** CI e2e green at `workers>1` across ≥3 runs (CI-proven on promotion; fallback documented).
- **AC-3** `AC-AUTH-005` / `AC-AUTHF-005` / `AC-INV-001` still exercise real auth and pass.
- **AC-4** the `signIn` retry/backoff workaround is removed.
- **AC-5** integration e2e wall-clock drops measurably (record in the promotion PR).

## Verification ladder
- Local: `npm run verify` green; `npx playwright test --list` enumerates all specs (no parse/import
  break); read the injection logic + `git diff`.
- CI: `verify` on PR→`dev`; the authoritative e2e proof on the `dev`→`main` promotion.
