---
status: proposed
date: 2026-11-12
---

# ADR-0099 — Figure families have one definition and an agreement gate

Draft for owner review; not an accepted ruling.

## Context

The same business label can conceal different populations, clocks, tax bases or completeness rules.
Duplicating arithmetic in individual screens makes a correction local to one caller. Distinct valid
measures, such as spending and budget consumption, must remain distinct.

## Proposed decision

Give each figure family one named definition and one owning module. Its interface includes
population, period, currency, tax and completeness basis, not merely a number. Callers and tests cross
the same seam. Share derivation where runtimes permit; when SQL and TypeScript must both implement
a rule, use a common set of contract fixtures to prove agreement. Unknown remains unknown and
currencies are never combined.

An agreement gate compares only equivalent scopes, across the real caller paths. Different scopes
must receive different names or explicit scope labels rather than being forced to the same value.
Place deterministic proofs at the lowest sufficient layer; rendered owner judgement remains separate.

## Consequences

Changing one definition gains leverage across its callers and gives maintenance locality. Migration
is family by family, preserving each existing ruling until an explicitly reviewed replacement is
accepted. There is no generic formula engine or new global data-fetching module.

## Supersedes

If accepted, extends ADR-0030's data-correctness gates and ADR-0017's repository seam; supersedes
no accounting ruling. ADR-0076's estimated recognition and DD-1739-SPLIT's spend/consumption distinction remain.
