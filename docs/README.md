# `docs/` index — what's here, and what's the source of truth

Orientation for a new session/agent. This folder is **reference material — NOT loaded as session context.**
Read the source-of-truth docs first; treat `plans/` and `design-mockups/` as a historical build archive.

## Source of truth (read these first)
| File | Holds |
|---|---|
| **`backlog.md`** | **The living status** — current state, the active program, open/deferred items. Start here. (Lean by design; shipped-program *history* is in `history.md`.) |
| **`kanna-program.md`** | The KANNA gap-closing **execution plan** — wave sequencing, the parallel-build/serialized-owner operating model, per-wave cadence. The active program's playbook (backlog tracks its status). |
| **`decisions.md`** | Every locked owner decision (`OD-*`) — the binding product/scope calls. Grep by id. |
| **`environments.md`** | The deploy + ops runbook (Supabase Cloud + Cloudflare Pages + 1Password `op-get.sh`; branch topology; the port-5432 rule; parallel-worktree local-stack hygiene). |
| **`pi-delegation.md`** | **How role-agent work is currently dispatched** — the pi CLI (GLM/codex) trial: model routing, invocation, dispatch mechanics, resource isolation, rendered-UI verification. |
| **`adr/`** | Architecture Decision Records `0001–0045` (no 0013; no 0026 — the 0026 migration was a bug-fix RPC, below the ADR threshold). Latest: `0043` agent thread/event persistence + run lifecycle (tool-call journal/durable resume, progress heartbeat, feedback), `0044` agent automations (cron+event, minted-owner-JWT background deputy) + notifications inbox, `0045` transcript interaction contracts (typed widgets, ask-user, live context) — **Accepted (owner-directed 2026-07-03)**, the batteries-included-A architecture (build pending). Prior: `0039` PMO-native agent architecture + untrusted-output validation boundary, `0040` the in-app agent panel (+ 2026-07-03 addendum: sidecar retired, verdict cherry-pick), `0041` model-calling agent actions (capability seam beyond `DeputyContext`) — all **Accepted & shipped** with the agent-native epic A1–A4 (PR #200, on `main`); `0042` **versioning & release convention** (SemVer pre-1.0; the bump rule + release-manifest for future agents) — **Accepted**. Earlier: `0036` agent-native user-composed UI, `0037` query-spec DSL + RLS-scoped compiler, `0038` view-renderer executor — **Accepted**. The durable "why" of every architectural choice. `0006` (hosting) is **ACCEPTED** (deployed). |
| *(repo root)* **`CHANGELOG.md`** | Per-release notes + deploy manifest (app sha · migration high-water · edge-fn state). Versioning convention is **ADR-0042** (SemVer, pre-1.0). Prod = `v0.1.0`; `main` in dev toward `v0.2.0`. |

## Durable reference (the contracts the code follows)
| Path | Holds |
|---|---|
| **`roadmap-spines.md`** | The 9-spine contractor business model + generalization roadmap (spine status, gap analysis, sequencing, decision log). Durable strategic reference; `backlog.md` is the live status tracker. |
| **`glossary.md`** | Canonical domain language (Delivery, Milestone, Task, Document, Revision, Superseded, O&M, Spine …). Binding — when usage conflicts, the definition wins. |
| **`specs/`** | SDD specs per feature — `FR-`/`AC-` requirements; Playwright/pgTAP/unit tests trace to these AC-ids. |
| **`analytics-events.md`** | The PostHog event taxonomy + naming/property contract (the analytics spec, PR #77). Reference when instrumenting a new surface. |
| **`product-expectations.md`** | The product charter + per-layer Definition of Done (binding on all agents). |
| **`qa-portfolio.md`** | **The QA model (ADR-0030):** Discover→Graduate→Cover, the layer table, the `routes×oracles` denominator, the vendoring (buy-the-engine/build-the-skin) backlog. Supersedes the 4-lens ×2 battery. |
| **`director-playbook.md`** | The Director's per-issue orchestration loop, gates, grading rubric. |
| **`design-workflow.md`** | The UI/UX cycle (Foundation → per-UI-issue loop) + the standing **4-lens** rendered design-review battery (A visual / B flow / C structure / **D intent**) + the design-agent→skill-command map. |
| **`jtbd.md`** | **Lens D oracle** — the role × job-story map that `design-reviewer` grades every FE screen against. Living: each new feature adds its job story here during intake (before spec). Charter: `docs/reviews/2026-06-14-intent-lens-gap.md`. |
| **`design/`** | `crud-components.md` (CRUD component architecture) + `rbac-visibility.md` (role×affordance gating map) — the spec the shipped CRUD/RBAC follows. Also: `delivery-feature-audit.md` (delivery UI findings, all resolved) + `delivery-redesign-plan.md` (the approved redesign task-plan; durable design record for PR #79). |
| *(repo root)* **`DESIGN.md`** | The live design-system source of truth (tokens/components) — reverse-engineered from the app; supersedes the exploration mockups. |

## Historical archive (completed work — kept for traceability; the real record is git + the code)
| Path | What it is |
|---|---|
| **`history.md`** | The shipped-program timeline (write-wave → CRUD/RBAC → UI realignment → UX-naturalness W1–6 → deploy → analytics → delivery → doc-upload). Was the bulk of `backlog.md`; not needed for status. |
| **`reviews/`** | Committed competitor/feature analyses (e.g. the KANNA gap analysis). NB: `review/` (singular, no `s`) is gitignored local scratch — cite `docs/reviews/` for anything durable. |
| **`plans/`** | Implementation plans, one per shipped build (dated `YYYY-MM-DD-*`). All correspond to merged PRs; the backlog links several for traceability. Reference, not active. |
| **`design-mockups/`** | The Phase-0 design exploration — IA/visual `proposal-*.html` (IA-3 + a visual were chosen) and the CRUD `crud-*.html` taste-gate mockups. Also `delivery-redesign.html` (the owner-approved delivery UI mockup for PR #79). Superseded by the live app + `DESIGN.md`; kept as the design-decision record. |

> Cleanup note: `plans/` + `design-mockups/` are large but git-backed + referenced; deleting them is redundant
> with history and would dangle links. They're intentionally retained as the build/design archive, not cruft.
