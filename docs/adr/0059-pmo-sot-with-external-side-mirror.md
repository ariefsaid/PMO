# ADR-0059 — PMO-SoT domains with an external side-mirror: the second integration posture (push-on-approval)

- **Status:** Proposed (by eng-planner, 2026-07-16, alongside `docs/specs/erpnext-adapter-p3b-timesheets.spec.md`
  + `docs/plans/2026-07-16-erpnext-adapter-p3b-timesheets.md`) — **awaiting owner acceptance.**
- **Date:** 2026-07-16
- **Deciders:** Owner, Director
- **Related:** **ADR-0055** (external adapters — this ADR **clarifies its §5 ownership-map row "Timesheets |
  ERP" and adds a second posture to its §3/§4 model; it does not supersede it**), ADR-0058 (the fenced
  money-idempotency outbox — applies verbatim, plus one additive registry field), ADR-0048 (ERPNext = the
  accounting/costing engine; ledger-sourced display), ADR-0019 (server-enforced SoD), ADR-0016 (RLS is the
  enforcement authority), ADR-0017 (repository seam), ADR-0010 (test pyramid),
  `docs/decisions.md` OD-SAR-PMO-IS-THE-UI / OD-SAR-GATES / OD-SAR-DRAFT-SUBMIT,
  `docs/specs/timesheets-approval.spec.md` (the shipped `FR-TS-001..010` approval state machine).
- **Scope:** the **general rule** for which of two integration postures a domain takes when an external
  system is employed — *external-SoT with a flip* (P2/P3a, shipped) vs **PMO-SoT with an external
  side-mirror** (this ADR, first instance: P3b timesheets) — and the invariants the second posture must
  satisfy. Applies to every tier (ERPNext, ClickUp, Odoo), not just ERPNext. Orgs employing no external
  system are unaffected.

## Context

Every integration PMO has shipped to date takes **one** posture, which ADR-0055 §3/§5 describes and P2
(procurement, parties) and P3a (revenue/AR) implement:

> **External-SoT with a flip.** The external system owns the record. PMO's table becomes a machine-written
> read-model + enhancement layer; a per-command RLS *flip* (`domain_externally_owned(...)` in the policy)
> turns user writes into `42501` while the domain is externally owned; commands go down through
> `adapter-dispatch`; truth comes back through the change feed; a natively-created external document is
> **adopted** into PMO.

P3b (timesheets) is the first domain where that posture is **wrong**, and the owner's P3 intake ruling says so
explicitly:

> **PMO timesheets push to ERPNext only once Approved.** Draft/submitted-but-unapproved timesheets never
> reach ERP. **PMO is the system of record for time entry and approval**; ERPNext receives the approved
> result (for costing/billing).

Applying the shipped posture to that ruling produces four concrete contradictions:

1. **The flip would break the product.** `timesheets`/`timesheet_entries` are authored by every employee in
   the PMO weekly grid. A flip would `42501` the grid the moment an org employs ERPNext — PMO would lose the
   feature it is being paid for.
