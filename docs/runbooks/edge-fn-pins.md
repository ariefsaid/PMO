# Edge-function dependency pins — check + bump cadence

Edge functions are Deno programs outside npm: each one carries its own `supabase/functions/<fn>/deno.json`
import map, and every package in it is pinned to an exact version. Nothing bumps those pins on its own —
Dependabot is scoped to `github-actions` (`.github/dependabot.yml`), and `scripts/audit-prod.mjs` audits the
npm trees the app ships. So a pin freezes past a security fix on the day it is written. This runbook is the
update path: one command that reports every pin, plus the cadence that moves them.

## The command

```bash
node scripts/check-edge-fn-pins.mjs
```

It scans every `deno.json` under `supabase/functions`, and for each distinct package reports:

- the exact spec(s) it is pinned at, and how many import maps pin it (with the first few named);
- the registry's latest published version — npm: `registry.npmjs.org/<pkg>/latest`, JSR: `jsr.io/<pkg>/meta.json`;
- advisory status from the npm registry's advisory feed (the source `npm audit` reads).

A JSR pin shows `advisory: not covered`. No advisory feed covers JSR packages, so **"not covered" is not
"clean"** — the report never says otherwise.

`PMO_FUNCTIONS_ROOT=<dir>` points it at a fixture tree (the unit tests do this).

### Exit code and what fails

| Exit | Meaning |
|---|---|
| 0 | No blocking finding. A pin *behind* latest is reported but does not fail. |
| 1 | At least one blocking finding: a published **advisory** on a pinned version, **drift** (the same package pinned at two versions), or an **unverified** pin — a registry/advisory lookup that failed, a non-exact spec (`^1.2.3`), an unversioned `npm:foo`, or an import the check cannot classify. |

Each lookup is retried **3 times with backoff (1s, 3s, 9s)** before it counts as unverifiable. This
runs on the release pull request, so one registry blip must not red the whole release run and spend a
CI cycle; a real outage still fails closed after about 13 seconds, and the report names the URL that
failed plus how many attempts it survived (`gave up after 4 attempts`). Everything else — an
advisory, drift, a range spec — is never retried away.

Outdated is a report, not a gate: being a release or two behind is ordinary, and a gate on it would red every
change that is not itself a bump. An advisory is different — it is a known defect in code that runs — so it
fails, at the release gate (see below), not on every branch.

### Coverage limits (stated, so nobody over-reads the report)

- **Direct imports only.** Transitive dependencies are what each `deno.lock` pins; CI's `deno` lane runs
  `deno check --lock … --frozen`, which fails if a lock and its `deno.json` disagree.
- **npm advisories only.** JSR is uncovered (above).
- **The advisory feed matches the pinned version.** That is why a range spec fails: it describes a spec, not
  the version that shipped, and the advisory lookup cannot honestly describe it.

## Cadence

Run it **at every release, before the promote** — it is step 0b of the standard promote checklist in
[`docs/environments.md`](../environments.md) ("The standard promote"). Also run it as soon as an advisory is
announced against a pinned package; that is the case where the answer is not "next release".

When it reports a blocking finding, or when the release is the scheduled bump:

1. **One PR, all pins.** Bump every behind pin across every `deno.json` together, on a branch off `dev`.
   Not one package at a time — the check fails on drift, and a half-moved pin set means the functions run on
   two versions of the same library.
2. **`@std/*` moves as one package.** `@std/assert`, `@std/testing/bdd`, `/mock`, `/time` are subpath exports
   of two packages; one version per package, never per subpath.
3. **Regenerate each touched function's `deno.lock`.** Editing `deno.json` alone leaves the lock stale and
   CI's `--frozen` check red. For each function whose pins changed:

   ```bash
   deno check --config supabase/functions/<fn>/deno.json supabase/functions/<fn>/index.ts
   ```

   Deno rewrites the adjacent `deno.lock`. Do this for `_shared` too: its import map is what the shared
   tests resolve against.
4. **Prove it.** The local lane for edge functions:

   ```bash
   bash scripts/deno-typecheck-edge-fns.sh
   bash scripts/deno-boot-smoke-edge-fns.sh
   bash scripts/deno-test-edge-fns.sh
   node scripts/check-edge-fn-pins.mjs        # 0 behind, 0 advisory
   ```

5. **Ship it as `chore(edge-fns): bump deno.json pins`**, naming the from → to versions in the body. A bump
   touches no product behaviour, so it is a PATCH-level change under ADR-0042.

A release that ships with an advisory still open on a pinned package is a release decision the owner makes
explicitly, not a silent pass: the check exits 1, and the release checklist step is the place that shows it.

## Where this is enforced

- **Release gate:** the CI `checks` job runs the command on a pull request to `main`
  (`.github/workflows/ci.yml`), so a promote carrying an advisory-carrying pin cannot merge silently.
  It is deliberately not on every pull request to `dev`: an upstream advisory would then wedge unrelated
  work instead of being fixed in the bump PR the cadence calls for.
- **Release checklist:** step 0b of "The standard promote" in [`docs/environments.md`](../environments.md).
- **Its own tests:** `scripts/check-edge-fn-pins.test.mjs` (run by `scripts/run-script-tests.mjs` in CI),
  with an injected `fetch` so they never touch the network. One test scans the real tree and fails if an
  import map ever gains an import the check cannot classify — an unreported pin is the failure mode this
  whole command exists to prevent.
