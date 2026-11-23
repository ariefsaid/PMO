# Plan: terminology reach (#2799)

Spec `docs/specs/terminology-reach.spec.md`. Migrations 1903-1905 only. Four builder slices, split by surface so the file lists never overlap. Each task: failing test first (owner in the spec's AC table), then the change. Local gate per slice: `npm run check:guards`, `npm run typecheck`, `npx eslint --max-warnings=0 <touched files>`, `npx vitest related --run <touched files>`; DB files are written and left for the orchestrator's one run. Decisions Q1-Q6 in the spec gate slice A's key list; the dependency table below says what each slice may do before A lands.

## Slice A: keys and guard (lands first)

Owns the registry, the key list, the guard. Tasks:
1. `pmo-portal/src/lib/i18n/terms.registry.json` (new): the one list (key, `en`/`id` shipped forms, optional `scope` namespaces, `variants`). Move today's 16 entries in verbatim, apply spec findings 1-4 (clientSuppliedStock forms to the screens' wording; en imprest "site cash"; id workOrder + "perintah kerja"; dailyRevenue spellings), add the new keys with the spec's candidate forms and `scope` for the common-word terms (issue, crew, reservation, milestone, roster, checkpoint, candidateWorkOrder).
2. `pmo-portal/src/lib/i18n/orgTerms.ts`: `TERM_KEYS`, `SHIPPED_FORMS`, `TERM_SCOPE` become derived from the registry (no behaviour change for existing keys beyond findings 1-4); `orgTerms.test.ts`, `orgTermsExpansion.test.ts`, `orgTerms.i18next.test.ts`, new `orgTerms.registry.test.ts` (AC-TR-002, AC-TR-003, AC-TR-004).
3. `pmo-portal/src/lib/db/orgTerminology.ts` (+ `.test.ts`): raise the `.limit(50)` to a bound that covers registry size x 2 (AC-TR-005); `pmo-portal/pages/AdministrationTerminology.tsx` (+ test) lists the new keys, grouped, with defaults from the registry; `public/locales/{en,id}/administration.json` labels for the new keys.
4. `supabase/migrations/1903_org_term_keys_reach.sql` + `supabase/migrations/rollback/1903_org_term_keys_reach_down.sql` (delete the new keys; refuse if an `org_terminology` row uses one): one insert into `org_term_keys`, closing assertion on the new total; `supabase/tests/1903_org_term_keys_reach.test.sql` (AC-TR-001); update `pmo-portal/src/lib/supabase/database.types.ts` only if the generator output changes (none expected: no column change).
5. `scripts/check-locale-terms.mjs`, `scripts/locale-terms-allowlist.json`, `--self-test` (AC-TR-011, AC-TR-012); `pmo-portal/package.json`: add `check:locale-terms` ("node ../scripts/check-locale-terms.mjs && node ../scripts/check-locale-terms.mjs --self-test") and insert it into `check:guards` after `check:org-terms`; `scripts/check-org-terms.mjs` reads its patterns from the registry.
Files touched: the six paths above plus `scripts/i18n-same-as-english-allowlist.json` only if a new Bahasa catalogue label equals English.

## Slice B: screens, en and id (after A's registry; strings first)

Owns `pmo-portal/public/locales/{en,id}/*.json` (every namespace except `administration.json`, which A owns), and the screen files that build term text outside i18next or show a raw role.
1. Locale strings: bring each value to a shipped form (spec findings 1-5): Bahasa "perintah kerja" in `refusals`, `crews`, `equipment`; "site cash" in English values per the registry; `crew` kru/regu/crew to one word per the registry; `issue` isu/masalah; the new-term words where a screen names the thing but not in a shipped form. The guard's allowlist (A's file) takes any entry that must stay, each with a reason; B proposes entries to A's owner in its report, it does not edit the allowlist file in parallel (the Director merges).
2. Role names on screens: `pages/MaterialRequestDetail.tsx` (step line, AC-TR-009), `pages/MaterialRequestSettings.tsx` (role select labels), `pages/admin/LeaveRequestsSetting.tsx`, `pages/leave/LeaveSettings.tsx`, `pages/leave/LeaveRequestList.tsx`, `src/lib/db/billingStages.ts`/`billingBoard.ts`/`billingSteps.ts` display call sites: use `useBuiltInRoleName`/`useRoleLabels`. Tests beside each.
3. Remove duplicate rewrites: grep `withOrgTerms(` call sites where the input already comes from `t()`; keep the ones for non-i18next strings (exports).
Collision rule: B edits no `.ts` under `src/lib/i18n/`, no migration, no `supabase/functions`, no `*Print*`.

