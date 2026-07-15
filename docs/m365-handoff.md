# Microsoft 365 integration — continuation handoff

- **For:** the next agent (local Claude Code / pi executor) picking up M365 work.
- **From:** the 2026-07-14 remote Director session. **Branch:** `claude/microsoft-teams-onedrive-integration-f656rx`
  → **PR #333** → collector `feat/m365-integration` (off `dev`; **do NOT PR to `dev` directly** — other
  agents work `dev`).
- **Read-first index:** vision `docs/microsoft-365-integration.md`; ADR-0058 (architecture), ADR-0059
  (Entra topology), ADR-0060 (token custody — the binding security controls); Phase-0 spec
  `docs/specs/m365-phase0-foundation.spec.md` + plan `docs/plans/2026-07-14-m365-phase0-foundation.md`.

---

## 0. START HERE — the single next action

**Verify the Phase-0 DB slice on your local stack** (the remote session had no Supabase CLI, so this is
unproven). From repo root:

```
scripts/with-db-lock.sh supabase db reset      # applies 0096 + 0097 cleanly
scripts/with-db-lock.sh supabase test db       # 0142 / 0143 / 0144 must pass
```

- Confirm `0097_org_features_add_m365.sql` drops/recreates the constraint named
  `org_features_feature_key_check` (verify with `\d public.org_features` after reset; adjust the drop
  line if your local Postgres named it differently).
- If pgTAP 0142/0143/0144 are green and `npm run verify` (in `pmo-portal/`) is green, the Phase-0
  foundation is fully proven. **Then** proceed to Phase 1 (§4).

---

## 1. Decisions locked — do NOT re-open (owner-ratified 2026-07-14)

| # | Decision | Where |
|---|---|---|
| Deployment | **Siloed** (one Supabase project per client); pooled deferred | ADR-0047 |
| Entra app topology | **Option C** — one app per client in the *vendor* tenant; **B** (client-tenant, no publisher verification) is the escape hatch; **A** = current first client / forced under pooled | ADR-0059 |
| Priority framing | **Delight-first, positioned to drive enterprise adoption** for Teams/M365-ecosystem orgs (NOT self-serve/PLG) | ADR-0058 |
| Token custody | **Server-side** confidential-client refresh-token store (Option 2) | ADR-0060 |
| **D1 encryption** | **App-layer AES-256-GCM** in the edge function, KEK outside the DB (rejected Supabase Vault) | ADR-0060 §3 |
| **D2 bootstrap** | **Server-side auth-code + PKCE** Graph exchange, separate from SSO (rejected `provider_refresh_token` capture) | ADR-0060 §1 |
| Auth vs authz | OAuth authenticates; authorization stays invited-`profiles` + RLS (`enable_signup=false`) — never a signup bypass | ADR-0058 §1 |

Still **open** (owner decides later, do not force): publisher verification sequencing; provisioning model
(invite-first vs JIT) — the shipped graceful not-provisioned state is the current posture.

---

## 2. What's already built (10 commits on the branch)

| Area | Files | State |
|---|---|---|
| **Sign in with Microsoft** | `pmo-portal/src/auth/AuthProvider.tsx` (`signInWithMicrosoft`), `LoginPage.tsx`, `supabase/config.toml` `[auth.external.azure]` (committed **disabled**), `docs/environments.md` runbook | shipped, verified. Tests AC-MSAUTH-001..003 |
| **Provisioning hardening** | `AuthProvider.tsx` (`profileErrorKind`/`classifyProfileError` on `PGRST116`), `RequireAuth.tsx` (not-provisioned card + Sign out, no Retry) | shipped, verified. AC-MSAUTH-010/011 |
| **Phase-0 FE** | `src/lib/features.ts` (`m365_integration` key, default-off), `src/components/integrations/M365ConnectionCard.tsx` (two-switch gate; **disabled "available soon" connect stub**), mounted in `pages/AdminUsers.tsx` | verified. AC-M365-011/012/013 |
| **Phase-0 DB** | `supabase/migrations/0096_ms_graph_connections.sql` (token store: RLS forced + zero policies + `revoke all`; bytea ciphertext only), `0097_org_features_add_m365.sql`; pgTAP `0142`/`0143`/`0144` | **AUTHORED / DB-deferred** — verify per §0. AC-M365-001/002/010 |
| **Phase-1 crypto foundation** | `src/lib/m365/graphTokenCrypto.ts` (AES-256-GCM envelope; `encryptToken`/`decryptToken`/`serializeEnvelope`/`deserializeEnvelope`), `src/lib/m365/graphPkce.ts` (`generateCodeVerifier`/`codeChallengeS256`/`buildAuthorizeUrl`) + tests | **security-audited clean** (opus STRIDE, 2 Minor items fixed), verified. AC-M365-030/031 |

**Byte layout** of the stored ciphertext (single `bytea` column): `iv(12) || ciphertext-with-16-byte-GCM-tag`
(see `serializeEnvelope`/`deserializeEnvelope`).

---

## 3. Environment delta — what you (local) can do that the remote session could NOT

