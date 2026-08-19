# Factory workflow — how the loop, the Matt skills, and SSSF fit together

**One page, three systems, one operating model.** The per-issue loop (CLAUDE.md), the Matt Pocock
skill set (`/ask-matt` router), and SSSF ADWs (`adws/`, `/sssf`) are not competing workflows — they
are the front, middle, and floor of the same factory. Owner directive 2026-08-16.

## The model

```
OWNER-HEAVY                    FACTORY (autonomous)                   OWNER-HEAVY
──────────────                 ─────────────────────                  ────────────
wayfinding (/wayfinder)   →    per-issue loops, chained:         →    milestone review:
intake (/grill-with-docs)      build → test-fix → cross-family        traces + rendered demo
spec + ACs + evals             review → revise → green                + promote decision
milestone sign-off             (SSSF ADW or pi-dispatch)
```

- **Front (owner + Director):** requirements, wayfinding, ACs/evals. Tools: `/wayfinder` for foggy
  multi-issue efforts, `/grill-with-docs` + `feature-forge`/`/to-spec` per issue. Output: a signed
  **milestone brief**.
- **Middle (factory, no owner):** the Director chains issues through the executors below until the
  milestone's ACs are green. LLM-first QA — tests, cross-family review, and fix rounds run inside
  the machine before any human looks.
- **End (owner):** milestone review — the SSSF trace/visualizer, the PR(s), a rendered demo.
  Promotion gates unchanged: Director merges to `dev`/`main` within the signed scope; **`main` is
  the autonomous ceiling; production stays per-instance owner-gated** (CLAUDE.md).

## Decision rights — who decides what (owner directive 2026-08-18)

The three systems above have **three actors**, not two. Upstream skills (the Matt Pocock set) model
only *human* and *agent*, so every decision defaults to the human. That is wrong here and produces
grill sessions where half the questions are the Director's own calls wearing owner clothes.

**Escalate to the owner only when the question is:**

1. **Commercial** — market, price, packaging, sales model, what a customer will pay or accept.
2. **Irreversible and outside a signed brief** — production, data destruction, public commitments.
3. **A scope-versus-time trade that changes what ships** — "do we delay the milestone for this".
4. **A fact only the owner holds** — client relationships, partner terms, their own preferences.

**Everything else the Director decides**, states in a line or two with the reasoning, and proceeds.
Silence is assent; the owner overrides by saying so. Architecture, schema shape, library choice,
test strategy, ticket structure, sequencing *within* a signed scope — Director. The binding gates in
CLAUDE.md are unchanged: `main` is the autonomous ceiling, production is per-instance owner-gated.

### Recording them: `OD-` vs `DD-`

`docs/decisions.md` records both, under **distinct prefixes**, so the owner can scan for what is
theirs:

- **`OD-…`** — owner-locked. Changing one needs the owner.
- **`DD-…`** — Director decision. Binding on agents exactly like an OD until revised, but **the
  owner may revisit any DD at any time without ceremony** — that is the point of the separate
  prefix. A DD records the reasoning precisely so it can be re-opened cheaply.

A DD that turns out to be commercial, irreversible, or a scope-versus-time trade was mis-classified:
escalate it and re-file it as an OD. When in doubt between the two, it is a DD with the reasoning
written down — not a question that stalls the work.

## The drive loop — batch the owner, then run (owner directive 2026-08-18)

The milestone brief assumes scope can be enumerated up front. Foggy work can't be, so the boundaries
are **event-driven** instead: unblock a batch, drive until blocked, batch again.

**Every session is one of two kinds.** Open by asking which:

```bash
# the owner frontier — open, unblocked, owner-resolved tickets
gh issue list --state open --label wayfinder:ticket --label wayfinder:owner \
  --json number,title,body --jq '.[] | select((.body|test("Blocked-by")|not)) | "#\(.number)  \(.title)"'
```

- **Non-empty → GRILL session.** Drain the **whole** owner frontier in one sitting, batched into
  rounds per `/grilling`. Not one ticket — all of them. The owner's attention is the scarce input;
  spending it one question at a time is the waste this loop exists to remove.
- **Empty → DRIVE session.** Work everything else: Explore/Plan agents, factory ADWs, Director
  dispatches, per § Executor routing. Chain issues without pausing.

**⚑ The rule that makes it work: park, don't ask.** Hitting an owner-class question mid-drive does
**not** stop the drive. File it as a `wayfinder:owner` ticket carrying enough context to answer cold,
then **keep driving everything that doesn't depend on it**. Return to the owner only when the drivable
work is exhausted, or when the parked question blocks everything left. A drive session that ends after
twenty minutes with one question has failed at this — there is nearly always work that doesn't depend
on the answer.

Parked questions accumulate as the next grill session's frontier. No new artifact: the ticket *is* the
parking slot, and the query above *is* the batch.

**⚑ But distinguish two kinds of parked, or the frontier lies to you.**

| Waiting on | What to do |
|---|---|
| **The owner's attention** — they can answer whenever they next sit down | Leave it **open** and `wayfinder:owner`. This is the frontier's whole purpose. |
| **An external event** — a third-party conversation, a client's IT, a vendor reply | **Close it**, with the ruling and the agenda intact in a comment, and reopen when the event happens. |

