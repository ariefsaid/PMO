# Issue #677 — truthful organization integration readiness

Approved inputs: `docs/specs/integration-readiness-ux.spec.md` and `docs/plans/2026-09-27-integration-readiness-ux.md`.

## Design and boundaries

Keep the Administration organization-integration surface in `pmo-portal/src/components/integrations/IntegrationsView.tsx`; do not alter the personal integrations route, Microsoft 365 organization-approval card, schema, repository transport contract, credential handling, or authorization model. `CanWrite` remains the UI affordance gate and existing server enforcement remains unchanged.

The view has four independent read models: organization bindings, per-active-tier health, ERPNext Companies, and ClickUp map/ownership inputs. A failure in one renders only that read model unavailable, with a retry for that source, rather than converting it to a negative state or hiding the remaining usable controls. The binding read is the one exception to inferred status: on its failure, each service says **connection state unavailable/unknown**, never disconnected or not connected; an Admin's Connect control remains available because it is still a permitted recovery action.

Health is a presentation-only aggregate. The existing `last_sync` value remains repository compatibility data but is not rendered or described as a successful sync, data progress, or data movement: the backing watermark timestamp is not reliable evidence for those claims. `error_count` is rendered as a tabular count of **outstanding outbound items** (pending or needing attention), never “all errors.” Every available-health state directs the operator to verify a live transferred record before treating data movement as usable. Connection, Company activation, and that live check remain separate states.

Use the existing `Card`, `StatusPill`, `ListState`, `EntityFormModal`, `ConfirmDialog`, `Button`, and `CanWrite` primitives. Keep the existing 32px controls, Status-as-Dot variants, token-only light/dark styling, responsive `flex-wrap`/single-column layout, and generic task-level error copy. All newly added copy belongs under `integrations.organization.readiness` in both locale files. No ADR or migration is needed: this is a reversible UI/query-state correction with no API, schema, tenancy, permission, token-custody, or approval-model change.

## Data flow and query contract

1. `useIntegrations()` supplies the active `orgId`, bindings and source-query states, mutations, and repository-backed per-tier reads.
2. `IntegrationsView` derives active tiers only from a successful binding read. Each tier has an independent health query keyed by organization and tier. A rejected or slow tier cannot block its healthy sibling; each card renders its own `loading | available | unavailable` state.
3. Successful connect, disconnect, and ERPNext Company activation invalidate the common `['integrations', 'health', orgId]` query family as well as bindings; this reaches both per-tier keys. A changed organization receives distinct keys and cannot reuse another organization’s health result.
4. The view independently consumes Companies, ClickUp lists, project-binding rows, project rows, and domain-ownership query flags/refetchers. Unknown input produces an explicit unknown map/ownership state, not a confident PMO-native/empty claim.

## Implementation plan — red, green, refactor

### 1. Scope health cache identity and mutation refreshes
**ACs:** AC-IRUX-009

- **RED:** In `pmo-portal/src/hooks/useIntegrations.test.tsx`, add `AC-IRUX-009` tests that (a) assert the exported health-key helper includes the active organization and tier, (b) prove different organization and tier inputs yield different keys, and (c) prove successful connect, disconnect, and `setCompany` invalidate the organization-wide health-key prefix in addition to bindings. Update existing exact-tier invalidation expectations to the shared prefix contract.
- **GREEN:** In `pmo-portal/src/hooks/useIntegrations.ts`, export `integrationHealthQueryKey(orgId, tier)` returning `['integrations', 'health', orgId, tier]`, expose `orgId` in the hook result, and replace the three mutation health invalidations with `queryClient.invalidateQueries({ queryKey: ['integrations', 'health', orgId] })`. Preserve all existing binding/list/company query gates and repository calls.
- **REFACTOR:** Keep the key helper as the sole health-key constructor; do not add a second cache family or alter repository `IntegrationHealth`/database data.
- **Verify:** `cd pmo-portal && source ~/.nvm/nvm.sh && nvm use v22.23.2 && npm test -- src/hooks/useIntegrations.test.tsx`

### 2. Render independent binding and health truth states
**ACs:** AC-IRUX-001, AC-IRUX-002, AC-IRUX-003, AC-IRUX-004, AC-IRUX-009

