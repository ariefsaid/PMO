# Issue #689 — Personal Microsoft 365 Connection Localization: ADW Execution Plan

## Authority and boundaries

Execute this reviewed FE slice only through the SSSF ADW with `fe_builder` and `fe_reviewer`. The approved specification is `docs/specs/m365-personal-connection-localization.spec.md`; the reviewed implementation plan is `docs/plans/2026-09-28-m365-personal-connection-localization.md`. This execution plan preserves their requirements and task order; it does not amend them.

**Permitted implementation files**

- `pmo-portal/src/components/integrations/M365ConnectionCard.tsx`
- `pmo-portal/src/components/integrations/__tests__/M365ConnectionCard.test.tsx`
- `pmo-portal/public/locales/en/common.json`
- `pmo-portal/public/locales/id/common.json`

Only if the required rendered Discover review proves a defect: add the owning test and a concise graduation entry in `docs/qa-portfolio.md` plus a concise `DESIGN.md` note, then rerender the affected matrix cell. Save review screenshots only under `adws/adw_data/sessions/46fe5ddc/context_handoff/screenshots/`.

Do not edit `connectClient.ts`, the connection callback or state-machine contract, shared `ConfirmDialog`, auth/roles/entitlement, server/token-custody code, schema, or unrelated catalogue content. Preserve entitlement-only gating, request timing, callback-query cleanup, redirect behavior, successful disconnect behavior, and shipped accessibility semantics. Never render raw error messages, callback values, or error codes.

## Execution sequence

All behavior work is strict TDD: edit the shipped-card test first, run the focused test and observe the new regression, then make the smallest scoped production/catalogue change until it passes. The test harness must import and render the shipped `M365ConnectionCard`, load the real English and Bahasa catalogues, and assert visible DOM, accessible names, focus, and mocked client calls.

Run focused tests from `pmo-portal/`:

```sh
../scripts/with-test-lock.sh npm test -- src/components/integrations/__tests__/M365ConnectionCard.test.tsx
```

Run catalogue completeness from `pmo-portal/`:

```sh
npm run check:i18n
```

The ADW deterministic JS suite gate already owns the locked full suite; do not manually run a second full suite.

### 1. Make the existing card test harness locale-aware (no AC owner)

**File:** `pmo-portal/src/components/integrations/__tests__/M365ConnectionCard.test.tsx`

- Parameterize `renderCard` for `'en' | 'id'` and render the shipped component with an isolated i18next instance whose resources are imported from the real `public/locales/en/common.json` and `public/locales/id/common.json` files.
- Retain `MemoryRouter`, current transport mocks, and English default behavior.
- **Verify:** run the focused command above; the existing suite remains green before adding new behavior assertions.

### 2. Red test: English states and actions — AC-M365LOC-001

**File:** `pmo-portal/src/components/integrations/__tests__/M365ConnectionCard.test.tsx`

- Add AC-M365LOC-001 titled assertions for loading, disconnected, organization-approved, connected with and without `connected_at`, reconnect, revoked, unknown, connecting, and action error states.
- Assert English fixed copy and accessible Connect, Reconnect, and Disconnect names; assert personal-account wording does not claim organization activation, completed synchronization, or successful data transfer.
- **Verify:** focused command; the new English assertions must fail before production/catalogue changes.

### 3. Green: English states and actions — AC-M365LOC-001

**Files:** `pmo-portal/src/components/integrations/M365ConnectionCard.tsx`, `pmo-portal/public/locales/en/common.json`

- Add the reviewed `integrations.personalM365.state.*` and `.action.*` English keys exactly as specified.
- Replace every fixed status/action string in the card with literal-key `t()` calls. Keep the current connect loading label behavior; pass only the completed `formatDate(connectedAt)` result as the `connectedSince` interpolation value.
- **Verify:** focused command passes AC-M365LOC-001 without changing status phases, action availability, fetch timing, or redirect behavior.

### 4. Red test: Bahasa states and actions — AC-M365LOC-002

**File:** `pmo-portal/src/components/integrations/__tests__/M365ConnectionCard.test.tsx`

