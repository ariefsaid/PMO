# Plan: expense claims and cash advances post to ERPNext (#775 phase B)

> **Spec:** [`docs/specs/expense-claims.spec.md`](../specs/expense-claims.spec.md) §10 (FR-EXP-100..118,
> NFR-EXP-010..014, AC-EXP-100..140, DD-EXP-12..22).
> **ADRs:** [ADR-0081](../adr/0081-expense-postings-single-originator.md) (new — one originator), ADR-0078, ADR-0059,
> ADR-0058. **Ground truth:** [`docs/spikes/2026-10-07-erpnext-employee-expense-postings.md`](../spikes/2026-10-07-erpnext-employee-expense-postings.md).
> **Executor:** money path — **Director-dispatched** (CLAUDE.md executor routing). Part 5 (UI) may go to an SSSF ADW
> with `--builder fe_builder --reviewer fe_reviewer` once parts 2–4 are on `dev`.
> **Migration slot:** `0263` **only** (`supabase/migrations/0263_expense_postings.sql` +
> `supabase/migrations/rollback/0263_expense_postings_down.sql`). If `0263` is taken when you start, stop and ask the
> Director — do not renumber on your own.
> **Dependency:** part 6 (the `expenses` employ switch) lands only after **#901** is on `dev` (spec §10.7).

## Parts

| Part | File | Tasks | Gate before the next part |
|---|---|---|---|
| 1 | this file | design, traceability, conventions, Task 0 | Task 0 green |
| 2 | [`…phase-b.part2-db.md`](2026-10-07-expense-claims-phase-b.part2-db.md) | D1–D12 — migration 0263, pgTAP, mutations, rollback, catalog gates, denominator, types | the four 0263 pgTAP files + the catalog gates green |
| 3 | [`…phase-b.part3-seam.md`](2026-10-07-expense-claims-phase-b.part3-seam.md) | S1–S19 — key, kinds, bodies, account rule, resolver, command (incl. cancel), probe | `npx vitest run src/lib/adapterSeam` green |
| 4 | [`…phase-b.part4-edge.md`](2026-10-07-expense-claims-phase-b.part4-edge.md) | E1–E17 — dispatch refusal, auth guard, writer, feed, webhook, poll, sweep pass, Admin action | `scripts/deno-test-edge-fns.sh` green |
| 5 | [`…phase-b.part5-ui.md`](2026-10-07-expense-claims-phase-b.part5-ui.md) | F1–F8 — account map page, postings card, strings | local final gate + rendered Discover |
| 6 | [`…phase-b.part6-cancel-e2e.md`](2026-10-07-expense-claims-phase-b.part6-cancel-e2e.md) | C0–C9 — #901 check, employ switch, served e2e, pre-enable checklist, PR | CI |

## 1. Design

### 1.1 Architecture (ADR-0081: one originator)

```
transition_expense_claim / record_expense_advance_return           (phase A RPCs — UNCHANGED except one insert in the latter)
   │ same transaction
   ▼
trigger enqueue_expense_claim_postings / enqueue_expense_return_posting   [DEFINER, EXECUTE revoked]
   │ only while org_employs_expense_postings(org)  (activated binding AND ownership row 'expenses')
   ▼
expense_posting_erp_mirror  (intent + side mirror; push_state pending|failed|held|pushed)   [FORCE RLS, SELECT-only to clients]
   │
erpnext-sweep, per org, pass (7) reconcileOrgExpensePostings  (expensePostingBackstop.ts, pure)
   ├─ findOutbox  → an outbox row exists for the key → replay it (buildReconcileDepsLive: frozen payload, re-auth)
   ├─ assertGate  → rpc expense_posting_for_push(org, intent)   [INVOKER, service_role only] — DB truth + actor's CURRENT standing
   ├─ resolve     → expensePostingResolve.ts  (employee link, account map + ERP account rule, project map, cash acct,
   │                approval JE dependency, company currency)    — refuse | wait | already-done | ready
   └─ driveFresh  → buildExpensePostingCommand (frozen payload) → checkErpnextCommandAuthorization
                    → dispatchMoneyWrite(buildMoneyWriteDepsLive(...))   ← the SAME outbox/claim/fence/probe as every domain
                         └─ adapter: Journal Entry (user_remark anchor) | Payment Entry (reference_no anchor, C-1 held)
                         └─ readModelWriters 'expenses' → intent pushed (+ approval tombstoned on a cancel)
inbound: sweep poll (Journal Entry filtered to PMO keys; Payment Entry filtered by party_type) → lifecycle only, never adopt;
         desk cancel → action-required unless PMO's own cancel
adapter-dispatch: NO 'expenses' route → 400 UNSUPPORTED_DOMAIN (no client can originate a posting)
Admin: external-set-company save-expense-account / clear-expense-account → validated against ERPNext → expense_account_map
```

