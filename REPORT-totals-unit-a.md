# Unit proof a: perf/1129-home-figures-totals (68d6da109) merged with origin/dev

Merge of origin/dev into the branch was clean (no conflicts). `npm ci` done. Shards ran one after another with CI's flags, `vitest run --coverage --shard=N/8 --reporter=default --reporter=json`, except the CI blob reporter, which only feeds the coverage merge job.

## Unit shards (of 8)
| Shard | Test Files | Tests | Duration |
|---|---|---|---|
| 1 | 350 passed (350) | 3356 passed (3356) | 429 s |
| 2 | 1 failed, 354 passed (355) | 1 failed, 3474 passed (3475) | 449 s |
| 3 | 354 passed (354) | 3440 passed (3440) | 438 s |
| 4 | 355 passed (355) | 3806 passed (3806) | 460 s |

## Repository script tests (from repo root, python venv built as the CI step does)
- `node scripts/run-script-tests.mjs --self-test`: ok (69 script tests, 10 exclusions all live)
- `node scripts/run-script-tests.mjs`: tests 1072, pass 1071, fail 1, cancelled 0, skipped 0 (684 s)

## Failures, each re-run once alone
Both fail alone too. Both are caused by this sandbox running as root (uid 0), where `chmod 000` does not make a file unreadable. Neither file is touched by the branch, and the branch changes no `scripts/` or `supabase/functions` file (0 of each in the diff against dev).

1. `src/lib/agent/checkEdgeFnErrorReporting.test.ts`, "the CLI itself CAN go red ... exits 1 and names the specific file when a function's index.ts cannot be read (unreadable-file case)". Fails alone (1 failed, 17 passed).
   - Error (first lines): `AssertionError: expected '✗ supabase/functions/erpnext-sweep/in…' to match /could not read this file/` at `checkEdgeFnErrorReporting.test.ts:165`. The test writes `index.ts` and `chmodSync(…, 0o000)`. As root the CLI can still read it, so it never prints "could not read this file".
   - Most likely responsible changed file: none of the branch's changes. It is a root-user artifact. CI runs as a non-root user.
2. `scripts/ci-e2e-coordination.test.mjs`, "AC-OPS-1133-2 outcomes: one dispatch attempt leaves durable uncertainty on nonzero or interrupted transport". Fails alone (13 tests, 12 pass, 1 fail, 27 s).
   - Error: `Expected "actual" to be strictly unequal to: 0` (`ERR_ASSERTION`, `notStrictEqual`), at `ci-e2e-coordination.test.mjs:719`. The assertion is `assert.notEqual(postSaveResult.status, 0)` in the fixture `makeFixture(t, { chmodRootAfterDispatch: true })`. The fixture relies on `chmod` blocking a write after dispatch, which root ignores, so the coordinator exits 0.
   - Most likely responsible changed file: none of the branch's changes. Same root-user cause.

## Result
No failure points at the branch. Every unit test the branch touches passed. The two failures need a non-root run to confirm, for example `su` to an unprivileged user; I did not do that. Nothing else failed.

No secrets or personal data are in this report.
