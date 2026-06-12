# Delivery mockup PI review

## Summary verdict
**Fix-first.** The mockup resolves most owner directives, but it is not ready to green-light build because the weighted rollup math is wrong, required non-happy-path/role states are not fully represented, and several rendered values still bypass `DESIGN.md` tokens.

## Directive-compliance checklist
1. **No `Manual` pill rendered** — **PASS**. No visible `Manual` pill/badge appears in the mockup; divergence is shown as effective-% + muted `From tasks N%` (e.g. `docs/design-mockups/delivery-redesign.html:500-505`).
2. **`Target <date>` spelled out** — **PASS**. Rendered date labels use `Target` (e.g. lines 484, 502, 521, 537, 676) and no visible `Tgt` remains.
3. **Pills/chips encapsulate at 375px** — **PASS (source-level)**. `.pill` has `flex-shrink:0; white-space:nowrap;` and narrow-row parents give shrink responsibility to siblings (`.pcard .top-name`, `.group-head`, lines 88-95, 229-237, 257-263, 423-430).
4. **Tasks-tab group header = phase name + `Target <date>` only** — **PASS**. Header renders `Procurement` + `Target 30 Jun` only, with no % (lines 674-677).
5. **`Edit progress` on every phase for PM/Admin; Engineer none** — **FAIL**. PM/Admin affordances are present on every shown phase (desktop lines 489-544; mobile lines 604-639), but the required Engineer read-only state is only described in comments/callouts and is not actually rendered anywhere for review.
6. **Weight encoded as width + caption + weighted project track; mobile fallback uses labels** — **FAIL**. The pattern is implemented (desktop lines 473-560; mobile lines 597-636), but the displayed `Project delivery 48%` is mathematically inconsistent with the shown phase weights/completions.

## Findings by severity

### Critical

1. **Lens:** IA / task-flow / data trust  
   **Element:** desktop stepper rollup + weighted track (`docs/design-mockups/delivery-redesign.html:461-463`, `555-560`) and mobile rollup (`593-596`)  
   **Issue:** The mockup states **`Project delivery 48%`**, but the shown weights/completions compute to **49.25%**: `(15×100 + 35×75 + 40×20 + 10×0) / 100 = 49.25`. **Rule violated:** `OD-DEL-5` + `docs/glossary.md` weighted rollup semantics (`Σ weight × effective% / Σ weight`). The flagship explanatory device is numerically untrustworthy as drawn.  
   **Fix:** Either change the displayed rollup to `49%`/`49.3%`, or adjust one or more visible phase fills/weights so the weighted sum truly equals `48%`. Update the desktop header, weighted track label, mobile header, and explanatory comments together.

### Important

2. **Lens:** IxD / required states  
   **Element:** state coverage section (`docs/design-mockups/delivery-redesign.html:647-659`) and whole document  
   **Issue:** The mockup renders populated, empty, and at-risk/overdue states, but it does **not** render the required **loading**, **error**, or **destructive-confirm** states from `docs/design/delivery-redesign-plan.md` (Acceptance additions + R4/R5), and it does not render the Engineer read-only stepper state required by Directive 5. **Rule violated:** design-plan state coverage / owner Directive 5. This leaves build-critical branches unspecified.  
   **Fix:** Add explicit source sections for loading skeleton, error+retry, delete/destructive confirm, and an Engineer view with no `Edit progress` affordances.

3. **Lens:** Visual / `DESIGN.md` token fidelity  
   **Element:** `.proj-icon` and inline literal sizing (`docs/design-mockups/delivery-redesign.html:124`, `516`, `593-595`, `677`)  
   **Issue:** The mockup still contains non-token literals that do not cleanly map to `DESIGN.md`: `color:#fff` (line 124), the overdue pill `height:18px; padding:0 7px` (line 516), mobile header `padding:12px 14px` and `font-size:15px` / `18px` overrides (lines 593-595), and `height:28px` button overrides (line 677 and elsewhere). **Rule violated:** `DESIGN.md` token authority / owner instruction that every rendered value map to tokens.  
   **Fix:** Replace raw hex with token colors (`primary-foreground` or `success-foreground` as appropriate) and normalize sizes to the documented token/component scales (`label`/`overline`/`subheading`, 22px pill, 28px small-button only where the component spec explicitly allows it, spacing 12/16 not 14).

