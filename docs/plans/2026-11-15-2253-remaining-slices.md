# Per-organization Microsoft 365: remaining slices — implementation plan (#2253)

- **Issue:** #2253 (map #2251, ADR-0101). Builds on #1017: S1–S3 are on `dev` (#2270, migrations
  0816–0818); S4 (setup card, branch `feat/1017-s4-m365-setup-card`) is built and waiting to merge, and part
  of S5 already landed on `dev` on its own (`docs/runbooks/entra-option-b-setup.md`, ADR-0063) while the S5
  spec text (`origin/docs/1017-s5-m365-docs`) did not — re-check both branches before relying on them.
  This plan covers the three follow-on slices
  named on the issue (comment 2026-11-14): **K** per-org key separation for stored connections,
  **P** a two-org database access proof, **C** a CLI status command.
- **Decides / reads:** ADR-0060 §3 (app-layer AES-256-GCM, `key_id` is a reference), §6 (refresh-token
  rotation), §9 (per-row `org_id` scoping plus per-tenant key derivation as the pooled-model boundary),
  ADR-0101 (one shared hosted project), ADR-0016/0019 (FE gate is UX only; server enforces), ADR-0010
  (one owning test per AC).
- **Migration numbers:** `NNNN-K1`, `NNNN-K2`, `NNNN-C1` placeholders. **The coordinator assigns the real
  numbers** at branch time (`scripts/renumber-migration.sh` if a collision appears). Every migration has a
  `supabase/migrations/rollback/<NNNN>_<slug>_down.sql`.
- **AC prefix:** `AC-M365KS-###` (key separation), `AC-M365ISO-###` (two-org proof),
  `AC-CLI-M365-###` (CLI). None are used before this plan.
- **Ship tier:** K is **token custody** and ships alone. P is test + manifest only and may ship with K's
  branch or right after it. C touches an auth-checked read path and ships alone. All three get the three
  reviewers with the security-auditor on the top model tier.

## Owner questions (one line each, with the default this plan builds)

1. Per-org key = HKDF of the deployment token key with a per-org random salt held in a locked table (crypto-shred by deleting the salt); **default: yes** (alternative: a separately held key per org, more operator work per client).
2. Run the re-key sweep from the CLI as `pmo m365 rekey` (Admin only, `--dry-run`) in slice C; **default: yes**.
3. After every stored connection is on the per-org format, retire the legacy read path in a later release; **default: keep it one release, then remove it in a follow-up issue**.
4. Extend the same per-org key format to other stored integration credentials (ERP, ClickUp) held per org in Vault; **default: no, they are already per-org rows in Vault; revisit under #2251 only if a client contract asks**.

## 0. Goal and job story

> When two client organizations share one hosted project, I (the platform owner) want each
> organization's stored Microsoft 365 tokens to be encrypted under a key that belongs to that
> organization alone, proven at the database layer that one organization cannot reach the other's
> connection, app or key rows, and visible from the CLI, so a second client can go live without me
> reasoning about one shared key or reading tables by hand.

Done = (K) every new or refreshed connection is stored under its organization's key, existing
connections move over with no user action and no outage, and the move can be rolled back;
(P) one pgTAP file seeds two organizations and proves every M365 table and definer refuses the other
organization, and the isolation-probe manifest lists every new surface; (C) `pmo m365 status` shows
the organization's app source and key-format progress, and `pmo m365 rekey` drives the sweep.

## 1. Grounding (shipped code this plan changes)

| Surface | File:line | What it does |
|---|---|---|
| Envelope | `pmo-portal/src/lib/m365/graphTokenCrypto.ts` `encryptToken`/`decryptToken` | AES-256-GCM, 12-byte IV, `iv ‖ ct+tag` in one `bytea` |
| Key resolver | `supabase/functions/m365-token-custody/crypto.ts` `resolveKek(env, keyId)` | accepts only `kek-v1`, throws on any other id |
| Encrypt sites | `callback.ts:281-283`, `refresh.ts:136-138` | encrypt with `resolveKek(env,'kek-v1')`; callback stamps `p_key_id: 'kek-v1'` (`callback.ts:308`) |
| Decrypt sites | `refresh.ts:55`, `revoke.ts:59`, `graphRead.ts:968`, `graphRead.ts:1002` | decrypt with `resolveKek(env, connection.key_id)` |
| Store | `supabase/migrations/0106_ms_graph_connections.sql` (`key_id text not null`, RLS forced, no policy) | one row per (org, user) |
| Writers | `m365_upsert_connection` (`0115:40-92`), `m365_finish_refresh` (`0340:2-35`) | parent-first lock order profiles → org_features → connections; `m365_finish_refresh` compares the expected refresh ciphertext and does not take a key id |
| Envelope check | `0151_m365_ciphertext_envelope_check.sql:26-34` | ciphertext shape constraints |
| Actor gate pattern | `0817_m365_org_app_registration.sql:40-53` | service role → active actor → Admin of org or platform operator → resolved M365 switch |
| Probe manifest | `scripts/isolation-probe-denominator.json` (`tables`, `definer_functions`, `edge_functions`, `buckets`, `rpcs`), guard `scripts/check-isolation-denominator.mjs` (both directions, `--self-test`) | runtime probe `scripts/isolation-probe.sh` |
| CLI | `scripts/pmo.mjs:1288-1296` `m365(ctx, positionals)` — `status` reads library settings, last folder sweep and `connection_status` | tests use the `fake`/`cli` helpers in `scripts/pmo-ops.test.mjs:30-66` |

