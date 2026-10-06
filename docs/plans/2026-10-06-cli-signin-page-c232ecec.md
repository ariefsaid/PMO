# Plan: PMO CLI loopback sign-in landing (#756)

> **Spec:** [`docs/specs/pmo-cli.spec.md`](../specs/pmo-cli.spec.md) (amended in Task 1)  
> **Date:** 2026-10-06  
> **Executor:** SSSF ADW, ordinary bounded CLI slice  
> **ADR:** None — this changes only loopback presentation and keeps the OAuth flow, storage, and public CLI contract unchanged.

## Preflight result and scope fence

The required shipped-on-`dev` check was performed against `dev` at `c72b0c40f1bc9a375d0ef2d44c2a6c3f2e5fdda7`. Its `scripts/pmo.mjs` callback still renders the plain `PAGE(title, body)` success message and does not contain the account identity or the local-tool explanation, so #756 is not already shipped.

Before building, repeat this check against the current `dev` tip:

```sh
git show dev:scripts/pmo.mjs | grep -n -E 'Signed in to PMO as|This page is served by the PMO command-line tool on your computer'
```

If both required strings are present in the maintained callback renderer, stop and report the `dev` commit; do not make a duplicate change. Do not read environment files, change the OAuth flow, add app assets or JavaScript to the page, touch migrations, or regenerate `package-lock.json`.

## Design

- Keep the loopback server and exact host/state validation in `scripts/pmo.mjs`. Replace only its HTML renderer with a small static document that uses inline CSS matching the existing PMO consent/login visual language: tinted neutral canvas, centred card, blue `P` mark plus `PMO Portal` wordmark, card border/radius, and distinct success/error presentation. It has no external assets and no `<script>`.
- Introduce one local `escapeHtml(value)` function that converts `&`, `<`, `>`, `"`, and `'` before interpolation. The page helper is the only HTML interpolation point; every dynamic email, OAuth `error`, and OAuth `error_description` passes through it. Never put the authorization code, tokens, state, or URL in the HTML.
- A valid code callback must retain its response handle while `login()` exchanges the code and obtains `/auth/v1/user`; only then send the success page, allowing the page to say `Signed in to PMO as <email>`. If the exchange or user lookup fails, end that retained response with the styled failure page before propagating the existing CLI error and cleanup.
- Callback failures remain HTTP 400 and do not settle an unrelated login: denied OAuth replies, expired/missing-code replies, and wrong-state/wrong-host replies receive the same PMO chrome with a clear, static failure heading/instruction. The query-provided error details may be shown only as escaped text. The existing terminal errors, state comparison, PKCE exchange, credential write timing, and JSON command output remain unchanged.
- Node’s built-in `node:test` is the lowest sufficient layer: it drives the ephemeral loopback server already used by `scripts/pmo.test.mjs`, captures the actual HTTP body, and proves both presentation and escaping without a browser/e2e dependency.

## Acceptance traceability

| AC | Owning layer | Canonical proof |
|---|---|---|
| AC-CLI-017 | Unit (`node:test`) | `scripts/pmo.test.mjs` — success and callback-error landing-page cases |

## Tasks

### Task 1 — Record the #756 requirement and test ownership

**Files:** `docs/specs/pmo-cli.spec.md`

1. Add `FR-CLI-013`: after `pmo login` receives a loopback callback, the CLI serves an English, static, inline-CSS PMO landing page; its successful page identifies the signed-in email and explains that the page is served by the PMO command-line tool on this computer; its denied, expired, and mismatched-state failures are clear PMO-styled error pages; all interpolated values are HTML-escaped.
2. Add `AC-CLI-017` in Given/When/Then form for the successful email-bearing page and the denied/expired/state-mismatch error pages, including inert rendering of hostile error-query text.
3. Add one traceability-table row assigning AC-CLI-017 to `scripts/pmo.test.mjs` at the unit layer.

**Verify:**

```sh
grep -n 'FR-CLI-013\|AC-CLI-017' docs/specs/pmo-cli.spec.md
```

### Task 2 — Write the failing loopback page tests first (AC-CLI-017)

**Files:** `scripts/pmo.test.mjs`

