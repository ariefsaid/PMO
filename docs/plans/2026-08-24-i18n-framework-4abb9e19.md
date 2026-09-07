# Planning stop — Issue #547 i18n framework

**Status:** BLOCKED — do not begin implementation.

## Why planning stops

The binding spec has two unresolved contradictions that make a green, testable implementation impossible without inventing product scope.

### 1. The proposed CI gate cannot be green while the required `id` catalogue is empty

The deciding text is in `docs/specs/i18n-framework.spec.md`:

- §1 explicitly says this slice ships **“`en` complete and `id` empty-but-wired”** and puts Indonesian content out of scope.
- `FR-L10N-042` requires a missing key to fail `npm run verify`.
- `AC-L10N-041` makes the contradiction executable: given a key present in `en` and absent in `id`, `npm run verify` **fails**.
- §6 assigns `AC-L10N-041/042` to the CI completeness gate.

The issue’s Definition of Done simultaneously requires `npm run verify` green, while the prompt excludes the Bahasa content pass. An empty `id` catalogue necessarily has every `en` key missing, including launch-scope keys. Filling `id` with Bahasa now would violate the stated out-of-scope boundary; filling it with English would neither be Bahasa content nor prove the stated Bahasa gate.

**Decision needed (Director/owner): choose one and amend the spec/AC traceability before build.**

1. **Stage the gate (recommended):** #547 gates `en` extraction/completeness and orphan removal for an explicit launch-route source set, retains English runtime fallback for missing `id`, and adds the `id`-completeness CI gate only in the translation-content change that populates Bahasa. Revise `FR-L10N-042`, `AC-L10N-041`, and §6 so they state this sequencing.
2. **Make Bahasa content part of #547:** populate every launch-scope `id` key in this issue, accepting that the translation pass is no longer out of scope.
3. **Specify another bounded interim rule:** it must say exactly which catalogue/language the gate checks, what makes it pass, and when the real `id` gate becomes merge-blocking. A generic exemption or a whole-app glob is not acceptable.

### 2. The required explicit launch-route list does not exist

`OD-I18N-1` and spec §8.2 require `FR-L10N-042` to take an explicit, human-readable route list from map #450 rather than a glob. The deciding map and #453 resolution enumerate a **feature sequence** — i18n, tasks, meetings, work orders — not a list of route patterns or source modules. `App.tsx` currently declares routes, but its current table cannot establish the future task, meeting, and work-order routes that #450 says are launch scope.

Choosing a subset of today’s `App.tsx` routes would silently narrow the owner-set launch scope. Guessing paths for not-yet-built meetings/work orders would create an unowned route contract. Either would violate `OD-I18N-1`’s reason for the explicit list.

**Decision needed (Director/owner): publish the initial registry contents and its maintenance rule.** At minimum, state:

- each launch route pattern that #547 must cover now;
- whether future #462/#463/#471 routes are entries now or are added by their owning feature PR before translation content is marked complete;
- whether a tabbed route is one entry with a tab set or separate entries; and
- the source-module boundary used by the gate for each route, including shared shell/components.

Put that registry in a named, tracked file (for example `pmo-portal/src/lib/i18n/launchScope.ts`) and require the owning route PR to update it. Do not derive it from `appRouteConfig`, `pages/**`, or any glob; those grow silently.

## Recon facts retained for the eventual implementation plan

These are settled by shipped code and do **not** need to be re-designed when the two decisions above are supplied.

- The locale-preference/schema half has already landed on `dev` (`e83b92ad`, `916f9854`): `supabase/migrations/0198_locale_preference_columns.sql`, `supabase/tests/locale_preferences.test.sql`, `supabase/tests/operator_create_org.test.sql`, `pmo-portal/src/lib/locale/resolveLocale.ts`, and `pmo-portal/src/lib/db/preferences.ts`. #547 must compose with these; it must not create another preference migration or duplicate `resolveLocale`.
- `pmo-portal/src/lib/format.ts` is the existing single formatting seam. It has record-currency arguments and `PLATFORM_CURRENCY`, but its formatter cache and all date/number constructors are still hardcoded to `en-US`/`en-GB`; `parseMoneyInput` remains comma-only. The eventual plan must make the seam resolve the provider’s `numberLocale`, cache by `(locale, currency, shape)`, use date-fns Indonesian locale for relative prose, and preserve the single parser boundary. It must not move formatting into i18next or change export serialization.
- `pmo-portal/index.tsx` mounts `App`; `App.tsx` already places `QueryClientProvider` outside `AuthProvider`, and `AuthProvider` loads the current profile (which now includes its nullable locale fields). `pmo-portal/src/hooks/useOrgCurrency.ts` plus `pmo-portal/src/lib/db/orgs.ts` is the existing pattern for the one org-default read a locale provider needs.
- `pmo-portal/src/components/shell/ContextBar.tsx` is the existing authenticated account-menu surface and is the appropriate eventual language-switcher location; both desktop and mobile account-menu tests will need to cover the control.
- `pmo-portal/public/` exists but contains no locale catalogues. The eventual runtime needs a lazy JSON backend against `public/locales/{en,id}/<namespace>.json`; pre-bundling both languages would violate `FR-L10N-043`.
- `i18next-parser` only extracts calls already expressed as `t(...)`/`<Trans>`; it cannot convert existing JSX literals into translation calls. The eventual implementation plan must give the builder an exhaustive source manifest and an explicit key/default-value convention before it can claim the stated ~1,940-call-site extraction is reproducible.
- Dependencies remain absent in `pmo-portal/package.json`. When unblocked, add `i18next`, `react-i18next`, and dev-only `i18next-parser` via `scripts/relock.sh` only, then run `npm ci`; never use host `npm install`.
- `pmo-portal/package.json` makes `npm run verify` the required full gate. DB-driving verification must be held under `scripts/with-db-lock.sh`; the shared-machine full suite command is `npm run verify:locked` from `pmo-portal/`.

## Required follow-up

After the two decisions are recorded, re-run planning against the current `dev` tree and produce a normal TDD-first implementation plan. It must include one owning test per `AC-L10N-*`, the planted-missing-launch-key red proof requested in the issue, the parser/extraction command, the exact registry file, explicit locale pins for affected formatting assertions, a read-only `e2e/AC-L10N-060-language-switch.spec.ts` with its required isolation tag, and final `npm run verify:locked` evidence.

**Task count:** 0 implementation tasks — blocked before design may invent a gate contract.
