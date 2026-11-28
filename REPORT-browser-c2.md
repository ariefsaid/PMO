# Browser part c2: chromium shard 2/3 on 4f6cceffd

Command (as CI): `npx playwright test --project=chromium --shard=2/3 --reporter=list`
Local Supabase stack (db reset), env written like CI's "Write .env.local" step, same service env exported. Playwright config started the app itself; no separate edge-function serve step in the CI browser job.

## Counts
- Planned: 227 tests in 160 files (includes 10 auth setup tests)
- Passed 224 / Failed 3 / Skipped 0 / Flaky 0 (retries 0 in this run; no retry lines)
- Wall time: 33m46s

## Failures and solo re-run (one test, `--retries=0`)
| Test | First run | Alone | Verdict |
|---|---|---|---|
| AC-SHELL-001-phone-more-drawer.spec.ts:26 "phone More drawer opens, navigates, closes and returns focus (id)" | fail 30s timeout | fail 31s again | REAL (the (en) variant of the same test passes, 9.6s) |
| AC-SITE-012-construction-completion.spec.ts:7 "Admin names the CM owner and the CM files proof and confirms physical completion" | fail 31.6s timeout | pass 21.1s | load-sensitive (close to the 30s limit) |
| AC-SITE-BQ10-quality-evidence.spec.ts:7 "QC attaches evidence once to its owned work-order quality step" | fail 31.1s timeout | pass 23.9s | load-sensitive (close to the 30s limit) |

## Real failure detail: AC-SHELL-001 (id locale)
Failing step: spec line 34, `await more.click()` on the phone bottom nav's "Lainnya" (More) button.
Error: `Test timeout of 30000ms exceeded. locator.click: waiting for getByRole('navigation').filter({ has: getByRole('button', { name: /^lainnya$/i }) }).getByRole('button', { name: /^lainnya$/i })`
The locator never resolved: no navigation landmark with a button named exactly "Lainnya" appeared in Bahasa Indonesia, while the English run found its "More" button. The page screenshot was not inspected in words here; the rest of the app's state at failure is unknown. Likely the label in the id locale differs from `L.more` (or the id locale did not load), to be confirmed from the trace.

## Load-sensitive detail
- AC-SITE-012: timeout at 30s, no assertion text printed (the whole test timed out). Alone 21s.
- AC-SITE-BQ10: step at spec line 32 waited on `getByRole('tab', { name: 'Billing' })` with aria-selected expected true after clicking the billing doorway link; element not found within 5s, then test timeout. Alone 23.9s.

Notes: no secrets or customer names. The run rewrote four tracked evidence PNGs under docs/evidence/1215/2732/; they were reverted and are not committed.
