# Unit proof b — perf/1129-home-figures-totals (68d6da109) merged with origin/dev (merge clean, no conflicts)
Run flags (CI unit job): `npx vitest run --coverage --shard=N/8 --reporter=default --reporter=json` (blob reporter omitted; outputs in scratch dir)

| Shard | Test Files | Tests |
|---|---|---|
| 5/8 | 355 passed (355) | 3524 passed (3524) |
| 6/8 | 355 passed (355) | 3893 passed (3893) |
| 7/8 | 356 passed (356) | 4101 passed (4101) |
| 8/8 | 356 passed (356) | 3537 passed (3537) |

- `npm run typecheck`: exit 0, zero errors
- `npm run check:guards`: exit 0 (all guards and self-tests passed)

Failed files: none, so no re-runs were needed. Result: green on shards 5–8.
