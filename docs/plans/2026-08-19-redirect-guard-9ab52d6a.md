# Plan — Redirect-target CI guard (#486)

**Issue:** #486  
**Decision consumed:** `DD-DEPLOY-1` in `docs/decisions.md`  
**No ADR:** This is a bounded CI guard implementing the already-recorded deployment decision; it introduces no new architectural or irreversible decision.

## Design

### Scope and boundaries

Add a Node 22 ESM guard at `scripts/check-redirect-targets.mjs`. It discovers function entrypoints from `supabase/functions/*/index.ts`; it does not contain a list of function names. The guard reads frontend paths directly from `pmo-portal/App.tsx`'s router declarations/configuration and rejects the `*` catch-all as proof of a real route. There will be no hand-maintained frontend route inventory.

The analysis boundary is deliberately lexical and one-hop only:

1. inspect redirect-target expressions in each discovered entrypoint, accepting static relative-path literals and origin-plus-static-path template literals;
2. when the expression is a directly imported path constant, read only that immediately imported module and resolve its exported static path value;
3. do not follow helper-function imports, re-exports, local-variable dataflow, or imports of the constants module.

Recognized redirect sinks are the direct `redirectTo` option, `Location` response-header value, and `Response.redirect(...)` call forms. A sink expression outside the accepted static forms is **unresolved**, not ignored. It must be covered by a reasoned allowlist entry. This intentionally is not a TypeScript compiler or a cross-module dataflow analyser.

### Guard data flow and failure model

`auditRedirectTargets(root, allowlist)` (exported from the guard for Node tests) will:

1. discover entrypoints and read route patterns from the real app source;
2. extract redirect candidates per function and classify each as resolved or unresolved;
3. normalize resolved targets to a pathname (discard query and fragment); compare segment-by-segment against concrete router patterns, treating `:parameter` segments on either side as a single-segment wildcard; and never accept `*`;
4. require each unresolved candidate to match exactly one allowlist entry; validate that entry's required, nonblank reason and its declared route path; and mark it used;
5. fail for an unknown route, unresolved/ambiguous target, invalid allowlist shape, missing function, allowlisted path no longer matched by the router, or an allowlist entry that was not used by a current unresolved candidate.

Errors will retain the existing guard style (`✗` plus an actionable indented reason) and, where applicable, identify the function and offending target. Empty entrypoint discovery or empty concrete-route extraction is a hard failure, preventing green-by-absence.

Add `scripts/redirect-target-allowlist.mjs`, exporting `REDIRECT_TARGET_ALLOWLIST`. Its initial value is an empty array. Each future exception has this exact reviewed contract:

```js
{
  function: 'edge-function-directory-name',
  expression: 'the current unresolved redirect expression',
  path: '/intended/frontend/:route-pattern',
  reason: 'non-empty explanation of why static resolution is impossible',
}
```

`function` + `expression` identify the exact unresolved sink, while `path` is checked against the live router. Therefore an exception becomes stale if the function, expression, or frontend route disappears, and cannot silently become a blanket exception for a function.

The current targeted callback helper remains outside this new scanner because it is reached through a non-constants helper import; its existing focused route test remains the owner for that helper. This is the requested no-transitive-analysis boundary, not a gap to extend in this issue.

### CI and verification

Expose `check:redirect-targets` in `pmo-portal/package.json` and include it in the local `verify` chain so `npm run verify:locked` exercises the real repository guard. In CI, `verify` therefore runs the guard on every PR (including the required PR-to-`main` promotion gate) and on the main smoke; this is stronger than the required PR-to-`main` coverage. Add `node scripts/check-redirect-targets.mjs --self-test` to CI's existing verify-job self-test group.

`--self-test` will create known-good and known-bad temporary source-tree fixtures, assert that the good fixture succeeds and the bad fixture fails, and exit non-zero if either polarity is wrong. It will not mutate the repository or invoke Supabase.

No database, RLS, API endpoint, frontend rendering, caching, migration, or e2e work is in scope.

## Acceptance traceability

| AC | Owning test | Layer |
| --- | --- | --- |
| AC-RDR-001 | `scripts/check-redirect-targets.test.mjs` — `AC-RDR-001: accepts direct and one-hop static redirect targets that resolve to live router routes` | Node unit |
| AC-RDR-002 | `scripts/check-redirect-targets.test.mjs` — `AC-RDR-002: rejects an absent route and reports its function and path` | Node unit |
| AC-RDR-003 | `scripts/check-redirect-targets.test.mjs` — `AC-RDR-003: matches parameterised redirect targets against parameterised router patterns` | Node unit |
| AC-RDR-004 | `scripts/check-redirect-targets.test.mjs` — `AC-RDR-004: rejects an unresolved redirect expression without a reasoned allowlist entry` | Node unit |
| AC-RDR-005 | `scripts/check-redirect-targets.test.mjs` — `AC-RDR-005: rejects unused, missing-function, and no-longer-routable allowlist entries` | Node unit |
| AC-RDR-006 | `scripts/check-redirect-targets.test.mjs` — `AC-RDR-006: --self-test proves known-good and known-bad fixture polarity`; CI self-test command asserted in `scripts/ci-integration-order.test.mjs` | Node unit / CI-contract |