### 1.2 Decisions taken in this plan (each is a DD in spec §10.2)

1. **One originator (DD-EXP-12, ADR-0081).** Rejected the ADR-0059 two-originator shape: its three defect classes
   (absent queue, originator race, mirror lost update) cost P3b a dozen review rounds, and no user waits on a posting.
2. **Employment and epoch are one switch (DD-EXP-13).** The trigger writes only while the org employs `expenses`;
   that gives OD-XING-1's "nothing pre-binding is pushed" for free and keeps standalone orgs byte-for-byte.
3. **Three kinds, not five (DD-EXP-14).** One kind per (doctype, direction): `expense-journal`, `expense-payment`,
   `expense-receipt`. The posting (`approval`, `settlement`, …) rides on the record, so the doctype→kind reverse map
   stays unambiguous for Journal Entry and Payment Entry keeps its existing payment-type routing.
4. **Resolve before the outbox, freeze into the payload, replay never re-decides (DD-EXP-15).** The sweep drives
   through `buildReconcileDepsLive`'s machinery (persisted payload, digest-bound), so the dispatch factory needs no
   expense branch and a since-changed map can never produce `idempotency-key-payload-mismatch` on a retry.
5. **Account map = table + validating server action (DD-EXP-16).** The spike's two refusals (Creditors, untyped
   advance) need ERPNext metadata, which only a server can read; a client-writable table would let the rule be skipped.
   The same pure rule (`expenseAccountRules.ts`) runs at save time and before every posting.
6. **Returns become rows (DD-EXP-17).** A posting needs a subject id; `returned_amount` is a running sum.
7. **Cancel only approvals, after they post; switch on after #901 (DD-EXP-18, DD-EXP-22).** Paid is terminal, so the
   spike's cancel-order hazard (a payment silently unlinked from a cancelled approval) cannot arise from PMO.

### 1.3 Data model (migration 0263)

| Object | Shape | Writers | Readers |
|---|---|---|---|
| `expense_advance_returns` | id, org_id (no default), advance_id → expense_claims, amount numeric(14,2) `>0 and <Infinity`, reference, recorded_by, recorded_at, returned_on | `record_expense_advance_return` only | claimant / approval rank (via parent RLS) |
| `expense_account_map` | id, org_id (no default), account_key ∈ 7 keys, erp_account (1–140), updated_by, updated_at; unique (org_id, account_key) | service role via `external-set-company` only | active members of the org |
| `expense_posting_erp_mirror` | id, org_id (no default), claim_id, return_id?, posting ∈ 6, posting_identity = `<subject>:<posting>` (CHECK), state_stamp, actor_id, push_state, push_error, erp_name, pushed_at, erp_docstatus, erp_modified, erp_amended_from, erp_cancelled_at, created_at; unique (org_id, posting_identity); queue index (org_id, push_state, created_at) where not cancelled | the 0263 triggers (insert), the sweep (service role) | claimant / approval rank (via parent RLS) |
| `org_employs_expense_postings(uuid)` | sql, invoker, service_role only | — | trigger, service_role |
| `enqueue_expense_posting(...)` | sql, invoker, EXECUTE revoked from every client role and service_role | — | trigger functions |
| `enqueue_expense_claim_postings()`, `enqueue_expense_return_posting()` | trigger, DEFINER, EXECUTE revoked | — | — |
| `expense_posting_for_push(uuid, uuid) → jsonb` | plpgsql, invoker, `service_role` only | — | erpnext-sweep |

### 1.4 Error handling