1. Extend the test-only loopback HTTP helper (or add a sibling helper) so it returns the response status, headers, and UTF-8 body rather than only the status; keep the current wrong-Host coverage using the same host override.
2. Add a success test tagged `AC-CLI-017` that completes a fake OAuth authorization through `runCli`, waits for the actual callback response, and asserts HTTP 200 plus the complete user-facing contract: PMO Portal/P logo mark, card/inline-style chrome, `Signed in to PMO as owner@example.test`, the exact local-tool explanation, and the close-tab instruction. Assert no `<script` appears in the response.
3. Add an error test tagged `AC-CLI-017` that sends a valid-state denied callback with an `error_description` containing `<script>…</script>`, then asserts HTTP 400, the PMO card/error copy and retry/close instruction, no raw script element, and the escaped `&lt;script&gt;…&lt;/script&gt;` text. In the same test or a table-driven case, request a wrong-state callback and an expired/missing-code callback and assert each receives HTTP 400 and clear PMO-styled error content while the wrong-state request does not complete the genuine login.
4. Run this file and confirm the new assertions fail against the current plain `PAGE` implementation before editing production code.

**Verify (red first):**

```sh
node --test scripts/pmo.test.mjs
```

### Task 3 — Render styled, escaped success and error loopback pages (AC-CLI-017)

**Files:** `scripts/pmo.mjs`

1. Replace the current two-string `PAGE(title, body)` helper with a single static-document renderer and `escapeHtml(value)`. The document must set `lang="en"`, include inline `<style>` only, use the PMO design-system light values (neutral tinted background, `#2563eb`-equivalent PMO blue mark, white bordered/radius-8 card, readable 14px body text), include the `P` mark and `PMO Portal` wordmark, and contain no external URL or script tag.
2. Give the renderer explicit `success` and `error` variants. Success receives only the fetched user email and renders the required signed-in sentence, local-tool explanation, and close-tab instruction. Error renders a static explanation for denial, expiry/no-code, or state mismatch plus the close/retry instruction; when it displays OAuth `error` or `error_description`, it HTML-escapes each value before interpolation.
3. Change the valid-code callback settlement value from just `code` to the code plus the still-open response writer. After the existing token exchange and `/auth/v1/user` call succeed, write credentials as before and then end that callback response with the success variant using `who.email`. If either post-callback API call fails, end the retained response with the error variant before rethrowing the existing `CliError`; do not persist credentials on that path.
4. Keep invalid host/state as an immediate styled 400 response that does not settle the callback promise; send styled 400 errors for denied, expired/missing-code, and duplicate callback attempts. Preserve the existing exact-host check, constant-time state comparison, status codes, cleanup, and terminal error payloads.

**Verify:**

```sh
node --test scripts/pmo.test.mjs
```

### Task 4 — Run the focused CLI final gate (AC-CLI-017)

**Files:** `scripts/pmo.mjs`, `scripts/pmo.test.mjs`, `docs/specs/pmo-cli.spec.md`

1. Re-run the complete node:test CLI suite after the implementation is green; do not weaken existing AC-CLI-008 state/PKCE assertions to accommodate the delayed success response.
2. Parse-check the shipped Node module, then inspect the changed-file diff to confirm it contains neither app assets/scripts nor any package-lock or migration change.

**Verify:**

```sh
node --check scripts/pmo.mjs && node --test scripts/pmo.test.mjs && git diff --check -- scripts/pmo.mjs scripts/pmo.test.mjs docs/specs/pmo-cli.spec.md
```

## Risks and controls

- **Response lifecycle:** showing the email requires holding the successful callback response until the existing exchange and user lookup complete. The callback’s reply writer must be ended in both success and exchange/user-failure paths so the browser cannot hang.
- **HTML injection:** OAuth callback query fields are attacker-controlled. Centralising interpolation behind `escapeHtml` and proving an inert script-shaped error string prevents HTML/script execution without changing the validation flow.
- **Regression surface:** the existing state/host checks are security-sensitive; retain their behavior and keep their existing node:test coverage unchanged. No DB, RLS, tenancy, caching, or client-app route is involved.
