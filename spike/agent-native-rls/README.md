# agent-native RLS parity spike

> **⚠️ THROWAWAY SPIKE — NOT part of the permanent test suite.**
> This directory exists only to de-risk [ADR-0036](../../docs/adr/0036-agent-native-user-composed-ui.md)
> by deciding its **§9 spike gate**. It proves an approach is viable; it ships nothing. Once the gate
> decision is recorded in ADR-0036, **delete this whole directory** (see [Cleanup](#cleanup)).

---

## What this spike proves (and why it matters)

ADR-0036 §2 makes the agent a **deputy carrying the user's badge, never a master key**: the agent runtime
must run **as the user's own JWT** (real role + `org_id`), so that PMO's existing **Row-Level Security is
the hard ceiling** on everything it can read or write — prompt injection becomes a nuisance, not a breach,
because RLS still blocks cross-tenant access. The danger the ADR's one-rule-that-can-never-bend guards
against is a **privileged / `service_role` (BYPASSRLS) connection**, which silently sidesteps RLS and
destroys the `org_id` tenancy seam. Builder.io's `agent-native` reaches Postgres through **Drizzle ORM**,
not supabase-js — so this spike proves that Drizzle's `.rls()` transaction wrapper (`set local role
authenticated` + `set_config('request.jwt.claims', …)`) enforces PMO's RLS **identically to supabase-js**,
*and* that a non-`.rls()` (bare/privileged) Drizzle connection **bypasses** it. That bypass is exactly the
failure mode ADR-0036 §8's `.rls()` discipline + guard must prevent; demonstrating it here confirms the
discipline is both necessary and sufficient.

## The three claims (the gate)

| # | Claim (ADR-0036 §9) | Automation | Proof |
|---|---|---|---|
| 1 | Drizzle `.rls()` enforces RLS **identically to supabase-js** | **FULLY AUTOMATED** | `rls-parity.mjs` (5 assertions, below) |
| 2 | `drizzle-kit pull` is **non-destructive / introspect-only** (Supabase migrations stay the single source of truth, §8) | **AUTOMATED** | `pull-check.sh` |
| 3 | Assistant panel **SSO, no second login** | **MANUAL** (lowest risk) | manual steps, below |

### Claim #1 — RLS parity (the killer claim) — `rls-parity.mjs`

The harness uses the `postgres` driver to replicate Drizzle's `.rls()` wrapper against the **real local
schema** and runs this assertion matrix:

1. **Own-org read returns the row** — a JWT scoped to org A reads an org-A row → row present.
2. **Cross-org read returns 0 rows** *(the killer)* — the org-A JWT reads an org-B row → 0 rows.
3. **In-org write succeeds via column default** — the org-A JWT inserts a row; `org_id` is stamped by the
   column default / RLS (never the client) → insert accepted.
4. **Cross-org write rejected** — the org-A JWT attempts a write into org B → rejected with **SQLSTATE
   `42501`** (insufficient privilege / RLS violation).
5. **KILL TEST — bypass confirmed** — the *same* cross-org read from assertion #2, but run on a **bare
   superuser connection WITHOUT the `.rls()` wrapper**, **returns the row** — proving an un-pinned
   connection bypasses RLS.

**Pass** = assertions #1–#4 are all enforced **AND** #5 confirms the bypass (i.e. RLS is real and
`.rls()` is what makes it fire). If #5 *also* returned 0 rows, the test setup itself would be suspect.

### Claim #2 — introspect-only `pull` — `pull-check.sh`

Runs `drizzle-kit pull` to mirror the existing Supabase schema into Drizzle **types**, and asserts the
operation is introspect-only — Drizzle can *read* the schema without wanting to **own or migrate** it.
This keeps **Supabase migrations as the single schema source of truth** (ADR-0036 §8); Drizzle never runs
`push`.

### Claim #3 — assistant panel SSO (MANUAL — deferrable)

The only non-automated claim, and the lowest-risk — **defer it until #1 and #2 pass.** Manual steps:

1. Scaffold an `agent-native` app: `npx @agent-native/core@latest create`.
2. Point its Drizzle config at **local Supabase** Postgres (the dev DB).
3. Configure it to **trust the Supabase JWT** (shared signing secret / JWKS).
4. Embed its assistant panel on a **local subdomain** (shared-cookie SSO, not iframe — ADR-0036 §8).
5. Log into PMO, open the panel, and **confirm no second login prompt** (the PMO session is honored).

## How to run

```bash
cd spike/agent-native-rls && bash run.sh
```

**Prerequisites:** Docker running · `npx supabase` available · Node ≥ 20.

`run.sh` will:

1. Start local Supabase if it is not already up.
2. Run **`supabase db reset`** — **LOCAL dev DB only, NEVER prod** (per CLAUDE.md branch/prod rules; this
   spike never touches the cloud project).
3. `npm install`.
4. Run the two automated claim checks (`rls-parity.mjs` for Claim #1, `pull-check.sh` for Claim #2).
5. Print a **GATE SUMMARY** and exit with a non-zero code if any automated claim fails.

The DB connection string is read from the env var **`SPIKE_DB_URL`**, auto-derived from
`npx supabase status -o env` — no manual configuration needed.

## Interpreting the result

- **All automated claims PASS** → ADR-0036 **§8** (the config-over-fork sidecar) is **viable**: proceed,
  and flip ADR-0036 toward **Accepted on the sidecar path**. (Then complete the manual Claim #3.)
- **Claim #1 FAILS** (RLS leaks through Drizzle, or `.rls()` cannot be made to enforce) → **do NOT fork
  `agent-native` to force it.** Take ADR-0036 §9's **"Fail" branch**: build the agent spec-author on
  **PMO's own stack** against the §4 trusted core. Either way, the **trusted core (§4–§7)** proceeds
  regardless — it stands alone.

## What this spike deliberately does NOT do

- Does **not** scaffold the full `agent-native` app (only the manual Claim #3 touches a scaffold).
- Does **not** touch prod — local dev DB only.
- Does **not** add permanent tests.
- Does **not** modify the PMO app or the schema.

> **Fidelity caveat (state this in the gate writeup):** the harness proves the **SQL binding** that
> Drizzle `.rls()` emits (`set local role authenticated` + `set_config('request.jwt.claims', …, true)`
> per transaction) enforces PMO's policies correctly — it replicates that wrapper on the raw `postgres`
> driver rather than executing Drizzle's own code path (node_modules is installed only for Claim #2's
> `drizzle-kit pull`). That is sufficient scope for de-risking ADR-0036 §9 claim #1. A follow-up could
> run the identical matrix through real `createDrizzle(...).rls()` to close the last gap.

The production RLS proofs for **`user_views`** (the *kept* tests — owner isolation, scope sharing returns
viewer-scoped rows, cross-org blocked) come later, per **ADR-0036 §Verification**, not here.

## Cleanup

It's throwaway. Once the gate decision is recorded in ADR-0036:

```bash
rm -rf spike/agent-native-rls
```

This also removes its generated `node_modules/` and `drizzle/` artifacts.