| Where | Refusal | Code / outcome |
|---|---|---|
| gate RPC | intent/claim not in org | P0002 → intent `failed` + notice |
| | actor null / inactive / other org / wrong role | 42501 `expense-posting-no-recorded-actor` / `-actor-inactive` / `-actor-cross-org` / `-actor-not-authorized` → `failed` + notice |
| | status or stamp no longer matches the intent | P0001 `expense-posting-precondition-failed` → `failed` + notice |
| resolver | binding company / currency | `config-rejected` → `failed` |
| | employee, account map, project, cash account, account rule | `employee-unlinked`, `expense-account-unmapped`, `project-unmapped`, `expense-cash-account-unconfigured`, `expense-account-invalid` → `failed` |
| | approval JE not yet posted | wait — intent untouched |
| | approval JE cancelled in ERPNext | `expense-approval-journal-cancelled` → `failed` |
| drive / replay | outbox row past its attempt budget | `held` `expense-posting-attempts-exhausted` |
| | outbox confirmed but intent still pending | `held` `expense-posting-mirror-diverged` |
| | ADR-0058 C-1 inconclusive Payment Entry recovery | `held` (`command-held`) |
| | any other dispatch error | `failed` with the classified code |
| Admin action | invalid key / blank account | 400 `BAD_REQUEST` |
| | FR-EXP-112 rule | 422 `config-rejected` (message names the account and the rule) |
| adapter-dispatch | `expenses` command | 400 `UNSUPPORTED_DOMAIN` |
| feed | native Journal/Employee Payment Entry | ack-and-skip `native-expense-posting-not-adopted` (no notice) |
| | desk cancel of a posted document | `expense-posting-desk-cancelled` notice (none for PMO's own cancel) |

Notices go through `surfaceActionRequired`, which already deduplicates against an unread notice with the same reason
and detail, so a stuck intent does not notify every tick.

### 1.5 Scaling, existing code, and risks

- **Per tick:** ≤ 200 intents per org (index-served). Before its write a posting reads one ERP Account per distinct
  account it needs (≤ 7, usually 2–3) + the Company (+ the Journal Entry for a cancel). Polls are server-filtered
  (`party_type`, `user_remark like 'exp%'`), so native payroll entries never reach PMO.
- **Behaviour change, intended (FR-EXP-113):** the procurement `payment` and revenue `incoming-payment` polls stop
  reading Employee Payment Entries. Today a revenue-owned org would adopt a native employee cash return as a customer
  receipt with no customer — a wrong number on the AR screens. Proven by AC-EXP-122.
- **Refactors with no behaviour change (proven by the existing suites):** `buildReconcileDepsLive` → extracts
  `buildMoneyWriteDepsLive` (E12); `resolveTimesheetRefs` → extracts `lookupConfirmedErpEmployee` (E12, same messages);
  `findTimesheetOutboxRow` → `findOutboxRowByKey` (E12); `budgetPushKey.ts` exports its epoch parser (S1); the sweep's
  per-kind poll filter becomes `pollFiltersForKind` (E9).
- **Head-of-line risk:** an intent that waits (its approval held) is re-listed every tick and uses the per-tick budget.
  Bounded by the approval being surfaced as failed/held; revisit only if one org ever has > 200 waiting intents.
- **Future Journal Entry kinds (#895 manual journals):** the Journal Entry reverse map now names `expense-journal`.
  #895 must add its own `user_remark` key prefix and a discriminator in `pollDiscriminatorForKind`, never share this one.
- **Latency:** postings land within one sweep interval (hourly today). Accepted in ADR-0081.
- **Offboarded actor (Q9):** a posting whose recorded approver/payer is no longer active is refused and surfaced; no
  re-attribution screen in this phase.

### 1.6 Files

| Path | Change | Part |
|---|---|---|
| `supabase/migrations/0263_expense_postings.sql`, `supabase/migrations/rollback/0263_expense_postings_down.sql` | new | 2 |
| `supabase/tests/0263_expense_{advance_returns,postings_enqueue,postings_acl,posting_gate}.test.sql` | new pgTAP | 2 |
| `scripts/isolation-probe-denominator.json` | +3 tables | 2 |
| `pmo-portal/src/lib/supabase/database.types.ts` | regenerated | 2 |
| `pmo-portal/src/lib/adapterSeam/erpnext/budgetPushKey.ts` | export the epoch parser | 3 |
| `pmo-portal/src/lib/adapterSeam/erpnext/{expensePostingKey,expenseAccountRules,expensePostingCommand,expensePostingResolve}.ts` (+tests) | new | 3 |
| `pmo-portal/src/lib/adapterSeam/erpnext/bodies/{expenseJournal,expensePayment}.ts` (+tests) | new | 3 |
| `pmo-portal/src/lib/adapterSeam/erpnext/{doctypeRegistry,feedKinds,companyScope,adapter,doctypeBodies,recoveryProbe,dispatchFactory}.ts` | kinds, domain, discriminators, probe, maps | 3 |
| `pmo-portal/src/lib/adapterSeam/erpnext/{expenseKinds,adapter.expenseJournalAmend,recoveryProbe.employee}.test.ts` | new | 3 |
| `pmo-portal/src/lib/adapterSeam/erpnext/{webhookEvent,feedErrorPolicy}.ts`, `dispatchFactory.ts` (employee lookup) | party routing, terminal code, shared helper | 4 |
| `supabase/functions/adapter-dispatch/{authGuard,readModelWriters}.ts` + `expensesRefused.test.ts`, `authGuard.expenses.test.ts`, `readModelWriters.expenses.test.ts` | delegate role, writer | 4 |
| `supabase/functions/_shared/erpnextFeedDeps.ts` + `erpnextFeedDeps.expenses.test.ts` | never adopt, lookup column, desk-cancel notice | 4 |
| `supabase/functions/erpnext-sweep/{index,expensePostingBackstop}.ts` + `expensePostingBackstop.test.ts`, `expensePollDiscriminators.test.ts` | pass (7), poll filters, deps extraction | 3 (field map), 4 |
| `supabase/functions/external-set-company/setup.ts` (+ `setup.test.ts`) | `save-expense-account`, `clear-expense-account`; employ `expenses` | 4, 6 |
| `pmo-portal/src/lib/repositories/{expensePostings.ts,expensePostings.test.ts,index.ts,types.ts}` | reads + Admin actions | 5 |
| `pmo-portal/pages/admin/ExpenseAccountMap.tsx` (+test), `pages/Administration.tsx` | Admin section | 5 |
| `pmo-portal/pages/expenses/ExpensePostingsCard.tsx` (+test), `pages/ExpenseClaimDetail.tsx` | record section | 5 |
| `pmo-portal/public/locales/{en,id}/common.json` | strings | 5, 6 |
| `pmo-portal/src/components/integrations/ErpSetupChecklist.tsx`, `IntegrationsView.test.tsx` | employ `expenses` in the UI | 6 |
| `pmo-portal/e2e/serial/_expHelpers.ts`, `pmo-portal/e2e/serial/AC-EXP-140-expense-postings-erp.spec.ts`, `scripts/check-e2e-skips.mjs` | served journey | 6 |

### 1.7 Traceability (one owning test per AC — ADR-0010)

| AC | Owning layer | Canonical proof | Tasks |
|---|---|---|---|
| AC-EXP-100 | pgTAP | `supabase/tests/0263_expense_postings_enqueue.test.sql` | D2, D4, D5, D10 |
| AC-EXP-101 | pgTAP | `supabase/tests/0263_expense_postings_enqueue.test.sql` | D2, D5, D10 |
| AC-EXP-102 | pgTAP | `supabase/tests/0263_expense_advance_returns.test.sql` | D1, D3, D5 |
| AC-EXP-103 | pgTAP | `supabase/tests/0263_expense_postings_enqueue.test.sql` | D2, D5 |
| AC-EXP-104 | pgTAP | `supabase/tests/0263_expense_postings_acl.test.sql` | D8, D9 |
| AC-EXP-105 | pgTAP | `supabase/tests/0263_expense_posting_gate.test.sql` | D6, D7, D10 |
| AC-EXP-110 | Vitest | `src/lib/adapterSeam/erpnext/expensePostingKey.test.ts` | S1, S2, S3 |
| AC-EXP-111 | Vitest | `src/lib/adapterSeam/erpnext/bodies/expenseJournal.test.ts` | S6, S7 |
| AC-EXP-112 | Vitest | `src/lib/adapterSeam/erpnext/adapter.expenseJournalAmend.test.ts` | S10 |
| AC-EXP-113 | Vitest | `src/lib/adapterSeam/erpnext/bodies/expensePayment.test.ts` | S8, S9 |
| AC-EXP-114 | Vitest | `src/lib/adapterSeam/erpnext/expenseKinds.test.ts` | S4, S5, E6, E7 |
| AC-EXP-115 | Vitest | `src/lib/adapterSeam/erpnext/expensePostingResolve.test.ts` | S13, S14 |
| AC-EXP-116 | Vitest | `src/lib/adapterSeam/erpnext/recoveryProbe.employee.test.ts` | S17, S18 |
| AC-EXP-117 | Vitest | `src/lib/adapterSeam/erpnext/expensePostingCommand.test.ts` | S15, S16 |
| AC-EXP-118 | Vitest | `src/lib/adapterSeam/erpnext/expenseAccountRules.test.ts` | S11, S12 |
| AC-EXP-127 | Vitest | `src/lib/adapterSeam/erpnext/expensePostingCommand.test.ts` | S15, S16 |
| AC-EXP-120 | Deno | `supabase/functions/external-set-company/setup.test.ts` | E14, E15 |
| AC-EXP-121 | Deno | `supabase/functions/erpnext-sweep/expensePostingBackstop.test.ts` | E10, E11, E13 |
| AC-EXP-122 | Deno | `supabase/functions/erpnext-sweep/expensePollDiscriminators.test.ts` | E8, E9 |
| AC-EXP-123 | Deno | `supabase/functions/adapter-dispatch/expensesRefused.test.ts` | E1 |
| AC-EXP-124 | Deno | `supabase/functions/adapter-dispatch/readModelWriters.expenses.test.ts` | E3, E4 |
| AC-EXP-125 | Deno | `supabase/functions/adapter-dispatch/authGuard.expenses.test.ts` | E2 |
| AC-EXP-126 | Deno | `supabase/functions/_shared/erpnextFeedDeps.expenses.test.ts` | E5, E6 |
| AC-EXP-128 | Deno | `supabase/functions/external-set-company/setup.test.ts` | C1, C2 |
| AC-EXP-130 | Vitest/RTL | `pages/admin/ExpenseAccountMap.test.tsx` | F3, F4 |
| AC-EXP-131 | Vitest/RTL | `pages/expenses/ExpensePostingsCard.test.tsx` | F5, F6 |
| AC-EXP-132 | Vitest | `src/lib/repositories/expensePostings.test.ts` | F1, F2 |
| AC-EXP-140 | Playwright (serial, served) | `e2e/serial/AC-EXP-140-expense-postings-erp.spec.ts` | C3, C4, C5 |

Mutation checks (mandatory, do not commit): M1–M6 (D10), M8–M10 (S12, S14), the S10 anchor mutation, M11 (E1),
M12 (E15), M13 (E9), M14 (E6).

### 1.8 Conventions for every task

- Paths are relative to the worktree root (a worktree off `origin/dev`, made by the Director). Run npm/vitest inside
  `pmo-portal/` as `../scripts/with-test-lock.sh npx vitest run <file>`. DB commands under `scripts/with-db-lock.sh`; a
  reset and the tests after it in ONE lock hold:
  `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db <files>'`.
- Deno tests use the CI invocation (`scripts/deno-test-edge-fns.sh`): a function's test
  `cd supabase/functions/<fn> && deno test <file> --config deno.json --allow-env --allow-net --allow-read`; a `_shared`
  test `cd supabase/functions/erpnext-sweep && deno test ../_shared/<file> --config deno.json --allow-env --allow-net --allow-read`.
- Every pgTAP denial asserts errcode **and** message. Every served-handler Deno test imports the SHIPPED `./index.ts`
  and mocks `fetch` (`../_shared/testing/edgeTestKit.ts`); no dependency injection is added to production code for a
  test.
- Mutation checks marked **(do not commit)** are mandatory: make the change, run the named test, see it red, revert,
  see it green. Record "M#: red → reverted green" in the PR body.
- No PII or secrets in fixtures: example.com / example.test addresses, synthetic keys. Never read env files; the
  Director exports bench credentials for the e2e.
- Local final gate before any PR (CLAUDE.md): `npm run typecheck`, `npx eslint --max-warnings=0 <touched files>`,
  `npx vitest run --changed origin/dev`, touched deno tests, touched pgTAP files, touched e2e.

## 2. Task 0 — preflight (3 min)

```bash
cd "$(git rev-parse --show-toplevel)"
ls supabase/migrations/0247_expense_claims.sql                       # phase A is on this base
ls supabase/migrations/0263_* 2>/dev/null && echo "0263 TAKEN — stop" || echo "0263 free"
gh issue view 901 --json state -q .state                            # record it; part 6 needs CLOSED + the fix on dev
```

Expect: the 0247 file exists; `0263 free`. If `0263` is taken or 0247 is missing, stop and report to the Director.
Record #901's state in the PR description; parts 2–5 proceed regardless.

Next: [part 2 — database](2026-10-07-expense-claims-phase-b.part2-db.md).
