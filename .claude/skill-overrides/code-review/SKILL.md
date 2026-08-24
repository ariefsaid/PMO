---
name: code-review
description: Review the changes since a fixed point across the PMO review battery — Spec, Quality (with the Fowler-smell baseline), and Security always; Design conditionally — each in an isolated pass, reported side by side, gated by the project's real gates. Project-upgraded override mapping Matt's two-axis review onto the per-issue loop's step-5 battery. Use to review a branch, PR, or WIP, or when asked to "review since X".
---

Review the diff between `HEAD` and a fixed point the user supplies. This is the loop's **step-5 battery in skill form** — in a Director session the three role reviewers (`spec-reviewer`, `code-quality-reviewer`, `security-auditor`) run as separate dispatches; invoked directly (pi, or a human session), run the same axes as isolated passes and aggregate. **Green gates ≠ reviewed** — a passing CI run is not a substitute for the axes.

## Which axes run
Always, on every code change: **Spec**, **Quality**, **Security** (CLAUDE.md: "3 reviewers, always" — security focuses depth on auth/RLS/RPC/public surfaces and, on a change touching none, confirms that quickly). Conditionally: **Design/Discover** — if any UI changed, the rendered pass per `docs/qa-portfolio.md` (`review mode` at its top decides portfolio vs lens-battery form).

## Process

### 1. Pin the fixed point
Whatever the user said — a SHA, branch, tag, `HEAD~5`. If unspecified, ask. Capture once: `git diff <fixed-point>...HEAD` (three-dot, vs merge-base) and `git log <fixed-point>..HEAD --oneline`. Confirm the ref resolves and the diff is non-empty **before** starting — a bad ref or empty diff fails here.

### 2. Identify the spec source
In order: (1) issue refs in commit messages; (2) a path the user passed; (3) a spec under `docs/specs/` or plan under `docs/plans/` matching the branch/feature; (4) else ask. No spec → the Spec axis reports "no spec available" (that is itself a finding for a feature change).

### 3. Run the axes (isolated contexts, then aggregate)
- **Spec** — required behavior missing/partial; behavior not asked for (scope creep); requirements implemented wrong. Quote the spec line per finding. Verify each `AC-###` at its owning layer: `grep -r AC-###` must find the proving test, and it must pass. **Do not trust the implementer's report; verify by reading code.**
- **Quality** — single-responsibility, decomposition, naming, maintainability, test quality — against the repo's documented standards (CLAUDE.md architecture patterns, the Companies reference slice) plus the smell baseline below. Two rules: **the repo overrides** (a documented standard wins), and **always a judgement call** (a smell is a labelled heuristic, never a hard violation; skip what tooling enforces).
- **Security** — OWASP Top 10 + STRIDE on auth, Supabase **RLS policies**, security-definer RPCs, and the `org_id` tenancy seam. Think like an attacker, report like a defender; no security theater. Confirm RLS on every business table touched; migrations reversible; **mutation-check** any security-critical rule (break it — the tests must go red). Remember this repo's proof-defect history: a `prosrc LIKE` match and a `throws_ok(sql, code, null)` are not proofs.
- **Design/Discover** *(if UI changed)* — rendered on rich seed, against `DESIGN.md` + the design-plan; every finding **graduates** (test + matrix cell + KB note) per `docs/qa-portfolio.md`.

### Smell baseline (Quality axis)
Each smell reads *what it is* → *how to fix*; match against the diff:
- **Mysterious Name** → rename; if no honest name comes, the design's murky.
- **Duplicated Code** → extract, call from both.
- **Feature Envy** — a method reaching into another object's data more than its own → move it.
- **Data Clumps** — the same fields always travelling together → bundle into one type.
- **Primitive Obsession** — a primitive standing in for a domain concept → small domain type.
- **Repeated Switches** — the same cascade on the same type recurs → polymorphism or one shared map.
- **Shotgun Surgery** — one logical change forces scattered edits → gather into one module.
- **Divergent Change** — one module edited for several unrelated reasons → split.
- **Speculative Generality** — abstraction for needs the spec doesn't have → delete (YAGNI).
- **Message Chains** — long `a.b().c().d()` → hide the walk behind one method.
- **Middle Man** — mostly delegates → cut it.
- **Refused Bequest** — implementer ignoring most of what it inherits → composition.

### 4. Domain gates (report pass/fail, don't hand-wave)
- Coverage **≥80%** on changed lines; tests assert behavior (not inflate numbers).
- `npm run verify` from `pmo-portal/` green — the FULL 8 gates, fresh evidence.
- RLS on every business table touched; `org_id` seam intact; reversible migrations.

### 5. Aggregate & record
Present each axis under its own heading, **without merging or reranking across axes** — separation stops one axis masking another. Per axis: Strengths, Issues (Critical/Important/Minor), Assessment. Record substantial review rounds in `docs/reviews/` (the project's existing ledger convention). A review that surfaces a decision (a finding accepted as a known limitation, a deliberate deferral) records it in `docs/decisions.md` — ledgers get archived; decisions must not live only there. **Public-repo rule:** an unpatched finding goes to the private channel, not into a tracked file or issue (CLAUDE.md banner).

## Why separate axes
A change can pass one and fail another: standards-clean but wrong feature; exactly-what-was-asked but breaks RLS. Reporting them separately keeps one from masking the others.
