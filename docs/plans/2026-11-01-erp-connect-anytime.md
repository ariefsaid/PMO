# Plan — Connect an ERP at any time, the same way for ERPNext and Odoo (ECA, #1600–#1607)

- **Spec:** `docs/specs/erp-connect-anytime.spec.md` — owner-signed 2026-11-01 (`OD-GRILL-20261101`); its §0 defaults
  OQ-ECA-1..4 are decisions "for now". Owner requirement: `OD-ERP-ANYTIME-1`.
- **Grounds read:** ADR-0055 (§5A crossing, money principle, 2026-10-07 revenue addendum), ADR-0058 (outbox),
  ADR-0059 (§3 invariants, §4 derived keys, §5 never-adopt + master exception), `docs/money-path-primer.md`,
  `docs/decisions.md` DD-XING-1..6, OD-XING-1, OD-SEED-4, DD-SETUP-1, DD-UX-1 §4/§5, OD-ERP-ANYTIME-1,
  OD-GRILL-20261101; `docs/plans/2026-10-31-odoo-connect-master-data.md` (Odoo O1, the parity partner).
- **Evidence baseline:** `origin/dev` at `6440a961` (2026-11-01). The spec cites `3e0096605`; 364 commits have landed
  since, including PR #1610 (`a4c193f2`), which shipped most of ECA-1 and ECA-7. §0 re-baselines every slice. File:line
  citations below are at `6440a961`; the Opus review (2026-11-01) re-read them at `b52aa48a` (docs-only delta) and corrected
  the ones that had drifted.
- **Role contract:** `.claude/agents/eng-planner.md`. Builders: `implementer` / `ui-implementer` role contracts handed to
  Orca workers (`docs/orca-dispatch.md`); money-path slices are Director-dispatched per issue.
- **Migrations (Director, 2026-11-01):** each with `supabase/migrations/rollback/<number>_<slug>_down.sql`. Five migrations:
  ECA-2 `0451_erp_connect_setup`, ECA-3 `0452_erp_connect_sends`, ECA-4 `0481_process_domain_cutover`, ECA-5
  `0454_invoice_pairs`, ECA-6 `0455_budget_occupant_resolution` (0450 is #1614's). A collision at build is fixed with
  `scripts/renumber-migration.sh`, never by hand.
- **IDs:** plan decisions `PD-ECA-#`; questions for the Director `PQ-ECA-#`; tasks `<slice>-T<n>`.

---

## 0. What is already on `dev` (re-baseline)

| Slice | Issue | State at `6440a961` | What remains (this plan) |
|---|---|---|---|
| ECA-7 registry + shared suite | #1604 (open) | **Shipped** in #1610: `connect/workflows.ts` (27 workflows, versions), `erpnext/workflowDeclarations.ts:17-45`, `odoo/workflowDeclarations.ts`, `contractSuite/{harness,index,parity,tiers,tierBranch,party,project,budget,cutover,send,imprestTransfer}`, AC-ECA-040..043 tagged in `parity.test.ts:14-107` and `tierBranch.test.ts:78`. 10 shipped workflows still declared `pending #1609` in ERPNext (`purchase.push`, `bill.push`, `vendor-payment.push`, `purchase.link-existing`, `cutover.timesheet`, `invoice.push`, `receipt.read`, `actuals.read`, `budget.push`, `timesheet.push`). | ECA7-T1 closeout evidence. Moving those 10 workflows into suites is **#1609** (separate issue, not re-planned here). |
| ECA-1 party bring-in | #1600 (open) | **Mostly shipped** in #1610: onboarding links instead of inserting (`erpnext/onboarding.ts:149-166`), per-party outcomes (`:141-148`, `needsDecision`), feed runs the match before minting (`_shared/erpnextFeedDeps.ts:233-251`), one candidate lookup (`_shared/companyCandidates.ts:11-29`); real-uniqueness Deno tests (`erpnext-onboard/index.test.ts:147-268`, `_shared/erpnextFeedDeps.partyMatch.test.ts:80-163`). | AC-id tagging; the `party.bring-in` shared suite (still `pending #1600` in both tiers); the persisted review row of AC-ECA-005/006 lands with ECA-2's table (ECA2-T14). |
| ECA-2 matcher, census, one-pass setup | #1605 | `connect/match.ts:12-17` holds only `pickPartyCandidate`; `connect/types.ts` holds `ConnectAdapter`/`NormalisedMaster`/`PmoMaster`. No census, no proposal storage, no accept-all. | Whole slice. |
| ECA-3 send PMO masters | #1606 | Shared send suites exist (`contractSuite/send.suite.ts`), Odoo passes them (`odoo/connectAdapter.ts:87-114`). ERPNext has no `ConnectAdapter`; `ensure-project` still creates on no-match (`external-set-company/setup.ts:532-546`). | Whole slice for ERPNext. |
| ECA-4 cut-over in flight | #1601 | Nothing. Revenue employ guard shipped (`0275_native_revenue.sql:820-847`). | Whole slice. |
| ECA-5 invoice pairing | #1602 | Nothing. | Whole slice. |
| ECA-6 existing ERP budget | #1603 | Refusal shipped (`erpnext/dispatchBudget.ts:333-341`, code `budget-unowned-live-occupant`). | Whole slice. |
| ECA-8 scenario e2e | #1607 | Nothing. | Whole slice. |

## 1. Design decisions taken in this plan (`PD-ECA-#`)

- **PD-ECA-1 — Proposal and census storage is one migration in ECA-2, tier-keyed.** Odoo's plan defers to it ("Proposal and
  review rows are ECA-2's storage", Odoo plan §2.5). Three tables: `erp_connect_runs` (one run per org × tier, its paging
  cursor and state), `erp_connect_census` (per kind or domain: counts, scenario, `accepted_at`), `erp_connect_proposals` (one
  row per outcome), plus `erp_connect_staged` (the ERP master pages of one run, deleted with the run). *Review correction:* the
  draft staged pages in Odoo's `external_master_records` mirror. That table is Odoo's live directory: its census finish
  tombstones every row the mirror sweep did not see (`0421` `finish_odoo_census`), its pickers list every `partner` row, and its
  read policy hides only accounts, taxes and partners, so staged ERP employee names would be readable by every member. A
  run-scoped staging table touches none of that and is Admin-only.
- **PD-ECA-2 — The matcher is TypeScript (DD-ECA-2); applying is SQL.** `proposeMatches()` runs in the edge function / sweep
  and writes rows through one service-only RPC. Accepting is one SECURITY DEFINER RPC per call that applies every accepted
  row in one transaction, with `external_refs` uniqueness (`0088_external_refs.sql:16` + 0093's reverse unique) as the
  exactly-once guard (FR-ECA-013). The ERP data a link or bring-in needs is snapshotted onto the proposal row at proposal
  time, so accept never calls the ERP.
- **PD-ECA-3 — Census counts are immediate; the proposal is paged by the sweep.** `countDomain` is one call per kind, so the
  `census` verb answers FR-ECA-002's first two numbers synchronously. Listing every master (NFR-ECA-005: 50k parties, 100k
  items) is paged inside the sweep tick budget into `erp_connect_staged`; once every kind is staged, each following tick runs
  `proposeMatches` for one kind and the screen fills "9 are the same". The setup screen polls `connect-status`.
- **PD-ECA-4 — Kind policy is data, not branches.** Which outcomes a kind can have is one table in `connect/match.ts`:
  `party` link/bring-in/send/review; `project` link/send/review (projects are PMO-owned; ERP-only projects stay read-only,
  Odoo plan §2.2); `item` link/send/review (ERP catalogue is the picker; nothing brought in); `employee` link/send/review
  (ERP employees reach PMO through the shipped feed as `erp_employees` rows, `0148`); `account` link/review only (never
  sent, DD-SETUP-1; a PMO category with no account becomes the accountant's setup task, FR-ECA-020).
- **PD-ECA-5 — Items link by a name→code map in binding config.** PMO purchase lines carry their name as the ERP item code
  (`erpnext/dispatchProcurement.ts:61-72`). An accepted item link writes `config.item_map[<line name>] = <ERP item code>`;
  the line resolver reads it with the line name as the fallback. A sent item uses the line name as its code, so it needs no
  map entry.
- **PD-ECA-6 — Account matching keeps its term rules as a key derivation.** `budget/categoryAccountMap.ts:78-110`'s direct-cost
  filter and category terms become `accountCategoryKey(account)` — the ERP account's `code` in `NormalisedMaster` is the
  category it uniquely names. PMO categories carry `code = category`. The shared matcher then links on `code` and turns two
  accounts claiming one category into a review row. Only the pairing step moves (spec §6.1); the term table stays.
- **PD-ECA-7 — `ensure-project`'s create-on-no-match is replaced by `project.send` in ECA-3, not ECA-2.** Removing it in
  ECA-2 would leave no way to create an ERP project until ECA-3 ships. ECA-3 swaps the create for the outbox send in one
  change; `AC-SETUP-001`'s journey keeps its goal (the PMO project is linked to a real ERP project and a retry reuses it).
- **PD-ECA-8 — Sends ride the money outbox through one tier-agnostic wrapper.** `connect/sendViaOutbox.ts` turns
  `ConnectAdapter.sendMaster` into an `Adapter.commit` for `dispatchMoneyWrite` (`adapterSeam/dispatch.ts:619`), key
  `seed:<kind>:<pmo_record_id>` (FR-ECA-021), outbox domain `companies` / `projects` / `items` / `employees`. Odoo's S8 (PD-8
  of its plan) uses the same wrapper. The outbox's recovery probe (`probeByRemarksKey`, required by
  `createDbMoneyOutboxDeps`, `adapter-dispatch/moneyOutboxDeps.ts:134-141`) is the lookup half of `sendMaster`, so a lost
  response is adopted, never re-POSTed; a probe that cannot decide holds the row (`command-held`) and the proposal returns as
  *review* "We could not confirm whether the ERP created this record" (NFR-ECA-004). Only `companies` writes `external_refs`
  through the outbox; project, item and employee links land only through `record_connect_send_result` (one link store per kind).
- **PD-ECA-9 — Cut-over for a procurement case = its first PMO-made document (order, receipt or bill) predates the later of
  `activated_at` and the time procurement was employed.** The PO is normally the first ERP-bound document of a purchase
  (`dispatchProcurement.ts:133-176`), but a bill can come first (flexible entry), and a purchase ordered between connecting and
  employing never reached the ERP, so activation alone is the wrong instant. Rows the ERP holds (`erp_docstatus` set) do not
  count, and a bill the ERP holds is paid in the ERP. A case whose first document is created after the cut-over pushes
  normally even if the case was drafted before. *(Fix round 2026-11-02.)* *Review correction:* "finish in PMO only" (OQ-ECA-1) needs a PMO write path.
  Once `procurement` is employed the repository routes every receipt, bill and payment to dispatch
  (`repositories/procurement.ts:66-95`, `routeDomainWrite`) and the native RPCs refuse
  (`create_procurement_receipt` `0180`, `create_procurement_invoice` and `create_payment` `0373`, plus the three
  `*_native_mirror_guard`s). Refusing the push alone would leave the store keeper unable to record the receipt at all. ECA-4
  therefore exempts a pre-cut-over case from those refusals and routes it to the native path; the dispatch refusal stays as the
  backstop.
- **PD-ECA-10 — Invoice pairing is SQL, not the master matcher.** It pairs money documents already in one table
  (`sales_invoices`, native rows and ERP-brought-in rows alike), so it is tier-agnostic by construction. The per-tier
  obligation is that the adapter's inbound mapping fills the pairing keys; that is what `invoice.pair-existing`'s shared
  suite asserts.
- **PD-ECA-11 — Count-once is one column every revenue reader filters on.** `sales_invoices.paired_erp_invoice_id` (set
  only by `accept_invoice_pairs`) and `and si.paired_erp_invoice_id is null` added to each reader in ECA5-T3's list (SQL
  definers, the two views, and the client and agent readers). No new invoice state. Only a native invoice with **no receipt**
  can be paired, so no receipt is ever counted twice; a native invoice with receipts stays listed as unpaired with the reason
  "PMO already recorded a payment on this invoice".
- **PD-ECA-12 — "Replace the ERP budget" needs a server-recorded consent naming the exact ERP budget.** The dispatch payload
  is never trusted to assert it (ADR-0059 §3.3); `dispatchBudget.ts` reads a live, unconsumed consent row for the same org,
  project, account, year and ERP document name before it relaxes the ownership refusal.
- **PD-ECA-13 — A new registry workflow `budget.resolve-occupant` (v1)** carries ECA-6's two actions. Adding it breaks
  typecheck for both tiers until each declares it (FR-ECA-050), which is the point; Odoo declares `pending #1507`.
- **PD-ECA-14 — `party.match` bumps to v2 in ECA-2** (tax id first, legal-form suffixes stripped, two same-name candidates
  are a review even when one has no tax id, FR-ECA-011). v2 changes two v1 cases of `party.suite.ts` on purpose (`:32` becomes
  review, `:45` becomes a tax link). `pickPartyCandidate` becomes a thin wrapper over `proposeMatches`, so every caller
  (`partyAdopt.ts:80`, the feed, onboarding, `odoo/contract.harness.ts:58`) moves to v2 in the same change; Odoo re-declares v2
  and passes with no Odoo code change.
- **PD-ECA-15 — "Set up once" is a per-kind `accepted_at` (FR-ECA-016).** The first bulk accept of a kind stamps
  `erp_connect_census.accepted_at`. From then on new outcomes of that kind apply without a person: the ERPNext feed already
  links and brings in through the matcher (ECA2-T14); a new PMO item on an open purchase is sent by the sweep (ECA3-T12); the
  admin sees only new review rows. Odoo's feed (its S6-T5 "auto-apply after setup") reads the same column.
- **PD-ECA-16 — Names match on legal-form *suffixes* only, as FR-ECA-011 says.** Leading forms (PT, CV, UD) are kept: "PT Acme"
  and "CV Acme" are different legal entities, and linking them would push one company's bills against the other's tax id.
  Trailing forms (Tbk, Ltd, Inc, Co, …), case, punctuation and spacing are stripped.

## 2. Questions for the Director (`PQ-ECA-#`; default taken if unanswered)

**Lane C, 2026-11-01: PQ-ECA-1, PQ-ECA-2 and PQ-ECA-3 — default taken.**

| # | Question | Default |
|---|---|---|
| **PQ-ECA-1** | ERPNext's Employee doctype requires gender, date of birth and date of joining. PMO holds none of them. OQ-ECA-2 says send employees. Collect them in the send dialog, or declare `employee.send` *unavailable* for ERPNext? | **Unavailable** with reason "the ERP requires birth date and gender, which PMO does not hold"; the setup screen lists the people to add in the ERP. ECA3-T1 verifies the mandatory set on the bed first; if the bed accepts an Employee without them, the default flips to *supported*. Never fabricate personal data. |
| **PQ-ECA-2** | An inactive ERP master with no PMO match: bring in / send against it? | **Neither.** Inactive ERP rows take part only as a link target for a strong key (tax id or code); unmatched they produce no proposal row and are counted as "inactive in the ERP" on the census line. |
| **PQ-ECA-3** | AC-ECA-005's "a review row plus a notification" needs ECA-2's table. Close #1600 now and own the row in ECA-2, or hold #1600 open? | **Hold #1600 open** until ECA2-T14 lands; ECA-1's remaining tasks ship first and the issue closes with ECA-2. |

## 3. File map

`(new)` created here; otherwise extended. Owner = the slice that creates or first edits it.