2. **The approval gate is PMO's, and it is already correct.** `transition_timesheet` (migration `0007`) is a
   shipped, pgTAP-proven state machine with a real SoD ("even an Admin can never approve their own
   timesheet", `0007` A4) and a line-manager authorization matrix keyed on `profiles.manager_id`. The
   external system has no equivalent of a PMO line manager, and re-homing approval into ERP's `docstatus`
   would *lose* authorization semantics, not gain them.
3. **Adoption inverts the ruling.** Adopting a natively-created ERP `Timesheet` into PMO would mint hours
   that never passed PMO approval — precisely what the owner forbade. Under the shipped posture, adoption is
   correct; here it is a defect.
4. **The trigger is an event, not a user command.** Nothing in the shipped model expresses "when this PMO
   record reaches this state, a document must exist over there." A user clicking Approve is not issuing a
   push; the push is a **consequence**, and it must survive the user closing the tab, ERP being down, and a
   background reconciler racing the foreground path.

ADR-0055 §5's ownership map already hinted at this without naming it — its Timesheets row reads:

> | Timesheets | **ERP** | native + costing; PMO weekly-grid UX is the surface; **approve = command** |

Read against the owner ruling, "**ERP**" in that row means *ERP owns the resulting **costing document***,
while "PMO weekly-grid UX is the surface" + "approve = command" means *PMO owns the entry and the approval*.
The row is not wrong; it is **compressed**, and a reader (or a builder pattern-matching on P2/P3a) would
reasonably read "ERP" as "flip it like procurement" and build the wrong thing. The same compression will
recur for Budgets (§6's versioned-plan pattern) and for any future domain where PMO owns a *process* whose
*outcome* the ERP must record. That is worth a recorded decision rather than a spec footnote.

## Decision

### 1. There are exactly TWO integration postures. A domain takes one; the ownership map names which.

| | **Posture A — external-SoT with a flip** (shipped: P2 procurement/parties, P3a revenue/AR) | **Posture B — PMO-SoT with an external side-mirror** (this ADR; first instance: P3b timesheets) |
|---|---|---|
| SoT of the record | the external system | **PMO** |
| PMO table posture | machine-written read-model; **per-command RLS flip** (user write → `42501`) | **unflipped, user-writable, untouched** |
| External-side state lives in | the mirror table itself (`sales_invoices`, `procurement_invoices`, …) | **a separate 1:1 machine-written side table** (`timesheet_erp_mirror`) |
| Authoring + approval authority | the external system (+ a PMO-side SoD RPC where the ERP has none) | **PMO's own shipped state machine** (`transition_timesheet`) |
| Write trigger | a user command | **a PMO state transition** (+ a reconciling sweep backstop) |
| Idempotency key | client-minted per attempt (`freshIdempotencyKey()`) | **deterministic** (`<prefix>:<pmo_id>:<state_stamp>`) — see §4 |
| Inbound adopt of a natively-created external doc | **adopt** (mint the PMO mirror) | **never adopt** — ack-and-skip + surface (§5) |
| Reversal | drop the flip; the read-model is now stale PMO data | **`drop table <side_mirror>`** — **zero PMO data loss** |
| Failure blast radius | a user command fails; the user sees it | **the PMO transition already succeeded** — the failure is durable state + an operator surface (§6) |

Both postures share, unchanged: the adapter contract, `adapter-dispatch` as the served boundary, the
ADR-0058 outbox + atomic recovery, `external_refs`/lineage, the change-feed engine, the `org_id` seam, and
the rule that **RLS is the enforcement authority** (ADR-0016).

### 2. The general rule for choosing a posture

> **A domain is Posture B (PMO-SoT + side-mirror) if and only if PMO owns a *process* — authoring and/or an
> authorization/approval step with semantics the external system cannot express — whose *outcome* the
> external system must record. Otherwise it is Posture A.**

The decisive test, in order:

1. **Does PMO run an authorization step the external system cannot represent?** (a line manager from
   `profiles.manager_id`; a PMO role; a PMO-only SoD.) If yes → **B**. *Timesheets: yes — ERPNext has no PMO
   line-manager concept.* *Purchase Invoices: no — ERP's submit **is** the authorization.*
2. **Would flipping the PMO table remove a feature users use daily?** If yes → **B**. *The weekly grid.*
3. **Is a natively-created external document a legitimate PMO record?** If **no** (adopting it would
   bypass PMO's process) → **B**. *A Desk-created Timesheet has not passed PMO approval.*
4. **Is the external document derivable from PMO state at a known moment?** If yes, the push can be a
   consequence → **B** is available. If the external document accretes truth PMO cannot derive
   (an ERP-computed `outstanding_amount`, a GL posting) → **A**.

Ties break to **A**: it is the shipped, better-tested posture, and mis-choosing B costs a duplicated
external document, whereas mis-choosing A costs a broken feature. **The posture is a property of the domain,
recorded in ADR-0055 §5's ownership map (§7 below), not a per-org configuration** — an org may employ or not
employ a domain, but it cannot choose its posture.

### 3. Posture B's non-negotiable invariants

Any Posture-B domain **must** satisfy all seven. They are the price of PMO holding SoT while an external
system holds a derived copy:

1. **The PMO process is untouched.** The push adds a *consequence* to a transition; it never modifies the
   transition's RPC, schema, RLS, or state map. *(A DB function cannot call an edge function anyway —
   "push from inside the RPC" is both impossible and wrong.)*
2. **The PMO transition never depends on external liveness.** The push runs **after** the transition commits,
   outside its transaction; a push failure of any class never fails, blocks, rolls back, or retry-loops the
   transition. **The user's action always succeeds.**
3. **The precondition is re-asserted server-side, from the database, before any external call.** The
   dispatch re-reads the PMO record's state under the **caller's own JWT** and rejects anything else before
   adapter selection, before the outbox, before the external call. The command payload is **never** trusted
   to assert the precondition. *(This closes the whole "forged payload" class by construction: the gate
   either reads the required state from the DB or it throws — there is no null/absent branch to fall into.)*
4. **Two originators ⇒ a deterministic idempotency key** (§4).
5. **Never adopt** (§5).
6. **The failure is durable and visible** (§6).
7. **Reversible by `drop table`.** The side mirror holds only external-side state; no PMO data is lost when
   the integration is removed. *(An explicit property Posture A does not have — a Posture-A reversal leaves
   PMO holding stale ex-read-model rows.)*

### 4. Deterministic idempotency keys (the Posture-B delta to ADR-0058)

ADR-0058 applies **verbatim** — the `external_command_outbox`, the `claim_outbox_for_commit` atomic claim,
the `claim_generation` fencing token, the fenced finalization, the state table. One thing changes:

> **A Posture-B push key is derived, not minted:** `'<prefix>:' || <pmo_record_id> || ':' || <state_stamp>`
> (P3b: `'ts:' || timesheet_id || ':' || approved_at`).

**Why (binding rationale).** Posture B has **two legitimate, independent originators** — the foreground
transition path and the reconciling sweep — **with no shared client state**. A freshly-minted random key per
attempt would make the outbox's `unique (org_id, domain, pmo_record_id, idempotency_key)` constraint
**useless for exactly the collision it exists to prevent**: sweep and user racing to two external documents.
With a derived key the second originator fails atomically (`23505`) and reconciles to the winner's result.
Including the **state stamp** (the `approved_at` the gate read) keeps a legitimate future re-transition a
*different* command rather than a silently suppressed one.

**Corollary — recovery must fail closed even without an anchor.** ADR-0058 §3's recovery probe needs a stock
external field that survives the external system's `validate` hook. Today a `null` anchor means "skip the
probe → fall through to a fresh claim+POST" — i.e. **reissue-capable**. For a Posture-B document that is a
silently **duplicated** external record (P3b: a duplicated week of hours → inflated project cost).
Therefore: **an anchor-less Posture-B kind is `held` on inconclusive post-window recovery, never
auto-reissued** — reaching ADR-0058 C-1's posture by a different route (C-1 holds because the anchor is
*mutable*; this holds because there is *no* anchor). Mechanically this is one **additive, default-absent**
registry flag (`neverReissue`) and one line:
`reissueOnInconclusiveAbsence = !(entry.anchorMutable || entry.neverReissue)` — every shipped kind is
byte-for-byte.

### 5. Never adopt — the SoT-inversion guard

> **In a Posture-B domain, an inbound external document with no `external_refs` mapping (i.e. created
> natively in the external system) is ACK-AND-SKIPPED and surfaced as `action-required`. It is NEVER
> adopted into PMO.**

This is the deliberate **inverse** of Posture A's adopt rule (P3a FR-SAR-085 mints a mirror for a
natively-created Sales Invoice, and that is correct — there ERP is SoT). Under Posture B, adoption would mint
a PMO record that never passed PMO's process, inverting the very ruling that made the domain Posture B.
Inbound is therefore **lifecycle-only** for PMO-originated documents: stamp `erp_*`, tombstone on external
cancel, guard on `erp_modified` monotonicity — and **never** write the PMO SoT table.