## Implementation tasks

1. **Write RED fixtures/tests for direct static resolution and unknown-route diagnostics.**  
   - **Files:** create `scripts/check-redirect-targets.test.mjs`.
   - Build a temporary mini-repository fixture helper that writes `pmo-portal/App.tsx`, function `index.ts` files, and an optional one-hop constants file beneath a supplied root. Add AC-tagged `node:test` cases `AC-RDR-001` and `AC-RDR-002` as named in the traceability table. The good fixture must cover both `redirectTo: \`${siteUrl}/update-password\`` and an imported static path constant; its app source must contain the corresponding real routes. The bad fixture must contain a direct redirect to `/missing-route` and assert a non-zero audit result whose diagnostics contain both the function directory and `/missing-route`.
   - Import the not-yet-exported `auditRedirectTargets` from `scripts/check-redirect-targets.mjs` so these tests fail before the implementation exists.
   - **Verify (expect RED first):** `node --test scripts/check-redirect-targets.test.mjs`
   - **Covers:** AC-RDR-001, AC-RDR-002.

2. **Implement fail-closed entrypoint, router, and static-target auditing.**  
   - **Files:** create `scripts/check-redirect-targets.mjs`; create `scripts/redirect-target-allowlist.mjs` with `export const REDIRECT_TARGET_ALLOWLIST = [];`.
   - Resolve repository-relative paths from `import.meta.url`; discover only immediate `supabase/functions/*/index.ts` entrypoints and hard-fail on an empty inventory. Parse concrete absolute frontend route paths from `pmo-portal/App.tsx`, hard-fail if none are found, and exclude `*`/wildcard fallback routes from valid matches. Export `auditRedirectTargets(root, allowlist)` plus focused pure helpers for target extraction and route matching.
   - Detect the three direct redirect sink forms described in the design. Normalize a resolved literal/template target through `new URL(target, placeholderOrigin).pathname`; preserve the target text for diagnostics. Resolve named imports only when the imported module directly exports a static path literal; do not recurse beyond that module. Return an unresolved finding for any other sink expression rather than dropping it.
   - Make the CLI audit the repository using the empty allowlist, render existing-style `✗` diagnostics, and exit `1` on findings / `0` on success. Do not add transitive import walking or a route list outside `App.tsx`.
   - **Verify:** `node --test scripts/check-redirect-targets.test.mjs && node scripts/check-redirect-targets.mjs`
   - **Covers:** AC-RDR-001, AC-RDR-002.

3. **Write RED tests for parameter matching and allowlist failures.**  
   - **Files:** modify `scripts/check-redirect-targets.test.mjs`.
   - Add the named AC-RDR-003 case using `/projects/:id/tasks` against a real-router fixture pattern with a differently named parameter. Add AC-RDR-004 using a dynamic redirect sink with no allowlist and assert the failure requests an allowlist entry with a reason. Add AC-RDR-005 cases for (a) an allowlist entry whose function directory does not exist, (b) an entry whose declared path no longer matches a router route, and (c) an entry left unused after its unresolved source expression is removed. Every allowlist fixture entry must include `function`, `expression`, `path`, and `reason`.
   - **Verify (expect RED first):** `node --test scripts/check-redirect-targets.test.mjs`
   - **Covers:** AC-RDR-003, AC-RDR-004, AC-RDR-005.

4. **Implement parameter matching and strict allowlist consumption.**  
   - **Files:** modify `scripts/check-redirect-targets.mjs`; modify `scripts/redirect-target-allowlist.mjs` only if a documented empty-array shape comment is needed.
   - Compare normalized target and router paths by segments: static segments must equal; `:name` represents exactly one non-empty segment on either side; segment counts must agree; query/hash values must not influence matching. Keep `*` invalid even if it would match.
   - Validate every allowlist object before use: all four string fields are nonblank, `path` starts with `/`, `function` names a discovered entrypoint, `expression` equals a current unresolved sink for that function, and the declared `path` resolves to a concrete frontend route. Consume each entry once; report every unconsumed or multiply applicable entry as stale/ambiguous. For an unresolved candidate with no matching valid entry, emit an error that explicitly asks for an allowlist entry with a reason.
   - **Verify:** `node --test scripts/check-redirect-targets.test.mjs && node scripts/check-redirect-targets.mjs`
   - **Covers:** AC-RDR-003, AC-RDR-004, AC-RDR-005.

5. **Write the RED polarity test for the command-line self-test.**  
   - **Files:** modify `scripts/check-redirect-targets.test.mjs`.
   - Add the named `AC-RDR-006` Node test. Spawn `node scripts/check-redirect-targets.mjs --self-test`, assert exit status `0` for the shipped implementation, and assert its stdout reports both the known-good and known-bad fixture checks. The test must not accept a silent zero-exit process.
   - **Verify (expect RED first):** `node --test scripts/check-redirect-targets.test.mjs`
   - **Covers:** AC-RDR-006.

