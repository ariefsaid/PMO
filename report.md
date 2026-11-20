# round2-prove-3 — verification of origin/land/1215-r2 @ 89e4af8a4

Target already contains origin/dev c25474588 (dev had not moved). No duplicate migration numbers (checked `ls supabase/migrations | sed 's/_.*//' | sort | uniq -d`: empty). No code changed, nothing committed to a work branch. Sandbox: 4 CPU / 15 GB, Docker started by hand, Supabase CLI 2.122.1, stack started with `-x imgproxy,logflare,vector,studio,realtime` (Mailpit on).

## Summary
| Step | Result |
|---|---|
| `supabase start` + `db reset` | OK (all migrations apply, seed OK) |
| Full pgTAP (`supabase test db`) | 874 files / 19,560 tests. PASS once the CI step "Anon-definer inventory include" (`node scripts/anon-definer-inventory.mjs`) is run first; without it 0178 fails on the missing generated include (my omission, CI runs that step before pgTAP; with it 0178 = 9/9 ok) |
| Rollback harness `scripts/test-2195-capture-rollback.sh` + nightly-intent/journal node tests | PASS (45 pgTAP tests; node 5/5) |
| `npm ci`, `typecheck`, `check:guards` | all exit 0 |
| Full vitest (`npm test`) | 2262 files passed, 1 failed, 1 skipped; 24,121 tests passed, 1 failed (2,457 s) |
| Browser chromium shards 1/3, 2/3, 3/3 (DB reset before each) | 150+160+162 passed; 2+4+1 = 7 failed (below) |
| consent lane | 7/7 passed |
| serial lane (`--workers=1`) | 53 passed, 1 failed (AC-PPL-010), 63 skipped (all allowlisted ERPNext/flag skips) |
| served-fn smoke | NOT RUN: needs repo secret and the `supabase/edge-runtime` image, which could not be pulled here (registry data-limit errors on ghcr/docker.io/ecr). CI must prove it |

CI parity notes: `CI=true`, `.env.local` + service-role env as in ci.yml, `retries: 0` per playwright.config. I ran chromium as three sequential shards to mirror CI. Serial was run twice: once in CI form, once with `--grep-invert AC-PPL-010` to see the rest of the lane (53 passed, 63 skipped, exit 0). `scripts/check-e2e-skips.mjs` over all five reports: 81 skipped, 2 unexplained (both are the S21 follow-on skips caused by the S21 failure), 0 stale.

## Failures
"Isolated" = re-run alone, target, with a fresh `db reset` where stated.

### A. Real, reproducible on the target, not on dev alone
1. **AC-PPL-010 people register** (`e2e/serial/AC-PPL-010-people-register.spec.ts:54`, serial lane) — `locator.fill` timeout waiting for textbox "Warn this many days before expiry". Fails on the target in CI form and in isolation after a fresh reset (2.1 min timeout); passes on origin/dev after a fresh reset. Root cause (screenshot + diff): the target contains `b2b048fa8 Revert "Merge fix/uat-admin at 89da95653"`, which deletes `pages/admin/DocumentTypes.tsx` (+ test, `documentExpiry.admin` tests and its locale strings). That component is the only place the "Warn this many days before expiry" field was rendered, and the people-register spec (which also lives only on the target, docs/specs/people-register.spec.md) still drives it. People page renders (empty state, tabs fine), the field is simply gone. Touches: the revert commit vs the people-register change. Fix is one of: restore the doc-type/warning-days admin surface, or the people-register work must bring its own.
2. **JOB-PC24 material request against plan** (`e2e/JOB-PC24-material-request-against-plan.spec.ts:32`) — "Send for approval" never enabled (329 retries, 3 min). Fails in the shard and isolated. Spec does not exist on dev (added by `46f4ff40b`, "contractor job journeys (draft)"), so "dev alone" = not applicable. Root cause (screenshot + `pages/MaterialRequestNew.tsx:95,144,191`): the new material-request UI from the merged `feat/2524b-material-requests-ui` disables Send when the project has no warehouse/location ("This project has no site, yard or staging location yet…"); the spec's `projectWithWorkOrders` fixture creates a project with no location. A fixture gap against a deliberate rule, not an app defect. Fix: add a location in the fixture (a draft spec).
3. **JOB-PC18 issue with attachment** (`e2e/JOB-PC18-issue-with-attachment.spec.ts:20`) — `getByRole('button', {name: /open E2E-Issue…/})` times out (2.5 min). Fails in the shard and isolated. Spec does not exist on dev (same draft commit `46f4ff40b`). Root cause (screenshot): the incident was filed and shows in the list; the row is not a `button`. Commit `0c8c59b83 fix(ui): use semantic links for record actions` (already on dev) made record rows links, so the draft spec's role is stale. Fix: `getByRole('link', …)`.

### B. Fail on origin/dev too (not caused by the target)
4. **AC-S21-005 task-list review** (`e2e/AC-S21-005-task-list-review.spec.ts:124`; two follow-on tests then skip) — `S21_HANDLER_SERVER_EXITED_EARLY` from the `deno run --no-remote` handler spawn. Also red on origin/dev c25474588 in this sandbox. Root cause not found: deno 2.7.11 is installed, and the same command with the same flags resolves imports and starts (it only dies reading the stdin bootstrap I did not send), so the early exit is specific to the spawned child inside playwright (stderr is discarded by design). Likely sandbox (deno cache/permissions), not a code regression, but unproven. CI installs deno 2.7.11 in the shard job, so CI's result is the arbiter.
5. **vitest `src/lib/agent/checkEdgeFnErrorReporting.test.ts` "exits 1 and names the specific file when … index.ts cannot be read"** — `chmod 000` does not make a file unreadable for uid 0; this sandbox runs as root. Environment artifact; file is identical on dev; re-ran alone: still fails as root. Would pass as a normal user (not verified).

### C. Failed in the full run, pass on isolated re-run on the target (load flakes, 4 vCPU running the default worker count)
6. **AC-IMT-014 rate import failed rows** (`e2e/AC-IMT-014-rate-import-failed-rows.spec.ts:44`, shard 1) — first run: timeout on `button "Rate catalogue"`; screenshot showed the project overview of a Negotiation-stage SP project at `/billing` (oldest project at the time, no billing surface). Isolated on target after a reset: PASS (10.8 s); passes on dev. The spec picks "oldest non-archived project" by `created_at`, so it is order/seed-state sensitive; a candidate for a hardening ticket, not a regression.
7. **AC-MTG-060 meeting minute action** (shard 1) — timeout waiting for the meeting detail URL after Save (form still on "New meeting"). Isolated: PASS; dev: PASS.
8. **JOB-W10 return leftover** (shard 2) — return row not on the ledger within 15 s. Isolated: PASS.
9. **layout/project-detail.layout `@layout AC-008 … 1440px in id/light`** (shard 3) — heading "Laba rugi proyek" not found in 5 s. Isolated whole file on target: PASS; dev: PASS. Timing (page load under 4-way parallel load).

## Not proven here
- served-fn smoke lane (see above).
- AC-S21-005 and the one root-run vitest case need a normal CI run to confirm.
- Serial skip count (63) equals the allowlisted ERPNext/flag skips; ERPNext money e2e is local-bench only.

## Recommendation
Blockers on the land branch: **AC-PPL-010** (revert removed the warning-days admin UI the people register depends on). **JOB-PC24 and JOB-PC18** are stale draft journeys (fixture lacks a project location; role button→link) to fix in the spec files. Everything else is sandbox- or load-induced; re-confirm in CI.
