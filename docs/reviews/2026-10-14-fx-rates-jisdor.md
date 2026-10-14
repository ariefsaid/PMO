# JISDOR FX rates — rendered self-review (partial) · 2026-10-14

**Scope:** implementer self-check, not an independent design-reviewer sign-off. No product-data screenshots or client data used.

## Method and evidence

Started the app from `pmo-portal/` on a separate local port and used `agent-browser` on `/administration/exchange-rates` as the seeded Finance role. Rendered the empty-list state at 390×844 and 1440×1000 across English/Indonesian and light/dark (eight combinations); also opened the upload chooser. Screenshots are in the session handoff directory `adws/adw_data/sessions/29de9bc9/context_handoff/screenshots/`:

- `fx-finance-{mobile,desktop}-{en,id}-{light,dark}.png`
- `fx-upload-dialog-3111.png`

The settled accessibility snapshot exposed the Administration page heading, Exchange rates section navigation, Exchange rates region heading, upload action, and empty-state copy. The upload chooser exposed a named file control and disabled Continue until a file is selected. The 390px view retained the mobile navigation control and did not expose an off-screen second section action. The composed axe and focus-restoration cases are owned by `pages/__tests__/Administration.a11y.test.tsx` (AC-FX-013).

## Follow-up rendered check

After restoring the local schema with migration 0288, I re-rendered the Finance empty state and upload chooser using `agent-browser` against the running app on port 3112, then opened—but did not submit—the Admin **New rate** form. The full accessibility snapshots showed the Administration level-1 heading, Exchange rates navigation and region heading, one page-level Upload action, and a named modal. The upload chooser exposed its file-selection label and disabled Continue; the Admin form exposed the Publication date label, required IDR-per-USD textbox, Cancel, and disabled Save rate. The current route returned no browser errors.

Additional screenshots are in the same handoff directory:

- `fx-finance-selfcheck-empty-desktop-en-light.png`
- `fx-finance-upload-dialog-desktop-en-light.png`
- `fx-finance-upload-dialog-mobile-en-light.png`
- `fx-admin-new-rate-dialog-desktop-en-light.png`

This follow-up still did **not** render populated FX history, project/invoice equivalents, or the full route × locale × theme × viewport matrix. It is not completion evidence for task 39. The synthetic-org AC-FX-015 E2E journey passed separately once; it does not replace these missing rendered cells. The real Bank Indonesia export remains unavailable, so AC-FX-014 is still unproven.

## Finding graduated during self-review

The empty FX list showed two equally prominent blue **Upload rates** buttons: one in the section header and another in the empty state. Users saw duplicate primary actions for the same operation, contrary to the One-Blue Rule in `DESIGN.md`.

- **Behavior lock:** `pages/__tests__/AdministrationExchangeRates.test.tsx` now asserts Finance sees exactly one Upload primary while the empty state remains visible. RED was observed (2 buttons); after removing the repeated empty-state action, the targeted file passed (8 tests).
- **Matrix cell:** action-completeness × `/administration/exchange-rates` (added to `docs/qa-portfolio.md`).
- **Design note:** `DESIGN.md` One-Blue Rule now clarifies that an empty state stays explanatory when the page-level primary is already visible.
- **Re-render:** the eight after-fix screenshots show one Upload action in the empty state.

## Limits and follow-up

No claim is made here about Admin correction, populated 50-row pagination, FX error/retry states, or the translated project/invoice surfaces; those remain covered only by the current unit/a11y tests and the single AC-FX-015 journey to the extent their respective test results report. A local browser console message referenced `api_client_request_guard()`; this review did not establish its cause or attribute it to the FX slice.
