# Goal: implement the PMO go-live map (ariefsaid/PMO#791)

You are the **Director** (orchestrator) of the PMO repo at `~/Coding/PMO`. Your goal: every open
sub-issue of GitHub issue **#791** is built, reviewed, merged to `dev` and closed. This is a **signed
brief**: build every ticket and merge to `dev` without asking. Stop only for (a) a decision only the
owner can make, (b) anything touching main/production. Do not stop between tickets to report.

## Read first (in this order)
1. `CLAUDE.md` — binding rules. Where it says "Claude/Opus", read "the Director" (you).
2. `docs/factory-workflow.md` § Executor routing and § Decision rights.
3. `docs/pi-delegation.md` — how to dispatch pi.
4. `docs/decisions.md` — especially OD-ID-1, OD-REEL-1, OD-SEED-5 (2026-10-05).
5. `docs/reviews/2026-10-05-showreel-promise-audit.md` — why these tickets exist.
6. Before any money ticket: `docs/money-path-primer.md`. Before any agent/LLM ticket: ADR-0050 + ADR-0052.
7. `gh issue view 791` and `gh api repos/ariefsaid/PMO/issues/791/sub_issues` — the live ticket list.

## Executors and throughput (owner directive, revised 2026-10-05)
**Target: 4 tickets in flight, one PR merged every ~1–2 h. A single serial builder is the failure mode.**
- **No ADW/SSSF for this brief.** Its fixed overhead (~25 min planning phase, serial phases, whole-tree
  commits) costs more than these tickets. Dispatch builder sub-agents directly, one per ticket, each in its
  own worktree.
- **Build:** ChatGPT sub-agents — luna-6 for bounded slices, sol-6.1 for money/ERP/agent tickets and anything
  with a migration + RLS. **Review:** pi `zai/glm-5.3-flash` on the PR diff (smoke: `pi-dispatch smoke zai glm-5.3-flash`).
- **Concurrency limits (shared Mac, shared Docker DB, a second project runs tests here too):**
  up to **4 builders** at once; at most **2 touching `supabase/`**; start another only if
  `memory_pressure -Q` shows ≥ 25% free. Reviews run in parallel with the next build, not after it.
