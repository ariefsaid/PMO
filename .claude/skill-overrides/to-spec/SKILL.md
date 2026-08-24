---
name: to-spec
description: Turn the current conversation into a PMO Portal spec — no interview, just synthesis of what you've already discussed — with EARS functional requirements, Given/When/Then acceptance criteria, and test-pyramid ownership. Project-upgraded override. Writes docs/specs/<feature>.spec.md. For a from-scratch requirements WORKSHOP (interviewing the owner), use feature-forge — it stays the loop's step-2 owner for new behavior; this skill is the no-interview synthesis path when the thread already holds the requirements.
disable-model-invocation: true
---

Take the current conversation context and codebase understanding and produce a spec. **Do NOT interview the user** — synthesize what you already know. (`feature-forge` owns the interview workshop; `spec-miner` owns reverse-engineering existing code. This skill converts an already-had discussion into the same artifact they produce.)

## Process

1. **Ground it.** Explore the repo for the current state if you haven't. Use the project's domain vocabulary (`docs/glossary.md`) throughout, and respect any ADRs (`docs/adr/`) in the area you're touching. Check `docs/decisions.md` (OD-*) — a spec that contradicts a locked owner decision is wrong before it is written.

2. **Pick the seams.** Sketch where you'll test the feature. Prefer existing seams; use the highest seam possible; the fewer, the better. Confirm the seams match expectations before writing.

3. **Write the spec** to `docs/specs/<feature>.spec.md` in the project's normal format:
   - IDs: `FR-###` (functional), `OBS-###` (observed/legacy), `NFR-###`, `AC-###` (acceptance).
   - Requirements in **EARS** (ubiquitous / event-driven `When…` / state-driven `While…` / optional `Where…` / conditional `While…when…`).
   - All acceptance criteria in **Given/When/Then**.
   - A **traceability table** assigning each `AC-###` its owning test layer per ADR-0010 (unit / pgTAP / curated e2e) — one owning layer per AC, never push an AC up a layer to satisfy a convention.
   - If the work is architecturally significant (schema, auth, cross-cutting, irreversible), note that an ADR is needed — authorship stays with the planner (`eng-planner`).
   - **Public-repo rule (CLAUDE.md banner):** if the spec documents an unpatched weakness, the spec carries a neutral stub and the detail goes to the private channel until the fix ships.

## Is this a PORT, a MIGRATION, or a REWRITE? (ask first — binding)

If the work moves existing behaviour from one place to another — another branch, framework, schema,
design system, service — **it is not a feature spec and the format above is not enough on its own.**
Ports fail differently from features: a missing feature does nothing, so you notice; a missing port
keeps serving the old thing, so you do not. Three additions are mandatory (post-mortem-derived, from
a sibling repo's design port that was declared DELIVERED with 253 element-level differences unported):

1. **Decide the decomposition axis explicitly, and write down why.** For a port the default axis is
   **"what conflicts?"**, not "what does the user see?" Split the tree first: where the target is
   merely *behind* the source → **copy wholesale**, one commit, no per-file judgement; where the
   target has genuinely *diverged* → port carefully, with per-file decisions. Getting this backwards
   is the failure mode.

2. **Write an equivalence requirement, with a measure.** e.g. *"When any route is rendered, the
   system shall be visually equivalent to the source build at 1280/768/380px"* — and name the check
   that proves it. A spec whose criteria are all structural can be fully satisfied by an app that
   looks nothing like its source. **No stated measure = no definition of done.**

3. **Give the cross-cutting layer its own stage, before the surfaces.** Tokens, shared component
   kits, i18n catalogs, the design document itself, shell chrome — none of it is reachable by
   working through surfaces, so a surface-shaped plan can never discover it. List it explicitly and
   merge it first.
