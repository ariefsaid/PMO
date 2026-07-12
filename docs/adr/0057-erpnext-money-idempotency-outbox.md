# ADR-0057 — ERPNext money-idempotency: `idempotencyKey` on `AdapterCommand` + a durable outbox + atomic recovery

- **Status:** Accepted (proposed by eng-planner, 2026-07-11, alongside `docs/plans/2026-07-11-erpnext-adapter.md`)
- **Date:** 2026-07-11
- **Deciders:** Owner, Director
- **Related:** ADR-0055 (external adapters — §4 synchronous write-through), ADR-0048 (ERPNext = accounting
  engine; ledger-sourced-display), `docs/specs/erpnext-adapter.spec.md` (FR-ENA-040..045, NFR-ENA-IDEM-001,
  AC-ENA-010/012/013), ADR-0019 (server-enforced money rules / destructive ops).
- **Scope:** how a synchronous command to an ERPNext-owned **money** document (Purchase Invoice, Payment
  Entry, Purchase Order, …) is made safe against retry-after-timeout, 429, and post-commit-mirror-failure —
  so a duplicate money document can **never** be minted. Applies to the `erpnext` tier; P0/P1 (reference /
  ClickUp tasks) are unaffected.

## Context

ADR-0055 §4 mandates **synchronous write-through**: a PMO user action on an externally-owned domain is
`PMO → adapter → external commit → read-model update → return`, with the external system's validation
verdict surfacing in the form. That is correct for UX but creates two money-safety hazards unique to
ERPNext money documents (intake risks R1 + R3):

1. **R1 — no command idempotency key.** The shipped `clickup/client.ts` `withBackoff` transparently
   retries `429`/`5xx`/network failures. A retried timeout-after-commit on a task is tolerable; the same
   retry on a Payment Entry mints a **second** Payment Entry — a financial defect.