## Slice C: server-side text (needs A's registry for the shared rewriter; the SQL part is independent)

1. `supabase/migrations/1904_org_naming_lookup.sql` + rollback + `supabase/tests/1904_org_naming_lookup.test.sql` (AC-TR-008): `org_naming(p_org)` and `org_term(p_org, key, locale, plural)` per the spec, service-role execute only; `supabase/tests/` isolation and anon-definer inventory entries as the repo's guards require (`check:anon-definer-inventory`).
2. Only if Q4 = restate: `supabase/migrations/1905_email_outbox_claim_org.sql` + rollback, restating `claim_email_outbox` from the **1227** definition with `org_id` added (changes the return type: drop and create, keeping the revoke/grant lines of 1222/1227); `check:restated-functions` must pass. Otherwise 1905 stays unused.
3. `supabase/functions/email-notify/index.ts`, `templates.ts`, `index.test.ts` (AC-TR-007): per-org `org_naming` read, shared rewriter, renamed role names in text. Imports the pure rewriter from `pmo-portal/src/lib/i18n/orgTerms.ts` and the registry.
4. `supabase/functions/telegram-notify/logic.ts` (+ test), `supabase/functions/_shared/erpFeedNotifications.ts` (+ test): the same helper where they build text; `supabase/functions/agent-chat/*` only the prompt term mentions if A's registry exposes them (agent prompts are an LLM surface: leave them unchanged and note it if the eval harness is needed; ADR-0050/0052 apply).
5. `pmo-portal/src/lib/i18n/notificationCopy.ts` (+ `notificationCopy.test.ts`) and `pmo-portal/src/components/shell/NotificationBell.tsx` (+ test): stored English bodies go through `withOrgTerms` in the reader's language (AC-TR-006).
Collision rule: C edits no locale JSON, no `pages/**`, no print files. `notificationCopy.ts` is in C only.

## Slice D: prints (after A; small)

1. `pmo-portal/pages/DeliveryNotePrint.tsx`, `PurchaseOrderPrint.tsx`, `pages/stock/StockTransferPrint.tsx`, `src/components/print/PrintSignatureBlocks.tsx`, `PrintDocument.tsx`, `PrintTable.tsx` and their tests: remove the double rewrite in `DeliveryNotePrint.tsx:83`, show signature-block roles through `useBuiltInRoleName`, and assert a renamed term and role reach all three routes (AC-TR-010). Other print surfaces found by the Slice B grep are added only by the Director.
2. Print locale strings are B's (`stock.json`, `procurement*.json`, `myHome.json`); D lists any string it needs changed instead of editing it.

## Dependencies and what each slice can do before A lands

| Slice | Needs from A | Can do before A |
|---|---|---|
| B | the registry's shipped forms (to know what to write) | Findings 3 and 5 (Bahasa "perintah kerja", crew, issue wording) against today's `SHIPPED_FORMS`; role-name call sites; no test depends on a new key |
| C | the registry file (for the shared rewriter import) | `1904` lookup + pgTAP, bell body rewrite using today's `withOrgTerms`, the email-notify tests with today's keys |
| D | nothing hard | everything: role names in signature blocks, the double-rewrite removal, tests with today's keys; new-term assertions wait |

Merge order: A, then B/C/D in any order (disjoint files). The orchestrator runs the pgTAP files (1903, 1904, and `check:restated-functions` for 1905 if used) once per wave.
