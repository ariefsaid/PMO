# Account and public screens — partial report

## Purpose and structure

- Profile: change personal display and notification preferences. Sketch: title → account locale fields → Save and status → device fields → email notifications. The Save grouping was misleading before; source order now separates immediately applied device settings. Rendered prominence not verified.
- Sign in: enter an account. Sketch: language and identity → sign-in options and credentials → recovery and legal links. Prominence not verified.
- Reset password: request a reset link. Sketch: title → email → send → return to sign in. Prominence not verified.
- Update password: set a password or recover from an expired link. Sketch: title → fields and submit, or error → request a new link. Prominence not verified.
- Consent: decide whether an application may act as the signed-in user. Sketch: request and account → consequences → Deny / Allow, or recovery message. Prominence not verified.
- Privacy: read data practices and manage analytics choice. Sketch: policy sections → analytics choice → contact. Prominence not verified.
- Terms: read the service terms. Sketch: policy sections → contact and governing-law status. Prominence not verified.
- Not found: recover from an unknown route. Sketch: message → return to dashboard. Prominence not verified.
- App-level error and empty routes: identify the problem or absence and find a remedy. Their complete inventory and rendered prominence remain unverified.

## Change

Moved text size and home layout below the account preference Save/status group, separated by a rule. They apply immediately on the device; language, number format and timezone require Save. All existing controls, messages, calls and permissions remain in place. No authentication behavior was changed. No sample records were created.

## Measurements and captures

| Edge or state | Before | After |
| --- | --- | --- |
| Profile edges, gaps and phone layout | Not measured | Not measured |
| Other scoped screens | Not measured | Not measured |

Screenshot paths: none. The local stack did not start, so there are no before or after captures. No visual acceptance is claimed.

## Skill lines applied

- Restructure: “Freeze the feature floor before any edit; simplification cannot silently remove a figure, capability or safeguard.” Existing controls and messages were retained.
- Taste app screens: “On a phone: Each section stacks” informed the existing single-column grid, retained in the moved device fields. The actual phone render and inspector were not checked.
- UI/UX Pro Max: “Visible labels, Error near field, Helper text” informed retention of the existing field labels, status and helper text.
- Impeccable: loaded, but its rendered critique and detector were not completed; no result is claimed.
- Screen rules take precedence over skill suggestions; no intentional divergence was made.

## Gates and journeys

- Integration branch fetched and merged; work branch pushed.
- `npm ci`: passed before integration merge; lockfile unchanged.
- `npm run typecheck`: passed after merge.
- ESLint on `pages/ProfileSettings.tsx`: passed after merge.
- Focused profile tests under Node 22: 3 files, 31 tests passed.
- Related tests under Node 22: 20 files and 254 tests passed; one shell integration file failed three tests because `useEffectiveRole` was rendered without an `ImpersonationProvider`.
- `npm run check:guards`: failed in the integration branch i18n check, reporting two unresolved references and two orphaned keys outside the changed profile screen. Later guards did not run.
- Affected journey selection against the integration branch was broad, exceeding the 40-spec cap; journeys were not run. The default selector also failed initially because the local `origin/dev` ref was absent.
- Local Supabase: full start failed from Docker storage exhaustion; a lean attempt reached schema initialization but failed creating a setup container. After the requested cleanup, the retry failed on the registry's unauthenticated pull limit. Database reset, seed sign-in, browser journeys and `scripts/ux-proof.sh` were not run. The requested browser bundle was absent; no browser was downloaded after the correction.
- The vendor script was run before the correction and stopped at a missing upstream directory. Required skills were then recovered individually; the taste revision was pinned to the repository script's revision. No vendor script was run after the correction.
- No journey steps or tests were changed.

## Owner to confirm

- Text size and home layout moved below Save and its status; they previously appeared between account fields. Their immediate-application helper remains visible. Before/after crops are unavailable.

## Needs a data change

- The profile source has no name-editing control. Adding one needs a separate decision on its data and save behavior; it was not added in this screens-only round.

## Not reached

Full purpose-to-surface review and implementation for sign in, reset, update password, consent, privacy, terms, not found, and app-level error and empty routes; all state, role, language and viewport captures; three rendered critique rounds; edge measurements; taste inspector; journeys and UX proof. This branch is not READY.