## 2. Design

### 2.1 Slice K — per-org key separation

**Key format.** Two `key_id` forms coexist:
- `kek-v1` — the existing deployment key, no associated data. Read-only after the write switch flips.
- `org-v1:<generation>` — key = `HKDF-SHA256(ikm = deployment token key, salt = the org's salt for that
  generation, info = "pmo/m365-token/org-v1/" + org_id)`, 32 bytes. AES-GCM **additional data** =
  UTF-8 of `org_id + ":" + user_id + ":" + ("refresh" | "access")`. A ciphertext copied to another
  org's or user's row, or swapped between the two columns, fails GCM authentication even under the
  same derived key.

**Table `public.m365_org_token_keys`** (`NNNN-K1`):
`org_id uuid not null references organizations on delete cascade, generation int not null check
(generation between 1 and 999999999), salt bytea not null check (octet_length(salt) = 32),
created_at timestamptz not null default now(), retired_at timestamptz, primary key (org_id, generation)`;
partial unique index `(org_id) where retired_at is null` (one active generation per org).
RLS enabled + forced, no policy, `revoke all … from public, anon, authenticated, service_role` (the
0817 pattern). Deleting an org deletes its salts, so its stored tokens become undecryptable
(crypto-shred), matching the existing connection cascade.

**`ms_graph_connections.key_id` check** (`NNNN-K1`): `check (key_id = 'kek-v1' or key_id ~
'^org-v1:[1-9][0-9]{0,8}$')`, added `not valid` then `validate constraint` in the same migration (no
long lock: the validate scan takes `share update exclusive`).

**Service-only definers** (`NNNN-K1`, `security definer set search_path = public`, first statement
`current_setting('role', true) <> 'service_role'` → 42501; `revoke all … from public, anon,
authenticated; grant execute … to service_role`):
- `m365_org_token_key_current(p_org_id uuid) returns table(generation int, salt bytea)` — returns the
  active generation; creates generation 1 with `gen_random_bytes(32)` (pgcrypto, 0001; this definer's `search_path = public, extensions`) under
  `insert … on conflict do nothing` + re-select when none exists (race-safe).
- `m365_org_token_key_salt(p_org_id uuid, p_generation int) returns bytea` — null for an unknown
  (org, generation); never another org's row.
- `m365_org_token_key_rotate(p_org_id uuid, p_actor_id uuid) returns int` — 0817 actor gate; locks the
  org's key rows `for update`; retires the active generation (`retired_at = now()`), inserts
  `max(generation)+1`; audits `m365.token_key.rotated` with org and generation only.
- `m365_org_token_key_purge(p_org_id uuid, p_actor_id uuid) returns int` — 0817 actor gate; deletes
  retired generations that no connection references (`not exists (select 1 from ms_graph_connections
  where org_id = p_org_id and key_id = 'org-v1:' || generation)`); returns the count; audits
  `m365.token_key.purged`.
- `m365_rekey_connection(p_org_id uuid, p_connection_id uuid, p_expected_refresh_token_ciphertext
  bytea, p_refresh_token_ciphertext bytea, p_access_token_ciphertext bytea, p_key_id text) returns uuid`
  — parent-first locks (profiles → org_features → connection, as 0115), then
  `update … set refresh_token_ciphertext, access_token_ciphertext, key_id, updated_at = now()
  where id = p_connection_id and org_id = p_org_id and refresh_token_ciphertext =
  p_expected_refresh_token_ciphertext and status = 'active' returning id`. Returns null when a
  concurrent refresh won (the sweep skips it; the refresh already wrote the new format).
  `p_key_id` must name the org's active generation, else 22023.
- `m365_finish_refresh` gains `p_key_id text default null` (`NNNN-K2`: `drop function` of the 0340
  signature + `create` with the extra trailing parameter; body = 0340 with `key_id = coalesce(p_key_id,
  key_id)` in the update). Null keeps the stored id, so a refresh from an edge build that has not
  deployed yet behaves exactly as 0340. Grants re-applied.
- `m365_upsert_connection` is unchanged: it already takes `p_key_id`.
- `m365_org_key_status(p_org_id uuid) returns jsonb` — service only, counts only:
  `{ "active_generation": int|null, "connections": { "<key_id>": count, … } }`. Used by slice C.

**Edge module `supabase/functions/m365-token-custody/keyring.ts`:**
- `deriveOrgKey(master: Uint8Array, salt: Uint8Array, orgId: string): Promise<Uint8Array>` (Web Crypto
  HKDF, pure).
- `tokenAad(orgId, userId, column: 'refresh' | 'access'): Uint8Array`.
- `resolveReadKey(deps, connection): Promise<{ key: Uint8Array; aad?: Uint8Array }>` —
  `kek-v1` → master, no AAD; `org-v1:<g>` → `m365_org_token_key_salt(connection.org_id, g)`, null salt →
  typed `M365_KEY_UNAVAILABLE` (500, token-free error event); any other id → the same typed error.
- `resolveWriteKey(deps, orgId): Promise<{ keyId: string; key: Uint8Array }>` — when the deployment's
  write mode is `org`, `m365_org_token_key_current` → `org-v1:<g>`; when `legacy`, `kek-v1`.
  Write mode is one new `M365Env` field `tokenWriteMode: 'legacy' | 'org'` read in `buildEnv`
  (`index.ts:84-99`); missing or unknown value = `legacy`.
- Per-isolate cache of derived keys keyed by `(org_id, generation)`, TTL 300 s. A salt never changes
  for a generation, so a cached key is correct for its lifetime; `graphRead.ts` decrypts per Graph call,
  so the cache keeps the extra RPC off that hot path.
- `graphTokenCrypto.ts` `encryptToken`/`decryptToken` gain an optional trailing `aad?: Uint8Array`
  passed as `additionalData`; omitted = today's bytes exactly (the `kek-v1` vectors in
  `graphTokenCrypto.test.ts` must stay green unchanged).