- Add AC-M365LOC-002 titled cases using the actual Bahasa catalogue for the representative states and action accessible names.
- Assert the exact reviewed long disconnected and organization-approved sentences, retained product names, and a connected date formatted for the active locale.
- **Verify:** focused command; the Bahasa assertions must fail before the Bahasa state/action entries are added.

### 5. Green: Bahasa states and actions — AC-M365LOC-002

**File:** `pmo-portal/public/locales/id/common.json`

- Add the reviewed `integrations.personalM365.state.*` and `.action.*` Bahasa entries exactly as specified.
- **Verify:** focused command passes AC-M365LOC-002 and supports all settled state/action strings without English fixed-copy leakage.

### 6. Red test: localized destructive confirmation — AC-M365LOC-003

**File:** `pmo-portal/src/components/integrations/__tests__/M365ConnectionCard.test.tsx`

- Add AC-M365LOC-003 titled English and Bahasa tests that open the existing destructive `alertdialog` and assert its localized accessible title/name, description, Cancel name, and Disconnect name.
- Assert cancel sends no mutation; assert confirm sends the existing `disconnect` mock call and success returns the card to disconnected.
- **Verify:** focused command; localized dialog assertions must fail before confirmation localization.

### 7. Green: localized destructive confirmation — AC-M365LOC-003

**Files:** `pmo-portal/src/components/integrations/M365ConnectionCard.tsx`, `pmo-portal/public/locales/en/common.json`, `pmo-portal/public/locales/id/common.json`

- Add the reviewed `integrations.personalM365.confirm.*` entries and pass their `t()` results to the existing `ConfirmDialog` title, description, confirm, and cancel props.
- **Verify:** focused command passes AC-M365LOC-003 while retaining dialog destructive tone, initial focus, Escape, loading, and confirm-before-write behavior.

### 8. Red test: reviewed error copy and locale change — AC-M365LOC-004

**File:** `pmo-portal/src/components/integrations/__tests__/M365ConnectionCard.test.tsx`

- Add table-driven AC-M365LOC-004 cases for every reviewed stable M365 code in the specification at its callback, status, or connect presentation context.
- Add absent-code, unknown-code, and transport-only failures; assert status failures use the status fallback, callback/connect failures use the generic fallback, error alert semantics and retry/action availability persist, and the URL callback cleanup remains intact.
- Assert raw transport messages and raw codes are absent from the DOM. With an error still visible, change locale in the real provider and assert its displayed reviewed message changes language.
- **Verify:** focused command; the new localization, fallback, suppression, cleanup, and in-place locale-change cases must fail before the card change.

### 9. Green: derive safe localized errors during render — AC-M365LOC-004

**Files:** `pmo-portal/src/components/integrations/M365ConnectionCard.tsx`, `pmo-portal/public/locales/en/common.json`, `pmo-portal/public/locales/id/common.json`

- Add reviewed semantic `integrations.personalM365.errors.*` keys for every listed M365 error code plus `generic` and `statusFallback`; preserve `describeM365Error(code)` English text as the known-code default value.
- Add a card-local known-code-to-literal-translation-key mapper. Store only error `code` plus presentation origin/context in state, and derive translated output during render so locale changes update a visible error without re-running an action.
- Use `statusFallback` for a status error with no known code and `generic` for callback/connect errors with absent or unrecognized codes. Preserve callback cleanup and existing retry/action behavior; never use an error message, callback value, or raw code as rendered copy.
- **Verify:** run the focused command and `npm run check:i18n`; AC-M365LOC-004 passes in both catalogues with correct context fallback and no raw transport data in the DOM.

### 10. Red test: disconnect failure recovery and retry — AC-M365LOC-005

**File:** `pmo-portal/src/components/integrations/__tests__/M365ConnectionCard.test.tsx`

- Add one AC-M365LOC-005 titled journey from callback-confirmed connected state: open the dialog, make `disconnect` reject with `INTERNAL_ERROR` and a raw server message, then assert the dialog remains open, connected state remains confirmed, the localized in-dialog alert has focus, and retry is enabled.
- In the same journey, make the next actual mocked disconnect call succeed; assert it closes the dialog and returns the card to disconnected. Assert neither the raw message nor code appears at either point.
- **Verify:** focused command; recovery assertions must fail against the prior close-on-failure behavior.

