# Integration readiness UX — implementation plan

Spec: `docs/specs/integration-readiness-ux.spec.md` · Issue #677 · target `dev`.

## Design

Keep the existing Administration Integrations card layout, shared `StatusPill`, `ListState`, `EntityFormModal`, and `ConfirmDialog`. Put a short state and next action beside each service. Separate credential connection, ERPNext Company activation, and live data verification. The current health timestamp comes from watermark row creation and cannot establish a last successful sync; remove that claim from the card. The aggregate count includes pending as well as failed outbound work, so label it as outstanding work. Keep Microsoft 365 as its existing independent approval card. Errors stay scoped to the failed read or write, preserve the rest of the page, and offer Retry.

At 390px, cards stack and controls wrap without horizontal overflow. Use existing border, muted foreground, status text, and focus tokens from `DESIGN.md`; no new color or layout system. New English/Bahasa strings live under `integrations.organization` in both `public/locales/*/common.json`. Keep the existing role gate on writes.

## Tasks (each red → green → refactor)

1. Add `AC-IRUX-001` tests in `src/components/integrations/IntegrationsView.test.tsx` for an unavailable binding read, Retry, and the still-permitted Connect control. Update `IntegrationsView.tsx` binding-state pill and copy.
2. Add `AC-IRUX-003/004/009` query tests that distinguish per-tier health load, failure, and partial failure; prove a non-null watermark never appears as a last-success time. In `useIntegrations.ts`, expose `orgId` and align mutation invalidation with the health query key in `IntegrationsView.tsx`. Use a structured result that does not collapse failure to `null`.
3. Add `AC-IRUX-002/005` Company selection tests for loading, error/retry, empty, selection, and failed activation. Wire already-available hook query flags into `IntegrationsView.tsx`; preserve the selection on write failure.
4. Add `AC-IRUX-006` map tests for binding/list/project read failures and Retry. Use unknown state whenever the data needed for a PMO-native classification is unavailable.
5. Add `AC-IRUX-007/008` tests for domain ownership states and disconnect failure. Add a persistent in-dialog failure message using the existing `ConfirmDialog` description slot; retain the dialog on failure.
6. Translate every new string in both locale JSON files and assert representative English/Bahasa copy in component tests. Add a rendered 390px light/dark and keyboard/focus review for Admin and read-only viewer; graduate any confirmed findings to tests and `docs/qa-portfolio.md`.
7. Run focused Vitest during development, then `npm run verify:locked` from `pmo-portal` as the pre-push gate. Run existing integration-targeted e2e and relevant pgTAP if behavior touches their contract. Obtain independent spec, quality, security, and rendered-design reviews. Fix findings, rerun full verify, commit, push, open PR to `dev`, wait for `verify` and `pgtap`, merge when green, and perform exact-tip worktree cleanup.

## Traceability

| Acceptance criteria | Primary owning test |
|---|---|
| AC-IRUX-001–008 | `pmo-portal/src/components/integrations/IntegrationsView.test.tsx` |
| AC-IRUX-009 | `pmo-portal/src/hooks/useIntegrations.test.tsx` and query-cache assertions in the view test |
| AC-IRUX-010 | component language/role assertions plus rendered browser review |

## Release boundary

This issue may merge to `dev` after its gates. It does not promote `main` or production. The RIS Admin live connection and data-carrying walkthrough remain separate operational acceptance evidence.
