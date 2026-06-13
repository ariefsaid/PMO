# KANNA gap-closing program — execution plan

**What this is:** the forward **execution & sequencing** plan for closing the KANNA feature gap, fast,
under the project's quality bar. It is the program-level intake artifact — agreed with the owner before
any fan-out.

Distinct from its sibling docs (don't duplicate them here):
- [`docs/reviews/2026-06-11-kanna-gap-analysis.md`](reviews/2026-06-11-kanna-gap-analysis.md) — **what** is
  missing (the analysis + per-gap effort/priority). The source for the wave table below.
- [`docs/roadmap-spines.md`](roadmap-spines.md) — the 9-spine business model (the strategic frame).
- [`docs/backlog.md`](backlog.md) — **live status**; its "ACTIVE PROGRAM" section points here.

Every issue still runs the standard per-issue loop (`CLAUDE.md`, `docs/director-playbook.md`): the **full**
loop for features (intake grill → owner-approved mockup → spec → plan → TDD build → **3-reviewer battery**
spec+quality+security → BDD accept → **design re-review round 2** for UI → ship), right-sized for refactors.
The coverage, typecheck/lint, and CI e2e/pgTAP gates are binding.

---

## 1. Operating model — parallel build, serialized human

Going fast under the quality bar = **parallelize what doesn't contend; serialize what does.** This session
proved the bottleneck isn't building (cheap substrates build fast) — it's **verification + integration +
the human checkpoints.**

### The owner is a single, non-parallelizable resource
Parallel agents have **no access to the human product owner.** Therefore:
- **The Director is the owner's sole proxy.** Every owner-interactive gate — `grill-with-docs` alignment,
  spec sign-off, mockup approval, prod-deploy approval — is **front-loaded and serialized through the
  Director, _before_ any parallel fan-out.**
- **Parallel agents consume only LOCKED decisions.** Their self-contained briefs carry the grilled
  terminology + resolved `[OWNER-DECISION]`s + the approved mockup. An agent must **never** need the owner
  mid-run; if it hits an unresolved owner question it **STOPS and escalates to the Director**, who
  serializes it back to the owner.
- **Batch the human touch.** The Director grills + collects sign-offs for a whole wave in **one serialized
  sitting**, so the owner context-switches once per wave, not once per agent.

### What contends (serialize) vs what's free-parallel
- **Serialize:** the owner checkpoints (above) · `main` merge (one PR at a time, rebase, re-verify) · the
  prod push.
- **Free-parallel:** spec / mockup / build / review across **independent** features — each in its own
  worktree, each its own PR. **CI runs every PR's isolated Postgres + pgTAP + e2e in parallel** (public
  repo ⇒ *unlimited* free Actions minutes; zero local RAM — CI is the "multi-branch DB" we don't get on
  free Supabase). Local stack: up only for interactive DB debugging; `supabase stop` otherwise.
- **The ceiling is Director verification bandwidth ⇒ keep ≤ 3–4 streams in flight.** Past that, the
  Director starts trusting instead of verifying — the exact failure the rigor exists to prevent.

## 2. Cadence per wave
- **Phase A — serial alignment (Director ↔ Owner):** grill the wave's features (terminology, scope,
  `[OWNER-DECISION]`s); for UI features run the design round → **owner-approved mockup** (design 3-lens,
  round 1). One serialized batch. Locks every decision the parallel agents will need.
- **Phase B — parallel build (agents, no owner):** spec → plan → TDD build → 3-reviewer battery + design
  re-review (round 2, drift) — fanned out across the wave's features in worktrees; each pushes a PR; CI
  verifies in parallel. Agents work from locked briefs only.
- **Phase C — serial integration (Director):** verify from CI + light local checks; merge PRs to `main`
  one at a time; batch the owner's visual UX sign-off; ship. Prod push when a shippable set has landed.

## 3. Wave plan (grounded in gap-analysis §3b / §5a)

Effort/priority/dependency are quoted from the gap analysis; "independent" = no dependency on unshipped work.

| Wave | Feature | Gap # | Effort | Dependency | Independent now? |
|---|---|---|---|---|---|
| **1** | Procurement attachments (quotation files + GR/VI) | EPC daily-pain | ~1 sprint | reuses #78 upload infra | ✅ |
| **1** | Bulk Import/Export (xlsx) | #4 (T1) | 1 sprint | none | ✅ |
| **1** | Project Calendar view | #3 (T1) | 1–2 sprints | none | ✅ |
| 2 | S-Curve (planned vs actual) | #8 | 1–2 sprints | met (rides milestones; **not** Gantt) | ✅ |
| 2 | Gantt chart | #2 (T1) | 2–3 sprints | met (`task_dependencies` seeded) | ✅ |
| 2 | CRM: contacts + activity log | #9 | 2 sprints | none | ✅ |
| 2 | Sub-projects (hierarchy) | #7 | 2 sprints | none | ✅ |
| Big track | In-house chat (Chatscope + Realtime) | #1 (T1) | 4–5 sprints | none | own program |
| Big track | Custom report builder | #6 | 3–4 sprints | met (storage shipped) | own program |
| Big track | **Spine-4 Revenue/AR** (progress billing, retention, change orders) | spine 4 | large | rides milestones | **asymmetry play KANNA can't match** |
| Big track | Project templates (#17) + Guest/external access (#19) | #17/#19 | M / L | OD-PROC-6 RBAC config engine | own program |
| Later | PWA · AI assist · native app · i18n · enterprise 2FA/IP | #11–#16,#18 | varies | varies | Tier 3 |
| Cheap, pull-early | Append-only `audit_events` table + transition triggers | #14 note | S | none | compliance posture; cheap |

**Sequencing rationale:** quick, independent wins first (Wave 1) to bank momentum + bank the parallel-via-CI
muscle; medium independent features next (Wave 2); the heavy collaborative/financial tracks (Chat, Report
builder, Revenue/AR) as their own programs. Don't only chase parity — **exploit asymmetry:** Spine-4
Revenue/AR ties into the milestones already built and is differentiation KANNA cannot match today.

## 4. Wave 1 — proposed (to LOCK in the grill, Phase A)

> Status: **draft — the grill input.** Not locked until the owner-serialized grill (Phase A) signs off.

| Feature | One-line scope | Key `[OWNER-DECISION]`s to lock in the grill |
|---|---|---|
| **Procurement attachments** | Attach files to procurement records — quotation files on PR/PO, GR/VI evidence docs — reusing the #78 upload component (FileCell / useFileUpload / signed-URL / private bucket). | Which procurement states allow which attachment types? Required-vs-optional at GR/VI? Who can delete? Reuse the doc bucket or a `procurement-files` bucket? |
| **Bulk Import/Export** | Export any DataTable view to Excel (`xlsx`); an import wizard for projects/companies/tasks with validation + dry-run preview. | Which entities import in v1? Update-existing vs insert-only? Column mapping UX? Role gate on import? |
| **Project Calendar** | A calendar view toggle on Projects (alongside table/kanban) over project + milestone target dates. | Which dates render (project start/end, milestone targets, task due)? Month/week/agenda? Click-through target? Read-only or drag-to-reschedule in v1? |

S-Curve (#8) leads **Wave 2** — it's independent and ready, held only to keep Wave 1 at three streams.

---

*Owner: the Director maintains this doc; the owner signs off each wave's composition in the Phase-A grill.*
