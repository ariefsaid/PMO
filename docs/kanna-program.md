# KANNA gap-closing program — execution plan

> ⚑ **COMPLETED / ARCHIVED (2026-06-16).** All KANNA waves 0–3 (Export/Import, Calendar, Kanban, S-Curve, Gantt v1→v2, CRM contacts+activity, procurement attachments, mobile) shipped to `main` long ago; the coherence wave + JTBD remediation followed. This file is the *historical* execution plan — **not an active program.** Live status: `docs/backlog.md`; QA model: `docs/qa-portfolio.md`.

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

> **⚑ This is an OPT-IN, TRANSIENT mode — not the default SOP.** The default is **series**: one issue at a
> time, role work dispatched via **pi** (`docs/director-playbook.md` §2 + `docs/pi-delegation.md`). This
> wave/parallel mode is switched on *deliberately* to exploit a window of abundant **Claude weekly quota**
> (active 2026-06-13, ~2 days). **Executor flips by mode:** series → **pi** (spares the Claude 5h quota);
> the parallel burst → **Claude `Task` subagents** (pi hits its 5h limits fast under parallel load, so the
> burst spends the abundant weekly Claude quota instead). `docs/pi-delegation.md` stays unchanged — it is the
> series executor. When the quota window closes, **revert to series + pi.** Everything below describes the
> parallel mode only.
>
> **Status (2026-06-14): the parallel burst has concluded.** Waves 0–3 + the coherence wave are on `dev`
> (PRs #84–#112). The Claude weekly-quota window is consumed; **default SOP reverts to series + pi.**

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

### Process lessons from the 2026-06-14 burst (durable, applies to future bursts)
1. **Doc commits via PR, not direct push.** Direct-to-`dev` doc commits orphan silently when the `-q` push is rejected against a moved `origin/dev`. Always land docs via a PR + verify the merge landed.
2. **Worktree `.env.local`.** Worktrees lack the gitignored `.env.local` — copy it from the main checkout and use a fresh port; otherwise local e2e can't authenticate.
3. **Pre-assign ADR + migration numbers in briefs.** Parallel agents collided on ADR-0023 in this burst; pre-assigning in the Director's brief prevents the collision.
4. **Build agents must run the FULL unit suite before push.** A subset-green-but-full-red failure slipped through twice; the CI gate caught it, but costs a cycle.
5. **Scope e2e locators tightly.** Strict-mode duplicate failures occur when UI restructuring moves elements; scope locators to their container to survive layout changes.

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

| Wave | Feature | Gap # | Effort | Dependency | Status |
|---|---|---|---|---|---|
| **0** | 8 mobile/UX @390 fixes | UX debt | ~8 streams | none | **✅ `dev` PRs #84–#91** |
| **1** | Procurement attachments (quotation files + GR/VI) | EPC daily-pain | ~1 sprint | reuses #78 upload infra | **✅ `dev` PR #94** |
| **1** | Bulk Export (xlsx) | #4 (T1) | 1 sprint | none | **✅ `dev` PR #92** |
| **1** | Project Calendar view | #3 (T1) | 1–2 sprints | none | **✅ `dev` PR #93** |
| **2** | S-Curve (planned vs actual) | #8 | 1–2 sprints | met (rides milestones) | **✅ `dev` PR #95** |
| **2** | Projects Kanban | #5 | 1 sprint | none | **✅ `dev` PR #96** |
| **3** | Gantt chart | #2 (T1) | 2–3 sprints | met (`task_dependencies` seeded) | **✅ `dev` PR #98** |
| **3** | Bulk Import wizard (xlsx) | #4 (T1) | 1 sprint | none | **✅ `dev` PR #99** |
| **3** | CRM: contacts + activity log | #9 | 2 sprints | none | **✅ `dev` PR #100** |
| **Coherence** | Whole-app pattern unification | audit finding | ~10 PRs | on top of waves 0–3 | **✅ `dev` PRs #103–#112** |
| Next (series) | Sub-projects (hierarchy) | #7 | 2 sprints | none | not started |
| Next (series) | Append-only `audit_events` table | #14 note | S | none | not started |
| Big track | In-house chat (Chatscope + Realtime) | #1 (T1) | 4–5 sprints | none | own program |
| Big track | Custom report builder | #6 | 3–4 sprints | met (storage shipped) | own program |
| Big track | **Spine-4 Revenue/AR** (progress billing, retention, change orders) | spine 4 | large | rides milestones | **asymmetry play KANNA can't match** |
| Big track | Project templates (#17) + Guest/external access (#19) | #17/#19 | M / L | OD-PROC-6 RBAC config engine | own program |
| Later | PWA · AI assist · native app · i18n · enterprise 2FA/IP | #11–#16,#18 | varies | varies | Tier 3 |

**Sequencing rationale:** quick, independent wins first (Wave 1) to bank momentum + bank the parallel-via-CI
muscle; medium independent features next (Wave 2); coherence audit + unification before promote to ensure
"feels like one app"; the heavy collaborative/financial tracks (Chat, Report builder, Revenue/AR) as their
own programs. Don't only chase parity — **exploit asymmetry:** Spine-4 Revenue/AR ties into the milestones
already built and is differentiation KANNA cannot match today.

## 4. Wave 1 — delivered

> Status: **DELIVERED on `dev` (2026-06-14), review-pending.** Built via the parallel burst — **grill + mockup were
> skipped per the owner's directive for this run; the Director locked the `[OWNER-DECISION]`s.** Composition changed vs
> the original draft: Bulk **Import** was split out (Export shipped now; the Import wizard shipped in Wave 3 as PR #99)
> on the owner's visual-first-for-demo steer, and **Calendar** shipped read-only. Shipped: **Export** (#92), **Calendar** (#93),
> **Procurement attachments** per-phase child tables (#94). **Waves 2–3 + coherence** are also on `dev`. Prod unchanged at 0027/#83.

| Feature | Shipped scope | Key decisions locked |
|---|---|---|
| **Procurement attachments** | Per-phase child tables (`procurement_*_files`), RLS, storage integration (migration 0028). Quotation/GR/VI phases only; PR/PO-header deferred (ADR-0023). | Separate `procurement-files` bucket; staff+ delete; org-scoped RLS with stamp-trigger. |
| **Bulk Export** | Export any DataTable view to Excel (xlsx). Projects deliberately skipped on PR #92 — add as a one-liner now that Calendar/Kanban merged. | Companies/Incidents/Procurement/SalesPipeline in v1. |
| **Project Calendar** | Read-only calendar view toggle on Projects over project + milestone target dates (migration 0029 calendar-milestone RPC). | Month view; click-through to record; no drag-to-reschedule in v1. |

---

*Owner: the Director maintains this doc; the owner signs off each wave's composition in the Phase-A grill.*
