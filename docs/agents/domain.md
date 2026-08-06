# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the
codebase. Single-context repo — no `CONTEXT-MAP.md`.

## Before exploring, read these

- **`docs/glossary.md`** — the domain glossary. This repo's equivalent of the skills' root
  `CONTEXT.md` (the vendor script retargets `grill-with-docs` accordingly; other skills reach it
  via this file).
- **`docs/adr/`** — read ADRs that touch the area you're about to work in.
- **`docs/decisions.md`** — locked owner decisions (OD-*). A skill output that contradicts one is
  wrong before it is written; if you believe a decision should be reopened, say so explicitly.
- CLAUDE.md's **"Read-before-you-touch" table** — per-subsystem primers (money paths, agent/LLM
  surface, e2e authoring, Supabase environments). Read the matching one only when the task touches
  that surface.

If a file doesn't exist, **proceed silently**. `/domain-modeling` (reached via `/grill-with-docs`
and `/improve-codebase-architecture`) creates glossary entries lazily when terms actually get
resolved — never scaffold upfront.

## Use the glossary's vocabulary

When your output names a domain concept (an issue title, a refactor proposal, a test name), use the
term as defined in `docs/glossary.md`. Don't drift to synonyms the glossary explicitly avoids. If
the concept you need isn't in the glossary yet, that's a signal — either you're inventing language
the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0017 (repository seam) — but worth reopening because…_
