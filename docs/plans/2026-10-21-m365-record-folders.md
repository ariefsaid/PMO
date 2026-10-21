# Microsoft 365 record folders — implementation plan

> **For agentic workers:** execute RED → GREEN in dependency order. This is a planning artifact, not authorization to build, grant Microsoft permissions, commit, push or deploy. The Director owns dispatch and release.

**Goal:** Ensure and link one reference-only folder for a project or procurement case without making Microsoft availability a condition of saving the record.

**Spec:** `docs/specs/m365-onedrive-doc-linking.spec.md` §3.9, **owner-signed 2026-10-21**, FR-M365DOC-069–073 / AC-M365DOC-069–073. Only the signed create-folder exception supersedes the older read-only/no-folder statements. All other reference, permission, audit, bounded-search and degradation rules remain.

**Architecture:** Existing custody router → caller-RLS record/default reads → caller-owned Microsoft connection → bounded convention search → server-built folder-only POST when absence is established → existing register INSERT through a serialized caller RPC. No HTTP from Postgres. No new attachment table, background worker, package dependency or permission entity.

**Decision:** `docs/adr/0089-m365-record-folder-write-capability.md` (proposed for Director acceptance). ADR number **0089** and migration number **0336** were free in this planning worktree on 2026-10-21; latest entries were ADR-0088 and migration 0334. Director reserves these names before dispatch; a subsequent collision uses the repository renumbering procedure, not edits to a shipped migration.

**Executor:** **auth/token-custody tier → Director-dispatched, not the ADW**, including the integration wiring in this amendment. Each builder/reviewer gets the full signed brief and a fresh isolated worktree. No money-path work is included.

## Delivery boundaries and job story

*When I create a project or purchase case, I want its Microsoft folder attached where I work, so I can put evidence in one place without constructing a folder hierarchy or copying files.* Admin's separate job is to attach already-existing folders to older records, not provision them in bulk.

| Phase | Tasks | Deliverable / dependencies |
|---|---|---|
| A — backend and permission tooling | A01–A29 (29 cycles) | Portable convention functions, additive DB guards/audit, custody action/transport, match-only batching, dry-run grant script. Builds on shipped phase-1 linking. No edits to phase-2 UI files. |
| B — **FE wiring after phase 2 merges** | B01–B15 (15 cycles) | New transport/repository/hook/action, create-success hooks, project/case mounts, Admin card, locales and one mocked e2e. Rebase on merged `claude/m365-doc-link-ui`; also wait for the original plan's procurement/default-card phase before editing those adapters. Do not create competing picker/default-card implementations. |

These are **44 two-to-five-minute editing/test cycles**, not elapsed CI/reset/review estimates. Gate/review time is separate below. Director chooses PR boundaries consistent with the issue; all code PRs target **dev only**. No push/merge/deploy is authorized by this document.

## Deciding artifacts read; fixed implementation choices

