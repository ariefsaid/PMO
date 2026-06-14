# r2 audit — claim-by-claim verification verdict

**Status:** VERIFIED (2026-06-14). The owner asked to *"investigate all of the claims in the audit."*
Six parallel verifiers (one per lens A/B/C/D + the reconciliation table + a money-semantics bug hunt)
checked **every** claim in `review/wholeapp-r2/` against the **current `main` code** (`a800324`), with
`file:line` or rendered evidence for each verdict. Per-claim detail: `review/wholeapp-r2/verify/*.md`
(gitignored scratch).

> **Calibration:** the audit ran on `b05a899` (a mid-intent-fix-wave SHA, not an ancestor of `main`
> because the PR squash-merged). `main` (`630dbc7`/`a800324`) carries the full intent-fix wave + coherence
> wave. So each claim was re-checked against what `main` actually ships — several were already fixed.

## Meta-verdict

**The audit's central thesis is VALIDATED but ~40% of its specific claims are overstated, wrong-mechanism,
already-fixed, or reviewer artifacts.** Two things are simultaneously true:

1. **The coherence + intent-fix waves patched *instances*, not *patterns*.** Two patterns were never
   enforced app-wide, and every lens independently rediscovered them:
   - **The advance/decide verb has no shared home** (corroborated by *all four lenses* + the recon table).
   - **One entity wears several nouns, and status/stage still rides action-blue** (Lens A + D + recon).
2. **It also surfaced one genuine, prod-affecting bug unrelated to coherence** — the money/`spent` calc.

But the audit also mis-fired often enough that acting on it verbatim would waste effort: ListPage,
the breadcrumb mechanism, the Finance-approver role, and several "different app" majors were wrong.

## CONFIRMED — real and open on `main` (the actionable set, prioritized)