**Edge action `rekey_org_tokens`** (`orgKeys.ts`): body `{ limit?: 1..50, dryRun?: boolean }`. Gates in
order: verified JWT → `requireM365Feature` → `authorizeAdminOrOperator` (exported by `orgApproval.ts`)
→ rate limit (`checkRequestRate`, 5/min). Selects up to `limit` active connections of the caller's org
whose `key_id` differs from the current write key; for each: decrypt with `resolveReadKey`, encrypt
both tokens with `resolveWriteKey` + AAD, call `m365_rekey_connection`. Returns
`{ scanned, rekeyed, skipped_concurrent, remaining }` (counts only). Also exposes action
`rotate_org_token_key` (same gates) → `m365_org_token_key_rotate`, and `purge_org_token_keys` →
`m365_org_token_key_purge`. All three join `M365_FEATURE_ACTIONS` (`index.ts:318`).

**Rotation and migration path (no downtime):**
1. **Deploy DB** (`NNNN-K1`, `NNNN-K2`). Nothing writes `org-v1` yet; the new `m365_finish_refresh`
   parameter defaults null; the running edge build keeps working.
2. **Deploy edge** with `tokenWriteMode = legacy`. Readers now accept both formats; writers still
   write `kek-v1`. Pure no-op for stored rows.
3. **Flip write mode to `org`** (deployment setting, no redeploy of DB). New connects and every refresh
   write `org-v1:1`. An active user's access token refreshes within about an hour of use, so active
   connections migrate on their own.
4. **Sweep idle rows**: `pmo m365 rekey` (or the edge action) per org until `remaining = 0`.
   Compare-and-swap on the refresh ciphertext makes a sweep racing a refresh lose harmlessly.
5. **Per-org rotation** later: `rotate_org_token_key` → generation n+1 becomes the write key; repeat
   step 4; `purge_org_token_keys` deletes generation n once nothing references it.

**Rollback:**
- From step 3: flip write mode back to `legacy`. Readers still decrypt `org-v1` rows, so nothing
  breaks; new writes return to `kek-v1`.
- Full rollback (remove the reader): first run the sweep with write mode `legacy` (it re-keys every
  `org-v1` row back to `kek-v1` — the sweep targets "differs from current write key", so it works in
  both directions), then deploy the previous edge build, then the down migrations.
  `rollback/NNNN-K1_…_down.sql` starts with
  `do $$ begin if exists (select 1 from public.ms_graph_connections where key_id <> 'kek-v1') then
  raise exception 'rekey to kek-v1 before rollback' using errcode = 'P0001'; end if; end $$;`
  so the down migration can never strand undecryptable rows. `rollback/NNNN-K2_…_down.sql` restores the
  0340 signature and body verbatim.

### 2.2 Slice P — two-org database access proof

**pgTAP `supabase/tests/m365_two_org_isolation.test.sql`.** Seeds org A and org B, each with an active
Admin, an active Project Manager, an `ms_graph_connections` row, an `m365_org_apps` row (through
`m365_set_org_app`), an `m365_pkce_states` row and an `m365_org_token_keys` generation. Then proves:
- **Reachability (decides it: `information_schema.role_table_grants`)**: for each M365 server-only
  table (`ms_graph_connections`, `m365_org_apps`, `m365_org_token_keys`, `m365_pkce_states`) zero
  rows in `role_table_grants` for `anon` and `authenticated`.
- **Row denial as B**: `set local role authenticated` + B's claims; `select count(*)` on each table
  above → `throws_ok … '42501'`; on the two own-org-readable M365 tables (`org_m365_document_settings`,
  `m365_record_folder_sweeps`) → 0 of A's rows.
- **Definer denial as B's Admin through the service role** (the edge's only path), A's org id:
  `m365_set_org_app`, `m365_clear_org_app`, `m365_org_token_key_rotate`, `m365_org_token_key_purge`
  → 42501; `m365_rekey_connection(B_org, A_connection, …)` and `m365_finish_refresh(B_org, A_user,
  A_connection, …)` → null and A's row unchanged (compare ciphertext + `key_id` before/after);
  `m365_org_token_key_salt(B_org, A_generation)` → null.
