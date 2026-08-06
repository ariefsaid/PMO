---
name: tdd
description: Test-driven development — the red→green→refactor loop that produces tests worth keeping. Use when building features or fixing bugs test-first, when the user mentions "red-green-refactor", or wants integration tests. Project-upgraded override — Matt's seam/anti-pattern structure fused with the project's enforcement discipline. In Claude Director sessions the superpowers plugin owns TDD; this vendored copy carries the same discipline to pi dispatches, which cannot load plugins.
---

# Test-Driven Development

TDD is the red → green → refactor loop. This skill is the reference that makes the loop produce tests worth keeping. Every section applies on **every** cycle.

Read `docs/glossary.md` so test names and interface vocabulary match the project's domain language, and respect ADRs in the area you touch.

## The Iron Law
```
NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST
```
Wrote code before the test? **Delete it and start over.** Don't keep it "as reference", don't "adapt" it while writing tests. Thinking "skip TDD just this once"? That's rationalization; stop. (Exceptions, ask first: throwaway prototypes via `/prototype`, generated code, config.)

## What a good test is
Tests verify **behavior through public interfaces**, not implementation details. A good test reads like a specification and survives refactors. One behavior per test; if the name needs "and", split it. Real code; mocks only when unavoidable. **The owning test names its `AC-###` in its title** so `grep -r AC-XXX` finds the canonical proof (CLAUDE.md AC-id tagging). Each AC is owned by ONE test at the lowest sufficient layer — unit (Vitest/RTL) / integration (pgTAP) / e2e (Playwright) per ADR-0010.

## Seams — where tests go
A **seam** is the public boundary you test at. **Test only at pre-agreed seams** — before writing any test, write down the seams under test and confirm them (with the user, or with the plan/spec that dispatched you). Prefer the highest existing seam; the fewer seams, the better.

## The loop
1. **RED — write the failing test.** It encodes the user's real, intuitive journey to the goal and asserts the **goal** (BDD authoring rule, CLAUDE.md). Expected values come from an **independent source of truth** — never recomputed the way the code does.
2. **Verify RED (MANDATORY, never skip).** Run the single test file. Confirm it **fails, not errors**, for the **expected reason**. Passes immediately? You're testing existing behavior — fix the test.
3. **GREEN — minimal code to pass.** No speculative features (YAGNI).
4. **Verify GREEN.** Test passes, others still pass, output pristine. Test fails? Fix the **code**, not the test — never bend an assertion to the app's current state.
5. **REFACTOR.** Staying green, adding no behavior.
6. **Repeat.** Final gate before any claim of done: the FULL `npm run verify` (8 gates), never just touched files.

## Anti-patterns
- **Implementation-coupled** — mocks internal collaborators, asserts through a side channel. Tell: breaks on refactor when behavior hasn't changed.
- **Tautological** — the assertion recomputes the expected value the way the code does, so it can never disagree with the code. (This project's pgTAP corollary: suspect every `throws_ok(sql, code, null)` and every `prosrc LIKE` assertion — a comment can satisfy a source-text match with the guard deleted.)
- **Horizontal slicing** — all tests first, then all implementation. Work in **vertical slices**: one test → one implementation → repeat.
- **Unbound tests** — an edge-fn test MUST import the SHIPPED handler from `./index.ts`; copied handlers/validators are a hard CI failure (`check-edge-fn-test-binding`).

## Mutation-check anything security-critical
Break the rule (e.g. `const allowed = true`) and the tests MUST go red. A suite that stays green while the handler is broken is not a suite. After a grant/policy change, re-run mutations against the NEIGHBOURING oracles too — a fix can disarm the oracle next door.

## Bug fixes
Never fix a bug without a test that **reproduces** it first.

## Red flags — STOP and start over
Code before test · test after implementation · test passes immediately · can't explain why it failed · "I'll add tests later" · "already manually tested it" · "keep as reference" · sunk-cost keeping of unverified code · "TDD is dogmatic, I'm being pragmatic".

## Before marking complete
Every new function has a test · you watched each fail for the right reason · minimal code to pass · full `npm run verify` green with fresh evidence · real code · edge/error cases covered. Can't check every box? You skipped TDD — start over.
