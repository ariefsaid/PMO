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

### 1b. State the intent
One paragraph from the issue, commits and PR: what this change is for. Reviewers judge the **execution, never the goal**; an unclear intent is asked about, not guessed.

### 2. Identify the spec source
In order: (1) issue refs in commit messages; (2) a path the user passed; (3) a spec under `docs/specs/` or plan under `docs/plans/` matching the branch/feature; (4) else ask. No spec → the Spec axis reports "no spec available" (that is itself a finding for a feature change).

### 3. Run the axes (isolated contexts, then aggregate)
- **Spec** — required behavior missing/partial; behavior not asked for (scope creep); requirements implemented wrong. Quote the spec line per finding. Verify each `AC-###` at its owning layer: `grep -r AC-###` must find the proving test, and it must pass. **Do not trust the implementer's report; verify by reading code.**
- **Quality** — single-responsibility, decomposition, naming, maintainability, test quality — against the repo's documented standards (CLAUDE.md architecture patterns, the Companies reference slice) plus the smell baseline below. Two rules: **the repo overrides** (a documented standard wins), and **always a judgement call** (a smell is a labelled heuristic, never a hard violation; skip what tooling enforces).
- **Security** — OWASP Top 10 + STRIDE on auth, Supabase **RLS policies**, security-definer RPCs, and the `org_id` tenancy seam. Think like an attacker, report like a defender; no security theater. Confirm RLS on every business table touched; migrations reversible; **mutation-check** any security-critical rule (break it — the tests must go red). Remember this repo's proof-defect history: a `prosrc LIKE` match and a `throws_ok(sql, code, null)` are not proofs.
- **Design/Discover** *(if UI changed)* — rendered on rich seed, against `DESIGN.md` + the design-plan; every finding **graduates** (test + matrix cell + KB note) per `docs/qa-portfolio.md`.

### Finding discipline (every axis)
*Adapted from poteto's pstack (`interrogate`, `blast-radius`) and Strix (`counterevidence`, `severity_calibration`).*
- **Trace before you flag.** Each finding names who, doing what, sees what wrong outcome, with evidence = the traced path (`file:line` chain or a run), not an assertion. A hypothetical no real caller can reach is **Dismissed** with the reason. "I'd do it differently" is not a finding. No praise; "no findings" is a valid result.
- **Severity after reachability**, never before (the `role_table_grants` rule, CLAUDE.md).
- **Security closure states:** every candidate ends **confirmed**, **ruled out** (name the control + `file:line`, and show it runs *before* the effect, on the attacker's path) or **open proof gap**. These do NOT rule it out: a library's reputation, a control on a sibling path, a control that runs too late, one that can fail open.
- **Triage:** **Act on** (would block a real PR; more than 5 means the filter is loose) / **Consider** / **Noted** / **Dismissed** (with reasons, so the Director can override).
- **A verdict covers one patch.** If the diff changed after the verdict, re-review the delta.

### Quality-axis additions
- **Blast radius:** the one fact this change is safe because of, and its proof level (`file:line`, or ran it). Look past the diff: DB columns, wire formats, a new enum/status value traced through **every** consumer, sibling call sites.
- **Idempotency:** what if it runs twice, or a previous run crashed halfway? Status transitions atomic.
- **Gate integrity:** list every hunk touching tests, CI, lint config, snapshots, skips or allowlists; any weakening is a finding. `eslint-disable`, `@ts-ignore` and casts are suspect.
- **Root cause vs symptom:** a guard masking a broken invariant, a cast silencing a modelling error. Could a type, constraint or test make it impossible?
- **Structure flags (only these):** a file pushed past 1,000 lines; ad-hoc branches added to unrelated flows; two ways to do one task; a hand-synced list.

### Security-axis checklist (Supabase stack)
- **Deciding artifacts at head**, not migration text: `pg_policies`, `role_table_grants`, definer functions (owner, `search_path`, EXECUTE grants), `supabase/config.toml` function JWT settings, storage policies.
- RLS covers SELECT, INSERT, UPDATE and DELETE separately; `org_id` bound to the JWT, never to a client-sent column.
- Every security-definer RPC takes org/user from the JWT, not its arguments; `search_path` pinned; no anon EXECUTE.
- Edge functions verify the JWT/signature **before** any privileged client or side effect; no fail-open path; SSRF on integration URLs; JWT issuer/audience.
- Leaks: `count=exact`, embed over-fetch, error and export text. Service key never client-reachable.
- Client-sent payloads cannot set columns the user may not (mass assignment); per-record ids checked (IDOR); role gates enforced server-side (`can()` is UX only).
- Money and race paths: double submit, outbox idempotency, SoD server-enforced.
- Agent surface: prompt injection → tool calls; tools run as the caller, never the service role; output validated before DB writes.

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
- The local final gate green with fresh evidence (CLAUDE.md); CI's full `verify` is the merge gate — never approve a merge on a red or unrun CI check.
- RLS on every business table touched; `org_id` seam intact; reversible migrations.

### 5. Aggregate & record
Present each axis under its own heading, **without merging or reranking across axes** — separation stops one axis masking another. Per axis: findings in the triage buckets above (Critical/Important/Minor severity on each), then Assessment (ship / fix-then-ship / rework). Security adds a coverage table with an explicit "not assessed" row for each checklist item that applies but was not checked. Record substantial review rounds in `docs/reviews/` (the project's existing ledger convention). A review that surfaces a decision (a finding accepted as a known limitation, a deliberate deferral) records it in `docs/decisions.md` — ledgers get archived; decisions must not live only there. **Public-repo rule:** an unpatched finding goes to the private channel, not into a tracked file or issue (CLAUDE.md banner).

## Why separate axes
A change can pass one and fail another: standards-clean but wrong feature; exactly-what-was-asked but breaks RLS. Reporting them separately keeps one from masking the others.