**Corollary — never fight the operator.** An external-side cancel of a pushed document must **not** be
auto-re-pushed by the sweep (the backstop would instantly re-create what a human just cancelled — an infinite
fight). It tombstones the side mirror, marks the push state failed, and surfaces `action-required`. The PMO
record stays in its approved state: **PMO's approval is not the external system's to revoke.**

**Exception — reference/master data is Posture A even inside a Posture-B domain.** A Posture-B domain may
still need to *read* external master records to resolve its own references (P3b: an ERP `Employee` per
timesheet author). Those are **adopted normally** (the shipped party-adopt path — see §8), because PMO is not
their SoT and no PMO process is being bypassed. **The never-adopt rule applies to the domain's *process
documents*, not to the masters it references.**

### 6. Failure is durable, visible, and reconciled — never a silent no-op

Because the PMO transition already succeeded (§3.2), **nothing else will ever surface a failed push**: the
user has moved on and the record looks fine. So a Posture-B domain **must** carry, in the side mirror:

- an explicit **push state** (`pending | pushing | pushed | failed | held`) — the operator surface **and**
  the sweep's work queue, index-served (`(org_id, push_state)`) and bounded per tick so one org's backlog
  cannot starve another's;
- the **classified failure reason**, client-safe;
- a **server-resolved witness** of the state stamp the push was keyed on — written from DB truth, never from
  a payload. *(The Luna P3a audit found a sweep finalizing a mirror with a NULL actor, silently no-op'ing an
  SoD. A Posture-B path with no user JWT must take the **same** server-resolved route as the foreground
  path and **re-assert the same gate** — never "trust itself" because it is the sweep.)*

