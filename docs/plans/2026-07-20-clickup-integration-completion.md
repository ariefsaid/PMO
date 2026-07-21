# PMO ↔ ClickUp integration — state of play + what remains to ship

**Read this first if you are picking up the admin-connect / ClickUp work with no prior context.**
It tells you what exists, what is proven, what is *assumed*, the end-to-end user journeys that must
work before enabling the feature, and the rules for touching the live ClickUp workspace.

- **Branch:** `feat/external-admin-connect` · **PR:** #332 (base `dev`, **HELD — do not merge**
  without owner say-so)
- **Decisions:** `docs/decisions.md` **OD-INT-1..13** (binding — read before changing behaviour)
- **Architecture:** ADR-0055 (external systems own their domains; PMO = operational layer + read-models), ADR-0016 (`can()` is UX-only, server is authority), ADR-0018 (soft-archive), ADR-0057 (`verifyCallerJwt`)
- **Live-smoke result:** `docs/spikes/2026-07-17-clickup-live-smoke.md`
- **Original scope/plan:** `docs/plans/2026-07-14-external-admin-connect.md` (**historical** — Phase 3 partly superseded, see its banner)

---

## 1. Mental model (30 seconds)

PMO is the **operational layer over pluggable external systems**. When an org "employs" ClickUp for the
`tasks` domain, **ClickUp owns tasks** and PMO keeps a read-model + mappings — PMO does not compete for
truth (ADR-0055).

Two link layers, deliberately:

| Layer | Table | ClickUp | Who may change it |
|---|---|---|---|
| **Org connection** (the credential) | `external_org_bindings` | Workspace token → Vault `secret_ref` | **Admin ∨ Operator** |
| **Project binding** (the container) | `external_project_bindings` | one **List** per PMO project | **Admin ∨ Operator ∨ that project's active PM** (OD-INT-7) |
| Row identity | `external_refs` | task ↔ ClickUp task | machine only |
| Domain ownership flip | `external_domain_ownership` | `(org, clickup, tasks)` | server RPC only |

ERPNext uses the **same** org layer but has **no per-project link** — its Company is org-level
(OD-INT-6); per-project ERP Project is deferred with prerequisites in OD-INT-4's forward-note.

---

## 2. What is BUILT and verified (P1–P4, all on the branch)

| Phase | What | Proven by |
|---|---|---|
| **P1** | Per-org Vault credential model: `read_vault_secret` / `create_vault_secret_for_org` (actor-keyed) / `delete_vault_secret`; pure resolvers; `_shared/perOrgSecret.ts` tri-state (**fail-closed** when a binding exists but Vault misses); 6 edge fns flag-gated | pgTAP + deno; security battery + re-review **all CLOSED** |
| **P2** | `external-connect` / `external-disconnect`; `admin_change_domain_ownership` definer RPC (actor-keyed, does ownership + audit atomically); `integration` policy entity; ClickUp-adopt migration; admin Connect/Disconnect UI; **ERPNext Company at org level** + *connected-but-not-activated* | pgTAP, deno, RTL, rendered design-review |
| **P3** | `external-lists` (List picker), `external-link` (push-seed/pull-adopt + mixed-409), `external-unlink` (soft-archive); repository + `useIntegrations`; project card | pgTAP, deno (real-handler), RTL |
| **P4** | Health surface (last sync, error count), audit proofs, reversibility/tombstone proofs incl. **re-link after unlink** | pgTAP `plan(89)` |

**Gates (run these; they are the definition of done):**
```bash
node scripts/check-edge-fn-test-binding.mjs                                   # edge-fn tests bind to shipped handlers
scripts/with-db-lock.sh bash -c "supabase db reset && supabase test db"       # pgTAP
cd pmo-portal && npm run verify                                               # typecheck+lint+test+build
```

**The flag is OFF.** `EXTERNAL_CONNECT_ENABLED` is unset everywhere ⇒ every fn takes its legacy path
byte-for-byte. Nothing in P1–P4 is live for users yet.

---

## 3. ⚠️ What is NOT proven — read before you trust the green tests

Every ClickUp test is **fetch-mocked**. Mocks are *hypotheses* about ClickUp's payloads: they prove our
handlers behave correctly **given** an assumed response; they cannot detect the assumption is wrong.