6. **Implement the guard-owned `--self-test` polarity proof.**  
   - **Files:** modify `scripts/check-redirect-targets.mjs`.
   - Add direct-main-module detection with `pathToFileURL(process.argv[1]).href` so importing the audit helpers has no CLI side effects. For `--self-test`, create isolated temporary known-good and known-bad source fixtures using the same exported audit core; require the good audit to have zero findings and the bad audit to have findings. Throw/exit non-zero when either expectation is inverted, print explicit successful fixture labels only when both assertions pass, and remove the temporary directory in `finally`.
   - Keep ordinary CLI usage strict: reject unknown arguments with usage and exit `2`; never run the self-test merely because the module was imported.
   - **Verify:** `node --test scripts/check-redirect-targets.test.mjs && node scripts/check-redirect-targets.mjs --self-test && node scripts/check-redirect-targets.mjs`
   - **Covers:** AC-RDR-006.

7. **Add a RED CI-contract assertion for both guard invocations.**  
   - **Files:** modify `scripts/ci-integration-order.test.mjs`.
   - Add a `node:test` case asserting that `pmo-portal/package.json` exposes `check:redirect-targets` as `node ../scripts/check-redirect-targets.mjs`, that the `verify` script invokes `check:redirect-targets`, and that `.github/workflows/ci.yml`'s `verify` job executes `node scripts/check-redirect-targets.mjs --self-test`. Bound the search to the `verify` job block so a mention in an unrelated comment or job cannot satisfy it.
   - **Verify (expect RED first):** `node --test scripts/ci-integration-order.test.mjs`
   - **Covers:** AC-RDR-006 CI wiring; preserves AC-RDR-001–005 promotion-gate execution.

8. **Wire the real guard and self-test into local and CI verification.**  
   - **Files:** modify `pmo-portal/package.json`; modify `.github/workflows/ci.yml`.
   - Add `"check:redirect-targets": "node ../scripts/check-redirect-targets.mjs"` and place `npm run check:redirect-targets` in the existing ordered `verify` chain alongside the other `check:*` gates. In CI's existing `CI integration-order test` shell block, add `node scripts/check-redirect-targets.mjs --self-test` after the other Node guard self-test(s), before dependency installation. Do not create a second workflow or a hand-maintained function/route list.
   - **Verify:** `node --test scripts/ci-integration-order.test.mjs && cd pmo-portal && npm run verify:locked`
   - **Covers:** AC-RDR-001 through AC-RDR-006.

9. **Record the deployment compatibility rule beside the production promote runbook.**  
   - **Files:** modify `docs/environments.md` in the standard production-promote section immediately after the command sequence.
   - Add a short `### Cross-boundary frontend/edge-function changes (DD-DEPLOY-1)` subsection stating: add and deploy a new frontend route before an edge function redirects to it; retain the old contract until the frontend that stopped using it is live; remove the old contract only in a later promote; and no fixed deploy order is safe in both directions, so ordering alone was rejected in favor of expand-then-contract compatibility. Preserve the existing DB-before-FE instruction as a database compatibility rule; do not imply it makes redirect changes safe.
   - **Verify:** `rg -n "expand-then-contract|No fixed deploy order" docs/environments.md`
   - **Covers:** DD-DEPLOY-1 documentation deliverable (no separate AC).

10. **Run the complete required verification and inspect the intended diff.**  
    - **Files:** all planned files only: `scripts/check-redirect-targets.mjs`, `scripts/redirect-target-allowlist.mjs`, `scripts/check-redirect-targets.test.mjs`, `scripts/ci-integration-order.test.mjs`, `pmo-portal/package.json`, `.github/workflows/ci.yml`, and `docs/environments.md`.
    - First run the focused tests and both guard modes from the repo root; then run the binding full suite from `pmo-portal/`. Confirm `git diff --check` is clean and `git diff --name-only` contains no lockfile, migration, e2e, or unrelated source changes. Do not push or open a PR.
    - **Verify:** `node --test scripts/check-redirect-targets.test.mjs scripts/ci-integration-order.test.mjs && node scripts/check-redirect-targets.mjs --self-test && node scripts/check-redirect-targets.mjs && cd pmo-portal && npm run verify:locked && git diff --check`
    - **Covers:** AC-RDR-001 through AC-RDR-006.

## Risks and controls

- **Parser drift / false green:** require non-empty inventories, parse errors to fail, explicit direct sink forms, and an externally executed good/bad self-test.
- **Overreach:** the one-hop import constraint is explicit and tested; do not evolve it into recursive TS analysis in this issue.
- **Exception creep:** exact sink identity, mandatory reason, route validation, single consumption, and stale-entry failure keep the allowlist narrow and auditable.
- **Router drift:** routes are extracted from `App.tsx` rather than duplicated; parameters are matched structurally while the catch-all remains invalid.
- **Performance:** the guard performs bounded filesystem reads (one entry file per function plus one imported constants module per direct reference and one router file), only in local/CI verification; it adds no runtime application cost.
