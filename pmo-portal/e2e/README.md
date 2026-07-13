# E2E isolation contract (workers:4 — parallel by default)

Every spec declares one class on its first line: `// @e2e-isolation: <class>`.
`check-e2e-isolation.sh` (in `npm run verify` + CI) fails the build without a valid tag.

| Class | Use when | Rule |
|---|---|---|
| `read-only` | only navigates/asserts (incl. `page.route`-mocked edge fns) | no DB writes |
| `self-isolated` | you create your own data | name it uniquely (`${Date.now()}`) + clean up |
| `dedicated-row` | you own an expendable seed row (P012/P013…) | `beforeEach` resets it (retry-safe) |
| `serial` | you mutate ORG-GLOBAL state (entitlements, domain ownership, shared user roles) | file lives in `e2e/serial/`; runs at `--workers=1` |

Default to `read-only`/`self-isolated`. Reach for `serial` ONLY when the journey is intrinsically
org-global — never to paper over a race you could dedicate away. Never weaken an assertion to fit a lane.

Locally with CI parity (DB lock + `.env.local`): `scripts/e2e-local.sh` from repo root.