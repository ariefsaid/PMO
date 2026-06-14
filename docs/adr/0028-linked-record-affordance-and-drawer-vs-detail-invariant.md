# ADR-0028 — Linked-record affordance via ProjectNameLink and drawer-vs-detail invariant

**Date:** 2026-06-15
**Status:** Accepted
**Deciders:** Director + implementer
**Tags:** navigation, UI, IA

---

## Context

The JTBD census (2026-06-14) found that project names in cross-record contexts (Approvals
approval rows, Gantt chart bars, and other list surfaces that reference a project) were plain
text — not clickable links — so a user viewing a procurement approval had no way to drill into
the project without navigating to the Projects page first. This is a "dead display" pattern
identified as a JTBD gap.

Simultaneously, the census verified that all list and detail pages had retired the old
"drawer-as-record" pattern (CW-4b, 2026-06-11) in favor of routable `/entity/:id` detail
routes. This retirement is architecturally significant: it makes every record deep-linkable,
browser-back-navigable, and shareable — but it creates an invariant that must not regress.

## Decision

### 1. ProjectNameLink component

A shared `ProjectNameLink` component (`src/components/ui/ProjectNameLink.tsx`) renders a
project's name as a styled `<Link to="/projects/:id">` wherever a project is referenced in a
cross-record context. It accepts `{ id, name }` as minimal props and is styled as an inline
anchor matching the app's link token (`text-primary`, `hover:underline`).

This component is the SINGLE affordance for cross-record project linkage. Any surface that
displays a project name in a list/row/card that is NOT the Projects list itself MUST use
`ProjectNameLink` rather than plain text.

### 2. Drawer-vs-detail invariant

No `*Detail.tsx` page and no list page (`Companies / Contacts / Incidents / Projects /
Procurement`) may import the `<Drawer>` component. These pages use routable `/entity/:id`
detail routes — not drawers.

This invariant is enforced by a static-analysis Vitest test
(`pages/__tests__/drawer-guard.test.ts`) that greps the source files and fails the build if
any guarded file re-introduces a Drawer import.

## Consequences

**Positive:**
- Every project name in a cross-record context (Approvals, Gantt, Kanban, CRM) is now a live
  link — the "name" job-story verb is fulfilled at all surfaces.
- The drawer-vs-detail invariant is machine-enforceable, preventing accidental regression.
- Deep-linkability and browser back-nav remain intact for all record types.

**Negative / trade-offs:**
- `ProjectNameLink` requires a project `id` wherever it's used; contexts that only have a
  project `name` (without the FK) cannot use it. These are rare (the FK is always present in
  properly joined queries per the repository seam).

## Alternatives considered

- **Render a mini drawer on name click:** rejected — re-introduces the drawer-as-record
  pattern and breaks the deep-link invariant.
- **No enforcement test:** rejected — the ADR-0021 retirement took weeks; a static guard
  makes the invariant self-documenting and CI-enforced.
