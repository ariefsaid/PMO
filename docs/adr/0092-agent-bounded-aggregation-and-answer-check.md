# ADR-0092 — Bounded aggregation and final-answer check for the agent

- **Status:** Accepted
- **Date:** 2026-10-22
- **Deciders:** Director
- **Related:** ADR-0039 (deputy/RLS authority), ADR-0050 (layered agent prompt), ADR-0052 (agent eval harness)
- **Spec:** `docs/specs/assistant-accuracy.spec.md`
- **Plan:** `docs/plans/2026-10-22-assistant-accuracy-tuning-8a2cbb50.md`

## Context

The assistant's accuracy losses arise in its own loop: overdue results expose counts but not rows; the prompt forbids useful overdue follow-ups; `query_entity` lacks aggregation and comparison; the loop samples at 0.8; and no pass checks a draft's figures against tool evidence. The remedy must retain caller-scoped reads, deterministic server-rendered overdue output, and a reliable draft fallback.

## Decision

1. Add bounded aggregation to `query_entity` over the caller's existing `ctx.supabase` client and JWT. Page reads in bounded batches, reduce incrementally, and stop at 5,000 matching rows. Exactly 5,000 rows is marked `truncated: true`; do not probe beyond the cap. Model-facing partial results carry an explicit partial-totals note. RLS remains the authority; no service-role business-data reads are introduced.
2. Give the model compact overdue rows and project counts while retaining the existing server-rendered panel verbatim. Mark counts partial when existing fetch caps truncate the source. The model may answer explicitly requested overdue shapes from these rows.
3. Use a default-on final-answer check for nonempty final stop drafts. Show progress, pass the original draft and uncompacted tool evidence to a tools-disabled model call, and emit its nonempty text. On failure or missing text, emit the exact draft. An exact `false` runtime switch disables checking.
4. Use `DEFAULT_AGENT_TEMPERATURE = 0.2` for tool-loop, stop-synthesis, and check calls.

## Consequences

**Positive:** Aggregation counts caller-visible rows beyond response-page caps without retaining full records; overdue follow-ups have the evidence they need; and final answers receive a bounded evidence check with no answer-loss failure mode.

**Costs and limits:** Aggregation is capped and offset paging is not a transactional snapshot. Check calls add latency and cost and do not guarantee factual accuracy. High-cardinality results may increase prompt context. Existing transport bounds remain unchanged.

## Alternatives considered

- Service-role aggregation or a new database aggregation endpoint: rejected; caller JWT/RLS must define visibility, and a SQL snapshot/API is outside this bounded change.
- Counting a capped ordinary row list: rejected; it can report incomplete totals as complete.
- Replacing the server-rendered overdue panel with model output: rejected; the deterministic renderer and its existing semantics remain intact.
- Recursive tool use during answer verification: rejected; verification is one tools-disabled call, with draft fallback.
