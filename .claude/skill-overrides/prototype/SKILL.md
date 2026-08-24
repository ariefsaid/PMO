---
name: prototype
description: Build a throwaway prototype to answer a design question. Use when the user wants to sanity-check whether a state model or logic feels right, or explore what a UI should look like.
---

# Prototype

A prototype is **throwaway code that answers a question**. The question decides the shape.

## Pick a branch

Identify which question is being answered — from the user's prompt, the surrounding code, or by asking if the user is around:

- **"Does this logic / state model feel right?"** → [LOGIC.md](LOGIC.md). Build a single shareable HTML file — free-play buttons plus tabbed guided walkthroughs — that pushes the state machine through cases that are hard to reason about on paper, and that a non-developer can drive.
- **"What should this look like?"** → [UI.md](UI.md). Generate several radically different UI variations on a single route, switchable via a URL search param and a floating bottom bar.

The two branches produce very different artifacts — getting this wrong wastes the whole prototype. If the question is genuinely ambiguous and the user isn't reachable, default to whichever branch better matches the surrounding code (a backend module → logic; a page or component → UI) and state the assumption at the top of the prototype.

## Rules that apply to both

1. **Throwaway from day one, and clearly marked as such.** Locate the prototype code close to where it will actually be used (next to the module or page it's prototyping for) so context is obvious — but name it so a casual reader can see it's a prototype, not production. For throwaway UI routes, obey whatever routing convention the project already uses; don't invent a new top-level structure.
2. **Trivial to run.** A UI prototype starts from one command in the project's task runner — `pnpm <name>`, `python <path>`, `bun <path>`, etc. A logic demo is a single HTML file the user double-clicks. Either way, no thinking required to start it.
3. **No persistence by default.** State lives in memory. Persistence is the thing the prototype is _checking_, not something it should depend on. If the question explicitly involves a database, hit a scratch DB or a local file with a clear "PROTOTYPE — wipe me" name.
4. **Skip the polish.** No tests, no error handling beyond what makes the prototype _runnable_, no abstractions. The point is to learn something fast.
5. **Surface the state.** After every action (logic) or on every variant switch (UI), print or render the full relevant state so the user can see what changed.
6. **Capture it when done.** Fold any validated decision into the real code, then capture the prototype itself as a **primary source**: commit it to a throwaway branch, out of main, and leave a context pointer to that branch on the implementation issue. Capture the answer too — the verdict and the question it settled — in the issue or a commit. The main branch keeps only the validated decision.

## Decision rights in this repo (PMO override)

> This repo has **three actors, not two**: the **owner**, the **Director** (the main session), and the
> **factory** (SSSF ADWs / pi dispatches). Upstream models only *human* and *agent*, so every decision
> defaults to the human. Here it does not.
>
> **Escalate to the owner only when the question is** commercial (market, price, packaging, what a
> customer accepts) · irreversible and outside a signed milestone brief · a scope-versus-time trade that
> changes what ships · or a fact only the owner holds (client relationships, partner terms, preferences).
>
> **Everything else the Director decides**, states in a line or two with its reasoning, and proceeds.
> Silence is assent; the owner overrides by saying so. Architecture, schema shape, library choice, test
> strategy, ticket structure, and sequencing *within* a signed scope are Director calls.
>
> Record them in `docs/decisions.md`: **`OD-`** = owner-locked (changing one needs the owner) ·
> **`DD-`** = Director decision, binding on agents until revised, **revisitable by the owner at any time
> without ceremony**. When torn between the two, it is a `DD-` with the reasoning written down — never a
> question that stalls the work. Full statement: `docs/factory-workflow.md` § Decision rights.

### Who reacts to the prototype

Split by what the prototype is *asking*:

- **Taste, layout, "does this feel right"** → the **owner** reacts. Render it and show it; do not
  self-assess a taste question.
- **Technical fit — does this library work here, does this state model hold, what does it cost** → the
  **Director** reacts, records a `DD-`, and moves on. These can be dispatched to the factory to build,
  with the Director judging the result.

Either way the prototype stays throwaway and exempt from TDD, and `/handoff` bridges what was learned
back into the issue thread.
