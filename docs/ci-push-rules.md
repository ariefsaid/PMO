# Before you push to a branch that CI will test

`scripts/ci-round.sh ack` prints this page and stamps your commit; `.githooks/pre-push` refuses a push without
the stamp. A fourth CI round on one branch is refused without the owner's quoted OK. Read every line, every round.

1. **CI confirms; it does not discover.** Prove the change before the push. A push made to find out what is
   broken is the mistake this gate exists for.
2. **Database change:** run CI's whole `pgtap` job, every step in order, on a clean database off the shared
   machine: reset, guards and their self-tests, all pgTAP files, the isolation proof, every rollback harness.
   The job stops at its first red step, so each untested step can hide the next. A picked list of test files
   is not proof.
3. **Shared code change:** run every test file that imports it. An integration branch runs the whole unit suite
   off the shared machine.
4. **Screen, route, shell or start-up change:** run the affected browser journeys (`node scripts/affected-e2e.mjs`)
   before the branch reaches `dev`. New journeys are run once in a browser before `dev`.
5. **Red run:** state the root cause from the log or the trace before any fix. A fix that does not explain the
   failure is rejected. Then ask what else the same cause, or the same unrun step, could hide, and prove that too.
6. **Second red run on one branch, any cause:** stop. Either the full proof in rules 2 to 4 has not been run, or
   the change that keeps failing comes out of the round. Do not patch a third time.
7. **One push per round.** Never push while the branch's CI is running. Batch fixes; no rerun without a change.
8. **A new test is proven like code:** it has run and passed where CI runs it, or it is not ready.

Fourth round: `CI_ROUND_OK="<the owner's words>" git push ...` after the owner has agreed to it for this branch.
