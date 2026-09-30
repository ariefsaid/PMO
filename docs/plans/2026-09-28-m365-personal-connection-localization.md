# Personal Microsoft 365 Connection Localization Implementation Plan

> **For agentic workers:** Execute through the bounded FE SSSF ADW: `adws/adw_simple_sdlc.py --builder fe_builder --reviewer fe_reviewer`. The FE builder follows `.claude/agents/ui-implementer.md`; the FE reviewer follows `.claude/agents/design-reviewer.md`. The ADW owns its staged commits and review-revise loop.

**Goal:** Localize the personal Microsoft 365 card in English and Bahasa, including a clear disconnect-failure recovery path.

**Architecture:** Keep the shipped card state machine, entitlement gate, callback contract, and transport untouched. Use the existing `react-i18next` provider and `common.json` catalogues; map the existing stable `AppError.code` values to static, whitelisted card translation keys inside the card. Keep failed disconnect feedback in the existing confirmation dialog.

**Tech Stack:** React 19, TypeScript, `react-i18next` / i18next, Vitest, Testing Library, the existing FE rendered-review workflow.

**Spec:** [`docs/specs/m365-personal-connection-localization.spec.md`](../specs/m365-personal-connection-localization.spec.md)

## Scope and Gates

- Change only `M365ConnectionCard.tsx`, its existing test, and `public/locales/{en,id}/common.json`; no changes to `connectClient.ts`, token-custody functions, shared `ConfirmDialog`, authorization, or schema.
- Preserve `useFeature('m365_integration')` as the only card gate; preserve callback query cleanup, fetch timing, redirect behavior, existing status transitions, and accessible status/alert roles.
- Map only known error codes to fixed catalogue entries; unknown or absent codes use the specified localized fallback. Never display `err.message`, callback values, or raw error codes.
- Keep connected-account copy distinct from organization activation and verified data movement; describe only the user's own account and content available through it.
- Keep state/action and error keys under `integrations.personalM365` in both catalogues. Format dates with `formatDate` before i18next interpolation.
- Run focused Vitest as `../scripts/with-test-lock.sh npm test -- src/components/integrations/__tests__/M365ConnectionCard.test.tsx` from `pmo-portal/`. Run `npm run check:i18n` and the final full gate as `npm run verify:locked` from `pmo-portal/`.
- Test from the actual English and Bahasa catalogues. Include callback code absent/known/unknown, status failures, code-free transport errors, and locale changes while an error remains visible.
- Disconnect failure must retain the last confirmed connected state and its open dialog, render a localized persistent alert, move focus to it, and permit retry. A successful retry closes the dialog and returns to idle.
- Render 1440px and 390px at both locales and themes; use deterministic function responses, never a live Microsoft account. Keep the existing keyboard focus, Escape, loading, and confirm-before-write behavior.

## Tasks

Each task is a small red-green step intended to take 2–5 minutes; run only the focused card test during these steps.

### 1. Add an isolated locale-aware card test wrapper (3 minutes)

**Files:** `pmo-portal/src/components/integrations/__tests__/M365ConnectionCard.test.tsx`

- [ ] Parameterize `renderCard` with `locale: 'en' | 'id'` and give each render an isolated i18next instance loaded from the real `public/locales/{en,id}/common.json` resources.
- [ ] Keep the current `MemoryRouter`, mocks, and default English behavior for existing tests; run the focused card test to confirm the harness itself preserves the current suite.

### 2. Add the English state-copy oracle (3 minutes)

**Files:** `pmo-portal/src/components/integrations/__tests__/M365ConnectionCard.test.tsx`

- [ ] Add AC-M365LOC-001 assertions for checking status, disconnected, connected with and without `connected_at`, organization-approved, reconnect, revoked, unknown, and the Connect/Reconnect/Disconnect accessible names.
- [ ] Assert that the disconnected and connected messages do not imply organization activation or completed data transfer; run the focused test and confirm the new assertions fail against the English-only card.

