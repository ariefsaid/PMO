---
name: wayfinder
description: Plan a huge chunk of work — more than one agent session can hold — as a shared map of decision tickets on your issue tracker, and resolve them one at a time until the way to the destination is clear.
disable-model-invocation: true
---

A loose idea has arrived — too big for one agent session, and wrapped in fog: the way from here to the **destination** isn't visible yet. Wayfinding is about finding that way, not charging at the destination. This skill charts the way as a **shared map** on the repo's issue tracker, then works its **decision tickets** — questions whose resolution is a decision, not slices of a build to execute — one at a time until the route is clear.

The destination varies per effort, and naming it is the first act of charting — it shapes every ticket. It might be a spec to hand off and iterate on, a decision to lock before planning starts, or a change made in place like a data-structure migration. The map is domain-agnostic — engineering work, course content, whatever fits the shape.

## Plan, don't do

Wayfinder is **planning** by default: each ticket resolves a decision, and the map is done when the way is clear — nothing left to decide before someone goes and does the thing. The pull to just do the work is usually the signal you've reached the edge of the map and it's time to hand off. An effort can override this in its **Notes** — carrying execution into the map itself — but absent that, produce decisions, not deliverables.

## Refer by name

Every map and ticket is an issue, so it has a **name** — its title. In everything the human reads — narration, the map's Decisions-so-far — refer to it by that name, never by a bare id, number, or slug. A wall of `#42, #43, #44` is illegible; names read at a glance. The id and URL don't vanish — a name wraps its link — but they ride _inside_ the name, never stand in for it.

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

> **Park, don't ask.** An owner-class question surfacing mid-drive becomes a `wayfinder:owner` ticket
> with enough context to answer cold — it does not stop the session. Keep working everything that does
> not depend on it; parked tickets become the next grill session's batch.
>
> ⚑ **Parking is three fields, not one label:** the `wayfinder:ticket` label *alongside* the resolver
> one · `Map: #<n>` as the body's first line · the native sub-issue link to that map. A ticket carrying
> only the resolver label is invisible to the frontier — that is precisely how three owner questions
> stayed hidden through a whole session on 2026-08-21. Run `scripts/wayfinder-doctor.sh` to find any.
> Cadence: `docs/factory-workflow.md` § The drive loop.

## The Map

The map is a single issue on this repo's issue tracker, labelled `wayfinder:map` — the canonical artifact. Its tickets are child issues of the map.

The map is an **index**, not a store. It lists the decisions made and points at the tickets that hold their detail; a decision lives in exactly one place — its ticket — so the map never restates it, only gists it and links.

**Where the map, its child tickets, blocking, and frontier queries physically live is tracker-specific.** The issue tracker should have been provided to you — run `/setup-matt-pocock-skills` if not. Consult the tracker doc's "Wayfinding operations" section for how _this_ repo expresses them. If no tracker has been provided, default to the local-markdown tracker.

### The map body

The whole map at low resolution, loaded once per session. Open tickets are **not** listed — they are open child issues, found by query.

```markdown
## Destination

<what reaching the end of this map looks like — the spec, decision, or change this effort is finding its way to. One or two lines; every session orients to it before choosing a ticket.>

## Notes

<domain; skills every session should consult; standing preferences for this effort>

## Decisions so far

<!-- the index — one line per closed ticket: enough to judge relevance, then zoom the link for the detail the ticket holds -->

- [<closed ticket title>](link) — <one-line gist of the answer>

## Not yet specified

<!-- see "Fog of war": in-scope fog you can't ticket yet; graduates as the frontier advances -->

## Out of scope

<!-- see "Out of scope": work ruled beyond the destination; closed, never graduates -->
```

### Tickets

Each ticket is a **child issue** of the map; the tracker's issue id is its identity. Its body is the question, sized to one 100K token agent session:

```markdown
## Question

<the decision or investigation this ticket resolves>
```

Each ticket carries a `wayfinder:<type>` label — one of `research`, `prototype`, `grilling`, `task` — **and a resolver label**: `wayfinder:owner`, `wayfinder:director`, or `wayfinder:factory`. The type says *how* it is worked; the resolver says *who* works it.

A session **claims** a ticket by assigning it to the dev driving the map, **first**, before any work, so concurrent sessions skip it. That assignee _is_ the claim: an open, unassigned ticket is unclaimed.

Blocking uses the tracker's **native** dependency relationship — essential because it renders the frontier _visually_ in the tracker's own UI, so the human sees what's takeable without opening the map. Only a tracker that lacks native blocking falls back to a body convention. A ticket is **unblocked** when every ticket blocking it is closed; the **frontier** is the open, unblocked, unclaimed children — the edge of the known.

