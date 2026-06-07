# Product Expectations & Definition of Done

This document is **binding on the Director and all role agents**. Part A is the product charter
(the owner's expectations, verbatim). Part B is the per-layer Definition of Done. Part C is the
cross-cutting policy (quality gates, checkpoints, design & data rules). `CLAUDE.md` carries the
enforced summary; this file is the full source of truth.

---

## Part A — Product charter (verbatim)

### Director / Orchestrator
Before delegating, or after receiving work from subagents:
- Ask clarifying questions
- Challenge bad decisions
- Identify scaling risks
- Suggest better approaches
- Prioritize simplicity

Think long-term like someone responsible for maintaining this product for 5+ years.

Then provide:
- Technical decisions
- Tradeoff analysis
- Recommended architecture
- Implementation plan
- Production-ready solution

### Architecture
From a Product Architecture perspective: build a production-ready startup MVP. Design a scalable
production-grade system architecture. Then build the minimal implementation that could realistically
scale in the future. Optimize for scalability, maintainability, and real-world production usage.

Include: system architecture · component structure · file structure · data flow · database schema ·
API endpoints · caching strategy · UI architecture · production-ready code.

Build it like a real startup — as minimal as viably possible to cater for 1 client, but scalable to
cater to millions of users in mind.

### Existing repo
Since it's an existing repo, reverse-engineer the architecture and understand the complete data flow.
Then identify: bad architecture decisions · duplicate logic · performance bottlenecks · scalability
risks · maintainability issues.
Finally provide: a clean architecture breakdown · critical problem areas · refactoring strategies ·
improved production-grade code.
**Do not change functionality. Only upgrade code quality, scalability, and maintainability.**

### Performance
Keep in mind for performance optimization — if not at the start, at least aspirationally.
Goals: maximum speed · lower memory usage · better scalability · faster rendering · cleaner execution.
Identify: performance bottlenecks · inefficient logic · unnecessary rendering · expensive operations ·
memory leaks.
Provide: performance issue breakdown · optimization strategies · improved production-ready code ·
scalability recommendations.

### Frontend
Build production-grade UI systems for a modern startup. Create: reusable UI components · scalable
component architecture · accessible production-ready interfaces.
While building, carefully handle: loading states · empty states · edge cases · responsive design ·
accessibility · component reusability · clean developer experience.
Provide: component architecture · props/API design · production-ready implementation · usage examples ·
best practices.

### Debugging
Act like a senior debugging engineer investigating a live production issue. Analyze the codebase step
by step like you're handling a critical outage at a fast-growing startup. Your job: understand what
the code actually does · trace the real root cause · explain why the failure happens · identify hidden
edge cases · propose the most robust fix possible.
Provide: code functionality breakdown · root cause analysis · failure explanation · edge case analysis ·
fixed production-ready code. **Do not guess. Think deeply before making changes.**

### Security
Carefully inspect the system for: security vulnerabilities · authentication flaws · API weaknesses ·
injection risks · sensitive data exposure · infrastructure risks.

### DevOps & deployment
Keep in mind — if not for MVP, at least aspirationally: design deployment architecture · configure
CI/CD · set up monitoring/logging · improve reliability · reduce downtime risks · optimize scaling.
Provide: infrastructure architecture · deployment workflow · CI/CD pipeline · Docker/Kubernetes setup ·
monitoring strategy · production deployment checklist.

---

## Part B — Definition of Done (per layer)

An issue is **Done** only when every applicable layer's criteria are met. Industry-convention,
production-SaaS bar.

| Layer | Owner | Done means |
|---|---|---|
| **Spec (SDD)** | spec-miner / feature-forge | EARS requirements + Given/When/Then `AC-###` in `docs/specs/*.spec.md`; gaps & edge cases listed; owner has signed off. |
| **Design+Plan** | eng-planner | Design covers architecture, components, data flow, error handling, testing; plan is no-placeholder 2–5 min tasks, each naming the `AC-###` it satisfies; ADR written if the decision is architectural/irreversible. |
| **Data/Schema** | eng-planner + implementer | Migration is reviewed and **reversible**; **RLS enabled on every business table**; `org_id` tenancy seam present and not bypassable; indexes for hot paths; seed/typed-client regenerated. |
| **Build (TDD)** | implementer | RED→GREEN→REFACTOR; no prod code without a failing test first; behavior covered (incl. loading/empty/error/edge); follows existing patterns; YAGNI; **does not change existing behavior when the task is a quality upgrade**. |
| **Frontend/UI** | implementer + `/design-review` | Reusable, accessible (WCAG AA) components; loading/empty/error/edge states handled; responsive; matches `DESIGN.md` tokens; visual `/design-review` passed for UI-affecting changes. |
| **Review** | spec-reviewer → code-quality-reviewer | Spec compliance verified by reading code (not the report); quality pass on single-responsibility, decomposition, naming, maintainability, scalability; no Critical/Important issues left open. |
| **Acceptance (BDD)** | qa-acceptance | Each `AC-###` has a passing **owning test at its lowest sufficient layer** (Unit / pgTAP / E2E per ADR-0010), AC-id-tagged for traceability; cross-stack journeys covered by the curated e2e set; per-AC pass matrix green across all three layers. **Each test encodes the user's real, intuitive journey to accomplish the task end-to-end and asserts the user's goal; the app conforms to the test, never the reverse. On failure: fix the app — or, *only* for a deliberate UX change, update the journey *steps* while keeping the goal-oracle intact — never bend an assertion to the app's current state to go green.** |
| **Security** | security-auditor | For auth/RLS/tenancy/API-surface changes: OWASP Top 10 + STRIDE pass; no High/Critical findings; no secrets in code or history. |
| **Release/DevOps** | release-engineer | Full verification green (typecheck + unit + e2e); one PR per issue with test evidence; no force-push, no `git add -A`; CI gates pass; deploy/monitor steps followed (aspirational items tracked, not blocking MVP). |

---

## Part C — Cross-cutting policy (owner-ratified)

**Coverage gate.** Minimum **80% line coverage on changed code** to merge (production-SaaS norm).
Coverage is necessary, not sufficient — tests must assert real behavior, not inflate numbers.

**Lint / typecheck.** `npm run typecheck` must report **zero errors**. ESLint must report **zero
errors**; CI runs `--max-warnings=0` to prevent warning creep. Both block merge.

**Human checkpoints.**
- **Owner approves:** (a) **spec sign-off** (before any design/build on an issue), and (b) **production
  deployment** and any irreversible/expensive infrastructure change.
- **Director (Opus 4.8) approves:** that work moves toward the project goal *as per the signed-off
  spec* — i.e., merge-to-main within an approved spec, staging/preview deploys, and all intra-spec
  technical decisions. The Director escalates to the owner anything strategic, irreversible, or
  outside the signed spec.

**PR granularity.** **One PR per issue** (clean review + traceability). Trivially-coupled changes may
share a PR only when they cannot be reviewed independently.

**ADR threshold.** Write an ADR (`docs/adr/NNNN-<slug>.md`) only for **architectural, irreversible, or
cross-cutting** decisions (tech/dependency lock-in, tenancy/auth model, schema shape, public API
contract). Not for routine implementation choices.

**Design/UI.**
- `DESIGN.md` at repo root is the **single source of truth** for the design system, in the
  [design.md](https://github.com/google-labs-code/design.md) format (YAML token front-matter:
  colors/typography/spacing/rounded/components + markdown rationale: Overview, Colors, Typography,
  Layout, Elevation, Shapes, Components, Do's & Don'ts). Built via `/design-consultation` (Phase 3).
- Frontend flow per UI issue: **design plan → implement → visual `/design-review`** before merge.
- **Storybook** is adopted for the shared component library (isolated component dev, state matrix,
  a11y checks) — introduced in Phase 3 when the reusable component library is created, not before.

**Data/Schema.** Every migration reviewed + reversible; RLS required on every business table; the
`org_id` single-tenant→B2B seam must be enforced and untestably-bypassable proven absent by the
security-auditor before exposing auth.