The 2026-07-17 live-smoke **validated the read shapes** (`/user`, `/team`→`teams`, `/space`→`spaces`,
`/list`→`lists`, `/list/{id}/task`→`{tasks,last_page}`, task/status fields, real rate-limit headers).
**Still unproven:**

1. **`include_closed` semantics — INCONCLUSIVE and it matters.** ClickUp omits closed tasks unless
   `include_closed=true`. `external-link`'s push-seed requires the List to be *empty*; if emptiness is
   computed without `include_closed`, a List full of **closed** tasks reads as empty and push-seed
   proceeds into a non-empty List. The smoke could not settle it (test list has no closed tasks).
   **→ Create a closed task in the test List and re-run before enabling the flag.**
2. **Webhook envelope is PROVISIONAL.** `clickup-webhook` assumes `event`/`task_id`/`list_id`/`task` +
   an `X-Signature` HMAC. Needs a real delivery to a public callback. **Largest remaining unknown.**
3. **Write paths never touched ClickUp.** Task create/update/delete via `adapter-dispatch` are
   mock-only. The smoke is read-only by design.
4. **Per-org webhook secret does not exist.** `external_org_bindings.webhook_secret_ref` is a column
   nothing writes; `clickup-webhook` still verifies with the global `CLICKUP_WEBHOOK_SECRET`. **Blocks
   multi-org.** (Deferred in P1: a per-org secret needs an **org-in-URL** callback design, because you
   cannot resolve the org from the body *before* verifying the HMAC without moving the trust boundary.)

---

## 4. The user journeys that must work before this ships

Each is the acceptance bar. J1–J2 are built; J3–J6 need live verification.

**J1 — Admin connects the org (built ✅, live-unverified for the write it triggers)**
Administration → Integrations → *Connect ClickUp* → paste personal API token (masked, eye toggle) →
validated against `GET /user` → token to **Vault**, only `secret_ref` in the DB → binding `active`,
ClickUp employed for `tasks`. *Bad token ⇒ 422, no Vault write, no binding.*

**J2 — PM links a project to a List (built ✅)**
Project → Tasks tab → *Link to ClickUp* → pick a List (live workspace tree) → choose **direction**:
`push-seed` (PMO seeds an **empty** List) or `pull-adopt` (adopt an existing List into an **empty**
PMO project). Both non-empty ⇒ **409 action-required**. A PM of a *different* project ⇒ **403**.

**J3 — Outbound sync PMO → ClickUp (⚠️ never run live)**
PM creates/edits/completes a PMO task → `adapter-dispatch` → ClickUp task created/updated/tombstoned →
`external_refs` maps the pair; failures queue in `external_command_outbox`.

**J4 — Inbound sync ClickUp → PMO (⚠️ never run live)**
Task changes in ClickUp → webhook (HMAC-verified **before** parse) → PMO read-model converges.
`clickup-sweep` reconciles anything the webhook missed.

**J5 — Health (built ✅)**
Integrations card shows status, connected by/at, **last sync**, and an error badge from the outbox.

**J6 — Reversibility (built ✅, pgTAP-proven)**
Unlink a project ⇒ **soft-archive** (tombstone kept, re-link permitted). Disconnect the org ⇒ Vault
secret revoked, ownership released, binding tombstoned. Nothing is hard-deleted (ADR-0018).

---

## 5. Remaining work to ship, in order

1. **Close `include_closed`** — add a closed task to the test List, re-run
   `./scripts/clickup-live-smoke.sh --list-id <id>`; if counts differ, fix the emptiness check in
   `external-link` to pass `include_closed=true` (and add a mocked regression test).
2. **Live write round-trip (J3)** — with the flag on for the test org only: create a PMO task → assert
   it appears in the test List → update → delete/tombstone. **Clean up every task afterwards (§6).**
3. **Webhook envelope (J4)** — expose a callback (tunnel), register a ClickUp webhook against the test
   workspace, capture ONE real delivery, diff against `ClickUpWebhookPayload`, fix, then
   **delete the webhook registration**.
4. **Per-org webhook secret** — design org-in-URL callbacks, write `webhook_secret_ref`, verify per-org.
   (Required for multi-org; not for a single test org.)
