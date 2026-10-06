# ADR-0079 — Agent coarse tools: server-resolved proposals and server-rendered answers

- **Status:** Proposed (Director accepts at merge of #787)
- **Date:** 2026-10-06
- **Deciders:** Director, eng-planner
- **Related:** ADR-0050 (layered prompt — a new tool is an index line + a skill), ADR-0052 (eval harness — the real
  gate for model behaviour), ADR-0051 (approval predicate), ADR-0039 (deputy invariant + untrusted-output boundary),
  ADR-0016 (`can()` is UX only), ADR-0019 (server-enforced SoD), ADR-0058 (command identity / idempotency), ADR-0048
  (ERP money is read, not recomputed).
- **Spec:** `docs/specs/assistant-invoice-reach.spec.md` · **Plan:** `docs/plans/2026-10-06-assistant-invoice-reach.md`

## Context

The deployed agent model (deepseek-v4-flash) is a weak tool-selector. Two showreel journeys (#787) need it to
(1) answer "what's overdue?" across every project plus invoices, and (2) draft a sales invoice the user confirms.
Built from today's fine-grained tools, journey 1 is a multi-call plan (one task read per project — tasks require a
project filter — then invoices, then date arithmetic) and journey 2 needs the model to look up a work order, its
project, the client, an ERP item and a tax-correct amount before proposing. Each extra step is a place the weak
model drops the plan.

The approval protocol shipped in A3 has two gaps for a money write: `validate`/`summarize` are synchronous, so a
chip can only echo the model's raw arguments (the user would confirm "invoice WO-12", not "IDR 1,000,000 to PT
Client"); and the model writes the final answer, so links and figures depend on the model copying them faithfully.

## Decision

1. **One coarse tool per journey.** `whats_overdue` (read, no arguments) and `draft_invoice` (confirm-gated write).
   The server does the multi-step work under the caller's JWT; the model makes one call.
2. **Confirm actions may declare an async `prepare`.** It runs under the deputy context after `validate` and before
   the chip, resolving the request into the exact record to be written. Its value becomes the chip's
   `structuredArgs` and its server-composed summary the chip text. The client already replays `structuredArgs` as
   the pending tool call's input, so on approve the handler validates **that** value with the action's
   `validatePrepared` — an allow-list rebuild that drops any extra field — and executes it. What the user confirmed
   is what is written; nothing is re-resolved after approval. An action with `prepare` **always** shows the chip.
3. **Read tools may return a server-rendered answer** `{ markdown, receipt }`. The handler shows `markdown` to the
   user verbatim and gives the model only `receipt`. Every user-authored string inside it is markdown-escaped.
4. **Agent money writes reuse the existing served write path.** `draft_invoice` calls `adapter-dispatch` through the
   caller-JWT client's `functions.invoke` — the same command the Sales Invoices form sends, built by one shared
   leaf (`salesInvoiceCreateFields`) — so every server gate (tier ownership, Admin/Finance role, project gate,
   create-target guard, money outbox, author from the verified JWT) applies unchanged. The agent only ever sends
   `operation:'create'`; submit stays SoD-gated and must be done by a different Finance/Admin user, so the
   "agent-as-deputy approves its own proposal" circularity the A3 spec deferred cannot arise.

## Consequences

**Positive**
- The weak model's job shrinks to choosing one tool per journey — the thing the eval can measure.
- The chip states real, resolved facts (customer, amount before tax, source) instead of model arguments.
- No second money writer and no second command shape: drift between the form and the agent is structurally
  impossible.
- `prepare`/`validatePrepared` and rendered answers are generic — the next coarse tool reuses them.

**Negative / accepted**
- **Replayed `structuredArgs` are client-controlled.** A user could edit them before approving. This adds no
  authority: the actor is the user acting as themselves, who can raise the same invoice from the form, and every
  server gate re-runs. The allow-list rebuild stops smuggled fields (`verb`, `operation`, authorship).
- **Proposal → approval drift.** Values are frozen at proposal. For work orders this is safe by construction (an
  Issued work order's value cannot change — DD-WO-5); the saved record is a Draft that a second person reviews
  before submit.
- **Handler-rendered text is English** until the Bahasa sweep reaches the assistant.
- **A failed dispatch is not auto-retried.** The command identity is minted at proposal and reused on approve
  retries (outbox de-dupes), but a new request mints a new identity; the timeout message tells the user to check
  before asking again.

## Alternatives considered

- **Many fine tools (invoice read entity + work-order read + item lookup + a thin create).** Rejected: exactly the
  multi-call plan the deployed model fails; the eval would measure planning, not intent.
- **Re-resolve on approve.** Rejected: the user would approve one thing and get another if data moved.
- **Write the invoice row directly (or via a new RPC).** Rejected: forks the money path; the ERP-owned create
  path is the only sanctioned one until #784.
- **Let the model write the overdue list.** Rejected: links and figures become model-dependent; the eval would
  measure copying.
