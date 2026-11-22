# Spec: Terminology reach (#2799)

**Status:** proposed (phase 1). IDs `FR-TR-###`, `NFR-TR-###`, `AC-TR-###`. Plan: `docs/plans/2026-11-22-terminology-reach.md`. Executor: four Orca builder slices (A keys and guard, B screens, C server-side text, D prints). No money, approval or access change; no per-feature switch. Rule source: `docs/decisions.md` OD-SCOPE-13 (renameable terms grow to about 20, plus the 28 role names; PMO's general word is the default). Builds on shipped #2529 (terms), #2712 (expansion, role names) and #2744/1491 (key table).

## Job story

When my organisation renames one of the general terms, I want my word everywhere the term appears, in both languages: screens, emails, in-app notifications, printed documents, and wherever a role name is shown, so that nobody meets the old word beside the new one.

## How it works today (verified 2026-11-22 against the base, file and line)

- **Key table.** `supabase/migrations/1491_org_term_keys_registry.sql:14-24`: `org_term_keys(term_key text primary key)`, RLS forced, no policy, no client grant; `org_terminology.term_key` references it (`:26-29`). Today 16 keys. Adding a key is one insert; the closing assertion at `:35-47` hard-codes `count(*) <> 16`, so a later migration must not edit 1491 and the 16 stays a historical assertion. Rollback `rollback/1491_org_term_keys_registry_down.sql` restores the old CHECK.
- **Front-end term list.** `pmo-portal/src/lib/i18n/orgTerms.ts:3-9` (`TERM_KEYS`), `:19-52` (`SHIPPED_FORMS`: the surface forms the rewriter replaces, per language), `:60-62` (`TERM_SCOPE`: a term whose word is also ordinary prose is rewritten only inside named namespaces), `:73` (`applyOrgTerms`: whole-word, case-insensitive, plural before singular), `:134-146` (`withOrgTerms`, `withEnglishOrgTerms`), `:149-161` (`rowsToOrgTerms`: drops a key not in `TERM_KEYS`).
- **The rename reaches a screen by rewriting the text, not by a key lookup.** `src/lib/i18n/index.ts:67-80` (`orgTermsPlugin`) rewrites every i18next translation (default values included) whose text contains a shipped form. So a string reaches the rename only if its wording is one of the shipped forms for that term. This is the whole mechanism for slices A and B.
- **Load and refresh.** `src/hooks/useOrgTerminology.ts:19-35` loads once, then `changeLanguage` re-renders; `src/lib/db/orgTerminology.ts:12-17` reads with `.limit(50)` (the comment says 17 terms x 2 languages). **39 terms x 2 languages = 78 rows: the bound must rise or the 18th row onwards is silently not read** (found while verifying; slice A).
- **Admin screen.** `pages/AdministrationTerminology.tsx` lists `TERM_KEYS`; the default shown comes from `shippedTerm()` (the registry), never from `t()`. Role names: `pages/AdministrationRoleNames.tsx`, `src/hooks/useOrgRoleNames.ts` (module store + `useBuiltInRoleName`), `src/auth/builtInRoles.ts` (28 roles, `nameEn`/`nameId`), table `org_role_names` (`1231_org_role_names.sql`).
- **Existing code-side guard.** `scripts/check-org-terms.mjs` (wired as `check:org-terms`, with `--self-test`, `package.json:37,44`) forbids a literal term in **TS/TSX source** and mirrors the English patterns in its own `TERM_PATTERNS` (a second copy of the list). It does not read locale files.
- **In-app notifications.** The database stores a fixed English title and a free English body (`notify_workflow_user`, latest definition `1224_notify_workflow_user_carry.sql:8`; leave results `1611`). The bell translates the title through `notificationTitles.ts`/`notificationCopy.ts` into catalogue strings, so a title shown via `t()` is rewritten; a stored **body** shown as stored (`message_key` null or `literal`, `notificationCopy.ts:30-33`) is not.
- **Emails.** `supabase/functions/email-notify/templates.ts` localises only the lead and footer line; the **title and body are the stored English text**, sent as is. `claim_email_outbox` (latest `1227_scheduled_report_tick.sql:58`) returns `locale`, `title`, `body`, not the org. Edge functions already import pure modules from `pmo-portal/src` (e.g. `adapter-dispatch/*`), so a shared pure rewriter is a precedent, not a new pattern.
- **Prints.** `pages/DeliveryNotePrint.tsx`, `PurchaseOrderPrint.tsx`, `stock/StockTransferPrint.tsx` and `src/components/print/*` render through `t()`, so they are rewritten like screens; `DeliveryNotePrint.tsx:83` additionally wraps the title in `withOrgTerms` (double rewrite, harmless).
- **Role names.** Used in Administration > Users, the leave form (`leave/LeaveRequestForm.tsx:40`) and document categories. **Not used** where an approval step owner is shown: `MaterialRequestDetail.tsx:76` builds `${open.label} · ${open.role}` from the raw base role; `MaterialRequestSettings.tsx:50` lists raw base roles. No stored notification text embeds a role name (checked: the literals of all 78 notification call sites in migrations, plus the 5 base-role words).

### Findings that change the work

1. **The key with no matching screen text is `clientSuppliedStock`: 0 values in en, 0 in id.** The screens say "client-supplied item(s)" (3 en values, in common/stock text) and Bahasa has no "stok titipan klien" at all (one stray "titipan"). Renaming it today changes nothing. Fix: align the shipped form to the words the screens use, or add the term to the screens (see Q1).
2. **English "imprest" is the shipped form, but screens say "site cash"**: en `imprest` 1 value vs "site cash" 54 values (5 namespaces). A rename of the term reaches 1 of 55 places in English. Bahasa is consistent ("kas lapangan", 57). Fix: the English shipped form becomes "site cash".
3. **Bahasa "perintah kerja" (14 values, 3 namespaces: refusals, crews, equipment) spells out the long form of work order**; `SHIPPED_FORMS.id.workOrder` has "work order", "SPK" only, so those 14 never rename. Fix: add the long form to the shipped list (or rewrite the strings), and the guard keeps it so.
4. **`dailyRevenue` en "day revenue" appears once; "daily revenue" 3, id "pendapatan harian" 3** are spellings the shipped form misses.
5. **The word-match rewriter is unsafe for common words.** "issue" (verb: "issue an invoice", "issued"), "reserved", "crew", "milestone", "checkpoint", "project" are ordinary prose. New ambiguous terms use `TERM_SCOPE` (namespace-scoped) and a precise shipped form; "issue" needs both. "Work order transfer" contains "work order": the longest-match-first ordering already in `applyOrgTerms` must place it before `workOrder`.

### Measured table (scratch script, not committed)

Counts are string **values** in `pmo-portal/public/locales/{en,id}/*.json` matching the candidate shipped forms below, shown as values / namespaces (64 namespaces per language). DB literal counts are string literals in the 78 `notify_workflow_user`/`insert into notifications` call sites across 33 migrations (windowed scan, approximate); edge-function and print counts are quoted literals in `email-notify`, `telegram-notify`, `_shared/erpFeedNotifications.ts`, `agent-chat` and the print components. Candidate forms for new terms are the wording the screens use today (below the table); slice A confirms each against the rendered text.

| Term key | State | en values / namespaces | id values / namespaces | DB notification literals | Edge-function literals | Print literals |
|---|---|---|---|---|---|---|
| workOrder | existing | 329 / 30 | 8 / 5 | 2 | 8 | 2 |
| project | existing | 1023 / 48 | 1021 / 46 | 13 | 57 | 4 |
| clientSuppliedStock | existing | 0 / 0 | 0 / 0 | 0 | 0 | 0 |
| purchaseRequest | existing | 28 / 8 | 23 / 9 | 0 | 0 | 0 |
| discipline | existing | 52 / 8 | 53 / 8 | 0 | 0 | 0 |
| materialRequest | existing | 23 / 6 | 25 / 7 | 4 | 0 | 0 |
| billOfQuantities | existing | 23 / 3 | 27 / 3 | 0 | 0 | 0 |
| contractItem | existing | 6 / 3 | 3 / 3 | 0 | 0 | 0 |
| dailyRevenue | existing | 1 / 1 | 1 / 1 | 0 | 0 | 0 |
| acceptedQuantity | existing | 18 / 4 | 25 / 6 | 0 | 0 | 0 |
| costVariation | existing | 6 / 1 | 6 / 1 | 0 | 0 | 0 |
| deliveryNote | existing | 14 / 4 | 16 / 5 | 0 | 0 | 2 |
| stockCount | existing | 2 / 1 | 1 / 1 | 0 | 0 | 0 |
| imprest | existing | 1 / 1 | 57 / 6 | 10 | 6 | 0 |
| standIn | existing | 9 / 2 | 15 / 5 | 0 | 0 | 0 |
| progressClaim | existing | 9 / 3 | 7 / 2 | 3 | 0 | 0 |
| serviceRequest | new | 0 / 0 | 0 / 0 | 0 | 0 | 0 |
| purchaseOrder | new | 67 / 13 | 62 / 13 | 0 | 1 | 4 |
| dailySiteReport | new | 23 / 9 | 24 / 10 | 1 | 0 | 0 |
| surveyQuantity | new | 0 / 0 | 0 / 0 | 0 | 0 | 0 |
| quantityChangeRequest | new | 15 / 2 | 15 / 2 | 10 | 0 | 0 |
| workOrderTransfer | new | 8 / 2 | 1 / 1 | 0 | 0 | 0 |
| billingPlan | new | 3 / 1 | 3 / 1 | 0 | 0 | 0 |
| billingStep | new | 9 / 5 | 13 / 5 | 3 | 1 | 0 |
| handoverCertificate | new | 3 / 2 | 4 / 2 | 0 | 0 | 0 |
| stockTransfer | new | 0 / 0 | 0 / 0 | 0 | 0 | 0 |
| stockReceipt | new | 20 / 7 | 25 / 8 | 0 | 1 | 0 |
| stockReturn | new | 0 / 0 | 0 / 0 | 0 | 0 | 0 |
| reservation | new | 49 / 7 | 17 / 3 | 2 | 0 | 0 |
| crew | new | 132 / 11 | 140 / 11 | 3 | 0 | 0 |
| roster | new | 19 / 5 | 1 / 1 | 0 | 0 | 0 |
| issue | new | 79 / 16 | 32 / 8 | 1 | 1 | 0 |
| checkpoint | new | 17 / 3 | 0 / 0 | 4 | 0 | 0 |
| milestone | new | 7 / 4 | 7 / 4 | 0 | 20 | 0 |
| dailyTarget | new | 5 / 1 | 4 / 1 | 0 | 0 | 0 |
| rootCause | new | 5 / 1 | 5 / 1 | 0 | 0 | 0 |
| safetyRecordType | new | 55 / 6 | 53 / 6 | 0 | 8 | 0 |
| candidateWorkOrder | new | 28 / 4 | 28 / 4 | 0 | 2 | 0 |
| closeOut | new | 6 / 2 | 21 / 8 | 0 | 0 | 0 |

Candidate shipped forms for new terms (en | id): serviceRequest "service request" | "permintaan layanan" (**0 hits both: no screen uses it; see Q2**) · purchaseOrder "purchase order" | "purchase order" · dailySiteReport "daily site report", "daily report", "site report" | "laporan harian", "laporan harian lapangan" · surveyQuantity "survey quantity" | "kuantitas survei" (**0 hits**) · quantityChangeRequest "quantity change request" | "permintaan perubahan kuantitas" · workOrderTransfer "work-order transfer", "transfer between work orders" | "transfer antar work order" · billingPlan "billing plan" | "rencana penagihan" · billingStep "billing step" | "langkah penagihan", "tahap penagihan" · handoverCertificate "handover confirmation" | "konfirmasi serah terima" · stockTransfer "stock transfer" | "transfer stok" (**0 hits; screens say "transfer"**) · stockReceipt "goods receipt", "stock receipt" | "penerimaan barang" · stockReturn "stock return" | "pengembalian stok" (**0 hits**) · reservation "reservation" | "reservasi" · crew "crew" | "kru", "regu", "crew" (**Bahasa mixes three words, 140 values**) · roster "roster" | "roster" · issue "issue" | "isu", "masalah" (**two words in Bahasa**) · checkpoint "checkpoint" | none (**id 0: Bahasa keeps no catalogue word**) · milestone "milestone" | "milestone", "tonggak" · dailyTarget "daily target" | "target harian" · rootCause "root cause" | "akar masalah" · safetyRecordType "incident", "near miss", "toolbox talk", "safety record" | "insiden", "nyaris celaka", "catatan keselamatan" · candidateWorkOrder "candidate work order" | "kandidat" · closeOut "close-out" | "penutupan", "closeout".

Reading the table: five of the 23 new keys have no matching text in one or both languages (serviceRequest, surveyQuantity, stockTransfer, stockReturn, checkpoint-id), seven are common prose words that need scoping (issue, crew, reservation, milestone, roster, checkpoint, candidate), and server-side producers that embed a term are few: 1 to 10 literals per term in the DB, 10 terms in edge functions and the agent surface, 3 in prints.

## Requirements (EARS)

- **FR-TR-001** The system shall hold one registry of renameable terms (key, shipped English forms, shipped Bahasa forms, optional namespace scope) as a single data file read by the front-end rewriter, the guard, the edge-function rewriter and the registry-versus-database test.
- **FR-TR-002** When migration 1903 applies, `org_term_keys` shall hold the 16 existing keys plus the new ones agreed in Q3, and no `org_terminology` row shall change.
- **FR-TR-003** When an Admin saves a rename for any registry key in either language, the Administration terminology screen shall list it with its shipped default and accept it; the read of overrides shall not be capped below the registry size times two.
- **FR-TR-004** Every user-visible catalogue string that names a renameable term shall use one of that term's shipped forms in its language, so the rewriter reaches it.
- **FR-TR-005** When a term is renamed, every Bahasa and English catalogue string for it shall render the organisation's word, including strings that today spell the term another way (the findings above).
- **FR-TR-006** When the database stores a notification body that names a renameable term, the bell shall show it through the rewriter in the reader's language.
- **FR-TR-007** When an email is sent, the edge function shall rewrite the title and body with the recipient organisation's overrides in the email's locale, and shall name roles by the organisation's role names.
- **FR-TR-008** The system shall expose one database lookup of an organisation's overrides (terms and role names, both languages) for every server-side text producer; no producer shall copy the term list.
- **FR-TR-009** When a printed document renders, its title, column labels and signature-block role names shall come from the rewritten catalogue and the organisation's role names.
- **FR-TR-010** Where an approval step owner, step recipient or step list shows a role, it shall show the organisation's name for it (built-in role key resolved through `useBuiltInRoleName`), never the raw base-role word.
- **FR-TR-011** The guard shall fail when a locale file holds a literal spelling of a renameable term that is not one of the term's shipped forms (rule R1), when a registry key has no matching text in a language (R2), and when a registry key is missing from `TERM_KEYS`, the database seed, or the Administration list (R3).
- **FR-TR-012** The guard's allowlist shall need a non-empty `reason` per entry and shall fail on a stale entry (one that no longer matches a value).
- **NFR-TR-001** No customer word in code, test names or fixtures; the default word is always PMO's general one.
- **NFR-TR-002** No refusal text is added unless a new code is introduced; any new code ships English and Bahasa in `src/lib/refusals.ts`.

## Acceptance criteria (Given/When/Then, owning layer)

| ID | Given / When / Then | Layer |
|---|---|---|
| AC-TR-001 | Given migration 1903 applied / when the key table is read as the service role / then it holds exactly the registry's keys | pgTAP (`supabase/tests/1903_org_term_keys_reach.test.sql`) |
| AC-TR-002 | Given the registry file / then `TERM_KEYS` equals its keys and every key has at least one shipped form in en and id | Vitest (`orgTerms.registry.test.ts`) |
| AC-TR-003 | Given the registry and migration 1903 / then the registry's key set equals the keys inserted by 1491 plus 1903 | Vitest reading the migrations (guard-style, no database) |
| AC-TR-004 | Given an Admin renames a term in Bahasa / when a screen with the long spelling ("perintah kerja") renders / then it shows the new word | Vitest (`orgTerms.i18next.test.ts`) |
| AC-TR-005 | Given 40 saved overrides / when the overrides are read / then all are returned (no cap at 50 rows hiding any) | Vitest (`orgTerminology.test.ts`, mocked client asserts no limit below 200) |
| AC-TR-006 | Given a renamed term / when the bell shows a stored English body naming it / then the reader sees the organisation's word in their language | Vitest (`NotificationBell` test) |
| AC-TR-007 | Given org overrides and role names / when `renderEmail` runs with them / then subject, text and html carry the renamed term and role name and the locale's lead line | Deno (`email-notify/index.test.ts`, real handler, mocked fetch) |
| AC-TR-008 | Given the lookup function / when called for an org with one override and one role rename / then it returns both in both languages and nothing for another org | pgTAP (`1904_org_naming_lookup.test.sql`) |
| AC-TR-009 | Given a material request with an open step / when the detail renders under a renamed role / then the step owner shows the renamed role | Vitest (`MaterialRequestDetail` test) |
| AC-TR-010 | Given a renamed term and role / when a delivery note, purchase order and stock transfer print render / then title, labels and signature roles show the new words | Vitest (each print test) |
| AC-TR-011 | Given a locale file value with a non-shipped spelling / when the guard runs / then it exits non-zero naming file, key and term; the same value with an allowlist entry passes; an entry without a reason or no longer matching fails | guard `--self-test` (Node) |
| AC-TR-012 | Given the shipped catalogues / then the guard exits 0 with the allowlist as committed | `check:guards` |

## The guard (`scripts/check-locale-terms.mjs`, `npm run check:locale-terms`)

Reads the registry file and every `pmo-portal/public/locales/{en,id}/*.json` leaf string.
- **R1 (variant spelling):** a value matching a term's *known variant* list (spellings the registry marks `variants`, e.g. "perintah kerja" and "site cash" before the fix) and not one of its shipped forms fails. The check is whole-word, case-insensitive.
- **R2 (dead key):** a registry key whose shipped forms match no value in a language fails (this is how `clientSuppliedStock` is caught). A key may be allowlisted only with a reason (for example, a term not yet on any screen).
- **R3 (agreement):** registry keys = `TERM_KEYS` = keys seeded by migrations 1491 + later = what the Admin screen lists.
- **Allowlist** `scripts/locale-terms-allowlist.json`: entries `{ file, key, rule, term, reason }`; empty `reason` fails; an entry that no longer matches any value fails as stale (same polarity as the other ratchets).
- **`--self-test`:** builds fixtures in memory for each rule (violation, allowlisted, stale, empty reason) and asserts exit codes. Wired as `check:locale-terms` = guard + `--self-test` and added to `check:guards` after `check:org-terms`.
- It also replaces the English `TERM_PATTERNS` copy inside `check-org-terms.mjs` with the registry, so the list exists once (the older guard keeps its baseline file).

## How server-side text gets the renamed term

1. **One SQL lookup (migration 1904):** `public.org_naming(p_org uuid) returns jsonb`, `stable`, `security definer`, `set search_path = public, pg_temp`, executable by `service_role` only (the email function and server producers use it; no client path, since clients already read the two tables under RLS). It returns `{ terms: { en: { key: { singular, plural } }, id: {...} }, roles: { en: { roleKey: name }, id: {...} } }`, with role names falling back to `built_in_roles.name_en/name_id`. Plus `public.org_term(p_org uuid, p_key text, p_locale text, p_plural boolean default false) returns text` built on it for SQL producers that must name a term themselves; it returns null when the org has no override, so the producer keeps its PMO general word. A restated function (none today) would be copied from its highest-numbered definition; `claim_email_outbox` is *not* restated: the edge function looks the org up by recipient (see 2).
2. **Edge functions:** `email-notify` fetches `org_naming` once per distinct org in a batch and rewrites title and body with the shared pure `applyOrgTerms` (imported from `pmo-portal/src/lib/i18n/orgTerms.ts`, the registry file with it), in the email's locale. This needs the org on the claimed row: **either** `claim_email_outbox` returns `org_id` (a restated function, 1905, from the 1227 definition), **or** the function joins by outbox id. Decision in Q4. `telegram-notify`, `agent-chat` and `_shared/erpFeedNotifications.ts` call the same helper; none keeps its own list.
3. **Stored notification text stays English and neutral.** The database never bakes a renamed word into a stored row (a later rename would leave it stale). The rewrite happens at read time: the bell (`notificationBody`) and the email sender.
4. **Prints** already render through `t()`; the work is the role-name signature lines and removing the double rewrite, plus tests that a renamed term and role reach the three print routes.

## Out of scope

Renaming roles' access, keys, `profiles.role` or enum values; a per-feature switch; translating stored English notification bodies into Bahasa (see Q5); any customer-specific word.

## Decisions (coordinator, 2026-11-22)

- **Q1** Align the shipped form to the screens: English "client-supplied item" (old "client-supplied stock" stays a secondary form); Bahasa "item pasokan klien" / "material pasokan klien" (old "stok titipan klien" secondary). Bahasa screens that say "Dipasok klien" / "Dari klien" are slice B's to align.
- **Q2** Ship the keys now; add the word to screens where one exists (slice B). Until then R2 allowlists the keys with no screen text, each with a reason that names the slice that removes it.
- **Q3** One key, `safetyRecordType`; its shipped forms are "safety record" / "catatan keselamatan" (incident, near miss and toolbox talk are separate concepts and are not folded into it).
- **Q4** Restate `claim_email_outbox` to return `org_id` (1905, slice C).
- **Q5** Rename only; translating stored English notification text is a separate question, not in this work.
- **Q6** The guard's R1 means a spelling the rewriter cannot reach.

Slice A deviations from the plan: `TERM_KEYS` stays a literal tuple (exhaustive typing) and is asserted equal to the registry by test and by guard rule R3; `check-org-terms.mjs` keeps its 16-term source-literal ratchet (extending it to the 39 terms would flag source literals and is a later, separate cleanup).

## Original questions (answered above)

- **Q1** `clientSuppliedStock`: align the shipped form to the screens' "client-supplied item", or add "stok titipan klien" to Bahasa screens? (Plan assumes: change the shipped forms to what screens say, per FR-TR-004.)
- **Q2** For new keys with no screen text (serviceRequest, surveyQuantity, stockReturn, stockTransfer, checkpoint-id): ship the key now (so a rename saves) and add the word to the screens in slice B, or hold the key until a feature uses it? Plan assumes ship and add the word where an existing screen names the thing.
- **Q3** Final key list: the issue lists 23 names; "safety record types" is one key or several (incident, near miss, toolbox talk)? "Roster" and "crew" are listed separately; plan assumes one key each, and safety record types as one key `safetyRecordType`.
- **Q4** Edge-function org lookup: restate `claim_email_outbox` to return `org_id`, or join in the function?
- **Q5** Emails show the stored English title/body even to Bahasa recipients today. Is translating them in scope? Plan says no (rename only).
- **Q6** Is the guard's R1 ("literal default word" = a spelling the rewriter cannot reach) the intended reading of the issue? A stricter reading (no default word at all in a locale file) would forbid the shipped words themselves and is impossible with a text-rewriting mechanism.