- **RED:** In `pmo-portal/src/components/integrations/IntegrationsView.test.tsx`, add AC-tagged component tests for: binding loading; a failed binding read showing an unknown connection status, generic retry, and an Admin Connect button; active ERPNext without a Company showing activation pending and Company selection; one active tier’s unavailable health alongside another tier’s available state and Retry; and health payloads with both null and non-null `last_sync` proving the DOM contains neither a sync-time claim nor the timestamp but does contain the live-transferred-record instruction and correctly singular/plural “outstanding outbound items” count. Keep assertions scoped to a tier card so the second tier proves independence.
- **GREEN:** In `pmo-portal/src/components/integrations/IntegrationsView.tsx`, import and use `integrationHealthQueryKey`, pass `orgId` into two independent tier queries, and replace its `Record<ExternalTier, IntegrationHealth | null>`/catch-to-`null` result with per-tier query states. While one tier query is pending, only its card shows loading; when one `getHealth` rejects, only that card shows a generic unavailable state and its own Retry; successful sibling data remains visible.
- **GREEN:** Make the binding failure state override inferred “Not connected”/“Disconnected” labels with a neutral unknown label and generic status-read recovery message. Continue rendering the permitted `CanWrite` Connect affordance, but never render a Disconnect action based on an unknown binding.
- **GREEN:** Remove `formatDateTime` and all `health.last_sync` rendering from this component. For available health render only a tabular outstanding-work count using `health.error_count`, with wording that covers pending and needs-attention work, plus a visible instruction to check a live transferred record to establish usable data movement. Do not call a watermark, its timestamp, or the connection a successful sync/data-progress proof.
- **REFACTOR:** Keep the Microsoft 365 approval block outside `TIERS`, preserve existing tier labels and role gates, and use existing `StatusPill`, `ListState`, and token classes rather than a new status component or colors.
- **Verify:** `cd pmo-portal && source ~/.nvm/nvm.sh && nvm use v22.23.2 && npm test -- src/components/integrations/IntegrationsView.test.tsx`

### 3. Make ERPNext Company activation recoverable in its own modal
**ACs:** AC-IRUX-005

- **RED:** Extend `pmo-portal/src/components/integrations/IntegrationsView.test.tsx` with `AC-IRUX-005` interactions covering: opening the picker during Company loading; an unavailable Company read with a generic error and `refetchCompanies` Retry; a successful empty Company list with an explicit empty state and disabled Activate; populated options; and a rejected activation that leaves the dialog open, retains the selected option, exposes a generic persistent in-dialog error, and permits another Activate attempt.
- **GREEN:** In `pmo-portal/src/components/integrations/IntegrationsView.tsx`, destructure `isCompaniesError`, `refetchCompanies`, and the existing Company query flags. Keep “Select Company” reachable for an active unactivated ERPNext binding even while its data is loading; inside the existing `EntityFormModal`, render `ListState` loading, error-with-Retry, empty, or the existing `Combobox` only for the corresponding query state. Disable submission whenever Companies are loading, unavailable, empty, or no Company is selected.
- **GREEN:** Retain `selectedCompany` and `setCompanyTier` in the `setCompany.mutateAsync` catch path; set only a generic activation-failed message there. Clear selection only after successful activation or explicit modal close.
- **REFACTOR:** Do not alter `repositories.integrations.listCompanies`, `setCompany`, the Company payload shape, or the active-binding query gate.
- **Verify:** `cd pmo-portal && source ~/.nvm/nvm.sh && nvm use v22.23.2 && npm test -- src/components/integrations/IntegrationsView.test.tsx`

### 4. Make every ClickUp binding-map input explicit and recoverable
**ACs:** AC-IRUX-006