### 11. Green: retain failed disconnect in the originating dialog — AC-M365LOC-005

**Files:** `pmo-portal/src/components/integrations/M365ConnectionCard.tsx`, `pmo-portal/public/locales/en/common.json`, `pmo-portal/public/locales/id/common.json`

- Add reviewed `integrations.personalM365.errors.disconnectFailure` copy. Render the localized recovery outcome in the open confirmation dialog and append the known localized reason only when a known code is present.
- Before a retry, clear the prior dialog error. On failure retain the last confirmed connected state and keep the dialog open; close it only after a successful disconnect or explicit cancel.
- Render the persistent failure as `role="alert"` and `tabIndex={-1}`, then focus it when it appears. Restore confirm availability after the request settles.
- **Verify:** focused command passes AC-M365LOC-005 while the original successful disconnect path still returns to idle/disconnected.

### 12. Confirm deterministic card and catalogue gates

**Files:** no implementation files beyond the scoped corrections above.

- Run the focused command from `pmo-portal/` and `npm run check:i18n`.
- Correct only failures in the four permitted implementation files; do not weaken, skip, or delete a test.
- **Verify:** both commands exit successfully.

### 13. Required rendered Discover review (not an automated AC)

**Artifacts:** `adws/adw_data/sessions/46fe5ddc/context_handoff/screenshots/`; only confirmed defects may additionally touch `pmo-portal/src/components/integrations/__tests__/M365ConnectionCard.test.tsx`, `docs/qa-portfolio.md`, and `DESIGN.md`.

- With deterministic local function responses and no live Microsoft account, render `/integrations` at 1440px and 390px in English and Bahasa, light and dark themes, covering disconnected, connected, and failed-disconnect-dialog states.
- Save screenshots for every `locale × theme × viewport × state` matrix cell under the stated handoff directory. Inspect long-copy wrapping, clipping, horizontal overflow, localized accessible names, dialog focus, and focus-visible treatment.
- If and only if a defect is confirmed, write its owning test first, fix it within scope, add its routes×oracles matrix cell and owning test to `docs/qa-portfolio.md`, add a concise durable `DESIGN.md` note, and rerender the affected cell. Do not record preferences or create an automated AC for Discover; AC-M365LOC-005 remains the recovery behavior owner.
- **Verify:** all 24 matrix cells are inspected and saved; every confirmed finding has a passing owning test and rerender evidence.

### 14. ADW reviews and final deterministic gate

**Files:** none unless a reviewer identifies an in-scope defect, which must follow the TDD/fix/rerender process above.

- Complete the ADW `fe_reviewer` review plus mandatory spec, code-quality, and security review passes. Confirm no change widened authorization, changed the entitlement gate, exposed transport data, or altered the callback contract.
- Allow the ADW-owned locked deterministic JS full-suite gate to run once; do not start a second full suite manually. Record focused test, i18n, review, and Discover evidence in the ADW handoff.
- **Verify:** all ADW gates/reviews report green with no unresolved Critical or Important finding.

## Acceptance traceability

| Acceptance criterion | Sole automated owner | Execution tasks |
| --- | --- | --- |
| AC-M365LOC-001 | `pmo-portal/src/components/integrations/__tests__/M365ConnectionCard.test.tsx` Vitest | 2–3 |
| AC-M365LOC-002 | `pmo-portal/src/components/integrations/__tests__/M365ConnectionCard.test.tsx` Vitest | 4–5 |
| AC-M365LOC-003 | `pmo-portal/src/components/integrations/__tests__/M365ConnectionCard.test.tsx` Vitest | 6–7 |
| AC-M365LOC-004 | `pmo-portal/src/components/integrations/__tests__/M365ConnectionCard.test.tsx` table-driven Vitest; catalogue completeness is a supporting `check:i18n` gate | 8–9 |
| AC-M365LOC-005 | `pmo-portal/src/components/integrations/__tests__/M365ConnectionCard.test.tsx` Vitest | 10–11 |

No new ADR is required: this is a scoped card localization/recovery implementation under the accepted M365 architecture, with no architecture, data, authorization, or public-contract decision.
