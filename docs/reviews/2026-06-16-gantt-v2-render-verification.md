# Gantt v2 — rendered verification (owner-directed #0)

> **Verdict: PASS.** The shipped Gantt v2 (`pages/project-detail/ProjectGantt.tsx`, ADR-0031) was
> render-checked live (`npm run dev`, local Supabase, Meridian Steelworks 4.2 MW seed project — 4
> milestones, ~16 dated tasks across all statuses + 2 undated). This closes the one advisory residual
> never vision-glanced: the **390px D1 mobile fallback**. Director-run (L3 vision can't be GLM-delegated —
> pixels). Date: 2026-06-16.

## What was checked (desktop @1440 + mobile @390)

| Aspect | Result |
|---|---|
| MS-Project split layout (sticky left task table + scroll-synced timeline) | ✅ aligned; lane-header bands render as grey rows in both panes |
| On-axis milestone diamonds + dotted vertical guides | ✅ diamonds sit on the date axis (Eng Design ~15 Oct, Procurement ~31 Jan), guide drops through the lane band |
| Dependency connector lines + arrowheads (elbow routing) | ✅ arrowheads feed the dependent bars (PROC rollups, CONST — Site Survey) |
| Day / Week / Month / Quarter zoom | ✅ all rescale geometry; axis ticks + gridlines re-derive per scale |
| Today marker | ✅ dotted blue line + "Today" label at the correct coordinate (Jun 2026) — visible in Quarter view |
| Status pills (Freed-Blue rule) | ✅ In Progress = neutral grey (not action-blue); Done = green; To Do = grey |
| Narrow-bar in-bar label suppression (A3, width<40px) | ✅ sub-40px bars render as empty blocks (no clipped text) in Quarter |
| Undated footer | ✅ present (Risk register / Stakeholder comms — undated) |
| **390px mobile fallback (D1)** | ✅ MS-Project split is replaced by the centered "Open on a larger screen" notice (cal chip + heading + sub + List/Board buttons), mirroring the ListState empty-state family |
| Mobile switch buttons wired | ✅ "List view" → `onSwitchView('list')` → `setView` → active view becomes List, notice gone |

## Test layer (re-run this session)
- `src/lib/gantt/__tests__/ganttLayout.test.ts`, `ganttGeometry.test.ts`, `ProjectGantt.test.tsx` →
  **52/52 pass** (after `npm install` — see env note). DOM-tested ACs `AC-GANTT-D1-1..5` already cover the
  fallback; this pass adds the owed pixel/taste glance.

## Findings
1. **(Incidental, NOT Gantt) S-Curve duplicate React key — minor.** During the session the **S-Curve**
   (`ProjectSCurve.tsx`, recharts `<XAxis scale="time">`) emitted `Encountered two children with the same
   key, tick-1760486400000-44-44` (value = 2025-10-15 epoch ms; recharts key =
   `tick-${value}-${coordinate}-${tickCoord}`). Two auto-generated time-axis ticks collided on the same
   coordinate. **Intermittent** — did not reproduce on a clean reload at 1440px; consistent with recharts'
   `ResponsiveContainer` 0-width first-paint placing ticks at coordinate 0. Dev-only console warning,
   stripped in prod, no visual/functional impact. **The Gantt is clean** — it renders its own SVG axis with
   unique `iso` keys; no Gantt-prefixed key warnings observed. Flagged for separate fix (graduate: explicit
   `ticks` or a stable per-point key on the S-curve axis + a render-without-dup-key-warning assertion).

## Env note (local, durable)
- `node_modules` was stale: `date-fns@4.4.0` (declared in #130) was uninstalled locally → `npm install`
  fixed it (1 pkg). Vite needs a restart after, to re-optimize deps. Without it, every route importing
  `date-fns` (`format.ts`, widely used) white-screens.
- Auth was slow (~15 s, 504 at the gateway) because **three Supabase stacks** run concurrently on this
  machine — load, not a code issue. Endpoint is healthy; the UI login succeeds once the request isn't
  starved.