`held` is terminal until an operator acts. `pushed` and `held` are never re-driven.

### 7. ADR-0055 §5's ownership map gains a posture column (clarification, not contradiction)

ADR-0055 §5 is **amended for clarity**: its ownership map's "Owner" column is now read together with a
**posture**. The Timesheets row is clarified to:

> | Timesheets | **ERP owns the costing document; PMO owns entry + approval** | **Posture B** — PMO weekly-grid UX + `transition_timesheet` are SoT; **approve ⇒ push the approved result**; ERP computes costing/billing from it |

Every other row keeps **Posture A** (its shipped meaning) unless and until a future ADR moves it. **Budgets**
(ADR-0055 §6, "ERP object + PMO versions") is the **most likely next Posture-B candidate** — PMO owns the
versioned plan + its approval, ERP records the approved figure — and should be evaluated against §2's test
when its issue is specced, not assumed either way here.

### 8. What Posture B explicitly does NOT license

- **Not a new mechanism.** Posture B reuses the adapter contract, `adapter-dispatch`, ADR-0058, `external_refs`,
  the feed engine, the sweep, and the shipped party-adopt path for master data. A Posture-B issue that
  introduces a *parallel* dispatch, outbox, or adopt mechanism is doing it wrong.
- **Not bidirectional sync.** ADR-0055 §3's rule stands: PMO does not merge external edits into its SoT
  tables. External-side lifecycle is mirrored; external-side *content* edits to a Posture-B document are an
  operator concern, not an auto-merge.
- **Not a licence to recompute.** ADR-0048 stands: figures the external system computes (costing amounts,
  totals) are mirrored **verbatim** as read-back oracles, never recomputed locally, even though PMO owns the
  inputs. A divergence between PMO's inputs and the external system's computed total is a **reportable
  signal**, never a silent local correction.
- **Not a licence to change the PMO process.** Any change to the PMO state machine a Posture-B domain sits on
  (e.g. adding an `Approved → Draft` re-open so an approved-and-pushed record can be corrected) is **its own
  issue with its own spec and its own owner ruling** — never smuggled into the integration issue.

## Consequences

**Positive**

- The owner's ruling becomes structurally enforceable rather than a convention: with PMO's table unflipped
  and the gate re-reading DB truth, an unapproved record is **incapable** of reaching the external system.
- The integration is **reversible with zero data loss** (`drop table`) — the strongest reversibility posture
  PMO has, and a real de-risker for the first ERPNext client.
- The PMO product keeps its differentiators (the weekly grid, the line-manager approval line) on an employing
  org — the shipped module stays byte-for-byte, flipped or not.
- Future PMO-SoT domains (Budgets, and any "PMO runs the process, ERP records the outcome" case) have a
  named posture, a decision test, and seven invariants instead of a fresh argument each time.
- ADR-0055 §5's most misreadable row is disambiguated **before** a builder pattern-matches it into a flip.

**Negative / accepted costs**

- **Two postures to know.** A reviewer must now ask "which posture?" before judging a design. Mitigated by
  §2's test and by ADR-0055 §5's posture column being the single lookup.
- **A second originator is a new concurrency surface** — P2/P3a had exactly one. Mitigated by the
  deterministic key (§4) + ADR-0058's atomic claim/fencing; it is the sharpest residual risk and is
  e2e-proven at the real served boundary with a fault seam.
- **The push can fail after the user is gone**, which Posture A never permits. Mitigated by §6's durable
  state + operator surface + sweep — but it is genuinely a new operational surface (someone must watch it).
- **Correction gaps become visible.** P3b's `Approved` is terminal, so an approved-and-pushed week has no
  in-app fix; this sits against OD-SAR-PMO-IS-THE-UI. Deliberately **not** solved here (§8) — it is an open
  owner question on the P3b spec (OQ-TSP-6).
- **Divergence is possible in principle.** PMO's inputs and the external system's document can drift (a desk
  edit). Posture B mirrors lifecycle and reports divergence rather than auto-merging (§8) — a deliberate
  choice to keep ADR-0055 §3's no-bidirectional-sync rule intact.

**Neutral / follow-ups**

- ADR-0055 §5's map should be updated with the posture column when this ADR is accepted (a docs edit; the
  §7 wording is ready to lift).
- Budgets (ADR-0055 §6) is flagged for a §2 posture evaluation at spec time — **not** pre-decided here.
- The `neverReissue` registry flag (§4) is additive and default-absent; ADR-0058 §3/§4 should gain a
  cross-reference to this ADR's anchor-less corollary when this is accepted.