2. **R3 — the partial-failure window.** ERPNext commits the money document, then the dispatch fails before
   the mirror write and/or the `external_refs` record. The next retry cannot tell whether ERP committed —
   and a naive "retry the command" mints a duplicate; a naive "skip" orphans the ERP doc (invisible in PMO
   until the sweep, and worse: the sweep's adopt would mint a **second** mirror row for a PMO-created record).

ERPNext itself offers **no native client-supplied idempotency key** on `POST /api/resource`. Stock Frappe
REST is request-idempotent only per HTTP verb+URL semantics (a `PUT {docstatus:1}` submit is safely
re-issuable; a `POST` create is not). The R9 spike
(`docs/spikes/2026-07-11-erpnext-pe-mandatory-fields.md` §5) confirmed: create+submit-in-one-POST works
but the response body carries a stale `status:"Draft"`; the two-step insert-then-submit idiom separates
the two windows; and a once-submitted money doc cannot be REST-deleted (`LinkExistsError` via the Payment
Ledger) — so a duplicate is **permanent** until a manual cancel.

## Decision

P2 introduces a **money-idempotency contract extension + a durable outbox + an atomic recovery algorithm**,
all confined to the dispatch layer above the adapter (the adapter itself stays pure and Deno-importable).
Four parts:

### 1. `idempotencyKey` on `AdapterCommand` (the only contract change)

`AdapterCommand` gains an optional `idempotencyKey?: string` (`contract.ts`). It is **client-generated**
per non-read-only ERPNext money command (a `crypto.randomUUID()` in the FE repository, threaded through
`dispatchClient`). P0 (reference) and P1 (ClickUp tasks) never set it ⇒ their behavior is byte-for-byte
unchanged (FR-ENA-004 invariant preserved). The served dispatch **enforces** the key for every
non-read-only `erpnext` command (rejects a missing key as `commit-rejected` / `missing-idempotency-key`
before touching the outbox) and treats its presence as the signal to take the money path — so a key-less
money command can never reach ERP, while P0/P1 (which never route to the `erpnext` tier) are unaffected.

### 2. A durable `external_command_outbox` provisional-ref table + atomic commit claim (reversible migration, RLS)

A new `external_command_outbox` table (spec §4.2) keyed by `unique (org_id, domain, pmo_record_id,
idempotency_key)` with a five-state machine `pending → committing → committed → confirmed | failed`.
**Before** issuing a non-idempotent ERPNext create, the dispatch `INSERT`s a `pending` row; the unique
constraint makes a concurrent/duplicate **insert** fail atomically (`23505`) — so two requests can **never
both** open a money command (FR-ENA-041, AC-ENA-012). The table is machine-written (service-role) +
org-member `SELECT` (for a "pushing/failed" UX read). Reversible (drop table + the two RPCs);
`org_id` seam + `stamp_org_id()`.

The unique constraint alone closes the **insert** race but **not** the **reissue** race (the original
draft's hole): two retries of the *same* key both `SELECT` the existing `pending` row, both probe ERP,
both find nothing, both `POST` → two money docs. The fix is an **atomic commit claim** that makes a
concurrent duplicate reissue **impossible by construction** (mirrors the 0078 durable-claim discipline —
"at-most-once in the DB, not JS timing" — plus 0077's txn-scoped serialization intent):

```sql
-- claim_outbox_for_commit: the ONLY gate from (pending|failed|stale-committing) → committing.
-- A conditional UPDATE under Postgres' row lock: two concurrent claims for the same id serialize;
-- the winner transitions and RETURNs the row, the loser's UPDATE matches 0 rows (state already
-- 'committing', updated_at fresh) and RETURNs null → the loser re-reads and reconciles (never POSTs).
-- A 'committing' row whose updated_at is older than the lease is re-claimable (recovers a process
-- that died holding the claim). Each win BUMPS claim_generation — the returned value is the caller's
-- FENCING TOKEN (see below). SECURITY DEFINER so the policy-less outbox is touched only here.
create or replace function public.claim_outbox_for_commit(
  p_id uuid, p_lease interval default interval '60 seconds'
) returns public.external_command_outbox
  language plpgsql security definer set search_path = public as $$
  declare v public.external_command_outbox;
  begin
    update public.external_command_outbox
       set state='committing',
           attempt_count = attempt_count + 1,
           claim_generation = claim_generation + 1,   -- fencing token: monotonic per claim
           updated_at = now()
     where id = p_id
       and ( state in ('pending','failed')
             or (state='committing' and updated_at < now() - p_lease) )
    returning * into v;
    return v;  -- v.claim_generation = the caller's fencing token; null ⇒ another caller owns it — do NOT POST
  end; $$;
```

The claim is the **single** transition into the ERP-POST critical section. Because it is a conditional
`UPDATE` guarded by Postgres' row lock, **at most one** caller per outbox id can ever be between "claim
won" and "mark committed" at any instant — a concurrent duplicate ERP create is therefore impossible,
not merely unlikely (the guarantee the R1/R3 review required).

**Fencing token + quarantine (the lease-expiry / in-flight-POST hole).** The 60 s lease makes a
`committing` row recoverable so a crashed claimant cannot wedge the row forever — but a claimant that is
merely *slow* (GC pause, a stalled ERP socket) can have its lease expire **while its `POST` is still in
flight and not yet visible to the `remarks`-key probe**. A reclaimer that probed, found nothing, and
re-`POST`ed would therefore mint a **duplicate money document** — the lease alone protects only write-backs,
not the in-flight `POST` itself. The fix is two-fold:

1. **A stale `committing` row is NEVER auto-reissued (quarantine).** `claim_outbox_for_commit` only claims
   `pending`/`failed` rows (and quarantined rows past their window, below) — it will **not** reclaim a
   `committing` row. Instead a reclaimer transitions a stale (past-lease) `committing` row to a new
   **`quarantined`** state via `quarantine_committing` (a fenced conditional `UPDATE`), which sets a
   **visibility window** `reconcile_after = coalesce(claimed_at, now()) + 5 minutes`. A quarantined command
   is resolved **only** by the reconciliation path once its window elapses: probe the `remarks` key → if the
   original (slow) `POST` has by then landed, **adopt** it (finalize exactly one mirror row, no second
   `POST`); if after the window there is still no ERP hit, it is safe to **reissue under the SAME idempotency
   key**. The window is long enough that any in-flight `POST` becomes visible before a reissue is considered.
2. **A monotonically-incremented `claim_generation`** column: every claim win **and every quarantine** bumps
   it and returns it as the caller's token, and **every post-claim write-back** — the
   `committing`→`committed`/`confirmed`/`failed` transition and the `external_record_id` record — is guarded
   `WHERE claim_generation = <my token>`. A superseded claimant's write-back matches **0 rows** and its
   result is **discarded**.

So the lease bounds *liveness* (no permanent wedge), the quarantine bounds *POST safety* (a slow in-flight
`POST` is adopted, never duplicated), and the fencing token bounds *write-back safety* (no stale write-back
and no duplicate finalize).

**Fenced finalization (H-1 DIRECTOR RULING, 2026-07-13 — amends this ADR).** The original finalization
sequenced a fencing-token *verify* and then SEPARATE `external_refs` + `confirmed` writes — a TOCTOU gap: a
reclaimer could supersede the claim between the verify and the writes and have its correct mapping
overwritten by a stale one. Finalization is now the DB-side **`finalize_outbox(id, generation, …)` RPC**:
under a `SELECT … FOR UPDATE` row lock it re-checks `claim_generation` + `state='committed'` and — only if
still owned — upserts `external_refs` **and** promotes `committed`→`confirmed` in ONE transaction. It is the
**only** committed→confirmed path; a superseded claimant matches neither guard, so its ENTIRE finalization
(ref + confirm) is a 0-row no-op. The per-domain read-model mirror stays a caller write issued only on a `1`
return (owner-gated) and is independently backstopped by the doctype modified-poll sweep's convergence
authority (a rare crash between confirm and mirror re-mirrors from ERP truth on the next cycle).

### 3. The adapter stamps the key into a per-doctype stable stock ANCHOR field (the recovery probe anchor)

The adapter (`erpnext/adapter.ts`'s `stampAnchor`) appends the `idempotencyKey` into the doctype's
per-doctype **anchor field** — named in `doctypeRegistry.ts`'s `anchorField` entry (no custom field —
NFR-ENA-SEC-001). This lets a recovery probe (`erpnext/recoveryProbe.ts`'s `probeErpByAnchorKey`) find
an orphaned commit by `GET /api/resource/<DocType>?filters=[[<anchorField>,"like","%<key>%"]]`
(FR-ENA-041/043) — a deterministic "did ERP already commit this key?" lookup with no ERPNext-side
idempotency support required.

**Per-doctype anchor override (DIRECTOR RULING, live-bench-verified 2026-07-12).** The anchor field is
chosen PER DOCTYPE because ERPNext's own `validate` hooks clobber some stock fields on every save:

| doctype | `anchorField` | rationale (live-bench-verified against frappe/erpnext:v15.94.3) |
|---|---|---|
| Purchase Invoice | `remarks` | Survives validate+submit+re-fetch verbatim; REST-filterable; the filter returns the doc. |
| Purchase Receipt | `remarks` | Same — `remarks` survives and is filterable. |
| **Payment Entry** | **`reference_no`** | PE's own `validate` hook **OVERWRITES `remarks`** with an auto-generated `"Amount IDR X to <party>\nTransaction reference no <ref> dated <d>"` description on every save — a key stamped into `remarks` is silently clobbered, so the probe can never find it. **`reference_no`** is a native, REST-filterable field that PMO owns for PMO-originated PEs (`peToBody` never sends it), and it **SURVIVES validate+submit+re-fetch** carrying the key verbatim — so PE anchors on `reference_no` instead. |
| every other kind | `null` (no anchor) | Material Request/RFQ/Supplier Quotation/Purchase Order/Supplier/Customer lack a filterable stock text field — Frappe rejects the filtered GET with `DataError: Field not permitted in query`. A `null` anchor skips the probe entirely; R1 (the DB atomic claim) is unaffected, only R3 orphan-adoption is forgone for these (non-money or pre-money) kinds. |

The anchor matters **only during the recovery window** (a `pending`/`failed`-state crash where the
adapter's own returned `external_record_id` is unknown). The `committed`-state finalize path
(AC-ENA-010) and the `confirmed`-state replay never call the probe — they carry the adapter's real
returned canonical. ERP-side edits to `reference_no` after the reconcile window closes are therefore
acceptable (the anchor has already served its purpose). For a PMO-originated Payment Entry the
`reference_no` IS the idempotency key for the life of the doc (PMO owns the field) — the trade-off the
ruling accepts for a real R3 probe on the money doctype where the original `remarks` design is broken.

### 4. The atomic recovery algorithm (R1/R3 — reconcile by outbox state, never a blind re-create)

First the server-side guard (FR-ENA-040 enforcement): the served dispatch **rejects** any non-read-only
`erpnext` command whose `idempotencyKey` is absent (`commit-rejected`, code `missing-idempotency-key`)
**before** it touches the outbox — so a key-less money command can never reach ERP. P0/P1 (reference /
ClickUp) never route here, so their optional-key behavior is byte-for-byte preserved.

A retry of a command whose `idempotency_key` is already present in the outbox **reconciles by state** —
never re-issues a second create blindly (FR-ENA-042/043) — and **never `POST`s unless
`claim_outbox_for_commit` returned a row it owns**:

| Outbox `state` | Meaning | Recovery action |
|---|---|---|
| `confirmed` | ERP committed + PMO mirror/ref finalized | Return the stored `external_record_id` + canonical record. **No ERP call, no claim.** |
| `committed` | ERP committed, PMO mirror/ref finalization failed | **Re-run only the finalization** via the DB-side **fenced** `finalize_outbox` RPC (H-1, below) — a single transaction that re-checks the fencing token under a row lock and, only if still owned, upserts `external_refs` **and** promotes `committed`→`confirmed` **atomically**; the per-domain read-model mirror is written only on a `1` return. A superseded claimant's entire finalization is a **0-row no-op**. No second create, no claim. |
| `committing` (fresh) | Another caller currently owns the ERP-POST critical section | **Do not POST.** Re-read on a short backoff until the owner reaches `committed`/`confirmed`/`failed`, then reconcile to that state. |
| `committing` (stale, past lease) | A claimant's ERP `POST` may be **in flight** and not yet probe-visible | **Never reclaim + re-POST** (that would duplicate an in-flight money doc). `quarantine_committing(id)` transitions it to `quarantined` (fenced, bumps `claim_generation`) and sets `reconcile_after`. The synchronous caller surfaces a retryable "reconciling"; the row is resolved by the reconciliation path once the window elapses. |
| `quarantined` | A stale `committing` row awaiting its visibility window | Resolvable **only after `reconcile_after`**, via `claim_outbox_for_commit(id)` (which is gated on the window). The claim winner probes the anchor key: doc found → **adopt** (finalize → `confirmed`, no `POST`); no ERP hit after the window → **per the per-kind reissue policy below**: reissue under the **same** idempotency key for a reissue-capable kind, or transition to **`held`** for a mutable-anchor kind (Payment Entry). Within the window the claim RETURNs null and no `POST` happens. |
| `held` | A mutable-anchor money doc whose post-window recovery was **inconclusive** | **Terminal until an operator resolves it.** A retry surfaces the non-retryable `command-held`; the row is **excluded** from `outbox_reconcile_candidates` (never auto-reissued). Surfaced non-silently (`console.error` + org-member-`SELECT`-able state). |

**Per-kind reissue policy (C-1 DIRECTOR RULING, 2026-07-13 — amends this ADR).** A post-window recovery
that finds **no** ERP doc is only safe to reissue when *conclusive absence* is possible — i.e. the recovery
probe's anchor is **immutable**. The policy is a per-doctype fact (`doctypeRegistry.anchorMutable`):

| kind | anchor | mutable? | post-window no-hit action |
|---|---|---|---|
| Purchase Invoice / Purchase Receipt | `remarks` | no (survives verbatim) | **reissue-capable** — reissue under the same key |
| every anchor-less kind | — | n/a | **reissue-capable** (non-money / pre-money; first-POST is the only attempt) |
| **Payment Entry** | `reference_no` | **yes** (an accountant can edit it ERP-side) | **held-on-inconclusive** — NEVER auto-reissued; a blind reissue could mint a **second Payment Entry** (double-pay). The composite probe (below) is tried first; a still-inconclusive result → **`held`**. |

**Composite deterministic Payment Entry recovery probe (C-1).** Because `reference_no` is mutable, the PE
probe is `reference_no` anchor **OR** the deterministic conjunction — `party_type` + `party` + exact
`paid_amount` + a `references` row citing the same Purchase Invoice + `creation` within the claim window —
**every value read from our own outbox row `payload`** (persisted at insert, so the sync retry and the sweep
resolve identically; the child-table `references` match runs after `getDoc` since it is not server-filterable).
A **unique** match is adopted; 0 or >1 matches is inconclusive → `held`.
| `pending` / `failed` | No caller owns it; a prior create may or may not have committed | **`claim_outbox_for_commit(id)` first.** Only the claim winner proceeds, holding its returned `claim_generation` as a fencing token: probe ERP by the stamped key; if a doc exists → adopt (set `external_record_id`, `committed`, then finalize → `confirmed`); if none → `POST` the create under the **same** outbox row, then on success → `committed` → finalize → `confirmed`, on classified failure → `failed` (or leave `committing` for retryable transport). **Every write-back is guarded `WHERE claim_generation = <token>`.** The claim loser RETURNs null → re-reads → reconciles (never POSTs). |

Two concurrent retries therefore **cannot** both `POST`: only the claim winner holds the critical
section; the loser observes `committing` (fresh) or the winner's terminal state and never re-issues. And a
lease-expired claimant that overlaps a reclaimer **cannot** corrupt the row **nor duplicate its money doc**:
its write-backs fail the `claim_generation` fence and are dropped, while the reclaimer **quarantines** the
row rather than blindly re-POSTing — so any ERP doc the stale claimant already POSTed (even one still in
flight when the reclaimer arrived) is recovered by the post-window `remarks`-key probe and finalized
**exactly once**, never re-created.

The ERPNext client **never blindly retries a non-idempotent POST** on a retryable transport failure or on
the distinct `500`-`TypeError` (empty-`items`) bucket — a retry is permitted **only** through this guarded
reconciliation (FR-ENA-013/042, AC-ENA-011). Submit (`PUT {docstatus:1}`) is separately idempotent: the
adapter re-fetches `docstatus` first and treats an already-submitted doc as a no-op success (R9 §5).

### 5. Proven at the real served boundary with a named server-side fault seam

The whole contract is proven at the **real served `adapter-dispatch`** boundary (FR-ENA-001), not a mock:
the `after-commit-before-mirror` fault seam (FR-ENA-003, env-gated `ERPNEXT_TEST_FAULTS=1`) interrupts the
function's response path **server-side** after the ERP commit succeeds but before the mirror — then the
exact command is retried and the test asserts ERPNext holds **one** doc, the outbox reconciles, PMO holds
**one** mirror row, no duplicate (AC-ENA-010). The post-commit-mirror-failure recovery (the `committed` →
`confirmed` finalize + the `remarks`-key probe) is AC-ENA-013.

## Consequences

- **Positive — the money-safety guarantee:** duplicate Purchase Invoice or Payment Entry creation becomes
  **impossible** under retry-after-timeout / 429 / mirror-finalization-failure / concurrent-retry /
  lease-expiry-overlap (NFR-ENA-IDEM-001). The guarantee is DB-enforced four ways: the unique 4-tuple (no
  duplicate *open*), the atomic `claim_outbox_for_commit` (no duplicate *POST* — impossible by
  construction), the `claim_generation` fencing token (no stale-claimant *write-back* after a lease-expiry
  overlap), and the reconcile-by-state algorithm (no duplicate *finalize*); plus test-proven at the real
  boundary (the fault seam).
- **Positive — no ERPNext-side requirement:** no custom app, no Frappe webhook, no ERPNext idempotency
  feature needed. The `remarks`-stamp + filter-probe uses only stock REST (NFR-ENA-SEC-001).
- **Positive — P0/P1 untouched:** the contract change is a single optional field; ClickUp/reference paths
  ignore it. The byte-for-byte invariant (FR-ENA-004) holds.
- **Cost — one new table + dispatch complexity:** `external_command_outbox` (reversible, RLS, org-seam) +
  the reconcile state machine in `dispatch.ts` (pure, unit-tested per state). Acceptable: money-safety is
  the one place this complexity is mandatory, and it is confined to the dispatch layer.
- **Cost — `remarks` field reused:** the doctype `remarks` carries the idempotency key (visible to ERP
  users). Acceptable: it's a stock text field, the key is an opaque UUID, and it's the only stock anchor
  for a recovery probe. If a future doctype lacks `remarks`, that doctype's `toBody` chooses another stable
  stock text field (documented in the doctype registry).
- **Operational — the sweep runs full outbox recovery (orphan + stuck-claim + committed-finalize):**
  the modified-poll sweep (slice 8) runs an explicit `reconcileOutbox` pass — it selects every
  `pending` / `failed` / `committing`-past-lease / `committed` row for employing orgs and applies the
  algorithm above (claim → probe → adopt-or-reissue; committed → finalize). So an orphaned commit, a
  stuck `committing` claim, or a `committed`-but-unfinalized row is reconciled even if the original
  retry never came back (FR-ENA-045). This is the exact algorithm the plan's sweep task (8.6) implements
  and the sweep-outbox-recovery test proves — ADR and plan describe one recovery path.
- **Reversibility:** dropping ERPNext for an org (Operator release) leaves the outbox rows as audit; the
  table itself drops in a reverse migration with no downstream dependency.

## Alternatives considered

- **Client-supplied idempotency via a Frappe custom app / server hook:** rejected — violates ADR-0055 §2
  ("no adapter may require a helper app") and stock-bench ruling. The `remarks`-probe achieves the same
  with stock REST.
- **Append-only outbox (never delete) vs state-machine:** a state-machine lets the dispatch **return** the
  canonical record on a `confirmed` retry (no re-fetch) and clearly separates `committed` (finalize-only)
  from `pending` (probe-maybe-reissue) — the two windows have different safe actions.
- **Make `idempotencyKey` required on every command:** rejected — it would force P0/P1 to mint meaningless
  keys and risk the byte-for-byte invariant. Optional + money-path-only is the minimal correct change.
- **Optimistic UI only (no outbox):** rejected — UX pending-state does not solve the duplicate-create
  hazard; the duplicate is a server-side money defect, invisible to the UX layer.