| File | Owner | Later |
|---|---|---|
| `pmo-portal/src/lib/adapterSeam/connect/types.ts` | ECA-2 | ECA-3 |
| `pmo-portal/src/lib/adapterSeam/connect/match.ts` (+`match.test.ts` new) | ECA-2 | — |
| `pmo-portal/src/lib/adapterSeam/connect/census.ts` (new, +test) | ECA-2 | — |
| `pmo-portal/src/lib/adapterSeam/connect/run.ts` (new, +test) | ECA-2 | ECA-3 |
| `pmo-portal/src/lib/adapterSeam/connect/sendViaOutbox.ts` (new, +test) | ECA-3 | Odoo S8 |
| `pmo-portal/src/lib/adapterSeam/connect/workflows.ts` | ECA-2 (v2 bump) | ECA-6 (new id) |
| `pmo-portal/src/lib/adapterSeam/contractSuite/harness.ts` | ECA-1 | ECA-2, 3, 4, 5, 6 |
| `pmo-portal/src/lib/adapterSeam/contractSuite/{bringIn,census,match,sendAll,cutoverPurchase,invoicePair}.suite.ts` (new) | ECA-1/2/3/4/5 | — |
| `pmo-portal/src/lib/adapterSeam/contractSuite/index.ts`, `budget.suite.ts` | ECA-1 | ECA-2..6 |
| `pmo-portal/src/lib/adapterSeam/erpnext/connectAdapter.ts` (new, +test) | ECA-2 | ECA-3 |
| `pmo-portal/src/lib/adapterSeam/erpnext/contract.harness.ts`, `workflowDeclarations.ts` | ECA-1 | every slice |
| `pmo-portal/src/lib/adapterSeam/odoo/workflowDeclarations.ts`, `odoo/contract.harness.ts` | ECA-1 | ECA-2, 6 |
| `pmo-portal/src/lib/adapterSeam/erpnext/dispatchProcurement.ts` | ECA-2 (item map) | — |
| `pmo-portal/src/lib/adapterSeam/erpnext/dispatchBudget.ts` | ECA-6 | — |
| `pmo-portal/src/lib/budget/categoryAccountMap.ts` | ECA-2 | — |
| `pmo-portal/src/lib/repositories/projectMatchReview.ts` | ECA-2 | — |
| `pmo-portal/src/lib/repositories/{integrations.ts,contracts/integrations.ts}` | ECA-2 | ECA-3, 5, 6 |
| `pmo-portal/src/components/integrations/ConnectProposalReview.tsx` (new, +test) | ECA-2 | ECA-3 |
| `pmo-portal/src/components/integrations/ErpSetupChecklist.tsx` | ECA-2 | ECA-3 |
| `pmo-portal/src/components/integrations/InvoicePairReview.tsx` (new, +test) | ECA-5 | — |
| `pmo-portal/src/components/budget/BudgetOccupantActions.tsx` (new, +test) | ECA-6 | — |
| `pmo-portal/src/lib/adapterSeam/pushErrorCopy.ts`, `pendingPush.ts` | ECA-4 | ECA-6 |
| `pmo-portal/public/locales/{en,id}/administration.json` | ECA-2 | ECA-3, 4, 5, 6 |
| `supabase/functions/_shared/connectAdapterForOrg.ts` (new) | ECA-2 | — |
| `supabase/functions/_shared/erpnextFeedDeps.ts`, `_shared/companyCandidates.ts` | ECA-2 | — |
| `supabase/functions/erpnext-onboard/index.ts` + `erpnext/onboarding.ts` | ECA-2 | — |
| `supabase/functions/external-set-company/{index.ts,connect.ts (new),setup.ts}` | ECA-2 | ECA-3, 5 |
| `supabase/functions/erpnext-sweep/index.ts` (connect pass) | ECA-2 | ECA-3 |
| `supabase/functions/adapter-dispatch/{index.ts,budgetOccupant.ts (new)}` (ECA-4's logic lives in `adapterSeam/cutoverGate.ts`, imported by `index.ts`) | ECA-4 / ECA-6 | — |
| `scripts/check-edge-fn-test-binding.mjs` (`REQUIRED` map) | ECA-2 | ECA-4, 6 |
| `pmo-portal/src/lib/adapterSeam/contractSuite/party.suite.ts` (v2 cases), `erpnext/partyAdopt.ts` (shared normaliser) | ECA-2 | — |
| `pmo-portal/src/lib/repositories/procurement.ts` (pre-cut-over cases take the native path) | ECA-4 | — |
| `pmo-portal/src/lib/db/revenue.ts`, `supabase/functions/agent-chat/overdue.ts` (count-once client and agent readers) | ECA-5 | — |
| `supabase/tests/0178_anon_executable_definers.test.sql` (client-callable allow-list + count) | ECA-2 | ECA-5, 6 |
| `scripts/check-e2e-skips.mjs` (allowlist) | ECA-8 | — |
| `pmo-portal/e2e/serial/AC-ECA-050-*.spec.ts`, `AC-ECA-051-*.spec.ts` (new) | ECA-8 | — |

## 4. Verify commands used below

Run from the repo root unless a `cd` is shown. Local final gate per CLAUDE.md: guards, typecheck, eslint on touched files,
**directly touched** test files only; CI's two unit shards and `pgtap` are the full proof.

```bash
V()   { (cd pmo-portal && npx vitest run "$@"); }                                   # one or more vitest files
TC()  { (cd pmo-portal && npm run typecheck && npm run check:guards); }
LINT(){ (cd pmo-portal && npx eslint --max-warnings=0 "$@"); }
DENO(){ (cd "supabase/functions/$1" && shift && deno test "$@" --config deno.json --allow-env --allow-net --allow-read); }
PGT() { scripts/with-db-lock.sh bash -c "supabase db reset && supabase test db $*"; }   # only when the branch adds a migration
```

`DENO adapter-dispatch ../_shared/erpnextFeedDeps.partyMatch.test.ts` is how a `_shared` test runs (same as
`scripts/deno-test-edge-fns.sh:65-68`). `scripts/ux-proof.sh /integrations` for every UI task.

## 5. Order and executors

```
ECA-7 closeout ─┐
ECA-1 remainder ┴─► ECA-2 ─► ECA-3 ─┐
ECA-4 (after ECA-7) ────────────────┤
ECA-5 (after ECA-7) ────────────────┼─► ECA-8
ECA-6 (after ECA-7) ────────────────┘
```

| Slice | Executor | Ships alone? | Extra review |
|---|---|---|---|
| ECA-7 closeout | Orca worker (haiku-grade) | no | — |
| ECA-1 remainder | Orca worker | no | security-auditor (service-role writers) |
| ECA-2 data (T1–T16) | Director-dispatched | **ships alone** (the accept writes party links, the budget account map and the employee cost identity of 0148) | security-auditor (new RPCs, RLS, grants) |
| ECA-2 screen (T17–T18) | Orca UI worker after a 30-second owner sketch glance of the setup screen | no | — |
| ECA-3 | Director-dispatched | **ships alone** (writes to the money outbox) | security-auditor |
| ECA-4 | Director-dispatched | **ships alone** (money path) | security-auditor |
| ECA-5 | Director-dispatched | **ships alone** (money path: revenue figures) | security-auditor |
| ECA-6 | Director-dispatched | **ships alone** (money path: budget push) | security-auditor |
| ECA-8 | Orca worker (qa-acceptance) | no | — |

---

## 6. ECA-7 — workflow registry and shared suite (#1604): closeout

**Odoo parity row:** shipped — `odoo/workflowDeclarations.ts` and `odoo/contract.harness.ts` run through the same runner
(`contractSuite/tiers.contract.test.ts`).

### ECA7-T1 — closeout evidence (AC-ECA-040..043)
No code. **Run by the lane orchestrator; the Director posts the #1604 comment and closes it** (workers do not post to
GitHub), linking #1609 for the 10 remaining workflows. Command:
```bash
V src/lib/adapterSeam/contractSuite/parity.test.ts src/lib/adapterSeam/contractSuite/tierBranch.test.ts \
  src/lib/adapterSeam/contractSuite/tiers.contract.test.ts src/lib/adapterSeam/erpnext/contract.test.ts
```
Expected: all green; `AC-ECA-040` (typecheck break via `@ts-expect-error`), `AC-ECA-041` (stale pin names tier and
workflow), `AC-ECA-042` (every supported workflow's suite ran), `AC-ECA-043` (tier-branch allowlist exact).

---

## 7. ECA-1 — party bring-in at connect (#1600): remainder

**Odoo parity row:** `party.bring-in` — Odoo declares `pending #1600` today (`odoo/workflowDeclarations.ts:23`); its S6
(party adoption) runs the new suite and flips to *supported*. Nothing Odoo-specific is built here.

### ECA1-T1 — tag the shipped tests with their AC ids (AC-ECA-005, AC-ECA-006)
Rename test titles only (assertions unchanged), so `grep -r AC-ECA-005` finds the owning proof:
- `supabase/functions/_shared/erpnextFeedDeps.partyMatch.test.ts:80` → `'AC-ECA-005 sweep: an unmapped ERP supplier matching an existing PMO vendor is LINKED, not created again'`;
  `:103` → `'AC-ECA-005 sweep: two PMO vendors with the name make an unclear match; nothing is written'`.
- `supabase/functions/erpnext-onboard/index.test.ts:147` → `'AC-ECA-006 a matched existing company is LINKED (update + ref), never re-inserted'`;
  `:190` → `'AC-ECA-006 an ambiguous match becomes a needs-a-decision row and the rest apply'`.

Verify: `DENO adapter-dispatch ../_shared/erpnextFeedDeps.partyMatch.test.ts && DENO erpnext-onboard index.test.ts` → green.

### ECA1-T2 — failing shared suite `party.bring-in` (FR-ECA-013/014)
Add to `contractSuite/harness.ts` (inside `ErpHarness`):
```ts
  /** party.bring-in: apply ERP parties to a PMO store that enforces uniqueness like the database (one ref per
   *  external id, one company id). Each call starts an empty store seeded with `existing`. */
  bringIn?: (parties: readonly ErpPartyInput[], existing: readonly PmoPartyCandidate[], runs?: number) =>
    Promise<{ companies: number; refs: number; linked: string[]; review: number }>;
```
New `contractSuite/bringIn.suite.ts`:
```ts
/** party.bring-in (v1) — an ERP party with no PMO match becomes one PMO company, exactly once (FR-ECA-013/014). */
import { describe, expect, it } from 'vitest';
import type { ErpHarness } from './harness.ts';

const ACME = { role: 'vendor' as const, externalId: 'EXT-1', name: 'Acme Co', taxId: 'TAX-1' };

export function bringInSuite(h: ErpHarness): void {
  const run = h.bringIn ?? (() => { throw new Error(`${h.tier} declares party.bring-in supported but has no bringIn()`); });
  describe(`party.bring-in (${h.tier})`, () => {
    it('FR-ECA-014 no PMO match: one new company and one reference', async () => {
      expect(await run([ACME], [])).toMatchObject({ companies: 1, refs: 1, linked: [], review: 0 });
    });
    it('FR-ECA-013 applying the same party three times leaves one company and one reference', async () => {
      expect(await run([ACME], [], 3)).toMatchObject({ companies: 1, refs: 1 });
    });
    it('FR-ECA-014 a unique PMO match is linked, never duplicated', async () => {
      expect(await run([ACME], [{ pmoId: 'pmo-1', taxId: 'TAX-1' }])).toMatchObject({ companies: 1, refs: 1, linked: ['pmo-1'] });
    });
    it('FR-ECA-014 two PMO candidates: nothing written, one review', async () => {
      const r = await run([ACME], [{ pmoId: 'pmo-1', taxId: null }, { pmoId: 'pmo-2', taxId: null }]);
      expect(r).toMatchObject({ companies: 2, refs: 0, linked: [], review: 1 });
    });
  });
}
```
Register `'party.bring-in': bringInSuite` in `contractSuite/index.ts`. Flip `erpnext/workflowDeclarations.ts:20` to
`{ status: 'supported', version: 1 }`.
Verify: `V src/lib/adapterSeam/contractSuite/tiers.contract.test.ts` → **red** (`erpnext declares party.bring-in supported but has no bringIn()`).

### ECA1-T3 — ERPNext `bringIn` over the shipped `onboardParties` (green)
In `erpnext/contract.harness.ts`, add to the returned object:
```ts
    async bringIn(parties, existing, runs = 1) {
      const companies = new Map<string, { name: string }>(existing.map((c) => [c.pmoId, { name: 'Acme Co' }]));
      const refs = new Map<string, string>(); // external id -> pmo id, unique like external_refs
      const linked: string[] = []; let review = 0;
      for (let i = 0; i < runs; i += 1) {
        const r = await onboardParties(parties.map((p) => ({ doctype: p.role === 'vendor' ? 'Supplier' : 'Customer', id: p.externalId, name: p.name, taxId: p.taxId ?? null })), {
          findPmoRecordId: async (ext) => refs.get(ext) ?? null,
          findCandidates: async () => existing.filter((c) => ![...refs.values()].includes(c.pmoId)).map((c) => ({ pmoRecordId: c.pmoId, taxId: c.taxId })),
          insertCompaniesMirror: async (c) => { if (companies.has(c.id)) throw Object.assign(new Error('duplicate'), { code: '23505' }); companies.set(c.id, { name: String(c.name) }); },
          updateCompaniesMirror: async (id) => { if (!companies.has(id)) throw new Error('update of a missing company'); if (!linked.includes(id) && existing.some((c) => c.pmoId === id)) linked.push(id); },
          recordExternalRef: async ({ pmoRecordId, externalRecordId }) => {
            if (refs.has(externalRecordId) || [...refs.values()].includes(pmoRecordId)) throw Object.assign(new Error('dup'), { code: '23505' });
            refs.set(externalRecordId, pmoRecordId);
          },
          mirrorExists: async (id) => companies.has(id),
          notifyUnclearMatch: async () => { review += 1; },
        });
        void r;
      }
      return { companies: companies.size, refs: refs.size, linked, review: review / runs };
    },
```
(every candidate the suite passes is named "Acme Co"), and `import { onboardParties } from './onboarding.ts';`.
Verify: `V src/lib/adapterSeam/contractSuite/tiers.contract.test.ts src/lib/adapterSeam/contractSuite/parity.test.ts` → green;
`TC`; `LINT src/lib/adapterSeam/contractSuite/bringIn.suite.ts src/lib/adapterSeam/erpnext/contract.harness.ts`.

---

## 8. ECA-2 — shared matcher, census and one-pass setup (#1605)

**Odoo parity row:** O1 (#1504) reuses `connect/match.ts`, `connect/census.ts`, `connect/run.ts`, the three tables and the
six setup verbs with `tier: 'odoo'` (Odoo plan PD-9 says "whatever verbs ECA-2 defines"). Odoo declares `census`,
`item.match`, `account.match` *supported* once its harness answers the new `listMasters`-based suites (its
`connectAdapter.ts:72-85` already implements them); `employee.match` stays `pending #1510`. Odoo's
`odoo_project_link_in_use` (Odoo plan S6-T7) becomes a call to this slice's `connect_link_in_use(org,'projects',id)` so the
re-link check stays one function (FR-ODC-073 / FR-ECA-015).

### ECA2-T1 — types (no behaviour)
Append to `connect/types.ts`:
```ts
export type MatchKey = 'tax' | 'code' | 'name';
export type ReviewReason = 'ambiguous' | 'tax-conflict' | 'rejected';
export type MatchOutcome =
  | { outcome: 'link'; pmoId: string; externalId: string; key: MatchKey }
  | { outcome: 'bring-in'; externalId: string }
  | { outcome: 'send'; pmoId: string }
  | { outcome: 'review'; pmoIds: string[]; externalIds: string[]; reason: ReviewReason };
export type Scenario = 'none' | 'S-A' | 'S-C' | 'S-D'; // 'none' = both sides empty
/** FR-ECA-001: money domains are counted on both sides too. */
export type CensusDomain = 'budget' | 'purchase' | 'invoice' | 'receipt' | 'payment' | 'timesheet';
/** `erpCount`/`scenario` null = this ERP cannot count the domain yet (shown as "not checked", never as 0). */
export interface CensusRow { kind: MasterKind | CensusDomain; pmoCount: number; erpCount: number | null; scenario: Scenario | null }
```
Add `active?: boolean` to `PmoMaster` (default true; archived companies are not candidates, `companyCandidates.ts:9`).
Verify: `TC`.

### ECA2-T2 — failing matcher tests (AC-ECA-002)
New `connect/match.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { normaliseName, proposeMatches } from './match.ts';
import type { NormalisedMaster, PmoMaster } from './types.ts';

const erp = (externalId: string, name: string, o: Partial<NormalisedMaster> = {}): NormalisedMaster =>
  ({ kind: 'party', externalId, name, role: 'vendor', active: true, ...o });
const pmo = (id: string, name: string, o: Partial<PmoMaster> = {}): PmoMaster => ({ id, name, role: 'vendor', ...o });

describe('AC-ECA-002 proposeMatches gives every row exactly one outcome and never links a doubtful pair', () => {
  const P = [
    pmo('p-tax', 'Different Name', { taxId: '01.234' }), pmo('p-code', 'Beta', { code: 'B-1' }), pmo('p-name', 'PT. Gamma Tbk'),
    pmo('p-dup1', 'Delta'), pmo('p-dup2', 'Delta'), pmo('p-conf', 'Eps', { taxId: '111' }), pmo('p-only', 'Zeta'),
  ];
  const E = [
    erp('E-tax', 'Alpha', { taxId: '01234' }), erp('E-code', 'Beta Ltd', { code: 'b-1' }), erp('E-name', 'pt gamma'),
    erp('E-dup', 'Delta'), erp('E-conf', 'Eps', { taxId: '222' }), erp('E-only', 'Theta'), erp('E-off', 'Iota', { active: false }),
  ];
  const out = proposeMatches('party', P, E);
  const of = (id: string) => out.filter((o) => ('pmoId' in o && o.pmoId === id) || ('externalId' in o && o.externalId === id)
    || ('pmoIds' in o && o.pmoIds.includes(id)) || ('externalIds' in o && o.externalIds.includes(id)));

  it('unique tax id links on tax even when names differ', () => expect(of('E-tax')).toEqual([{ outcome: 'link', pmoId: 'p-tax', externalId: 'E-tax', key: 'tax' }]));
  it('unique code links on code, case-insensitive', () => expect(of('E-code')).toEqual([{ outcome: 'link', pmoId: 'p-code', externalId: 'E-code', key: 'code' }]));
  it('unique normalised name links (case, punctuation and a trailing legal form stripped)', () => expect(of('E-name')).toEqual([{ outcome: 'link', pmoId: 'p-name', externalId: 'E-name', key: 'name' }]));
  it('two name matches are one review, no link', () => expect(of('E-dup')).toEqual([{ outcome: 'review', pmoIds: ['p-dup1', 'p-dup2'], externalIds: ['E-dup'], reason: 'ambiguous' }]));
  it('a name match with conflicting tax ids is a review', () => expect(of('E-conf')).toEqual([{ outcome: 'review', pmoIds: ['p-conf'], externalIds: ['E-conf'], reason: 'tax-conflict' }]));
  it('ERP-only becomes bring-in, PMO-only becomes send', () => {
    expect(of('E-only')).toEqual([{ outcome: 'bring-in', externalId: 'E-only' }]);
    expect(of('p-only')).toEqual([{ outcome: 'send', pmoId: 'p-only' }]);
  });
  it('PQ-ECA-2 an inactive unmatched ERP row has no outcome', () => expect(of('E-off')).toEqual([]));
  it('every PMO and active ERP row appears exactly once', () => {
    for (const id of [...P.map((p) => p.id), ...E.filter((e) => e.active).map((e) => e.externalId)]) expect(of(id)).toHaveLength(1);
  });
  it('two ERP rows claiming one PMO row by name are both review', () => {
    const r = proposeMatches('party', [pmo('p', 'Acme')], [erp('E1', 'Acme'), erp('E2', 'ACME')]);
    expect(r).toEqual([{ outcome: 'review', pmoIds: ['p'], externalIds: ['E1', 'E2'], reason: 'ambiguous' }]);
  });
  it('kind policy: an ERP-only item or project is never brought in; a PMO-only account is never sent', () => {
    expect(proposeMatches('item', [], [{ ...erp('I', 'Semen'), kind: 'item', role: undefined }])).toEqual([]);
    expect(proposeMatches('project', [], [{ ...erp('P', 'Jembatan'), kind: 'project', role: undefined }])).toEqual([]);
    expect(proposeMatches('account', [{ id: 'Labor', name: 'Labor', code: 'Labor' }], [])).toEqual([]);
  });
  it('roles never cross: a client does not match a vendor of the same name', () => {
    expect(proposeMatches('party', [pmo('p', 'Acme', { role: 'client' })], [erp('E', 'Acme')]))
      .toEqual([{ outcome: 'bring-in', externalId: 'E' }, { outcome: 'send', pmoId: 'p' }]);
  });
  it('PD-ECA-16 normaliseName strips case, punctuation, spacing and trailing legal forms, never a leading one', () => {
    expect(normaliseName('PT. ACME  Tbk')).toBe('pt acme');
    expect(normaliseName('Acme Co., Ltd')).toBe('acme');
    expect(normaliseName('PT Acme')).not.toBe(normaliseName('CV Acme'));
  });
  it('FR-ECA-011 two same-name candidates are a review even when only one has a tax id that differs', () => {
    expect(proposeMatches('party', [pmo('a', 'Acme', { taxId: '2' }), pmo('b', 'Acme')], [erp('E', 'Acme', { taxId: '1' })]))
      .toEqual([{ outcome: 'review', pmoIds: ['a', 'b'], externalIds: ['E'], reason: 'tax-conflict' }]);
  });
  it('doubtful claims that share a PMO row merge into one review, so no row has two outcomes', () => {
    const r = proposeMatches('party', [pmo('p1', 'Acme', { code: 'A-1' }), pmo('p2', 'Acme')], [erp('E1', 'Acme'), erp('E2', 'Other', { code: 'a-1' })]);
    expect(r).toEqual([{ outcome: 'review', pmoIds: ['p1', 'p2'], externalIds: ['E1', 'E2'], reason: 'ambiguous' }]);
  });
  it('PQ-ECA-2 an inactive ERP row links on a strong key only, never on a name', () => {
    expect(proposeMatches('party', [pmo('k', 'Other', { taxId: '77' })], [erp('E', 'Kappa', { taxId: '77', active: false })]))
      .toEqual([{ outcome: 'link', pmoId: 'k', externalId: 'E', key: 'tax' }]);
    expect(proposeMatches('party', [pmo('l', 'Lambda')], [erp('E', 'Lambda', { active: false })]))
      .toEqual([{ outcome: 'send', pmoId: 'l' }]);
  });
});
```
Verify: `V src/lib/adapterSeam/connect/match.test.ts` → red (no export `proposeMatches`).

### ECA2-T3 — `proposeMatches` (green; party.match v2)
Replace `connect/match.ts` with:
```ts
import type { MasterKind, MatchOutcome, NormalisedMaster, PmoMaster } from './types.ts';

// PD-ECA-16: trailing legal forms only. A leading PT / CV / UD names a different legal entity and is kept.
const LEGAL_SUFFIXES = new Set(['tbk', 'persero', 'ltd', 'limited', 'inc', 'llc', 'co', 'corp', 'gmbh', 'bv', 'sa', 'plc']);
export function normaliseName(name: string): string {
  const words = name.toLowerCase().replace(/[.,()]/g, ' ').split(/\s+/).filter(Boolean);
  while (words.length > 1 && LEGAL_SUFFIXES.has(words[words.length - 1])) words.pop();
  return words.join(' ');
}
const normTax = (t?: string | null) => (t ?? '').replace(/[^0-9a-z]/gi, '').toLowerCase();
const normCode = (c?: string | null) => (c ?? '').trim().toLowerCase();

/** PD-ECA-4: which outcomes each kind can have. */
const POLICY: Record<MasterKind, { bringIn: boolean; send: boolean }> = {
  party: { bringIn: true, send: true }, contact: { bringIn: false, send: false }, item: { bringIn: false, send: true },
  project: { bringIn: false, send: true }, employee: { bringIn: false, send: true }, account: { bringIn: false, send: false },
};

type Claim = { erp: NormalisedMaster; pmoIds: string[]; key: 'tax' | 'code' | 'name'; conflict: boolean };

/** The one matcher (DD-ECA-2, FR-ECA-010/011). Deterministic: tax id, then code, then normalised name. A key that matches
 *  several rows, a name match whose tax ids differ, or two ERP rows claiming one PMO row is a review. */
export function proposeMatches(kind: MasterKind, pmo: readonly PmoMaster[], erp: readonly NormalisedMaster[]): MatchOutcome[] {
  const policy = POLICY[kind];
  const live = pmo.filter((p) => p.active !== false);
  const sameRole = (p: PmoMaster, e: NormalisedMaster) => (p.role ?? null) === (e.role ?? null);
  const index = (key: (p: PmoMaster) => string) => {
    const m = new Map<string, PmoMaster[]>();
    for (const p of live) { const k = key(p); if (k) m.set(k, [...(m.get(k) ?? []), p]); }
    return m;
  };
  const byTax = index((p) => normTax(p.taxId)), byCode = index((p) => normCode(p.code)), byName = index((p) => normaliseName(p.name));
  const claims: Claim[] = [];
  const rows = erp.filter((e) => !e.internal).sort((a, b) => a.externalId.localeCompare(b.externalId));
  for (const e of rows) {
    const pick = (m: Map<string, PmoMaster[]>, k: string) => (k ? (m.get(k) ?? []).filter((p) => sameRole(p, e)) : []);
    const tax = pick(byTax, normTax(e.taxId));
    const code = tax.length ? [] : pick(byCode, normCode(e.code));
    // PQ-ECA-2: an inactive ERP row is a link target for a strong key only.
    const name = tax.length || code.length || !e.active ? [] : pick(byName, normaliseName(e.name));
    const hit = tax.length ? { c: tax, key: 'tax' as const } : code.length ? { c: code, key: 'code' as const } : { c: name, key: 'name' as const };
    if (hit.c.length === 0) continue;
    // Both tax ids set on a name match means they differ (equal ids would have matched on tax): a review.
    const conflict = hit.key === 'name' && normTax(e.taxId) !== '' && hit.c.some((p) => normTax(p.taxId) !== '');
    claims.push({ erp: e, pmoIds: hit.c.map((p) => p.id).sort(), key: hit.key, conflict });
  }
  // A PMO row claimed by more than one ERP row is doubtful for all of them.
  const claimCount = new Map<string, number>();
  for (const c of claims) for (const id of c.pmoIds) claimCount.set(id, (claimCount.get(id) ?? 0) + 1);
  const out: MatchOutcome[] = []; const touchedPmo = new Set<string>(); const touchedErp = new Set<string>();
  const doubtful: Claim[] = [];
  for (const c of claims) {
    touchedErp.add(c.erp.externalId); c.pmoIds.forEach((id) => touchedPmo.add(id));
    if (!c.conflict && c.pmoIds.length === 1 && claimCount.get(c.pmoIds[0]) === 1) out.push({ outcome: 'link', pmoId: c.pmoIds[0], externalId: c.erp.externalId, key: c.key });
    else doubtful.push(c);
  }
  // Doubtful claims sharing a PMO row merge into one review (union-find on PMO ids): every row gets exactly one outcome.
  const root = new Map<string, string>();
  const find = (id: string): string => { const r = root.get(id) ?? id; return r === id ? id : find(r); };
  for (const c of doubtful) for (const id of c.pmoIds.slice(1)) root.set(find(id), find(c.pmoIds[0]));
  const reviews = new Map<string, Claim[]>();
  for (const c of doubtful) { const k = find(c.pmoIds[0]); reviews.set(k, [...(reviews.get(k) ?? []), c]); }
  for (const cs of reviews.values()) out.push({ outcome: 'review', pmoIds: [...new Set(cs.flatMap((c) => c.pmoIds))].sort(),
    externalIds: cs.map((c) => c.erp.externalId).sort(), reason: cs.some((c) => c.conflict) ? 'tax-conflict' : 'ambiguous' });
  if (policy.bringIn) for (const e of rows) if (e.active && !touchedErp.has(e.externalId)) out.push({ outcome: 'bring-in', externalId: e.externalId });
  if (policy.send) for (const p of live) if (!touchedPmo.has(p.id)) out.push({ outcome: 'send', pmoId: p.id });
  return out;
}

export type PartyPick<C> =
  | { outcome: 'link'; candidate: C }
  | { outcome: 'none' }
  | { outcome: 'review'; reason: 'tax-conflict' | 'ambiguous'; eligible: number };

/** The shipped single-party entry point (feed, onboarding, Odoo harness), now a thin wrapper so every caller is v2.
 *  The caller's lookup supplies same-name, same-role candidates (and, after ECA2-T14, same-tax-id ones). */
export function pickPartyCandidate<C extends { taxId: string | null }>(taxId: string | null | undefined, candidates: readonly C[]): PartyPick<C> {
  if (candidates.length === 0) return { outcome: 'none' };
  const out = proposeMatches('party', candidates.map((c, i) => ({ id: String(i), name: 'candidate', taxId: c.taxId })),
    [{ kind: 'party', externalId: 'source', name: 'candidate', taxId: taxId ?? null, active: true }]);
  const hit = out.find((o) => o.outcome === 'link' || o.outcome === 'review');
  if (hit?.outcome === 'link') return { outcome: 'link', candidate: candidates[Number(hit.pmoId)] };
  if (hit?.outcome === 'review') return { outcome: 'review', reason: hit.reason === 'tax-conflict' ? 'tax-conflict' : 'ambiguous', eligible: hit.pmoIds.length };
  return { outcome: 'none' };
}
```
`erpnext/partyAdopt.ts:74` `normalizePartyName` becomes `export const normalizePartyName = normaliseName;` (one normaliser; the
ECA2-T14 candidate lookup uses it, so the feed and the setup screen agree on what "the same name" is).

Bump `connect/workflows.ts` `'party.match'` to `version: 2`; set `erpnext/workflowDeclarations.ts:19` and
`odoo/workflowDeclarations.ts:23` `'party.match'` to `version: 2` (PD-ECA-14). In `contractSuite/party.suite.ts` (the v2
behaviour change, so the bump is honest):
- `:32-38` becomes `it.each([null, ''])('FR-ECA-011 v2: a same-name candidate with an unset tax id next to a conflicting one is a review (%s)', …)` → `expect(r.outcome).toBe('review')`;
- `:45-51` becomes `'FR-ECA-011 v2: a unique tax id links even when an unset-tax candidate shares the name'` → `expect(r).toMatchObject({ outcome: 'link', pmoId: 'pmo-a' })`;
- add
```ts
    it('FR-ECA-011 v2: a unique tax id links even when the names differ', async () => {
      const r = await h.matchParty({ role: 'vendor', externalId: 'EXT-1', name: 'Other Name', taxId: 'TAX-1' }, [{ pmoId: 'pmo-1', taxId: 'TAX-1' }]);
      expect(r).toMatchObject({ outcome: 'link', pmoId: 'pmo-1' });
    });
```
No harness change: both harnesses reach `pickPartyCandidate` (ERPNext through `adoptParty`, Odoo directly at
`odoo/contract.harness.ts:58`). Then run the shipped callers' own tests; a v1 narrowing assertion there changes the same way and
is named in the PR as a deliberate v2 change.
Verify: `V src/lib/adapterSeam/connect/match.test.ts src/lib/adapterSeam/contractSuite/tiers.contract.test.ts src/lib/adapterSeam/contractSuite/parity.test.ts src/lib/adapterSeam/erpnext/partyAdopt.test.ts src/lib/adapterSeam/erpnext/onboarding.test.ts`
→ green; `DENO adapter-dispatch ../_shared/erpnextFeedDeps.partyMatch.test.ts && DENO erpnext-onboard index.test.ts` → green; `TC`.

### ECA2-T4 — census (AC-ECA-001, unit part; FR-ECA-001 money domains)
New `connect/census.ts`:
```ts
import { AdapterError } from '../contract.ts';
import type { CensusDomain, CensusRow, ConnectAdapter, MasterKind, Scenario } from './types.ts';
/** DD-ECA-1: the scenario is per kind. */
export function scenarioOf(pmoCount: number, erpCount: number): Scenario {
  if (pmoCount === 0 && erpCount === 0) return 'none';
  if (pmoCount === 0) return 'S-A';
  if (erpCount === 0) return 'S-C';
  return 'S-D';
}
export const CENSUS_KINDS: readonly MasterKind[] = ['party', 'item', 'project', 'employee', 'account'];
export const CENSUS_DOMAINS: readonly CensusDomain[] = ['budget', 'purchase', 'invoice', 'receipt', 'payment', 'timesheet'];
/** FR-ECA-001/003: one count call per kind or domain, read-only. `pmoCounts` comes from the database, never the request. */
export async function takeCensus(adapter: ConnectAdapter, pmoCounts: Readonly<Record<MasterKind | CensusDomain, number>>): Promise<CensusRow[]> {
  const rows: CensusRow[] = [];
  for (const kind of [...CENSUS_KINDS, ...CENSUS_DOMAINS]) {
    const pmoCount = pmoCounts[kind] ?? 0;
    let erpCount: number | null;
    try { erpCount = await adapter.countDomain(kind); } catch (e) {
      // A tier that cannot count a money domain yet says so; a master kind must always be countable.
      if (!(e instanceof AdapterError) || e.code !== 'commit-rejected' || (CENSUS_KINDS as readonly string[]).includes(kind)) throw e;
      erpCount = null;
    }
    rows.push({ kind, pmoCount, erpCount, scenario: erpCount === null ? null : scenarioOf(pmoCount, erpCount) });
  }
  return rows;
}
```
`connect/census.test.ts`: `it('AC-ECA-001 scenarioOf', …)` covering the four cells; a fake adapter whose `sendMaster` throws,
asserting `takeCensus` returns 11 rows (5 kinds + 6 domains) and never calls `sendMaster`; a fake whose `countDomain('timesheet')`
throws `AdapterError('commit-rejected')` gives that row `erpCount: null, scenario: null`; the same throw for `party` propagates.
Verify: `V src/lib/adapterSeam/connect/census.test.ts` red → implement → green.

### ECA2-T5 — failing pgTAP for the setup tables (AC-ECA-004, AC-ECA-007)
New `supabase/tests/erp_connect_setup.test.sql` (namespaced UUIDs, `begin … rollback`, `finish()`). Fixture: orgs A and B; in
A an Admin, a Finance user and an Engineer; an activated `erpnext` binding for A; PMO vendor `V1` (no ref); PMO profile `U1`
and an `erp_employees` row with `employee_number = 'HR-EMP-1'`; a run `R` with proposal rows written by
`replace_connect_proposals` as the service role: `link(V1 ↔ 'Supplier:ACME')`, `bring-in('Supplier:NEW', snapshot {name:'New Co', taxId:'9'})`,
`link(employee U1 ↔ 'HR-EMP-1')`, `link(employee U2 ↔ 'HR-EMP-404')` (no such `erp_employees` row), `review(ambiguous)`.
Assertions (each description starts with its AC id):
1. `AC-ECA-004` two `accept_connect_proposals('erpnext', 'party', array[bring-in id])` calls in one test (second as the same
   Admin) → one `companies` row named `New Co`, one `external_refs` row for `Supplier:NEW`; the second call returns `bring_in = 0`.
2. `AC-ECA-004` a bring-in accepted after the feed already inserted `external_refs(Supplier:NEW)` → no second company; the
   proposal is marked `applied` (reconciled), not an error.
3. `AC-ECA-007` one accept writes exactly one `audit_log` row with action `integration.connect_accept`, detail
   `{kinds:{party:{link:1, bring_in:1, send:0, left_open:0}}}`, actor = the Admin; the census row's `accepted_at` for `party` is set.
4. `AC-ECA-007` `unlink_connect_match(link id)` deletes the `external_refs` row and writes audit; after re-linking and giving
   `V1` a procurement case with ERP evidence (an `external_refs(procurement)` row on its purchase order), unlinking → `link in use`.
   Same refusal for a client with a pushed native invoice (`external_refs(revenue, si.id)`).
5. Employee links: `U1 ↔ HR-EMP-1` applies (`link_state = 'confirmed'`, `linked_by` = the Admin); `U2 ↔ HR-EMP-404` stays `open`
   with `reason_text` 'This person has not been read from the ERP yet' and does **not** abort the batch (both in one accept call).
6. `accept_connect_proposals('erpnext', null, null)` as the Admin applies every open non-review row of every kind; as Finance
   it applies `account` rows only.
7. RLS and grants: the Engineer selects 0 proposal rows; Finance selects rows of kind `account` only; B's Admin selects 0 of
   A's rows; `authenticated` cannot `insert`/`update` any of the four tables and cannot select `erp_connect_staged`; the Engineer
   calling `accept_connect_proposals` → `42501`; `anon` cannot execute any of the new functions; `service_role` has
   select/insert/update/delete on the four tables.
8. Review rows are untouched by accept-all: the `review` row stays `open`.
9. `replace_connect_proposals` sets the census row's `linked_count` to the number of `link` rows of that kind.

Also update `supabase/tests/0178_anon_executable_definers.test.sql`: add `accept_connect_proposals`, `decide_connect_review`,
`unlink_connect_match` to `client_callable_rpc_names` and raise both counts (`AC-ACL-002`, `AC-ACL-003`) by 3.
Verify: `PGT supabase/tests/erp_connect_setup.test.sql supabase/tests/0178_anon_executable_definers.test.sql supabase/tests/0137_service_role_grants.test.sql`
→ red (relations missing); grep the output for `Parse errors` (an aborted file reports 0 tests).

### ECA2-T6 — migration `0451_erp_connect_setup.sql` (green)
```sql
-- ECA-2 (#1605): census, match proposals and one-pass accept (FR-ECA-001..016). Tier-keyed, shared by ERPNext and Odoo.
-- Reversal: rollback/0451_erp_connect_setup_down.sql.
create table public.erp_connect_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  external_tier text not null,
  state text not null default 'staging' check (state in ('staging','proposing','ready','failed')),
  cursor jsonb not null default '{}'::jsonb check (jsonb_typeof(cursor) = 'object'),   -- {kind: next cursor|null}
  proposed_kinds text[] not null default '{}',                                         -- kinds proposed so far (one per tick)
  started_by uuid references public.profiles(id), started_at timestamptz not null default now(),
  finished_at timestamptz, error_class text
);
create unique index erp_connect_runs_one_open on public.erp_connect_runs (org_id, external_tier) where state in ('staging','proposing');

-- PD-ECA-1: one run's ERP master pages. Never Odoo's directory mirror; deleted with the run.
create table public.erp_connect_staged (
  run_id uuid not null references public.erp_connect_runs(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  kind text not null check (kind in ('party','item','project','employee','account')),
  external_id text not null,
  row jsonb not null check (jsonb_typeof(row) = 'object'),   -- the NormalisedMaster
  primary key (run_id, kind, external_id)
);

create table public.erp_connect_census (
  org_id uuid not null references public.organizations(id) on delete cascade,
  external_tier text not null,
  kind text not null check (kind in ('party','item','project','employee','account',
                                     'budget','purchase','invoice','receipt','payment','timesheet')),
  pmo_count int not null, erp_count int, linked_count int not null default 0, inactive_erp_count int not null default 0,
  scenario text check (scenario in ('none','S-A','S-C','S-D')),   -- null: this ERP cannot count the domain yet
  accepted_at timestamptz,                                          -- PD-ECA-15: first bulk accept of this kind
  taken_at timestamptz not null default now(),
  primary key (org_id, external_tier, kind)
);

create table public.erp_connect_proposals (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  external_tier text not null,
  run_id uuid references public.erp_connect_runs(id) on delete set null,
  kind text not null check (kind in ('party','item','project','employee','account')),
  outcome text not null check (outcome in ('link','bring-in','send','review')),
  identity text not null,                      -- outcome|sorted pmo ids|sorted external ids: re-proposal upserts
  pmo_ids text[] not null default '{}', external_ids text[] not null default '{}',
  match_key text check (match_key in ('tax','code','name')),
  reason text check (reason in ('ambiguous','tax-conflict','rejected','held')),
  reason_text text,                            -- plain words, never ERP vocabulary (FR-ECA-022)
  snapshot jsonb not null default '{}'::jsonb,  -- the ERP fields a link/bring-in applies (PD-ECA-2)
  state text not null default 'open' check (state in ('open','sending','applied','dismissed')),
  decided_by uuid references public.profiles(id), decided_at timestamptz,
  created_at timestamptz not null default now(),
  unique (org_id, external_tier, kind, identity)
);
create index erp_connect_proposals_queue on public.erp_connect_proposals (org_id, external_tier, kind, outcome, state);

alter table public.erp_connect_runs enable row level security;      alter table public.erp_connect_runs force row level security;
alter table public.erp_connect_staged enable row level security;    alter table public.erp_connect_staged force row level security;
alter table public.erp_connect_census enable row level security;    alter table public.erp_connect_census force row level security;
alter table public.erp_connect_proposals enable row level security; alter table public.erp_connect_proposals force row level security;
create policy erp_connect_runs_select on public.erp_connect_runs for select
  using (org_id = public.auth_org_id() and public.is_active_member() and public.auth_role() in ('Admin','Finance'));
create policy erp_connect_census_select on public.erp_connect_census for select
  using (org_id = public.auth_org_id() and public.is_active_member() and public.auth_role() in ('Admin','Finance'));
create policy erp_connect_proposals_select on public.erp_connect_proposals for select
  using (org_id = public.auth_org_id() and public.is_active_member()
         and (public.auth_role() = 'Admin' or (public.auth_role() = 'Finance' and kind = 'account')));
-- erp_connect_staged: no client policy and no client grant (it holds raw ERP names, including people).
revoke all on public.erp_connect_runs, public.erp_connect_staged, public.erp_connect_census, public.erp_connect_proposals from anon, authenticated;
grant select on public.erp_connect_runs, public.erp_connect_census, public.erp_connect_proposals to authenticated;
grant select, insert, update, delete on public.erp_connect_runs, public.erp_connect_staged, public.erp_connect_census,
  public.erp_connect_proposals to service_role;

-- FR-ODC-073 / FR-ECA-015: the ONE re-link check. A link is in use once an ERP document that names the master exists.
-- Later slices (Odoo O2+, inventory) extend THIS function; they never add a second check.
create or replace function public.connect_link_in_use(p_org_id uuid, p_domain text, p_pmo_record_id text) returns boolean
language sql stable security definer set search_path = public as $$
  select case p_domain
    when 'companies' then exists (
        select 1 from public.procurements p
         where p.org_id = p_org_id and p.vendor_id::text = p_pmo_record_id
           and public.procurement_case_has_external_evidence(p_org_id, p.id))      -- outbox, #1319 links, any ref (0393)
      or exists (select 1 from public.sales_invoices si where si.org_id = p_org_id and si.customer_id::text = p_pmo_record_id
                    and (not si.pmo_native and si.erp_docstatus is not null
                         or exists (select 1 from public.external_refs r where r.org_id = p_org_id and r.domain = 'revenue'
                                       and r.pmo_record_id = si.id::text)))
    when 'projects' then exists (
        select 1 from public.procurements p
         where p.org_id = p_org_id and p.project_id::text = p_pmo_record_id
           and public.procurement_case_has_external_evidence(p_org_id, p.id))
      or exists (select 1 from public.sales_invoices si where si.org_id = p_org_id and si.project_id::text = p_pmo_record_id
                    and (not si.pmo_native and si.erp_docstatus is not null
                         or exists (select 1 from public.external_refs r where r.org_id = p_org_id and r.domain = 'revenue'
                                       and r.pmo_record_id = si.id::text)))
      or exists (select 1 from public.budget_version_account_erp_mirror m join public.budget_versions v on v.id = m.budget_version_id
                  where m.org_id = p_org_id and v.project_id::text = p_pmo_record_id)
    when 'employees' then exists (
        select 1 from public.timesheets t join public.external_refs r
          on r.org_id = t.org_id and r.domain = 'timesheets' and r.pmo_record_id = t.id::text
         where t.org_id = p_org_id and t.user_id::text = p_pmo_record_id)
    when 'accounts' then exists (
        select 1 from public.budget_version_account_erp_mirror m join public.budget_category_account_map a
          on a.org_id = m.org_id and a.erp_account = m.erp_account
         where m.org_id = p_org_id and a.category::text = p_pmo_record_id)
    else false end   -- items: a pushed line carries its code; unlinking changes only future lines
$$;
revoke all on function public.connect_link_in_use(uuid,text,text) from public, anon, authenticated;
```
(The builder confirms the `external_refs.pmo_record_id` shape for `timesheets` and `revenue` at head before writing the
predicate; `0410_billing_kinds.sql:88` is the revenue precedent.)

Service-only writers (`revoke all … from public, anon, authenticated; grant execute … to service_role`), each scoping by
`p_org_id` resolved by the caller from the binding (NFR-ECA-003):
- `start_connect_run(p_org_id uuid, p_tier text, p_actor uuid) returns uuid` — inserts a `staging` run; on the
  `erp_connect_runs_one_open` conflict returns the open run's id.
- `write_connect_census(p_org_id uuid, p_tier text, p_rows jsonb)` — upsert per kind from `[{kind,pmoCount,erpCount,scenario}]`
  (keeps `accepted_at` and `linked_count`).
- `stage_connect_master_page(p_org_id uuid, p_run_id uuid, p_kind text, p_rows jsonb, p_next_cursor text)` — upserts
  `erp_connect_staged` (`on conflict (run_id, kind, external_id) do update set row = excluded.row`) and writes
  `cursor[kind] = p_next_cursor` (JSON null when done) in the same statement block; flips the run to `proposing` when every
  kind's cursor is JSON null. Refuses a run of another org.
- `replace_connect_proposals(p_org_id uuid, p_tier text, p_run_id uuid, p_kind text, p_rows jsonb, p_last boolean)` — upserts rows by
  `identity` (`on conflict … do update set run_id, snapshot, reason` only `where state = 'open'`); deletes `open` rows of that
  kind whose `run_id` is not `p_run_id` (a stale proposal disappears; applied history stays); sets the census row's
  `linked_count` (link rows of the kind) and `inactive_erp_count` (staged rows of the kind with `row->>'active' = 'false'`);
  appends the kind to `proposed_kinds`, and when all five are proposed sets the run `ready`, `finished_at = now()` and deletes
  its `erp_connect_staged` rows. Called once per chunk of ≤ 1,000 rows (`p_rows`); the stale-row delete, the census counts and the `proposed_kinds` append run
only when `p_last` (the kind's final chunk).
- `record_connect_review(p_org_id uuid, p_tier text, p_kind text, p_pmo_ids text[], p_external_ids text[], p_reason text, p_reason_text text)`
  — the feed's single-row review (ECA2-T14); same upsert-by-identity.
- `apply_connect_outcome(p_org_id uuid, p_tier text, p_kind text, p_outcome text, p_pmo_id text, p_external_id text, p_snapshot jsonb) returns text`
  — one link or bring-in through the same internal appliers as the accept (null = applied, else the plain reason). This is the
  tier-agnostic service-role entry the Odoo feed calls (Odoo plan S6-T2 then runs against it and S6-T3 is skipped).

Internal appliers (definer, `revoke all … from public, anon, authenticated`, no grant), each `returns text` — `null` when
applied, else the plain reason the row stays `open` with (so one bad row never aborts a batch):
- `apply_connect_link(p_org uuid, p_tier text, p_kind text, p_pmo text, p_ext text, p_snapshot jsonb, p_actor uuid)`:
  `party` → `insert into external_refs (org_id, domain, pmo_record_id, external_tier, external_record_id) values
  (p_org,'companies',p_pmo,p_tier,p_ext) on conflict do nothing`; when it landed, `update companies set erp_tax_id =
  coalesce(erp_tax_id, p_snapshot->>'taxId') where id = p_pmo::uuid and org_id = p_org`; when it did not land and the existing ref
  names the same pair → `null` (reconciled); another pair → 'This record is already linked to another ERP record'.
  `project` → `public.connect_link_project(p_org, p_tier, p_pmo, p_ext)`: for `erpnext`, `update external_org_bindings set
  config = jsonb_set(config,'{project_map}', coalesce(config->'project_map','{}'::jsonb) || jsonb_build_object(p_pmo, p_ext))
  where org_id = p_org and external_tier = p_tier and status = 'active' and not coalesce(config->'project_map','{}'::jsonb) ? p_pmo`
  (never re-points; no row updated → 'This project is already linked'); any other tier → 'Project links for this ERP are not
  available yet'. Odoo S6-T7 adds its `link_odoo_cost_account` arm to **this** function (one project-link writer per tier, one
  caller).
  `item` → same as the ERPNext project arm on `config.item_map`, keyed by the line name (PD-ECA-5).
  `employee` → `update erp_employees set profile_id = p_pmo::uuid, link_state = 'confirmed', linked_by = p_actor, linked_at =
  now() where org_id = p_org and employee_number = p_ext and link_state <> 'confirmed'` (the 0148 semantics; the bulk accept is
  the reviewed first match, DD-UX-1 §5). No row → 'This person has not been read from the ERP yet'; `unique_violation`
  (`erp_employees_org_profile_confirmed_uidx`, one confirmed employee per person) → 'This person is already linked to another
  ERP employee'. The ERP employee id (`employee_number`) is the proposal's external id; `erp_employees.id` is never used here.
  `account` → `insert into budget_category_account_map (org_id, category, erp_account) values (p_org,
  p_pmo::public.budget_category, p_ext) on conflict do nothing` (both `unique (org_id, category)` and `unique (org_id,
  erp_account)` hold, `0137_budget_push_seam.sql:94-95`); nothing inserted → 'This account is already used by another category'.
- `apply_connect_bring_in(p_org uuid, p_tier text, p_kind text, p_ext text, p_snapshot jsonb)` — `party` only: claim first
  (`insert into external_refs … on conflict (org_id, domain, external_record_id) do nothing returning pmo_record_id`, the order of
  `onboarding.ts:150-162`), then insert `companies (id, org_id, name, type, erp_tax_id, erp_party_type)` with the claimed id, so a
  lost race writes no company and returns `null` (reconciled).

Actor-checked writers (SECURITY DEFINER; `revoke all … from public, anon; grant execute … to authenticated`; actor =
`auth.uid()`; org, active member and role re-asserted in the body exactly as `0148_confirm_erp_employee_link.sql:55-58`):
```sql
create or replace function public.accept_connect_proposals(p_tier text, p_kind text default null, p_ids uuid[] default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_actor uuid := auth.uid(); v_org uuid := public.auth_org_id(); v_role text := public.auth_role()::text;
        r record; v_reason text; v_counts jsonb := '{}'::jsonb; v_k text; v_field text;
begin
  if v_actor is null or v_org is null or not public.is_active_member() or v_role not in ('Admin','Finance') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_role = 'Finance' and coalesce(p_kind, 'account') <> 'account' then raise exception 'not allowed' using errcode = '42501'; end if;
  -- p_kind null = every kind the actor may accept; p_ids null = every open non-review row (FR-ECA-012 "all", at any size).
  for r in select * from public.erp_connect_proposals
            where org_id = v_org and external_tier = p_tier and state = 'open' and outcome <> 'review'
              and (kind = p_kind or (p_kind is null and (v_role = 'Admin' or kind = 'account')))
              and (p_ids is null or id = any(p_ids))
            order by kind, id for update loop
    v_reason := null;
    if r.outcome = 'link' then
      v_reason := public.apply_connect_link(v_org, p_tier, r.kind, r.pmo_ids[1], r.external_ids[1], r.snapshot, v_actor);
    elsif r.outcome = 'bring-in' then
      v_reason := public.apply_connect_bring_in(v_org, p_tier, r.kind, r.external_ids[1], r.snapshot);
    end if;
    if r.outcome = 'send' then   -- queued for ECA-3's drain; nothing is reported done before the ERP confirms (NFR-ECA-004)
      update public.erp_connect_proposals set state = 'sending', decided_by = v_actor, decided_at = now() where id = r.id;
      v_field := 'send';
    elsif v_reason is null then
      update public.erp_connect_proposals set state = 'applied', decided_by = v_actor, decided_at = now() where id = r.id;
      v_field := replace(r.outcome, '-', '_');
    else
      update public.erp_connect_proposals set reason_text = v_reason where id = r.id;
      v_field := 'left_open';
    end if;
    v_counts := jsonb_set(v_counts, array[r.kind], coalesce(v_counts->r.kind, '{"link":0,"bring_in":0,"send":0,"left_open":0}'::jsonb));
    v_counts := jsonb_set(v_counts, array[r.kind, v_field], to_jsonb((v_counts #>> array[r.kind, v_field])::int + 1));
  end loop;
  for v_k in select jsonb_object_keys(v_counts) loop
    update public.erp_connect_census set accepted_at = coalesce(accepted_at, now())
     where org_id = v_org and external_tier = p_tier and kind = v_k;
  end loop;
  perform public.log_audit('integration.connect_accept', v_org, v_actor, null, jsonb_build_object('tier', p_tier, 'kinds', v_counts));
  return v_counts;
end $$;
revoke all on function public.accept_connect_proposals(text,text,uuid[]) from public, anon;
grant execute on function public.accept_connect_proposals(text,text,uuid[]) to authenticated;
```
One call is one audit row naming every kind it touched with its counts (FR-ECA-015).
`decide_connect_review(p_id uuid, p_choice jsonb)` — Admin (Finance for account): `{action:'link', pmoId, externalId}` applies one
link from the row's own candidates through `apply_connect_link` (a non-null reason is raised as the error message);
`{action:'dismiss'}` sets `dismissed`. Audited `integration.connect_review`.
`unlink_connect_match(p_id uuid)` — Admin: maps the kind to its domain (`party→companies`, `project→projects`,
`employee→employees`, `account→accounts`, `item→items`), refuses with 'link in use' when `connect_link_in_use(org, domain,
pmo)`; otherwise removes the link (the `external_refs` row, the config key, the `budget_category_account_map` row, or the
`erp_employees` link back to `unlinked`), sets the proposal back to `open`, audit `integration.connect_unlink`.
Rollback `supabase/migrations/rollback/0451_erp_connect_setup_down.sql`: drop the twelve functions and four tables.
Verify: `PGT supabase/tests/erp_connect_setup.test.sql supabase/tests/0178_anon_executable_definers.test.sql supabase/tests/0137_service_role_grants.test.sql`
→ green, no `Parse errors`; mutation check: replace the role re-assertion with `if false then` → the Engineer case goes red; restore.

### ECA2-T7 — ERPNext `ConnectAdapter` reads (failing test first)
`erpnext/connectAdapter.test.ts` with a fake fetch answering `GET /api/resource/<Doctype>?…` from in-memory arrays and
`GET /api/method/frappe.client.get_count?doctype=…`:
- `listMasters('party', null)` pages Supplier then Customer, 200 per page ordered by `name asc`, `nextCursor` =
  `'Supplier:<last name>'`, then `'Customer:…'`, then `null`; rows normalised `{kind:'party', externalId:'Supplier:SUP-1',
  role:'vendor', taxId, name: supplier_name, active: disabled !== 1, internal: is_internal_supplier === 1}`.
- `listMasters('project'|'item'|'employee'|'account')` map `Project{name, project_name, status}` (code = `name`),
  `Item{name, item_name, disabled}` (code = `name`), `Employee{name, employee_name, company_email, user_id, status}` (code =
  the lower-cased `company_email`, else `user_id`: the work-email key of OQ-TSP-10(C), so people link on a key, not on a name),
  `Account{name,
  account_name, account_number, parent_account, root_type, is_group, disabled}` with `code = accountCategoryKey(...)` (ECA2-T8: build T8 before this task).
- `countDomain(kind)` sums the doctypes' `get_count` and issues **no** POST/PUT (assert the fake saw only GETs); for the six
  money domains it counts submitted documents (`docstatus = 1`, company-filtered): `budget` Budget, `purchase` Purchase
  Order + Purchase Receipt + Purchase Invoice, `invoice` Sales Invoice, `receipt` Payment Entry `payment_type = Receive`,
  `payment` Payment Entry `payment_type = Pay`, `timesheet` Timesheet.
- Every request is filtered by `company = <binding company>` where the doctype has a company field (Project, Employee, Account).
Then `erpnext/connectAdapter.ts`:
```ts
import { AdapterError } from '../contract.ts';
import type { CensusDomain, ConnectAdapter, MasterKind, NormalisedMaster } from '../connect/types.ts';
import { erpnextRequest, type ErpClientDeps } from './client.ts';
import { accountCategoryKey } from '../../budget/categoryAccountMap.ts';
export const ERP_CONNECT_PAGE = 200;
const SPECS: Partial<Record<MasterKind, Array<{ doctype: string; fields: string[]; company: boolean; map: (r: Record<string, unknown>) => NormalisedMaster }>>> = {
  party: [
    { doctype: 'Supplier', fields: ['name', 'supplier_name', 'tax_id', 'disabled', 'is_internal_supplier'], company: false,
      map: (r) => ({ kind: 'party', externalId: `Supplier:${r.name}`, role: 'vendor', taxId: (r.tax_id as string) ?? null, name: String(r.supplier_name ?? r.name), active: r.disabled !== 1, internal: r.is_internal_supplier === 1 }) },
    { doctype: 'Customer', fields: ['name', 'customer_name', 'tax_id', 'disabled', 'is_internal_customer'], company: false,
      map: (r) => ({ kind: 'party', externalId: `Customer:${r.name}`, role: 'client', taxId: (r.tax_id as string) ?? null, name: String(r.customer_name ?? r.name), active: r.disabled !== 1, internal: r.is_internal_customer === 1 }) },
  ],
  project: [{ doctype: 'Project', fields: ['name', 'project_name', 'status'], company: true,
    map: (r) => ({ kind: 'project', externalId: String(r.name), code: String(r.name), name: String(r.project_name ?? r.name), active: r.status !== 'Cancelled' }) }],
  item: [{ doctype: 'Item', fields: ['name', 'item_name', 'disabled'], company: false,
    map: (r) => ({ kind: 'item', externalId: String(r.name), code: String(r.name), name: String(r.item_name ?? r.name), active: r.disabled !== 1 }) }],
  employee: [{ doctype: 'Employee', fields: ['name', 'employee_name', 'company_email', 'user_id', 'status'], company: true,
    map: (r) => ({ kind: 'employee', externalId: String(r.name), code: String(r.company_email ?? r.user_id ?? '').toLowerCase() || null,
      name: String(r.employee_name ?? r.name), active: r.status === 'Active' }) }],
  account: [{ doctype: 'Account', fields: ['name', 'account_name', 'account_number', 'parent_account', 'root_type', 'is_group', 'disabled'], company: true,
    map: (r) => ({ kind: 'account', externalId: String(r.name), code: accountCategoryKey({ account: String(r.name), accountName: String(r.account_name ?? ''), accountNumber: (r.account_number as string) ?? null, parentAccount: (r.parent_account as string) ?? null, rootType: String(r.root_type ?? ''), isGroup: r.is_group === 1, disabled: r.disabled === 1 }), name: String(r.account_name ?? r.name), active: r.disabled !== 1 && r.is_group !== 1 }) }],
};
/** FR-ECA-001 money domains: submitted documents only. */
const DOMAIN_COUNTS: Record<CensusDomain, Array<{ doctype: string; extra?: unknown[][] }>> = {
  budget: [{ doctype: 'Budget' }], invoice: [{ doctype: 'Sales Invoice' }], timesheet: [{ doctype: 'Timesheet' }],
  purchase: [{ doctype: 'Purchase Order' }, { doctype: 'Purchase Receipt' }, { doctype: 'Purchase Invoice' }],
  receipt: [{ doctype: 'Payment Entry', extra: [['payment_type', '=', 'Receive']] }],
  payment: [{ doctype: 'Payment Entry', extra: [['payment_type', '=', 'Pay']] }],
};
export function createErpnextConnectAdapter(client: ErpClientDeps, company: string): ConnectAdapter {
  const specOf = (kind: string) => { const s = SPECS[kind as MasterKind]; if (!s) throw new AdapterError('commit-rejected', `kind ${kind} unavailable`); return s; };
  const filters = (company_: boolean, after: string | null) => [...(company_ ? [['company', '=', company]] : []), ...(after ? [['name', '>', after]] : [])];
  return {
    tier: 'erpnext',
    async listMasters(kind, cursor) {
      const specs = specOf(kind);
      const [doctype, after] = cursor ? [cursor.slice(0, cursor.indexOf(':')), cursor.slice(cursor.indexOf(':') + 1)] : [specs[0].doctype, null];
      const i = specs.findIndex((s) => s.doctype === doctype); const s = specs[i];
      const q = new URLSearchParams({ fields: JSON.stringify(s.fields), filters: JSON.stringify(filters(s.company, after)), order_by: 'name asc', limit_page_length: String(ERP_CONNECT_PAGE) });
      const res = await erpnextRequest(client, { method: 'GET', path: `/api/resource/${encodeURIComponent(s.doctype)}?${q}` }) as { data?: Array<Record<string, unknown>> };
      const rows = res.data ?? [];
      const next = rows.length === ERP_CONNECT_PAGE ? `${s.doctype}:${rows.at(-1)!.name}` : specs[i + 1] ? `${specs[i + 1].doctype}:` : null;
      return { rows: rows.map(s.map), nextCursor: next };
    },
    async countDomain(kind) {
      let total = 0;
      const money = DOMAIN_COUNTS[kind as CensusDomain];
      for (const d of money ?? []) {
        const q = new URLSearchParams({ doctype: d.doctype, filters: JSON.stringify([['company', '=', company], ['docstatus', '=', 1], ...(d.extra ?? [])]) });
        total += Number((await erpnextRequest(client, { method: 'GET', path: `/api/method/frappe.client.get_count?${q}` }) as { message?: number }).message ?? 0);
      }
      if (money) return total;
      for (const s of specOf(kind)) {
        const q = new URLSearchParams({ doctype: s.doctype, filters: JSON.stringify(filters(s.company, null)) });
        total += Number((await erpnextRequest(client, { method: 'GET', path: `/api/method/frappe.client.get_count?${q}` }) as { message?: number }).message ?? 0);
      }
      return total;
    },
    async sendMaster() { throw new AdapterError('commit-rejected', 'send unavailable until ECA-3'); },
  };
}
```
(`cursor` `'Customer:'` with an empty suffix means "start Customer from the top": `after` is `''` → falsy → no `name >` filter.)
Verify: `V src/lib/adapterSeam/erpnext/connectAdapter.test.ts` red → green.

### ECA2-T8 — account key derivation (PD-ECA-6)
In `budget/categoryAccountMap.ts` export
`accountCategoryKey(account: BudgetPostingAccount, categories = Object.keys(CATEGORY_TERMS)): string | null` = the single
category whose terms match a direct-cost posting account (`isDirectCostPostingAccount` true), `null` for none or several.
Re-write `proposeBudgetAccountMap` as: `proposeMatches('account', categories.map((c) => ({ id: c, name: c, code: c })),
accounts.map((a) => ({ kind: 'account', externalId: a.account, code: accountCategoryKey(a, categories), name: a.accountName,
active: !a.disabled && !a.isGroup })))` filtered to `link` outcomes, minus accounts in `alreadyAssigned`, mapped to the
existing `BudgetAccountProposal` shape. Keep `categoryAccountMap.test.ts` unchanged — it is the behaviour oracle for the
move; add `it('accountCategoryKey is null when two categories match', …)`.
Verify: `V src/lib/budget/categoryAccountMap.test.ts` → green before and after.

### ECA2-T9 — project proposal via the matcher
`repositories/projectMatchReview.ts:13-60`: keep the exported signature; body becomes `proposeMatches('project', projects.map((p) => ({ id: p.id,
name: p.name, code: p.code })), candidates.map((c) => ({ kind: 'project', externalId: c.name, code: c.name, name: c.project_name, active: true })))`
mapped `link→proposed` (only when `complete`), `review→ambiguous` (candidateIds = externalIds), else `unresolved`.
Verify: `V src/lib/repositories/projectMatchReview.test.ts src/components/integrations/ProjectMatchReview.test.tsx` → green
(behaviour unchanged; tests are the oracle).

### ECA2-T10 — shared suites `census` and `item.match` / `account.match` / `employee.match` (AC-ECA-001, AC-ECA-042)
Extend `ConnectHarness` in `contractSuite/harness.ts`:
```ts
  /** Place ERP masters in the fake ERP (PMO terms); returns nothing. */
  load(kind: MasterKind, rows: readonly Omit<NormalisedMaster, 'kind'>[]): void;
  /** Requests that reached the fake ERP, split by read and write. */
  calls(): { reads: number; writes: number };
```
New `contractSuite/census.suite.ts` (`census`): load S-A (ERP 3 parties, PMO 0), S-C (ERP 0 items, PMO 2), S-D (ERP 2
projects, PMO 2) and assert `takeCensus(c.adapter, {party:0,item:2,project:2,employee:0,account:0, budget:0,purchase:0,invoice:0,receipt:0,payment:0,timesheet:0})`
gives the five kind rows `S-A/S-C/S-D/none/none`, six domain rows (a number or `null`, never an error), and
`c.calls().writes === 0` — test title `'AC-ECA-001 …'`. The ERPNext fake answers `get_count` for the money doctypes with 0.
New `contractSuite/match.suite.ts` exporting `matchSuite(kind)` for `item`, `account`, `employee`: load ERP rows through the
harness, page them with `listMasters` until `nextCursor === null` (assert ≥ 2 pages by loading `ERP_CONNECT_PAGE + 1` rows
for `item`), run `proposeMatches(kind, pmo, rows)` and assert one exact-code link, one review, no write.
Register in `contractSuite/index.ts`: `census`, `item.match`, `account.match`, `employee.match`. ERPNext harness `connect()`
returns a fake ERPNext answering the T7 paths from loaded rows (re-use T7's fake), counting reads/writes. Flip ERPNext
declarations `census`, `item.match`, `account.match`, `employee.match` to `supported`. Odoo: `census`, `item.match`,
`account.match` → `supported` when its harness implements `load`/`calls` over `fakeOdoo.ts` (an Odoo O1 task; until then
Odoo keeps them `pending 1605` and the parity test stays green because pending needs no suite).
Verify: `V src/lib/adapterSeam/contractSuite/tiers.contract.test.ts src/lib/adapterSeam/contractSuite/parity.test.ts` → green.

### ECA2-T11 — the run loop (tier-agnostic)
New `connect/run.ts`:
```ts
import { proposeMatches } from './match.ts';
import type { ConnectAdapter, MasterKind, MatchOutcome, NormalisedMaster, PmoMaster } from './types.ts';
export const RUN_KINDS: readonly MasterKind[] = ['party', 'item', 'project', 'employee', 'account'];
export interface ConnectRunDeps {
  adapter: ConnectAdapter;
  run: { id: string; state: 'staging' | 'proposing' | 'ready' | 'failed'; cursor: Partial<Record<MasterKind, string | null>>; proposedKinds: MasterKind[] };
  stagePage(kind: MasterKind, rows: NormalisedMaster[], nextCursor: string | null): Promise<void>;
  stagedErp(kind: MasterKind): Promise<NormalisedMaster[]>;   // read back from erp_connect_staged, keyset pages of 1,000 (< max_rows)
  pmoMasters(kind: MasterKind): Promise<PmoMaster[]>;          // org-scoped from the binding's org
  /** Writes in chunks of ≤ 1,000 rows through replace_connect_proposals; the last chunk marks the kind proposed. */
  writeProposals(kind: MasterKind, rows: MatchOutcome[], snapshot: (externalId: string) => NormalisedMaster | undefined): Promise<void>;
  budget: { calls: number };                                     // ERP calls left this tick
}
/** One bounded step (NFR-ECA-005): page masters until the budget is spent; once every kind is staged, propose ONE kind per
 *  call. ponytail: one kind's whole staged set is matched in memory (100k items ≈ tens of MB); shard by name prefix if a
 *  tenant outgrows a tick. */
export async function advanceConnectRun(d: ConnectRunDeps): Promise<'more' | 'ready'> {
  for (const kind of RUN_KINDS) {
    let cursor = d.run.cursor[kind];
    if (cursor === null) continue;                 // done
    while (d.budget.calls > 0) {
      d.budget.calls -= 1;
      const page = await d.adapter.listMasters(kind, cursor ?? null);
      await d.stagePage(kind, page.rows, page.nextCursor);
      cursor = page.nextCursor; d.run.cursor[kind] = cursor;
      if (cursor === null) break;
    }
    if (cursor !== null) return 'more';
  }
  const kind = RUN_KINDS.find((k) => !d.run.proposedKinds.includes(k));
  if (kind === undefined) return 'ready';
  const erp = await d.stagedErp(kind);
  const byId = new Map(erp.map((e) => [e.externalId, e]));
  await d.writeProposals(kind, proposeMatches(kind, await d.pmoMasters(kind), erp), (id) => byId.get(id));
  d.run.proposedKinds.push(kind);
  return d.run.proposedKinds.length === RUN_KINDS.length ? 'ready' : 'more';
}
```
(`replace_connect_proposals` sets the run `ready` when the fifth kind lands, ECA2-T6.)
`connect/run.test.ts`: a fake adapter with 450 parties and budget 2 → first call `'more'` with 400 staged; then one call per
kind, each calling `writeProposals` once for that kind, the fifth returning `'ready'`; a thrown `listMasters` propagates and
leaves the cursor at the last good page.
Verify: `V src/lib/adapterSeam/connect/run.test.ts` red → green.

### ECA2-T12 — setup verbs (Deno, failing first)
`supabase/functions/external-set-company/connect.test.ts` imports the shipped `handleConnectAction` from `./connect.ts`
with `globalThis.fetch` mocked (repo rule, `scripts/check-edge-fn-test-binding.mjs`):
- `census` as Admin → `start_connect_run` + `write_connect_census` called with `orgId` from the caller's profile even when the
  body carries another `orgId` (NFR-ECA-003); response `{runId, census:[…5 rows]}`; ERP saw no POST.
- `accept-proposals` as Engineer → 403 before any RPC; as Admin → calls `accept_connect_proposals` with the **caller's JWT
  client** (not the service client), passes `{tier, kind, ids}` (`kind`/`ids` may be absent = all), returns the RPC's counts.
- `census` as Finance → 403 even with `kind: 'account'` in the body (Finance may only list, accept and decide account rows).
- `list-proposals` → reads `erp_connect_proposals` via the caller client, 200 per page by `id`, filter by `outcome`.
- `connect-status` → the run row + census rows.
- `decide-review`, `unlink-match` → their RPCs via the caller client.
Then `connect.ts`:
```ts
/** ECA setup verbs (FR-ECA-001/002/012/015), tier-agnostic: the adapter comes from the registry, never a branch on tier. */
export const CONNECT_ACTIONS = new Set(['census', 'connect-status', 'list-proposals', 'accept-proposals', 'decide-review', 'unlink-match']);
export async function handleConnectAction(ctx: { serviceClient: SupabaseClient; callerClient: SupabaseClient; orgId: string; userId: string; role: string; body: Record<string, unknown> }): Promise<unknown> {
  const tier = String(ctx.body.tier);
  const action = String(ctx.body.setupAction);
  const finance = ctx.role === 'Finance' && ctx.body.kind === 'account' && ['list-proposals', 'accept-proposals', 'decide-review'].includes(action);
  if (ctx.role !== 'Admin' && !finance && action !== 'connect-status') throw new AppError('Admin role required', 'FORBIDDEN');
  if (action === 'census') {
    const adapter = await connectAdapterForOrg(ctx.serviceClient, ctx.orgId, tier);
    const runId = await rpc(ctx.serviceClient, 'start_connect_run', { p_org_id: ctx.orgId, p_tier: tier, p_actor: ctx.userId });
    const census = await takeCensus(adapter, await pmoMasterCounts(ctx.serviceClient, ctx.orgId));
    await rpc(ctx.serviceClient, 'write_connect_census', { p_org_id: ctx.orgId, p_tier: tier, p_rows: census });
    return { runId, census };
  }
  if (action === 'accept-proposals') return await rpc(ctx.callerClient, 'accept_connect_proposals', { p_tier: tier, p_kind: ctx.body.kind ?? null, p_ids: ctx.body.ids ?? null });
  if (action === 'decide-review') return await rpc(ctx.callerClient, 'decide_connect_review', { p_id: ctx.body.id, p_choice: ctx.body.choice });
  if (action === 'unlink-match') return await rpc(ctx.callerClient, 'unlink_connect_match', { p_id: ctx.body.id });
  if (action === 'list-proposals') return await listProposals(ctx.callerClient, tier, ctx.body);
  return await connectStatus(ctx.callerClient, tier);
}
```
`pmoMasterCounts` counts live `companies` (type Client/Vendor, not archived), distinct `procurement_items.name` on
procurements not `Paid`/`Cancelled`, `projects` not archived, active `profiles`, budget categories in use, and the six money
domains (`budget_versions` Active, `procurements` not Cancelled, native `sales_invoices` not Cancelled, native
`incoming_payments`, `payments`, Approved `timesheets`) — all `.eq('org_id', orgId)` with `{ count: 'exact', head: true }`
(never a row read, so no `max_rows` cap applies). Distinct item names need a row read: page them by keyset at 1,000.
New `supabase/functions/_shared/connectAdapterForOrg.ts`: `const FACTORIES: Record<string, (sc, orgId) => Promise<ConnectAdapter>> = { erpnext: …erpClientForOrg + createErpnextConnectAdapter(client, config.company), odoo: …odooClientForOrg + createOdooConnectAdapter }`;
unknown tier or a refusal → `AppError('config-rejected')`. A record lookup is not a tier branch (`tierBranch.test.ts:22-28`).
`external-set-company/index.ts`: before the Odoo split at `:239`, insert
`if (typeof body.setupAction === 'string' && CONNECT_ACTIONS.has(body.setupAction)) { …active-member check as at :253-259…; return json(await handleConnectAction({ … callerClient: createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } }) … })); }`.
Add `'supabase/functions/external-set-company/connect.ts': 'supabase/functions/external-set-company/connect.test.ts'` to
`REQUIRED` in `scripts/check-edge-fn-test-binding.mjs`.
Verify: `DENO external-set-company connect.test.ts` red → green; `npm --prefix pmo-portal run check:edge-test-binding`.

### ECA2-T13 — sweep pass: advance open runs
In `erpnext-sweep/index.ts`, after the party feed pass, add a pass `advanceConnectRuns(serviceClient, org, budget)` that
loads the org's `staging|proposing` run for tier `erpnext`, builds `ConnectRunDeps` over the RPCs of T6 and calls
`advanceConnectRun` with `budget.calls = 20` per tick. `pmoMasters('employee')` returns active profiles with `code` = the
lower-cased profile email. `writeProposals` maps outcomes to rows with
`identity = outcome|pmoIds.sorted.join(',')|externalIds.sorted.join(',')`, `snapshot = {name, taxId, code, role}` of the ERP
row, `reason_text` from `CONNECT_REVIEW_TEXT[reason]` (`'Two or more records could be this one'`, `'Tax numbers do not match'`).
Deno test `erpnext-sweep/connectRun.test.ts`: org A has a staging run; a tick with 450 fake suppliers advances the cursor
and does not touch org B's run; the next five ticks each write one kind's proposals and the fifth marks the run `ready`;
2,500 outcomes for one kind reach `replace_connect_proposals` as three chunks.
Verify: `DENO erpnext-sweep connectRun.test.ts` red → green.

### ECA2-T14 — feed and onboarding use the shared matcher; review rows persist (AC-ECA-005, AC-ECA-006, FR-ECA-016)
Extend the tagged tests from ECA1-T1 first (red): `AC-ECA-005 … two PMO vendors with the name …` additionally asserts one
`record_connect_review` call with `p_kind='party'`, `p_external_ids=['Supplier:ACME']`, `p_reason='ambiguous'`; `AC-ECA-006 …
ambiguous …` asserts the same for onboarding. Add `'AC-ECA-005 a tax-id match with a different name links the existing company'`.
Then:
- `_shared/companyCandidates.ts`: add a second query `erp_tax_id = <tax>` (same org/type/unarchived/unlinked filters)
  unioned with the name query, so tax-first matching has its candidates; the name compare uses `normaliseName` (through
  `normalizePartyName`, now its alias, ECA2-T3) so the feed and the setup screen agree; drop the "two ERP parties … belongs to
  ECA-2" comment. Test in `erpnextFeedDeps.partyMatch.test.ts`: `'PD-ECA-16 "Acme Ltd" matches "Acme"; "CV Acme" never matches "PT Acme"'`.
- `_shared/erpnextFeedDeps.ts:233-251`: keep `pickCandidate(...)` (it is v2 through `pickPartyCandidate` since ECA2-T3); on
  its `action-required` throw, call `record_connect_review(...)` **and** the shipped `surfaceActionRequired(...)`, then throw
  `party-match-unclear` as today. The review's `p_external_ids` is the doctype-encoded id (`externalIdFor`), never the name.
- `erpnext/onboarding.ts:114-117`: `flagForDecision` additionally calls a new dep `recordReview(entry)`, wired in
  `erpnext-onboard/index.ts` to `record_connect_review`.
Verify: `DENO adapter-dispatch ../_shared/erpnextFeedDeps.partyMatch.test.ts && DENO erpnext-onboard index.test.ts && V src/lib/adapterSeam/erpnext/onboarding.test.ts` → green.

### ECA2-T15 — item map in the line resolver (PD-ECA-5)
Failing test in `erpnext/dispatchFactory.test.ts`: binding `config.item_map = {'Semen 50 kg':'SMN-50'}`, case item named
`Semen 50 kg` → resolved line `item_code: 'SMN-50'`; a name absent from the map → `item_code` = the name.
Change `dispatchProcurement.ts:61-72` (`resolveCaseItems`) to take `itemMap: Record<string,string>` and use
`itemMap[row.name] ?? row.name`; pass `binding.config?.item_map ?? {}` from `resolveProcurementOrderRefs` (`:155`).
Verify: `V src/lib/adapterSeam/erpnext/dispatchFactory.test.ts` → green.

### ECA2-T16 — repository and types
`repositories/contracts/integrations.ts`: add
```ts
export type ConnectKind = 'party' | 'item' | 'project' | 'employee' | 'account';
export type ConnectDomain = 'budget' | 'purchase' | 'invoice' | 'receipt' | 'payment' | 'timesheet';
export interface ConnectCensusRow { kind: ConnectKind | ConnectDomain; pmo_count: number; erp_count: number | null; linked_count: number; inactive_erp_count: number; scenario: 'none' | 'S-A' | 'S-C' | 'S-D' | null; accepted_at: string | null }
export interface ConnectProposal { id: string; kind: ConnectKind; outcome: 'link' | 'bring-in' | 'send' | 'review'; pmo_ids: string[]; external_ids: string[]; reason_text: string | null; snapshot: { name?: string; code?: string }; state: 'open' | 'sending' | 'applied' | 'dismissed' }
export interface ConnectStatus { run: { id: string; state: 'staging' | 'proposing' | 'ready' | 'failed' } | null; census: ConnectCensusRow[] }
```
and on `IntegrationsRepository`: `startConnectCensus(tier)`, `getConnectStatus(tier)`, `listConnectProposals(tier, kind, outcome, afterId)`,
`acceptConnectProposals(tier, kind | null, ids | null)` (null = all), `decideConnectReview(tier, id, choice)`, `unlinkConnectMatch(tier, id)` — each a
one-line `erpSetupRequest(<verb>, {...}, tier)` in `repositories/integrations.ts`. Test in
`repositories/integrations.test.ts`: each method posts the verb and tier.
Verify: `V src/lib/repositories/integrations.test.ts`; `TC`.

### ECA2-T17 — UI: `ConnectProposalReview` (AC-ECA-003), after the owner sketch glance
`components/integrations/ConnectProposalReview.test.tsx` (RTL, repository mocked):
`it('AC-ECA-003 accept all applies 35 rows after one confirm stating the counts and leaves 2 review rows open', …)` —
30 link + 5 bring-in + 2 review proposals for `party`; click "Accept all"; the `ConfirmDialog` text reads "Link 30 records and
bring 5 into PMO? 2 need a decision and are left as they are." (counts from the census and proposal totals, not from the loaded
page); confirm → `acceptConnectProposals('erpnext','party', null)` called once; the two review rows still render with "Needs a
decision". Also `'FR-ECA-012 "Accept everything" accepts every kind in one action after one confirm'` →
`acceptConnectProposals('erpnext', null, null)`; a row left open by the accept shows its plain reason.
`'FR-ECA-042 purchase documents in the ERP are counted and point to the purchase link screen'` — census `purchase` with
`erp_count 7` renders "7 purchase documents are in the ERP. Link them to PMO purchases" linking to the procurement page's
ERP-documents section (`pages/procurement/ErpOrphansSection.tsx`, #1319); a domain row with `erp_count null` reads "Not checked
for this ERP yet", never "0". Also: per-kind census line "12 vendors in PMO, 40 in
the ERP, 9 are the same" (FR-ECA-002); no doctype words (`Supplier`, `Customer`, `Item`) in the rendered text (NFR-ECA-006);
review row "Choose" opens a Combobox of its candidates and calls `decideConnectReview`; staging state shows "Reading records
from the ERP…" and polls `getConnectStatus` every 5 s until `ready`.
Component: one section per kind; outcome filter (`SelectField`); table paged 50 per page; actions gated by `<CanWrite>`
(Admin; Finance for accounts). Strictly `DESIGN.md` tokens; `ConfirmDialog` for the accept; errors via
`classifyMutationError`. Mount in `ErpSetupChecklist.tsx` replacing the "Review company connections" dialog
(`:113-131`, `:346`, `:427-439`): the step becomes "Match records" and opens the component. Strings in
`public/locales/{en,id}/administration.json` under `integrations.connect.*` (en + id together, `check:i18n`).
Verify: `V src/components/integrations/ConnectProposalReview.test.tsx src/components/integrations/IntegrationsView.setup.test.tsx`;
`LINT src/components/integrations/ConnectProposalReview.tsx src/components/integrations/ErpSetupChecklist.tsx`;
`scripts/ux-proof.sh /integrations` (empty, staging, ready with all four outcomes, error, en and id).

### ECA2-T18 — retire the per-party onboarding verb's UI path, tier-branch allowlist
`repositories/integrations.ts:27` `onboardErpParties` stays (operator recovery), no UI caller. If T17 removed a tier
comparison from `IntegrationsView.tsx`, decrement its count in `tierBranch.test.ts` `ALLOWED` (`IntegrationsView.tsx: 14`); if it added one, move the branch
behind the repository instead (the allowlist must not grow).
Verify: `V src/lib/adapterSeam/contractSuite/tierBranch.test.ts`; full ECA-2 gate: `TC`, `LINT` on every file T1–T18 created or edited (`git diff --name-only origin/dev -- pmo-portal | sed 's#^pmo-portal/##'`), the touched files
above, `PGT supabase/tests/erp_connect_setup.test.sql`.

---

## 9. ECA-3 — send PMO masters to the ERP (#1606) — **ships alone**

**Odoo parity row:** Odoo's `sendMaster` already passes `party.send`/`project.send`/`item.send`
(`odoo/workflowDeclarations.ts:24-28`). Odoo S8 wires its sends through **this slice's** `connect/sendViaOutbox.ts` and the
same `erp_connect_proposals` drain; `employee.send` for Odoo stays `pending #1510` (O7).

### ECA3-T1 — bed probe: Employee mandatory fields (PQ-ECA-1)
`supabase/functions/external-set-company/employeeFields.bed.test.ts` (Deno, skipped unless `ERPNEXT_BENCH_URL` is set, same
gating as `discovery.bed.test.ts`): `GET /api/method/frappe.desk.form.load.getdoctype?doctype=Employee` and assert the list of
`reqd = 1` fields. Run: `scripts/with-erpnext-lock.sh bash -c 'cd supabase/functions/external-set-company && deno test employeeFields.bed.test.ts --config deno.json --allow-env --allow-net --allow-read'`.
Record the field list in the PR body. If it includes `gender` / `date_of_birth`, ECA3-T9 declares `employee.send`
`unavailable` (PQ-ECA-1 default).

### ECA3-T2 — ERPNext harness `connect()` for sends (red)
Extend the fake ERPNext from ECA2-T10 with `POST /api/resource/{Supplier,Customer,Project,Item}` (append, name =
`<doctype prefix>-<n>` or the posted `item_code`; honour `failNextWrite('transport' | 'lost-response')` exactly as
`fakeJournalErp` does at `erpnext/contract.harness.ts:66-97`) and `GET …?filters=` exact-match lookups. Flip ERPNext
`party.send`, `project.send`, `item.send` to `supported`.
Verify: `V src/lib/adapterSeam/contractSuite/tiers.contract.test.ts` → red (`send unavailable until ECA-3`).

### ECA3-T3 — ERPNext `sendMaster`, lookup-then-create (green; FR-ECA-020/021)
Replace the stub in `erpnext/connectAdapter.ts`:
```ts
    async sendMaster(kind, record, _key) {
      const one = async (doctype: string, filters: unknown[][]) => {
        const hits = await listDocsByFilters(client, doctype, filters as never, ['name'], 2);
        if (hits.length > 1) throw new AdapterError('commit-rejected', 'ambiguous');
        return (hits[0]?.name as string | undefined) ?? null;
      };
      const create = async (doctype: string, body: Record<string, unknown>) => String(((await createDoc(client, doctype, body)) as { name: string }).name);
      if (kind === 'party') {
        const vendor = record.role !== 'client';
        const doctype = vendor ? 'Supplier' : 'Customer';
        const nameField = vendor ? 'supplier_name' : 'customer_name';
        const found = await one(doctype, [[nameField, '=', record.name], ...(record.taxId ? [['tax_id', '=', record.taxId]] : [])]);
        const name = found ?? await create(doctype, { [nameField]: record.name, tax_id: record.taxId ?? undefined, [vendor ? 'supplier_group' : 'customer_group']: vendor ? 'All Supplier Groups' : 'All Customer Groups' });
        return { externalId: `${doctype}:${name}` };
      }
      if (kind === 'project') {
        const found = await one('Project', [['company', '=', company], ['project_name', '=', record.name]]);
        return { externalId: found ?? await create('Project', { project_name: record.name, company }) };
      }
      if (kind === 'item') {
        const found = await one('Item', [['item_code', '=', record.code ?? record.name]]) ?? await one('Item', [['item_name', '=', record.name]]);
        return { externalId: found ?? await create('Item', { item_code: record.code ?? record.name, item_name: record.name, item_group: 'All Item Groups', stock_uom: 'Nos', is_stock_item: 0, is_purchase_item: 1 }) };
      }
      throw new AdapterError('commit-rejected', `send ${kind} unavailable`);
    },
```
Transport errors already surface as `AdapterError('external-unreachable')` from `client.ts`; the send suite's
`lost-response` case passes because the retry's lookup finds the first document (AC-ECA-011).
Verify: `V src/lib/adapterSeam/contractSuite/tiers.contract.test.ts src/lib/adapterSeam/erpnext/connectAdapter.test.ts` → green.

### ECA3-T4 — `sendViaOutbox` (PD-ECA-8; failing test first)
`connect/sendViaOutbox.test.ts`: with an in-memory `DispatchMoneyOutboxDeps` (the fake used in `dispatch.money.test.ts`),
sending the same record twice under key `seed:party:c-1` claims once and calls `sendMaster` once; a `lost-response` fault then
a retry adopts the first document through the probe (`sendMaster` called once, `probe` once) and finalizes one external ref; a
`commit-rejected` marks the outbox row `failed`; a probe that throws a non-transport error holds the row (`command-held`);
`recordExternalRef` is called for `party` and never for `project` / `item` / `employee`.
`connect/sendViaOutbox.ts`:
```ts
import type { Adapter, AdapterCommand, CommandResult, ExternalRefMapping } from '../contract.ts';
import { dispatchMoneyWrite, type DispatchMoneyWriteDeps } from '../dispatch.ts';
import type { ConnectAdapter, MasterKind, PmoMaster } from './types.ts';
export type SendKind = Exclude<MasterKind, 'contact' | 'account'>;
export const SEND_DOMAIN: Record<SendKind, string> = { party: 'companies', project: 'projects', item: 'items', employee: 'employees' };
export const sendKey = (kind: MasterKind, pmoId: string) => `seed:${kind}:${pmoId}`;
/** An Adapter whose only command is "make sure the ERP holds this master" (lookup-then-create inside sendMaster). */
export function masterSendAdapter(connect: ConnectAdapter, kind: SendKind, record: PmoMaster): Pick<Adapter, 'tier' | 'capabilityMap' | 'commit'> {
  return {
    tier: connect.tier,
    capabilityMap: { [SEND_DOMAIN[kind]]: true } as Adapter['capabilityMap'],
    async commit(_c: AdapterCommand): Promise<CommandResult> {
      const { externalId } = await connect.sendMaster(kind, record, sendKey(kind, record.id));
      return { externalRecordId: externalId, canonical: { id: record.id } };
    },
  };
}
/** PD-ECA-8: one outbox row per master; only companies keep their link in external_refs (one link store per kind). */
export async function sendMasterOnce(
  deps: Omit<DispatchMoneyWriteDeps, 'adapter' | 'command' | 'recordExternalRef' | 'writeReadModel'> & { recordExternalRef: (m: ExternalRefMapping) => Promise<void> },
  connect: ConnectAdapter, kind: SendKind, record: PmoMaster,
): Promise<CommandResult> {
  return dispatchMoneyWrite({
    ...deps,
    adapter: masterSendAdapter(connect, kind, record),
    command: { domain: SEND_DOMAIN[kind], operation: 'create', record: { id: record.id }, idempotencyKey: sendKey(kind, record.id) },
    writeReadModel: async () => {},
    recordExternalRef: kind === 'party' ? deps.recordExternalRef : async () => {},
  });
}
```
(Match the exact `CapabilityMap` shape in `adapterSeam/contract.ts:105-112` when building; the test is the oracle.) The
ERPNext probe lives next to `sendMaster`: `erpnextSendProbe(client, company, kind, record)` in `erpnext/connectAdapter.ts` runs
the same lookup `sendMaster` does and returns `{ externalRecordId }`, `null`, or throws `commit-rejected` on two hits (held).
Callers pass it as `probeByRemarksKey: () => erpnextSendProbe(…)` to `createDbMoneyOutboxDeps` (required there,
`adapter-dispatch/moneyOutboxDeps.ts:139`), with `reissueOnInconclusiveAbsence: kind !== 'party'`: ERPNext rejects a second
Project with the same `project_name` and a second Item with the same `item_code`, so a probe miss proves the create never
landed; a Supplier/Customer name is not unique in ERPNext and can be edited in Desk, so a party miss is held for a person
(the Odoo S8 rule for the same reason).
Verify: `V src/lib/adapterSeam/connect/sendViaOutbox.test.ts` red → green.

### ECA3-T5 — failing pgTAP for send results (AC-ECA-010 DB half, AC-ECA-012 DB half)
New `supabase/tests/erp_connect_sends.test.sql`: proposals in `sending` for party `V1`, project `P1`, item `Semen 50 kg`.
1. `claim_connect_sends(A,'erpnext',10)` (service role) returns the three rows once; a second call within 5 minutes returns none.
2. `record_connect_send_result(A, <party proposal>, 'Supplier:SUP-1', null)` → one `external_refs(companies, V1, Supplier:SUP-1)`,
   proposal `applied`; calling it again → no second ref, still `applied`.
3. project result writes `config.project_map.P1`; item result whose external id equals the line name writes nothing to `item_map`.
4. `record_connect_send_result(A, <item proposal>, null, 'The ERP refused this item: unit missing')` → proposal
   `outcome='review'`, `reason='rejected'`, `reason_text` set, `state='open'`; the other two unaffected (FR-ECA-022).
   `record_connect_send_held(A, <project proposal>)` → `outcome='review'`, `reason='held'`, `reason_text` 'We could not confirm
   whether the ERP created this record', `state='open'` (NFR-ECA-004).
5. No row in any accounts or tax table is written by any of the above (assert `count(*)` of `budget_category_account_map` unchanged).
6. `authenticated` cannot execute either function.
Verify: `PGT supabase/tests/erp_connect_sends.test.sql` → red.

### ECA3-T6 — migration `0452_erp_connect_sends.sql` (green)
- `claim_connect_sends(p_org_id uuid, p_tier text, p_limit int) returns setof erp_connect_proposals` — `update … set
  decided_at = now() where id in (select id from erp_connect_proposals where org_id = p_org_id and external_tier = p_tier and
  state = 'sending' and (decided_at is null or decided_at < now() - interval '5 minutes') order by decided_at nulls first, id
  limit p_limit for update skip locked) returning *` (the 5-minute lease equals the outbox quarantine window, primer
  "Numeric relationships").
- `record_connect_send_result(p_org_id uuid, p_id uuid, p_external_id text, p_rejection text)` — success: the same
  `apply_connect_link` (0451) with the proposal's `decided_by` as actor (party → `external_refs`, already present from the
  outbox finalize → reconciled; project → `project_map`; item → `item_map` only when the code differs from the line name;
  employee → `erp_employees` link), then `state='applied'`; a non-null reason from it → `outcome='review', reason='rejected'`;
  rejection: `outcome='review', reason='rejected', reason_text=p_rejection, state='open'`.
- `record_connect_send_held(p_org_id uuid, p_id uuid)` — `outcome='review', reason='held'`, the fixed plain `reason_text`.
- All three scope by `p_org_id`, refuse a proposal of another org, and are service-only (`revoke all … from public, anon,
  authenticated; grant execute … to service_role`). Rollback drops all three.
Verify: `PGT supabase/tests/erp_connect_sends.test.sql` → green.

### ECA3-T7 — sweep drain (Deno, failing first)
`erpnext-sweep/connectSends.test.ts`: org A has three `sending` proposals; a tick calls `claim_connect_sends`, builds each
`PmoMaster` from the DB row (company/project/line name — never from the proposal snapshot), calls `sendMasterOnce` with
the outbox deps below, and records results; an
`AdapterError('commit-rejected')` records a rejection with copy from `CONNECT_SEND_REJECTION_TEXT` (plain words); an
`external-unreachable` or `command-in-flight-for-record` records nothing (the lease retries next tick); `command-held` calls
`record_connect_send_held`. The outbox deps are `createDbMoneyOutboxDeps({ serviceClient, orgId, externalTier: 'erpnext',
operation: 'create', probeByRemarksKey: () => erpnextSendProbe(client, company, kind, record), reissueOnInconclusiveAbsence:
kind !== 'party' })`. Org B untouched.
Implement `drainConnectSends(serviceClient, org, budget)` in `erpnext-sweep/index.ts` after `advanceConnectRuns`, budget
10 sends per tick. `reconcileOrgOutbox` (`:392`) skips rows whose key starts with `seed:` (the drain owns them; replaying one as
an ordinary `companies` commit would post the wrong body) — test `'a seed: outbox row is never replayed by the reconcile pass'`.
Verify: `DENO erpnext-sweep connectSends.test.ts` red → green.

### ECA3-T8 — shared `sendAll` suite (AC-ECA-010, AC-ECA-012)
New `contractSuite/sendAll.suite.ts` registered under `party.send` alongside `partySendSuite` (the registry maps one suite per
workflow, so export `partySendAllSuite = (h) => { partySendSuite(h); sendAllCases(h); }` and register that):
`'AC-ECA-010 an empty ERP receives exactly the accepted vendors, projects and items, and no account or tax'` — 3 vendors,
2 projects, 4 items sent through `c.adapter.sendMaster`; `c.documents('party')` 3, `('project')` 2, `('item')` 4,
`c.documents('account')` 0, and the fake ERP saw no request to `Account` or any tax doctype. Employees join the case only when
`TIER_WORKFLOWS[h.tier]['employee.send'].status === 'supported'`.
`'AC-ECA-012 one rejected send does not stop the others'` — arm the fake to reject the second item with HTTP 417; three items
land; the rejected one throws `commit-rejected`.
Verify: `V src/lib/adapterSeam/contractSuite/tiers.contract.test.ts` → green for both tiers.

### ECA3-T9 — accountant setup task (FR-ECA-020) and employee declaration
`components/integrations/erpSetupIncompleteness.ts`: add `missingAccountCategories(census, proposals)` returning categories
with no applied `account` link; test `erpSetupIncompleteness.test.ts` `'FR-ECA-020 a category with no direct-cost account is a setup task for the accountant'`.
`ErpSetupChecklist.tsx` renders it as "Ask your accountant to add a direct-cost account for: Labour, Equipment".
ERPNext `employee.send`: per ECA3-T1, either `{ status: 'unavailable', version: 1, reason: 'ERPNext requires birth date and gender for an employee; PMO does not hold them' }`
or `supported` with the Employee branch added to T3 and the suite case enabled. When unavailable, `ConnectProposalReview`
shows employee `send` rows as "Add in the ERP" with no accept action.
Verify: `V src/components/integrations/erpSetupIncompleteness.test.ts src/lib/adapterSeam/contractSuite/parity.test.ts`.

### ECA3-T10 — `ensure-project` sends instead of creating (PD-ECA-7)
Red first in `external-set-company/setup.test.ts`: the `AC-SETUP-001 AC-003 #1325` case (`:646`) now expects no direct
`POST /api/resource/Project` from `ensure-project`; instead an `external_command_outbox` claim with key
`seed:project:<id>` and the same final `project_map` entry; a retry reuses the outbox row (no second POST). Rename the test
`'AC-SETUP-001 project creation goes through the outbox send …'` (the goal oracle — linked to the real ERP project, retry
reuses it — is unchanged; the step changes, per the BDD authoring rule).
`setup.ts:542-546`: replace `matches[0] ?? await createDoc(...)` with `matches[0]?.name ?? (await sendMasterOnce(outboxDeps,
createErpnextConnectAdapter(ctx.client, ctx.company), 'project', { id: project.id, name: project.name, code: project.code })).externalRecordId`,
where `outboxDeps = createDbMoneyOutboxDeps({ serviceClient, orgId, externalTier: 'erpnext', operation: 'create',
probeByRemarksKey: () => erpnextSendProbe(ctx.client, ctx.company, 'project', record), reissueOnInconclusiveAbsence: true,
actorUserId })` (import from `../adapter-dispatch/moneyOutboxDeps.ts`, the precedent `erpnext-sweep/index.ts` already uses).
The caller set stays the shipped one (`index.ts:246`: Admin, Operator, Executive, Project Manager, Finance).
`e2e/serial/AC-SETUP-001-project-erp-link.spec.ts`: its assertions already read `erpProject` back; no step change needed
beyond what the served function does. Run it: `scripts/with-erpnext-lock.sh scripts/e2e-local.sh AC-SETUP-001`.
Verify: `DENO external-set-company setup.test.ts` → green.

### ECA3-T11 — UI states for sends (NFR-ECA-004)
`ConnectProposalReview.test.tsx`: `'NFR-ECA-004 an accepted send shows "Sending to the ERP" until the ERP confirms; a
rejection returns as "Needs a decision" with the reason'`. Rows in `sending` render a status pill, never "Done".
Verify: `V src/components/integrations/ConnectProposalReview.test.tsx`; `scripts/ux-proof.sh /integrations`.

### ECA3-T12 — after setup, new items are sent without a person (FR-ECA-016, FR-ECA-020, PD-ECA-15)
Who breaks without it: a buyer adds a new line "Kabel 10 mm" to a purchase after setup; the order push is refused because the
ERP has no such item — the S-C failure again, one item at a time.
pgTAP (append to `erp_connect_sends.test.sql`): `enqueue_new_item_sends(A, 'erpnext')` (service-only) inserts one `send`
proposal in state `sending` (`decided_by` null, `snapshot {auto:true}`) for each distinct `procurement_items.name` on a case not
`Paid`/`Cancelled` that has no `config.item_map` key and no proposal of kind `item` naming it — **only** when the `item` census
row's `accepted_at` is set; a second call inserts nothing; before the first accept it inserts nothing. Add it to `0452`.
Sweep: `drainConnectSends` calls it once per tick before claiming. The send's lookup (`sendMaster` item branch) also tries
`item_name = <line name>` when `item_code` misses, so an ERP item keyed differently links instead of duplicating (two hits →
rejected → review).
Verify: `PGT supabase/tests/erp_connect_sends.test.sql`; `DENO erpnext-sweep connectSends.test.ts` with a case
`'FR-ECA-016 a new line after setup is sent once and the admin sees nothing'`.

---

## 10. ECA-4 — cut-over for records in flight (#1601) — **ships alone**

> **Fix round (Director rulings 2026-11-02).** (1) The procurement and expenses employ guard (`assert_process_domain_employable`,
> AC-ECA-021, its setup copy and T6's employ mapping) is dropped: drafts on an employed org push normally, because their first
> ERP step happens after employing. The guard stays for revenue (`0275` §7) and comes for inventory with #1508. (2) The
> cut-over instant is the later of activation and employ time; the first document may be a bill or receipt, not only a PO;
> rows the ERP holds are never exempt. (3) `cutover.revenue` and `cutover.timesheet` point at #1676. Where T1/T2/T6 below
> still describe the employ guard, they are superseded.

**Odoo parity row:** `cutover.purchase` — the guard (T4) reads PMO tables and `activated_at` only, so it is tier-agnostic;
Odoo O2 (#1505) declares it *supported* by running `cutoverPurchaseSuite` through its purchase harness. The employ guard is
SQL on `external_domain_ownership` for every tier (O2, O6 inherit it). Inventory joins at #1508 (FR-STK-073) by adding its
draft table to `assert_process_domain_employable`.

### ECA4-T1 — failing pgTAP (AC-ECA-021)
New `supabase/tests/process_domain_cutover.test.sql`: org A, activated binding, one `procurements` row in `Draft`.
1. `AC-ECA-021` `insert into external_domain_ownership (org_id, external_tier, domain) values (A,'erpnext','procurement')`
   → throws with detail `process-drafts-open` and message naming `1`; after `update procurements set status='Cancelled'` the
   insert succeeds.
2. `AC-ECA-021` same for `expenses` with one `expense_claims` row in `Draft`; a `Submitted` or `Approved` claim does not block
   (the shipped DD-EXP-12..22 cut-off already keeps pre-enable claims from posting).
3. `pre_cutover_procurement(<case>)`: a case whose first `purchase_orders.created_at` < `activated_at` → true; created after →
   false; no PO → false; a case of another org called by an org-A user → null (the caller fails closed on null).
4. The revenue guard (`0275`) still fires for revenue (regression).
5. `AC-ECA-020` (DB half) with `procurement` employed, as the store keeper: `create_procurement_receipt` on a **pre-cut-over**
   case succeeds; on a post-cut-over case it still raises `42501` (shipped refusal). Same pair for `create_procurement_invoice`
   and `create_payment`, and for an `update … set status` through `procurement_receipts_native_mirror_guard`,
   `procurement_invoices_native_mirror_guard` and `payments_native_mirror_guard`.
Verify: `PGT supabase/tests/process_domain_cutover.test.sql` → red.

### ECA4-T2 — migration `0481_process_domain_cutover.sql` (green)
```sql
-- ECA-4 (#1601, FR-ECA-030/031): employing procurement or expenses is refused while PMO holds drafts that would be stranded,
-- generalising 0275 §7. Serialises with the org row exactly as assert_revenue_employable does.
create or replace function public.assert_process_domain_employable() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_count int;
begin
  if new.domain not in ('procurement','expenses') then return new; end if;
  perform 1 from public.organizations o where o.id = new.org_id for no key update;
  if new.domain = 'procurement' then
    select count(*) into v_count from public.procurements p where p.org_id = new.org_id and p.status = 'Draft';
  else
    select count(*) into v_count from public.expense_claims c where c.org_id = new.org_id and c.status = 'Draft';
  end if;
  if v_count > 0 then
    raise exception 'submit or cancel the % draft(s) in PMO before the ERP takes this over', v_count
      using errcode = 'P0001', detail = 'process-drafts-open';
  end if;
  return new;
end $$;
revoke all on function public.assert_process_domain_employable() from public, anon, authenticated;
create trigger external_domain_ownership_process_employable
  before insert or update of domain, org_id on public.external_domain_ownership
  for each row execute function public.assert_process_domain_employable();

-- PD-ECA-9: a purchase started before the connection = its first PO row predates activated_at. Definer so the answer does not
-- depend on what the caller's RLS shows (an invisible binding must not read as "not pre-cut-over"); a case outside the
-- caller's org answers null, and every caller treats null as a refusal (fail closed).
create or replace function public.pre_cutover_procurement(p_procurement_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select case when p.id is null or (auth.uid() is not null and p.org_id is distinct from public.auth_org_id()) then null
              else coalesce((select min(po.created_at) from public.purchase_orders po where po.procurement_id = p.id)
                            < (select b.activated_at from public.external_org_bindings b
                                where b.org_id = p.org_id and b.status = 'active' and b.activated_at is not null
                                order by b.activated_at limit 1), false) end
    from (select 1) one left join public.procurements p on p.id = p_procurement_id
$$;
revoke all on function public.pre_cutover_procurement(uuid) from public, anon;
grant execute on function public.pre_cutover_procurement(uuid) to authenticated, service_role;
```
Then re-create **verbatim from their latest migration** `create_procurement_receipt` (`0180_rpc_active_member_gate.sql`),
`create_procurement_invoice` and `create_payment` (`0373_procurement_queue_gate_and_currency.sql`), and the three guards
`procurement_receipts_native_mirror_guard` (`0099`), `procurement_invoices_native_mirror_guard` (`0273`),
`payments_native_mirror_guard` (`0189`), each with one change: the `domain_externally_owned(<org>, 'procurement')` refusal
becomes `domain_externally_owned(<org>, 'procurement') and not coalesce(public.pre_cutover_procurement(<case id>), false)`
(OQ-ECA-1: such a purchase finishes in PMO). Grants unchanged (the 0275 §9-style check: assert in the test that
`authenticated` still executes the three RPCs and `anon` does not). Rollback restores the six bodies from those migrations and
drops the trigger and both new functions.
Verify: `PGT supabase/tests/process_domain_cutover.test.sql` → green.

### ECA4-T3 — failing shared suite `cutover.purchase` (AC-ECA-020)
Add to `ErpHarness`: `pushPurchaseStep?(step: 'goods-receipt' | 'purchase-invoice' | 'payment', orderedBeforeConnect: boolean): Promise<PushBeforeConnectionResult>`.
New `contractSuite/cutoverPurchase.suite.ts`:
```ts
export function cutoverPurchaseSuite(h: ErpHarness): void {
  const step = h.pushPurchaseStep ?? (() => { throw new Error(`${h.tier} declares cutover.purchase supported but has no pushPurchaseStep()`); });
  describe(`cutover.purchase (${h.tier})`, () => {
    it.each(['goods-receipt', 'purchase-invoice', 'payment'] as const)('AC-ECA-020 %s of a purchase ordered before the connection creates no ERP document', async (s) => {
      expect(await step(s, true)).toMatchObject({ outcome: 'refused', code: 'pre-cutover', erpCalls: 0 });
    });
    it('a purchase ordered after the connection still pushes its receipt', async () => {
      expect(await step('goods-receipt', false)).toMatchObject({ outcome: 'pushed' });
    });
  });
}
```
Register `'cutover.purchase': cutoverPurchaseSuite`; flip ERPNext `cutover.purchase` to `supported`.
Verify: `V src/lib/adapterSeam/contractSuite/tiers.contract.test.ts` → red.

### ECA4-T4 — the guard, before adapter selection (green)
New `pmo-portal/src/lib/adapterSeam/cutoverGate.ts` (tier-agnostic, Deno-importable):
```ts
import { AppError } from '../appError.ts';
const LATER_STEPS = new Set(['goods-receipt', 'purchase-invoice', 'payment']);
/** FR-ECA-030 / OQ-ECA-1: a purchase whose first ERP-bound step happened before the connection pushes no later step. Fail closed. */
export async function assertNotPreCutover(client: { rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }> },
  command: { domain: string; record: { erp_doc_kind?: unknown; procurementId?: unknown } }): Promise<void> {
  if (command.domain !== 'procurement' || !LATER_STEPS.has(String(command.record.erp_doc_kind))) return;
  if (typeof command.record.procurementId !== 'string') throw new AppError('purchase reference missing', 'commit-rejected');
  const { data, error } = await client.rpc('pre_cutover_procurement', { p_procurement_id: command.record.procurementId });
  if (error || typeof data !== 'boolean') throw new AppError('could not check the connection date', 'commit-rejected');
  if (data === true) throw new AppError('recorded before the ERP connection, not sent', 'pre-cutover');
}
```
Call it in `supabase/functions/adapter-dispatch/index.ts` right after the authorization gate (`:843-853`) with
`callerClient`, mapping `pre-cutover` to HTTP 409 `{error:'pre-cutover'}`; and in the sweep's outbox replay for
procurement rows (`erpnext-sweep/index.ts` `reconcileOrgOutbox`, `:392`; the replay authorisation at `:3535`) before it rebuilds a
command, so the backstop never re-drives it. The ERPNext harness `pushPurchaseStep` builds a fake
caller client whose `rpc('pre_cutover_procurement')` answers `orderedBeforeConnect` and runs `assertNotPreCutover` then
`resolveErpDispatchAdapter`, counting calls like `pushPurchase` (`erpnext/contract.harness.ts:181-194`).
Deno test `adapter-dispatch/cutoverGuard.served.test.ts` imports the shipped handler, mocks fetch, and asserts a 409 with no
outbox insert and no ERP request for a pre-cutover receipt.
Verify: `V src/lib/adapterSeam/contractSuite/tiers.contract.test.ts src/lib/adapterSeam/cutoverGate.test.ts && DENO adapter-dispatch cutoverGuard.served.test.ts`.

### ECA4-T4b — pre-cut-over purchases take the PMO path (OQ-ECA-1 "finish in PMO only")
Who breaks without it: a store keeper receives goods on a purchase ordered before the connection; dispatch refuses (T4) and
the native RPC refuses (`domain_externally_owned`), so the receipt cannot be recorded anywhere.
Failing unit test in `src/lib/repositories/procurement.external.test.ts` (the shipped routing suite): `'AC-ECA-020 a receipt, bill or payment on a pre-cut-over
purchase is recorded through PMO, never dispatched'` — with `routeDomainWrite('procurement') === 'external'` and the case's
`preCutover: true`, `createReceipt` / `createInvoice` / `createPayment` call the DAL and never `dispatchCreate`; with
`preCutover: false` they dispatch as today.
`db/procurement*` detail read adds `pre_cutover` from `rpc('pre_cutover_procurement', { p_procurement_id })` (one call per
case detail); `repositories/procurement.ts:66-95` routes on `routeDomainWrite(...) === 'external' && !preCutover`. The
contract (`repositories/contracts/procurement.ts`) gains `preCutover?: boolean` on the three create inputs; pages pass the
detail's flag through. Sibling suites that mock `procurementRepository` (`grep -rl "procurementRepository" pmo-portal/pages pmo-portal/src --include=*.test.tsx`) are run.
Verify: `V src/lib/repositories/procurement.external.test.ts` plus every file the grep above lists;
`PGT supabase/tests/process_domain_cutover.test.sql`.

### ECA4-T5 — label (FR-ECA-030 "wherever its push state would show")
`pushErrorCopy.ts`: map code `pre-cutover` → `t('integrations.push.preCutover', 'Recorded before the ERP connection, not sent')`
(also the steady label on a pre-cut-over purchase's receipts, bills and payments, from the detail's `pre_cutover` flag),
severity `info` (not a failure). `pendingPush.ts`: a `pre-cutover` result is terminal — no retry button. Tests
`pushErrorCopy.test.ts` `'FR-ECA-030 pre-cutover reads as information, never an error, and offers no retry'`.
en/id strings in `administration.json`.
Verify: `V src/lib/adapterSeam/pushErrorCopy.test.ts src/lib/adapterSeam/pendingPush.test.ts`; `scripts/ux-proof.sh` on the
procurement record route touched.

### ECA4-T6 — employ refusal copy and declarations
`external-set-company/setup.ts` `employErpDomain` (`:142-189`): map the RPC error detail `process-drafts-open` to
`AppError(<message with count>, 'config-rejected')` (the trigger's message already names the count and the action). Deno test
in `setup.test.ts`: `'AC-ECA-021 employing procurement with an open draft is refused naming the count'`.
Declarations: ERPNext `cutover.revenue` re-points from `1601` to `1609` with a comment "SQL guard, tier-agnostic, proven by
pgTAP (`0275` §7 + this slice's test); a Deno-side shared suite is #1609's documented exception".
Verify: `DENO external-set-company setup.test.ts && V src/lib/adapterSeam/contractSuite/parity.test.ts`.

---

## 11. ECA-5 — pair PMO and ERP invoices (#1602) — **ships alone**

**Odoo parity row:** pairing and count-once are SQL over `sales_invoices` (PD-ECA-10) and apply to any tier whose inbound
revenue mapping fills `customer_id`, `reference_number` (the client's PO / bill reference) or `si_number`, `amount`,
`tax_treatment` and `invoice_date` (columns of `0123_sales_incoming_payments_flip.sql:17-34` + `0188`). ERPNext declares `invoice.pair-existing` *supported* after T5; Odoo O3 (#1506) runs `invoicePairSuite`
through its revenue mapping.

### ECA5-T1 — failing pgTAP (AC-ECA-030 count-once)
New `supabase/tests/invoice_pairs.test.sql`. Org A, client C, project P with a contract work order; a native PMO invoice
`N1` (Unpaid, `amount` 11,100,000, `reference_number` `PO-7`, March); ERP owns revenue; a brought-in ERP invoice `E1` (not
native, Unpaid, `erp_docstatus` 1, same `customer_id`, `reference_number = 'PO-7'`, 11,100,000, same `tax_treatment`, March,
`project_id` and `work_order_id` null); an unpaired native `N2`; a native `N3` with one native receipt and a matching ERP
invoice `E3`.
1. `propose_invoice_pairs()` as Finance returns exactly `(N1, E1)`; changing `E1`'s amount by 1 → no pair; a second ERP
   candidate with the same keys → `N1` is listed with `ambiguous = true` and not proposed.
2. Before accept: `get_project_finances(P)` billed = N1 + E1 + N2 (the double count the slice fixes).
3. `AC-ECA-030` `accept_invoice_pairs('[{"pmo":"N1","erp":"E1"}]')` → billed = E1 + N2, receivable counts E1 once;
   `N1.paired_erp_invoice_id = E1`; `E1.project_id = P` and its work order copied from N1.
4. `AC-ECA-030` `N2` still counts and appears in `list_unpaired_native_invoices()`; `N3` is never proposed (it has a PMO
   receipt) and is listed with reason `has-receipt`; `accept_invoice_pairs` for `(N3, E3)` → refused.
5. Same once-only figure in `get_management_pack`, `get_executive_dashboard`, `get_pm_dashboard_projects`,
   `get_projects_money_collection`, `get_project_billing`, and in the views `sales_invoice_work_billed` and
   `work_order_billing_lines` (select the paired row: absent).
6. Engineer → `42501`; another org's Finance cannot pair A's rows; accepting a pair twice → no-op; pairing `N1` to a second
   ERP invoice → refused (`unique` on `paired_erp_invoice_id` and `N1` already paired).
Verify: `PGT supabase/tests/invoice_pairs.test.sql` → red.

### ECA5-T2 — migration part 1: column, proposal, accept (green for 1, 3, 4, 6)
```sql
alter table public.sales_invoices add column paired_erp_invoice_id uuid references public.sales_invoices(id),
  add column paired_at timestamptz, add column paired_by uuid references public.profiles(id);
create unique index sales_invoices_one_pair on public.sales_invoices (paired_erp_invoice_id) where paired_erp_invoice_id is not null;
```
`propose_invoice_pairs() returns table (pmo_invoice_id uuid, erp_invoice_id uuid, ambiguous boolean)` — SECURITY INVOKER,
Admin/Finance: native rows (`pmo_native`, status `Unpaid`, `paired_erp_invoice_id is null`, **no** `incoming_payments` row
with `sales_invoice_id` = the native id — PD-ECA-11, so no receipt is counted twice) joined to non-native
rows (`erp_docstatus = 1`, `erp_cancelled_at is null`, not already a pair target) on same `customer_id`, and
(`reference_number` equal and not null, or `si_number` equal and not null), equal `amount`, equal `tax_treatment`,
`date_trunc('month', invoice_date)` equal (FR-ECA-040); `ambiguous` when either side has more than one candidate (those are listed, never proposed for accept).
`accept_invoice_pairs(p_pairs jsonb) returns int` — SECURITY DEFINER, Admin/Finance + active member re-asserted in the body;
locks both rows `for update`; re-checks every predicate above (never trusts the pair list); sets `paired_*` on the native row
inside `set_config('pmo.invoice_pairing','on',true)`; copies `project_id`/`work_order_id` to the ERP row when null via the
shipped `assign_sales_invoice_project`; one `log_audit('revenue.invoice_pair', …, {count})`.
`sales_invoices_native_mirror_guard` (latest `0410_billing_kinds.sql`): re-create verbatim plus
`if current_setting('pmo.invoice_pairing', true) = 'on' then return new; end if;` scoped to a change of only the three
`paired_*` columns (compare `old` and `new` with those columns blanked; any other change still falls through to the guard).
`list_unpaired_native_invoices()` — native, not paired, created before revenue was employed, with `reason` (`no-match`,
`ambiguous`, `has-receipt`).
Add `accept_invoice_pairs` to `0178_anon_executable_definers.test.sql`'s `client_callable_rpc_names` and raise both counts by 1;
`revoke all … from public, anon; grant execute … to authenticated`. Mutation check: drop the receipt predicate from the
accept's re-check → assertion 4's refusal goes red; restore.
Rollback: drop the functions, restore the guard from 0410, drop the index and columns.

### ECA5-T3 — migration part 2: count-once in every reader (green for 2, 5)
Find every reader at head first (the draft's list missed both views and the client and agent readers):
```bash
python3 - <<'EOF'   # last definition of each function/view that names sales_invoices, plus its migration
import re,glob,os
last={}
for f in sorted(glob.glob('supabase/migrations/[0-9]*.sql')):
    s=open(f).read()
    for m in re.finditer(r'create\s+(?:or\s+replace\s+)?(function|view)\s+(?:public\.)?([a-z0-9_]+)(.*?)(?=\ncreate\s+(?:or\s+replace\s+)?(?:function|view|table|trigger|policy|index|unique)|\Z)',s,re.S|re.I):
        last[m.group(2)]=(os.path.basename(f),'sales_invoices' in m.group(3))
print('\n'.join(f'{n} {f}' for n,(f,r) in sorted(last.items()) if r))
EOF
grep -rlE "sales_invoices|sales_invoice_work_billed|work_order_billing_lines" pmo-portal/src pmo-portal/pages supabase/functions | grep -v '\.test\.'
```
Of what it prints, the ones that **sum or list billed / receivable amounts** take the filter; writers, guards and triggers do not.
At `b52aa48a` that is:
- Views (re-created verbatim from `0262_billing_by_work_order.sql` with `and si.paired_erp_invoice_id is null`):
  `sales_invoice_work_billed` (every management-pack, dashboard and finance reader that goes through it inherits the filter)
  and `work_order_billing_lines`.
- Functions reading the table directly (re-created verbatim from their latest migration with the filter on each
  `sales_invoices` predicate that sums or lists): `get_project_finances` (`0410_billing_kinds.sql`), `get_management_pack`
  (`0323`), `get_executive_dashboard` and `get_pm_dashboard_projects` (`0396`), `get_project_billing` (`0337`), plus
  `get_projects_money_collection` (`0396`), `get_project_drawdown`, `work_order_billing` (`0337`) and `get_unbilled_work_orders`
  (`0262`) where their bodies touch the table.
- Client and agent readers (unit-tested in ECA5-T4): the revenue-by-project aggregate in `src/lib/db/revenue.ts` (the open-AR
  loop over `sales_invoices`, `:431-445`) and `listSalesInvoices` (`:170-190`, `.is('paired_erp_invoice_id', null)` unless the
  caller asks for paired rows); the agent's overdue tool `supabase/functions/agent-chat/overdue.ts:107` (an unpaid paired PMO
  copy would be reported overdue next to its ERP twin).
Any other reader the sweep prints that sums amounts joins this task and is named in the PR. Rollback re-creates each from its
prior migration.
Verify: `PGT supabase/tests/invoice_pairs.test.sql` → green; the readers' own pgTAP files under the same lock
(`ls supabase/tests | grep -E "project_finances|management_pack|work_order_billing|executive_dashboard|pm_dashboard"`);
`DENO agent-chat overdue.test.ts` with a paired-copy case.

### ECA5-T4 — repository, figure rule and review screen (AC-ECA-030 unit part)
`src/lib/repositories/revenue.ts` over `src/lib/db/revenue.ts`: `proposeInvoicePairs()`, `acceptInvoicePairs(pairs)`,
`listUnpairedNativeInvoices()` via `supabase.rpc`. The invoice list maps `paired_erp_invoice_id` to a "Counted as ERP invoice
<number>" chip; the revenue-by-project aggregate skips paired rows; unit test in `src/lib/db/revenue.test.ts`
`'AC-ECA-030 a paired PMO invoice is excluded from the client-side billed and open totals and shows its ERP invoice'`.
`components/integrations/InvoicePairReview.tsx` (+RTL test): pairs table with "Accept all" behind a `ConfirmDialog` ("Count
14 invoices once, as the ERP copy?"), ambiguous rows listed separately with "Needs a decision", unpaired native invoices
listed with their amount; Admin/Finance only (`<CanWrite>`). Linked from the setup checklist when the census shows invoices on
both sides (FR-ECA-042 pattern) and from the revenue page.
Verify: `V src/lib/db/revenue.test.ts src/components/integrations/InvoicePairReview.test.tsx`;
`LINT src/lib/db/revenue.ts src/lib/repositories/revenue.ts src/components/integrations/InvoicePairReview.tsx`;
`scripts/ux-proof.sh /integrations` and `scripts/ux-proof.sh /finance/receivables`.

### ECA5-T5 — `invoice.pair-existing` suite
Harness: `mapInboundInvoice?(doc: { client: string; number: string; poRef: string | null; total: string; tax: 'ppn' | 'none'; date: string }): Promise<Record<string, unknown>>` —
ERPNext builds a Sales Invoice wire doc and runs the shipped inbound mapper (`erpnext/bodies/salesInvoice.ts` `fromDoc`).
`contractSuite/invoicePair.suite.ts`: the mapped row carries a non-null customer reference (resolved to `customer_id` by
the feed), `reference_number` or `si_number`, `amount` as a 2-decimal string, `tax_treatment` and `invoice_date` — the keys
`propose_invoice_pairs` joins on. Register; ERPNext `invoice.pair-existing` → `supported`.
Verify: `V src/lib/adapterSeam/contractSuite/tiers.contract.test.ts src/lib/adapterSeam/contractSuite/parity.test.ts`.

---

## 12. ECA-6 — existing ERP budget (#1603) — **ships alone**

**Odoo parity row:** new workflow `budget.resolve-occupant` (PD-ECA-13); Odoo declares
`{ status: 'pending', version: 1, issue: 1507 }` in the same task, and O4 decides (Odoo Community has no budget object,
DD-ODC-5 → likely *unavailable* with that reason, as for `budget.unowned-occupant`).

### ECA6-T1 — registry
`connect/workflows.ts`: `'budget.resolve-occupant': { version: 1, summary: 'use an ERP budget PMO did not create as a PMO draft, or replace it after an explicit confirm' }`.
`erpnext/workflowDeclarations.ts`: `'budget.resolve-occupant': { status: 'pending', version: 1, issue: 1603 }` (flips in T6);
`odoo/workflowDeclarations.ts`: `{ status: 'pending', version: 1, issue: ODOO_ACTUALS_AND_BUDGET }`.
Verify: `TC` (red without both declarations — that is AC-ECA-040 doing its job), then green.

### ECA6-T2 — failing Deno test (AC-ECA-031)
`supabase/functions/adapter-dispatch/budgetOccupant.served.test.ts`, shipped handler, fetch mocked with an ERP holding
`DESK-BUDGET` (docstatus 1, account `5100 - Labour`, FY 2026, 50,000,000) that PMO does not own (`bfyServedFixture.ts` as base):
1. `'AC-ECA-031 use as draft: a PMO Draft version holds the ERP figures and the ERP is unchanged'` — command
   `{domain:'budget', operation:'read', record:{erp_doc_kind:'budget-occupant', action:'use-as-draft', projectId, fiscalYear:'2026', erpAccount:'5100 - Labour'}}`
   as Finance → one `create_budget_draft_from_erp` RPC with lines `[{category:'Labor', budgeted_amount:'50000000.00', fiscal_year:'2026'}]`;
   the fake ERP saw zero POST/PUT.
2. `'AC-ECA-031 replace: refused without a consent row naming the ERP budget'` — a normal push → `budget-unowned-live-occupant`
   (shipped), zero writes.
3. `'AC-ECA-031 replace: with a consent row naming DESK-BUDGET the push amends it through the push path and consumes the consent'`
   → cancel + amend calls, `external_refs` written for the new document, consent `consumed_at` set, one audit row.
4. A consent naming `OTHER-BUDGET` does not unlock `DESK-BUDGET`; a consent from org B does not unlock org A.
4b. Use as draft with an ERP account that has no category mapping → 422 naming the account, no RPC call.
5. Engineer → 403 for both actions.
Verify: `DENO adapter-dispatch budgetOccupant.served.test.ts` → red.

### ECA6-T3 — migration `0455_budget_occupant_resolution.sql`
```sql
create table public.budget_occupant_consents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  fiscal_year text not null, erp_account text not null, erp_budget_name text not null,
  consented_by uuid not null references public.profiles(id), consented_at timestamptz not null default now(),
  consumed_at timestamptz,
  unique (org_id, project_id, fiscal_year, erp_account, erp_budget_name)
);
alter table public.budget_occupant_consents enable row level security; alter table public.budget_occupant_consents force row level security;
create policy budget_occupant_consents_select on public.budget_occupant_consents for select
  using (org_id = public.auth_org_id() and public.is_active_member() and public.auth_role() in ('Admin','Finance'));
revoke all on public.budget_occupant_consents from anon, authenticated; grant select on public.budget_occupant_consents to authenticated;
grant select, insert, update, delete on public.budget_occupant_consents to service_role;
```
`consent_budget_occupant_replace(p_project_id uuid, p_fiscal_year text, p_erp_account text, p_erp_budget_name text) returns uuid`
— SECURITY DEFINER; actor = `auth.uid()`; re-asserts org of the project = actor's org, active member, role Admin/Finance; the
project has an `Active` budget version (nothing to push otherwise); upsert resets `consumed_at` to null; audit
`budget.occupant_replace_consent`; `revoke all … from public, anon; grant execute … to authenticated`, and add it to
`0178_anon_executable_definers.test.sql`'s allow-list (+1 on both counts). `consume_budget_occupant_consent(p_org_id, p_id)`
service-only, idempotent (a consumed row stays consumed).
`create_budget_draft_from_erp(p_project_id uuid, p_erp_budget_name text, p_lines jsonb) returns uuid` — SECURITY INVOKER (RLS
and the 0176/0178 authorship triggers apply to the caller): inserts a `Draft` `budget_versions` row at `max(version)+1` named
`'From ERP ' || p_erp_budget_name` with `import_batch_id = gen_random_uuid()`, `imported_at = now()`, then one
`budget_line_items` per line with `import_key = 'erp-budget:' || p_erp_budget_name || ':' || category` (the provenance shape
of `db/budgets.ts:242-270,328-360`; `actual_amount` never written). Lines go through the shipped
`import_budget_line_v2(version, category, 'From ERP budget ' || name, amount, fiscal_year, batch, imported_at,
'erp-budget:<name>:<category>', 'erp-budget:<name>:<category>', false)` (`0397_budget_import_protocol.sql:36`), so the Draft-only
and role checks stay the import protocol's, not a second copy.
pgTAP `supabase/tests/budget_occupant_resolution.test.sql`: Engineer refused; Finance consent ok and audited; draft created with
two lines and `Draft` status; another org's project refused.
Verify: `PGT supabase/tests/budget_occupant_resolution.test.sql`.

### ECA6-T4 — dispatch: the two actions (green for T2)
`pmo-portal/src/lib/adapterSeam/erpnext/dispatchBudget.ts:333-341`: before throwing `budget-unowned-live-occupant`, read
`budget_occupant_consents` with `deps.serviceClient` `.eq('org_id', deps.orgId).eq('project_id', <project>).eq('fiscal_year', fiscalYear)
.eq('erp_account', selectedAccount).eq('erp_budget_name', live[0]).is('consumed_at', null).maybeSingle()`; a read error →
throw (fail closed); a row → `refs.self = live[0]` and `refs.occupantConsentId = <id>`, **skipping** the `owner` /
`parseBudgetIdentity` / `budget_version_account_erp_mirror` witness checks below (they prove PMO authored the document, which a
consent replaces; without the skip the v16 path throws on `parseBudgetIdentity(null)`); no row → throw as today. After
`dispatchMoneyWrite` returns success, `adapter-dispatch/index.ts` calls `consume_budget_occupant_consent` when the resolved refs
carry `occupantConsentId`; a lost response is adopted by the outbox probe and consumes on that reply (consumption is idempotent).
New `supabase/functions/adapter-dispatch/budgetOccupant.ts`: for `erp_doc_kind === 'budget-occupant'` and
`action === 'use-as-draft'`, under the shipped authorization gate (Admin/Finance), read the ERP Budget via the adapter's read
path (`GET Budget/<name>`, the grain lookup of `dispatchBudget.ts:213` for the name), map each account row to its category with
`budget_category_account_map` (org-scoped) — an ERP account with no category refuses the action naming the accounts ("Map
these ERP accounts to a budget category first: …"), never a draft that silently totals less than the ERP budget — and call
`create_budget_draft_from_erp` with `callerClient`; reply
`{draftVersionId}`. No outbox row (read-only toward the ERP). Wire it in `index.ts` before the idempotency-key check (it is a
read). The authorization gate (`checkErpnextCommandAuthorization`, called at `adapter-dispatch/index.ts:842`) must know the
new `erp_doc_kind` `budget-occupant` (Admin, Finance), or every call is refused before this code runs; T2 case 5 covers it.
Add both files to `REQUIRED` in `scripts/check-edge-fn-test-binding.mjs`.
Verify: `DENO adapter-dispatch budgetOccupant.served.test.ts bfyUnownedLiveOccupant.test.ts` → green (the shipped refusal test
stays green: no consent → same refusal).

### ECA6-T5 — UI
`components/budget/BudgetOccupantActions.tsx` (+RTL test), rendered where `pushErrorCopy` shows
`budget-unowned-live-occupant`: two buttons for Admin/Finance — "Use the ERP figures as a draft" and "Replace the ERP budget
with this version". Replace opens `ConfirmDialog` whose text names the ERP budget ("Replace ERP budget DESK-BUDGET for Labour,
2026, with PMO's active version? The ERP copy will be amended."), then calls `consent_budget_occupant_replace` and re-runs the
push through the shipped retry path. Tests: `'AC-ECA-031 replace needs a confirm naming the ERP budget'`,
`'use as draft opens the new draft version'`, Engineer sees neither button.
Verify: `V src/components/budget/BudgetOccupantActions.test.tsx src/lib/adapterSeam/pushErrorCopy.budgetV16.test.ts`;
`scripts/ux-proof.sh` on the project budget route.

### ECA6-T6 — shared suite extension and declaration
`contractSuite/budget.suite.ts`: export `budgetResolveSuite` asserting via `h.pushBudget({ occupant: 'one-live', consent: 'matching' | 'other' | 'none' })`
(extend `BudgetPushScenario` with optional `consent`) → `matching` pushes with writes > 0, `other`/`none` refused with
`erpWrites: 0`. ERPNext harness `serviceClient` answers `budget_occupant_consents` from the scenario. Register
`'budget.resolve-occupant': budgetResolveSuite`; ERPNext → `supported`.
Verify: `V src/lib/adapterSeam/contractSuite/tiers.contract.test.ts src/lib/adapterSeam/contractSuite/parity.test.ts`.

---

## 13. ECA-8 — scenario acceptance on the ERPNext bed (#1607)

**Odoo parity row:** Odoo S9 of #1504 adds the same two journeys against the Odoo bed (`scripts/odoo-dev-bed.sh`), reusing
these specs' fixtures with `tier: 'odoo'`.

### ECA8-T1 — S-C journey (AC-ECA-050)
`pmo-portal/e2e/serial/AC-ECA-050-connect-empty-erp.spec.ts`, header `// @e2e-isolation: serial — connects the org's ERP binding; uses a disposable empty ERPNext company.`
Gating exactly as `AC-SETUP-001-project-erp-link.spec.ts:1-15` (bench env present or the lane throws; no `process.env.CI`).
Journey as Admin: seed PMO history (3 vendors, 2 projects, a procurement case whose PO was created **before** activation,
4 distinct line items) → open Integrations → "Match records" → census shows "3 vendors in PMO, 0 in the ERP" → Accept all →
wait for sends to show done (poll the screen, 90 s cap) → approve one **new** purchase on a sent vendor/project with a sent
item. Oracles: the ERP holds a Purchase Order for that purchase naming the sent supplier, project and item (read through the
bench API); the pre-connect case's receipt shows "Recorded before the ERP connection, not sent" and no ERP Purchase Receipt
exists for it; no Account was created on the bench (count before = after).
Allowlist entry in `scripts/check-e2e-skips.mjs` next to `AC-SETUP-001`'s (`:108-116`) with the same `restore` text.

### ECA8-T2 — S-D journey (AC-ECA-051)
`pmo-portal/e2e/serial/AC-ECA-051-connect-erp-with-data.spec.ts`: bench company pre-loaded with 2 of the 3 vendors (one by
tax id under a different name), 1 of the 2 projects (same code), and a Sales Invoice equal to one PMO native invoice.
The paired PMO invoice has no PMO receipt (PD-ECA-11). Journey: connect → Match records → Accept all (parties, projects) →
Invoices on both sides → Accept all. Oracles: each
overlapping vendor/project has exactly one PMO row and one ERP document (bench count by name/tax id); `get_project_finances`
billed for the project equals the ERP figure; no duplicate Supplier/Project on the bench.
Verify (both): `scripts/with-erpnext-lock.sh scripts/e2e-local.sh AC-ECA-05` → green; `node scripts/check-e2e-skips.mjs --self-test`.

---

## 14. Traceability (AC → owning test)

| AC | Owning layer | Owning test | Task |
|---|---|---|---|
| AC-ECA-001 | Shared suite (U, per tier) | `contractSuite/census.suite.ts` "AC-ECA-001 …" (+ `connect/census.test.ts` for `scenarioOf`) | ECA2-T4, T10 |
| AC-ECA-002 | Unit | `connect/match.test.ts` "AC-ECA-002 …" | ECA2-T2/T3 |
| AC-ECA-003 | Unit (RTL) | `components/integrations/ConnectProposalReview.test.tsx` "AC-ECA-003 …" | ECA2-T17 |
| AC-ECA-004 | pgTAP | `supabase/tests/erp_connect_setup.test.sql` "AC-ECA-004 …" | ECA2-T5/T6 |
| AC-ECA-005 | Deno (`_shared` feed, shipped handler) | `_shared/erpnextFeedDeps.partyMatch.test.ts` "AC-ECA-005 …" | ECA1-T1, ECA2-T14 |
| AC-ECA-006 | Deno (`erpnext-onboard`) | `erpnext-onboard/index.test.ts` "AC-ECA-006 …" | ECA1-T1, ECA2-T14 |
| AC-ECA-007 | pgTAP | `supabase/tests/erp_connect_setup.test.sql` "AC-ECA-007 …" | ECA2-T5/T6 |
| AC-ECA-010 | Shared suite | `contractSuite/sendAll.suite.ts` "AC-ECA-010 …" (DB half `erp_connect_sends.test.sql`) | ECA3-T8, T5 |
| AC-ECA-011 | Shared suite | `contractSuite/send.suite.ts:43` "AC-ECA-011 …" (shipped; ERPNext joins in ECA3-T3) | ECA3-T3 |
| AC-ECA-012 | Shared suite | `contractSuite/sendAll.suite.ts` "AC-ECA-012 …" (DB half `erp_connect_sends.test.sql` case 4) | ECA3-T8, T5 |
| AC-ECA-020 | Shared suite | `contractSuite/cutoverPurchase.suite.ts` "AC-ECA-020 …" (DB half `process_domain_cutover.test.sql` case 5; PMO path `repositories/procurement.external.test.ts`) | ECA4-T2..T4b |
| AC-ECA-021 | pgTAP | `supabase/tests/process_domain_cutover.test.sql` "AC-ECA-021 …" | ECA4-T1/T2 |
| AC-ECA-022 | Existing | `AC-XING-001`, `AC-XING-003` (not re-tested) | — |
| AC-ECA-030 | pgTAP (count-once) + Unit (figure rule) | `supabase/tests/invoice_pairs.test.sql` "AC-ECA-030 …"; revenue repository test "AC-ECA-030 …" | ECA5-T1..T4 |
| AC-ECA-031 | Deno (`adapter-dispatch`) | `adapter-dispatch/budgetOccupant.served.test.ts` "AC-ECA-031 …" | ECA6-T2/T4 |
| AC-ECA-040 | Unit (typecheck) | `contractSuite/parity.test.ts:107` (shipped) | ECA7-T1 |
| AC-ECA-041 | Unit | `contractSuite/parity.test.ts:65` (shipped) | ECA7-T1 |
| AC-ECA-042 | Shared suite | `contractSuite/tiers.contract.test.ts` + `parity.test.ts:14-64` (shipped; grows per slice) | ECA7-T1 + every slice |
| AC-ECA-043 | Unit | `contractSuite/tierBranch.test.ts:78` (shipped) | ECA7-T1, ECA2-T18 |
| AC-ECA-050 | Served e2e (ERPNext bed) | `e2e/serial/AC-ECA-050-connect-empty-erp.spec.ts` | ECA8-T1 |
| *(no spec AC)* FR-ECA-001 money domains | Unit | `connect/census.test.ts` (11 rows; null for an uncountable domain) | ECA2-T4 |
| *(no spec AC)* FR-ECA-012 all kinds · FR-ECA-042 | Unit (RTL) | `ConnectProposalReview.test.tsx` "FR-ECA-012 …", "FR-ECA-042 …" | ECA2-T17 |
| *(no spec AC)* FR-ECA-016 | pgTAP + Deno | `erp_connect_sends.test.sql` (`enqueue_new_item_sends`), `connectSends.test.ts` "FR-ECA-016 …" | ECA3-T12 |
| AC-ECA-051 | Served e2e (ERPNext bed) | `e2e/serial/AC-ECA-051-connect-erp-with-data.spec.ts` | ECA8-T2 |

## 15. Registry after this plan (ERPNext / Odoo)

| Workflow | ERPNext after | Odoo after (owner of the flip) |
|---|---|---|
| `census` | supported (ECA2-T10) | supported when its harness implements `load`/`calls` (O1) |
| `party.match` | supported v2 (ECA2-T3) | supported v2 (re-declared in ECA2-T3; passes through `pickPartyCandidate`, no Odoo code change) |
| `party.bring-in` | supported (ECA1-T3) | O1 S6 |
| `party.send` · `project.send` · `item.send` | supported (ECA3) | supported (shipped) |
| `project.match` | supported (shipped) | O1 S7 |
| `item.match` · `account.match` | supported (ECA2-T10) | O1 |
| `employee.match` | supported (ECA2-T10) | O7 (#1510) |
| `employee.send` | per PQ-ECA-1 (ECA3-T9) | O7 |
| `cutover.purchase` | supported (ECA4) | O2 (#1505) |
| `cutover.revenue` | pending #1609 (SQL guard, ECA4-T6) | O3 |
| `invoice.pair-existing` | supported (ECA5-T5) | O3 (#1506) |
| `budget.resolve-occupant` | supported (ECA6-T6) | O4 decides (#1507) |
| the 10 shipped workflows | pending #1609 | per Odoo route items |
