# Feature: Budget account map — several ERP accounts per budget category (#768)

> **Status:** Draft for Director sign-off (2026-10-06). Plan: `docs/plans/2026-10-06-budget-account-map-multi.md`.
> No ADR: this relaxes one constraint inside the shipped map (P3c, `0137`) and adds one flag; no new seam,
> table, domain or integration posture.
> **Tier:** money path (the map decides which ERP account a pushed budget lands on) → Director-dispatched.
> **Grounds (read, not re-derived):** `docs/specs/erpnext-adapter-p3c-budget.spec.md` FR-BUD-110..114 (the map,
> fail-closed, the body); `supabase/migrations/0137_budget_push_seam.sql` §2; `0153` `get_budget_projection`
> (actuals join); `docs/decisions.md` OD-BUDGET-4 (fixed category enum), DD-PB-1 (a map edit is not a re-push
> trigger); ADR-0048 (PMO never invents an accounting split); ADR-0059 (budget is Posture B, PMO is SoT);
> `docs/money-path-primer.md`.

## 0. Director decisions (`DD-BAM-n` — ruled 2026-10-06, see `docs/decisions.md`)

- **DD-BAM-1 — Keep the eight categories; add none in #768.** *Premise correction:* the issue says "seven
  categories". There are eight: #804 (`0229`) added `Special expenses`. Categories are a fixed Postgres enum
  (`public.budget_category`), not org-configurable (OD-BUDGET-4: "fixed enum for MVP; seamed configurable later").
  Ruling: no new categories here. With several accounts per category, the client's hotel, transport and
  field-cost accounts can all sit under one existing category (default: `Special expenses`), so
  budget-vs-actual compares like with like without a new enum value.
  *Why not add them now:* every enum value ripples into the enum migration (with `0229`'s guarded rollback), the
  generated types, `pmo-portal/types.ts`, en/id labels and `budgetCategoryLabel.ts`, `scripts/lib/pmo-load.mjs`
  `BUDGET_CATEGORIES` + its parity test, the map page and the ERP setup checklist total, the budget editor,
  the import descriptor, and #803's procurement category select. In #803 each category is a separate budget
  line, so travel and field spend would get separate approval limits. Adding values is cheap when wanted
  (#804 did one in a single PR), but whether travel and field need **separate lines** is the client's call
  (owner question Q1). The management pack (`monthly-management-pack.spec.md`) does not read categories, so it
  is unaffected either way.
- **DD-BAM-2 — A flag column, not a new table.** `budget_category_account_map` gains
  `is_push_target boolean not null default true`. `unique (org_id, category)` is replaced by a **partial** unique
  index `(org_id, category) where is_push_target`, so each category has at most one push account. `unique (org_id,
  erp_account)` **stays**: each account still maps back to exactly one category, which is what lets the forward
  view attribute account-level actuals without inventing a split (ADR-0048). This supersedes the first half of
  FR-BUD-111 ("one category → exactly one account") and keeps the second.
  *Why default `true`:* every existing row becomes its category's push account with no backfill, so single-account
  orgs behave exactly as before. A writer that does not know the flag (old FE, seed, pgTAP fixtures) can still
  write a category's first account, and gets 23505 if it tries to add a second. That also makes the
  back-to-front deploy safe (§6).
- **DD-BAM-3 — A category with accounts but no push account blocks the push, the same way an unmapped category
  does.** The push reader takes only push rows, so such a category reads as unmapped for the push, and
  FR-BUD-113's existing fail-closed path refuses the push before any ERP call, naming the category. For actuals
  the category still counts as mapped: PMO has accounts to ask the ledger about. No DB constraint enforces "at
  least one push account". A deferred constraint trigger would add cost and protect against nothing worse than a
  named, loud refusal. The UI stops an Admin removing the push account while the category has other accounts.
- **DD-BAM-4 — Changing the push account does not re-push a budget (DD-PB-1 stands).** It takes effect at the next
  push. The confirmation says so in plain words. Re-pushing because config changed is the owner ruling DD-PB-1
  left open, and this issue does not take it.
- **DD-BAM-5 — Actuals need no RPC change.** `get_budget_projection` (`0153` §3a `actuals` CTE) already joins
  `erp_actuals_snapshot.account` to `budget_category_account_map.erp_account` and groups by category, so once a
  category can hold several rows it sums all of them. The `mapped` CTE (C-1, "can PMO ask the ledger?") checks
  for any row. A new pgTAP proves both. The function is not redefined.
- **DD-BAM-6 — Accepted consequence of AC-BAM-003 (stated, not decided here).** ERPNext enforces its overspend
  control only on the push account. It compares that one account's postings against the whole category budget,
  so spend on the other accounts never triggers an ERP warning. PMO's own budget-vs-actual covers every account.
  The default overspend action is `Warn` (FR-BUD-131), so the effect is fewer ERP warnings, not blocked
  purchases. A group account as the ERP target is out of scope: the bench spike did not verify ERPNext's
  behaviour for budgets on group accounts (`docs/spikes/2026-07-16-erpnext-budget-fields.md` §10(e)).

## 1. Job story

When my chart of accounts splits one cost class over several accounts (salary, allowance, social security;
hotel vs transport), I want a budget category to map to all of them, so budget-vs-actual compares like with like.

## 2. Today (read from the tree)

- `0137` §2: `unique (org_id, category)` and `unique (org_id, erp_account)`, so the map is one-to-one.
- `pages/admin/BudgetAccountMap.tsx`: one account per category row; edit/unmap are keyed by category.
- Push: `dispatchFactory.ts` `readCategoryAccountMap` → `categoryAccountMap.ts` `resolveBudgetAccounts` →
  `bodies/budget.ts`. The same reader feeds the gate (`adapter-dispatch` `buildBudgetGateDeps`, `budgetGate.ts`)
  and the sweep (`erpnext-sweep/index.ts`). `resolveBudgetAccounts` builds `new Map(category → account)`, so if a
  category had two rows the last one would win silently.
- Actuals: `erp_actuals_snapshot` holds every GL account (the sweep does not filter by the map). The forward
  view's join already sums per category.
- `external-set-company/setup.ts` readiness returns one category per map row. `ErpSetupChecklist.tsx` shows
  "`length` of 8 configured", so a category with three accounts would be counted three times.
- `seed.sql` and `e2e/serial/_budHelpers.ts` write the map with `on conflict (org_id, category)` /
  `onConflict: 'org_id,category'`. Both break once that unique constraint is gone.

## 3. Requirements (EARS)

- **FR-BAM-001 (ubiquitous)** The account map shall allow one or more ERP accounts per budget category, and
  shall allow each ERP account to belong to at most one category per org.
- **FR-BAM-002 (ubiquitous)** The account map shall hold at most one push account per (org, category),
  enforced by the database.
- **FR-BAM-003 (event)** When an Admin adds an account to a category that has no push account, the system
  shall make it the push account. When the category already has one, the new account shall be added
  read-only (actuals only).
- **FR-BAM-004 (event)** When an Admin chooses an account as its category's push account, the system shall,
  in one transaction, clear the category's previous push account and set the chosen one. Only an active
  Admin of the row's org may do this, and RLS is the authority (FR-BUD-112).
- **FR-BAM-005 (event)** When a budget is pushed, the system shall send each non-zero category's whole total
  to that category's push account only: one `accounts[]` row per category. Read-only accounts never appear
  in the ERP body.
- **FR-BAM-006 (conditional)** If a non-zero category has accounts but no push account, the push shall be
  refused before any ERP call as `budget-category-unmapped`, naming the category (FR-BUD-113's path).
- **FR-BAM-007 (conditional)** If the map handed to the push has more than one account for a category, the
  push shall be refused (`commit-rejected`) naming the category, never resolved by picking one.
- **FR-BAM-008 (ubiquitous)** The forward view's `actuals_to_date` for a category shall be the sum of `net`
  over every account mapped to it, push and read-only alike. A category with at least one mapped account
  counts as having an account to read (C-1).
- **FR-BAM-009 (ubiquitous)** The ERP setup readiness shall count each category with a push account
  exactly once, however many accounts it lists.
- **FR-BAM-010 (ubiquitous)** The Admin map surface shall list every category with all of its accounts and
  mark the push account. Admins get: add an account per category; edit, use for push and remove per
  account. Non-Admins see the same content read-only.
- **FR-BAM-011 (state)** While a category's push account has sibling accounts, the surface shall not offer
  to remove it, and shall say that another account must become the push account first.
- **FR-BAM-012 (state)** While a category has accounts but no push account, the surface shall mark it
  "No push account — blocks every push".
- **FR-BAM-013 (event)** When an Admin chooses a new push account, the surface shall confirm first and say
  the change applies from the next push. A budget already in the ERP keeps its account (DD-BAM-4).
- **NFR-BAM-001 (reversible, behaviour-preserving)** The migration shall be reversible with a guarded manual
  rollback. Every existing row shall become its category's push account, so a single-account org's push
  body, projection and setup count are unchanged.
- **NFR-BAM-002 (tenancy)** RLS policies, grants and the `org_id` seam on the table shall be unchanged. The
  new function shall be `SECURITY INVOKER` (so the table's RLS applies) and not executable by `anon`.
- **NFR-BAM-003 (no new round trips)** The push shall issue no extra DB read and no extra ERP call: the filter
  rides on the existing map read.

## 4. Acceptance criteria (Given/When/Then)

Owner ACs (from the issue) are AC-BAM-001..003. AC-BAM-004..011 are Director-derived refinements needed to
test FR-BAM-004..013. They add no behaviour the owner did not ask for.

- **AC-BAM-001** *Given* an active Admin of org A, *when* they map Labor to `Salary` (push) and then to
  `Allowances` and `Social Security` (read-only), *then* all three rows persist. *When* they add a second
  push account to Labor, *then* 23505 on the push-uniqueness index. *When* they map `Allowances` to
  Overheads, *then* 23505 on `(org_id, erp_account)`. (FR-BAM-001/002, NFR-BAM-001)
- **AC-BAM-002** *Given* Labor mapped to three accounts and the current actuals snapshot holding net 100,
  20 and 30 on them plus 999 on an unmapped account, *when* the forward view is read for that project and
  year, *then* Labor `actuals_to_date` = 150. (FR-BAM-008)
- **AC-BAM-003** *Given* Labor mapped to `Salary` (push), `Allowances` and `Social Security` (read-only), and
  a budget with Labor lines of 30,000.00 and 20,000.00, *when* the push map is read and resolved, *then* the
  ERP accounts are exactly `[{Salary, 50000.00}]`. *Given* another org's push row, *then* it is not read.
  (FR-BAM-005, NFR-BAM-003)
- **AC-BAM-004** *Given* Labor's push account is `Salary`, *when* the Admin calls
  `set_budget_push_account(<Allowances id>)`, *then* `Allowances` is Labor's only push account. *When* a
  Finance user calls it, *then* 42501 `not authorized to set the budget push account` and nothing changes.
  *When* org B's Admin calls it with org A's row id, *then* P0002 `budget account mapping not found`. *And*
  `anon` cannot execute it, *and* it is `SECURITY INVOKER`. (FR-BAM-004, NFR-BAM-002)
- **AC-BAM-005** *Given* Labor rows that are all read-only, *when* a budget with a non-zero Labor amount is
  resolved for push, *then* `BudgetCategoryUnmappedError` names `Labor`, and no account row is emitted.
  (FR-BAM-006)
- **AC-BAM-006** *Given* a map handed to `resolveBudgetAccounts` with two Labor rows, *when* it resolves,
  *then* it throws `commit-rejected` naming `Labor`. (FR-BAM-007)
- **AC-BAM-007** *Given* map rows Labor (push), Labor (read-only), Materials (read-only only) and Equipment
  (push), *when* ERP setup readiness is read, *then* `budgetMappedCategories` = `["Labor","Equipment"]`.
  (FR-BAM-009)
- **AC-BAM-008** *Given* Labor with `Salary` (push) and `Allowances`, and Materials with one read-only
  account, *when* the map renders, *then* both Labor accounts show, only `Salary` carries "Budget push",
  Labor is not marked blocking, Materials shows "No push account — blocks every push", and an Engineer sees
  no buttons. (FR-BAM-010/012)
- **AC-BAM-009** *Given* that map, *when* the Admin adds `Social Security - PSC` to Labor, *then*
  `create('Labor','Social Security - PSC', false)`. *When* they add `Raw Materials - PSC` to Materials,
  *then* `create('Materials','Raw Materials - PSC', true)`. *When* they add `Allowances - PSC` to Materials,
  *then* the form says it is already mapped to Labor and nothing is written. (FR-BAM-003, FR-BAM-001)
- **AC-BAM-010** *Given* that map, *when* the Admin chooses "Use Allowances - PSC for budget push", *then* a
  confirmation says the change applies from the next push. Nothing is written until they confirm, and then
  `setBudgetPushAccount(<Allowances id>)` is called. (FR-BAM-004/013)
- **AC-BAM-011** *Given* that map, *then* `Salary - PSC` (the push account, with a sibling) has no Remove
  action and shows the "make another account the push account" hint. *When* the Admin removes
  `Allowances - PSC`, *then* a confirmation says its actuals stop counting toward the category, and only
  that row is deleted. (FR-BAM-011)

## 5. Owning layer (ADR-0010; one owner per AC)

| AC | Layer | Owning test |
|---|---|---|
| AC-BAM-001 | Integration (pgTAP) | `supabase/tests/budget_account_map_multi.test.sql` |
| AC-BAM-002 | Integration (pgTAP) | `supabase/tests/budget_account_map_multi.test.sql` |
| AC-BAM-003 | Unit (Vitest, PostgREST-faithful fake) | `pmo-portal/src/lib/adapterSeam/erpnext/dispatchFactory.budget.test.ts` |
| AC-BAM-004 | Integration (pgTAP) | `supabase/tests/budget_account_map_multi.test.sql` |
| AC-BAM-005 | Unit | `pmo-portal/src/lib/adapterSeam/erpnext/dispatchFactory.budget.test.ts` |
| AC-BAM-006 | Unit | `pmo-portal/src/lib/budget/categoryAccountMap.test.ts` |
| AC-BAM-007 | Unit (Deno, edge fn) | `supabase/functions/external-set-company/setup.test.ts` |
| AC-BAM-008..011 | Unit (RTL) | `pmo-portal/pages/admin/BudgetAccountMap.test.tsx` |

**Cross-stack reference (not an owner):** `e2e/serial/_budHelpers.ts` `seedBud` now seeds a read-only Labor
sibling for every budget e2e. `AC-BUD-030`'s existing exact `accounts[]` equality against the live ERPNext bench
therefore also proves AC-BAM-003 end to end, with no change to that spec.

**Existing tests that change because a requirement changed (not weakened):**
- `budget_category_account_map_rls.test.sql`: `col_is_unique(org_id, category)` encoded FR-BUD-111's first
  half, which this spec supersedes. It is replaced by the push-index assertion. The "second account rejected"
  assertion keeps its SQL (no flag, so default `true`, so still 23505) and is reworded as "second **push**
  account".
- `BudgetAccountMap.test.tsx` / `.bahasa.test.tsx`: actions move from per-category to per-account
  ("Edit 5100 - Direct Costs", "Remove 5100 - Direct Costs"). This is a deliberate UX change: the steps change
  and each goal oracle (create/update/delete called with the right row) stays.
- `budgetProjection.test.ts`: map CRUD signatures move from category to row `id` and gain `isPushTarget`.

## 6. Rollout and reversal

- **Deploy back to front:** DB (`0246`) → edge fns `adapter-dispatch`, `erpnext-sweep`, `external-set-company` →
  FE. Between the DB and edge-fn deploys, old functions read the map unfiltered. This is safe because no second
  row per category can exist yet: the old FE inserts without the flag, so it gets the default `true` and the
  push index rejects it. Only the new FE adds read-only rows.
- **Reversal:** the guarded manual rollback in `0246`'s header refuses while any category holds more than one
  row, because restoring `unique (org_id, category)` must never delete an Admin's mapping. Roll the app back
  first.

## 7. Owner question (one; default built if unanswered)

- **Q1 — Travel & accommodation, and field expenses: separate budget lines, or under `Special expenses`?**
  Separate lines give them their own rows on the budget and their own approval limits (#803). That needs two
  new categories in a follow-up issue, on the #804 pattern. *Default built:* no new categories. Their ERP
  accounts are mapped under `Special expenses`.

## 8. Out of scope

- Re-pushing a budget when the map changes (DD-PB-1).
- Splitting a category's budget across several ERP accounts (AC-BAM-003 chose one push account).
- Org-configurable categories (OD-BUDGET-4's config bridge).
- An ERP account picker. The map stays free text, as shipped. Validating names against the client's chart of
  accounts is a separate improvement.
