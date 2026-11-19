# Organisation terminology (#2529, map #2516)

An org Admin renames a fixed set of PMO terms; every string shown through the i18n layer follows.

## Requirements (EARS)
- **FR-TERM-001** The system shall let an Admin set, per language (English, Bahasa Indonesia), a singular and plural display name for each of: work order, project, client-supplied stock, purchase request, discipline.
- **FR-TERM-002** While an org has an override for a term and language, every string rendered through i18next in that language shall show the override in place of the shipped wording, preserving the case shape (lower, Capitalised, Title Case, UPPER).
- **FR-TERM-003** The system shall apply the same rewrite to exports and notifications that build text through i18next, and expose `withOrgTerms` for text built outside it.
- **FR-TERM-004** Where a term is not in the fixed set, it shall stay in code and not be overridable.
- **FR-TERM-005** The write path shall be Admin-only and org-scoped, enforced by RLS; every member may read.
- **FR-TERM-006** The repository shall fail CI when UI source hard-codes an overridable term outside `t()`, with a shrink-only baseline for existing hits.

## Acceptance criteria
- **AC-TERM-001** (pgTAP, `0975_org_terminology_rls.test.sql`) Given an org-A Admin, Engineer and a cross-org Admin, When each reads/writes, Then only the Admin writes, members read own-org rows, the other org sees nothing, and only the five terms are accepted.
- **AC-TERM-002** (unit, `orgTerms.test.ts`) Given an override, When text with the shipped wording is rewritten, Then singular/plural/case are right in both languages and partial words are untouched.
- **AC-TERM-003** (unit, `orgTerms.i18next.test.ts`) Given overrides in both languages, When `t()` runs, Then output uses each language's override.
- **AC-TERM-004** (unit, `AdministrationTerminology.test.tsx`) Given the settings screen, When the Admin edits and saves or resets a row, Then the save/reset call carries the term, language and wording.
- **AC-TERM-005** (guard, `scripts/check-org-terms.mjs --self-test` + repo run) Planted hard-coded terms are caught; `t()` defaults are not; baseline growth and staleness fail.

## Design notes
Catalogues keep the shipped wording; the `orgTerms` i18next post-processor rewrites at output time, so no catalogue is edited per org and no string needs a rewrite to opt in. Overrides are loaded once per session (`useApplyOrgTerminology`) and applied with a same-language `changeLanguage` to re-render subscribers. Known limit: a term that is a substring of another phrase ("project manager") is renamed too, by design; an org can reset a row.
