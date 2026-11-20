# `docs/` index — what's here, and what's the source of truth

Orientation for a new session/agent. This folder is **reference material — NOT loaded as session context.**
Read the source-of-truth docs first. Finished plans, reviews, spikes and mockups are **deleted, not
archived** (owner, 2026-11-19): git history retains every removed file — `git log --all --diff-filter=D -- docs/` or
`git show <sha>:docs/plans/<name>.md` recovers any of them.

## Source of truth (read these first)
| File | Holds |
|---|---|
| **`backlog.md`** | **The living status** — current state, the active program, open/deferred items. Start here. (Lean by design; shipped-program *history* is in `history.md`.) |
| **`decisions.md`** | Every locked owner decision (`OD-*`) — the binding product/scope calls. Grep by id. |
| **`environments.md`** | The deploy + ops runbook (Supabase Cloud + Cloudflare Pages + 1Password `op-get.sh`; branch topology; the port-5432 rule; parallel-worktree local-stack hygiene). |
| **`factory-workflow.md`** | **The operating model** — three actors (owner · Director · factory), executor routing, decision rights, the drive loop. Read before starting any build. |
| **`operator-runbook.md`** | Operator (platform) procedures — org creation, lifecycle, membership, the RIS provisioning sequence. |
| **`orca-dispatch.md`** | **How agent work is dispatched** — Orca supervised workers on any harness and model; routing table. |
| **`adr/`** | Architecture Decision Records. ⚑ Do NOT enumerate counts or ranges here — this row rotted twice by trying to; the id-collision class is gated by `scripts/check-adr-collisions.sh`. `ls docs/adr/` is the index and `grep -r ADR-00NN` finds citations. The durable "why" of every architectural choice. |
| **`pmo-portal/CHANGELOG.md`** | Per-release notes + deploy manifest (app sha · migration high-water · edge-fn state). ⚑ It is under `pmo-portal/`, NOT the repo root. Versioning convention is **ADR-0042** (SemVer, pre-1.0). Current version: read `pmo-portal/package.json` / the latest `v*` tag, never this row. |

## Durable reference (the contracts the code follows)
| Path | Holds |
|---|---|
| **`money-path-primer.md`** | ⭐ **Read this BEFORE touching any money flow** (budget activate, invoice/payment submit, procurement transition, timesheet push) — it exists specifically so an agent does not re-derive the outbox/sweep/SoD architecture from source. Cheapest context in the repo. |
| **`roadmap-spines.md`** | The 9-spine contractor business model + generalization roadmap (spine status, gap analysis, sequencing, decision log). Durable strategic reference; `backlog.md` is the live status tracker. |
| **`glossary.md`** | Canonical domain language (Delivery, Milestone, Task, Document, Revision, Superseded, O&M, Spine …). Binding — when usage conflicts, the definition wins. |
| **`specs/`** | SDD specs per feature — `FR-`/`AC-` requirements; Playwright/pgTAP/unit tests trace to these AC-ids. LIVE by default (they describe shipped behaviour); a spec is removed only when its feature is removed from the app. |
| **`analytics-events.md`** | The PostHog event taxonomy + naming/property contract (the analytics spec, PR #77). Reference when instrumenting a new surface. |
| **`product-expectations.md`** | The product charter + per-layer Definition of Done (binding on all agents). |
| **`qa-portfolio.md`** | **The QA model (ADR-0030):** Discover→Graduate→Cover, the layer table, the `routes×oracles` denominator, the vendoring (buy-the-engine/build-the-skin) backlog. Supersedes the 4-lens ×2 battery. |
| **`retention.md`** | Data-retention registry — every log/queue/history table and cron job declares its keep/purge policy here. **`scripts/check-retention.mjs` (in `check:guards`) reads and enforces it.** |
| **`director-playbook.md`** | The Director's per-issue orchestration loop, gates, grading rubric. |
| **`e2e-parallel-conventions.md`** | Read before authoring any e2e spec — isolation classes, the `@e2e-isolation` tag, the guard-polarity rule. |
| **`runbooks/`** | Operational runbooks: `pmo-cli.md` (the client CLI and `pmo load`), `incident-response.md`, `restore-drill.md`, `entra-option-b-setup.md`, `agent-cost-measurement.md`, `integration-trap-state-recovery.md`. |
| **`microsoft-365-integration.md`** · **`posthog-dashboards.md`** | M365 integration reference · the PostHog dashboard set. |
| **`agents/`** | Config the vendored skills read (issue tracker, triage labels, domain, skills map). |
| **`design-workflow.md`** | Foundation and the screen-composition skill pointer; the review-mode fallback battery is in `archive/design-workflow-lens-battery.md`. |
| **`jtbd.md`** | **Lens D oracle** — the role × job-story map that `design-reviewer` grades every FE screen against. Living: each new feature adds its job story here during intake (before spec). Charter: `docs/reviews/2026-06-14-intent-lens-gap.md`. |
| **`design/`** | The shipped CRUD/RBAC layer's live spec: `crud-components.md` (component architecture) + `rbac-visibility.md` (role×affordance gating map) — cited by ADR-0017 and `e2e/AC-CO-001`. |
| **`perf-baseline.md`** | The recorded Lighthouse/perf baseline the performance program measures against (roadmap item 1). |
| **`owner-digests/`** | The owner's decision digests for draft specs and field-work tickets (current input to pending owner decisions). |
| *(repo root)* **`DESIGN.md`** | The live design-system source of truth (tokens/components) — reverse-engineered from the app. |

## Working documents and kept history
| Path | What it is |
|---|---|
| **`plans/`** | Implementation plans **for current or upcoming programs only** (e.g. the screen-by-construction program, the Odoo route slices, ERP-connect-at-any-time). Shipped builds' plans are deleted once their work ships or drops; git history keeps them. |
| **`reviews/`** | Kept reviews only: the standing oracles (JTBD census + walkthrough + Lens-D charter, read by `scripts/wf/jtbd-consumers.mjs`), the ADR-0030/ADR-0084-cited records, the backlog-cited P3BC/FU1 records, and the showreel/UX-discover series still feeding open screen programs (#492, #806, #898). Point-in-time audits of finished work are deleted; git history keeps them. |
| **`spikes/`** | Kept spikes only: investigations cited by ADRs, shipped adapter code (ERPNext field maps), migrations, the backlog or `decisions.md` — plus their `assets/`. Concluded spikes are deleted; git history keeps them. |
| **`handoffs/`** | `cloud-builder.md` — still read by cloud builders. Finished session handoffs are deleted; git history keeps them. |
| **`superpowers/`** | The e2e parallel-isolation design doc + plan that `docs/qa-portfolio.md` and `docs/e2e-parallel-conventions.md` cite as the shipped isolation model. |
| **`history.md`** | The shipped-program timeline (write-wave → CRUD/RBAC → UI realignment → UX-naturalness W1–6 → deploy → analytics → delivery → doc-upload). Not needed for status; narrative links to removed artifacts now say "in git history". |
| **`kanna-program.md`** | The KANNA parallel-build model (§1) — still the operating model cited by `director-playbook.md` and `environments.md`; the program itself shipped 2026-06-16. |
| **`archive/`** | Only the reversible-fallback battery (`design-workflow-lens-battery.md`, the `4-lens`/`3-lens` review-mode path kept intact per ADR-0030) and `pi-delegation.md`. Nothing new is archived here — finished docs are deleted. |
