---
name: grilling
description: Grill the user relentlessly about a plan, decision, or idea. Use when the user wants to stress-test their thinking, or uses any 'grill' trigger phrases.
---

Interview the user relentlessly until you reach a shared understanding. Map this as a **design tree**: every decision branches into the decisions that hang off it.

Work the tree in **rounds**. The **frontier** is every decision whose prerequisites are already settled — the questions you can ask _now_ without guessing at answers you haven't heard yet. Ask the whole frontier in one round: number each question and give your recommended answer. Then wait for the user's answers before the next round.

Each question should be formatted like so:

```
❓ **Q1** - **<question title>**: <question body, might be multiple paragraphs, including multiple choices>

➡️ <your recommended answer>
```

Each round the user answers reshapes the tree — settled decisions push the frontier outward and unblock questions that depended on them. Recompute the frontier and ask the next round. A question whose answer depends on another question still open in this round belongs to a _later_ round, not this one.

Finding _facts_ is your job, never the user's. When a frontier question needs a fact from the environment (filesystem, tools, etc.), dispatch a sub-agent to find it — don't ask the user for anything you could look up yourself. Don't block on it: a running exploration is an unsettled prerequisite, so only the questions downstream of it wait for the sub-agent to report — ask the rest of the frontier now. The _decisions_ are the user's — put each to them and wait.

The session is done when the frontier is empty: every branch of the design tree visited, nothing left silently assumed. Do not act on it until the user confirms you have reached a shared understanding.

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

### Drain the whole owner frontier, not one ticket

In a grill session, batch **every** open unblocked owner-resolved question into the rounds — the
owner's attention is the scarce input. Cadence: `docs/factory-workflow.md` § The drive loop.

### What this changes about a round

Sort the frontier **by resolver before you ask anything**. A round then has two parts, decisions first:

```
✅ **Decided** — <one line each, with the reason. Director calls; say them, don't ask them.>

❓ **Q1** - ... (only the questions that pass the escalate-to-owner test)
```

Same rigour, a fraction of the rounds. If a round is about to carry more than a handful of questions,
re-sort it — the surplus is almost always Director calls wearing owner clothes. Record the decided ones
as `DD-` in `docs/decisions.md` when they are durable; a decision that only shapes the current artifact
can live in that artifact.
