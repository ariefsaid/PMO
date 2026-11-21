# Terminology expansion: 16 renameable terms and 28 role names

Ticket #2712 (map #2516). Status: Approved by the Director 2026-11-21 (rulings 1-5 applied), built. Rulings: OD-SCOPE-13, OD-SCOPE-2, OD-SCOPE-3.
Extends `org-terminology.spec.md` (#2529). No second mechanism: same table, same i18next adapter, same Administration screen, same guard.

**Job story.** When a client calls things by its own words, I want to rename PMO's terms once, so every screen, export and notification uses them.

## 1. Design

- **Terms.** `TERM_KEYS` grows from 6 to 16. The `org_terminology.term_key` check is widened (migration 1230). `SHIPPED_FORMS` (`orgTerms.ts`), the guard's `TERM_PATTERNS` (`check-org-terms.mjs`) and the SQL check list are three mirrors of one list (plus the scope table below); a test fails if they differ.
- **Role names.** New table `org_role_names (org_id, role_key -> built_in_roles(key), locale, name)`, one row per (org, role, language), Admin-write, member-read (migration 1231). Absence = the catalogue default (`built_in_roles.name_en/name_id`, `BUILT_IN_ROLES`). One pure resolver `builtInRoleName(role, locale, overrides)` in `builtInRoles.ts`; the role picker (Edit role form), Users directory and any other place that prints a built-in role name use it. Display only: keys, `profiles.role`, enum values and stored data never change.
- **Not covered.** The five base access levels' display names (the existing mechanism does not cover them; they are not renameable here). Role names do not pass through i18next, so they are not rewritten inside free text; they are resolved where a role name is rendered.
- **Reach.** Terms: everything that renders through i18next (screens, exports and notifications built through it) and `withOrgTerms` for text built outside it, as today (FR-TERM-003). Role names: every screen that renders a role name through the resolver; no notification or export carries a role name today, so none is changed.

## 2. Term table (10 new terms; the existing six are unchanged)

"Used in" names where the concept shows on `dev`. Default = PMO's general word as shipped today, so an org without overrides sees no change. Bahasa default = the shipped catalogue wording.

| Key | Used in | English default (sing / plural) | Bahasa default |
|---|---|---|---|
| `billOfQuantities` | project billing tab, claim form, contract quantities | bill of quantities / bill of quantities | bill of quantities |
| `contractItem` | site report progress line, billing reconciliation | contract item / contract items | item kontrak |
| `dailyRevenue` | site report revenue block ("Day revenue") | day revenue / day revenue | pendapatan hari itu |
| `acceptedQuantity` | work-order acceptance, billing cascade, claims | accepted quantity / accepted quantities | kuantitas yang diterima |
| `costVariation` | subcontract variations, work-order link | cost variation / cost variations | variasi biaya |
| `deliveryNote` | procurement record capture, sales invoice | delivery note / delivery notes | surat jalan |
| `stockCount` | stock movement kinds | stock count / stock counts | stok opname |
| `imprest` | plan feature, imprest module | imprest / imprests | kas lapangan |
| `standIn` | material-request approval settings | stand-in / stand-ins | pengganti |
| `progressClaim` | billing claims, history | progress claim / progress claims | klaim progres |

Existing six: work order, project, client-supplied stock, purchase request, discipline, material request. Total 16.

**Scope decisions (Director ruling 1: a default word that also appears in unrelated sentences is scoped or dropped).**
The mechanism can scope: the i18next plugin knows each string's namespace, and `TERM_SCOPE` (orgTerms.ts) limits a term to named namespaces. Text built outside i18next has no namespace, so a scoped term is never applied there.
- `progressAssessment`: **dropped** (bare "assessment"/"penilaian" appears in unrelated text).
- `standIn`: **kept, scoped** to the `materialRequests` namespace (the only place the concept shows; Bahasa "pengganti" also means any replacement and appears in finance and notification text, which stays unchanged).
- The other nine: **kept, unscoped**, each a multi-word or domain-specific phrase checked against both catalogues (a count of hits is in the plan): bill of quantities, contract item, day revenue, accepted quantity, cost variation, delivery note, stock count, imprest (Bahasa "kas lapangan" appears only in the plan and imprest catalogues), progress claim.

**Candidates skipped (concept not on `dev`, or no shipped wording to rewrite):** service request (no such record); work-order plan (only plan-versus-actual exists, shown as "Plan vs actual", no "work-order plan" wording); measured quantity (shown only as the word "Measured"/"Assessed" in column headers; a bare word, so not renameable safely, see `progressAssessment` above); quantity change request (the shipped concept is a cost variation, carried by `costVariation`); transfer between work orders (reservations and borrowing are not on `dev`; "transfer" today is a stock movement kind, too generic a word to rename safely); acceptance (BAST) as a bare word (collides with "acceptance criteria" and legal text; covered by `acceptedQuantity`).

## 3. Requirements (EARS)

- **FR-TX-001** The system shall let an Admin set, per language, a singular and plural name for each of the 16 terms in section 2 through the existing Administration > Terminology screen.
- **FR-TX-002** While no override exists for a term, every screen, export and notification shall show exactly today's words.
- **FR-TX-003** The SQL `term_key` check, `TERM_KEYS`/`SHIPPED_FORMS`, and the guard's `TERM_PATTERNS` shall list the same 16 keys.
- **FR-TX-004** The system shall let an Admin set, per language, a display name for each of the 28 built-in role keys; an unknown key, a blank name or a name over 60 characters shall be refused by the database.
- **FR-TX-005** While a role has no override for the viewer's language, the system shall show the catalogue default name (English or Bahasa).
- **FR-TX-006** When an override exists, the Edit role form, the Users directory and every other place that prints a built-in role name shall show it; the stored key, `profiles.role` and enum values are unchanged.
- **FR-TX-007** The write path for role names shall be Admin-only and org-scoped, enforced by RLS; every active member of the org may read; another org sees nothing; `org_id` is stamped by trigger.
- **FR-TX-008** The Terminology screen shall offer a "Role names" section listing the 28 roles with default names, editable and resettable per language, in English and Bahasa, usable at phone width.
- **FR-TX-009** The guard `check-org-terms` shall catch a hard-coded shipped wording of each new term and keep its shrink-only baseline.
- **NFR-TX-001** Existing tests stay untouched and green; existing repositories gain no methods (new standalone module `orgRoleNames`).

## 4. Acceptance criteria and owning layer

| ID | Given / When / Then | Owner |
|---|---|---|
| AC-TX-001 | Given an org Admin, Engineer and a cross-org Admin, When each writes `org_terminology` for each of the 16 keys, Then only the Admin writes, a 17th key is refused, members read own-org rows. | pgTAP `1230_terminology_expansion.test.sql` |
| AC-TX-002 | Given the three lists (SQL migration text, `TERM_KEYS`, guard patterns), Then they are the same 16 keys. | vitest |
| AC-TX-003 | Given an override of each new term in both languages, When text with the shipped wording is rewritten through `t()`, Then singular, plural and case are right and partial words are untouched; with no override the text is unchanged. | vitest (`orgTerms.test.ts` additions in a new file `orgTermsExpansion.test.ts`) |
| AC-TX-004 | Given the Terminology screen, Then 16 term cards render with defaults in both languages; save/reset carry key, language and wording. | vitest |
| AC-TX-005 | Given an Admin, Engineer, cross-org Admin and a non-member, When each reads/writes `org_role_names`, Then only the Admin writes, members read own-org rows, others see nothing; blank, 61-character and unknown-key and unknown-language writes are refused; `org_id` cannot be forged. | pgTAP `1231_org_role_names.test.sql` |
| AC-TX-006 | Given a stored override and none, When `builtInRoleName` resolves, Then the override wins per language, the other language and unlisted roles keep the catalogue default, a NULL/unknown key resolves to nothing. | vitest |
| AC-TX-007 | Given an override, When the Edit role form, the Users directory and the role-change confirmations render, Then they show the override; with none they show today's names; the saved value is still the key. | vitest |
| AC-TX-008 | Given the Role names section, When the Admin edits, saves and resets a row, Then the DAL receives role key, language and name; over-length is blocked client-side; a non-Admin sees no controls. | vitest |
| AC-TX-009 | Given planted hard-coded wording of each new term, Then the guard flags it; `t()` defaults are not flagged. | guard `--self-test` |
| AC-TX-010 | Given an Admin renames a term and a role, When they visit two screens and the Users directory, Then the new words show and a user-entered name is unchanged. | e2e (serial lane; not run in this lane) |

Mutation notes (pgTAP, written not run): in 1230 drop one key from the widened check, AC-TX-001's 16-key loop goes red; in 1231 replace the Admin check with `true`, the non-Admin write assertions go red; drop the length check, the 61-character assertion goes red; drop the org clause, the cross-org assertions go red.

## 5. Settings the client controls

Every term and role name, both languages, on Administration > Terminology (Admin only). Nothing else is added; no organisation flag is needed because absence of a row is the unchanged default.

## 6. Not in this ticket

Renaming the five base access levels; renaming terms inside user-entered text; custom roles (Q1 2027).

## 7. Build notes

- Role-name overrides are held in a small module store loaded once per session (`useApplyOrgRoleNames`, mounted in `I18nProvider` beside the term overrides), so role-name readers need no query provider and show the catalogue defaults until the overrides load.
- Reach of role names: Edit role picker, Users directory, role-change confirmation dialogs (`UserForms`, `UserDirectory`, `AdminUsers`). The account menu prints the five base access levels, which are out of scope.
- Guard: ten patterns added. One new hit in existing code, `routeMatch.ts` ("Stock count" fallback label, replaced from its `i18nKey` at render), baselined 5 to 6.
- Tests written but not run in this lane: pgTAP `1230_terminology_expansion.test.sql`, `1231_org_role_names.test.sql`; e2e `serial/AC-TX-010-terminology-expansion.spec.ts`.
