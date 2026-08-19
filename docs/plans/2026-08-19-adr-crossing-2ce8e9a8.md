# Plan — Issue #480: ADR-0055 standalone → connected crossing addendum

- **Date:** 2026-08-19 · **Issue:** [#480](https://github.com/ariefsaid/PMO/issues/480), decided by `DD-XING-1..6`.
- **Worktree:** `.claude/worktrees/480-adr-crossing` only · **Branch:** `docs/480-adr-0055-crossing` · **Do not push or open a PR.**
- **Type:** docs-only ADR clarification. Modify no code, migrations, tests, configuration, or lockfiles. Do not run `npm run verify`.
- **Authoritative decision order:** `docs/decisions.md` `DD-XING-1..6`, then the issue/brief; the surveyed sources agree. ADR-0059 is cited for the mechanism, not restated.

## Goal

Make ADR-0055 §5 independently answer what happens when ERPNext arrives after an organization is already live on standalone PMO: process records remain PMO-SoT under Posture B, pre-epoch ERP history is visible only as a Posture-A read-model, and catch-up uses the existing deterministic Posture-B push. Explicitly correct the two pre-ADR-0059 Consequences bullets so no reader mistakes a Posture-A ownership flip for a universally reversible crossing.

## Design

### Placement and scope

Touch only `docs/adr/0055-external-system-adapters-sot-enhancement.md`.

1. Extend the existing §5 ownership-map table with a fourth **“Live standalone → ERPNext crossing”** column. Do not create a separate ADR, migration, runbook, or implementation checklist.
2. Immediately after that table, before the existing **Money principle** paragraph, add `### 5A. Addendum — live standalone → connected crossing` in ADR-0055’s numbered-heading style. Keep the addendum compact; cite ADR-0059 §1, §3 invariant 7, §4, and §5 instead of re-explaining its architecture.
3. In `## Consequences`, retain both original claims as visibly corrected text—not a silent deletion—and replace their operative guidance with the qualified rules below.

### Ownership-map crossing values

The new column must state the outcome at a live crossing in the row where a reader looks up the domain:

| Existing §5 row/domain | New crossing-column value |
|---|---|
| Accounting / GL | **n/a** — PMO never held the ledger; nothing is demoted or backfilled. |
| Procurement chain, including its process payment/invoice outcomes | **Posture B** — PMO ran the process; retain PMO SoT and side-mirror the outcome. |
| Companies / Contacts | **Posture A + adopt** — reference/master-data exception; use the ordinary party-adopt route. |
| Sales money documents, including Sales Invoices | **Posture B** — PMO ran the process; retain PMO SoT and side-mirror. |
| Timesheets | **Posture B** — PMO entry/approval remains SoT; side-mirror the approved result. |
| Budgets | **Posture B** — PMO version/approval process remains SoT; side-mirror the approved result. |
| PMO-only rows (projects, tasks/milestones where ClickUp is absent, CRM, incidents, documents, platform) | **PMO remains owner / no ERP crossing**; do not imply an ERP ownership flip. |

Where existing table grouping makes a payment or sales-invoice reference ambiguous, make the row wording explicitly cover it rather than classifying it with Accounting/GL. The addendum headline must say that a live-crossing client’s **process domains do not flip**, so no live PMO row becomes a read-model.

### §5A content rules

Write three short labeled paragraphs (or a compact sub-list) carrying these exact decisions:

1. **Epoch rule (`DD-XING-2`).** An organization has two record classes per relevant domain, split by nullable `organizations.pmo_epoch_at` (the organization’s PMO go-live date; described here only, not added). Before the epoch, external history is a Posture-A, read-only PMO read-model: visible but never adopted or editable as a PMO process record. From the epoch onward, records are PMO-SoT under Posture B and are side-mirrored. Cite ADR-0059 §5 to make clear this reconciles—not weakens—its never-adopt rule.
2. **Catch-up (`DD-XING-3`).** At connection, run the ordinary Posture-B push over PMO records lacking their side-mirror row. It is not a bespoke backfill implementation. Cite ADR-0059 §4: keys are derived, not minted, so reruns derive the same key and cannot duplicate an external write.
3. **Mandatory precondition.** State before the catch-up instruction—not as a trailing caveat—that every Posture-B kind’s state stamp must first be audited to change whenever pushable content changes, with mutation proof. Mention the `OQ-BUD-2` instance recorded in `0137_budget_push_seam.sql` only at the decision level: a weak stamp inverts the idempotency guarantee, silently suppressing a needed write rather than preventing a duplicate. Do not add operational/security-detail beyond the established public ADR/decision wording.

### Consequences correction

Convert the two legacy bullets into explicit corrections, preserving their old text (for example with `~~…~~` after a **Corrected by §5A / ADR-0059** lead-in) and immediately state the replacement guidance:

- Qualify the existing “per-domain, reversible flip” statement: Posture A read-model/RLS flips remain externally owned and reversal leaves PMO with stale ex-read-model rows; it is not an unqualified reversible crossing. Posture B is the reversible posture because `drop table <side_mirror>` loses zero PMO data (ADR-0059 §3 invariant 7).
- Qualify the existing “backfill/promote runbook” statement: for a client crossing while live, process domains take Posture B; their catch-up is the ordinary missing-side-mirror push after the state-stamp precondition, never a push-then-flip/promote route. Keep party-master adoption and pre-epoch read-only history distinct from that process-domain catch-up.

## Implementation tasks

### Task 1 — Amend ADR-0055 §5 with the crossing lookup and epoch/catch-up addendum

**File:** `docs/adr/0055-external-system-adapters-sot-enhancement.md`

1. Edit the §5 table in place to add the crossing column and populate every row using the values in the design table above; retain the existing Owner and Notes content unless needed to remove the Accounting/GL versus payment/sales-invoice ambiguity.
2. Add `### 5A. Addendum — live standalone → connected crossing` after the table and before **Money principle**.
3. Write the Posture-B/no-demotion headline, the nullable `organizations.pmo_epoch_at` epoch split, the Posture-B missing-side-mirror catch-up rule, and the state-stamp audit precondition exactly as scoped above. Cite ADR-0059 §1, §3 invariant 7, §4, and §5; do not reproduce ADR-0059’s mechanism at length or claim the column exists today.

**Acceptance coverage:** Issue #480 done criterion 1 (the §5 map answers the mid-life ERP-arrival question without opening ADR-0059); `DD-XING-1`, `DD-XING-2`, `DD-XING-3`, `DD-XING-6`.

**TDD note:** Not applicable: this is a decision-document amendment with no executable behavior or test layer. Its evidence is the deterministic documentation inspection in Task 3; do not create or alter tests for this docs-only issue.

### Task 2 — Mark the pre-ADR-0059 Consequences claims corrected and install qualified guidance

**File:** `docs/adr/0055-external-system-adapters-sot-enhancement.md`

1. Find the two existing Consequences bullets containing “a per-domain, reversible flip” and “backfill/promote runbook.”
2. Preserve each original claim as visibly superseded/corrected text, then add the Posture-A versus Posture-B reversibility distinction and the Posture-B ordinary-push replacement route described above.
3. Include the `drop table <side_mirror>` / zero-PMO-data-loss property and the Posture-A stale-ex-read-model result; point the corrected catch-up route to the state-stamp-preconditioned missing-side-mirror push.

**Acceptance coverage:** Issue #480 done criterion 2 (the correction is explicit); `DD-XING-1`, `DD-XING-3`, `DD-XING-6`.

**TDD note:** Not applicable: documentation-only change; use Task 3’s textual verification rather than adding an artificial executable test.

### Task 3 — Inspect documentation-only diff and prove the mandated wording is present

**Files:** `docs/adr/0055-external-system-adapters-sot-enhancement.md` only

1. Confirm the working-tree change list contains no path outside `docs/`:
   ```bash
   git diff --name-only
   ```
2. Inspect the final targeted section and correction in context:
   ```bash
   git diff --check -- docs/adr/0055-external-system-adapters-sot-enhancement.md
   git diff -- docs/adr/0055-external-system-adapters-sot-enhancement.md
   ```
3. Confirm the required decision anchors are discoverable in ADR-0055:
   ```bash
   grep -nE 'Live standalone|Posture B|Posture A|pmo_epoch_at|never adopted|side-mirror|state stamp|OQ-BUD-2|derived, not minted|Corrected|stale ex-read-model|drop table' docs/adr/0055-external-system-adapters-sot-enhancement.md
   ```
4. Verify the recorded decisions remain the source language and have not been contradicted:
   ```bash
   grep -nE 'DD-XING-[1236]|pmo_epoch_at|weak stamp|Posture-B property' docs/decisions.md
   ```

**Acceptance coverage:** Issue #480 both done criteria; `DD-XING-1..3`, `DD-XING-6`.

## Traceability

No `docs/specs/*` artifact or `AC-###` identifiers were supplied for this docs-only decision amendment. Do not invent acceptance IDs. The issue’s two explicit Done-when criteria are covered by Tasks 1–3 and the governing decision anchors are `DD-XING-1`, `DD-XING-2`, `DD-XING-3`, and `DD-XING-6`.

| Source acceptance / decision | Owning task | Verification |
|---|---|---|
| #480: §5 answers a live ERP-arrival question without a second ADR/migration | Task 1 | Task 3 table/addendum inspection |
| #480: reversibility correction is explicit | Task 2 | Task 3 Consequences diff inspection |
| `DD-XING-1` / `DD-XING-6` | Tasks 1–2 | crossing column plus visibly corrected bullets |
| `DD-XING-2` | Task 1 | epoch paragraph and `pmo_epoch_at` anchor |
| `DD-XING-3` | Task 1 | preconditioned ordinary-push paragraph |

## Final verification

Docs-only—do **not** run `npm run verify`. The final gate is:

```bash
git diff --check -- docs/adr/0055-external-system-adapters-sot-enhancement.md \
  && test "$(git diff --name-only | grep -v '^docs/' | wc -l | tr -d ' ')" = "0"
```
