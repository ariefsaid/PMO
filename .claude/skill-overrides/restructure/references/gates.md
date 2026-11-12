# Gates and the losses check

Read whole at step 7; keep a private proof table of `gate | command/check | commit | route/role/state | result | artifact | unresolved`.
A missing prerequisite or untested state is incomplete, not a pass; script thresholds are measured floors rather than the whole design contract.

## Screen proof

Run from the repository root with the owned server URL and the correct local role state, using the current script's supported inputs:

```bash
bash scripts/ux-proof.sh /route
node .claude/skills/taste/scripts/inspect.mjs --app <url> --out <private-output-directory>
```

- Run `ux-proof.sh` for every touched route and role at phone and desktop; it captures both themes and runs the detector and axe, because type/copy/phone regressions can hide in a role branch.
- Verify the rendered route and role in every capture, because a successful run on login is not a successful audit of the requested screen.
- Keep words within the existing chrome budget excluding record rows and chart labels, because live record counts must not punish unchanged screen copy.
- Keep chart count at or above the before baseline for the same data/state, because removing pictures must not masquerade as calming the screen.
- Record before chart/word/target baselines for each role/width key and check their presence, because an absent chart baseline is not enforced by the script.
- Inspect `ux-proof-metrics.mjs` with the runner when interpreting failures, because it decides the measurements rather than this reference.
- Current measured floors are ≥12px minimum, ≤15% of measured text characters below 14px, word count ≤105% of budget, no phone input below 16px and no document overflow; these tolerances do not override screen-rules' job-text floor and no-growth intent.
- Phone target counts are shrink-only against the recorded baseline; verify each actionable target reaches 44px as well, because an inherited nonzero baseline can pass while small targets remain.
- Preserve scope, consequence, optionality and pre-decision evidence while cutting copy; use screen-rules' explicit justified-budget exception when necessary, because meeting a word limit by deleting meaning is a loss.
- Treat a changed budget as a reviewed consequence, never an automatic cure; `--update-word-budget` cannot authorize missing information or establish new chart expectations.
- Use existing element-edge layout e2e checks alongside document overflow, because a clipping ancestor can hide bleed without increasing scroll width.

## Signed-in measurement (both tools)

A fresh browser profile has no session, so both tools photograph `/login` and the report describes a page nobody asked about. Both take `--storage-state <file>`, a Playwright storageState JSON (cookies + per-origin localStorage).

Create it from the seeded roles, one real sign-in per state (it reads `SEED_PASSWORD` from `pmo-portal/e2e/helpers.ts`, never a `.env` file, and refuses any output path git does not ignore):

```bash
cd pmo-portal && npx vite --port 5288 --strictPort     # a 52xx dev port; 3000 and 5198/5199 are taken
node .claude/skill-overrides/restructure/scripts/signed-in-state.mjs \
  --base http://localhost:5288 --email exec@acme.test  # → .taste-skill/auth/exec@acme.test.json
```

- The state is a LIVE session: it lives under `.taste-skill/` (git-ignored) and is never committed; it is scoped to the origin that issued it, so a state captured on another port lands on `/login`.
- Re-create it per session-day rather than trusting an old file, because Supabase expires the token and an expired one still launches.
- Both tools now refuse a login-page result instead of passing it: the inspector reports `auth-expired` FAIL, the layout checker reports `incomplete: auth: … landed on /login` (exit 2). Treat either as "no evidence yet", not as a failed screen.

## Composition inspector

- Run taste's app inspector at 1440, 768 and 390 and open all captured widths, because a zero exit only proves its FAIL predicates.

```bash
node .claude/skills/taste/scripts/inspect.mjs --app http://localhost:5288/ \
  --widths 1440,768,390 --storage-state .taste-skill/auth/exec@acme.test.json --out .taste-skill/inspect
```

