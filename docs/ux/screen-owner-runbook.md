# Redesigning screens: the screen-owner runbook

For the Director (or a lane orchestrator) when a screen is to be recomposed, or the owner says a screen looks wrong: cheap, misaligned, no hierarchy, cut off. A one-property fix on one screen is an ordinary fix and does not need this.

**Screen owner** = one worker that designs a screen, builds it, and looks at its own render until it would show it to a client. Nobody reviews the screen into shape afterwards.

Proof it works: a week of review-then-patch rounds (2026-11-10 to 11-16) left the owner pointing at the same class of defect. One night of screen owners put the redesigned demo screens into production (v0.41.2, 2026-11-17): project overview, purchase request, contract tab, the home per role, purchases list and approvals inbox, on one release run. Causes and the structural follow-up: `docs/plans/2026-11-16-ui-by-construction.md`.

## The loop

1. **Cut the work by screen.** List the screens from the owner's own words and screenshots plus the job each serves (`docs/jtbd.md` §6). One owner per screen, or per pair that shares a frame (a list and its inbox). A sweep of shared components (status pills, table headers, avatars) is its own owner, started first: every screen merges it.
2. **Open one integration branch** off `dev` (`batch/<date>-ui`). It holds accepted work only. Every owner merges it into its branch before READY, so conflicts are resolved by the worker that knows the screen.
3. **Dispatch each owner** as a fresh Orca worker: the strongest model, high effort, its own worktree and port. Its brief is [`screen-owner-brief.md`](screen-owner-brief.md) plus one page for its screen: who opens it and for what, the owner's words or screenshot about it, the neighbouring routes whose frame it must match, and what is out of scope (computation, data calls, role gates).
4. **Judge each render yourself.** When an owner reports, open its AFTER screenshots at actual size: 1440, 1024 and 390, in Bahasa with long rupiah amounts. Accept when all four hold:
   - every label, status and amount reads whole;
   - things that should share an edge or a baseline do, with the measured x/y in the report;
   - nothing carries less information than before;
   - nothing from the owner's complaint list is left.

   Send back measured defects in one message ("label at y 506, its neighbour at 486"). Two rounds per screen at most, then it ships or waits.
5. **Merge each accepted branch** into the integration branch with `--no-ff`. Check commit authors. Run guards, typecheck and the tests in every folder that two branches both touched.
6. **One pull request to `dev`** for the batch. A red check is read from its log first. If the test's goal is lost, fix the app; if the change was deliberate, change the test's steps and keep its goal.
7. **Browser proof:** open the `dev` → `main` release pull request as a draft and tell the owner it merges nothing. No pushes to `dev` while it runs.
8. **Before/after page for the owner:** one pair per screen, one sentence each, and under each pair the choices only he can make, copied from the owners' "Owner to confirm" lists. He judges pictures. `main` and production move on his word.
9. **After production:** walk the job on the live site, read-only, and say what you saw.

## Why each part is there

| Part | What it replaces | What happened without it |
|---|---|---|
| One owner per screen | Work cut by finding or by ticket | Each item was patched; nobody owned how the screen read as a whole. |
| The owner looks at its own render, three rounds minimum | Builders gated by tests only | Screens passed every check and still had cut-off text and uneven edges. |
| The Director judges at actual size | Fresh-eyes reviewer agents, detector counts, "same as before" | Five review rounds produced lists; the same class of defect came back. A count of zero findings is not a look. |
| Strongest model for composition | Cheapest model first | Composition is judgement. Cheaper models are for mechanical follow-ups after the shape is right. |
| `normal mode` as the brief's first line | A standing minimal-code mode on every worker | Shortest-diff habits chose browser-native controls and skipped rendering. |
| Fix the shared component | One-off spacing on the page | The same misalignment reappeared on the next screen. |
| "Owner to confirm" list | Asking before building, or deciding silently | Either the night stalls, or he finds a moved thing by surprise. |

## Traps met on the night

**Shared machine**
- A seed account's language is saved in the shared local database. Switch back to English after each Bahasa look, or other workers' journeys fail.
- Link the shared `node_modules` only when the worktree has none. A link inside a real install loads two copies of React.
- Set `E2E_PORT` and your own `--output` for every local journey run.
- An environment file is never copied or read. `scripts/e2e-local.sh` writes the local one. Capture the BEFORE screenshots from the owner's own worktree before its first edit, so nobody needs a second checkout.
- About six owners with dev servers and journeys is the ceiling for one machine. Past it, worker setup times out and the database lock queue reaches half an hour. Stagger starts.

**Checks**
- An owner's list of touched tests misses tests in other folders that render its screen. Before READY: `npx vitest related --run <changed source files>`. Both red runs of the night were this.
- Changing a shared component's default changes every caller. Grep the callers that relied on the old behaviour and look at two of them.
- "Never wrap" is not "cut with an ellipsis". A status that does not fit means the table has too many columns.
- A worker reports only the gates it saw pass.
- A header that grows by a line can push a control under the notice in the corner at 1280×720.
- A background wait on a pull request reports through its log line, not its exit code.

## Planning numbers (2026-11-17)

Eight owners. First complete version about two hours each; a judge-and-fix round about thirty minutes; batch checks fifteen minutes; release run twenty. The night ran above the normal spending pace: tell the owner before starting.