- **RED:** In `pmo-portal/src/components/integrations/IntegrationsView.test.tsx`, add `AC-IRUX-006` cases for loading and rejected ClickUp-list, project-binding, and project reads. Each case must name the unavailable map input, show its own Retry wired to `refetchLists`, `refetchBindings`, or `projectsQuery.refetch`, and assert rows needing that input display “Unknown” rather than “PMO-native” or a fabricated list name. Retain an available map test proving a healthy map still displays Bound and PMO-native states.
- **GREEN:** In `pmo-portal/src/components/integrations/IntegrationsView.tsx`, consume the existing list/binding error and refetch values plus project-query `isPending`, `isError`, and `refetch`. Derive `bindingMapDataUnavailable` from every required map input. Render explicit source-specific loading/unavailable notices and source-specific retries; suppress untracked-list and PMO-native conclusions while any prerequisite is unavailable. Continue to display already-known project/card context without exposing raw error messages.
- **REFACTOR:** Preserve the existing binding relation and active-project filtering; do not make map failure change binding, health, Company, or Microsoft 365 presentation.
- **Verify:** `cd pmo-portal && source ~/.nvm/nvm.sh && nvm use v22.23.2 && npm test -- src/components/integrations/IntegrationsView.test.tsx`

### 5. State domain ownership and retain disconnect recovery
**ACs:** AC-IRUX-007, AC-IRUX-008

- **RED:** In `pmo-portal/src/components/integrations/IntegrationsView.test.tsx`, add `AC-IRUX-007` cases for ownership loading, unavailable-with-`refetch` Retry, and successful empty ownership, each with distinct visible text and no write controls. Add `AC-IRUX-008` interaction coverage for a rejected disconnect: the alert dialog remains mounted, its description says the disconnect did not complete and connection/syncing state may be unchanged, the generic failure is visible, and the same confirm button can retry.
- **GREEN:** In `pmo-portal/src/components/integrations/IntegrationsView.tsx`, consume the full `useExternalDomainOwnership()` query result instead of defaulting failed/undefined data to `[]`. Always render the read-only ownership section with an explicit loading, unavailable/Retry, empty, or populated state. In the disconnect flow add `disconnectError`; clear it when opening/cancelling/succeeding, retain `disconnectTier` on mutation failure, and pass an error-aware generic description plus Retry confirm label to the existing `ConfirmDialog`.
- **GREEN:** Replace the current disconnect catch console output and task mutation details shown by this new readiness work with fixed task-level translated messages; do not render or log raw transport/credential/error details. The pre-confirmation description may state the completed-action consequence, but the failure description must not imply disconnect or sync stoppage occurred.
- **REFACTOR:** Keep `ConfirmDialog` unchanged and continue using its focus trap, alertdialog semantics, loading protection, mobile sheet, and existing destructive tone.
- **Verify:** `cd pmo-portal && source ~/.nvm/nvm.sh && nvm use v22.23.2 && npm test -- src/components/integrations/IntegrationsView.test.tsx`

### 6. Localize readiness copy and lock role, language, and small-screen behavior
**ACs:** AC-IRUX-010 (also exercises the controls in AC-IRUX-001, AC-IRUX-002, AC-IRUX-005, AC-IRUX-008)

- **RED:** In `pmo-portal/src/components/integrations/IntegrationsView.test.tsx`, add `AC-IRUX-010` tests that switch the test i18n instance between English and Bahasa Indonesia and assert representative readiness strings in each language. In the same test block assert Admin retains Connect/Select/Disconnect-or-Retry affordances where permitted and a read-only role receives the truthful state text but no mutation controls. Use accessible role/name assertions for all new retry, modal, and confirmation controls.
- **GREEN:** In `pmo-portal/public/locales/en/common.json` and `pmo-portal/public/locales/id/common.json`, add the identical `integrations.organization.readiness` key tree for binding (`unknown`, `unavailable`, `retry`), activation/Company (`pending`, `loading`, `unavailable`, `empty`, `activateFailed`), health (`loading`, `unavailable`, `outstandingOne`, `outstandingMany`, `liveRecordCheck`), map source states, ownership states, and disconnect failure/retry copy. Use Bahasa translations in the Indonesian file, not English fallbacks.
- **GREEN:** Replace all readiness copy introduced in Tasks 2–5 in `pmo-portal/src/components/integrations/IntegrationsView.tsx` with `t('integrations.organization.readiness.…')`; pass translated labels to new Buttons and `ConfirmDialog`. Keep existing non-readiness strings unchanged unless they are being replaced by one of these new states.
- **REFACTOR:** Ensure state control rows use existing `flex flex-wrap gap-2`, cards remain `p-4`, counts use `tabular`, and no new color class/token is introduced. At 390px controls must wrap rather than overflow; focus remains supplied by the shared controls.
- **Verify:** `cd pmo-portal && source ~/.nvm/nvm.sh && nvm use v22.23.2 && npm test -- src/components/integrations/IntegrationsView.test.tsx && npm run check:i18n`
- **Rendered Discover check (required, not a substitute for the tests):** Run `cd pmo-portal && source ~/.nvm/nvm.sh && nvm use v22.23.2 && npm run dev`, inspect `/administration/integrations` at 390px in light and dark themes as Admin and read-only viewer, keyboard-tab every new Retry/Connect/Company/disconnect control, and inspect each loading/error/empty state. Sweep the affected `/administration/integrations` cells for state coverage, a11y, mobile@390, role fit, data correctness, and cross-screen consistency per `docs/qa-portfolio.md`. If a defect is found, first add its deterministic test and then record its matrix/design graduation before treating the review as complete; do not silently change the stated behavior.