- **Mixed-generation state**: A on `org-v1:2` with generation 1 retired but referenced, B on `kek-v1`;
  `m365_org_token_key_purge` for A keeps generation 1 while referenced, deletes it after the row is
  re-keyed; B's rows untouched throughout.
- **Catalog denominator inside pgTAP**: `select is(array_agg(p.oid::regprocedure::text order by 1),
  array[…], …) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
  and p.prosecdef and p.proname like 'm365%'` — the exact sorted list. A new M365 definer without a
  two-org assertion turns this red. Same for `pg_class` tables named `m365%` / `ms_graph%`.

**Manifest + guard.** `scripts/isolation-probe-denominator.json`: add table
`{"table":"m365_org_token_keys","has_org":true,"pk":"org_id","columns":"*","b_read":"none","by_id":"applicable"}`
and the new definer signatures (slice K) to `definer_functions`; replace the 0340
`m365_finish_refresh` signature with the K2 one. These definers are service-only, so `rpcs` (the
authenticated-callable probe list, bound to `scripts/isolation-probe.sh` by
`validateExactRpcProbeCoverage`) does not change. Add a case to
`scripts/check-isolation-denominator.test.mjs`: a catalog with an extra `m365_*` definer absent from
the manifest reports it as UNLISTED, and a manifest entry for a dropped definer reports STALE.

**Rotation/rollback for P:** the proof covers the mixed-format state the K rollout passes through
(steps 3–5). Rollback = revert the commit; no schema.

### 2.3 Slice C — CLI status and rekey

- `NNNN-C1`: none needed if `m365_org_key_status` ships in K1 (it does). C is edge + CLI only.
- Edge action `org_key_status` (`orgKeys.ts`): same gates as `org_app_info` (member + resolved switch +
  Admin/Operator); returns `m365_org_key_status` for the caller's org, counts only, never a salt.
