# CI dispatch coordination specification

Issue: #1133. Status: build-ready PMO slice within the signed operations scope.
Date: 2026-10-19. Release ceiling: `dev`.

## Intent and scope

Job story: When several approved work lanes need browser integration evidence, the operator
needs each admission to account for work already admitted, including work not yet visible in a
remote read, so the authorized capacity and approval rules remain meaningful.

This slice adds reservations and reconciliation to the PMO dispatch wrapper. It preserves its
public command line, existing machine lock, five-column audit format, UTC daily accounting,
per-branch approval distinctions and `run_pgtap` selection. The temporary capacity is two for
v0.23.0 only; #1134 owns restoration to one. Ordinary approval flags cannot raise capacity.

The participating writer in this slice is PMO. The unchanged peer wrapper retains its existing
one-run policy and does not consume the reservation ledger. PMO admissions account for PMO
reservations and observed remote work from both configured workflows. Tests with two synthetic
participating writers prove the protocol; they do not prove adoption by the unchanged peer.
Whole-issue closure requires the Directors' explicit peer coordination agreement and an accurate
record of this boundary. This slice does not authorize peer edits or a peer rollout.

No product, workflow, provider, credential, database, Docker or deployment changes belong to the
builder. CI registration belongs to the Director. Verification uses isolated fixtures only;
no actual browser workflow is dispatched to prove this feature.

## Terms and model

- **Reservation:** a durable request ID with canonical repository/workflow, branch, immutable
  head, UTC attempt times, prior eligible run IDs, approval kind and status; a linked request
  also has its remote run ID. Ledger schema version is `1`.
- **Remote identity:** canonical repository plus run ID. A run ID from a different repository
  cannot satisfy a reservation. Workflow, dispatch event, branch, immutable head and creation
  window must also match before linking.
- **Complete observation:** all requested pages and required fields were successfully read
  and validated. A truncated, failed or malformed observation is not an empty observation.
- **Busy set:** the union of observed nonterminal remote dispatch identities and unlinked
  reservations in `reserved`, `accepted-unresolved` or `unknown`. Linked nonterminal requests
  contribute their run identity once. A previously linked run requires a definitive current
  read before its slot can be released.
- **History:** retained legacy audit rows, remote dispatch history and ledger attempt history,
  with linked run/request identities collapsed. For each UTC-day or branch bucket, use the
  greater of the legacy audit count and the remote/ledger identity-union count. A terminal run
  remains history. Definitively rejected unsent requests add no new ledger history; retained
  legacy audit rows keep their existing conservative meaning.

The ledger is separate from the audit log. Its path is derived by appending
`.reservations.json` to the configured log path, keeping fixture paths portable and existing
peer audit readers compatible. Stored data is operational metadata and existing approval
history only. Neither raw command output nor authentication material belongs in the ledger.

## Functional requirements (EARS)

**FR-OPS-001 — atomic admission.** When a participating writer reserves a browser dispatch,
it shall hold the existing shared machine lock throughout read, reconcile, reserve, dispatch
and state-write, and count the union of remote active identities and unresolved reservations
without double-counting a linked run. In this slice, the participating writer is PMO.

**FR-OPS-002 — uncertainty consumes capacity.** While acceptance is possible and no matching
run has been definitively reconciled, the reservation shall consume capacity. Passage of time
alone shall not release it. Where a required active-run, history, head or linked-run read fails,
is malformed or is incomplete, the wrapper shall refuse a new dispatch and preserve history.

**FR-OPS-003 — evidence-based reconciliation.** When exactly one previously unseen run matches
a reservation's canonical repository, workflow, dispatch event, immutable head, branch and
creation window, and that run is eligible for only that reservation, the wrapper shall store
its run ID. Where candidates overlap or are ambiguous, reservations shall remain unresolved.
When a linked run is definitively terminal, its busy slot shall be released while daily/branch
history is retained. An absent run, a changed head or an expired window alone is not terminal proof.

**FR-OPS-004 — one write attempt.** When a request is definitively refused before the dispatch
process is started, its reservation shall be marked `rejected` without a run ID. When transport
acceptance is uncertain, it shall remain `unknown` until definitive reconciliation. The wrapper
shall make at most one dispatch write per invocation and shall not retry a write to infer whether
the first one succeeded. Reconciliation uses reads only.