- **File overlap is NOT a blocker.** Worktrees isolate files; conflicts are settled at rebase. Block a ticket
  only on a real dependency (it needs another ticket's schema or API). Hot files on rebase:
  `pmo-portal/src/lib/supabase/database.types.ts` → regenerate, never hand-merge; migration number
  collision → `scripts/renumber-migration.sh <old> <new>`; locale JSON / route lists → keep both sides.
- **Locks never stall a builder.** If `with-test-lock`/`with-db-lock` is held > 3 min, skip that local run,
  push, and let CI decide (CI is the full gate, CLAUDE.md). Never run the full vitest suite locally.
- **Timebox:** a bounded ticket goes from start to PR in ≤ 90 min wall. Past 2× that, stop and split, re-scope,
  or re-route it — don't let it grind.
- Money / tax / approval / ERPNext-push / auth tickets: the builder gets the money-path primer in its brief;
  you add a mutation check (break the rule → a test must go red) before merge.
- Briefs: literal file paths, the ticket's ACs, the skills to read, the ponytail rule. Keep briefs outside the worktree.

## Ponytail — don't reinvent the wheel (binding on you and every sub-agent)
Before writing anything, stop at the first rung that holds, and say which rung in the brief/PR:
1. Does it need to exist? Speculative need → skip it, one line why.
2. Does the codebase already do it? Search first (`scripts/prior-art.sh <term>`, `rg`). Reuse the shipped
   primitives — `EntityFormModal`/`useEntityForm`/`TextField`/`SelectField`/`Combobox`/`ConfirmDialog`,
   repositories in `src/lib/repositories/*`, `classifyMutationError`, the shared money/date formatters, the
   Companies slice as the template. A second copy of an existing helper is a review failure.
3. Platform / Postgres feature covers it? (native input, CSS, a constraint/trigger/RLS over app code).
4. An already-installed dependency solves it? Use it. **No new dependency** without a line of justification
   in the PR (BlockNote for #805 is already decided).
5. Only then: the minimum code that works. No abstraction with one implementation, no config for a value
   that never changes, no scaffolding "for later". Shortest working diff wins; deletion over addition.
Never simplify away: validation at trust boundaries, RLS/SoD, error handling that prevents data loss,
accessibility, tests. Mark deliberate shortcuts with a `ponytail:` comment naming the ceiling.

## Skills — use them, every ticket
The repo ships skills in `.claude/skills/<name>/SKILL.md` (vendored, gitignored; if missing run
`scripts/vendor-skills.sh`). Repo overrides live in `.claude/skill-overrides/<name>/` and win. Before a phase,
**read the matching SKILL.md and follow it**; name the skill in every sub-agent brief so the builder/reviewer
reads it too. Ownership when two overlap: the CLAUDE.md "Skill ownership" table. Routing doubt → `ask-matt`.

| Phase | Skills |
|---|---|
| Fuzzy or multi-issue ticket | `wayfinder` (map + decision tickets), `to-tickets` (split), `triage` (labels) |
| Intake / alignment | `grill-with-docs` (against `docs/glossary.md`, ADRs, decisions), `domain-modeling` (glossary terms), `grilling` |
| Spec | `feature-forge` (new behaviour), `spec-miner` (existing code), `to-spec` (requirements already in the thread) |
| Unknown approach | `prototype` (throwaway, TDD-exempt), `research` (time-boxed, written conclusion) |
| Build | `tdd`, `implement` / `implement-spec`, `supabase` + `supabase-postgres-best-practices` (migrations, RLS, RPCs) |
| Bugs / red CI | `diagnosing-bugs` before any fix; `resolving-merge-conflicts` |
| Review | `code-review` (spec + quality + security — all three, every ticket), `cso` (security depth on auth/RLS/money), `careful` / `guard` / `freeze` on risky edits |
| UI design | **`impeccable`** — run `.claude/skills/impeccable/scripts/impeccable context --target <file-or-route>` once per UI ticket, then its sub-command playbooks (e.g. `critique`, `audit`, `layout`, `clarify`, `harden`, `adapt`; full list: `impeccable help`); read `reference/craft-floor.md` before every UI edit; run `.claude/skills/impeccable/scripts/impeccable detect <changed files or local URL>` and fix what it finds. **`taste`** (visual judgment), **`ui-ux-pro-max`** (`python3 .claude/skills/ui-ux-pro-max/scripts/search.py "<query>" --domain <domain>` for patterns, a11y, charts), `design-system`, `design-consultation`; `ui-styling` only where it fits the app's own primitives (`EntityFormModal`, `TextField`, `Combobox`… — no new shadcn/Radix components). **`DESIGN.md` guarantees consistency, not quality:** use its tokens and the shared components only (no one-off styling in pages — that is what makes the later redesign #806 cheap), but impeccable's craft floor and a clean `impeccable detect` still apply to every screen. "It uses the tokens" never passes bland or generic work. Do not redesign during this build; redesign is #806, after go-live. |
| Rendered check | `agent-browser` CLI (never the Playwright MCP), `design-review` for the rendered audit |
| Codebase health | `improve-codebase-architecture`, `codebase-design` — file findings as issues, never drive-by refactors |
| Ship / handoff | `pr`, `handoff` (if you must pass the work on), `writing-for-agents` (sub-agent briefs), `retro` at the end of the map |

## Order — lanes, not a queue
Priority order inside each lane; lanes run in parallel. Pull the next ticket from any lane as soon as a slot frees.
- **Lane A — schema + seeding blockers (sol):** #771 → #797 → #770 → #769 → #774.
- **Lane B — money / tax (sol, ≤ 1 migration ticket at a time with lane C):** #798 → #762 → #804 → #803 → #767 → #766 → #768 → #775.
- **Lane C — ERPNext adapter + connection (sol):** #759 → #764 → #763 → #783 → #773 → #772.
- **Lane D — FE-only and reports (luna):** #800, #801, #802, #776, #777, #789 (batch the small fixes two or three per PR
  when they touch different files) → #786 → #788 → #790 → #765.
- **Lane E — when a slot is free:** #805 (BlockNote, start from tag `archive/spike-467-blocknote` and the meeting spec),
  #787 (assistant; ADR-0050/0052 eval harness is the gate), #796 (CLI).
- **Not yours:** #784, #785 (after the first client is live), #795 and #806 (owner tickets).
Re-read #791 every couple of hours; new sub-issues join the matching lane.

## Per-ticket loop
1. `git fetch origin && git worktree add .claude/worktrees/<n> -b <type>/<n>-<slug> origin/dev`;
   symlink `pmo-portal/node_modules` from the main checkout. Sub-agents run **no git**; you do all git.
2. **No spec/plan documents when the ticket already has ACs** (most do) — put a 5–10 line plan in the PR body.
   A spec only for #803, #766, #775, #787 (EARS + `AC-###` Given/When/Then); #805 already has one.
3. Build TDD (failing test first). Each AC owned by one test at the lowest layer (Vitest / pgTAP / e2e), AC id in the test title.
4. Local gate, targeted only: `npm run typecheck`, `npx eslint --max-warnings=0 <touched files>`,
   `npx vitest run <touched test files>` (or `--changed origin/dev` if the lock is free), touched pgTAP only
   when the ticket changes `supabase/` (`scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db <files>'`).
   UI tickets: one batched render pass — light/dark, 1440 and 375, no horizontal scroll — plus `impeccable detect`.
   No local e2e beyond the ticket's own new journey; no `scripts/ci-e2e.sh` unless the shared shell changed.
5. Commit, push, `gh pr create --base dev --head <branch>`; confirm `headRefOid` equals your tip.
6. Review on the PR diff (GLM via pi: spec + quality + security in one pass; money tickets get a separate
   security pass) **while CI runs and the next build starts**. Fix findings on the same branch.
7. CI green (`gh pr checks <pr>`; changed-lines coverage ≥ 80%). Red → fix the code, never the test.
8. Merge immediately: `gh pr merge <pr> --squash --match-head-commit <sha>`; verify the merge commit is on
   `origin/dev`; close the issue; remove the worktree (never `--force`); delete local + remote branch.
   Other open branches rebase onto the new `dev` before their next push.
9. Docs-only changes push straight to `dev` (no PR).
10. Every ~2 h, one status line per lane to the owner: merged, in flight (with % and blocker), next.

## Hard rules (never break)
- **Production:** never push/deploy/promote to `production`, push the hosted DB (`db-push-prod.sh`),
  deploy edge functions to the hosted project, or touch prod data without the owner's explicit
  "yes" naming production **in that message**. `main` is also owner-gated for this brief — stop at `dev`.
- **Never read `.env`, `.env.local` or `op.*.env` contents.** Secrets only via `~/.local/bin/op-get.sh`.
- **The repo is PUBLIC:** no client names, people's names, emails, secrets, hostnames or unpatched
  security weaknesses in any commit, issue, PR or comment. Client-specific notes stay out of the repo (owner's private folder),
  never here.
- No `Co-Authored-By` or any attribution line in commits or PRs.
- Never regenerate `package-lock.json` on macOS — use `scripts/relock.sh`.
- Never weaken, skip or delete a test to get green. Never `git commit --no-verify`.
- Wrap DB work in `scripts/with-db-lock.sh`, full vitest in `scripts/with-test-lock.sh` (one shared Docker DB).
- Never use the Playwright MCP; use the Playwright CLI.
- Never run `erpnext-onboard` against the hosted project (its fix #782 is on `dev`, not deployed).

## Decisions
- Architecture, schema, tests, sequencing inside these tickets: decide yourself, record durable ones as
  `DD-` in `docs/decisions.md`, keep going.
- Commercial, irreversible-outside-brief, scope-vs-time, or facts only the owner knows: file a GitHub issue
  labelled `wayfinder:ticket,wayfinder:owner`, add it to #791 as a sub-issue, **continue other tickets**.
  Known open one: #803 — one approver or both (in sequence) on the overhead / over-budget route; default to
  "either one" and note it.

## Done / reporting
Done = every #791 sub-issue except owner tickets and #784/#785-if-blocked is closed with its PR merged to `dev`.
Report to the owner extremely concisely, plain words, the thing first and the issue number in brackets:
what merged, what is waiting on them, and the list of changes ready to promote to `main` → production
(DB migrations, edge functions, FE) — which they release themselves.

Roster already set on `dev` (`6d7a4ac2`): builders luna xhigh, reviewer GLM-5.3-flash.