- `scripts/pmo.mjs` `m365`:
  - `pmo m365 status` adds `app` (from `org_app_info`: `configured`, `source`, `tenantId`, `clientId`,
    `secretSet` — never a secret) and `keys` (from `org_key_status`: `active_generation`,
    `connections_by_key`, `legacy_remaining`) to the existing three fields. For a non-Admin the two
    actions return 403; the command reports `app: null, keys: null` with a hint, the existing fields
    still print (members keep today's view).
  - `pmo m365 rekey [--limit <1..50>] [--dry-run]` — Admin only (refuses up front on a non-Admin
    `whoami` role, exit 2, nothing sent); loops `rekey_org_tokens` until `remaining = 0` or a round
    rekeys 0; prints the per-round counts; `--dry-run` sends `dryRun: true` once.
  - Usage lines at `pmo.mjs:23` and `:833`; `docs/runbooks/pmo-cli.md` gains the two commands.
- Rotation/rollback for C: read-only status plus a driver for K's sweep; rollback = revert the commit.

## 3. Acceptance criteria (owning layer)

| AC | Given / When / Then (short) | Owner test |
|---|---|---|
| AC-M365KS-001 | Given write mode `org`, when a user connects, then the row's `key_id` is `org-v1:<active gen>` and the tokens decrypt only with the org-derived key and that row's AAD | vitest `tokenCustody.keyring.test.ts` |
| AC-M365KS-002 | Given two orgs, the derived keys differ, and a ciphertext moved to another org's or user's row, or between columns, fails to decrypt | vitest `keyring.test.ts` (pure) |
| AC-M365KS-003 | Given a `kek-v1` row and write mode `org`, when it refreshes, then the new pair is `org-v1` and `m365_finish_refresh` received the new key id | vitest `tokenCustody.keyring.test.ts` |
| AC-M365KS-004 | Given write mode `legacy` (or missing), every write is `kek-v1` and existing `kek-v1` vectors decrypt byte-for-byte as before | vitest `graphTokenCrypto.test.ts` + `tokenCustody.keyring.test.ts` |
| AC-M365KS-005 | Given an unknown key id or a missing salt, every decrypt site returns typed `M365_KEY_UNAVAILABLE` with no token in the error event | vitest `tokenCustody.keyring.test.ts` |
| AC-M365KS-006 | `rekey_org_tokens` re-keys idle rows, skips a row a concurrent refresh changed, reports counts only, and works in both directions | vitest `tokenCustody.orgKeys.test.ts` |
| AC-M365KS-007 | A Project Manager gets 403 on `rekey_org_tokens`, `rotate_org_token_key`, `purge_org_token_keys`, `org_key_status` | vitest `tokenCustody.orgKeys.test.ts` |
| AC-M365KS-008 | `m365_org_token_keys` has forced RLS, no policy, no grant to anon/authenticated/service_role; all K definers are service-only | pgTAP `m365_org_token_keys.test.sql` |
| AC-M365KS-009 | `m365_org_token_key_current` creates generation 1 once; rotate retires and adds; purge keeps a referenced generation | pgTAP `m365_org_token_keys.test.sql` |
| AC-M365KS-010 | `m365_rekey_connection` updates only when org, id, status and expected ciphertext all match, and only to the active generation | pgTAP `m365_org_token_keys.test.sql` |
| AC-M365KS-011 | `key_id` outside the two formats is rejected by the check constraint | pgTAP `m365_org_token_keys.test.sql` |
| AC-M365KS-012 | The K1 down migration refuses while any row is not `kek-v1` | pgTAP `m365_org_token_keys_rollback.test.sql` |
| AC-M365KS-013 | Served handler: `rekey_org_tokens` through `index.ts` re-keys and the body holds no token or salt | deno `orgKeysServed.test.ts` |
| AC-M365ISO-001 | No anon/authenticated grant on any M365 server-only table (`role_table_grants`) | pgTAP `m365_two_org_isolation.test.sql` |
| AC-M365ISO-002 | Org B's member cannot read org A's M365 rows on any M365 table | pgTAP `m365_two_org_isolation.test.sql` |
| AC-M365ISO-003 | Org B's Admin, through the service role, cannot change org A's app, keys or connections, nor read A's salt | pgTAP `m365_two_org_isolation.test.sql` |
| AC-M365ISO-004 | The exact set of `m365%` definers and tables matches the proof's list | pgTAP `m365_two_org_isolation.test.sql` |
| AC-M365ISO-005 | The denominator guard reports an unlisted M365 definer and a stale one | node `scripts/check-isolation-denominator.test.mjs` |
| AC-CLI-M365-001 | `pmo m365 status` for an Admin prints app source and key counts, never a secret or salt | node `scripts/pmo-m365.test.mjs` |
| AC-CLI-M365-002 | For a non-Admin, status prints the member fields with `app: null, keys: null` and a hint | node `scripts/pmo-m365.test.mjs` |
| AC-CLI-M365-003 | `pmo m365 rekey` loops until `remaining = 0`, stops on a 0-progress round, `--dry-run` sends once | node `scripts/pmo-m365.test.mjs` |
| AC-CLI-M365-004 | `pmo m365 rekey` as a non-Admin refuses with exit 2 and sends nothing | node `scripts/pmo-m365.test.mjs` |

No new e2e: no screen changes, and Microsoft's token host is unreachable from CI; the cross-stack proof
is the served-handler deno tests plus pgTAP.

## 4. Mutation checks (required; each must turn the named tests red, then restore)

- **K:** make `resolveWriteKey` return `kek-v1` in `org` mode → AC-M365KS-001/003 red. Drop the AAD on
  encrypt → AC-M365KS-002 red. Use a constant HKDF `info` (no org id) → AC-M365KS-002 red. Remove the
  `org_id = p_org_id` predicate in `m365_rekey_connection` → AC-M365KS-010 and AC-M365ISO-003 red.
  Grant `authenticated` select on `m365_org_token_keys` → AC-M365KS-008 and AC-M365ISO-001 red. Drop
  the Admin gate from `rekey_org_tokens` → AC-M365KS-007 red. Drop the down-migration guard →
  AC-M365KS-012 red. Let purge delete a referenced generation → AC-M365KS-009 red.
- **P:** remove the org predicate from `m365_org_token_key_salt` → AC-M365ISO-003 red. Add a dummy
  `m365_probe_mutant()` security-definer function → AC-M365ISO-004 red and the guard reports UNLISTED
  (AC-M365ISO-005).
- **C:** include `salt` in the `org_key_status` reply → AC-CLI-M365-001 red. Remove the up-front role
  check from `rekey` → AC-CLI-M365-004 red.

## 5. Tasks (TDD: failing test first, 2–5 min each)

Local checks per task (owner rule 2026-10-26): `npm run check:guards`, `npm run typecheck`,
`npx eslint --max-warnings=0 <touched files>` (in `pmo-portal/`), the directly touched test files,
`deno check <touched edge files>`; DB tests only as
`scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db <touched files>'`. Before
editing a module, read its mocks: `grep -rn "vi.mock(.*m365" pmo-portal/src` and
`pmo-portal/src/lib/m365/__tests__/m365MockDeps.ts`.

### K — per-org key separation (branch `feat/2253-k-org-token-keys`, ships alone)

1. **Red (vitest, pure).** New `pmo-portal/src/lib/m365/__tests__/graphTokenCrypto.aad.test.ts`:
   `it('AC-M365KS-004: encrypt/decrypt without aad matches the existing kek-v1 vectors')` (reuse the
   fixture in `graphTokenCrypto.test.ts`);
   `it('AC-M365KS-002: a ciphertext made with aad A fails to decrypt with aad B')`.
2. **Green.** `graphTokenCrypto.ts`: add the trailing optional `aad?: Uint8Array` to both functions:
   ```ts
   const params: AesGcmParams = aad ? { name: 'AES-GCM', iv, additionalData: aad as BufferSource } : { name: 'AES-GCM', iv };
   ```
   (`iv as BufferSource` in decrypt as today). Run
   `cd pmo-portal && npx vitest run src/lib/m365/__tests__/graphTokenCrypto.test.ts src/lib/m365/__tests__/graphTokenCrypto.aad.test.ts`.
3. **Red (vitest, pure).** New `pmo-portal/src/lib/m365/__tests__/keyring.test.ts` importing
   `deriveOrgKey`, `tokenAad` from `../../../../supabase/functions/m365-token-custody/keyring.ts`:
   `AC-M365KS-002: two org ids with the same salt derive different 32-byte keys`;
   `AC-M365KS-002: the same org and salt derive the same key`;
   `AC-M365KS-002: tokenAad differs by org, user and column`.
4. **Green.** `supabase/functions/m365-token-custody/keyring.ts`:
   ```ts
   export async function deriveOrgKey(master: Uint8Array, salt: Uint8Array, orgId: string): Promise<Uint8Array> {
     const base = await crypto.subtle.importKey('raw', master as BufferSource, 'HKDF', false, ['deriveBits']);
     const info = new TextEncoder().encode(`pmo/m365-token/org-v1/${orgId}`);
     const bits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: salt as BufferSource, info }, base, 256);
     return new Uint8Array(bits);
   }
   export const tokenAad = (orgId: string, userId: string, column: 'refresh' | 'access') =>
     new TextEncoder().encode(`${orgId}:${userId}:${column}`);
   ```
5. **Red (pgTAP).** New `supabase/tests/m365_org_token_keys.test.sql` (namespaced UUIDs `e2253000-…`,
   `begin … rollback`, `select plan(N)`, `finish()`), seed shape as
   `m365_org_app_custody.test.sql:10-31`:
   `AC-M365KS-008` `has_table_privilege` false for anon/authenticated/service_role select on
   `m365_org_token_keys`; `has_function_privilege` false for anon/authenticated on every K definer;
   `AC-M365KS-008` each K definer called as `authenticated` → `throws_ok … '42501'`.
6. **Green.** `supabase/migrations/NNNN-K1_m365_org_token_keys.sql`: table, partial unique index, RLS
   enable + force, revokes, the `key_id` check (`not valid` + `validate constraint`), definers
   `m365_org_token_key_current`, `m365_org_token_key_salt`, `m365_org_key_status` (§2.1).
7. **Red (pgTAP).** Same file: `AC-M365KS-009` first `current` creates generation 1 with a 32-byte
   salt; a second call returns the same generation and salt; `rotate` by A's Admin → generation 2
   active, 1 retired, one `m365.token_key.rotated` audit row whose `detail::text` holds no salt hex;
   `purge` keeps generation 1 while a connection has `key_id = 'org-v1:1'`, deletes it after the row
   moves to `org-v1:2`; `rotate` by A's Project Manager → 42501.
8. **Green.** Add `m365_org_token_key_rotate`, `m365_org_token_key_purge` to `NNNN-K1` with the 0817
   gate (`0817:40-53`) and `log_audit`.
9. **Red (pgTAP).** Same file: `AC-M365KS-010` `m365_rekey_connection` with the right expected
   ciphertext → returns the id, row has the new ciphertext and key id; wrong expected ciphertext →
   null, row unchanged; `p_key_id = 'org-v1:1'` after rotation to 2 → `22023`; `status = 'revoked'`
   row → null. `AC-M365KS-011` insert with `key_id = 'kek-v2'` → `throws_ok … '23514'`.
10. **Green.** Add `m365_rekey_connection` to `NNNN-K1` (locks: `perform 1 from profiles … for update;
    perform 1 from org_features … for update;` then the guarded `update … returning id`).
11. **Red (pgTAP).** `AC-M365KS-003` (DB half) in the same file: `m365_finish_refresh(…, p_key_id =>
    'org-v1:1')` sets `key_id`; the same call with `p_key_id` omitted keeps `kek-v1`.
    **Green.** `supabase/migrations/NNNN-K2_m365_finish_refresh_key_id.sql` (drop 0340 signature,
    create with `p_key_id text default null`, `key_id = coalesce(p_key_id, key_id)`, re-grant).
12. **Rollback files.** `rollback/NNNN-K1_m365_org_token_keys_down.sql` (guard block §2.1, then drop
    definers, constraint, table) and `rollback/NNNN-K2_m365_finish_refresh_key_id_down.sql` (0340 body
    verbatim). **Red/green (pgTAP)** new `supabase/tests/m365_org_token_keys_rollback.test.sql`:
    `AC-M365KS-012`: the guard lives in a helper `public._m365_assert_kek_v1_only()` (created in K1,
    service-only, dropped last by the down file, which calls it first). With one `org-v1:1` row:
    `select throws_ok($$ select public._m365_assert_kek_v1_only() $$, 'P0001', 'rekey to kek-v1 before rollback', …)`;
    after re-keying that row to `kek-v1`: `select lives_ok($$ select public._m365_assert_kek_v1_only() $$, …)`.
13. **Red (vitest).** New `pmo-portal/src/lib/m365/__tests__/tokenCustody.keyring.test.ts` with
    `m365MockDeps.ts` gaining mocks for `m365_org_token_key_current`, `m365_org_token_key_salt`, and a
    `tokenWriteMode` env field (default `legacy`):
    `AC-M365KS-001: in org mode the callback stores org-v1:1 and the stored refresh token decrypts with the derived key and that row's aad`;
    `AC-M365KS-003: in org mode a kek-v1 row refreshes to org-v1 and m365_finish_refresh receives p_key_id`;
    `AC-M365KS-004: in legacy mode callback and refresh write kek-v1 and send no p_key_id`;
    `AC-M365KS-005: a row with key_id org-v1:7 whose salt resolves null gives M365_KEY_UNAVAILABLE on proxy, refresh and disconnect, and the error event holds no token`.
14. **Green.** `keyring.ts` `resolveReadKey`/`resolveWriteKey` + cache; `types.ts` (`tokenWriteMode`
    on `M365Env`, `M365_KEY_UNAVAILABLE` → 500 in the error map); `index.ts` `buildEnv`; replace
    `resolveKek` at `callback.ts:281,308`, `refresh.ts:55,136`, `revoke.ts:59`, `graphRead.ts:968,1002`;
    pass `p_key_id` to `m365_finish_refresh` at `refresh.ts:148` when the write key differs from the
    stored one. `crypto.ts` `resolveKek` stays for `kek-v1` only (called by `keyring.ts`). Add
    `M365_KEY_UNAVAILABLE` to `pmo-portal/src/lib/m365/errorCopy.ts` + `errorCopy.test.ts`, and the
    copy key in `public/locales/en` and `public/locales/id`.
15. **Red (vitest).** New `pmo-portal/src/lib/m365/__tests__/tokenCustody.orgKeys.test.ts`:
    `AC-M365KS-006: rekey_org_tokens re-keys two kek-v1 rows to org-v1:1 and reports { scanned: 2, rekeyed: 2, skipped_concurrent: 0, remaining: 0 }`;
    `AC-M365KS-006: a row whose rekey rpc returns null counts as skipped_concurrent`;
    `AC-M365KS-006: in legacy mode an org-v1 row is re-keyed back to kek-v1`;
    `AC-M365KS-006: dryRun calls no write rpc`;
    `AC-M365KS-007: a Project Manager gets 403 on rekey_org_tokens, rotate_org_token_key, purge_org_token_keys and org_key_status`;
    `AC-M365KS-006: the response JSON holds no ciphertext, token or salt`.
16. **Green.** `supabase/functions/m365-token-custody/orgKeys.ts` (four handlers); route in `index.ts`,
    add to `M365_FEATURE_ACTIONS` and the `M365Request` union in `types.ts`.
17. **Red/green (deno).** New `supabase/functions/m365-token-custody/orgKeysServed.test.ts` importing
    `handler` from `./index.ts` with `recordFolderTestKit.ts`: `AC-M365KS-013`. Then
    `node scripts/check-edge-fn-test-binding.mjs` and `deno check supabase/functions/m365-token-custody/{keyring,orgKeys,index}.ts`.
18. **Inventories.** Add `m365_org_token_keys` to `supabase/tests/0137_service_role_grants.test.sql`
    (no service_role table grant, by design); add the K definers to
    `supabase/tests/0210_service_only_definers_execute_grants.test.sql`; confirm
    `0178_anon_executable_definers.test.sql` count unchanged; manifest entries are slice P task 22.
19. Mutation checks for K (§4) — written into the PR body as "written; CI proves".

### P — two-org proof (branch `test/2253-p-two-org-proof`, after K's branch exists; may batch with K)

20. **Red (pgTAP).** New `supabase/tests/m365_two_org_isolation.test.sql`, seed both orgs (§2.2):
    `AC-M365ISO-001`:
    ```sql
    select is((select count(*)::int from information_schema.role_table_grants
                where table_schema = 'public'
                  and table_name in ('ms_graph_connections','m365_org_apps','m365_org_token_keys','m365_pkce_states')
                  and grantee in ('anon','authenticated')), 0,
      'AC-M365ISO-001 no API-role grant on any M365 server-only table');
    ```
    `AC-M365ISO-002` as B's member (`set local role authenticated; select set_config('request.jwt.claims', '{"sub":"<B member>","role":"authenticated"}', true);`)
    for each table.
21. `AC-M365ISO-003` definer denials (§2.2) with before/after snapshots
    (`select set_config('e2253.a_ct', encode(refresh_token_ciphertext,'hex') || key_id, true) …`), and
    the mixed-generation block; `AC-M365ISO-004` the exact sorted definer and table lists.
22. **Manifest.** Add the table entry and every K definer signature to
    `scripts/isolation-probe-denominator.json`; replace the `m365_finish_refresh` signature. Run
    `node scripts/check-isolation-denominator.mjs --self-test` (no DB needed for the self-test).
23. **Red/green (node).** `scripts/check-isolation-denominator.test.mjs`:
    `AC-M365ISO-005: an m365 definer in the catalog but not the manifest is UNLISTED`;
    `AC-M365ISO-005: a manifest m365 definer missing from the catalog is STALE` — drive
    `compareDenominators(actual, recorded)` directly with fixture objects. Run
    `node --test scripts/check-isolation-denominator.test.mjs`.
24. Mutation checks for P (§4).

### C — CLI status and rekey (branch `feat/2253-c-cli-m365-status`, after K is on dev, ships alone)

25. **Red (node).** New `scripts/pmo-m365.test.mjs` copying the `fake`/`cli` helpers from
    `scripts/pmo-ops.test.mjs:30-66`; routes `GET /rest/v1/org_m365_document_settings`,
    `GET /rest/v1/m365_record_folder_sweeps`, `POST /functions/v1/m365-token-custody` (dispatch on
    `body.action`):
    `AC-CLI-M365-001: status for an Admin prints app source and key counts and never a secret or salt`
    (assert `JSON.stringify(json)` matches neither the fake secret nor the fake salt hex);
    `AC-CLI-M365-002: status for a Project Manager prints the member fields with app null and keys null`.
26. **Green.** `scripts/pmo.mjs` `m365`: add `org_app_info` and `org_key_status` to the
    `Promise.all`, each through a helper that maps a 403 `CliError` to `null` and adds the hint
    "Only an Admin sees app and key status.":
    ```js
    const adminOnly = (p) => p.catch((e) => { if (e instanceof CliError && e.status === 403) return null; throw e; });
    ```
    Return `{ default_library, connection, last_folder_sweep, app, keys }`.
27. **Red (node).** Same file:
    `AC-CLI-M365-003: rekey loops while remaining > 0 and stops at 0`;
    `AC-CLI-M365-003: rekey stops on a round that rekeys 0 and reports remaining`;
    `AC-CLI-M365-003: --dry-run sends one request with dryRun true`;
    `AC-CLI-M365-004: rekey as a Project Manager exits 2 and sends no function request`
    (assert `calls(f)` holds no `POST /functions/v1/m365-token-custody`).
28. **Green.** `m365` gains `rekey`: role from the existing `whoami` profile read; `--limit` parsed as
    an integer 1..50 (usage error otherwise); loop capped at 200 rounds. Update usage lines at
    `pmo.mjs:23` and `:833`. Run `node --test scripts/pmo-m365.test.mjs scripts/pmo.test.mjs`.
29. **Docs (same branch).** `docs/runbooks/pmo-cli.md`: `pmo m365 status` fields and
    `pmo m365 rekey` (Admin, dry-run first, run until `remaining` is 0, then report).
30. Mutation checks for C (§4).

### Docs after K merges (direct to dev)

31. ADR-0060 amendment: per-org key derivation is the pooled-model boundary (§9), the two `key_id`
    formats, the write-mode rollout and rollback. 32. `docs/glossary.md`: "token key generation",
    "write mode". 33. Spec `docs/specs/m365-org-token-keys.spec.md` (FR/AC from §3, EARS) — the S5 spec that
    has not landed yet; it lives on `origin/docs/1017-s5-m365-docs` today.
    34. Roadmap #1571 and map #2251 status lines.

## 6. Traceability

| AC | Layer | File |
|---|---|---|
| AC-M365KS-001, 003, 004, 005 | Unit (vitest) | `pmo-portal/src/lib/m365/__tests__/tokenCustody.keyring.test.ts` |
| AC-M365KS-002 | Unit (vitest) | `pmo-portal/src/lib/m365/__tests__/keyring.test.ts`, `graphTokenCrypto.aad.test.ts` |
| AC-M365KS-004 (vectors) | Unit (vitest) | `pmo-portal/src/lib/m365/__tests__/graphTokenCrypto.aad.test.ts` |
| AC-M365KS-006, 007 | Unit (vitest) | `pmo-portal/src/lib/m365/__tests__/tokenCustody.orgKeys.test.ts` |
| AC-M365KS-008–011 | Integration (pgTAP) | `supabase/tests/m365_org_token_keys.test.sql` |
| AC-M365KS-012 | Integration (pgTAP) | `supabase/tests/m365_org_token_keys_rollback.test.sql` |
| AC-M365KS-013 | Served handler (deno) | `supabase/functions/m365-token-custody/orgKeysServed.test.ts` |
| AC-M365ISO-001–004 | Integration (pgTAP) | `supabase/tests/m365_two_org_isolation.test.sql` |
| AC-M365ISO-005 | Unit (node) | `scripts/check-isolation-denominator.test.mjs` |
| AC-CLI-M365-001–004 | Unit (node) | `scripts/pmo-m365.test.mjs` |

## 7. Ship order and deploy order

K (DB → edge with write mode `legacy` → flip to `org` → sweep) · P with or right after K · C after K is
on dev. Release deploy order is back to front as before: DB, edge, then the write-mode flip as a
separate owner-approved setting change per environment.

## 8. Risks

- **Deployment key rotation** (the HKDF input) is separate from per-org generations. Rotating it needs a
  second master id (`org-v2:<g>`) and the same sweep; out of scope, follow-up under #2251.
- **Sweep cost.** Each row is one decrypt, one encrypt and one RPC; 50 rows per call, rate-limited;
  a large org takes several CLI rounds, which the loop handles.
- **Cache staleness.** A purged generation can stay cached for at most 300 s in a warm isolate; purge
  runs only on unreferenced generations, so no stored row needs it.