- Require an authenticated, representative render; inspect the screenshots before accepting the report, because a fresh browser profile may reach a login page instead of app content.
- Fix every `FAIL`; fix or defend each `WARN` with a measured capture and one design reason, because warnings cannot silently disappear behind an allow flag.
- Check `ragged-row`, `panel-void`, canvas edge usage and `no-data-hue` explicitly in the report and pictures, because these measure the accidental gaps and flatness that token checks miss.
- Keep `DESIGN.md` identity over external aesthetic defaults; document each conflicting-rule exception with its exact rule ID and reason, because passing an external palette rule cannot justify changing PMO's identity.
- Inspect inner scroll panes manually across their full content, because a tool that scrolls the window alone may never measure lower app content.
- Older local and pinned inspector results may differ in scroll-walk checks; the app-mode measures gated here (`ragged-row`, `panel-void`, canvas edge, `no-data-hue`) exist in both, so preserve the inspector revision with every report.
- Read the `SIGNED IN` block before the findings: it names the state file and the path each width landed on, because "0 FAIL" over `/login` is a clean measurement of the wrong screen.
- Expect a `dev-server` WARN on the 52xx Vite server; it does not clear by itself — run the last gate on a preview build, because minifiers change the CSS a visitor receives.
- A `placeholder-data` FAIL naming the seeded org (`acme`) is the seed's own name, not invented filler: defend it once with the seed row, and never fix it by renaming production copy.

## Impeccable detector

- Run `.claude/skills/impeccable/scripts/impeccable detect <touched .tsx/.css files>` before a builder reports done, and on the signed-in served URL for a recomposed screen; it stops AI-slop patterns reaching review that the composition inspector does not measure.
- Fix each finding or name it a false positive with the reason; paste the detector's last lines in the report. Telemetry off; never `impeccable login`.
- A clean detector is a floor, not composition approval.

## Stageshow layout checker

Use the current `node .claude/skills/stageshow/scripts/layout.mjs --help` to confirm its contract before running; it is a one-snapshot box check rather than visual approval.

Verified 2026-11-12 on the served PMO `/login` page at 1440×1000: `--strict` returned `no-issues-detected`, covering nine controls and three padded containers with no deferred geometry; the captured page was inspected.
The first attempt timed out during server startup and was inconclusive; the completed retry establishes compatibility with that page only, not dashboard or phone coverage.

Verified 2026-11-12 on the SIGNED-IN PMO home (`/`, Executive) against a 52xx Vite dev server, `--storage-state` at 1440 and 390: `--strict` returned `no-issues-detected` with 11 controls / 20 padded containers at 1440 and 7 controls / 12 padded containers at 390, no deferred geometry; both captures showed the dashboard (figures, project health, charts), and a stale state on the same URL returned exit 2 `landed on /login`.

```bash
node .claude/skills/stageshow/scripts/layout.mjs <served-url> --select body --width 1440 --strict --delay 1500 \
  --storage-state .taste-skill/auth/exec@acme.test.json --report <private-report.json> --screenshot <private.png>
```

- Pass `--storage-state` for any app screen, because a fresh context reaches `/login` and a login snapshot is a box check of the wrong page (the override takes a Playwright storageState JSON).
- Keep `--delay` at or above the screen's data load, because the checker's 300ms default photographs the app shell mid-load (`Loading…`): the 390 capture covered 4 nav controls at 300ms and 7 controls plus 12 padded containers once the screen settled. State runs now wait for network idle first, but the delay still has to cover a slow query.
- Read the `layout landed on:` line with the coverage counts, because "no-issues-detected" over a skeleton or a login page is not evidence about the screen.
- Exit 2 now also covers a signed-in run that lands on `/login`, because that snapshot cannot describe the requested screen.
- Use this as a supplemental box-fit gate on the actual visible target at desktop and phone, because the standalone checker can inspect ordinary pages outside a Stage.
- Its current predicates are control block fit, control edge inset, container bottom inset and nested composition crop; verify coverage counts and deferred/errors, because zero covered boxes is inconclusive.
- Exit 1 in strict mode means findings; exit 2 means incomplete, because a moving box or failed resource prevents a conclusive snapshot.
- It does not implement the older film labels `tight inset`, `touching`, `uneven`, `lopsided` and `fat row` as standalone rules; inspect those craft relations visually, because inventing checker coverage creates false confidence.
- Resolve findings from content/box measurements, then recheck; never hide the element to clear a gate, because deletion can pass geometry while breaking the floor.
- Check optical centring, touching neighbours, full scroll content and interaction states by eye, because this snapshot measures boxes and authored insets only.
- Record authentication and covered selectors explicitly; a checker with a fresh context needs a valid authorized way to reach the requested screen, because a login capture proves only login.

