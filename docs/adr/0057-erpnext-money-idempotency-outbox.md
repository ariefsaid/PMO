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
unchanged (FR-ENA-004 invariant preserved). The dispatch treats the key's presence as the signal to take
the money path.

### 2. A durable `external_command_outbox` provisional-ref table (reversible migration, RLS)

A new `external_command_outbox` table (spec §4.2) keyed by `unique (org_id, domain, pmo_record_id,
idempotency_key)` with a `state` machine (`pending → committed → confirmed | failed`). **Before** issuing a
non-idempotent ERPNext create, the dispatch `INSERT`s a `pending` row; the unique constraint makes a
concurrent/duplicate attempt fail atomically (`23505`) — so two requests can **never both** proceed to
create a money doc (FR-ENA-041, AC-ENA-012). The table is machine-written (service-role) + org-member
`SELECT` (for a "pushing/failed" UX read). Reversible (drop table); `org_id` seam + `stamp_org_id()`.

### 3. The adapter stamps the key into a stable stock field (the recovery probe anchor)

The ERPNext `toBody` appends the `idempotencyKey` into the doctype's stock `remarks`/`remark` text field
(no custom field — NFR-ENA-SEC-001). This lets a recovery probe find an orphaned commit by
`GET /api/resource/<DocType>?filters=[["remark(s)","like","%<key>%"]]` (FR-ENA-041/043) — a deterministic
"did ERP already commit this key?" lookup with no ERPNext-side idempotency support required.

### 4. The atomic recovery algorithm (R1/R3 — reconcile by outbox state, never a blind re-create)

A retry of a command whose `idempotency_key` is already present in the outbox **reconciles by state** —
never re-issues a second create blindly (FR-ENA-042/043):

| Outbox `state` | Meaning | Recovery action |
|---|---|---|
| `confirmed` | ERP committed + PMO mirror/ref finalized | Return the stored `external_record_id` + canonical record. **No ERP call.** |
| `committed` | ERP committed, PMO mirror/ref finalization failed | **Re-run only the finalization** (idempotent read-model upsert + `external_refs` record), promote to `confirmed`. No second create. |
| `pending` | The dangerous window — prior create may or may not have committed | **Probe ERP by the stamped key.** If a doc exists → adopt it (set `external_record_id`, `state='committed'`, then finalize → `confirmed`). If none → the create did not commit, so safely (re-)issue it under the **same** outbox row. |
| `failed` | Prior attempt was rejected pre-commit | A retry may re-issue the create. |

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
  **impossible** under retry-after-timeout / 429 / mirror-finalization-failure (NFR-ENA-IDEM-001). The
  guarantee is DB-enforced (the unique 4-tuple) + algorithm-enforced (reconcile-by-state) + test-proven at
  the real boundary (the fault seam).
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
- **Operational — the sweep adopts orphaned commits:** the modified-poll sweep (slice 8) also runs the
  `committed`→`confirmed` finalize + the `remarks`-key probe, so an orphaned commit is reconciled even if
  the retry never comes (FR-ENA-045).
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
