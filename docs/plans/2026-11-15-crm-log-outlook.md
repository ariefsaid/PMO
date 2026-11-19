# CRM: log an Outlook email or meeting — implementation plan

> For agentic workers: Orca dispatch and TDD per `docs/orca-dispatch.md`. Planning artifact; do not build until the owner
> answers the questions at the end.

**Goal:** a user files a picked Outlook email or meeting as a CRM activity on a contact (manual; OD-CR-2).
**Spec:** `docs/specs/crm-log-outlook.spec.md`. **Architecture:** no new edge function and no RPC. Extend the existing
`graph_proxy` allowlist with Outlook GET paths gated by a new incremental-consent scope pair; add three nullable columns
and a unique index to `crm_activities`; a picker modal on the contact panel writes through the existing DAL and RLS.
**Ships alone? No** (no money, SoD or auth-model change), but the `graph_proxy` allowlist change is token-custody code:
**Opus builder, all three reviewers, security-auditor depth on `graphRead.ts`.**

## Migration (number on request)

`NNNN_crm_activity_outlook_ref.sql` + `rollback/NNNN_crm_activity_outlook_ref_down.sql`, number assigned on request
(highest on dev at spec time is `0882`; recheck `git ls-tree -r --name-only origin/dev supabase/migrations`).

```sql
alter table public.crm_activities
  add column source text not null default 'manual' check (source in ('manual','outlook')),
  add column external_id text check (external_id is null or length(external_id) <= 512),
  add column external_url text check (external_url is null or length(external_url) <= 2048),
  add constraint crm_activities_outlook_ref_ck
    check ((source = 'outlook') = (external_id is not null));
create unique index crm_activities_outlook_item_uidx
  on public.crm_activities (contact_id, external_id) where source = 'outlook';
```

RLS and the org stamp trigger are unchanged (new columns inherit table policies). Rollback drops the index, the
constraint, then the three columns. Regenerate `pmo-portal/src/lib/supabase/database.types.ts` after the migration.

## Tasks (2-5 minutes each, strict red then green)

Work in own worktree off `dev`; DB commands under `scripts/with-db-lock.sh`.

**T1 Migration + pgTAP.** Create the two SQL files above. Test `supabase/tests/crm_activity_outlook_ref.test.sql`:
unique index rejects the same item on one contact and allows another contact (AC-OUTL-010); cross-org and Viewer
inserts rejected (AC-OUTL-011); `source='outlook'` without `external_id` rejected.
Verify: `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/crm_activity_outlook_ref.test.sql'`.

**T2 Scope constants.** In `pmo-portal/src/lib/m365/graphPkce.ts` add
`export const M365_OUTLOOK_SCOPES = ['Mail.Read', 'Calendars.Read'];` Update `initiate.ts`: `parseInitiateBody` accepts
`outlook: true` (same strictness as `folders`), scopes = base + folder scopes if asked + outlook scopes if asked.
Test in `supabase/functions/m365-token-custody/` initiate test: default scopes unchanged; `outlook:true` adds exactly the
two; `outlook:"yes"` is 400 (AC-OUTL-002). Verify: `deno test supabase/functions/m365-token-custody/initiate*.test.ts`.
Also check `grantedScopes` in `callback.ts` keeps the new scopes only when requested and granted.

**T3 Proxy allowlist.** In `graphRead.ts` add `isOutlookPath(path)` (anchored regexes for `/me/messages`,
`/me/messages/{id}`, `/me/calendarView`, `/me/events/{id}`; single-segment ids as `isOneDrivePath` does) and extend
`scopeCoversPath` so the Outlook paths need `Mail.Read` (messages) or `Calendars.Read` (events) and GET only. Add a
server-side `outlookQuery()` that builds the fixed `$select`, `$top<=25`, `$orderby`, `startDateTime`/`endDateTime`, and
`$search`; reject caller `$select`, `$expand`, `body`, attachments. Redacted logging as record-folder reads (status only).
Tests (new `graphRead.outlook.test.ts`, import the shipped handler, mock `globalThis.fetch`): AC-OUTL-004, AC-OUTL-014.
**Mutation-check:** flip `isGetMethod` and the scope test; the tests must go red.
Verify: `deno test supabase/functions/m365-token-custody/graphRead.outlook.test.ts`.

**T4 Client.** New `pmo-portal/src/lib/m365/outlookClient.ts`: `listRecentMessages`, `searchMessages`, `listEvents`,
decoders that drop malformed rows (pattern of `decodeItem` in `graphClient.ts`), `matchesContact(item, email)`, and
`outlookWebUrl(url)` allowing only `https` hosts `outlook.office.com`, `outlook.office365.com`, `outlook.live.com`.
Tests `pmo-portal/src/lib/m365/__tests__/outlookClient.test.ts` (AC-OUTL-005, 006, 007, 012 helper, 008 error mapping
through `throwClassifiedM365Error`). Verify: `npx vitest run src/lib/m365/__tests__/outlookClient.test.ts`.

