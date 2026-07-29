# Spec — server refusals the user was meant to read must actually reach them

**Status:** drafted 2026-07-29 (Director), pending owner sign-off
**Relates to:** ADR-0019, ADR-0070, `AC-ERR-002` (the raw-Postgres-text fix), `docs/specs/create-path-sod-class.spec.md`

---

## 1. Problem

The SoD work wrote refusal messages designed to tell a user what to do next:

> *"you set this deal's contract value, so you cannot also win it: the value must be confirmed by
> someone else — ask an Admin, an Executive or another Project Manager to re-set it…"*

> *"budget_versions "Revised Budget" is Active and only an Admin may delete a budget version that is
> not a Draft: deleting it CASCADES to its line items past budget_line_items_draft_guard, and to the
> ERPNext budget-push mirror — **archive it instead**"*

**None of them reaches a user.** `pmo-portal/src/lib/classifyMutationError.ts` maps **every** `42501`
to one fixed string — *"You don't have permission to do that. / Your role does not allow this change.
Ask an administrator."* The server's text is discarded.

So a Project Manager blocked by the money SoD is told to *ask an administrator*, when the actual
remedy is *ask your supervisor or someone senior to re-confirm the number* — and the app has no
surface showing who that is. A user told to do the wrong thing will conclude the software is broken,
which is worse than a blunt refusal.

### 1.1 This is not a bug in `classifyMutationError` — it is a missing distinction

`AC-ERR-002` exists for a good reason: Postgres's own `42501` text is
`permission denied for table procurement_invoices`, and `new row violates row-level security policy
for table "companies"`. Leaking internal table names and RLS mechanics to end users was a real defect
and was correctly fixed by replacing the detail wholesale.

The gap is that **`42501` now carries two different kinds of message**:

| provenance | example | must the user see it? |
|---|---|---|
| **Postgres-generated** | `permission denied for table procurement_invoices` | **No** — leaks schema, means nothing to a user |
| **Hand-authored** (`raise exception … using errcode='42501'`) | *"…ask an Admin, an Executive or another Project Manager to re-set it"* | **Yes** — it is the whole point of the message |

The classifier cannot tell them apart, so it does the safe thing to both. **The errcode is not the
right discriminator; provenance is.**

### 1.2 A comment already claims this works

`pmo-portal/src/lib/db/budgets.ts:399` states the delete guard *"raises 42501 naming the cascade, so
the `classifyMutationError` toast surfaces it — it is not a silent no-op."* It does not surface it.
⚑ That docstring was added in the very commit whose purpose was **fixing an inaccurate comment about
a guard that did not exist**. Correcting it is in scope here.

---

## 2. Requirements (EARS)

- **FR-UFR-001** — *Ubiquitous.* The system shall distinguish a **hand-authored, user-facing** refusal
  from a **database-generated** one, by a mechanism the database sets deliberately and Postgres never
  sets incidentally.
- **FR-UFR-002** — *Event-driven.* When a refusal is hand-authored, the system shall present its text
  to the user verbatim.
- **FR-UFR-003** — *Ubiquitous.* When a refusal is database-generated, the system shall continue to
  present mapped copy and shall **never** render the raw detail (`AC-ERR-002` preserved unchanged).
- **FR-UFR-004** — *Ubiquitous.* A hand-authored refusal shall not leak another org's data, a table
  name, or a column name that is not already user-meaningful.
- **NFR-UFR-001** — The copy shall live in **one** place. A message duplicated in the DB and in a
  front-end override map will drift, and the drifted copy will be the one the user sees.

---

## 3. Options

**A — a dedicated SQLSTATE for user-facing refusals** *(recommended)*
Raise hand-authored refusals with a reserved custom SQLSTATE instead of `42501`. The classifier shows
the message verbatim for that code and keeps today's behaviour for everything else.
*For:* unambiguous, one discriminator, impossible for Postgres to set by accident, copy stays in one
place. *Against:* every pgTAP assertion currently asserting `'42501'` on a hand-authored raise must be
updated — **a large, mechanical, and visible change** (~40+ assertions across `0162`, `0166`–`0171`).
That churn is a real cost but it is one-time and the compiler-equivalent (a red test) catches misses.

**B — carry the user-facing text in `HINT`**
`raise … using errcode='42501', hint='…'`; the classifier renders `HINT` when present.
*For:* no errcode churn. *Against:* Postgres sets `HINT` on its own errors too (`"Grant the required
privileges to the current role with: GRANT INSERT ON …"`), so the discriminator is polluted by exactly
the class we must not show. Would need a sentinel prefix inside the hint, which is option C wearing a
hat.

**C — per-call-site `overrides` map in the front end**
The reviewer's suggestion. *For:* smallest diff. *Against:* violates NFR-UFR-001 — the copy exists
twice, and the DB message is the one under test while the FE copy is the one displayed. When the rule
changes, one of them will be updated. This is how `budgets.ts:399` came to describe behaviour that
does not exist.

**Recommendation: A.** The churn is the honest price of a real discriminator, and it is the only
option where the message the pgTAP asserts is provably the message the user sees.

---

## 4. Acceptance criteria (Given/When/Then)

- **AC-UFR-001** *(unit)* — Given a hand-authored refusal, when it is classified, then the user-facing
  detail is the server's text **verbatim**.
- **AC-UFR-002** *(unit)* — Given a Postgres-generated `42501` (`permission denied for table X`), then
  the detail is the mapped copy and the raw text appears **nowhere** in the result. *(`AC-ERR-002`
  preserved — this is the regression control for the original leak.)*
- **AC-UFR-003** *(unit)* — Given a hand-authored refusal containing a table name or another org's
  data, then it is **not** rendered. *(FR-UFR-004: the new channel must not become a leak.)*
- **AC-UFR-004** *(e2e)* — Given a PM who set a deal's value, when they attempt to win it, then the
  on-screen message names the **actual** remedy (their supervisor or someone senior), not *"ask an
  administrator"*.
- **AC-UFR-005** *(pgTAP + unit, paired)* — For each hand-authored refusal, the message asserted by
  pgTAP and the message rendered by the front end are **the same string**. *(NFR-UFR-001 — this is the
  AC that makes option C fail and A pass.)*
- **AC-UFR-006** *(unit)* — `budgets.ts`'s docstring claim matches observed behaviour. *(Assert the
  behaviour, not the comment text — a source-text assertion is what let `AC-PMS-021` pass by matching
  a SQL comment.)*

**Mutation requirement (binding).** For every AC, state the change that makes it fail and run it,
including a message-only mutation. Assert message text, never errcode alone.

---

## 5. Out of scope

- Building a UI that shows a PM **who** their supervisor is. Real, and the natural follow-up once the
  message is truthful — but a design task, not an error-handling one.
- Re-coding the 15 remaining `is_active_member()` refusals (a sibling slice) — they inherit whatever
  mechanism this spec lands.
