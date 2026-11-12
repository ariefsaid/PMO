---
status: proposed
date: 2026-11-12
---

# ADR-0098 — Existing purchase evidence is record-only, per step

Draft for owner review; not an accepted ruling.

## Context

ADR-0093 separates linked outside documents from PMO-authored documents. Treating an entire
purchase as either wholly outside or wholly PMO-authored loses mixed histories: an outside order
may already exist while its receipt or payment still needs recording. Recreating existing evidence
and making all later activity read-only are both poor fits.

## Proposed decision

Record-only describes evidence of buying already performed, not a separate lifecycle and not a
command to buy again. Determine existing evidence per purchase step. Linking preserves the outside
document's identity; capture records evidence without instructing the accounting system to create
that same document. A deliberate new accounting document remains an explicit command with the
ordinary command identity, approval and recovery semantics.

The module's interface uses purchase steps, document identity and evidence state. Each adapter
translates its own document vocabulary. Preserve multiple documents, partial receipts and payments,
unknown evidence and standalone operation; a linked order does not decide the invoice step.

## Consequences

Callers can ask one purchase-evidence module what is known for a step instead of reconstructing a
whole history. Tests cross that interface with standalone and connected adapters and include mixed
histories and retry identity. This is a proposed consolidation, not authorization to change a money path.

## Supersedes

If accepted, clarifies ADR-0093's evidence model and amends only its interpretation at mixed-history
entry paths. Does not replace ADR-0055's ownership assignment or ADR-0058's command identity.
