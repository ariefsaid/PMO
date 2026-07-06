# ADR-0051 — Conditional-approval predicate for agent write actions

- **Status:** Proposed (owner sign-off at merge of the Tier-2 cmdk-approvals PR)
- **Date:** 2026-07-05
- **Deciders:** Director, eng-planner (owner sign-off pending at merge)
- **Related:** ADR-0040 (in-app agent panel + A3 approve/deny chip), ADR-0019 (server-enforced SoD + destructive-delete gating — the real authority), ADR-0039 (untrusted-output boundary), ADR-0036 §2 (deputy invariant), ADR-0016/0017 (real-JWT deputy + repository seam), ADR-0010 (test pyramid).
- **Spec:** `docs/specs/agent-tier2-capabilities.spec.md` §3 (FR-AT2-APR-001..006), NFR-AT2-SEC-004.
- **Plan:** `docs/plans/2026-07-05-agent-tier2-cmdk-approvals.md` (Track H).

---

## Context

The shipped A3 approve/deny flow (ADR-0040) gates every write action on a **static** boolean:
`AgentAction.confirm?: boolean` (`port.ts:102`). An action is either "always propose a chip" (`confirm:true` —
`create_activity`, `update_task_status`, `create_automation`) or "dispatch immediately" (`confirm:false` —
`query_entity`, `notify`, `compose_view`, `ask_user`). The handler routes on `action.confirm` at the propose
branch (`handler.ts:738`), the decision continuation (`:1181`), and `isConfirmToolUse` (`:1525`).

This is coarse: a trivial task-status change surfaces the same friction chip as a large money-value write. The
Tier-2 catalog (mining item 11) calls for **conditional approvals** — auto-approve reads and low-materiality
writes, reserve the chip for genuinely material or destructive writes — so approval friction tracks real risk.

Two facts constrain the design:
1. **RLS + ADR-0019 are the enforcement authority, not the chip.** A real Separation-of-Duties rule
   (approver≠author, `contract_value`-on-won) or a destructive delete (Admin-only) is enforced by a
   security-definer RPC / restrictive RLS policy + a pgTAP proof. The chip is UX only.
2. **The forced-dispatch invariant must hold.** Only `dispatchActionForced` may execute a `confirm:true`
   action; `dispatchAction` throws for one (`handler.ts:421`). Auto-approve must reuse the forced path, not
   weaken that guard.

## Decision

Add an **optional predicate** to the action contract; keep `confirm` as the forced-dispatch selector.

1. **`AgentAction.needsApproval?: (input: unknown, ctx: DeputyContext) => boolean`** — returns `true` ⇒ the
   handler surfaces the A3 chip for *this instance*; `false` ⇒ auto-approve. The predicate reads the
   **validated** input (post-schema `validation.value`) + **server-side constants** only — never `req.context`,
   never client- or model-supplied thresholds.

2. **Resolution order (`resolveNeedsApproval`, in `handler.ts`):**
   - `isDestructiveDeleteAction(action.name)` ⇒ `true` **always** (FR-AT2-APR-005 — deletes never auto-approve,
     irrespective of a permissive predicate);
   - else `action.needsApproval?(validatedInput, ctx)` if present;
   - else fall back to `action.confirm ?? false` (static behavior preserved — OBS-AT2-001).

3. **Materiality constants are named, server-side, co-located with the action catalog** (`actions.ts`):
   `AGENT_APPROVAL_MONEY_THRESHOLD` (money-value writes at/above it chip; below auto-approve) and
   `isDestructiveDeleteAction(name)` (name-suffix guard). Owner-set values (`docs/specs/…` §OQ-2): threshold
   `10_000` minor units, deletes always material.

4. **Auto-approve reuses `dispatchActionForced`** under the caller JWT — the SAME execution path the
   human-approved continuation runs. `dispatchAction`'s `confirm` guard is untouched; the invariant "only the
   forced path executes a confirm action" holds. `confirm` (forced-dispatch machinery) and `needsApproval`
   (does THIS instance need a human) are orthogonal.

5. **The predicate is UX-only (binding).** It gates ONLY chip visibility. An auto-approved write still passes
   through `dispatchActionForced` under the caller JWT; RLS + the ADR-0019 SoD/delete RPCs reject anything the
   caller may not do, chip-or-no-chip. Auto-approve **never** relaxes a server-enforced rule.

## Consequences

**Positive:**
- Approval friction tracks real materiality; the common interactive write (a benign status change)
  auto-approves, the chip is reserved for material/destructive writes (FR-AT2-APR-006 — chips stay rare).
- Fully backward-compatible: an action with no predicate keeps its exact `confirm` behavior (OBS-AT2-001); the
  A3 chip UX (`ApprovalChip`, `NeedsApprovalPayload`, `control('approve'|'reject')`) is unchanged (OBS-AT2-002).
- Additive + generic: a future write action opts in with one `needsApproval` line + (if money) reads the
  threshold constant — no handler change.

**Negative / risks (mitigated):**
- **Auto-approve is a UX bypass of the human, NOT of enforcement.** The load-bearing reviewer invariant:
  `resolveNeedsApproval` never selects a client, skips `can()`, or bypasses `dispatchActionForced`/RLS. Proven
  by a handler unit test (the auto-approve path touches only `deps.supabase`, the caller-JWT client) AND by the
  EXISTING ADR-0019 pgTAP proofs staying green (a write that auto-approves at the UX layer but violates an SoD
  rule is still rejected by the RPC/RLS — AC-AT2-014).
- **Delete-name heuristic:** `isDestructiveDeleteAction` keys on `delete_`/`_delete` name conventions. No delete
  action exists in the catalog today; the rule is encoded now so a future delete is safe-by-construction. A
  reviewer confirms any new destructive action follows the naming convention (or is added to the guard
  explicitly).

## Alternatives considered

- **A co-located predicate map (name → predicate) instead of a field on `AgentAction`.** Rejected: the action
  already owns its typed `validate`/`summarize`; the predicate is the same locality and keeps the contract in
  one place. A map would split the action's approval logic across two files.
- **A materiality score returned by `validate`.** Rejected: conflates input validation with the human-in-loop
  decision; a boolean predicate is the minimal, testable seam.
