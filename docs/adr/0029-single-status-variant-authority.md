# ADR-0029 — Single status→variant authority via status registry (workflowVariant)

**Date:** 2026-06-15
**Status:** Accepted
**Deciders:** Director + implementer
**Tags:** design-system, status, UI

---

## Context

The coherence wave (CW-2, 2026-06-11) established a status→variant registry at
`src/lib/status/statusVariants.ts` as the single source of truth for mapping domain status
strings to the UI's `StatusVariant` token set. Before this, the mapping was inline in each
component, leading to divergent color assignments for the same status across the Projects
list, the Project detail header, and the Sales Pipeline.

The canonical export is `workflowVariant(status: string): StatusVariant` for project/pipeline
lifecycle statuses, and `companyTypeVariant(type: CompanyType): StatusVariant` for company
type pills. All components that render a status pill for a project or opportunity MUST
use these functions rather than local switch/object mappings.

The JTBD census (2026-06-14) confirmed this pattern is consistent across the codebase. This
ADR formalizes the decision so future implementers know where new status → variant mappings
belong.

## Decision

### 1. One registry, one import path

`src/lib/status/statusVariants.ts` is the **sole authority** for status→variant mappings.
Any new domain status (project lifecycle, procurement state, CRM stage, etc.) adds its
mapping here. No component may have a local `switch` or object literal that maps a status
string to a `StatusVariant`.

The key exports:
- `workflowVariant(status: string): StatusVariant` — project and pipeline lifecycle
- `pillVariantForProjectStatus(status: string): StatusVariant` — alias re-exported from
  `components/projects.ts` for backward compatibility; delegates to the registry
- `companyTypeVariant(type: CompanyType): StatusVariant` — company type pills

### 2. Freed-Blue Status Rule

Action-blue (`open` / `primary` variants) is reserved for interactive affordances only —
never for status pills. On-hand "Ongoing Project" uses the neutral `progress` variant
(grey), NOT `open` blue. The LABEL carries identity; color is a redundant secondary cue.
This is enforced by the registry: `workflowVariant('Ongoing Project')` returns `'progress'`,
not `'open'`.

### 3. Registry is the test oracle

Status-to-variant mappings are unit-tested in `src/lib/status/__tests__/statusVariants.test.ts`.
Adding a new status without a test in that file is a coverage gap. The registry tests
are the canonical proof that the mapping is correct.

## Consequences

**Positive:**
- Status color consistency is guaranteed by a single function rather than N component-local
  mappings. A single rename or recolor propagates everywhere.
- The Freed-Blue Status Rule is enforced structurally — there is no place to accidentally
  assign `open` to a status pill.
- The registry test file is the authoritative oracle for QA (grep `AC-CW2-STATUS`).

**Negative / trade-offs:**
- Requires importing from the registry path (`@/src/lib/status/statusVariants`) rather than
  being inline. This is a trivial cost.
- Domain statuses that are purely local to one feature may feel over-engineered when added
  to a shared registry. Accept this: consistency beats convenience here.

## Alternatives considered

- **Per-entity variant files:** rejected — leads to drift when two entities share a status
  label (e.g. "Pending" in projects and timesheets could diverge in color).
- **CSS class strings instead of variant tokens:** rejected — bypasses the design system
  token layer and makes future theme changes harder.