The remote container had **no Supabase CLI** and **no `pi` CLI**. As a **local** agent you have both, which
unblocks exactly the deferred work: (a) running the Phase-0 pgTAP (§0), and (b) building + running the
Phase-1 exchange **edge function** against the local stack. Remember the shared-DB hygiene: **wrap every
DB-driving command in `scripts/with-db-lock.sh`** and work in your **own `git worktree`** off the branch.

---

## 4. Phase 1 — the work to do (OneDrive doc-linking is the first feature)

Build the **live token layer** using the audited helpers, strictly to ADR-0060's controls. This is the
`security-auditor`-gated surface — build it under the full per-issue loop (spec-reviewer +
code-quality-reviewer + **security-auditor**) and do **not** expose it until the auditor signs off.

Suggested slices (each TDD, verify green, PR to the collector):

1. **Exchange edge function — bootstrap (D2, PKCE).** `supabase/functions/m365-connect/` (or similar):
   an authorize-initiation endpoint (verify caller JWT via `src/lib/auth/verifyCallerJwt.ts`;
   `graphPkce.generateCodeVerifier` + `codeChallengeS256` + `buildAuthorizeUrl`; stash the verifier +
   `state` server-side, CSRF-bound) and a callback/exchange endpoint (validate `state`; POST the code +
   verifier + **client secret** to Microsoft's token endpoint; least-privilege incremental scopes +
   `offline_access`). Import the `_shared`/`src/lib/m365` helpers cross-tree exactly as
   `supabase/functions/adapter-dispatch/index.ts` imports `verifyCallerJwt.ts`.
2. **Encrypt + store (D1).** `graphTokenCrypto.encryptToken(refreshToken, KEK)` → `serializeEnvelope` →
   write to `ms_graph_connections` (service_role, set `org_id` explicitly from the caller's profile — no
   stamp trigger). Never log the token/KEK. Emit `audit_events` metadata only.
3. **Graph proxy (NFR-M365-002).** Browser → edge function → Graph; decrypt server-side, call Graph,
   return only data. No Microsoft token ever reaches the client.
4. **Rotation / revoke / stale (NFR-M365-006/007).** Persist the newest rotated refresh token; on
   `invalid_grant` mark `status='stale'` and drive re-consent; support disconnect (delete + best-effort
   revoke); delete on offboard/disentitlement.
5. **Wire the FE.** Replace `M365ConnectionCard`'s disabled stub with a real Connect action that starts
   the flow; show connected/stale states.
6. **First data feature — OneDrive doc linking** (vision §3.2, link/reference model): store Graph
   driveItem references on `project_documents`; Microsoft stays the permission authority. Follows the
   ADR-0055 adapter pattern (a new Graph tier).
7. **`security-auditor` gate** on the whole surface (store RLS + proxy + `state` CSRF + no-token-in-logs +
   consent scopes) **before** exposure.

pgTAP already proves the store lockdown; add e2e for the connect→linked-doc journey (graduates from the
Phase-0 stub, ADR-0010).

---

## 5. Owner inputs required before the LIVE parts of §4

These are **owner actions** (secrets / Entra portal) — request them; do not fabricate:

1. **KEK (D1 key).** Generate a 256-bit key and store it in Supabase secrets + 1Password vault-`AS`
   (never in the repo):
   ```
   openssl rand -base64 32                 # the 32-byte AES-256 KEK
   supabase secrets set M365_TOKEN_KEK=<that value>   # per client project
   ```
   The edge function reads it and passes raw bytes to `graphTokenCrypto` (base64-decode first).
2. **Entra client secret into edge-function secrets** — the SSO dashboard provider config is NOT readable
   from an edge function: `supabase secrets set M365_CLIENT_SECRET=<the Entra client secret>`.
3. **Entra portal additions** (per ADR-0059 Option C app): add the first feature's **delegated Graph
   scopes** (OneDrive: `Files.Read` + `offline_access`) and the **edge-function redirect URI** for the
   PKCE callback.
4. **Publisher verification** (ADR-0059) if productizing beyond the first admin-consenting client.

---

## 6. Conventions & gotchas

- **Helper location:** pure logic lives in `pmo-portal/src/lib/**` (so `npm run typecheck`/`test`/coverage
  see it); edge functions import it **cross-tree** via relative path (the `verifyCallerJwt.ts` precedent).
  A file under `supabase/functions/_shared/*.ts` is invisible to the pmo-portal gate — don't put testable
  logic there.
- **Pre-push gate (binding):** `cd pmo-portal && npm run verify` (typecheck && lint:ci && test && build) —
  the WHOLE suite, not just touched files.
- **Branch flow:** feature branch → PR to **`feat/m365-integration`** (collector) → owner promotes the
  collector to `dev` as one reviewed unit. Never `dev`/`main`/`production` directly.
- **Commit trailer:** `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` (and set
  `git config user.email noreply@anthropic.com` so commits verify).
- **Two-switch model:** Operator entitles `m365_integration` (via `operator_toggle_feature`); org-Admin
  activates (the card + connect flow). Don't collapse them.

---

## 7. Held / out of scope (resume points)

Live OAuth exchange, Graph proxy, and OneDrive linking are §4 (needs §5 owner inputs + the auditor gate).
Teams (notifications / approvals / LLM assistant / tab), Outlook/calendar, Planner tasks, Entra-group
provisioning, Power BI/Automate, Graph connector → Copilot are later phases (vision §3, sequencing §4).