4. **Lens:** Visual / semantic color discipline  
   **Element:** status pills labeled `Ongoing` (`docs/design-mockups/delivery-redesign.html:327`, `362`, `394`, `434`)  
   **Issue:** `Ongoing` is rendered with the green `.pill.won` treatment. In `DESIGN.md`, success/green is reserved for won/completed/live-positive states; using it for a neutral lifecycle status weakens semantic color meaning and makes rows look “successful/completed” even when they are merely active. **Rule violated:** `DESIGN.md` semantic-status color usage.  
   **Fix:** Render `Ongoing` as a neutral/open treatment, and reserve green for truly completed/won states.

5. **Lens:** IA / copy clarity  
   **Element:** projects-list `Budget used` column desktop + mobile (`docs/design-mockups/delivery-redesign.html:311`, `343`, `378`, `403`, `437-438`)  
   **Issue:** The label says **`Budget used`**, but the explanatory lines say **`$X of $Y committed`** and the denominator shown equals contract value, not an actual budget. On mobile, only `94%` is shown with no basis at all. **Rule violated:** design-plan R1 naming clarity / one-canonical-view principle for financial metrics.  
   **Fix:** Pick one basis and name it honestly across breakpoints: either `Committed` / `$X committed of $Y contract`, or `Budget used` / `$X of $Y budget`. Preserve the explanatory subline on mobile too.

6. **Lens:** IxD / directive verification  
   **Element:** all shown stepper variants (`docs/design-mockups/delivery-redesign.html:473-545`, `597-639`)  
   **Issue:** Directive 5 requires **Engineer = none** for edit affordances, but no rendered Engineer variant exists to verify that rule. Comments and callout prose are not enough for a pre-build gate. **Rule violated:** owner Directive 5 / design-plan D1 role-state coverage.  
   **Fix:** Add a rendered Engineer-state mock section showing the same stepper/rows without `Edit progress` buttons.

### Minor

7. **Lens:** Visual / One-Blue discipline  
   **Element:** project icon tile using primary blue (`docs/design-mockups/delivery-redesign.html:319`)  
   **Issue:** A non-interactive project avatar tile uses `primary`, spending blue on decorative data. `DESIGN.md` says blue should stay reserved for primary/interactive emphasis, not ambient decoration. **Rule violated:** The One Blue Rule.  
   **Fix:** Use neutral/violet/categorical treatment for project tiles unless the blue conveys interaction.

8. **Lens:** IxD / compact-surface legibility  
   **Element:** mobile weighted rows (`docs/design-mockups/delivery-redesign.html:597-636`)  
   **Issue:** The mobile fallback successfully avoids width-encoding, but it drops target dates entirely, reducing schedule readability versus the desktop stepper and making the overdue condition less explicit than the plan’s `Target <date>` language. **Rule violated:** design-plan date/metadata consistency for milestone surfaces.  
   **Fix:** Add a muted second metadata line or append `Target DD Mon` in each mobile row, especially for overdue phases.

## HTML structural-validity result
Balanced/closed tags check **passes**. I validated the file with a comment-stripped tag parser; no unclosed or mismatched HTML tags remained. Visible `Manual` and `Tgt` strings are absent from rendered markup.

## Weighted-math check
**Fails as written.** With the visible values:
- Engineering: `15 × 100% = 15`
- Procurement: `35 × 75% = 26.25`
- Construction: `40 × 20% = 8`
- Commissioning: `10 × 0% = 0`
- Total = `49.25 / 100 = 49.25%`

So the mockup’s stated **`Project delivery 48%`** is not internally consistent.

## OPEN question for the owner
The mockup still hardcodes an unresolved basis for the projects-list financial metric: should that column be **Committed of contract** or **Budget used (committed of budget)**? The current source mixes the two meanings.
