# v0.24.0 polish — retained accounting draft after catalogue refresh (#1145)

Status: Director-approved bounded v0.24.0 scope; implementation evidence is tracked separately.
Baseline: origin/dev at 25046f07047588dfd23d2f0eedf234307b5190fa, 2026-10-19.
Companion: docs/plans/2026-10-19-v024-issue1145-polish.md.

## Intent and source

When an Admin is reviewing an accounting choice and the chart refreshes, they want their choice and other edits retained, a plain explanation of why Save is unavailable, and a direct way to choose again.

Issue #1145 is a follow-up to accepted S-11, not a new accounting policy. Source inspection:
- `pmo-portal/pages/admin/OrgWithholdingAccount.tsx` retains draft/saved baseline and checks candidate membership; only the stale *saved* choice gets explanatory subtext.
- `pmo-portal/pages/admin/OrgVendorTaxAccounts.tsx` keeps dirty edits during remote changes and computes `canSave` from saved equality/null/candidate membership. Its missing-choice subtext calls a newly selected draft a saved value.
- Existing S-11 tests cover saved-value retention, explicit clears, save refusal, broad Asset/Liability filtering and Finance read-only.
- `pmo-portal/pages/admin/OrgDownPaymentItem.tsx` already renders a missing-item message; this account follow-up does not expand item behavior.
- No browser reproduction occurred in this planning job. Confirm the refresh interaction with the focused RTL before changing presentation.

Concrete remaining outcome: an Admin picks an unsaved eligible account, a later successful chart refresh omits it, and Save becomes unavailable without an accurate explanation that this retained value is an unsaved draft. A previously saved unavailable value is a separate state and remains retained.

## Scope and non-goals

Only the two tax-account components, their tests and two catalogue entries. Preserve existing setter shapes, role permissions, deliberate null/clear behavior, successful saved-value retention, purpose filtering, remote-change/reload controls and query keys. No account selection by inference, new setting, schema, tax calculation, ERP write, posting or approval change. Do not touch BudgetAccountMap or statement hosts.

## EARS requirements

- **FR-V24P-001:** When a successful catalogue refresh removes a changed nonempty draft choice, the interface shall retain its exact value and all other edits and explain beside that field that the unsaved choice is no longer available.
- **FR-V24P-002:** While that changed choice is unavailable, Save shall retain its existing disabled behavior; selecting a current eligible choice or deliberately clearing the field shall restore the existing valid-save behavior.
- **FR-V24P-003:** When an unavailable value equals the saved setting, the interface shall retain the existing saved-value wording and behavior rather than label it an unsaved draft.
- **FR-V24P-004:** When the chart is pending or failed, the interface shall retain the current loading/error/retry state and shall not claim the draft choice disappeared from a successful chart.
- **NFR-V24P-001:** The change shall preserve exact setter arguments and existing role/authority boundaries and shall not automatically save, replace, clear or broaden candidate eligibility.
- **NFR-V24P-002:** The explanation shall use the shipped English/Bahasa catalogues, shared field/error semantics and DESIGN tokens without a new modal, network request or dependency.

Copy, one static key `v024Polish.accountDraftUnavailable`:
- en: “This unsaved choice is no longer available in the current chart. Choose another account or clear this field.”
- id: “Pilihan yang belum disimpan ini tidak lagi tersedia di daftar akun saat ini. Pilih akun lain atau kosongkan bidang ini.”

## Given/When/Then acceptance and ownership

| AC | Given / When / Then | One owning test |
|---|---|---|
| AC-V24P-001 | Given an Admin selected an unsaved Asset account, When the successful chart refresh omits it, Then the receipt-withholding field retains its account, announces the unsaved-choice explanation, Save is disabled and no setter runs; choosing a current Asset then explicitly saving sends that exact account once. | Unit/RTL: `pmo-portal/pages/admin/OrgWithholdingAccount.test.tsx` |
| AC-V24P-002 | Given changed vendor-tax values in multiple fields, When one selected account disappears from a successful refreshed chart, Then every draft stays intact, only affected fields explain the unavailable unsaved choice, Save stays disabled, and correcting/clearing that field sends the exact retained three-field shape only after Save. | Unit/RTL: `pmo-portal/pages/admin/OrgVendorTaxAccounts.test.tsx` |
| AC-V24P-003 | Given saved-missing, pending/error chart and Finance read-only variants, When both account surfaces render/refresh in en/id, Then saved values retain their established explanation, failed reads do not assert disappearance, and Finance has no picker/save or chart request. | Unit/RTL: `pmo-portal/pages/admin/OrgVendorTaxAccounts.test.tsx`, single parameterized case; receipt-specific legacy tests remain supporting proof. |

## Design

Keep field labels/value/clear control in place. Use `Combobox.error` for a changed invalid selection so its accessible description explains the disabled Save; retain existing selectedOption for identity. Use the established muted `uxs11.savedChoiceUnavailable` wording for saved-missing settings. In the vendor-tax picker, `selectedOption.sub` is not rendered while collapsed and the missing saved value is absent from the option list, so render that existing wording as a visible per-field helper only after a successful catalogue read and only while the value still equals its saved baseline and is absent from eligible choices. Do not add a toast for background refresh. State priority: chart unknown/error → current query remedy without disappearance copy; successful chart + saved unavailable → saved wording; successful chart + changed unavailable → draft wording; corrected valid/cleared → explanation removed.

At 390px and 1440px, light/dark and en/id, messages wrap within the existing max-width form. Maintain focus on the current control during refresh; correction is keyboard operable. Use `text-destructive-text`, `text-muted-foreground`, existing spacing and 32px controls from DESIGN.md. The Discover reviewer later renders rich synthetic variants; this planning job does not.

## Dependencies and release

Independent of active v0.23.0 S21/S36/S35 hosts. New locale key insertion must rebase immediately before publication; do not reformat common.json. #1070 namespace migration is not a prerequisite for one compatible static key.

Build/review/CI may proceed on an isolated branch after Director acceptance of this handoff. HOLD every v0.24.0 product merge to dev until the v0.23.0 dev→main release PR is verified merged by Root. That condition does not authorize main or production work. Preserve all old tests, money assertions and timeouts.
