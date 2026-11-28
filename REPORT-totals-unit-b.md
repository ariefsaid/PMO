# Unit proof, part b: perf/1129-home-figures-totals (68d6da109) merged with origin/dev (no conflicts)

Note: branch tmp/1129-totals-unit-b already existed on the remote (another session's report), so this one is tmp/1129-totals-unit-b2.
Status: FINAL. CI flags: `vitest run --coverage --shard=N/8 --reporter=default --reporter=blob --reporter=json`.

- Shard 5/8: 355 files passed (355); 3524 tests passed (3524); 502s
- Shard 6/8: 355 files passed (355); 3893 tests passed (3893); 553s
- Shard 7/8: 356 files passed (356); 4101 tests passed (4101); 519s
- Shard 8/8: 356 files passed (356); 3537 tests passed (3537); 516s
- `npm run typecheck`: exit 0
- `npm run check:guards`: exit 0 (last line: layout-baseline guard self-test passed)

## Result
Shards 5-8: 1422 files, 15055 tests, all passed. No failed test files, so no solo re-runs were needed.
Setup: branch 68d6da109 merged with origin/dev (clean merge, no conflicts), npm ci, CI's unit flags (coverage on).
Log noise seen but not failing: `[agent-dispatch] AUTOMATION_FIRE_FAILED / AUTOMATION_MINT_FAILED` lines printed by passing tests.
