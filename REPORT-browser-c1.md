# Browser c1 report: chromium shard 1/3, commit 4f6cceffd

Command: `npx playwright test --project=chromium --shard=1/3 --reporter=list` (CI=true, so the built app is served as in CI; local Supabase via Docker, `db reset`, `.env.local` written as CI does; no retries are configured, so no test was retried). Edge functions were not served separately (CI's browser job does not serve them either).

## Counts
- Planned: 227 tests in 150 files
- Passed: 208
- Failed: 3
- Skipped: 14 (feature-flag quarantines and similar), plus 2 "did not run" (the two S21 tests that follow the failed one in its serial group) = 16 not executed
- Flaky: 0 (no retries)
- Wall time: 13.3 min (796 s) for the shard

## Re-run of each failure alone (once)
| Test | Full run | Alone | Verdict |
|---|---|---|---|
| AC-ECX-030 Admin requests a direct-cost account **in id** | failed, 10.5 s | failed again, 7.7 s (the `en` variant passes, 4.9 s) | **REAL** |
| AC-PCH-001 #2698 payment channels, Finance sets a channel and it persists | failed, 23.2 s | passed, 5.4 s | load-sensitive |
| AC-S21-005 "Supporting proof: Admin reviews the ClickUp list, saves the source…" | failed, 0 ms | passed (all 3 S21 tests, 4.1 s / 2.8 s / 1.9 s) | environmental, see below |

## Failure details
### 1. AC-ECX-030-direct-cost-account.spec.ts:5 (id variant), REAL
- Failing step: line 35, `expect(page.getByText('Belum ada akun biaya langsung untuk: Material')).toBeVisible()`.
- Error: `expect(locator).toBeVisible() failed`, `Locator: getByText('Belum ada akun biaya langsung untuk: Material')`, `Expected: visible`, `Timeout: 5000ms`, `Error: element(s) not found`. Call log: waiting for that text.
- Page showed (from the error-context snapshot): the Organization integrations settings screen, with the Microsoft 365 card, "Try again", "Approve in Microsoft 365", and a disabled "Choose default library". Nothing about a missing direct-cost account. The sidebar and the Admin account menu were present.
- Note: the English variant of the same test passes, so the Indonesian missing-account text or the screen the test lands on differs from what the test expects.

### 2. AC-PCH-001-purchase-payment-channel.spec.ts:29, load-sensitive
- Failing step: line 49, after `page.reload()` and clicking the Details tab, `expect(getByTestId('payment-channel-section').getByRole('combobox')).toHaveValue(/.+/)`.
- Error: `expect(locator).toHaveValue(expected) failed`, expected pattern `/.+/`, received `""`, timeout 5000 ms. The locator resolved 8 times to the `<select>`, and its value stayed empty.
- Page showed: the purchase Details tab with the payment-channel select present but nothing selected after the reload. Under full-shard load this took 23.2 s and failed. Alone it passed in 5.4 s.

### 3. AC-S21-005-task-list-review.spec.ts:124, environmental
- Failing step: test setup, in `support/AC-S21-005-runtime.mjs:18`, which starts the `external-lists` handler with `deno run --no-remote`.
- Error: `Error: S21_HANDLER_SERVER_EXITED_EARLY` (0 ms). The other two S21 tests did not run.
- Cause: the Deno npm dependencies for `supabase/functions/external-lists` were not in the sandbox's Deno cache. `--no-remote` then exits at once. After I ran `deno cache` for that function, all 3 S21 tests passed. CI's per-job setup is not reproduced here.

No secrets, customer names or personal data are in this report.