- `supabase/functions/m365-token-custody/index.ts` exports the served `handler` and owns JWT verification/client construction. Extend its action switch; do not introduce a second endpoint or DI seam. `documentLinking.test.ts` demonstrates importing that handler, `setTestJwks`, the edge test kit and mocked `globalThis.fetch`.
- `graphRead.ts` owns connection resolution, lazy decryption/refresh, scope checks and transport; `refresh.ts` requests the stored connection scope set. Keep one credential owner. `documentVerification.ts` is the existing caller-RLS parent/read + service-only commit precedent; retain its controlled-file semantics and ADR-0086 read batches unchanged.
- Consent is shared through **`pmo-portal/src/lib/m365/graphPkce.ts::M365_PHASE1_DATA_SCOPES`**, re-exported by custody `pkce.ts`, consumed by `initiate.ts` and the `orgApproval.ts` admin-consent URL path (#1014). Add `Sites.Selected` there; updating only `initiate.ts` would not describe both flows. Refresh never upgrades old consent implicitly.
- `supabase/migrations/0292_m365_document_linking.sql` defines both registers' complete refs, source/actor stamps, folder Draft guards, typed link audits and `org_m365_document_settings`. **Do not edit 0292.** Project URL is `ms_web_url`; procurement URL is **`link`**, not a new column. `0076_audit_events.sql::log_audit` is internal. Do not use the swallow-on-failure `audit.ts::logAudit` for the new mandatory creation receipt.
- `pmo-portal/src/lib/db/documents.ts::createProjectDocument` and `procurementCrud.ts::createMicrosoftProcurementDocument` decide the register payloads. The edge function must not import browser DALs (they construct a browser client); use their same INSERT column shape in the caller RPC below. Existing stamp/link-audit triggers execute on that insert.
- `folderSuggestions.ts::suggestFolders` is a picker API: its `[]` intentionally covers no match **and** failure/cap. Keep that UI contract, but creation uses the explicit complete/incomplete result below. Extract only portable path/prefix/request primitives; no FE module with a Supabase import enters the custody import graph.
- Project creation is `pages/Projects.tsx` and `pages/SalesPipeline.tsx` → `src/hooks/useProjects.ts::useProjectMutations().create` → `repositories.project.create` → `src/lib/db/projects.ts::createProject`. It already has an ERP setup result; preserve it. Case creation is `pages/Procurement.tsx` and `pages/project-detail/tabs/ProcurementTab.tsx` → `src/hooks/useProcurementCrud.ts::useCreateProcurement` → `repositories.procurement.create` → `procurementCrud.ts::createProcurement`. Hook once per successful insert, not once per page.
- **Director decision 2026-10-21 (overrides the planner's draft): the case's request number is `procurements.pr_number`, falling back to `procurements.code` for imported/legacy cases; subject is `procurements.title`; year is `created_at` in UTC.** `pr_number` is the case-level number stamped once (coalesced, never blanked) by the existing transition into `Requested` (`next_procurement_doc_number(org,'PR')`, 0268) — it is the request number the signed convention names. Do not use `purchase_requests.pr_number`, a PO number, the external supplier reference or the linked project's code. The `request_number` picker DTO field maps from this same `coalesce(pr_number, code)`. Project uses **`projects.code`**, not `pmo_project_number`.
- **When a case has no number yet (a Draft before submission):** return `missing_identifier`, keep the record, create nothing, and do not invent numbering. The automatic step therefore runs **when the case gets its number** — after the existing transition into `Requested` succeeds (FE `onSuccess`, never inside the money RPC; the transition itself is unchanged) — and also right after create when an imported case already carries `code`. Net effect: every submitted case gets its folder automatically. A project without `code` returns `missing_identifier` with the manual Create folder action once a code is set.

## Server interfaces — fixed before tasks

Put the portable wire types and sanitizer in new `supabase/functions/_shared/microsoftRecordFolder.ts`; re-export types to FE from new `pmo-portal/src/lib/m365/recordFolders.ts`. Keep `microsoftDocumentReference.ts` as the reference validator; do not duplicate it.

```ts
export type RecordFolderTarget = { kind: 'project' | 'procurement'; id: string };
export type RecordFolderOutcome =
  | { state: 'already_linked' | 'linked' | 'created'; document_id: string }
  | { state: 'needs_choice' | 'not_found' | 'default_unset' | 'missing_identifier' };
export interface EnsureRecordFolderRequest extends RecordFolderTarget {
  action: 'ensure_record_folder';
}
export interface RecordFolderCursor {
  kind: 'project' | 'procurement';
  after: string | null; // UUID; server-generated continuation, never a Graph cursor
}
export interface RecordFolderBackfillRequest {
  action: 'link_existing_record_folders'; cursor?: RecordFolderCursor;
}
export interface RecordFolderBackfillPage {
  scanned: number; linked: number; needs_choice: number;
  missing: number; failed: number; skipped: number;
  next: RecordFolderCursor | null;
  stopped?: 'connection' | 'default_changed' | 'unavailable';
}
```

Existing M365 error envelope handles not-connected, stale/revoked, insufficient consent, forbidden, Graph/network failures and invalid input. Add **no raw upstream error** to these DTOs. Use `default_unset`/`missing_identifier`/`needs_choice` as safe domain outcomes, not success toast text. `not_found` is internal/backfill match-only absence; ensure's complete absence proceeds to create. Results never include token material, names, paths, upstream messages or arbitrary response bodies.

Runtime parser requires an object with **exactly** `action,kind,id` for ensure; UUID and kind must validate. Reject every extra key, including drive/site/parent/name/body/method/user/org. Backfill allows only action and the exact cursor shape. Public request types do not make runtime validation optional.

### Portable naming/search primitives

```ts
export function sanitizeRecordFolderName(value: string): string {
  const replaced = value.replace(/["*:<>?\/\\|]/gu, ' ')
    .replace(/^[ .]+|[ .]+$/gu, ' ');
  return Array.from(replaced.trim()).slice(0, 120).join('')
    .replace(/[ .]+$/gu, '').trim();
}
```

Use this on the **whole** `${code.trim()} ${title}` and on the search prefix. Keep internal multiple spaces (each forbidden character becomes one space); do not add suffixes, templates or a second naming convention. Cap by Unicode code points, never split a surrogate. Final boundary trimming removes the replacement padding because SharePoint cannot accept edge spaces/dots. Reapply right-edge removal after truncation. Empty sanitized code/name or control bytes → `missing_identifier`/safe invalid-metadata refusal, never an empty Graph name. Do not silently convert controls to an additional naming rule. Renaming a PMO record never renames an existing Microsoft folder.

New `_shared/microsoftFolderConvention.ts` exports `normalizeFolderParentPath(path,driveId)`, `recordFolderConvention(context)` returning `{term,parentSegments}`, `folderMatches(item,convention,driveId)`, `folderSearchRequest(driveId,term)`, and `parseFolderSearchNext(link,initial)` using the existing path normalization/escaped OData literal and pinned next-link rules. `context` is the existing project/procurement/budget `PickerContext` shape, moved/re-exported without breaking its public import. Server maps typed rows to it. Prefix match remains case-insensitive `startsWith` on the sanitized code prefix (FR-056 plus FR-069 naming), with exact normalized convention parent, default drive and folder-only facets; deduplicate `(drive,item)` across pages.

New `m365-token-custody/recordFolderSearch.ts`:

```ts
export type FolderSearchResult =
  | { complete: true; matches: MicrosoftReferenceInput[] }
  | { complete: false; reason: 'unavailable' | 'page_limit' | 'invalid' };
```

Search ≤3 pages ×100, escaped apostrophes, separate query, no recursion. Only an exhausted, well-formed page chain gives `complete:true`. A fourth page, unsafe/looping next link, unsupported/malformed folder metadata or failed search never yields permission to create. Several matches → link none; FE offers the existing picker. Never follow raw `@odata.nextLink` as a URL.

### Custody-only folder capability

Keep exported `GraphReadSession` and `openCallerGraphRead(deps)` compatible. Inside `graphRead.ts`, factor the existing own-connection opening into a **private** closure returning credential-bound `get`, `batch` and narrow metadata/folder operations. Export a second wrapper **`openCallerRecordFolderAccess(deps, library, mode)`**, used only by `recordFolders.ts`, where `mode` is server-chosen `'ensure' | 'match_only'`, not a browser field.

- `ensure` requires stored `Sites.Selected` (bare or Graph-qualified canonical form) **after** the existing-ref no-op check and **before** search/token refresh. Missing consent returns `SCOPE_INSUFFICIENT`; reconnect after Microsoft admin consent. `match_only` needs existing read scopes only and returns no create method. Ordinary manual picker linking remains read-only and available on old connections.
- Preserve read methods and scope combinations. `scopeCoversPath` and `validateGraphProxyInput` are pinned to **GET** for the browser surface. Write scopes never make a browser mutation permissible. ADR-0086's separate server-generated batch is not passed through that branch.
- `graphFolderWrite.ts` owns the distinct pure **`folderWriteAllowed(request,context)`** and `buildFolderCreateRequest(context:FolderWriteContext)`; the transport calls the allowlist immediately before `fetchBounded`. No generic exported authenticated `request()` or token getter. The closure's only mutator is `createFolder(parentId,name)`, which builds its own path/body and uses the pinned default drive.

```ts
// context is server-loaded and immutable for this invocation, not browser JSON.
interface FolderWriteContext {
  driveId: string; parentId: string; name: string;
}
// Exact keys only, folder must be a plain empty object, no query/custom headers.
// folderWriteAllowed is true only for this exact server-built request:
const request = {
  method: 'POST',
  path: `/drives/${encodeURIComponent(context.driveId)}/items/${encodeURIComponent(context.parentId)}/children`,
  body: { name: context.name, folder: {}, '@microsoft.graph.conflictBehavior': 'fail' },
};
```

Require safe nonempty opaque ID segments (no slash/backslash/control/dot segments or encoded equivalents), sanitized valid name ≤120 and exact body equality to context; reject file/upload/content/children embedded requests, extra keys and query. Match exact method/path, not a permissive prefix. Parent IDs come from validated root/convention-folder metadata in this drive. A GET `/sites/{defaultSite}/drives` membership check (≤3 metadata pages ×100, pinned continuation) establishes that the configured drive belongs to that site before any write. A failure/cap is `GRAPH_ERROR`, never a substitute default. Recheck the DB default tuple/version before the first write and before final linking; change → safe failure, no write to the new location in this invocation.

Internal folder metadata read/create results are a closed union: `ok(item)`, `not_found`, `name_conflict`, `forbidden`, `unavailable`. Decode only 404 + `itemNotFound` as absence and 409 + `nameAlreadyExists` as name conflict; every other non-2xx, invalid JSON/identity/facets/URL or timeout is failure. Keep this classification **internal**; existing read-proxy error envelope stays compatible. Do not reuse a generic failure as absence. No raw Graph text/URL/name/path in new logs/audit.

### Ensure algorithm and parent rules

1. Parse → membership/entitlement via existing auth helper → writer role (Admin/Executive/Project Manager/Finance) → caller-RLS parent select (`id,org_id,code,name` for project; `id,org_id,code,title,created_at` for procurement). Missing/unreadable/wrong-org parent yields the same safe denial, before Graph. No author restriction on creating a *new* project reference; it is `document.create`.
2. Caller-RLS register query for **any** `source='onedrive',ms_item_kind='folder'` in that typed parent. If present, return `already_linked` with its row ID; do not load connection/default, call Graph or refresh metadata. Files/legacy URLs do not count.
3. Caller-RLS settings tuple → no default yields `default_unset`. Missing/empty code or invalid UTC creation timestamp yields `missing_identifier`. Open own ensure-capability and perform bounded search. One match → guarded link only; multiple → `needs_choice`; incomplete → classified failure and manual browse; complete zero → parent resolution/create.
4. Read default drive root for its ID, resolve `Projects` or `Procurement` by exact child path; resolve UTC year for procurement. Missing convention ancestors may be lazily created with the same folder-only operation. **Only** `Projects`, `Procurement`, `<UTC year>` and the record's folder are allowed; these are the signed convention path, not a template or arbitrary extra subfolders. A file occupying any segment is a refusal, not something PMO replaces.
5. Use GET `/drives/{drive}/items/{parentId}:/{encodedName}` for exact child resolution. Every create uses POST `/drives/{drive}/items/{parentId}/children`, body above. On precise 409 name conflict, GET that exact child once, validate folder/drive/parent/name, then reuse it. No second POST, rename, overwrite, suffix or retry loop. Validate created metadata the same way; accept actual Graph success status 201 with complete folder reference.
6. For every 201, persist the creation audit **before continuing** to another parent/link. A 409 lookup or matched folder emits no creation event. An ancestor created during a request is also a created folder and records the initiating kind/id, with no path/name. When the leaf exists, recheck current default and call the guarded link RPC via the caller client. Return `created` only for this invocation's leaf 201; otherwise `linked` or `already_linked`.
7. Failure at any point never undoes the saved parent, deletes Microsoft content or queues work. A completed Graph create with later DB failure is **a successful external create but unsuccessful link**, not a false failed-create audit. Explicit retry searches and links it. No atomicity across Graph and Postgres is claimed; a process death in the external-success→audit gap requires private operational reconciliation, not an invented exactly-once guarantee.

### Database seams and concurrency

New migration **`supabase/migrations/0336_m365_record_folders.sql`**; rollback **`supabase/migrations/rollback/0336_m365_record_folders_down.sql`**. No new business table, no new client-writable source/actor columns, no changed RLS policy and no unique constraint limiting manual folder refs.

1. **`m365_link_record_folder(p_kind text,p_record_id uuid,p_reference jsonb,p_default_site_id text,p_default_drive_id text,p_settings_updated_at timestamptz) returns jsonb`**, SECURITY INVOKER, fixed `search_path=pg_catalog,public`; revoke public/anon, grant authenticated. Reject extra reference keys and require validated folder DTO; call `assert_is_active_member()`, existing writer role and caller-visible same-org typed parent. Lock with `pg_advisory_xact_lock(hashtextextended('m365-record-folder:'||p_kind||':'||p_record_id::text,0))`; inside that transaction check for any folder (deterministic oldest link timestamp/id) and return existing immediately. Otherwise call the fixed settings-fence helper specified below before INSERT; it holds the settings row `FOR SHARE` without wider member grants. Two ensures may do Graph work concurrently, but only one inserts. No lock spans HTTP.
2. Project INSERT exactly `(project_id,category,title,author_id,source,ms_drive_id,ms_item_id,ms_web_url,ms_item_name,ms_item_kind)` with `category='Reference'`, `title=ref.name`, `author_id=auth.uid()`, `source='onedrive'`, kind folder; default Draft. Procurement INSERT exactly `(procurement_id,type,status,link,source,ms_drive_id,ms_item_id,ms_item_name,ms_item_kind)` with `type='Microsoft reference'`, `status='Draft'`. No explicit org/linker/time/baseline, no service insert. Return `{document_id,state:'linked'|'already_linked'}`. Trigger stamps/link audit remain the authority.
3. **`m365_record_folder_created(p_actor_id uuid,p_kind text,p_record_id uuid,p_drive_id text,p_item_id text) returns void`**, postgres-owned SECURITY DEFINER, fixed search path, execute **service_role only**. Derive org/role from profile, `assert_is_active_member(p_actor_id)`, same-org typed parent and configured default drive; require writer role and nonempty identities. Its inputs are the server-validated 201 result, not browser-supplied claims. Use `search_path=pg_catalog,public` and schema-qualified tables/helpers. Emit `log_audit('m365.folder_created',derived_org,p_actor_id,p_record_id,jsonb_build_object('record_kind',p_kind,'record_id',p_record_id,'ms_drive_id',p_drive_id,'ms_item_id',p_item_id))`. No arbitrary action/org/detail arguments. Acquire an advisory transaction lock on org/drive/item, then return if that event already exists. Add partial unique expression index **`m365_folder_created_identity_idx`** on `(org_id,(detail->>'ms_drive_id'),(detail->>'ms_item_id')) WHERE action='m365.folder_created'` as a final dedupe invariant. Refusal/failed Graph create never invokes this RPC. No audit-event table grant changes.
4. **`m365_record_folder_candidates(p_kind text,p_after uuid default null) returns table(id uuid)`**, SECURITY INVOKER, authenticated-only; active Admin, typed static SQL branch, caller-org parents without folder refs via indexed `NOT EXISTS`, `id>p_after`, `ORDER BY id LIMIT 6`. Server processes at most five; sixth supplies continuation. Includes archived projects because FR-072 says every project, without changing their archive status. No OFFSET or per-org full list in browser. Read parent details only for the five IDs under caller RLS.
5. Partial indexes **`project_documents_folder_parent_idx`** `(org_id,project_id,ms_linked_at,id)` and **`procurement_documents_folder_parent_idx`** `(org_id,procurement_id,ms_linked_at,id)` WHERE `source='onedrive' AND ms_item_kind='folder'`; existing parent PK/org indexes support typed paging. No migration updates ordinary records or content.

**Settings fencing decision (not an implementer option):** implement **`m365_record_folder_default_matches(p_site text,p_drive text,p_updated_at timestamptz) returns boolean`**, a postgres-owned SECURITY DEFINER helper granted authenticated, deriving caller org and active membership, selecting only that org's settings `FOR SHARE` and returning exact tuple equality. Call it from the INVOKER link RPC in the **same transaction**. It returns no data across orgs and grants no settings UPDATE. This avoids requiring editors to have Admin settings-write privileges. The edge's pre-write comparison is best-effort; it cannot make a Graph operation transactional with a concurrent Admin default change. Final link fencing is strict. The down migration drops these four functions, three indexes, and nothing else; no external delete, audit deletion or ref deletion.

## Backfill and performance contract

`link_existing_record_folders` requires **active Admin** (not merely an Operator), normal entitlement and own read connection. Process projects then cases; cursor is validated kind/UUID, never a table/path/query. Fetch six candidate IDs, process ≤5, sequentially, with one read connection/default per invoke. A shared internal **`matchAndLinkRecord(target,mode)`** accepts a server mode; `match_only` can search/link but cannot resolve/create parents or obtain a create capability.

Count `scanned` for each processed candidate; exactly one terminal bucket among linked/needs_choice/missing/failed/skipped. Missing includes no match and missing code, skipped means a concurrent folder link appeared. Global auth/connection/default failure before processing returns the normal error envelope. A global failure after progress returns the completed page's counts, last processed cursor and safe `stopped` enum; FE shows partial completion and requires explicit Continue. Never discard committed counts or classify unvisited records as failed. A per-record search failure counts failed, never missing. At three-page cap it fails safely. Return the cursor **after the last processed ID**, not after the unprocessed sixth. Empty project page transitions to procurement; an exhausted procurement page returns next null. This is an operator-initiated finite foreground sweep, not snapshot isolation: records inserted behind a cursor during the sweep can require a later explicit run. No background continuation or implicit retry.

Graph work per invocation has a **15-second shared budget**, each fetch ≤min(5 seconds, remaining), using `fetchWithDeadline`; no retry on 429/5xx/timeouts. Check remaining budget before starting another record, return continuation at the last processed ID; if no record could finish, return a safe failure instead of a non-progress cursor loop. FE `invokeWithTimeout` stays at 20 seconds. Bound each membership-list or prefix search to three pages of 100; no folder descendants enumeration. De-duplicate IDs and next links, cap accumulated search items at 300. Do not cache cross-user Microsoft data or persist Graph results in browser storage.

## UI contract — **only after phase-2/parent adapters merge**

Operate mode; expand existing document/register UI, not a redesigned page. Preserve DESIGN.md's shared Button (32px, `.touch-target`, focus ring), Icon facade, quiet muted status, wrapping/min-w-0 and EntityFormModal/ConfirmDialog where already used. No new confirmation for the one folder action; no duplicate primary button or second picker.

- New `src/components/m365/RecordFolderAction.tsx` takes `{target,hasFolder,onChooseExisting}`. One **Create folder in SharePoint** Button, gated using the actual `usePermission()` predicate: `const may=usePermission(); may('create',target.kind==='project'?'document':'procDoc')`. Read `realRole/effectiveRole` from `src/auth/impersonation.tsx::useEffectiveRole`; require equality as the explicit view-only gate. Do not assume `usePermission` returns an object or itself disables impersonation. Existing folder ref hides it, even without a connection/default. Pending only disables this action; never the saved record/other tabs.
- New `src/hooks/useRecordFolder.ts` owns mutation state and safe feedback for explicit retry. New `src/hooks/useStartRecordFolder.ts` supplies a synchronous `start(target):void` used by create hooks: set caller/org/record-scoped query-cache state, start `repositories.m365RecordFolders.ensure(target)`, and attach explicit success/failure handlers that update only the captured identity's state. **Never return that promise from `onSuccess`**, and never await it in parent create. Store only safe outcome/code. Preserve notification after create-modal unmount/navigation; guard completion by captured user/org identity. Do not automatically start on mount, refetch, failed invoke or reconnect. Explicit action uses same seam with React Query `retry:false`.
- Create hook invokes `start` immediately after `repositories.*.create` resolves. Project does so **before** its existing ERP synchronization await, retaining the original returned `erpSetup`; do not add ERP behavior. Procurement keeps `Tables<'procurements'>` return signature; folder status lives separately in cache. Hook all entry points; exclude bulk import/export paths (no bulk provisioning).
- Success refetches `['project-documents',org,id]` or `['procurement-docs',org,id]` plus case detail as appropriate. The coordinator uses shell `useToast` for a safe pending notification followed by linked/saved-not-linked result, so the outcome is visible even when the new record opens on Overview. Result toasts carry no retry button; the register owns the one retry action. Polite status **Folder linked**; no implication that contents are approved. Failure keeps the record heading/normal create success. Persistent inline **Record saved. Folder not linked.** + reviewed remedy; exactly one retry action on the register surface. Outcome unknown on timeout is not a claim nothing happened; retry is idempotent.
- `needs_choice` offers **Choose existing folder** invoking the existing Microsoft picker. It does not auto-select, automatically open a modal on navigation, or create a second picker. A successful selection retains the normal register insert path. Incomplete search offers manual browse/retry without creating.
- Old-consent copy: **The connection needs additional permissions. Ask your Microsoft admin to approve them, then reconnect.** Reuse existing reconnect/setup navigation. Missing grant/access: **Access depends on your Microsoft permissions. Ask your Microsoft admin to check folder creation access.** Do not promise reconnect fixes access. Opaque Graph errors retain §3.8 generic copy, never invent licence/not-found diagnoses. Unset default: **Ask an Admin to choose the default document library.** Missing code: **Add the record's code, then try again.** No raw scope/path/IDs/errors in DOM.
- Admin default card gets **Link existing folders**, gated `integration.manage`, disabled while clearing/changing default or running. New `src/components/m365/LinkExistingRecordFolders.tsx` owns foreground paging, progress/counts and Stop. Sequential invokes within this explicitly initiated operation; Stop prevents the next invoke, preserves committed counts and labels in-flight completion honestly. Fatal errors retain counts and explicit Continue, no automatic retry. Completion says **Linked N · Need a choice N · No match/code N · Failed N · Already linked N**; counts are tabular. No folder creation in this action, no setting mutation and no silent background loop after unmount.
- New feature copy uses `public/locales/{en,id}/recordFolders.json` with identical key trees, not new `common.json` keys. Rebase translation changes immediately before the FE PR.

## Test ownership / traceability

An AC has one canonical owning test title/file. Additional tables below are supporting proofs, not duplicate claims of ownership. AC-072's required RTL presentation is supporting the Deno owner; AC-073's DB proof does not pretend pgTAP called Graph.

| AC | Canonical owning proof | Supporting proofs / tasks |
|---|---|---|
| AC-M365DOC-069 | Deno `recordFolders.test.ts`: **AC-M365DOC-069 served ensure links, creates or requests choice idempotently** | Pure names/search, pgTAP atomic link, race harness; A01–A12, A17–A24 |
| AC-M365DOC-070 | Deno `recordFolderWrite.test.ts`: **AC-M365DOC-070 folder capability permits only the server-built default-drive folder POST** | Consent Vitest/Deno, exact actual allowlist matrix + handler matrix, mutation harness, grant script; A13–A16, A25, A28–A29 |
| AC-M365DOC-071 | RTL `src/hooks/useStartRecordFolder.test.tsx`: **AC-M365DOC-071 successful project and case creation survive every folder failure** | Create-hook tests, action/pages, locales, mocked e2e; A17, A24, B01–B10, B13–B15 |
| AC-M365DOC-072 | Deno `recordFolderBackfill.test.ts`: **AC-M365DOC-072 Admin match-only sweep links singles and reports bounded counts** | RTL `LinkExistingRecordFolders.test.tsx`, default-card integration; A09, A26–A27, B02, B11–B15 |
| AC-M365DOC-073 | pgTAP `supabase/tests/m365_record_folder_audit.test.sql`: **AC-M365DOC-073 created folder receipts are exactly once and server attributed** | Served create→receipt ordering/no receipt on denial, rollback; A06–A07, A10, A23 |

Deno tests import the **SHIPPED `handler` from `./index.ts`** using the existing `documentLinking.test.ts` pattern. Mock only `globalThis.fetch` (Graph/PostgREST/token boundary), test clock/config through existing test kit, synthetic encrypted connection fixture and JWT authority; no production DI, copied request router/validator, or replacement in-test ensure implementation. Pure tests import the actual shared function/allowlist too. Test URLs/names/IDs are synthetic, e.g. `example.invalid`, `synthetic-drive`, `Synthetic project`; reuse private local test setup without publishing configuration key names.

## Phase A — backend first (29 cycles)

Every command below runs from repo root. For each behavior cycle, first add its specified test and run the command expecting the named new assertion to fail; then implement only its GREEN change and rerun. A missing test/import is an initial RED, followed by the behavioral RED before completion. Existing passing oracles stay intact.

### A01 — exact sanitization (AC-M365DOC-069)
- [ ] RED: create `supabase/functions/_shared/microsoftRecordFolder.test.ts`. Import actual `sanitizeRecordFolderName`; table every rejected character, repeated invalid characters, all-dot/space input, interior dots/spaces, 121 ASCII chars, emoji crossing 120, truncation ending in dot. Assert `A*/B` becomes `A  B`, no new naming suffix, and empty result remains empty for caller refusal.
- [ ] GREEN: create `supabase/functions/_shared/microsoftRecordFolder.ts` with the sanitizer and portable target/result types above. `sanitizeRecordFolderName` has no globals, I/O or Graph dependency.
- [ ] Verify: `deno test supabase/functions/_shared/microsoftRecordFolder.test.ts`.

### A02 — shared convention path normalization (AC-M365DOC-069)
- [ ] RED: extend `pmo-portal/src/lib/m365/__tests__/folderSuggestions.test.ts` with foreign drive, encoded slash/dot/control segments, `/drive/root:` and `/drives/{drive}/root:`, exact convention parent and UTC-year rollover. Existing fallback assertions must still pass.
- [ ] GREEN: move `normalizeParentPath`, context shape and `contextSearch` logic from `folderSuggestions.ts` to `supabase/functions/_shared/microsoftFolderConvention.ts` under the exported names fixed above; re-export `PickerContext` and call those helpers from `folderSuggestions.ts`. Search uses the sanitized code prefix for folder names this amendment creates; already-legal codes are unchanged. Filter with the same sanitized prefix, so rejected characters in a code cannot produce a second naming rule or an unsafe search path. Keep one search chain with the existing three-request cap.
- [ ] Verify: `scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run src/lib/m365/__tests__/folderSuggestions.test.ts'`.

### A03 — portable escaped search/pinned paging (AC-M365DOC-069)
- [ ] RED: create `supabase/functions/_shared/microsoftFolderConvention.test.ts`; assert apostrophe doubled before URL encoding, query `$top=100`, same-path Graph-only next links, duplicate/foreign query keys, >100 page sizes, URL credentials/hash and cyclic links refused.
- [ ] GREEN: implement `folderSearchRequest` and `parseFolderSearchNext` in `microsoftFolderConvention.ts`, moving only their pure request-construction/parser logic from `graphClient.ts` and preserving its `AppError` wrapper at the FE boundary. Do not pull a browser client into `_shared`. Pin continuation to the original path; allow only existing parser keys and enforce `$top=100`.
- [ ] Verify: `deno test supabase/functions/_shared/microsoftFolderConvention.test.ts`; `scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run src/lib/m365/__tests__/graphClient.browse.test.ts src/lib/m365/__tests__/folderSuggestions.test.ts'`.

### A04 — atomic project folder insert (AC-M365DOC-069)
- [ ] RED: create `supabase/tests/m365_record_folder_link.test.sql`, `begin; select no_plan();` / `finish(); rollback;`, with independent synthetic two-org active Admin/PM/Finance/Engineer and inactive fixtures following the actual `m365_document_link_audit.test.sql` setup. As authenticated PM call the exact link RPC signature twice and assert one folder row, same returned ID, Draft, caller author/linker, complete ref and one normal typed link event.
- [ ] GREEN: start `0336_m365_record_folders.sql`; implement INVOKER `m365_link_record_folder` project branch, exact parser/role/parent checks, record advisory lock, any-folder check and project INSERT listed above. Return stable JSON keys. Add explicit execute grants/revocations. Initial settings equality check is retained; the locking helper arrives in A08 before ship.
- [ ] Verify: `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/m365_record_folder_link.test.sql'`.

### A05 — atomic procurement folder insert and denial matrix (AC-M365DOC-069/070)
- [ ] RED: same SQL file: overhead case, several ordinary existing file refs, existing folder of another drive, non-Draft case stage, wrong kind/file input, malformed refs, wrong org/unreadable parent, inactive/Engineer and forged actor/org/ref keys. Any existing folder returns its row without inserting; denied calls preserve every row.
- [ ] GREEN: implement static procurement branch using canonical `link` and `type='Microsoft reference'`, no project FK requirement or case-stage restriction. Validate `p_kind IN ('project','procurement')`, total nonnull predicates and exact DTO keys before SQL; never use dynamic table-name SQL. Existing RLS/stamps remain installed.
- [ ] Verify: `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/m365_record_folder_link.test.sql supabase/tests/m365_procurement_links.test.sql'`.

### A06 — creation receipt service boundary (AC-M365DOC-073)
- [ ] RED: create `supabase/tests/m365_record_folder_audit.test.sql`; assert anon/authenticated (including Admin) cannot execute creation RPC or write audit; service role + verified synthetic active writer succeeds. Supply cross-org parent, inactive/read-only actor, null kind/record/item and foreign default drive and assert denial/no row.
- [ ] GREEN: add postgres-owned `m365_record_folder_created` with exact signature/guards/detail above. Use `log_audit` directly inside this function. Explicit revoke public/anon/authenticated, grant service_role; no grant of the raw helper or audit DML. Add the two typed parent branches and no client `org_id` parameter.
- [ ] Verify: `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/m365_record_folder_audit.test.sql'`.

### A07 — once-only metadata receipt (AC-M365DOC-073)
- [ ] RED: complete the AC-073 leading aggregate assertion in that SQL file: duplicate calls same identity give one event, distinct created ancestors/leaf give one each, actor/org/record metadata are derived correctly; exact JSON key set excludes name/path/URL. Roll back a receipt in a subtransaction and assert zero persisted events for it.
- [ ] GREEN: add org/drive/item advisory lock + existence check and `m365_folder_created_identity_idx`. Deduplication ignores initiating record differences because the same actual Graph folder cannot be created twice. Keep prior attribution; do not update historical audit. SQL tests of refusal/rollback cover DB behavior; A23 binds actual Graph failure to absence of a receipt call.
- [ ] Verify: `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/m365_record_folder_audit.test.sql'`.

### A08 — settings transaction fence without wider editor grants (AC-M365DOC-069/070)
- [ ] RED: link SQL test uses active non-Admin writer/default read grants, changes default tuple/timestamp before link, and asserts stale invocation inserts nothing. Test settings-fence helper with wrong-org tuple, inactive actor and same-org member. Capture effective settings grants before/after; no member UPDATE grant added.
- [ ] GREEN: add `m365_record_folder_default_matches` exactly as specified above and call it while holding the record advisory lock, after returning any existing folder and immediately before the INSERT. Use `SELECT ... FOR SHARE` in the definer helper scoped by `auth_org_id()`, keep the lock until the caller RPC transaction ends, compare all three supplied values with total nonnull equality. Reject false with `23514`, DETAIL `m365-default-changed`; FE never renders that detail.
- [ ] Verify: `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/m365_record_folder_link.test.sql supabase/tests/m365_document_settings.test.sql'`.

### A09 — indexed Admin candidates (AC-M365DOC-072)
- [ ] RED: create `supabase/tests/m365_record_folder_candidates.test.sql`; insert >6 synthetic projects/cases across two orgs, folders/files, archived project and overhead case. Assert ordered six-ID page, cursor exclusion, missing-folder filter, Admin only and no cross-org IDs.
- [ ] GREEN: add INVOKER `m365_record_folder_candidates` with static branches, active Admin checks and NOT EXISTS query, plus both partial folder-parent indexes. Candidate SQL includes org predicates on parents and children. No archive filter, money transition or update.
- [ ] Verify: `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/m365_record_folder_candidates.test.sql'`.

### A10 — reversible migration / catalog binding (AC-M365DOC-069/072/073)
- [ ] RED: create `scripts/check-m365-record-folder-reversal.test.mjs` exercising a new `scripts/check-m365-record-folder-reversal.mjs` harness. Require down/up catalog equality for existing registers/settings/policies/grants, preserved refs/audits, and removal/reappearance of exactly four new functions + three indexes. Existing 0292 reversal script is the subprocess/transaction model, not a script to repurpose.
- [ ] GREEN: write down SQL dropping only `m365_link_record_folder(text,uuid,jsonb,text,text,timestamptz)`, `m365_record_folder_created(uuid,text,uuid,text,text)`, `m365_record_folder_candidates(text,uuid)`, `m365_record_folder_default_matches(text,text,timestamptz)` and the three indexes. New harness applies down/up **inside a transaction then rolls back**, leaves migration history alone and verifies ordinary data/effective grants unchanged. Run `node scripts/check-isolation-denominator.mjs --write` under DB lock, inspect the entries for the two new non-trigger definers, and regenerate actual DB types (no hand-written table rows).
- [ ] Verify: `node --test scripts/check-m365-record-folder-reversal.test.mjs`; `scripts/with-db-lock.sh bash -c 'supabase db reset && node scripts/check-m365-record-folder-reversal.mjs && node scripts/check-isolation-denominator.mjs --write && supabase gen types typescript --local > pmo-portal/src/lib/supabase/database.types.ts'`.

### A11 — two-connection insert race (AC-M365DOC-069)
- [ ] RED: create `scripts/m365-record-folder-race.test.mjs` and `scripts/m365-record-folder-race.mjs`; two real local Postgres sessions use distinct same-org writer JWTs, same record and different prospective ref identities. Hold the first transaction before commit, launch second, prove it blocks then returns the winner. Final SQL asserts one row, one typed link audit and correct winning stamps. Repeat for procurement.
- [ ] GREEN: harness owns unique fixture IDs and removes only its own rows in `finally`; captures child output bodies and exits nonzero on any assertion/timeout. Use the same record advisory key in both RPC branches and re-read folders **after** lock acquisition; do not resolve the race with a unique constraint on all folder references. Add a supporting case proving two intentional normal manual folder INSERTs remain allowed.
- [ ] Verify: `node --test scripts/m365-record-folder-race.test.mjs`; `scripts/with-db-lock.sh bash -c 'supabase db reset && node scripts/m365-record-folder-race.mjs'`.

### A12 — served action parser and row preflight (AC-M365DOC-069/071)
- [ ] RED: create `supabase/functions/m365-token-custody/recordFolders.test.ts` importing `handler` from `./index.ts`. Add parser/parent/role/no-op cases: extra body key/invalid UUID rejected, caller JWT used on parent/register/default reads, unauthorized/unreadable target never reaches Graph; existing folder no connection/settings/Graph call. Copy only fixture setup patterns from `documentLinking.test.ts`, not production logic.
- [ ] GREEN: create custody `recordFolders.ts::handleEnsureRecordFolder(body,deps)` and route it from `index.ts`. Add request to `types.ts::M365Request`. Preflight stages 1–3 above with both typed parent projections and exact any-folder check. Extend structural Supabase query types only for real methods used (`limit`, `order`, thenable filtered selects); no unsafe `any` or browser client import. Add `'supabase/functions/m365-token-custody/recordFolders.test.ts':'handler'` to `scripts/check-edge-fn-test-binding.mjs::REQUIRED` so binding is mechanically checked.
- [ ] Verify: `deno test --config supabase/functions/m365-token-custody/deno.json --allow-env --allow-net --allow-read supabase/functions/m365-token-custody/recordFolders.test.ts`; `node scripts/check-edge-fn-test-binding.mjs`.

### A13 — personal and Admin consent parity (AC-M365DOC-070)
- [ ] RED: extend `pmo-portal/src/lib/m365/__tests__/graphPkce.test.ts`, `tokenCustody.initiate.test.ts`, `tokenCustody.orgApproval.test.ts`: expected personal and Graph-qualified Admin scopes contain Sites.Selected plus all reads; neither contains Files.ReadWrite, app-only token flow or tenant-wide write. Preserve existing PKCE/state/activation oracles.
- [ ] GREEN: append `'Sites.Selected'` once to shared `M365_PHASE1_DATA_SCOPES` in `graphPkce.ts`; update `initiate.ts`'s scope contract comment and exact URL expectations. Admin `buildAdminConsentUrl` continues deriving its scope list from that constant; do not fork a second hard-coded list or change the #1014 route/state flow.
- [ ] Verify: `scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run src/lib/m365/__tests__/graphPkce.test.ts src/lib/m365/__tests__/tokenCustody.initiate.test.ts src/lib/m365/__tests__/tokenCustody.orgApproval.test.ts'`.

### A14 — consent gating and refresh compatibility (AC-M365DOC-070/071)
- [ ] RED: add served ensure cases for old scopes (no token-refresh/Graph call; SCOPE_INSUFFICIENT), own-vs-other connection, stale/revoked and new scopes; extend `pmo-portal/src/lib/m365/__tests__/tokenCustody.proxy.test.ts`'s existing expired-token refresh case to prove old refresh sends only stored scopes and cannot upgrade. New consent fixture reconnects before capability succeeds.
- [ ] GREEN: introduce private own-connection opener and `openCallerRecordFolderAccess` wrapper in `graphRead.ts`; require Selected only for ensure, before obtaining a fresh bearer. Keep `openCallerGraphRead` interface/behavior compatible. Preserve `refresh.ts`'s stored-scope request and callback scope persistence; do not append new scopes to old DB rows. Mode is internal, not parsed browser input.
- [ ] Verify: `deno test --config supabase/functions/m365-token-custody/deno.json --allow-env --allow-net --allow-read supabase/functions/m365-token-custody/recordFolders.test.ts`; `scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run src/lib/m365/__tests__/tokenCustody.proxy.test.ts src/lib/m365/__tests__/graphClient.browse.test.ts'`.

### A15 — distinct exact folder-write validator (AC-M365DOC-070)
- [ ] RED: create `supabase/functions/m365-token-custody/recordFolderWrite.test.ts`, importing actual `handler` and `folderWriteAllowed`. Matrix: valid request true; other drive/parent/name/method, PATCH/DELETE/PUT, file/content body, nonempty folder, extra body/headers/query, conflictBehavior rename/replace, unsafe ID/path and oversize/unsanitized name false. Handler matrix sends browser proxy POST/file/other drive/PATCH/DELETE and GET-with-body, and asserts **zero Microsoft network calls** (ordinary auth DB fetches are expected).
- [ ] GREEN: create `graphFolderWrite.ts` with exact builder/context/validator above. Pin browser proxy validation and `scopeCoversPath` to GET independent of held write scopes; reject any supplied proxy `body` even on GET, before connection/token/Graph access. Don't route ADR-0086 batches through that check. Tests must also send a synthetic legacy write-scope connection to show consent is not proxy write authorization. Update the existing scope matrix's mutation expectations to the signed GET-only proxy contract, strengthening refusal while preserving every read/traversal/refresh oracle; this is an explicit contract change, not weakening a test to match an accidental implementation. No broad Graph mutation request seam is exported. Add `'supabase/functions/m365-token-custody/recordFolderWrite.test.ts':'handler'` to the binding guard's REQUIRED map.
- [ ] Verify: `deno test --config supabase/functions/m365-token-custody/deno.json --allow-env --allow-net --allow-read supabase/functions/m365-token-custody/recordFolderWrite.test.ts`; `scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run src/lib/m365/__tests__/graphClient.browse.test.ts src/lib/m365/__tests__/tokenCustody.proxy.test.ts'`.

### A16 — internal metadata outcomes / bounded folder transport (AC-M365DOC-069/070)
- [ ] RED: write tests in `recordFolderWrite.test.ts` that import the real narrow adapter and use mocked fetch for 201, 404 itemNotFound, 409 nameAlreadyExists, 403, 429, 503, non-JSON and timeout. A22 supplies the served positive leaf POST after that orchestration exists; in this cycle exercise the narrow production adapter with actual Supabase clients and mocked fetch, never a copied transport. Unknown errors never become absence/conflict. Assert bearer never appears in returned DTO/log args.
- [ ] GREEN: implement closure-bound `createFolder` using builder → allowlist → `fetchWithDeadline`, and internal metadata outcome decoder. Retain existing ordinary GET/batch response/error envelopes. Set Graph-operation deadline budget as specified; pass remaining deadline to each call, no automatic retries, no public raw Response or upstream body. Add no credential getter and no new injected production fetch interface.
- [ ] Verify: `deno test --config supabase/functions/m365-token-custody/deno.json --allow-env --allow-net --allow-read supabase/functions/m365-token-custody/recordFolderWrite.test.ts supabase/functions/m365-token-custody/documentLinking.test.ts`.

### A17 — settings and identifiers degradation (AC-M365DOC-069/071)
- [ ] RED: served test cases: no settings row, cleared default, settings-read denial, null/empty/sanitized-empty code, case with null project, invalid timestamp and UTC offset crossing year. Reject browser name/code/org overrides. Assert case context uses coalesce(pr_number, code)/title (pr_number wins when both exist); project code, not pmo_project_number.
- [ ] GREEN: map rows to portable conventions, `default_unset`/`missing_identifier` outcomes, and validated snapshot `{site,drive,updated_at}`. No folder call for missing identifier or default. Save/ensure are separate operations; the handler cannot delete or roll back the parent.
- [ ] Verify: `deno test --config supabase/functions/m365-token-custody/deno.json --allow-env --allow-net --allow-read supabase/functions/m365-token-custody/recordFolders.test.ts`.

### A18 — complete versus uncertain search (AC-M365DOC-069)
- [ ] RED: add served zero/one/two/duplicate match cases and cap/unsafe/cyclic page, inaccessible/malformed metadata, apostrophe and sanitized code prefix cases. Test one unique match on page 1 plus ambiguous match on page 3: never link early. A fourth-page continuation must cause **no create/link**.
- [ ] GREEN: create `recordFolderSearch.ts` with explicit union and portable helpers; search through the narrow read session. Strict default-drive/folder/name/path checks; de-duplicate identity. Stop only with a complete chain or safe incomplete outcome. On several matches return `needs_choice`; on search failure return safe Graph error. Never call `suggestFolders()` as authority to create.
- [ ] Verify: `deno test --config supabase/functions/m365-token-custody/deno.json --allow-env --allow-net --allow-read supabase/functions/m365-token-custody/recordFolders.test.ts`.

### A19 — single-match linking under caller RLS (AC-M365DOC-069)
- [ ] RED: one-match served case asserts only reads, one caller-authenticated `m365_link_record_folder` RPC with exact ref/default snapshot, no direct service register insert or audit creation call. RPC `already_linked` winning a race must propagate correctly; zero-row/error must not become linked success.
- [ ] GREEN: implement `linkFolderReference` in `recordFolders.ts` calling the INVOKER RPC using `deps.callerClient`, projecting only reference keys and the server settings snapshot. Validate RPC result IDs/state; map 42501 to safe forbidden and default-changed/collision to safe retry message. Normal insert triggers own link audit; do not emit it from custody.
- [ ] Verify: `deno test --config supabase/functions/m365-token-custody/deno.json --allow-env --allow-net --allow-read supabase/functions/m365-token-custody/recordFolders.test.ts`.

### A20 — bind default drive to site / resolve convention root (AC-M365DOC-069/070)
- [ ] RED: served no-match fixture returns configured drive in default site's drives, root ID and Projects parent. Also test foreign default drive, paginated membership, cap, file named Projects and missing root. None may create outside the configured site/drive or fall back to OneDrive.
- [ ] GREEN: implement bounded site→drives membership read, root read and exact child lookup in new custody `recordFolderParents.ts`. Validate returned drive/item identity, folder facet, name and parent. Resolve paths from server convention segments only. Re-read settings snapshot before first write; refuse changes. No candidate supplies a write path.
- [ ] Verify: `deno test --config supabase/functions/m365-token-custody/deno.json --allow-env --allow-net --allow-read supabase/functions/m365-token-custody/recordFolders.test.ts supabase/functions/m365-token-custody/recordFolderWrite.test.ts`.

### A21 — lazy convention ancestors / UTC procurement year (AC-M365DOC-069)
- [ ] RED: served fixtures with missing Projects; missing Procurement; existing Procurement but missing UTC year; all ancestors already present. Assert exact parent-first sequence, folder-only bodies and no extra hierarchy. Existing ancestors get no audit creation call. File occupying year path refuses.
- [ ] GREEN: add `ensureConventionParents` in `recordFolderParents.ts`: for each server segment, GET exact child; only precise not_found permits `createFolder`; validate created result. For procurement use `new Date(created_at).getUTCFullYear()`, never local time/current year. Carry created parent refs back to the auditing hook before proceeding. No recursive provisioning beyond convention segments.
- [ ] Verify: `deno test --config supabase/functions/m365-token-custody/deno.json --allow-env --allow-net --allow-read supabase/functions/m365-token-custody/recordFolders.test.ts`.

### A22 — race-safe leaf creation (AC-M365DOC-069/070)
- [ ] RED: complete-zero search creates sanitized leaf under validated parent. Simulate 409 nameAlreadyExists on leaf and ancestor, exact-path read success then link; 409 other code/404-after-conflict/file/wrong-drive/wrong-parent/name refusal. Assert no repeated POST and no rename/suffix. Record already linked on a later invocation makes zero Microsoft calls even after PMO name changes.
- [ ] GREEN: implement leaf `createFolder` and shared `createOrReadConflictingFolder` (one 409 lookup only) in `recordFolderParents.ts`, then final settings-fenced `linkFolderReference`. Set outcome created only for this invocation's leaf 201; conflict winner reuse is linked. Complete canonical AC-069 table test, all scenarios through served handler.
- [ ] Verify: `deno test --config supabase/functions/m365-token-custody/deno.json --allow-env --allow-net --allow-read supabase/functions/m365-token-custody/recordFolders.test.ts`.

### A23 — bind confirmed create to durable audit (AC-M365DOC-073)
- [ ] RED: served tests assert every 201 (including convention parents) invokes `m365_record_folder_created` once with verified user/typed target/actual drive-item; 409, matched existing, Graph 403/network/invalid create result never invokes it. Audit RPC error prevents subsequent link and maps safe failure; link failure after receipt retains the receipt call and never DELETEs Graph.
- [ ] GREEN: implement required `recordFolderCreated` in `recordFolders.ts`, returning a failure if RPC returns error; do not call `audit.ts::logAudit`. Pass this hook into parent creation and invoke immediately after each validated 201. Graph success is the audit fact, link success remains its separate transaction. Normal `project_document.m365_linked`/`procurement_document.m365_linked` still comes only from triggers.
- [ ] Verify: `deno test --config supabase/functions/m365-token-custody/deno.json --allow-env --allow-net --allow-read supabase/functions/m365-token-custody/recordFolders.test.ts`; `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/m365_record_folder_audit.test.sql'`.

### A24 — refusal, timeout and default-change cleanup semantics (AC-M365DOC-069/071)
- [ ] RED: served table: each stable §3.8 error code, generic Microsoft denial, rate-limit, exhausted 15s budget and settings changed between search/create/link. Inspect safe response keys, no raw marker and no parent DELETE/update, retry queue, duplicate POST, borrowed connection or success-on-failure.
- [ ] GREEN: total error mapping in `recordFolders.ts`; final fence refusal preserves all existing refs, returns safe retry. Release local resources/timers in finally; no compensating deletion or scheduled continuation. Share the one Graph deadline across search/parent/create, not a fresh 15 seconds per call.
- [ ] Verify: `deno test --config supabase/functions/m365-token-custody/deno.json --allow-env --allow-net --allow-read supabase/functions/m365-token-custody/recordFolders.test.ts supabase/functions/m365-token-custody/recordFolderWrite.test.ts`.

### A25 — mutation witness tied to shipped capability (AC-M365DOC-070)
- [ ] RED: create `scripts/m365-record-folder-write-mutation.test.mjs` and `.mjs` harness. Require baseline pass; mutate **the actual** `folderWriteAllowed` to always true, browser-method guard to permit POST and default-drive equality independently; each mutant must fail the corresponding assertion, not just fail compilation. Require the positive adapter test to inspect the captured actual method/path/body and the production call site to invoke the tested allowlist immediately before fetch; no alternate exported write transport is permitted.
- [ ] GREEN: harness saves original bytes/hashes, applies one bounded mutation per isolated run, executes `recordFolderWrite.test.ts`, checks assertion output, restores byte-identical files in finally (including interruption handling). The direct matrix imports the actual exported validator: an allow-all mutation must be killed even though the public parser cannot supply a write request. Served positive/negative cases prove the real router/transport remains wired. Do not expose a production test-only action to drive the matrix.
- [ ] Verify: `node --test scripts/m365-record-folder-write-mutation.test.mjs`; `node scripts/m365-record-folder-write-mutation.mjs`; `node scripts/check-edge-fn-test-binding.mjs`; `git diff --check`.

### A26 — Admin match-only action (AC-M365DOC-072)
- [ ] RED: create `supabase/functions/m365-token-custody/recordFolderBackfill.test.ts`, importing actual handler. Admin fixtures: single, multiple, no match, existing-folder race and missing-code cases. Non-Admin/disabled/cross-org/cursor-tamper refusals. With read-only scopes it can link matches; **all captured Graph calls are GET**, including when parents/year do not exist.
- [ ] GREEN: create `recordFolderBackfill.ts::handleLinkExistingRecordFolders`, add `types.ts` request/router branch; use normal auth plus role Admin. Extract `matchAndLinkRecord` from ensure into `recordFolders.ts` with server-only mode, call search + guarded link directly in match_only. Never call ensure/create/resolve-parent path from backfill. Open read-only capability once per page. Add `'supabase/functions/m365-token-custody/recordFolderBackfill.test.ts':'handler'` to the binding guard's REQUIRED map.
- [ ] Verify: `deno test --config supabase/functions/m365-token-custody/deno.json --allow-env --allow-net --allow-read supabase/functions/m365-token-custody/recordFolderBackfill.test.ts`.

### A27 — finite keyset pages / honest counters (AC-M365DOC-072)
- [ ] RED: backfill served tests: >5 records, empty project→procurement boundary, last empty page, one per-record search failure, budget ends between records, nonprogress page, setting changed mid-page and global connection failure. Assert five max processed, sixth unprocessed, cursor after last processed, counts sum to scanned and no hidden POST or retry.
- [ ] GREEN: call `m365_record_folder_candidates` through caller client, process ≤5 sequentially within shared deadline; emit exact page DTO/counter buckets above. Validate candidate IDs and cursor monotonicity; if no progress under deadline return error. Before progress a global failure returns the normal error envelope; after progress it returns completed counts plus `stopped` and the last processed cursor. Never report unvisited records as missing. Final canonical AC-072 assertion includes all terminal buckets and completion transition.
- [ ] Verify: `deno test --config supabase/functions/m365-token-custody/deno.json --allow-env --allow-net --allow-read supabase/functions/m365-token-custody/recordFolderBackfill.test.ts`.

### A28 — owner-only dry-run site-grant script (AC-M365DOC-070)
- [ ] RED: create `scripts/m365-grant-site-write.test.mjs` with mocked `az` executable in a temporary PATH. Invoke script with synthetic site/app arguments: default and `--dry-run` print method/URL/body and call no tool/network; missing/invalid/path-injecting args fail; `--execute` calls only the one expected Graph POST using the operator's already-authenticated CLI. No tokens on stdout/argv. Tests never call Microsoft.
- [ ] GREEN: create executable `scripts/m365-grant-site-write.sh` with usage `scripts/m365-grant-site-write.sh --site-id synthetic-site --app-id 11111111-1111-4111-8111-111111111111 [--dry-run|--execute]`. Validate a safe opaque site argument and UUID app ID, reject unknown/duplicate flags and conflicting modes; construct JSON using `jq -n --arg app "$app_id" '{roles:["write"],grantedToIdentities:[{application:{id:$app}}]}'`. Print the single `POST https://graph.microsoft.com/v1.0/sites/{encoded-site}/permissions` and JSON by default. Execute only with explicit --execute, existing owner-authenticated `az rest --method POST --url "$url" --headers Content-Type=application/json --body "$body" --output none`. No login, secret retrieval, token argument, retries, hard-coded coordinates or app-only production connection. Print a generic success, not the permission response body. The owner is responsible for an admin session with authority to grant site permissions; PMO's delegated app cannot grant itself rights.
- [ ] Verify: `bash -n scripts/m365-grant-site-write.sh`; `node --test scripts/m365-grant-site-write.test.mjs`.

### A29 — backend invariants / bound-file completeness (AC-M365DOC-069–073)
- [ ] RED: complete supporting handler assertions for no content/storage calls, no raw data fields, pre-existing refs unchanged, no background work and read-batch compatibility. Add test for match-only inability to obtain create capability. Check four new RPCs have catalog inventory and denial witnesses; no client event-writer grant.
- [ ] GREEN: finish types/portable re-exports only where the tests require them. Run backend local gate below and capture RED/GREEN outputs, assertion-based mutation kills, effective pg_policies/table+column+function grants and EXPLAIN for candidate/folder lookup on synthetic larger fixtures. Do not run live grant or modify phase-2 UI.
- [ ] Verify: `node scripts/check-edge-fn-test-binding.mjs`; `deno test --config supabase/functions/m365-token-custody/deno.json --allow-env --allow-net --allow-read supabase/functions/m365-token-custody/recordFolders.test.ts supabase/functions/m365-token-custody/recordFolderWrite.test.ts supabase/functions/m365-token-custody/recordFolderBackfill.test.ts supabase/functions/m365-token-custody/documentLinking.test.ts`; `scripts/with-test-lock.sh bash -c 'cd pmo-portal && npm run typecheck && npx vitest run --changed origin/dev'`; `git diff --check`.

## Phase B — FE wiring **after phase 2 merges** (15 cycles)

**Dependency fence:** re-read merged picker/hooks/permission API and default/case adapters before this phase. The original plan names `MicrosoftDocumentPicker`, `LinkedDocumentCell`, `DocumentLinkPermissions`, `useMicrosoftDocuments`, `ProcurementMicrosoftReferences` and `M365DefaultLibraryCard`; they are not all shipped in this worktree. Do not create/overwrite those files in Phase A. If a target adapter is still absent after phase 2, finish that original plan's prerequisite first; the amendment does not silently absorb it. The interfaces below are the amendment's new files; adapt only mount syntax to the actual merged exports, not their behaviors.

### B01 — typed ensure transport (AC-M365DOC-071)
- [ ] RED: create `pmo-portal/src/lib/m365/__tests__/recordFolders.test.ts`; mock actual Supabase invoke boundary, require exact `{action:'ensure_record_folder',kind,id}`, `invokeWithTimeout`, validated UUID/result/keys, safe classified errors and no Graph/name/org/actor parameters. Re-exported types remain identical to server DTOs.
- [ ] GREEN: create `src/lib/m365/recordFolders.ts` with `ensureRecordFolder(target):Promise<RecordFolderOutcome>`; call existing custody endpoint and `classifyM365InvokeError` like `graphClient.ts`. Decode response into closed DTO, reject unexpected success shape with safe AppError. No response.error/message is rendered verbatim.
- [ ] Verify: `scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run src/lib/m365/__tests__/recordFolders.test.ts'`.

### B02 — backfill transport and repository seam (AC-M365DOC-071/072)
- [ ] RED: extend transport test for `linkExistingRecordFolders(cursor?):Promise<RecordFolderBackfillPage>` exact body, nonnegative counts, sum buckets=scanned, scanned≤5 and valid monotonic cursor. Add `src/lib/repositories/__tests__/m365-record-folders.test.ts` asserting assembled repository uses transport and preserves AppError codes.
- [ ] GREEN: add **`M365RecordFoldersRepository`** in `repositories/types.ts` with `ensure(target)` / `linkExisting(cursor?)`; add `m365RecordFolders` to Repositories and assembled `repositories/index.ts` using existing wrap pattern. Add transport function to `recordFolders.ts`; no DAL direct Graph call or client org threading. Reject malformed page before UI loop can continue.
- [ ] Verify: `scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run src/lib/m365/__tests__/recordFolders.test.ts src/lib/repositories/__tests__/m365-record-folders.test.ts'`.

### B03 — localized safe outcome/copy map (AC-M365DOC-071/072)
- [ ] RED: create `src/lib/m365/__tests__/recordFolderCopy.test.ts` with every §3.8 stable code, domain outcome, thrown Error carrying a raw marker, default failure and unknown outcome. Assert reviewed copy, both locale key trees and no scope/identifier/raw marker text. Confirm licence/access specifics appear only for a supported stable classification, not generic Graph failure.
- [ ] GREEN: create `src/lib/m365/recordFolderCopy.ts` returning translation keys/remedy enums, never arbitrary error.message. Add `public/locales/en/recordFolders.json` and `id/recordFolders.json`, keys `action.create`, `action.choose`, `action.reconnect`, `status.pending`, `status.linked`, `status.savedNotLinked`, `error.additionalConsent`, `error.access`, `error.defaultUnset`, `error.missingIdentifier`, `error.ambiguous`, `error.generic`, `backfill.start`, `backfill.stop`, `backfill.continue`, `backfill.progress`, `backfill.summary`. Use the exact reviewed English above and corresponding Indonesian, preserving count variables.
- [ ] Verify: `scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run src/lib/m365/__tests__/recordFolderCopy.test.ts'`; `node scripts/check-i18n-completeness.mjs`.

### B04 — non-blocking create-success coordinator (AC-M365DOC-071)
- [ ] RED: create `src/hooks/useStartRecordFolder.test.tsx`; mount the real coordinator in a save-success harness with repositories mocked, deferred never-settling folder promise, then each failure code/outcome/throw/timeout. Assert `start` returns void synchronously, saved-row heading stays rendered, folder state pending/failure separately, no unhandled rejection, automatic retry, duplicate ensure or raw marker. Test navigation/unmount and identity switch. B05/B06 then extend this file with the actual shipped create hooks and the canonical AC-071 table; do not claim a harness alone proves create-hook wiring.
- [ ] GREEN: create `src/hooks/useStartRecordFolder.ts`: capture org/user/target, cache key `['m365-record-folder',orgId,userId,kind,id]`, synchronous start writes pending then launches one caught promise; settle only for captured identity, invalidate proper register keys on actual linked/created/already_linked. Use no localStorage, timer, useEffect auto-start or mutation-returned folder promise. Use shell `useToast` and `useTranslation('recordFolders')` for pending/result notifications that survive the create dialog; suppress other-identity announcements. Unknown failures map safe generic. This starts only because a successful create calls it; B05–B06 bind those production hooks.
- [ ] Verify: `scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run src/hooks/useStartRecordFolder.test.tsx'`.

### B05 — start after actual project INSERT (AC-M365DOC-071)
- [ ] RED: extend `src/hooks/useProjects.test.tsx` and canonical coordinator test with actual create hook: row insert→folder start→existing ERP setup, response retains erpSetup and every original invalidation. A never-resolving folder promise cannot delay mutation; failed project insert starts nothing. Both Projects and Sales use this hook without page-specific folder calls.
- [ ] GREEN: `useProjects.ts::create.mutationFn` adds `start({kind:'project',id:row.id})` immediately after `repositories.project.create(input)` and before the existing `synchronizeErpProject` await. Gate automatic start using real-role document.create and impersonation state; no changes to ERP return/error contracts or project DAL. Do not duplicate start in `Projects.tsx` / `SalesPipeline.tsx`.
- [ ] Verify: `scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run src/hooks/useProjects.test.tsx src/hooks/useProjectMutations.test.tsx src/hooks/useStartRecordFolder.test.tsx'`.

### B06 — start after actual case INSERT (AC-M365DOC-071)
- [ ] RED: extend `src/hooks/useProcurementCrud.test.ts` and canonical coordinator test with allowed writer, Engineer/requester, impersonation, null project, missing code, failed INSERT and never-resolving folder promise. Allowed user starts once, Engineer saves case but no folder mutation; table row return type and list invalidation unchanged. Complete the canonical AC-071 aggregate table in `useStartRecordFolder.test.tsx` with both actual shipped create hooks across all safe failure classes.
- [ ] GREEN: make `useCreateProcurement.mutationFn` async, await only `repositories.procurement.create`, call synchronous start for `can('create','procDoc')` on real identity, return unchanged row. Keep `onSuccess` invalidation non-blocking. This covers global list and project-tab entry points without changing either modal or procurement financial transitions/import paths. **Director decision:** also start the same non-blocking ensure from the `onSuccess` of the existing procurement transition hook when the target status is `Requested` (the moment `pr_number` is stamped); RED test: a submit-to-Requested success starts exactly one ensure for that case, any other transition starts none, and a failed ensure leaves the transition result untouched. The transition RPC and its money/SoD behavior are not edited.
- [ ] Verify: `scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run src/hooks/useProcurementCrud.test.ts src/hooks/useStartRecordFolder.test.tsx'`.

### B07 — explicit ensure mutation and editor gating (AC-M365DOC-071)
- [ ] RED: create `src/hooks/useRecordFolder.test.tsx` and `src/components/m365/RecordFolderAction.test.tsx`; role matrix project/case, impersonation, existing any-folder/no connection, pending, failed retries, duplicate click. Assert one Create folder button, denied users never call seam, no auto invoke at mount/reconnect/refetch.
- [ ] GREEN: create `useRecordFolder.ts` with repository ensure mutation `retry:false`, same cache key/result reducer as start coordinator, target-scoped invalidation; create `RecordFolderAction.tsx` using real-role permission and shared Button `variant='outline'`, folder Icon, loading. `hasFolder` hides mutation regardless connection/default; missing connection still permits the explicit action to display setup recovery, not a silent automatic reconnect.
- [ ] Verify: `scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run src/hooks/useRecordFolder.test.tsx src/components/m365/RecordFolderAction.test.tsx'`.

### B08 — visible saved-record feedback / ambiguity picker (AC-M365DOC-071)
- [ ] RED: action test each failure/outcome; a raw marker never renders; pending→linked produces polite announcement, ambiguous→Choose existing folder invokes callback without another ensure, reconnect routes to existing flow, failure doesn't replace register or hide stored refs. No duplicate retry in toast and panel. Run axe and keyboard action assertions.
- [ ] GREEN: complete action's inline status/error/remedies using `recordFolderCopy` and translation namespace. Coordinator result lives in cache so the mounted register shows it after navigation. Use `role='status'` for progress/success and persistent reviewed failure region; keep one Create button and one optional Choose action, no custom modal. Reuse phase-2 picker callback on choice, reset its open state on close and return focus.
- [ ] Verify: `scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run src/components/m365/RecordFolderAction.test.tsx src/hooks/useStartRecordFolder.test.tsx'`.

### B09 — project register mount after phase 2 (AC-M365DOC-069/071)
- [ ] RED: create `pages/project-detail/tabs/__tests__/DocumentsTab.record-folder.test.tsx`; actual tab with one folder, only file refs, failure state and Engineer/PM/impersonation. Assert one action for authorized no-folder case, existing folder row opens directly independent of connection, new linked folder reload visible and no Issue/Approve/version controls.
- [ ] GREEN: mount `RecordFolderAction` once beside existing project Documents toolbar in `DocumentsTab.tsx`; derive hasFolder from actual rows source/kind, pass `{kind:'project',id:projectId}` and existing picker open callback. Preserve phase-2 file linking, controlled-file checks and table columns. No second button in page header or per-row Create actions.
- [ ] Verify: `scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run pages/project-detail/tabs/__tests__/DocumentsTab.record-folder.test.tsx'`.

### B10 — case register mount after parent adapter merges (AC-M365DOC-069/071)
- [ ] RED: create `pages/procurement/ProcurementMicrosoftReferences.record-folder.test.tsx`; actual adapter with overhead case, all purchase stages, folder-present, no-folder and requester-only viewer. One action only for procDoc writers, newly linked reference visible, existing direct-open retained on failure.
- [ ] GREEN: mount `RecordFolderAction` in merged `pages/procurement/ProcurementMicrosoftReferences.tsx`; use case ID, not project or PR child ID; derive hasFolder using procurement source/kind. Reuse its existing picker/refetch, never the case header-edit Draft/requester predicate. Do not edit ledger/transition/money APIs.
- [ ] Verify: `scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run pages/procurement/ProcurementMicrosoftReferences.record-folder.test.tsx'`.

### B11 — Admin foreground backfill component (AC-M365DOC-072)
- [ ] RED: create `src/components/m365/LinkExistingRecordFolders.test.tsx`; non-Admin/impersonation no action, Admin starts, two pages accumulate exact counts, last null completes, malformed counts fail safely. Assert only repository match-only method and no ensure/create calls. Default absent disables action with remedy.
- [ ] GREEN: create `LinkExistingRecordFolders.tsx` with `{defaultAvailable:boolean,disabled?:boolean}`; use `integration.manage`, sequential await of `linkExisting(cursor)` in one user-started run, local generation guard, counters, pending/progress/completion, shared Button/quiet summary. No hook effect auto-run. Invalidate affected project/procurement register families on completed page, never change default.
- [ ] Verify: `scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run src/components/m365/LinkExistingRecordFolders.test.tsx'`.

### B12 — stop, partial failure and explicit continuation (AC-M365DOC-072)
- [ ] RED: same RTL file: Stop while page deferred, page settles once then no next invoke; unmount stops scheduling, error keeps previous counts/cursor, Continue explicit, account/default change cancels, nonprogress next cursor fails, double click single run. Pending-page outcome remains labelled uncertain until settled, no false completed summary.
- [ ] GREEN: add cancellation/generation token and captured identity/default fingerprint. Stop blocks future pages, lets already-running page settle into current result only; component unmount ignores response and schedules nothing. Store last successful cursor/counts in component state, Continue begins only on click. Fatal error never loops or retries automatically. Announce counts politely; stop remains enabled during page work.
- [ ] Verify: `scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run src/components/m365/LinkExistingRecordFolders.test.tsx'`.

### B13 — mount on default-library card / localization (AC-M365DOC-072)
- [ ] RED: extend merged `src/components/integrations/__tests__/M365DefaultLibraryCard.test.tsx`: Admin action adjacent to chosen library, absent for members, disabled during set/clear/run, complete counts and failed-run recovery; no settings update from backfill. Add locale parity and axe to backfill tests.
- [ ] GREEN: mount `LinkExistingRecordFolders` in merged `M365DefaultLibraryCard.tsx`, using actual settings pending/read/tuple state and existing manage permission. Do not add it to personal connection or approval card, or infer a write grant from default/connection. Finalize en/id feature namespace; no common-catalog growth. Rebase locales on latest dev immediately before PR.
- [ ] Verify: `scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run src/components/integrations/__tests__/M365DefaultLibraryCard.test.tsx src/components/m365/LinkExistingRecordFolders.test.tsx src/lib/m365/__tests__/recordFolderCopy.test.ts'`; `node scripts/check-i18n-completeness.mjs`.

### B14 — one self-isolated mocked project journey (support AC-M365DOC-069/071)
- [ ] RED: create `pmo-portal/e2e/AC-M365DOC-069-record-folder-create.spec.ts` with `// @e2e-isolation: self-isolated — owns a uniquely named project and its reference; mocks custody, never changes org defaults/entitlements.` Title `AC-M365DOC-069 supporting mocked journey creates a project and opens its persisted folder`. Use real UI create with a unique explicit client code and real local Postgres; mock only custody/ERP external calls as needed. Intercept ensure and make a normal project-document register INSERT with that request's caller JWT and the A04 INSERT payload (not a service write), then return DTO. This mock models the external result without needing a shared org default; the real settings-fenced RPC is proved separately by pgTAP/Deno. Route caller settings/entitlement reads to a synthetic default in this page only if needed; never mutate org singleton. No served-function/CI condition/skip.
- [ ] GREEN: complete goal oracle: create→normal saved project heading before deferred ensure settles→Documents→persisted Folder row→reload still visible→Open folder uses expected new-tab URL, with no content/proxy download. Route the synthetic `https://example.invalid/**` destination in the browser context to a harmless local fixture response so this is not a real external network dependency. Inspect only this generated project/ref ID; assert one ensure and no further calls after reload. Capture project ID from successful create response before assertions; cleanup exact owned reference and parent in finally via existing local service test helper even if test fails. Mocked endpoint's caller-authenticated register INSERT exercises DB stamps/audit; pgTAP proves the guarded RPC and Deno separately proves real handler Graph behavior. Never claim this proves live Microsoft consent.
- [ ] Verify: `scripts/check-e2e-isolation.sh`; `scripts/e2e-local.sh --project=chromium AC-M365DOC-069-record-folder-create`.

### B15 — retained UI behavior and full amendment acceptance (AC-M365DOC-069–073)
- [ ] RED: finish cross-surface RTL assertions that a rejected/never-resolving folder call cannot alter create success/navigation, existing file linking, direct open, ERP setup result or purchasing stage. Preserve old AC-062's read-only **manual-link** tests; add explicit new-capability tests rather than deleting read-only oracles wholesale. Re-run original picker/cell tests on merged phase-2 code.
- [ ] GREEN: fix only actual regressions, maintain one owning proof per AC and ≥80% changed-line coverage. Complete local gate/reviews/rendered acceptance below; record evidence in the Director's private handoff or approved synthetic evidence artifact, not claimed passing in this plan. No production grant or live journey run by worker.
- [ ] Verify: `scripts/with-test-lock.sh bash -c 'cd pmo-portal && npm run typecheck && npx vitest run --changed origin/dev'`; `node scripts/check-edge-fn-test-binding.mjs`; `scripts/check-e2e-isolation.sh`; `git diff --check`.

## Local gate, reviews and acceptance (outside editing-cycle estimates)

All commands use the actual feature diff. No full local verify chain. Each DB reset+test holds **one DB lock**; test/typecheck uses test lock; DB→test if nested. Run the reset only in the DB-changing phase; FE journey uses the already-migrated stack, or reset+journey in one hold if another branch changed it.

```bash
# Typecheck + all changed-import tests; no test-name-only substitute at final gate.
scripts/with-test-lock.sh bash -c 'cd pmo-portal && npm run typecheck && npx vitest run --changed origin/dev'
node scripts/check-edge-fn-test-binding.mjs
deno test --config supabase/functions/m365-token-custody/deno.json --allow-env --allow-net --allow-read supabase/functions/m365-token-custody/recordFolders.test.ts supabase/functions/m365-token-custody/recordFolderWrite.test.ts supabase/functions/m365-token-custody/recordFolderBackfill.test.ts supabase/functions/m365-token-custody/documentLinking.test.ts
deno test supabase/functions/_shared/microsoftRecordFolder.test.ts supabase/functions/_shared/microsoftFolderConvention.test.ts
node --test scripts/check-m365-record-folder-reversal.test.mjs scripts/m365-record-folder-race.test.mjs scripts/m365-record-folder-write-mutation.test.mjs scripts/m365-grant-site-write.test.mjs
node scripts/m365-record-folder-write-mutation.mjs
# Migration phase only: touched tests and existing register/settings/audit regressions.
scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/m365_record_folder_link.test.sql supabase/tests/m365_record_folder_audit.test.sql supabase/tests/m365_record_folder_candidates.test.sql supabase/tests/m365_document_link_audit.test.sql supabase/tests/m365_document_settings.test.sql supabase/tests/m365_document_link_guards.test.sql supabase/tests/m365_procurement_links.test.sql && node scripts/check-m365-record-folder-reversal.mjs && node scripts/m365-record-folder-race.mjs && node scripts/check-isolation-denominator.mjs'
# FE phase only, touched cross-stack journeys (wrapper owns DB lock).
scripts/e2e-local.sh --project=chromium AC-M365DOC-069-record-folder-create
scripts/e2e-local.sh --project=chromium AC-DOC-001
scripts/e2e-local.sh --project=chromium AC-PROC-001
node scripts/check-i18n-completeness.mjs
scripts/check-e2e-isolation.sh
git diff --check
```

Run touched-file zero-warning lint with exact paths obtained from the actual diff (includes new files, excludes SQL/Markdown). This script is the runnable command, not a wildcard lint of the whole app:

```bash
python3 - <<'PY'
import subprocess
files = set()
for args in (
    ['git','diff','--name-only','--diff-filter=ACMR','origin/dev...HEAD'],
    ['git','diff','--name-only','--diff-filter=ACMR'],
    ['git','ls-files','--others','--exclude-standard'],
):
    for p in subprocess.check_output(args,text=True).splitlines():
        if p.startswith('pmo-portal/') and p.endswith(('.ts','.tsx','.js','.jsx','.mjs')):
            files.add(p.removeprefix('pmo-portal/'))
if files:
    subprocess.run(['npx','eslint','--max-warnings=0',*sorted(files)],cwd='pmo-portal',check=True)
PY
```

**Every code PR:** spec-reviewer, code-quality-reviewer and security-auditor, always. Review actual handler, caller JWT reads, separate write gate, default-site membership, effective grants/pg_policies, service-only receipt, concurrency, naming and no background retry. Security-critical gates require assertion-based mutation kills; a compilation error is not a killed policy oracle. Query-plan review uses effective indexed candidate/any-folder queries on synthetic larger data. Reviewers consume builder evidence and rerun only a doubtful targeted check. Unfixed security details stay private; repository visibility checked **PUBLIC** before writing this plan.

**FE Discover/Cover:** render rich synthetic rows for `/projects`, `/sales`, `/projects/:id/documents`, `/procurement`, `/projects/:id/procurement`, `/procurement/:id/documents`, `/administration/integrations`: en/id × light/dark ×390/1440. Check saved-record-first feedback, missing code/default/consent/access, slow/ambiguous result, existing folder without connection, Admin counts/Stop/Continue, keyboard/focus and no duplicate CTA. Deterministic RTL axe/locale/UTC/name/visual gates own known properties. Every Discover finding graduates to a test + affected routes×oracles cell in `docs/qa-portfolio.md` + `DESIGN.md`/`docs/decisions.md` retention note; fix and re-render until clean. Those implementation evidence updates are not files this planner edits.

**CI/release:** the **two unit shards** in the inspected `.github/workflows/ci.yml` matrix `[1,2]` (owner change recorded there 2026-10-20), verify and pgTAP gate each dev PR. Re-read that workflow at execution; never drop a configured shard. Browser integration only at lane closure via `scripts/ci-e2e.sh` under current throughput rules (≤2 logged concurrent dispatches); after every 2–3 dev slice merges use the logged dev run, and red dev stops new merges. Do not repeat the full suite on the Mac. Director owns approval and evidence; no attribution lines, bypass flags, commit/push/merge by this planner. Dev is the ceiling; production retains separate per-instance owner approval.

## Owner-only Microsoft input and honest completion

The script is **tested with a fake CLI only**. Director gives the owner its dry-run output privately; the owner chooses the intended site/app arguments and runs `--execute` themselves in their administrative Microsoft context. Delegated consent plus selected-site write grant plus the person's own Microsoft rights are all needed. Existing connections reconnect after the new consent; no DB scope backfill masquerades as consent. The app never performs the permission grant.

A code-green amendment may ship with FR-071 fallback before that owner action; it must not be reported as live folder creation proven. Keep live permit/deny, grant/reconnect and cross-system crash-gap observations private. AC-M365DOC-050 remains its separate owner-gated live linking journey; the new mocked e2e does not close it.

**Plan exit:** all five new ACs have named owning proofs and all technical choices above are decided. No additional product interview is required to write this plan. Before claiming the complete automatic-creation outcome, Director must acknowledge the existing nullable-code boundary: newly saved code-less cases use fallback until the case has a code; this plan deliberately does not change numbering. Backend implementation acceptance, merged UI prerequisites and the owner-run grant are delivery dependencies, not evidence already obtained by this planning task.
