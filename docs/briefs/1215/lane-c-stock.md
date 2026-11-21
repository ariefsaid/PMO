SESSION: lane-c-stock
You are the Opus ORCHESTRATOR of one build lane: "Stock and purchasing". You manage Sonnet builders (Agent tool, model sonnet); you write no feature code yourself. Deadline: every ticket of this lane pushed and verified within 12 hours of your start. Do not stop early: when one ticket is verified, start the next waiting one, until none remain.

FIRST read on origin/dev, fully: docs/cloud-session-rules.md (binding; paste it into every builder brief), CLAUDE.md, docs/decisions.md section "OD-SCOPE" (owner rulings of 2026-11-21; they are settled, never re-decide), docs/glossary.md. Tickets are public issues of ariefsaid/PMO: read each with `curl -s https://api.github.com/repos/ariefsaid/PMO/issues/<n>` (title, body). The ticket body is the agreed form.

TICKETS (one branch per ticket, named feat/<number>-<slug>; "stacked" means branch from the named ticket's branch tip instead of origin/dev, in the order given, so they merge cleanly one after another):
- STOCK CHAIN, stacked in this order, each alone as its own branch: #2683 vendor location type -> #2690 two-step transfer with recount and handover confirmed in PMO (proof per stock tag: photographed paper or in-app confirmations) -> #2691 transfer between work orders in one document -> #2693 reservations (stock reads "x free + y reserved"; borrowing goes to an approval step, setting: approve or warn) -> #2676 material lines on a validated daily report post a stock issue (correction reverses and re-posts; short stock flags, never blocks).
- #2689 movements awaiting signed paper: daily list. Stacked on #2690.
- #2686 material requests: warn at two usage thresholds of plan (settings).
- #2685 material requests: approvers are notified and see them in the approvals inbox.
- #2674 material issued against progress with a mismatch warning.
- #2696 purchase request lines: category and needed-by date per line.
- #2697 purchase type (goods, service, rental) and a guided rental extension.
- #2698 payment channel on a purchase request (client-defined list).
- #2634 bill match: Admin settings screen for on/off and tolerance.
- #2700 monthly equipment and service plan turned into rental orders.

MIGRATIONS: only numbers 1300-1359, five per ticket in the order listed above. Never any other number.

HOW TO RUN IT
1. Start up to 5 builders at once, each in its own git worktree. A stacked ticket starts only after the ticket under it is verified and pushed. Independent tickets start now.
2. Spec first, short: each builder writes docs/specs/<slug>.spec.md (EARS + Given/When/Then AC ids) and docs/plans/2026-11-21-<slug>.md, pushes them, and STOPS for your approval. You check the spec against the ticket and OD-SCOPE (nothing of one client's process in code: names, day counts, limits, lists are settings or client data; general words only: work order, foreman, delivery note), then tell it to build. Where a spec already exists in docs/specs, use it and its "Review" notes.
3. Build test-first per the rules file. New behaviour must not change what an existing organisation sees: anything that alters an existing screen or rule is off until an organisation setting turns it on, and existing tests stay green untouched. Money, approval, access and stock-ledger rules are enforced in the database with pgTAP proofs and a mutation check (break the rule, the test must go red, restore).
4. Every new or changed screen: load .claude/skills/restructure/SKILL.md (run scripts/vendor-skills.sh first), DESIGN.md tokens, shared form primitives, English and Bahasa Indonesia strings, phone and desktop. Save two screenshots per new screen (phone 390 px, desktop 1440 px) under docs/evidence/1215/<ticket>/ on the branch.
5. This sandbox HAS Docker. From the repo root: SUPABASE_INTERNAL_IMAGE_REGISTRY=docker.io npx -y supabase@2.122.1 start, then db reset and test db. Builders share ONE database: only one runs a reset or test at a time (flock /tmp/db.lock <cmd>); reset and test are one lock hold. Browser journeys: E2E_WORKERS=1 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers scripts/e2e-local.sh <fragment>.

DO NOT ASSUME, VERIFY (this is where earlier rounds lost days)
- A builder's "done" is a claim. Before you accept a ticket you yourself, in its worktree: confirm the branch is pushed (git ls-remote), run db reset + its pgTAP files + 0178, 0646 and the isolation denominator self-test under the lock, run npm run check:guards, npm run typecheck, eslint on changed files and vitest related on changed source files, and read the diff against the ticket's "What ships" line by line. Any miss goes back to the same builder.
- When something is red, the cause is read from that failure's own output. Never treat two failures as one cause without evidence from both. Never weaken, skip or delete a test.
- The moment a ticket is verified, push its done ref: git push origin <branch>:refs/heads/cloud/done/lane-c-stock-<number>. The Director integrates from those refs while you continue.

PUBLIC REPO: no client names, people, client systems or client abbreviations in any file, commit or message. No attribution lines. Never open a PR, never push to dev, main or land/1215.

FINAL: when every ticket has its done ref (or 12 hours have passed), push git push origin HEAD:refs/heads/cloud/done/lane-c-stock and print one block per ticket: branch, head commit, spec path, ACs built, settings added, gates you ran yourself with their result lines, screenshots path, anything not finished and why. Last line: DONE: lane-c-stock