### 3. Localize English states and actions (4 minutes)

**Files:** `pmo-portal/src/components/integrations/M365ConnectionCard.tsx`, `pmo-portal/public/locales/en/common.json`

- [ ] Add the English `state.*` and `action.*` entries from the spec under `integrations.personalM365`.
- [ ] Replace fixed status and action JSX copy with literal-key `t()` calls; keep the Button's Connect label during its existing loading state and pass only `formatDate(connectedAt)` as the `connectedSince` interpolation value.
- [ ] Run the focused test and confirm AC-M365LOC-001 passes without changing phase transitions, request timing, or action availability.

### 4. Add the Bahasa state-copy oracle (3 minutes)

**Files:** `pmo-portal/src/components/integrations/__tests__/M365ConnectionCard.test.tsx`

- [ ] Add AC-M365LOC-002 assertions for the same representative states and action names using the actual Bahasa catalogue.
- [ ] Include the long disconnected and organization-approved text and an active-locale connected date; run the focused test and confirm the new Bahasa assertions fail before the Bahasa copy is added.

### 5. Localize Bahasa states and actions (4 minutes)

**Files:** `pmo-portal/public/locales/id/common.json`

- [ ] Add the Bahasa `state.*` and `action.*` entries from the spec, retaining product names and personal-account language.
- [ ] Run the focused test and confirm AC-M365LOC-002 passes with no English fixed state or action copy remaining in the supported settled states.

### 6. Add the localized confirmation oracle (3 minutes)

**Files:** `pmo-portal/src/components/integrations/__tests__/M365ConnectionCard.test.tsx`

- [ ] Add AC-M365LOC-003 tests for both locales that open the destructive `alertdialog` and assert its localized accessible name, description, Cancel, and Disconnect names.
- [ ] Assert cancel causes no mutation and confirm preserves the current successful disconnect request; run the focused test and confirm localized dialog assertions fail before implementation.

### 7. Localize confirmation copy (3 minutes)

**Files:** `pmo-portal/src/components/integrations/M365ConnectionCard.tsx`, `pmo-portal/public/locales/en/common.json`, `pmo-portal/public/locales/id/common.json`

- [ ] Add the spec's English and Bahasa `confirm.*` strings and pass them to the existing `ConfirmDialog` title, description, confirm, and cancel props.
- [ ] Run the focused test and confirm AC-M365LOC-003 passes while destructive tone, pending behavior, keyboard focus, Escape, and confirm-before-write remain unchanged.

### 8. Add the reviewed error-copy oracle (4 minutes)

**Files:** `pmo-portal/src/components/integrations/__tests__/M365ConnectionCard.test.tsx`

- [ ] Add table-driven AC-M365LOC-004 cases for each error code in the spec, covering callback, status, and Connect presentation at the owning context.
- [ ] Add cases for absent/unknown codes, a transport-only error, and changing locale while an error is visible; assert that no raw message or code appears. Run the focused test and confirm the new localization assertions fail.

### 9. Localize known errors and safe fallbacks (5 minutes)

**Files:** `pmo-portal/src/components/integrations/M365ConnectionCard.tsx`, `pmo-portal/public/locales/en/common.json`, `pmo-portal/public/locales/id/common.json`

- [ ] Add the spec's semantic error keys and Bahasa translations; use `describeM365Error(code)` as the English `defaultValue` for each known code.
- [ ] Add a card-local mapper with literal `t()` keys for the listed `M365ErrorCode` values. Read only a string `code` from an unknown error and store `{ code, origin }`, deriving translated text during render so a locale change updates the visible error.
- [ ] Use `statusFallback` for status errors without a known code and `generic` for callback/Connect errors without a known code. Keep callback parameter cleanup and existing retry/action availability unchanged.
- [ ] Run the focused test and `npm run check:i18n`; confirm known codes resolve in both languages, context fallbacks are correct, and supplied transport text remains absent from the DOM.

