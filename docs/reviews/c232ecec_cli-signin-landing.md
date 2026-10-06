# CLI sign-in loopback landing

Issue #756 updates the callback page served by `pmo login` in `scripts/pmo.mjs`. Successful callbacks now wait for the existing token exchange and user lookup, then return a static PMO-styled HTML page identifying the signed-in email and explaining that the page is served by the PMO command-line tool on the local computer. Denied, expired/incomplete, mismatched, duplicate, and post-callback exchange failures return styled HTTP 400 error pages instead of the former plain text response. The OAuth flow, state/host validation, credential persistence, terminal errors, and JSON result remain otherwise unchanged.

The renderer uses inline CSS, a `P` mark/PMO Portal wordmark, a centered card, and no script or external assets. `escapeHtml` covers every dynamic email and OAuth error value interpolated into the page; the tests include script-shaped query text and assert it is rendered inert.

## Files

- `scripts/pmo.mjs` — escaped success/error page renderer, response settlement helper, and callback lifecycle changes.
- `scripts/pmo.test.mjs` — node:test coverage for successful account identification, PMO styling, denied/expired/mismatched callbacks, hostile-query escaping, and failed token exchange responses.
- `docs/specs/pmo-cli.spec.md` — records FR-CLI-013 and AC-CLI-017 and maps the acceptance criterion to the CLI tests.
- `docs/plans/2026-10-06-cli-signin-page-c232ecec.md` — implementation plan, preflight result, scope, risks, and verification commands.

## Verify

From the repository root, run:

```sh
node --check scripts/pmo.mjs
node --test scripts/pmo.test.mjs
git diff --check -- scripts/pmo.mjs scripts/pmo.test.mjs docs/specs/pmo-cli.spec.md
```

The plan records that the shipped-on-`dev` preflight found the plain callback page still present at the measured base, so this was not a duplicate of an already-shipped change.
