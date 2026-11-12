---
status: proposed
date: 2026-11-12
---

# ADR-0100 — Reference patterns set a floor; screen evidence decides composition

Draft for owner review; not an accepted ruling.

## Context

A shared reference design system can reduce repeated interaction work, while copying a reference
screen can erase supported actions or preserve an unsuitable hierarchy. Pixel locks also turn past
composition into an accidental constraint on future design.

## Proposed decision

Use the reference design system as a pattern floor for reusable interactions, all states, accessibility
and responsive behaviour. Preserve the feature floor of the actual screen. Choose composition from
user goals, shipped behaviour, current owner rulings and rendered evidence on representative data;
reference screenshots provide patterns, not a replacement specification.

Existing decisions and product requirements remain binding until explicitly revised. Deterministic
money, date, permission, accessibility, containment and goal tests decide correctness; current rendered
review and owner judgement decide composition. A historical screenshot alone does not override either.

## Consequences

Shared modules gain leverage without forcing every screen into the same arrangement. New review
findings become behaviour proofs and durable decisions; any change to an existing test's oracle needs
an explicit approved UX change and retains its goal. No browser evidence was collected for this draft.

## Supersedes

If accepted, clarifies ADR-0030 and OD-VISUAL-RESET's evidence roles. Does not supersede DESIGN.md
tokens, screen rules, the feature floor or owner approval requirements.
