# Assistant reel journeys: eval result on the deployed model (#1596)

**Date of run:** 2026-11-02 · **Where:** local, manual (`pmo-portal/evals/`, ADR-0052; evals do not run in CI)
**Model:** the deployed assistant model, `deepseek/deepseek-v4.1-flash-1017` (DeepSeek 4.1 Flash)
**Journeys:** the two reel journeys, `whats_overdue` and `draft_invoice` (issue #1596 names their suites:
`pmo-portal/evals/cases/tool-selection.eval.ts`, `pmo-portal/evals/cases/invoice-reach.eval.ts`). **Runs:** 10.
**Bar:** 9 passes in 10 runs per journey (AC-AIN-003, NFR-AIN-QUAL-001; re-affirmed by OD-GRILL-20261101 "Evals (#1596)").

## Result (scores only, per OD-GRILL-20261101)

| Measure | Result as recorded |
|---|---|
| Score over the 10-run eval | 86/90 |
| Tool choice | the right tool on every completed turn |

This is the figure recorded at the time (`CLAUDE.md`, agent / LLM surface row). No prompt, transcript, key or
response body is stored here.

## Reading it

- **Tool choice:** the deployed model picked the right tool every time it finished a turn.
  The claim that the reel journeys rest on a weak tool-selector (`docs/reviews/2026-10-31-showreel-promise-reaudit.md`,
  item 4) is answered, for tool choice, by this measured result.
- **What the record does not split:** the per-journey pass counts (`whats_overdue` vs `draft_invoice`) and the
  cause of the 4 of 90 that did not score were not written down with the result. The overall 86/90 (95.6%)
  is above the 9-in-10 bar, but whether each journey on its own cleared 9/10 cannot be read from this record.
- **Follow-up (AC-EVAL-REEL-002):** none is named for tool choice (no wrong-tool turn). On the next eval run
  after a prompt or tool change, record the per-journey split and the reason for any turn that does not score
  next to this file, so AC-EVAL-REEL-002 can be judged per journey.

## Acceptance status

- **AC-EVAL-REEL-001:** partly met. The date, the run count and the overall score are recorded; the per-suite
  pass counts are not.
- **AC-EVAL-REEL-002:** cannot be judged per journey from this record. It stays open on #1596 until a run records
  the per-journey split.