The answer isn't part of the body — it's recorded on resolution (see [Work through the map](#work-through-the-map)). Assets created while resolving a ticket are linked from the issue, not pasted in.

## Ticket Types

Every ticket names **who resolves it** — and in this repo that is a three-way choice, not HITL-vs-AFK:

- **`owner`** — only the owner can answer, per the decision-rights test above. The agent **never** stands
  in for the owner's side of one of these (an agent that answers its own commercial question has broken
  this). Label `wayfinder:owner`.
- **`director`** — the Director resolves it from the code, the docs, and its own judgement, then records
  the call as a `DD-` with reasoning. Most tickets are these. The Director may still *show* the owner the
  call, but does not wait on it.
- **`factory`** — bounded enough to dispatch: an SSSF ADW or a pi dispatch produces the answer and the
  Director verifies it. Route per `docs/factory-workflow.md` § Executor routing. ⚑ `review-money`-class
  work (money SoD, auth, token custody) is **never** `factory` — it stays Director-dispatched.

A ticket mis-labelled `owner` costs the owner's attention; one mis-labelled `director` or `factory` costs
a wrong decision made confidently. When genuinely torn, label it `director` and write the reasoning down —
a `DD-` is cheap to revisit, a stalled map is not.

- **Research** (AFK): Reading documentation, third-party APIs, or local resources like knowledge bases to surface a fact a decision waits on. Resolved by a `/research` **subagent**. Use when knowledge outside the current working directory is required.
- **Prototype** (HITL): Raise the fidelity of the discussion by making a cheap, rough, concrete artifact to react to — an outline, a rough take, a stub, or UI/logic code via the /prototype skill. Links the prototype as an asset. Use when "how should it look" or "how should it behave" is the key question.
- **Grilling** (HITL): Conversation. The default case. Always invoke the /grilling and /domain-modeling skills.
- **Task** (HITL or AFK): Manual work that must happen before a _decision_ can be made — nothing to decide, prototype, or research, but the discussion is blocked until it's done. Signing up for a service so its API can be judged, provisioning access, moving data so its shape can be seen. This is the one type that _does_ rather than decides — and it earns its place by unblocking a decision, not by delivering the destination. The agent drives it alone where it can (AFK); otherwise it hands the human a precise checklist (HITL). Resolved when the work is done; the answer records what was done and any resulting facts (credentials location, new URLs, row counts) later tickets depend on.

## Fog of war

The map is _deliberately_ incomplete: don't chart what you can't yet see. Beyond the live tickets lies the **fog of war** — the dim view of decisions and investigations you can tell are coming but can't yet pin down, because they hang on questions still open. Resolving a ticket clears the fog ahead of it, graduating whatever's now specifiable into fresh tickets — one at a time, until the way to the destination is clear and no tickets remain.

The map's **Not yet specified** section is where that dim view is written down: the suspected question, the area to revisit later. It's the undiscovered frontier _toward_ the destination — everything here is in scope, just not sharp enough to ticket. Write as loosely or as fully as the view allows; it doubles as a signpost for collaborators reading where the effort is headed.

**Fog or ticket?** The test is whether you can state the question precisely now — _not_ whether you can answer it now.

- **Ticket when** the question is already sharp — even if it's blocked and you can't act on it yet.
- **Not yet specified when** you can't yet phrase it that sharply. Don't pre-slice the fog into ticket-sized pieces: it's coarser than a ticket, and one patch may graduate into several tickets, or none, once the frontier reaches it.

**Not yet specified** excludes what's already decided (Decisions so far), what's already a live ticket, and what's out of scope (the next section).

## Out of scope

Fog only ever gathers _toward_ the destination. The destination fixes the scope, so work beyond it is **out of scope** — it isn't fog, and it doesn't belong in **Not yet specified**. It gets its own **Out of scope** section on the map: work you've consciously ruled out of _this_ effort. Scope, not sharpness, lands it here.

Out-of-scope work never graduates — the frontier stops at the destination — so it returns only if the destination is redrawn, and then as a fresh effort, not a resumption.

Ruling something out of scope is a scoping act, not a step on the route. When a ticket that already exists turns out to sit past the destination — mis-scoped in while charting, or exposed by a resolution — **close it** (a closed ticket is unambiguously off the frontier) and leave one line in the **Out of scope** section: the gist plus why it's out of scope, linking the closed ticket. It stays out of **Decisions so far**, which records the route actually walked — a scope boundary isn't a step on it.

## Invocation

Two modes: **chart** a new map, or **work** an existing one.

> **PMO override — the one-ticket-per-session cap is replaced.** Upstream caps a session at one ticket
> because it assumes a human answers every question, so their attention is the bottleneck. Here the
> bottleneck depends on the resolver, so the cap is per *kind*, not per session:
>
> | Ticket kind | How many per session |
> |---|---|
> | `wayfinder:owner` | **All of them**, batched into `/grilling` rounds. Draining the frontier in one sitting is the point — the owner's attention is spent once, not once per ticket. |
> | `wayfinder:director` | **As many as context allows.** Chain them, recording a `DD-` each. Stop when context degrades, not at an arbitrary count. |
> | `wayfinder:factory` | **As many as dispatch allows** — they run elsewhere. |
> | `research` | Unlimited (upstream already exempts these) — fire them in parallel as subagents. |
>
> Cadence and the park-don't-ask rule: `docs/factory-workflow.md` § The drive loop.

### Chart the map

User invokes with a loose idea.

1. **Name the destination.** Run a `/grilling` and `/domain-modeling` session to pin down what this map is finding its way to — the spec, decision, or change. The destination fixes the scope, so it's settled first.
2. **Map the frontier.** Grill again, **breadth-first** this time: fan out across the whole space rather than deep on any one thread, surfacing the open decisions and the first steps takeable now. **Sort what you surface by resolver before you ask anything** — put only the `owner` questions to the owner; decide the `director` ones yourself and report them in a line each. A charting session that asks the owner twenty questions has almost certainly mis-sorted. **If this surfaces no fog** — the way to the destination is already clear, the whole journey small enough for one session — you don't need a map. Stop and ask the user how they'd like to proceed.
3. **Create the map** (label `wayfinder:map`): Destination and Notes filled in, Decisions-so-far empty, the fog sketched into **Not yet specified**.
4. **Create the tickets you can specify now** as child issues of the map — then wire blocking edges in a **second pass** (issues need ids before they can reference each other). Wiring sorts them into the frontier and the blocked; everything you can't yet specify stays in the fog — the **Not yet specified** section.
5. **Fire the research subagents.** For each `research` ticket you just created, spin up a `/research` subagent to resolve it in parallel, capturing its findings on a throwaway `research/<name>` branch with a context pointer from the ticket.
6. Stop — charting is one session's work; it hand-resolves nothing.

### Work through the map

User invokes with a map (URL or number). A ticket is **optional** — without one, you pick the next
decision, not the user. **Which *kind* of session it is is also not the user's to state** — the frontier
answers that. They should never need to say "grill session" or name the sibling maps.

0. **Decide the session kind first, before choosing any ticket.** Query the owner frontier **across every
   map**, not only the one named — a parent map's children share one frontier, and the owner's tickets are
   usually spread over them:

   ```bash
   gh issue list --state open --label wayfinder:owner --limit 60 \
     --json number,title,body \
     --jq '.[] | select((.body|test("Blocked-by")|not)) | "#\(.number)  \(.title)"'
   ```

   ⚑ **Key on the RESOLVER label alone.** This query used to AND `wayfinder:ticket` with the resolver
   label, and on 2026-08-21 that returned **empty** while three owner tickets sat open — they carried
   `wayfinder:owner` but had never been given `wayfinder:ticket` or wired to a map. The session read the
   empty result as "no owner questions", declared a DRIVE session, and spent ~150K tokens working
   director tickets **without asking the owner anything**. A frontier query that silently returns nothing
   does not look like a bug; it looks like an answer.

   **So: an empty result is a CLAIM, not a fact.** Before declaring a DRIVE session on the back of one,
   spend one call checking it is not a labelling artifact:

   ```bash
   gh issue list --state open --label wayfinder:owner --limit 60 --json number,title,labels \
     --jq '.[] | "#\(.number)  \(.title)  [\([.labels[].name]|join(","))]"'
   ```

   If that finds tickets the frontier query missed, **fix the tickets** (add `wayfinder:ticket`, the
   `Map: #<n>` first line, and the sub-issue link) and re-run — do not proceed on the empty answer.

   **Non-empty → GRILL session:** take *all* of them into `/grilling` rounds and drain the batch. Do not
   pick one and stop. **Empty → DRIVE session:** work `director` tickets, chaining as many as context
   allows, and dispatch `factory` ones. If the user named a single ticket, honour that instead.

1. Load the **map** — the low-res view, not every ticket body.
2. **Claim before any work**: assign to yourself. In a grill session claim the whole owner batch up
   front, so a concurrent session skips them.
3. Resolve it — **zoom as needed**: fetch the full body of any related or closed ticket on demand; invoke the skills the `## Notes` block names. If in doubt, use `/grilling` and `/domain-modeling`.
4. Record the resolution: post the answer as a **resolution comment**, **close** the issue, and **append a context pointer** to the map's Decisions-so-far. Durable decisions also go to `docs/decisions.md` — `OD-` if the owner settled it, `DD-` if you did.
5. Add newly-surfaced tickets (create-then-wire); graduate any fog the answer has made specifiable, clearing each graduated patch from **Not yet specified** so it lives only as its new ticket. If the answer reveals a ticket — this one or another — sits beyond the destination, **rule it out of scope** rather than resolving it on the route. If the decision invalidates other parts of the map, update or delete those tickets.

The user may run unblocked tickets in parallel, so expect other sessions to be editing the tracker concurrently.