**FR-OPS-005 — compatible accounting and honest reporting.** When logging or reconciling, the
wrapper shall preserve audit records, per-branch rules, UTC daily cap, approval evidence and
`run_pgtap` behavior. It shall replace tabs, carriage returns and newlines in operator text with
spaces, save versioned state atomically with a request ID, and refuse capacity overrides through
ordinary approval flags. A log or state-write failure shall return nonzero, print no completion
claim and preserve the last durable conservative state. Dry-run shall mutate neither ledger nor
log and shall never dispatch.

## Nonfunctional requirement

**NFR-OPS-001 — isolated evidence.** All tests shall use fake `gh`, temporary logs, temporary
locks and synthetic repository/branch data. They shall use no real API, shared operational
state, browser, provider, database or Docker requests, and shall publish no local configuration.

## Policy and state rules

| Input | Required result |
|---|---|
| Two busy identities, including unresolved reservations | Refuse, even with `--owner-ok` |
| Three PMO dispatches in the current UTC day | A further admission needs `--owner-ok` |
| One prior dispatch on the branch | A second needs `--bugfix-proof` or `--owner-ok` |
| Two or more prior dispatches on the branch | A further admission needs `--owner-ok` |
| No PR on the branch | Preserve `run_pgtap=true` |
| A PR exists on the branch | Preserve `run_pgtap=false` |
| Any required observation/state parse failure | Nonzero refusal; zero new writes |
| Accepted dispatch not yet visible | Retain `accepted-unresolved`, consuming one busy slot |
| Spawned dispatch returns nonzero or is interrupted | Retain `unknown`, consuming one busy slot |
| Definitively completed linked run | Release only that busy identity; retain history |
| Old unresolved reservation | Retain its busy slot regardless of age |

The transition sequence is `reserved → unknown` durably before the dispatch process starts,
then `accepted-unresolved` on successful transport, or `unknown` on uncertain transport.
A unique match moves either unresolved state to `linked-active` or `linked-terminal`.
`reserved → rejected` is allowed only with proof that the dispatch process did not start.
`linked-active → linked-terminal` requires a definitive terminal read. Repeated reconciliation
is idempotent. Missing/corrupt state is distinguished: a missing ledger starts empty; invalid or
unsupported existing state refuses and is never replaced with an empty ledger.

The creation window starts at the last pre-dispatch clock sample and extends through the
current complete observation cutoff, rounded outward to whole seconds at each reconciliation.
The baseline contains eligible run IDs observed before dispatch. The process finish time records
its outcome; it is not a hard upper bound on remote creation. A uniquely matching run created
after that finish time may therefore link when a later complete observation sees it. Missing
finish metadata after interruption does not prevent otherwise definitive reconciliation.
Ambiguous or absent evidence remains unresolved; no aging, deletion or automatic guessed recovery
is introduced. Operator-supplied evidence beyond these rules remains a Director responsibility.

## Acceptance and owning proof

All three acceptance criteria are owned by Node process-unit tests in
`scripts/ci-e2e-coordination.test.mjs`; pure subtests exercise the shipped helper. There is no
additional browser or database owning proof.

**AC-OPS-1133-1.** Given two delayed-visibility successful dispatches from separate synthetic
participating repositories using one temporary ledger and lock, when a third invocation arrives
before visibility, then it is refused; when the runs become visible, each reservation links only
to its own run, and linked runs count once, including a matching run created after the dispatch
process finished. The process journal proves the lock covers admission
and persistence. Peer observations are also tested without claiming the unchanged peer participates.

**AC-OPS-1133-2.** Given failed or malformed active/history reads, incomplete pagination,
ambiguous write outcomes, unwritable state or stale unresolved requests, when admission is
attempted, then it returns nonzero, makes no further dispatch and preserves reservations/history.
Given successful terminal reconciliation, when admission is evaluated, then only the correct
busy slot is released. Failed post-dispatch persistence retains the durable uncertainty and
prints no success claim.

**AC-OPS-1133-3.** Given historical five-column audit rows plus reservations, when UTC daily and
branch approvals are evaluated, then existing limits and approval distinctions hold without
counting a linked reservation/run twice. Given dry-run, when the same decision is evaluated,
then neither log nor state changes. Approval text sanitation, canonical legacy repository
aliases and both `run_pgtap` paths are covered in this owning process suite.

## Delivery conditions

The builder owns only `scripts/lib/ci-dispatch-reservations.mjs`,
`scripts/ci-e2e-coordination.test.mjs` and `scripts/ci-e2e.sh`. The Director owns separate CI
registration, three role reviews, normal fast PR gates and the peer coordination agreement.
The approved PMO implementation may proceed independently of peer adoption, while the issue's
remaining coordination limit stays explicit. No approval in this specification authorizes a
real dispatch, a merge beyond `dev` or any production action.
