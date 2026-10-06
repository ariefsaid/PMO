# #874 review follow-ups

This change records the follow-ups from the #869/#872/#873 reviews. It is primarily test hardening and specification cleanup; the shipped reconnect implementation was not changed.

## What changed

- `supabase/tests/record_changes_visibility.test.sql` adds independent source-policy controls for the org-B and disabled-member cases. Each control proves the source row is visible, while the history policy still returns zero rows, binding its own-org and active-member predicates. The pgTAP plan increases from 14 to 18.
- `supabase/tests/0259_connect_rotate_compensation.test.sql` adds six assertions: a later successful first-connect rotate removes the abandoned first credential, retains the successful credential, clears `prev_binding`, and a direct caller is rejected by `finalize_external_connect`'s body-level service-role check. The plan increases from 41 to 47. Existing compensation and exact-prior-state checks remain in place.
- `supabase/functions/_shared/erpAuthPair.test.ts` adds `NFR-ENA-SEC-005`, asserting that a Vault-read store error logs only the fixed label and stable error code—not the error message, secret reference, environment coordinate, or credential value.
- `docs/specs/record-change-history.spec.md` now describes the shipped whole-row JSONB-in-memory approach, the transaction-local `set_config('app.actor_id', ..., true)` loader contract, service-role write access, caller-run function/manifest distinctions, the shipped `0260` migration paths, independently pinned visibility clauses, and the deferred History-tab `EXPLAIN (ANALYZE, BUFFERS)` review.
- `docs/plans/2026-10-06-record-change-history-data.md` aligns the plan with those decisions, narrows the trigger-order claim to triggers sharing the table prefix, updates assertion/mutation results, and records the History-tab scan-cost handoff.
- `docs/decisions.md` records `DD-CHG-1`, accepting the shipped in-memory diff behavior and assigning the production-shaped read-plan review to the History-tab work.
- `docs/plans/2026-10-06-review-followups-5db16dfd.md` and its `_v2`, `_v3`, and `_v4` revisions capture the evolving implementation plans, traceability, mutation checks, and scoped verification commands. The final plan iteration keeps the reconnect change as a regression proof only and does not add migration `0262`.

## Verification

The documented scoped checks are:

- Under the DB lock, run the visibility and reconnect pgTAP suites.
- Run the shared ERP auth tests and the ERPNext onboarding tests, including `deno check` for the onboarding handler.
- Run the isolation-denominator check, application typecheck/changed Vitest gate, and targeted ESLint check as specified in the final review plan.
- For binding proof, mutate each pinned policy clause, the successful-finalize prior-ref deletion, the finalize body guard, and the code-only logging branch; each corresponding test is documented to go red, then return green after restoration.

No UI, route, table, migration, package manifest, or lockfile change is shown in this diff.
