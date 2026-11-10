# Microsoft 365 client self-serve setup — implementation plan (#1017)

- **Issue:** #1017 (owner ruling 2026-10-14). Related, shipped: #1014 (consent URL scope, fixed by
  `e7675ad3d`), #1016 (Features panel targets any org, closed 2026-11-04). No commit on `origin/dev`
  references #1017 yet.
- **Decides:** ADR-0063 (§3 + amendments 2026-07-24 and 2026-07-30), ADR-0064 (Option B escape hatch),
  ADR-0060 (token custody), ADR-0016/0019 (FE gate is UX only; server enforces).
- **Migration numbers:** 0816, 0817, 0818 only. Each has a `supabase/migrations/rollback/<NNNN>_<slug>_down.sql`.
- **AC prefix:** `AC-M365SS-###` (unused before this plan).

## 0. Goal and job story

> When my organisation uses its own Microsoft 365 app registration, I (the org Admin) want to enter
> its tenant id, client id and secret in PMO myself, approve it for my organisation, and have my team
> connect, so we can use Microsoft 365 without asking the platform operator for anything.

Done = an org Admin of an org on a plan that includes Microsoft 365 goes from nothing to a working
personal connection with zero operator actions, and orgs already running on the deployment-wide app
keep working unchanged.

## 1. Current state (grounded)

### 1.1 Entitlement — still needs an operator for most orgs
- The plan system already resolves `m365_integration` per org: global switch → per-org override →
  plan (`supabase/migrations/0532_plan_resolution.sql:34` `resolve_feature_internal`). The plan matrix
  turns it on from Growth up (`0531_plan_catalogue.sql:27`), existing orgs were assigned Enterprise
  (`0531_plan_catalogue.sql:47-51`) and orgs with no assignment fall back to Enterprise (0532).
- **But the M365 data-access gate ignores the resolver.** `authorizeMemberEntitled` reads the raw
  override row (`supabase/functions/m365-token-custody/auth.ts:91-100`): no `org_features` row means
  `NOT_ENTITLED`, even when the plan resolves the feature on. The callback's pre-store check does the
  same (`callback.ts:256-258`), and so does the connection write trigger
  (`supabase/migrations/0186_m365_membership_ban_hardening.sql:66-73`, `m365_connection_write_guard`).
- Meanwhile the setup/write actions also check the **resolved** switch
  (`index.ts:325-339` → `service_feature_enabled`, defined `0534_feature_enforcement.sql:74`). So today
  an org needs both: a plan that includes M365 **and** an operator-written override row. The second is
  the operator step #1017 removes. The FE card already gates on the resolved value
  (`M365ConnectionCard.tsx:162` `useFeature('m365_integration')`, resolved through
  `resolved_org_features`), so the FE shows a card the server then refuses.

### 1.2 App values — deployment-wide only
- The edge function builds one app identity per deployment (`m365-token-custody/index.ts:84-99`
  `buildEnv`: tenant id, client id, client secret, redirect URI, token-encryption key). `M365Env` is the
  only carrier (`types.ts:264-275`).
- Every Microsoft call site reads those deployment values:
  initiate (`initiate.ts:97-101`), org approval (`orgApproval.ts:90-98`), callback token exchange and
  tenant binding (`callback.ts:137-196`), refresh (`refresh.ts:92-93`), revoke (`revoke.ts:63-64`).
  Each site already has the org in hand (`initiate.ts:69`, the caller's org in `orgApproval.ts`,
  `pkce.orgId` in `callback.ts`, `connection.org_id` in `refresh.ts`, `orgId` at `revoke.ts:29`).
- **Per-org custody pattern to reuse:** `external-connect` validates the credential against the
  external system first, then writes it to Vault through a service-only security-definer RPC that
  re-checks Admin-of-org-or-Operator and active membership, and stores only a reference
  (`external-connect/index.ts:282-306` gates, `:386-406` store, RPC body
  `0450_connect_stage_marker_service_only.sql:20-77`). Reads go through `read_vault_secret` (`:444`) and
  the shared resolver `_shared/perOrgSecret.ts` (call site `external-connect/index.ts:431-447`).
  ⚑ `perOrgSecret.ts` itself is not readable to this planner (secret-named file, read rule); its contract
  is taken from those call sites.
