# Spec: Billing board, all claims by step and age (#2681)

**Status:** spec (phase 1), awaiting Director approval. Ships for the 15 December 2026 release (OD-SCOPE-1). Map #2516, size S. IDs `FR-BBD-###`, `NFR-BBD-###`, `AC-BBD-###`, `OD-BBD-#`. Plan: `docs/plans/2026-11-21-billing-board.md`. Stacked on #2680 (`claim-billing-steps.spec.md`, migrations 1365-1369) and #2592 (`billing-stage-targets.spec.md`). Terms Billing stage, Stage target, Skipped stage, Overdue stage as defined there; **step** = a claim's billing stage row, as in #2680.

## Owner ruling applied (OD-SCOPE-6, settled)
One billing record, no task copies. The board is a view: cards are claims, columns are steps. No board table, no board setting, no stored position: a card sits where the claim's own step rows put it. OD-SCOPE-2: no step name, role or day count is written in code; the columns come from whatever step names the organisation's claims carry.

## Job story
When I chase billing across work orders, I want one view of every claim by step and age, so I do not have to ask who is holding what.

## Context and boundary (checked on the #2680 tip)
- A step is a `claim_billing_stages` row (`position`, `name`, `owner_role`, `started_on`, `completed_on`, `skipped_on`, `target_days`, `target_on`). The current step is the first row, by position, with neither `completed_on` nor `skipped_on` (`currentStageIndex`, `billingStages.ts`). Age is `stageAgeDays` (calendar days since `started_on` to the organisation's today). Overdue is the due-date seam: due = `target_on`, else `started_on + target_days` (`billing_stage_due_on`, 1368); overdue = today past due (`stageDaysPastTargetDate`).
- `claim_billing_stages` and `progress_claims` are readable only by active Admin, Executive, Project Manager and Finance of the organisation (select policy + restrictive role scope, 1021). Project visibility beyond that follows the existing RLS on `projects`/`progress_claims`; the board adds no visibility of its own.
- `billing_stage_due_on` is not executable by `authenticated` (1368 revokes it), so a security-invoker read recomputes the same two-branch rule inline; a pgTAP parity test pins the two together.
- Existing screens are untouched except one gated entry link (FR-BBD-050).

## Terms (new)
- **Billing board**: a read-only screen at `/finance/billing-board` listing open claims as cards grouped into columns by current step. Not stored.
- **Board column**: a step name, or the final column **All steps done**.
- **Open claim**: a non-withdrawn progress claim that has at least one step row and has no invoice raised yet.

## Decisions (stated plainly; Director may override)
- **OD-BBD-1 Columns by step NAME.** Each claim's step list can differ, so the board cannot use a fixed list. Columns are the distinct current-step names across the board's claims (case-insensitive, trimmed match; first-seen spelling shown), **ordered by typical position**: the median `position` of that name over the board's claims, ties by name. Then one final column, **All steps done**, holding open claims whose steps are all completed or skipped (ready to invoice). A step name used by only a few claims still gets its own column; no "other" bucket. No column is shown empty (columns exist only for names with at least one card). Recommended and taken.
- **OD-BBD-2 Card age = current-step age, not claim age.** Age in days since the current step started (`stageAgeDays`), shown as "N days on this step". The all-done column shows days since the last step completed (age of waiting to invoice). Cards sort oldest first inside a column.
- **OD-BBD-3 Overdue is the due-date seam, a chip only.** A card shows an overdue chip ("N days past target") when the current step is past its due date; no new rule, no alert.
- **OD-BBD-4 No money on the card.** Card = project, work order number (when the claim has one), claim date, current step name, step progress "3 of 7", owner role (when set), age, overdue chip. Amounts stay on the claim, which avoids a second money-visibility rule on a new screen.
- **OD-BBD-5 Read-only.** No drag, no move, no complete button. Moving a claim = completing its step on the claim; the card links to it (`/projects/:projectId?tab=billing&open=<claimId>&openType=billingClaim`, the existing claim deep link).
- **OD-BBD-6 Entry link, no rail item.** One link "Billing board" on the Receivables page header (`/finance/receivables`), rendered only when the board has at least one open claim with steps, so an organisation with no billing steps sees nothing new. No Rail registry change (no feature flag, no parity-test change). The route itself is reachable by URL for the four roles; an organisation with no step rows sees the empty state.
- **OD-BBD-7 Bounded read.** One security-invoker SQL function, 500 claims maximum, ordered oldest current step first, with an explicit `truncated` flag the screen shows ("Showing the 500 oldest; filter by project to see the rest"). Never an unbounded list.

## Requirements (EARS)
- **FR-BBD-001** The system shall provide `billing_board(p_project uuid default null)` returning one row per open claim: claim id, project id and name, work order id and number, claim created date, kind, step count, steps done (completed or skipped), current step id/position/name/owner role/started on/target days/target date/due on, and an all-done flag; limited to 501 rows (the caller treats the 501st as "truncated").
- **FR-BBD-002** The function shall be `security invoker`, so RLS on `claim_billing_stages`, `progress_claims` and `projects` decides which claims a caller sees; it shall add no role check of its own beyond what RLS enforces and shall return nothing for an Engineer.
- **FR-BBD-003** Withdrawn claims, claims with no step rows, down-payment claims without steps, and claims that already have an invoice shall not appear.
- **FR-BBD-004** When `p_project` is given, the function shall return only that project's claims.
- **FR-BBD-010** The client shall group rows into columns per OD-BBD-1 and compute age and overdue with `stageAgeDays` and `stageDaysPastTargetDate` using the server's organisation today (no device clock), in one pure module `billingBoard.ts`.
- **FR-BBD-011** Cards in a column shall sort by age, oldest first; ties by project name.
- **FR-BBD-020** The screen shall show columns left to right on desktop with horizontal scroll, and as a vertical list of column sections on phone (390 px), each section headed by the step name and card count.
- **FR-BBD-021** The screen shall offer a project filter (a Combobox of the viewer's projects with open claims) and keep it in the URL (`?project=`).
- **FR-BBD-022** Each card shall be a link to the claim (OD-BBD-5) and be keyboard focusable.
- **FR-BBD-023** The screen shall show an explicit empty state (no claims have billing steps), a loading state, an error state that says the read failed (never a zero), and the truncated notice (OD-BBD-7).
- **FR-BBD-030** The screen shall be read-only: no write call to the database is reachable from it.
- **FR-BBD-040** All strings shall exist in English and Bahasa Indonesia; counts and ages use plural forms.
- **FR-BBD-050** The Receivables page shall show the entry link only when the board read returns at least one row; existing tests of that page stay untouched.

## Non-functional requirements
- **NFR-BBD-001** The read is one query using the existing indexes (`claim_billing_stages_org_idx`); no per-claim round trip. Plan: `EXPLAIN` evidence not required (gate change); the function uses a single `lateral` first-open-step lookup per claim.
- **NFR-BBD-002** The repository call passes the `check-unpaged-reads` guard by being an RPC with an explicit bound in SQL (the guard scans `.from().select()` chains only); if the guard flags it, add it with a reason, never loosen the guard.
- **NFR-BBD-003** No new table, no client write grant, no definer function; therefore no isolation-fragment entry is needed beyond confirming the denominator check stays clean.
- **NFR-BBD-004** Screen follows `docs/ux/screen-rules.md`, DESIGN.md tokens, shared primitives; touch targets 44 px on phone; contrast and focus by existing tokens.

## Acceptance criteria and owning layer
| AC | Given / When / Then | Layer |
|---|---|---|
| AC-BBD-001 | Given two projects with claims at different current steps, when a Finance user calls `billing_board()`, then each claim appears once with its first open step and counts | pgTAP |
| AC-BBD-002 | Given a step is skipped or completed, when the board is read, then the current step is the next open one; given all are done, then the all-done flag is true | pgTAP |
| AC-BBD-003 | Given a withdrawn claim, a claim without steps, and an invoiced claim, then none appear | pgTAP |
| AC-BBD-004 | Given an Engineer, when the function is called, then no rows; given a user of another organisation, then none of this organisation's claims | pgTAP |
| AC-BBD-005 | Given `p_project`, then only that project's claims | pgTAP |
| AC-BBD-006 | Given more than 500 open claims, then exactly 501 rows return, oldest current step first | pgTAP |
| AC-BBD-007 | The inline due-date rule equals `billing_stage_due_on` for a step with a date, with days only, and with neither | pgTAP |
| AC-BBD-008 | Given claims with differing step lists, when grouped, then columns are distinct step names ordered by median position, the final column is All steps done, and no empty column shows | unit |
| AC-BBD-009 | Given cards in a column, then oldest first; age is days on the current step; all-done age is days since the last completion | unit |
| AC-BBD-010 | Given a current step past its due date, then the card shows the overdue chip with the day count; not past, none | unit |
| AC-BBD-011 | Given the board renders, then no card shows an amount, and each card links to the claim deep link | unit (RTL) |
| AC-BBD-012 | Given the read fails, then an error state shows, not an empty board; given zero rows, the empty state; given truncation, the notice | unit (RTL) |
| AC-BBD-013 | Given the project filter, then the URL carries `?project=` and only that project's cards show | unit (RTL) |
| AC-BBD-014 | Given Bahasa Indonesia, then column header counts, age and overdue text are translated | unit (RTL) |
| AC-BBD-015 | Given Receivables with no open claim with steps, then no entry link; with one, the link opens the board | unit (RTL) |
| AC-BBD-016 | Given a Finance user with a seeded claim, when they open the board from Receivables and click the card, then the claim opens on its project | e2e (one journey, written, not run) |

## Errors
| Case | Behaviour |
|---|---|
| Read fails (network, RLS) | Error state with retry; never an empty board |
| Role without access (Engineer) | The function returns nothing; the screen shows the empty state with the plain words "No claims to show" |
| Unknown `?project=` | Filter ignored with the project chip cleared |

## Build notes for phase 2 (not yet built)
- Migrations **1370** `billing_board_read` (the function, `security invoker`, `set search_path = public`, `revoke all ... from public, anon; grant execute ... to authenticated`) and its rollback `rollback/1370_billing_board_read_down.sql`. **1371 is reserved and unused** unless the invoice lookup needs a supporting index.
- Invoiced test: use the same lookup `billing_stages_open` / the 1021 triggers use (an invoice row for the claim); the builder confirms the join by reading 1021 and 0250 first.
- pgTAP `supabase/tests/1370_billing_board.test.sql`; fixtures as `1360_billing_stage_targets.test.sql`.
- Pure `pmo-portal/src/lib/billingBoard.ts`; data `src/lib/db/billingBoard.ts` + repository + hook; page `pmo-portal/pages/BillingBoard.tsx`; route in `App.tsx`; strings in the finance/project namespace en and id; glossary entries (Billing board, Board column).