## Never-less, truth and coherence

| Required reconciliation | Failure it stops | Deciding proof |
|---|---|---|
| Every Preserve item mapped before → after | Lost information or action hidden by a nicer after-shot | Frozen ledger plus matched captures and exercised destination/control |
| Every drawn value keeps zero/unknown/pending/error semantics | Unknown money, counts, age or progress rendered as a confident zero | Behaviour tests on shipped selectors/components in each distinct state |
| Title = breadcrumb = destination menu label | A person arriving somewhere named differently | Shared label source and route/locale assertions plus rendered navigation |
| One term per concept; distinct names for distinct measures | Cross-screen contradictions disguised by reused words | Figure contract, shared formatter/selector and adjacent-screen comparison |
| Missing-data reasons and remedy in one scope | Caveats duplicated across neighbouring cards | Partial-state render plus retained disclosure-content assertions |
| Decision scope/consequence/optional cues remain | Copy trimming changes what a user reasonably decides | Floor item, accessible content and actual decision journey |

- Compare before and after with the same data, filters, date, role, theme and width; an after-shot must not show less information or fewer actions without a recorded owner-authorized drop.
- For moved content, capture and exercise its link and destination; a screenshot-only tick cannot prove preserved capability.
- Keep the partial chart/table's gap once beside that region and page-level hidden facts in their shared disclosure; decision-critical errors and returned reasons stay with the decision, because “one caveat” does not mean hiding consequences.
- Run an app-wide read-only class sweep the day a shared pattern is found by eye; route money/date/permission interpretation to Terra or above, because a text match alone cannot establish a real defect.

## Local and integration losses checks

- Each builder runs current `CLAUDE.md` local gates on touched files/routes, including affected-e2e selection and rendered proof, because inner-loop checks should stay scoped.
- The Director runs `npm run verify:locked` from `pmo-portal/` on the integrated batch, because its full unit suite can detect a lost capability in an untouched caller.
- Wait in the foreground and retain the output body, tested commit, complete unit totals and every red, because an exit code or a partial stopped run is not a complete losses check.
- Treat `verify:locked` as more than a unit command: it also runs guards, typechecks, lint and build; it does not replace the separately required browser or database gates.

| Red classification | Required evidence and action |
|---|---|
| **Stale look-pin** | Show the approved composition change and that no behaviour/meaning is protected; remove that look assertion or update intended journey steps while retaining the goal |
| **Real loss restored** | Name the user's lost goal and restore shipped code until its existing behaviour/money/role/a11y test passes; add coverage when the floor exposed a gap |
| **Flaky** | Preserve the failure output/trace and show the nondeterministic cause or reproduction; diagnose and repair it without weakening, skipping or declaring a rerun alone a cure |

- Classify ambiguous reds as unresolved and return them to the Director, because “stale” without the approved change can launder a real loss.
- Repair classified failures with targeted reruns, then rerun the integration gate if code changed after its proof; the final accepted commit must have complete green evidence.
- A full run belongs once at the batch integration boundary, not to every worker; repeat only when a change or failure invalidates its evidence, because shared heavy runs have a real cost.
- Attach the blind fresh-eyes score from `judging.md` at batch end, because the suite and floor cannot decide intentional composition.

**Complete:** the tested commit has reconciled floor/truth/coherence proofs, measured screen gates, an explained inspector report, a green full integration losses check and the required batch review; nothing untested is called passed.