An external-event ticket left open reports as a pending owner question in every frontier query, so
every drive session re-surfaces it and asks about something the owner has already ruled "do not wait"
on. That is worse than noise — it makes the owner frontier untrustworthy, which is the one signal the
drive loop uses to decide what kind of session it is. Closing it costs nothing: the ticket is not
deleted, its brief survives, and reopening is one command.

Recorded because it happened twice in one session (2026-08-19, the reseller ticket) **after** the
"do not wait" ruling was already on the ticket.

## Milestone brief (the sign-off artifact)

A section in the anchoring GitHub issue (or `docs/plans/`), signed by an explicit owner reply:
**objective · milestones · ACs/evals per milestone · scope fences (do-NOT list) · issue list or
"Director decomposes via /to-tickets"**. Once signed, the Director does **not** pause at issue
boundaries inside it — only at milestone boundaries, or when something falls out of the signed
scope (then escalate, don't improvise). This supersedes the per-issue owner pause for work inside
a signed brief; unsigned/ad-hoc issues keep the classic per-issue checkpoints.

## Executor routing (which machine runs the middle)

| Issue shape | Executor |
|---|---|
| Bounded code slice — incl. ordinary schema/migration work | **SSSF ADW — default chain `adws/adw_simple_sdlc.py`** (plan → build → gate-fix ×3 → cross-family review-revise ×2 → retest → commit → document). The gate = typecheck + lint + vitest, **+ pgTAP under one db-lock hold when the run touches `supabase/`** (`adw_modules/quality.py`). Run per `/sssf` + `docs/pi-delegation.md` substrate rules. |
| Bounded FE/UI slice | **Same chain, FE roster:** `adw_simple_sdlc.py --builder fe_builder --reviewer fe_reviewer`. fe_builder builds to `ui-implementer.md` (DESIGN.md tokens, agent-browser rendered self-check); fe_reviewer audits rendered DOM/a11y to `design-reviewer.md`, saving screenshots to the run's `context_handoff/screenshots/`. **The Director's pixel/taste lens on those screenshots is still the exit gate** — text models judge the a11y tree, not pixels. |
| Money-path, SoD, auth/token-custody — anything `review-money`-tier | **Director-dispatched per-issue loop** (`pi-dispatch` per `docs/pi-delegation.md`) — Luna-max review with no fallback, mutation-checks-against-neighbours, prod-parity judgment. On this class green gates themselves have been the repeat offender; the exit is adversarial, not mechanical. |
| Foggy / multi-issue / decision-shaped | `/wayfinder` first; what exits enters the loop as ordinary issues. |
| Throwaway question | `/prototype`, bridged by `/handoff`. |

Either way the Director still runs the binding gates itself before ship: `npm run verify:locked`,
mutation checks, rendered verification, `verify-main-pr.sh` at promotes. The ADW's green is the
factory's inner loop, not the phase gate.

## Skill wiring (why nobody should have to re-ask for a skill per brief)

The **role contract is the skill carrier.** `.claude/agents/*.md` (tracked, in every worktree)
encode each role's disciplines inline — TDD iron law, no-placeholder plans, review lenses, and the
UI family's exact skill commands (`ui-ux-pro-max`, `taste`, `agent-browser`). Delivery per surface:

- **pi dispatches** — the Director appends the contract (`--append-system-prompt`, pi-delegation §3).
  A brief without its role contract is malformed.
- **ADW agents** — the runner **appends each agent's contract to its system prompt mechanically**
  (`contract:` in `sssf.config.yaml`, injected by `adw_modules/agents.py` — not an instruction the
  model may skip). planner→eng-planner, builder→implementer, reviewer→spec-reviewer,
  fe_builder→ui-implementer, fe_reviewer→design-reviewer.
- **Claude Director sessions** — superpowers plugin + hooks (ponytail) + CLAUDE.md; the vendored
  overrides (`docs/agents/skills.md`) carry the same disciplines to substrates that can't load plugins.

If a discipline has to be repeated in briefs, it belongs in the contract — edit `.claude/agents/`,
run `scripts/sync-agent-surfaces.mjs --write`, done once.

## Non-negotiables carried over (nothing here weakens them)

- Archive `adws/adw_data/` out of a worktree **before** `git worktree remove` — the trace is the
  owner's review surface (`docs/reviews/2026-08-06-sssf-trial-record.md`).
- Substrate ladder, briefs-as-files, background-dispatch mechanics: `docs/pi-delegation.md`.
- **Substrate rulings land in TWO places:** the `pi-dispatch` ladders (`~/.local/bin/pi-dispatch`)
  AND `adws/adw_sssf_config/sssf.config.yaml` — the ADW calls raw `pi` with pinned models (its own
  tracer/ledger; no fallback by design — both substrates down = wait). Neither tool supersedes the
  other: ADW = executor dispatch, pi-dispatch = Director dispatch (see routing table).
- QA portfolio, BDD authoring rule, NOT-DONE-UNTIL-GREEN, DB locks: CLAUDE.md.
- Planner plans land in `docs/plans/` (config `writes:` re-aimed 2026-08-16, trial iterate item 1);
  the reviewer phase requirement (iterate item 2) is satisfied by using `adw_simple_sdlc` as the
  default chain.