| # | Issue | Severity | Evidence | Corroboration |
|---|---|---|---|---|
| 1 | **Money calc bug — "Actual $0".** `projects.spent` is a stored column no trigger populates (`0001_init_schema.sql:79` "DEFERRED: stored vs derived"); seed hard-codes 0. The "Actual" tile reads it while Committed/Spend/Budget-used compute live from procurements. Cascade Foods has a **$3.7M Paid PO** → realized spend is non-zero; the tile reads the wrong field. Same column poisons the Finance "spend $2.1M" KPI. | **HIGH (prod-affecting)** | `ProjectDetailHeader.tsx:143`, `OverviewTab.tsx:85`, `Projects.tsx:301` read stored `spent`; `getProjectCommittedSpend` `procurements.ts:27-45` is the live basis | money agent (REAL BUG); Lens B O-09, Lens D D-03/D-05 (label level) |
| 2 | **No shared advance/decide action paradigm.** The central PMO verb is hand-placed per record: incident=header, procurement=sticky bottom zone, pre-win project=right-rail card, My-Tasks=native `<select>`. No `RecordActionZone` component exists (only a DESIGN.md-name comment + a test name). | **HIGH (the #1 systemic tell)** | recon claim 1 (no component); Lens B O-01; Lens D D-07; Lens A two-color steppers | **all 4 lenses + recon — unanimous** |
| 3 | **One entity, multiple nouns + "deal" still leaks.** `/projects/:id` is named "Opportunity journey" / "Sales Pipeline" / "Pipeline" pre-win; "Deal" survives in toasts ("Deal created/updated"), an aria-label, body copy. | High | recon claim 4 (CONFIRMED, "deal gone" sub-claim FALSE); Lens D D-06 | recon + Lens D |
| 4 | **Action-blue leaks onto status/stage/quantity.** Funnel "Negotiation" dot (`salesPipeline.ts:65`), procurement inline pips (`LifecycleStepper.tsx:25`), hours bars (`HoursBar.tsx:62`); inline-pip stepper paints "done" **blue** while the bar stepper paints "done" **green** (`LifecycleStepper.tsx:25-43`). | Medium-High | Lens A o-A-01/02/10 | Lens A (both substrates) |
| 5 | **Procurement-list preview-asymmetry.** `/approvals` got inline preview (IF-A); the `/procurement` *module list* still forces a full-page drill-in. | Medium | recon claim 8; Lens B O-04; Lens D D-04/D-01 | recon + B + D |
| 6 | **My Tasks rows are inert.** Task name is a non-clickable `<span>` (no `/tasks/:id` route); status is a native OS `<select>` while records use buttons/steppers. The IC's primary screen is a dead-end list. (IF-E added urgency+log-time but not open-task.) | Medium | Lens B O-03/O-06; Lens D opus D-04 | B + D (opus); gpt's "no prioritization" claim FALSE |
| 7 | **Finance approvals-nav discoverability gap.** `/approvals` is deliberately excluded from `MODULES` (`routeMatch.ts:139`) → it's in **nobody's ⌘K** (`App.tsx:235`); Finance's rail omits it (`Rail.tsx:44`). Finance (a *procurement* approver) reaches it only via a dashboard tile. | Medium | Lens C C-02/C-04 | Lens C (both substrates AGREE) |
| 8 | **PM-timesheets wrong scent.** `/timesheets` defaults to the engineer entry grid; the PM's batch-review job is demoted to a small "Approvals" link. | Low-Medium | Lens D gpt D-06 | Lens D |
| 9 | **Status as bare grey text** in CompanyDetail "Related projects" (`CompanyDetail.tsx:311,328`) — no dot+pill, violates the Tinted-Status rule. *(A miss in the IF-D RelatedList.)* | Low | Lens A o-A-04 | Lens A |

**Doc drift (cheap):** `DESIGN.md` §5 says row-`⋯` is hover-hidden (shipped is always-visible, AC-backed) and
§5 "current→primary" tension with the Freed-Blue rule — reconcile so the design oracle isn't self-contradicting.

## OVERSTATED / FALSE / BY-DESIGN — do **not** act on these

- **ListPage "doesn't enforce slots → 6 toolbar grammars" — FALSE.** The shell enforces a fixed named-slot
  contract; all 6 lists conform. (My two verifiers split: recon read the *structure* — enforced; Lens C read
  the *content* — Contacts has a filter, Companies has Import, etc. **Resolution: slot order/structure IS
  enforced; per-entity content legitimately varies.** Not a coherence defect.)
- **"timesheets approvals leak" — BY-DESIGN.** The "Approvals N" link is a scoped deep-link to the one
  `/approvals` home (CW-6), not a competing queue.
- **"breadcrumb root is entry-point-dependent" — WRONG MECHANISM.** It's **stage-driven** (`recordStatusForPath`),
  never reads entry point. The "one record, two parents" effect is real but is intended ADR-0020 Model-B.
- **"Finance is a timesheet approver" — REVIEWER ERROR** (both substrates). Finance approves *procurement*
  (`policy.ts:124`); timesheet approval is Admin·Exec·PM (`policy.ts:211`). The nav gap (#7) stands; the
  premise was mis-attributed.
- **confirm-on-approve — BY-DESIGN** (SoD gravity; routine forward steps were already de-gated to single-click).
- **disabled "New user" / "Board pack" — BY-DESIGN** (honest deferred; need server-side admin API; reason in tooltip).
- **gpt "different app" majors** (timesheets-mobile checklist, procurement 7-step checklist, frameless CRUD
  detail, opportunity-open inconsistency, deal-card-no-nav, My-Tasks no-prioritization) — **FALSE / already-fixed /
  coordinate-click artifacts.** Several described pre-coherence-wave layouts.

## FIXED-SINCE the audit's baseline (audit was right then, shipped now)

Timesheet `Log time` prefill (in-session + project prefilled) · Save/Submit feedback (toasts + submit-confirm copy) ·
procurement "Ready to advance" dead-banner (now conditional) · duplicate PM-approval surfaces (collapsed to `/approvals`,
CW-6) · mobile stat-tile fades · procurement mobile density.

## Recommendation (owner decision)

Three tracks, independent — do in this order:

1. **Fix the money bug now (HIGH, prod).** Make `spent` **derived** — point the Actual tile + `top_projects.spent`
   + `projects_at_risk` at the committed-PO basis everything else uses; pin Committed/Actual/Spent in the glossary.
   Small, isolated, prod-affecting. *(Standard issue loop; not part of the coherence story.)*
2. **One "enforcement wave" (Medium) — the audit's true signal.** Convert instance-patching → pattern-enforcement
   for the two patterns that actually survived: **(a) one `RecordActionZone`** (every record's advance/decide verb;
   delete the alternatives) **+ one stage-indicator** (kill the blue-pip/green-bar split); **(b) one entity noun**
   (rename Opportunity→Project end-to-end; kill the "deal" leaks) **+ route status/stage off action-blue.** Add a
   **lint/unit guard** per pattern so the DONE bar is "enforced app-wide," not "instances patched."
3. **Discrete fixes (Low-Medium), batchable:** procurement-list inline preview (extend IF-A) · My-Tasks open-task
   route + drop the native `<select>` · Finance `/approvals` in the rail + ⌘K · CompanyDetail status pill · the
   DESIGN.md doc-drift lines · PM-timesheets default scent.

*Verified by the Director via 6 parallel code+render verifiers, 2026-06-14. The audit earned its keep —
it found 1 real prod bug + 2 genuine un-enforced patterns — but must be read through this verdict, not verbatim.*
