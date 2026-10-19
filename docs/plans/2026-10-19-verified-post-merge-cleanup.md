# Verified post-merge cleanup — implementation plan

Fresh Luna xhigh, issue #1113 only. Read AGENTS.md and docs/specs/verified-post-merge-cleanup.spec.md.
No real merge, cleanup, remote write or shared-wrapper installation is part of the build.


Neutral public candidate: `scripts/verified-post-merge-cleanup.mjs` and
`scripts/verified-post-merge-cleanup.test.mjs`. Keep actual private wrapper/caller/configuration out
of tracked changes. CLI takes explicit PR/worktree/expected-head/base dev arguments; it does not
hardcode this machine's paths. Root has approved the neutral reusable public core plus focused fake-process tests. Actual local
wrapper adoption stays private and Root-reviewed. No local-only destination decision remains.

- [ ] Add process fixtures with fake gh/git executables, temp repo/worktree and command journal.
  Assert expected exact heads and all six current required checks before the merge operation.
- [ ] Run `node --test scripts/verified-post-merge-cleanup.test.mjs` RED; build the driver with
  structured gh JSON, checked subprocess exits, explicit stage states and no shell pipelines.
- [ ] Implement immutable merge capture and ordered cleanup as FR-OPS-008. Pin the actual merge with
  `gh pr merge --squash --match-head-commit <expected-head>` so a later head is never merged from
  earlier check evidence. Squash-aware forced
  local branch deletion is allowed only after exact-tip and reachable merge proof. Recheck remote
  immediately before its deletion; any mismatch stops. No git force push, --force worktree removal
  or broad git add. Final verify requires no exact worktree/local ref/remote ref remains.
- [ ] Add a failure-injection test at every subprocess boundary plus absent/malformed metadata,
  duplicate check names, stale head and dirty worktree; require later journal operations absent.
  After irreversible partial cleanup, report partial stage honestly; no automatic guessed resume.
- [ ] Run focused tests GREEN and a mutation that ignores remote-delete exit: corresponding test
  must RED. Restore GREEN. No real git remote mutation/merge/cleanup is part of test execution.
- [ ] Root public-hygiene reviews neutral source/fixtures before tracking anything, obtains usual
  code/CI proof if public, then separately adopts the validated core in the local operational wrapper. Retain Root's strict
  independent caller until durable failure evidence is inspected. No operational installation by
  the generic issue builder without Root's exact scoped authorization.