- No per-org M365 table exists. `external_org_bindings` (`0096_erpnext_seam_tables.sql:28`) is the ERP/
  ClickUp binding; `IntegrationsView.tsx:261-265` explicitly keeps M365 out of it (no health probe, no
  ownership domains). This plan keeps that rule: M365 app values get their own table.

### 1.3 Approval link — works, already client-owned
- `initiate_org_approval` returns the admin-consent URL (scope fixed by #1014), gated Admin-of-org OR
  Operator (`orgApproval.ts:36-62`, reusing `_shared/adminOrOperator.ts`); persists nothing.
  FE: `M365OrgApprovalCard.tsx:37-60`, mounted at `IntegrationsView.tsx:266`, Admin-only on the FE.
- It builds the URL from the **deployment** tenant + client id only (`orgApproval.ts:86-93`). Under
  per-org values it must use the org's app, or the client approves the wrong app.

### 1.4 Activation / connect
- Personal connect, graph proxy, disconnect, status: active member of an entitled org
  (`auth.ts:72-103`, `resolveOrgOrResult` `:128-143`) — the 2026-07-30 amendment, shipped.
- The callback binds the issued tokens to the deployment tenant (`callback.ts:196`
  `claims.tid !== env.m365TenantId`). With per-org app values this must compare against the tenant of
  the app the org actually used.

### 1.5 What is left after this plan's scope
| Step | Today | After |
|---|---|---|
| Entitlement | plan **and** operator override row | plan only (resolver) |
| App values | deployment config (operator) | org Admin, per org in Vault; deployment values remain the fallback |
| Approval | org Admin, deployment app | org Admin, the org's resolved app |
| Connect | member, deployment app | member, the org's resolved app |

## 2. Design

### 2.1 Entitlement follows the resolved plan switch (slice S1)
One question, one answer everywhere: "is `m365_integration` on for this org?" = `resolve_feature_internal`.
- `auth.ts` replaces the raw `org_features` read with `serviceClient.rpc('service_feature_enabled', …)`
  (service-only twin, already used at `index.ts:328`). The caller-JWT client stays for nothing else in
  this function, so `authorizeMemberEntitled` drops its `callerClient` dependency for entitlement.
- `callback.ts:256` uses the same RPC.
- `m365_connection_write_guard` (0816) uses `resolve_feature_internal(NEW.org_id, 'm365_integration')`.
  It still takes `for update` on the org's `org_features` row **when one exists**, so 0115's lock order
  (profiles → org_features → connections) is unchanged for the override path.
- The operator override path (`operator_toggle_feature`, its disentitle cascade 0109) is untouched:
  an operator can still switch an org off, and that still purges connections.
- Commercial gating stays where the owner put it: the plan matrix. No org-Admin switch is added
  (the ruling allows "on by default or switchable"; the resolver already defaults on via the plan).

### 2.2 Per-org app values (slices S2, S3)
**Table `public.m365_org_apps`** (0817), one row per org:
`org_id uuid primary key references organizations on delete cascade, tenant_id text not null,
client_id text not null, secret_ref text not null, validated_at timestamptz not null,
configured_by uuid references profiles, updated_at timestamptz not null default now()`.
Checks: `tenant_id` and `client_id` are GUID-shaped (no `common`/`organizations`, which the callback's
tenant binding cannot support — `callback.ts:190-193`).
RLS enabled + forced, **no policies, no grants to anon/authenticated/service_role** (the 0530 pattern):
the only paths are the definers below. The FE never reads the table.

**Service-only definers** (`revoke all … from public, anon, authenticated; grant execute … to service_role`):
- `m365_set_org_app(p_org_id, p_tenant_id, p_client_id, p_secret_value, p_actor_id) returns jsonb`
  — requires `service_role`; `assert_is_active_member(p_actor_id)`; actor is Admin of `p_org_id` or a
  platform Operator (same predicate as `stage_vault_secret_for_org`, 0450:31-38); requires
  `resolve_feature_internal(p_org_id,'m365_integration')`. Locks the org's row, `vault.create_secret`
  with a generated name, upserts the row, deletes the previous Vault secret **after** the upsert in the
  same transaction, writes `log_audit('m365.app.configured' | 'm365.app.rotated', …)` with tenant id,
  client id and actor — never the secret or its reference. `p_secret_value` null = keep the stored
  secret (tenant/client edit only); allowed only when a row exists.
  Returns `{ changed_app: boolean }` (tenant or client id differs from the previous row).
- `m365_org_app_resolve(p_org_id) returns table(tenant_id text, client_id text, client_secret text)`
  — `service_role` only, reads the secret through Vault. Zero rows = org has no own app.
- `m365_clear_org_app(p_org_id, p_actor_id) returns void` — same actor gate; deletes the row and its
  Vault secret; audit `m365.app.cleared`.

**App change clears personal connections** (0818). Tokens are bound to the app that issued them; a new
tenant or client id makes every stored refresh token useless and the old tenant binding wrong. When
`m365_set_org_app` changes tenant or client id, or `m365_clear_org_app` runs, it deletes the org's
`ms_graph_connections` rows in the same transaction (lock order: org app row → connections, matching
0115's parent-first rule) and audits `m365.connection.cleared` with reason `app_changed`. A secret-only
rotation keeps connections (same app, tokens stay valid). Users see "Reconnect" (existing status path).

**Resolution order (edge):** org row → deployment values → `M365_APP_NOT_CONFIGURED` (typed 409).
Deployment values stay the fallback, so every org running today keeps working with no data change
(the operator path). An org Admin who saves values switches that org to its own app (Option B), which
is exactly "whoever owns the credential owns activation" applied per org.

### 2.3 Edge function (slice S3)
New module `supabase/functions/m365-token-custody/orgApp.ts`:
- `resolveOrgApp(deps, orgId): Promise<ResolvedApp | HandlerResult>` →
  `{ tenantId, clientId, clientSecret, source: 'org' | 'deployment' }`. Called only where Microsoft is
  asked for a token or a consent URL: initiate, org approval, callback, refresh, revoke. **Not** on the
  graph-proxy hot path (it uses the stored access token; refresh runs only on expiry) — so the extra
  RPC + Vault read is paid per token exchange, not per Graph call (perf P0).
- `handleSaveOrgApp(deps)` — action `save_org_app`, body `{ tenantId, clientId, clientSecret? }`.
  Order: verified JWT (index.ts, existing) → `requireM365Feature` (member + resolved switch, existing)
  → activation gate `authorizeAdminOrOperator` (moved from `orgApproval.ts:36` to export it; still its
  own decision, NFR-M365SEP-001) → bounded input validation (GUID shape; secret 1–1024 chars, trimmed)
  → **validate with Microsoft before any write**: client-credentials token request to the pinned
  Microsoft token host for that tenant with scope `https://graph.microsoft.com/.default`, through the
  existing deadline fetch. Microsoft `invalid_client`/`unauthorized_client` → 422 `APP_REJECTED`;
  unknown tenant → 422 `TENANT_REJECTED`; unreachable/deadline → 502 `MICROSOFT_UNREACHABLE` → nothing
  stored. When `clientSecret` is omitted the stored secret is used for validation (via
  `m365_org_app_resolve`). Then `m365_set_org_app`. Response never contains the secret.
- `handleOrgAppInfo(deps)` — action `org_app_info`, same gates. Returns
  `{ configured, source, tenantId, clientId, secretSet, validatedAt, callbackUrls: { connect, signIn } }`.
  `connect` = the deployment redirect value the callback already uses; `signIn` = the project's auth
  callback (`<supabase url>/auth/v1/callback`). Server is the single source, so the copyable URLs are
  always the ones Microsoft must hold. `secretSet` is a boolean; the secret is never returned.
- `handleClearOrgApp(deps)` — action `clear_org_app`, same gates.
- Wiring: `orgApproval.ts:90` builds the consent URL from the resolved app; `initiate.ts:97`,
  `callback.ts:137-196` (token exchange **and** the `tid` binding compare to the resolved tenant),
  `refresh.ts:92`, `revoke.ts:63` use the resolved client id/secret. The callback resolves by
  `pkce.orgId` (state row), never from request input.
- Redirect URI and token-encryption key stay deployment-wide (one callback per deployment; custody key
  is the platform's, ADR-0060).
- Logging: no secret, no Microsoft response body; error events carry only the typed code.

### 2.4 FE (slice S4, UI lane)
- `pmo-portal/src/components/integrations/M365AppRegistrationCard.tsx`, mounted in
  `IntegrationsView.tsx` directly above `<M365OrgApprovalCard />` (step order: app → approve → connect).
  Admin-only FE gate `may('manage','integration')` (stricter than the server, permitted by ADR-0016).
- Fields with the shared primitives (`TextField`, `FormGrid`, `FieldError`): Tenant ID, Client ID,
  Client secret (`type="password"`, `autoComplete="off"`, **write-only**: always rendered empty; when
  `secretSet` the helper text reads "A secret is saved. Enter a new one only to replace it."). Save
  calls `save_org_app`; errors via the M365 `errorCopy` code table (wire code only, never the raw
  message, as `M365OrgApprovalCard` does).
- Two copyable callback URLs from `org_app_info` (copy button + `aria-label`), each with one line of
  plain help ("Add this as a redirect URI in your app registration"; sign-in one marked "only if you use
  Microsoft sign-in").
- When `source === 'deployment'` the card says the org uses the platform-provided app and offers
  "Use our own app registration"; when `'org'`, "Remove our app registration" (ConfirmDialog — warns
  that everyone must reconnect).
- Confirm before saving a changed tenant/client id: "Everyone in your organization will need to
  reconnect Microsoft 365." (ConfirmDialog).
- Client: `pmo-portal/src/lib/m365/connectClient.ts` gains `getM365OrgApp`, `saveM365OrgApp`,
  `clearM365OrgApp` next to `initiateM365OrgApproval` (the established M365 edge seam; same timeout
  invoke). Hook `pmo-portal/src/hooks/useM365OrgApp.ts` (`useQuery` + mutation, invalidates on save).
- i18n: `integrations.m365App.*` in **both** `public/locales/en` and `public/locales/id`.

### 2.5 Docs (slice S5, docs-only, direct to dev)
- ADR-0063: amendment 2026-11-09 — activation owner follows credential owner **per org**; Option B
  app values are entered by the org Admin and held per org in Vault; entitlement is the resolved plan
  switch (no operator override needed); deployment values remain the fallback.
- `docs/runbooks/entra-option-b-setup.md`: §2 "create the credential and complete private
  configuration" becomes the in-app form; the operator steps move to an "orgs on the platform app" note.
- `docs/specs/m365-self-serve-setup.spec.md` (new) carrying FR/AC below;
  `docs/specs/m365-operator-client-separation.spec.md` step 1 note "superseded by #1017".

## 3. Acceptance criteria (owning layer)

| AC | Given / When / Then (short) | Owner test |
|---|---|---|
| AC-M365SS-001 | Given an org whose plan resolves M365 on and **no** override row, when an active member initiates connect, then it is authorized | vitest `tokenCustody.auth.test.ts` |
| AC-M365SS-002 | Given the plan resolves M365 off, when a member calls any data action, then `NOT_ENTITLED` | vitest `tokenCustody.auth.test.ts` |
| AC-M365SS-003 | Given resolved-on and no override row, when a connection row is written, then the write guard accepts it; resolved-off rejects `org_not_entitled` | pgTAP `m365_entitlement_resolved.test.sql` |
| AC-M365SS-004 | Given an operator override switching M365 off, when a connection is written, then rejected (override still wins) | pgTAP `m365_entitlement_resolved.test.sql` |
| AC-M365SS-005 | Given an org Admin, when they save valid values, then a row exists, the secret is only in Vault, and an audit row names tenant/client but no secret | pgTAP `m365_org_app_custody.test.sql` |
| AC-M365SS-006 | Given a non-Admin member / inactive Admin / Admin of another org, when `m365_set_org_app` runs for this org, then 42501 | pgTAP `m365_org_app_custody.test.sql` |
| AC-M365SS-007 | `anon`/`authenticated` cannot select `m365_org_apps` nor execute the three definers | pgTAP `m365_org_app_custody.test.sql` |
| AC-M365SS-008 | Given a saved app, when tenant or client id changes (or it is cleared), then the org's personal connections are removed and audited; a secret-only rotation keeps them | pgTAP `m365_org_app_change_clears_connections.test.sql` |
| AC-M365SS-009 | Given Microsoft rejects the values, when the Admin saves, then 422 and nothing is stored | vitest `tokenCustody.orgApp.test.ts` |
| AC-M365SS-010 | Given a project Manager (not Admin), when they call `save_org_app` / `org_app_info` / `clear_org_app`, then 403 | vitest `tokenCustody.orgApp.test.ts` |
| AC-M365SS-011 | `org_app_info` returns `secretSet: true` and never the secret or its reference | vitest `tokenCustody.orgApp.test.ts` |
| AC-M365SS-012 | Given an org with its own app, approval URL, initiate URL, token exchange, refresh and revoke all use the org's tenant/client id | vitest `tokenCustody.orgApp.test.ts` |
| AC-M365SS-013 | Given an org with its own app, a callback whose id_token tenant equals the **deployment** tenant but not the org's is rejected and nothing stored | vitest `tokenCustody.callback.test.ts` |
| AC-M365SS-014 | Given an org with no own app, every path uses the deployment values (existing orgs unchanged) | vitest `tokenCustody.orgApp.test.ts` |
| AC-M365SS-015 | Given neither own app nor deployment values, connect/approve return 409 `M365_APP_NOT_CONFIGURED` | vitest `tokenCustody.orgApp.test.ts` |
| AC-M365SS-016 | Served handler: `save_org_app` through `index.ts` validates then stores; body never echoes the secret | deno `orgAppServed.test.ts` |
| AC-M365SS-017 | Admin sees the form, secret field is always empty, the two callback URLs are copyable; non-Admin sees no card | vitest `M365AppRegistrationCard.test.tsx` |
| AC-M365SS-018 | Changing tenant/client id asks for confirmation; secret-only change does not | vitest `M365AppRegistrationCard.test.tsx` |

No new e2e journey: the save path depends on a live Microsoft token endpoint, which CI cannot reach,
so the cross-stack proof stays at the edge-handler (vitest + served deno) and pgTAP layers. The
existing integrations e2e that visits `/administration` integrations must still pass with the new card
(run `node scripts/affected-e2e.mjs` to list it; CI runs it on the release PR).

## 4. Slices, ship order and review

| Slice | Ships | Why alone | Review |
|---|---|---|---|
| **S1 entitlement resolver** (0816 + `auth.ts` + `callback.ts:256`) | alone, PR to dev | **auth** boundary (who may reach a token path) | 3 reviewers, security-auditor on **Opus**; mutation checks below |
| **S2 org app custody DB** (0817, 0818) | alone (with S3 in one branch is NOT allowed) | **token custody** (Vault secret) | 3 reviewers, security-auditor Opus; mutation checks |
| **S3 edge resolver + actions** | alone, after S2 is on dev | **token custody + auth** | 3 reviewers, security-auditor Opus; mutation checks |
| **S4 FE card** | UI lane, may batch with unrelated UI | UI only, no auth change | UI lane gates + Director rendered review |
| **S5 docs** | direct to dev after S3 merges | docs | — |

Deploy order at release: DB (0816–0818) → edge fn → FE (back to front).

### Mutation checks (required; each must turn the named tests red, then restore)
- S1: make `authorizeMemberEntitled` treat entitlement as always true → AC-M365SS-002 red. Make the
  write guard skip the resolver → AC-M365SS-003 (off case) red.
- S2: drop the Admin/Operator check in `m365_set_org_app` → AC-M365SS-006 red. Grant `authenticated`
  execute on `m365_org_app_resolve` → AC-M365SS-007 red. Skip connection deletion on app change →
  AC-M365SS-008 red.
- S3: build the consent URL from deployment values regardless of the org row → AC-M365SS-012 red.
  Write before validating → AC-M365SS-009 red. Compare `tid` to the deployment tenant → AC-M365SS-013
  red. Add the secret to the info response → AC-M365SS-011 red. Drop the activation gate from
  `save_org_app` → AC-M365SS-010 red.

## 5. Tasks (TDD: failing test first, 2–5 min each)

Owner rule 2026-11-09: tests are written, not run locally; CI is the gate. Local checks per task:
`npx eslint --max-warnings=0 <touched files>` (in `pmo-portal/`), `npm run check:guards`,
`deno check <touched edge files>`. Every brief must read the mocks of a changed module first
(`grep -rn "vi.mock(.*m365" pmo-portal/src`, and `m365MockDeps.ts`) and update them in the same branch.

### S1 — entitlement follows the plan (branch `fix/m365-entitlement-resolved-1017`)
1. **Red (vitest).** In `pmo-portal/src/lib/m365/__tests__/m365MockDeps.ts` make the
   `service_feature_enabled` rpc mock (line ~224) the entitlement source and stop seeding an
   `org_features` row by default. Add to `tokenCustody.auth.test.ts`:
   `it('AC-M365SS-001: an active member is authorized when the plan resolves M365 on and no override row exists')`
   and `it('AC-M365SS-002: a member is rejected NOT_ENTITLED when the plan resolves M365 off')`.
2. Update existing AC-M365SEP-005/012 cases in the same file to drive entitlement through the rpc
   mock (behaviour unchanged: non-entitled → `NOT_ENTITLED`). Do not delete them.
3. **Green.** `supabase/functions/m365-token-custody/auth.ts:91-100`: replace the `org_features`
   read with `serviceClient.rpc('service_feature_enabled', { p_org_id: orgId, p_key: 'm365_integration' })`;
   error or non-`true` → `NOT_ENTITLED`. Keep the three independent assertions and the comment's
   NFR references; update the header comment to say "resolved plan switch".
4. **Red (vitest).** `tokenCustody.callback.test.ts`:
   `it('AC-M365SS-001: the callback stores tokens when the plan resolves M365 on without an override row')`.
   **Green:** `callback.ts:256-258` uses the same rpc.
5. **Red (pgTAP).** New `supabase/tests/m365_entitlement_resolved.test.sql` (namespaced UUIDs,
   `begin … rollback`, `finish()`): `AC-M365SS-003` resolved-on, no override row → insert into
   `ms_graph_connections` succeeds; `AC-M365SS-003` org on Starter (plan off) → `throws_ok … '42501'`;
   `AC-M365SS-004` Enterprise org with override `enabled=false` → `throws_ok … '42501'`.
6. **Green.** `supabase/migrations/0816_m365_entitlement_resolved.sql`: `create or replace function
   public.m365_connection_write_guard()` = 0186 body, with the entitlement block replaced by
   `perform 1 from public.org_features where org_id = NEW.org_id and feature_key = 'm365_integration'
   for update;` (lock order kept) then `if not public.resolve_feature_internal(NEW.org_id,
   'm365_integration') then raise exception 'org_not_entitled' using errcode = '42501'; end if;`.
   Rollback `rollback/0816_m365_entitlement_resolved_down.sql` restores the 0186 body verbatim.
   Check `resolve_feature_internal` grants: the trigger is security definer, so no grant change.
7. Grep `supabase/tests` for `m365_connection_write_guard` and `org_not_entitled`
   (`0149_m365_cascade_triggers`, `0150_m365_race_lock`, `0151_m365_lock_order_reconcile`,
   `0178_m365_member_gate`): any test that relied on "no override row → rejected" now needs an org
   on a plan with M365 off; update the fixture, keep the assertion.
8. Mutation checks for S1 (§4), noted in the PR body as "written; CI proves".

### S2 — per-org app custody (branch `feat/m365-org-app-custody-1017`)
9. **Red (pgTAP).** New `supabase/tests/m365_org_app_custody.test.sql`:
   `AC-M365SS-005` Admin (via service role, `p_actor_id`) saves → row exists, `secret_ref` resolves in
   `vault.decrypted_secrets` to the value, `audit_events` row has `tenant_id`/`client_id` and no
   secret text (assert `detail::text not like '%<value>%'`); rotation deletes the old Vault secret.
   `AC-M365SS-006` Project Manager actor / deactivated Admin / Admin of org B / plan-off org → 42501.
   `AC-M365SS-007` `has_table_privilege('authenticated','public.m365_org_apps','select')` false;
   `has_function_privilege` false for anon + authenticated on all three definers; non-GUID tenant →
   check violation.
10. **Green.** `supabase/migrations/0817_m365_org_app_registration.sql`: table + checks + RLS enable/
    force + `revoke all … from public, anon, authenticated, service_role`; the three definers from §2.2
    (`security definer set search_path = public, vault`, first line `current_setting('role', true) <>
    'service_role'` → 42501). Rollback drops the definers, deletes the Vault secrets the table
    references, drops the table.
11. **Red (pgTAP).** New `supabase/tests/m365_org_app_change_clears_connections.test.sql`:
    `AC-M365SS-008` seed two connections; change client id → both gone + one audit row per connection
    with reason `app_changed`; secret-only rotation → both remain; clear → both gone.
12. **Green.** `supabase/migrations/0818_m365_org_app_change_clears_connections.sql`: re-create
    `m365_set_org_app` / `m365_clear_org_app` with the delete (lock org app row first, then
    `ms_graph_connections … for update`, then delete + audit). Rollback restores 0817 bodies.
13. Inventories: add `m365_org_apps` to `supabase/tests/0137_service_role_grants.test.sql` (no
    service_role table grant, by design) and the three definers to
    `supabase/tests/0210_service_only_definers_execute_grants.test.sql`; confirm
    `0178_anon_executable_definers.test.sql` count is unchanged (none anon-executable); check
    `0136_posture_b_side_mirror_droppable.test.sql` inventory. Add to
    `scripts/isolation-probe-denominator.json`: table `m365_org_apps` (`b_read: none`) and the three
    definer signatures; `node scripts/check-isolation-denominator.mjs --self-test` (allowed: node script).
14. Mutation checks for S2 (§4).

### S3 — edge resolver and setup actions (branch `feat/m365-org-app-edge-1017`, after S2 on dev)
15. **Red (vitest).** New `pmo-portal/src/lib/m365/__tests__/tokenCustody.orgApp.test.ts`, using
    `m365MockDeps.ts` (add an `m365_org_app_resolve` rpc mock returning zero or one row, and
    `m365_set_org_app` / `m365_clear_org_app` spies):
    `AC-M365SS-014: with no org app, approval/initiate/refresh/revoke use the deployment values`;
    `AC-M365SS-012: with an org app, the consent URL, authorize URL, token exchange, refresh and revoke carry the org's tenant and client id`;
    `AC-M365SS-015: with neither, initiate_connect and initiate_org_approval return 409 M365_APP_NOT_CONFIGURED`.
16. **Green.** `supabase/functions/m365-token-custody/orgApp.ts` `resolveOrgApp`; add
    `M365_APP_NOT_CONFIGURED` to the error map in `types.ts` (409) and to
    `pmo-portal/src/lib/m365/errorCopy.ts` (+ its test `errorCopy.test.ts`). Wire `orgApproval.ts:90`,
    `initiate.ts:97`, `refresh.ts:92`, `revoke.ts:63`.
17. **Red (vitest).** `tokenCustody.callback.test.ts`:
    `AC-M365SS-013: with an org app, an id_token whose tenant is the deployment tenant is rejected and nothing is stored`;
    `AC-M365SS-012: the callback exchanges the code with the org app's client id and secret`.
    **Green:** `callback.ts:137-196` resolves by `pkce.orgId`; `isValidTenant` + `tid` compare use the
    resolved tenant.
18. **Red (vitest).** In `tokenCustody.orgApp.test.ts`:
    `AC-M365SS-009: Microsoft invalid_client → 422 APP_REJECTED and m365_set_org_app is never called`;
    `AC-M365SS-009: Microsoft unreachable → 502 MICROSOFT_UNREACHABLE and nothing stored`;
    `AC-M365SS-010: a Project Manager gets 403 on save_org_app, org_app_info and clear_org_app`;
    `AC-M365SS-011: org_app_info returns secretSet true and the response JSON contains neither the secret nor a secret reference`;
    `AC-M365SS-009: a malformed tenant id is 400 before any Microsoft call`.
19. **Green.** `orgApp.ts` `handleSaveOrgApp`, `handleOrgAppInfo`, `handleClearOrgApp`; export
    `authorizeAdminOrOperator` from `orgApproval.ts` (no behaviour change); route the three actions in
    `index.ts` (add to `M365_FEATURE_ACTIONS` so `requireM365Feature` runs first); add the action names
    to the `M365Request` union in `types.ts`.
20. **Red (deno).** New `supabase/functions/m365-token-custody/orgAppServed.test.ts` importing
    `handler` from `./index.ts` with `recordFolderTestKit.ts`, mocking `globalThis.fetch` for the
    Microsoft token host: `AC-M365SS-016: save_org_app validates with Microsoft, then stores; the response never echoes the secret`.
    `node scripts/check-edge-fn-test-binding.mjs` (allowed: node script) and `deno check` the touched files.
21. Update the existing `tokenCustody.orgApproval.test.ts` AC-M365SEP-013 case ("URL bound to env"):
    it now asserts "bound to the resolved app"; keep the never-caller-supplied assertion.
22. Mutation checks for S3 (§4).

### S4 — FE card (branch `feat/m365-app-card-1017`, UI lane, after S3 on dev)
23. **Red (vitest).** `pmo-portal/src/lib/m365/__tests__/connectClient.test.ts`: the three new client
    functions post the right action and surface the wire code only.
    **Green:** `pmo-portal/src/lib/m365/connectClient.ts`.
24. **Red (vitest).** New `pmo-portal/src/components/integrations/__tests__/M365AppRegistrationCard.test.tsx`:
    `AC-M365SS-017: an Admin sees tenant, client and an empty secret field even when a secret is saved`;
    `AC-M365SS-017: both callback URLs from org_app_info render with a working copy button`;
    `AC-M365SS-017: a non-Admin sees no card`;
    `AC-M365SS-018: changing the client id asks for confirmation before saving; a secret-only change saves directly`;
    `AC-M365SS-009: a rejected save shows the localized APP_REJECTED copy, not the server message`.
25. **Green.** `M365AppRegistrationCard.tsx` + `pmo-portal/src/hooks/useM365OrgApp.ts`; mount in
    `IntegrationsView.tsx` above `M365OrgApprovalCard`. Update `IntegrationsView` tests that count or
    mock the M365 cards (`grep -rn "M365OrgApprovalCard" pmo-portal/src`).
26. i18n `integrations.m365App.*` in `pmo-portal/public/locales/en/*.json` and `…/id/*.json`; keep
    `scripts/i18n-common-keys-baseline.json` passing.
27. UI lane gates (eslint on touched files, check:guards); `scripts/ux-proof.sh` on the integrations
    route runs in CI/Director review per the no-local-testing rule. Director rendered review: empty,
    deployment-app, own-app, saving, rejected, confirm states.

### S5 — docs (direct to dev, after S3 merges)
28. ADR-0063 amendment 2026-11-09 (§2.5). 29. Runbook `docs/runbooks/entra-option-b-setup.md` §2 →
in-app form. 30. Spec `docs/specs/m365-self-serve-setup.spec.md` (FR/AC from §3) + supersede note in
`m365-operator-client-separation.spec.md`. 31. Roadmap/backlog line for #1017.

## 6. Risks and follow-ups
- **Plan downgrade keeps stored connections.** With entitlement on the resolver, a plan change that
  turns M365 off makes every M365 action refuse (gate + write guard) but does not purge stored
  connections the way the operator override does (0109). Follow-up issue: purge on resolved off-flip.
  Not a blocker: nothing can use them while off.
- **First client on the deployment app.** Untouched by default. Moving it to its own per-org values
  is an Admin action in the new card at the next secret rotation (runbook note), then the deployment
  values can be retired per deployment.
- **Secret expiry.** Entra secrets expire; `validated_at` is shown in the card. A reminder before
  expiry is a follow-up (Microsoft does not expose the expiry through the client-credentials call).

## 7. Owner decisions
1. **Microsoft sign-in (SSO) for an org on its own app stays a deployment setting, out of this scope.**
   Self-serve covers the Microsoft 365 connection (documents, approval, personal connect). Sign-in uses
   the project's auth provider configuration, which is per deployment, not per org. The card shows the
   sign-in callback URL as information only. *Recommended default: yes, out of scope; file a follow-up
   if a client needs self-serve sign-in.*

Director-level (decided here, not owner): own table over `external_org_bindings`; app change clears
personal connections; deployment values remain the fallback; no org-Admin entitlement switch (the plan
already defaults on).
