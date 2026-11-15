# Microsoft 365 self-serve setup — spec (#1017)

Status: S1–S3 built on `dev`; S4 (screen) not built. Derived from shipped code, 2026-11-15.
Decides: ADR-0063 amendment 2026-11-15, ADR-0064 (Option B). Plan: `docs/plans/2026-11-09-m365-self-serve-setup.md`.
Citations: `M` = `supabase/migrations/`, `F` = `supabase/functions/m365-token-custody/`.

## Functional requirements (built)

- **FR-M365SS-001** — The connection write guard shall allow a connection write only when `resolve_feature_internal(org, 'm365_integration')` is true. `M/0816_m365_entitlement_resolved.sql:26-30`
- **FR-M365SS-002** — The data-access gate and the callback shall read entitlement through `service_feature_enabled` (the resolved switch). `F/auth.ts` (requireEntitlement branch), `F/callback.ts` (entitled check)
- **FR-M365SS-003** — Where a caller disconnects their own connection, the system shall not require entitlement. `F/revoke.ts:~20` (`requireEntitlement: false`)
- **FR-M365SS-004** — The system shall store each organisation's app as tenant id, client id (both GUID-checked), secret reference and validation time, one row per organisation. `M/0817:41-54`
- **FR-M365SS-005** — The secret value shall live only in Vault; the table shall have forced RLS, no policy and no API-role grant. `M/0817:59-61,100-102`
- **FR-M365SS-006** — When `m365_set_org_app` runs, it shall require the service role, an active actor, and an Admin of that org or a platform operator, and a resolved-enabled M365 switch. `M/0818:19-33`
- **FR-M365SS-007** — When a save omits the secret, the system shall keep the stored secret; when no app exists the secret shall be required. `M/0818:41-50`
- **FR-M365SS-008** — When a secret is replaced, the system shall delete the previous Vault secret in the same transaction. `M/0818:61-64`
- **FR-M365SS-009** — Before storing, `save_org_app` shall request a client-credentials token with the submitted values and store nothing unless Microsoft accepts; wrong directory → `TENANT_REJECTED`, rejected app → `APP_REJECTED`, unreachable → `MICROSOFT_UNREACHABLE`. `F/orgApp.ts:54-73`
- **FR-M365SS-010** — `save_org_app`, `org_app_info` and `clear_org_app` shall be limited to an Admin or operator of the caller's own organisation. `F/orgApp.ts:27-36`
- **FR-M365SS-011** — `org_app_info` shall return configured state, source, ids and the two callback values, and never the secret or a timestamp. `F/orgApp.ts:76-87`
- **FR-M365SS-012** — Each Microsoft call (connect, org approval link, callback exchange, refresh, revoke) shall use the organisation's app. `F/initiate.ts:103`, `F/orgApproval.ts:99`, `F/callback.ts` (resolveOrgApp), `F/refresh.ts:83`, `F/revoke.ts:55`
- **FR-M365SS-013** — The callback shall bind issued tokens to the resolved directory (`tid` must equal it). `F/callback.ts:203`
- **FR-M365SS-014** — Where the organisation has no app, the system shall use the deployment app. `F/orgApp.ts:13-15`
- **FR-M365SS-015** — If neither exists, the system shall refuse with `M365_APP_NOT_CONFIGURED` before creating any state. `F/orgApp.ts:14`
- **FR-M365SS-016** — Saves shall be rate-limited to 5 per minute per user and a secret over 1024 characters refused. `F/orgApp.ts:41-46`
- **FR-M365SS-017** — When tenant or client id changes, or the app is cleared, the system shall delete the organisation's personal connections with one audit row each; a secret-only change shall keep them. `M/0818:72-79,111-117`
- **FR-M365SS-018** — Audit events shall record ids and actor, never the secret or its reference. `M/0817` (`log_audit` calls)
- **FR-M365SS-019** — Refresh and revoke shall refuse when a connection's stored tenant differs from the resolved app's. `F/refresh.ts:83`, `F/revoke.ts:55`

## Acceptance criteria

- **AC-M365SS-001** Given a plan that includes M365 and no override row, When a member's connection is written, Then it succeeds (FR-001). pgTAP `m365_entitlement_resolved.test.sql`
- **AC-M365SS-002** Given an override of enabled=false, When a connection is written, Then it is refused (FR-001). same file
- **AC-M365SS-005** Given an Admin saves an app, When the table is read, Then it holds a reference not the secret, and rotation removes the old secret (FR-004/005/008). pgTAP `m365_org_app_custody.test.sql`
- **AC-M365SS-006** Given a non-Admin, other-org Admin or plan-off org, When save or clear runs, Then it is refused (FR-006). same file
- **AC-M365SS-007** Given `authenticated` or `anon`, When it selects the table or executes the functions, Then privilege is denied (FR-005). same file
- **AC-M365SS-009** Given invalid credentials, an unknown directory or Microsoft down, When save runs, Then nothing is stored (FR-009). Deno `orgAppServed.test.ts:90,136,148`
- **AC-M365SS-010** Given a non-Admin, When any app action runs, Then 403 (FR-010). `orgAppServed.test.ts:7`
- **AC-M365SS-011** Given an Admin, When info runs, Then no secret material appears (FR-011). `orgAppServed.test.ts:60`
- **AC-M365SS-012** Given two orgs with different apps, When each connects, approves, refreshes or revokes, Then each uses its own (FR-012). `orgAppServed.test.ts:16,33,45`
- **AC-M365SS-014** Given no org app, When connect or refresh runs, Then the deployment app is used (FR-014). `orgAppServed.test.ts:102,123`
- **AC-M365SS-015** Given neither app, When connect runs, Then 409 and no state (FR-015). `orgAppServed.test.ts:102`
- **AC-M365SS-017** Given connections exist, When the client id changes or the app is cleared, Then they are deleted and audited; When only the secret changes, Then they remain (FR-017). pgTAP `m365_org_app_change_clears_connections.test.sql`
- **AC-M365SS-016** Given a sixth save within a minute, Then 429 (FR-016). `orgAppServed.test.ts:200`

## Future (not built — not requirements met)

- **FUT-M365SS-001** Integrations screen to enter, edit and clear the org app, show callback values and a "reconnect" state after a change (S4).
- **FUT-M365SS-002** Guided approval and first-connection check inside that screen.
- **FUT-M365SS-003** Expiry reminder for the stored secret (no expiry is tracked today).