### 10. Add the disconnect-recovery oracle (3 minutes)

**Files:** `pmo-portal/src/components/integrations/__tests__/M365ConnectionCard.test.tsx`

- [ ] Add AC-M365LOC-005: from the connected callback state, make `disconnect` fail with `INTERNAL_ERROR` plus a raw server message; assert the dialog remains open, the localized alert explains last-confirmed connected status, focus is on the alert, and retry is enabled.
- [ ] In the same journey, retry successfully and assert the dialog closes, the card returns to not connected, and neither the raw message nor code appears. Run the focused test and confirm the recovery assertions fail on current behavior.

### 11. Keep disconnect failure in its originating dialog (4 minutes)

**Files:** `pmo-portal/src/components/integrations/M365ConnectionCard.tsx`, `pmo-portal/public/locales/en/common.json`, `pmo-portal/public/locales/id/common.json`

- [ ] Add `errors.disconnectFailure` in English and Bahasa using the spec's fixed copy; show that outcome followed by a known localized code reason when one exists.
- [ ] Change the handler to clear the previous error before retry, retain connected phase and keep the dialog open on failure, and close the dialog only after success or explicit cancel.
- [ ] Render the dialog error as persistent `role="alert"` with `tabIndex={-1}` and move focus to it when failure appears. Run the focused test and confirm AC-M365LOC-005 passes without changing the successful disconnect behavior.

### 12. Run the full card and catalogue checks (3 minutes)

**Files:** none beyond the scoped files above

- [ ] Run `../scripts/with-test-lock.sh npm test -- src/components/integrations/__tests__/M365ConnectionCard.test.tsx` from `pmo-portal/`.
- [ ] Run `npm run check:i18n` from `pmo-portal/`; fix only catalogue completeness or card-test regressions within the allowed files.

### 13. Run the required rendered Discover check (not an AC owner) (5 minutes)

**Files:** review `pmo-portal/src/components/integrations/M365ConnectionCard.tsx`; record confirmed findings in `docs/qa-portfolio.md`; edit `DESIGN.md` only if a confirmed finding requires a durable design note.

- [ ] Inspect `/integrations` at 1440px and 390px, in English and Bahasa and light and dark themes. Cover disconnected, connected, and failed-disconnect dialog states using deterministic local responses for `connection_status` and `disconnect`.
- [ ] Check text wrapping, clipping, horizontal overflow, localized accessible names, and dialog focus. Save rendered review screenshots under the ADW run's `context_handoff/screenshots/`.
- [ ] For each confirmed visual defect, add its owning test, matrix cell, and concise `DESIGN.md` note to the `docs/qa-portfolio.md` graduation registry, then render the affected cell again. Do not add a registry entry for an unconfirmed preference. AC-M365LOC-005 remains the automated owner for disconnect-recovery behavior.

### 14. Complete required verify and reviews (5 minutes)

**Files:** none beyond approved fixes found by the required reviews

- [ ] Run `npm run verify:locked` from `pmo-portal/` as the final full gate.
- [ ] Complete `spec-reviewer`, `code-quality-reviewer`, and `security-auditor` review; complete the FE `design-reviewer` rendered review and fix/re-render any accepted finding before the ADW closes.

## Traceability

| Acceptance criterion | Owning proof | Plan task |
|---|---|---|
| AC-M365LOC-001 | `M365ConnectionCard.test.tsx` | 2–3 |
| AC-M365LOC-002 | `M365ConnectionCard.test.tsx` | 4–5 |
| AC-M365LOC-003 | `M365ConnectionCard.test.tsx` | 6–7 |
| AC-M365LOC-004 | `M365ConnectionCard.test.tsx` + `npm run check:i18n` | 8–9 |
| AC-M365LOC-005 | `M365ConnectionCard.test.tsx` | 10–11 |