5. **Curated e2e (AC-EAC-018)** — connect → link → sync round-trip, the one cross-stack journey test.
6. **Then** enable `EXTERNAL_CONNECT_ENABLED` for the test org and re-run J1–J6 end-to-end.

---

## 6. ⛔ Rules for the live ClickUp workspace and the local DB (binding)

**Both the cloud ClickUp workspace and the local Supabase DB are TEST environments.** Treat them as
shared, disposable-but-not-abusable fixtures.

- **Do not poll or spam the ClickUp API.** Call it only for an actual test or verification you are
  about to read the result of. No polling loops, no "warm-up" calls, no repeated smoke runs to watch
  output scroll. Rate limit is **100 req/min per token** and it is shared with anything else using
  that token — `x-ratelimit-remaining` is in every response; respect it.
- **Prefer mocks.** The fetch-mocked suites are the default way to test; the live API is only for
  verifying a *wire shape* or an end-to-end journey that mocks cannot prove (§3).
- **Always clean up.** Anything you create in ClickUp (tasks, lists, webhook registrations) must be
  deleted in the same session. Leave the workspace as you found it. If a run dies mid-way, the next
  session's first job is to remove the orphans.
- **Never print secrets.** The token lives in 1Password (`clickup-api` / vault `AS` / field
  `credential`). Pipe it straight into the consumer — never echo it, never write it to a file, never
  put it in argv (visible in `ps`) or a URL. Reduce API responses to **key names/counts** before
  printing so workspace content (task titles, emails) never lands in a transcript.
  `scripts/clickup-live-smoke.sh` is the worked example.
- **Local DB:** every DB-touching command goes through `scripts/with-db-lock.sh` — multiple agents
  share one Docker Postgres and concurrent `db reset` / `test db` / e2e corrupt each other.

---

## 7. Traps that already cost time (do not rediscover)

- **Migration numbering races.** This branch was renumbered **twice** in one session (dev took
  0104/0105, then M365 took 0106–0117). **Renumber LAST**, immediately before pushing, after merging
  the target base — numbering early guarantees a collision. Gate: `scripts/check-migration-collisions.sh`.
- **Green ≠ shipped.** Edge-fn suites tested *copies* of handlers three times. Tests must import the
  SHIPPED handler and mock `globalThis.fetch` (Supabase's own guidance — **no DI in production code**).
  Enforced by `scripts/check-edge-fn-test-binding.mjs` in CI + the pre-commit hook.
- **Assertions that cannot fail are decoration.** A "service_role can execute log_audit" pgTAP passed
  even with the grant removed (a blanket grant in `0080` already covered it). Prefer **effect**
  assertions (call it, assert what it wrote). Mutation-check anything security-critical: break the rule
  and the tests MUST go red.
- **The service-role auth-context trap.** `auth.uid()` is NULL under service_role, and `is_operator()`
  is `security invoker` — so RPCs gated on them silently misfire when called from an edge fn. Pass an
  explicit `p_actor_id` and check `platform_operators` directly. This bit P1 *and* P2.

---

## 8. Divergence analysis appendix

The full field/behaviour divergence between PMO and ClickUp tasks, with verified vs. assumed gaps, is
in `docs/spikes/2026-07-20-clickup-tasks-divergence.md` — the companion spike that feeds this plan.
Key blockers from that analysis:

- **§2.1 Status map** — `external-link` writes empty maps; `toClickUpStatus` throws on unmapped;
  `captureMaps` only captures 2 of 4 PMO statuses. **Outbound fails entirely; inbound corrupts
  delivery reporting.**
- **§3.1 Webhook envelope** — real payload has no `task` object, no `date_updated`, no `list_id`; has
  `history_items[]` deltas instead. The adopt tier is dead code.
- **§2.2 Read filters** — `subtasks`/`archived`/`include_timl`/`include_closed` all default-excluded;
  emptiness check is broken; sweep misses archived.
- **§2.3 Member map absent** — assignee sync is dead; needs PMO-profile ↔ ClickUp-member join by
  email at link time.

These are the **verification targets** for the live-write round-trip (J3) and the webhook fix (J4).