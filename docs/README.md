# `docs/` index — what's here, and what's the source of truth

Orientation for a new session/agent. This folder is **reference material — NOT loaded as session context.**
Read the source-of-truth docs first; treat `plans/` and `design-mockups/` as a historical build archive.

## Source of truth (read these first)
| File | Holds |
|---|---|
| **`backlog.md`** | **The living status** — what's shipped, what's deployed (▶ DEPLOYMENT — LIVE), what's open/deferred. Start here. |
| **`decisions.md`** | Every locked owner decision (`OD-*`) — the binding product/scope calls. |
| **`environments.md`** | The deploy + ops runbook (Supabase Cloud + Cloudflare Pages + 1Password `op-get.sh`; branch topology; the port-5432 rule). |
| **`adr/`** | Architecture Decision Records `0001–0022` (no 0013). The durable "why" of every architectural choice. `0006` (hosting) is **ACCEPTED** (deployed). |

## Durable reference (the contracts the code follows)
| Path | Holds |
|---|---|
| **`specs/`** | SDD specs per feature — `FR-`/`AC-` requirements; Playwright/pgTAP/unit tests trace to these AC-ids. |
| **`product-expectations.md`** | The product charter + per-layer Definition of Done (binding on all agents). |
| **`director-playbook.md`** | The Director's per-issue orchestration loop, gates, grading rubric. |
| **`design-workflow.md`** | The UI/UX cycle (Foundation → per-UI-issue loop) + the standing 3-lens rendered design-review battery + the design-agent→skill-command map. |
| **`design/`** | `crud-components.md` (the CRUD component architecture) + `rbac-visibility.md` (role×affordance gating map) — the spec the shipped CRUD/RBAC follows. |
| *(repo root)* **`DESIGN.md`** | The live design-system source of truth (tokens/components) — reverse-engineered from the app; supersedes the exploration mockups. |

## Historical archive (completed work — kept for traceability; the real record is git + the code)
| Path | What it is |
|---|---|
| **`plans/`** | Implementation plans, one per shipped build (dated `YYYY-MM-DD-*`). All correspond to merged PRs; the backlog links several for traceability. Reference, not active. |
| **`design-mockups/`** | The Phase-0 design exploration — IA/visual `proposal-*.html` (IA-3 + a visual were chosen) and the CRUD `crud-*.html` taste-gate mockups. Superseded by the live app + `DESIGN.md`; kept as the design-decision record. |

> Cleanup note: `plans/` + `design-mockups/` are large but git-backed + referenced; deleting them is redundant
> with history and would dangle links. They're intentionally retained as the build/design archive, not cruft.
