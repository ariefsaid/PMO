# Dispatch result classification — implementation plan

Fresh Luna xhigh, original issue1103 only. Read docs/specs/dispatch-result.spec.md and AGENTS.md.

Own scripts/lib/dispatch-result.sh and scripts/dispatch-result.test.mjs only; preserve other workers. No global launcher edits, provider calls or dependencies.


Suggested neutral tracked core `scripts/lib/dispatch-result.sh` and
`scripts/dispatch-result.test.mjs`, containing only side-effect-free classification; actual global
launcher is not copied into Git. Root approved this neutral public-core destination; review public safety before release. Actual
shared-launcher integration remains private and requires Root review before any local installation.
Signature stays `classify <exit-code> <log-file>`, return text ok|retry|next; min bytes passed as
an explicit existing policy value. Existing temporary guard is reference evidence, not a new fork.

- [ ] Snapshot original classifier and temporary guard privately. In a fake-process Node test,
  source only the new classifier function; never invoke pi-dispatch/provider/self-tests that
  might touch global cooldowns or live log state. Use temp log files and supplied thresholds.
- [ ] Add complete rc0 controls with all four numeric values, quote `unauthorized`/network/status
  diagnostics as ordinary review prose, and test `# Review — verdict: **SHIP, conditional ...**`.
  Include bold `Verdict: FIX`, ALL-TASKS-DONE and their allowed existing suffixes. Run focused RED.
- [ ] Implement terminal decision before prose scanning only when rc0, sufficient size and a
  supported real report marker are present. Recognize Markdown headings deliberately; don't
  broaden to any occurrence of the word verdict in quoted prose/code fences. Require explicit
  transport framing for numeric statuses. Retain existing quota/no-op conditions on nonterminal
  responses. No unsupported content-meaning heuristic substitutes for process completion.
- [ ] Add positive real-transport controls for HTTP status 429/500/502/503, actual congestion and
  network errors, and negative nonzero-rc/short/incomplete marker examples. Assert enum outputs,
  then a fake launcher harness asserts a terminal report causes one attempted dispatch/delivery.
- [ ] Run `node --test scripts/dispatch-result.test.mjs`, `bash -n scripts/lib/dispatch-result.sh`
  GREEN. Restore numeric-anywhere matching as a mutation and require negative controls RED.
  Restore good implementation. Do not weaken provider fallback or claim SHIP from transport ok.
- [ ] Root inspects exact reusable diff, executes public-hygiene review/normal CI if tracked, and
  installs the small validated function into the shared launcher under separate scoped control.
  Existing executing workers keep their immutable run-local copies; don't replace their files.


Final gates: focused Node tests and bash syntax; locked app typecheck and changed-importer Vitest with two workers; git diff --check. Existing app lint scope does not include these scripts; do not change lint configuration. One consolidated review, one fix round, then Director verifies the diff. No browser/DB tests are required. Do not push or merge without the Director release step.