### 7. Replace the obsolete browser-level “last sync” oracle
**ACs:** AC-IRUX-004, AC-IRUX-010 (regression coverage; primary owner remains the component test)

- **RED:** In `pmo-portal/e2e/AC-EAC-018-connect-link-sync.spec.ts`, change the existing health-card expectation so it fails against the old “Last sync” UI and instead expects no last-sync/successful-data-movement claim plus the live-transferred-record verification instruction. Retain the existing dedicated-row isolation header, seed/cleanup, mocked transport, and the separate actual record-convergence/outbox assertions; the test must not use the watermark timestamp as its UI oracle.
- **GREEN:** Update the test title/comments only as necessary to describe the corrected user goal: a connection is not readiness proof and the operator is directed to a live record check. Do not add network credentials, external calls, schema writes beyond the existing dedicated test setup, or a new E2E file.
- **REFACTOR:** Keep this browser regression complementary to, not the owner of, the AC-IRUX component tests; preserve its isolation classification and avoid conditional skips.
- **Verify:** `cd pmo-portal && source ~/.nvm/nvm.sh && nvm use v22.23.2 && npm run e2e`

## Traceability

| Acceptance criterion | Primary owning test |
| --- | --- |
| AC-IRUX-001 | `pmo-portal/src/components/integrations/IntegrationsView.test.tsx` |
| AC-IRUX-002 | `pmo-portal/src/components/integrations/IntegrationsView.test.tsx` |
| AC-IRUX-003 | `pmo-portal/src/components/integrations/IntegrationsView.test.tsx` |
| AC-IRUX-004 | `pmo-portal/src/components/integrations/IntegrationsView.test.tsx` |
| AC-IRUX-005 | `pmo-portal/src/components/integrations/IntegrationsView.test.tsx` |
| AC-IRUX-006 | `pmo-portal/src/components/integrations/IntegrationsView.test.tsx` |
| AC-IRUX-007 | `pmo-portal/src/components/integrations/IntegrationsView.test.tsx` |
| AC-IRUX-008 | `pmo-portal/src/components/integrations/IntegrationsView.test.tsx` |
| AC-IRUX-009 | `pmo-portal/src/hooks/useIntegrations.test.tsx` |
| AC-IRUX-010 | `pmo-portal/src/components/integrations/IntegrationsView.test.tsx` plus rendered Discover check |

`pmo-portal/e2e/AC-EAC-018-connect-link-sync.spec.ts` is a regression complement for AC-IRUX-004/010, not a second AC owner.

## Completion boundary

The builder runs the focused commands above during red-green-refactor and must leave every touched test green. Do not run a migration, change RLS/schema/API/permissions/token custody/Microsoft 365 approval behavior, push, open a PR, merge, or deploy. The Director owns the later full `npm run verify:locked`, broader gates, reviews, and release decisions. Operational readiness still requires the separate private live data-carrying walkthrough in the approved spec; no UI state or automated test may claim it has occurred.