**T5 DAL.** Extend `CrmActivityInput` and `createActivity` in `pmo-portal/src/lib/db/crmActivities.ts` with optional
`source`, `external_id`, `external_url`; map Postgres `23505` to an `AppError` with code preserved so the UI shows
"Already logged". `updateActivity` patch type stays unchanged (AC-OUTL-013). Tests in `crmActivities.test.ts`
(AC-OUTL-009 payload, AC-OUTL-010 error mapping, AC-OUTL-013 patch). Verify:
`npx vitest run src/lib/db/crmActivities.test.ts`.

**T6 Hook + picker UI.** `pmo-portal/pages/contact/OutlookPickerModal.tsx` built from shared primitives
(`EntityFormModal` or the modal shell in use by `EditActivityModal.tsx`, `TextField`, `ListState`, `ConfirmDialog` not
needed), tabs Emails/Meetings, search, match marker, 25-row page with Load more, editable subject/body step, confirm.
Hook `useOutlookPicker` in `pmo-portal/src/hooks/`. States: loading, empty, error, needs-consent, no-connection.
Add en and id-ID strings next to the existing `contactDetail.*` keys. Tests `OutlookPickerModal.test.tsx` (AC-OUTL-003,
005 to 009). Verify: `npx vitest run pages/contact/OutlookPickerModal.test.tsx`.

**T7 Panel wiring + badge.** In `ContactActivityPanel.tsx` show **Log from Outlook** per FR-001 using `usePermission`,
`useOrgFeatures`, and the connection status hook already used by document linking; render the Outlook badge and safe link
in the activity row; refresh the timeline query on success. Tests in `ContactDetail.test.tsx` style (AC-OUTL-001, 012,
013). Verify: `npx vitest run pages/ContactDetail.test.tsx pages/contact`.

**T8 E2E journey.** `pmo-portal/e2e/AC-OUTL-015-log-outlook-email.spec.ts`; Graph mocked via the existing m365 mock
pattern (read `docs/e2e-parallel-conventions.md` first; add the `@e2e-isolation` tag). Verify:
`scripts/e2e-local.sh AC-OUTL-015`.

**T9 Gate.** `npm run check:guards`, `npm run typecheck`, `npx eslint --max-warnings=0 <touched>`, touched vitest and
deno files, `node scripts/affected-e2e.mjs`, `scripts/ux-proof.sh` on `/contacts/:id`. Update `docs/glossary.md`
("Log from Outlook") and the roadmap (#1571) in the same PR. Add the `external_id` meaning to `docs/microsoft-365-integration.md` section 3.5.

## Traceability (ADR-0010)

| AC | Owning layer | Test |
|---|---|---|
| AC-OUTL-001 | Unit | `ContactDetail.test.tsx` |
| AC-OUTL-002 | Unit (Deno) | `initiate*.test.ts` |
| AC-OUTL-003 | Unit | `OutlookPickerModal.test.tsx` |
| AC-OUTL-004 | Unit (Deno, mutation-checked) | `graphRead.outlook.test.ts` |
| AC-OUTL-005, 006, 007 | Unit | `outlookClient.test.ts` / picker test |
| AC-OUTL-008 | Unit | `outlookClient.test.ts` |
| AC-OUTL-009 | Unit | `crmActivities.test.ts` |
| AC-OUTL-010 | pgTAP | `crm_activity_outlook_ref.test.sql` |
| AC-OUTL-011 | pgTAP | `crm_activity_outlook_ref.test.sql` |
| AC-OUTL-012 | Unit | `outlookClient.test.ts`, `ContactDetail.test.tsx` |
| AC-OUTL-013 | Unit | `crmActivities.test.ts`, `ContactDetail.test.tsx` |
| AC-OUTL-014 | Unit (Deno) | `graphRead.outlook.test.ts` |
| AC-OUTL-015 | E2E | `AC-OUTL-015-log-outlook-email.spec.ts` |

## Risks and notes
- Tenant policy may require admin consent for Mail.Read; the reconnect copy must say so plainly (reuse `errorCopy.ts`).
- Each picked item copies up to 500 characters of mail text into PMO visible to the org; the picker states this at confirm.
- Existing connections keep working untouched; only users who opt in re-consent.

## Owner questions (recommended answer first)
1. File against a contact only (today's model) or also a company with no contact? **Recommend contact only in v1; company page already merges its contacts.**
2. Store a 500-character body preview snapshot, or subject and link only? **Recommend snapshot (timeline stays useful offline), shown with the confirm notice.**
3. Request `Mail.Read` and `Calendars.Read` as one incremental consent? **Recommend yes, one reconnect, default connect unchanged.**
