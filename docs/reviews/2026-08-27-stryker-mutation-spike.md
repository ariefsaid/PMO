# Mutation-testing spike (#561) — what it costs, and what it found

**Status:** spike complete. **Recommendation: adopt as a targeted, opt-in local pass. Do NOT put it in `verify`.**

Run on `dev` at `45a7bad2`, macOS/arm64, `@stryker-mutator/core` + `@stryker-mutator/vitest-runner`
installed with `npm install --no-save` so neither `package.json` nor `package-lock.json` was touched
(⚑ the lockfile is not reproducible from a Mac — `scripts/relock.sh` exists for that reason, and a
spike must not force that cost before the decision is made).

## The open question, answered with measurements

> *Whether a targeted mutation pass over changed files is cheap enough to be a per-PR signal, or
> whether this stays a periodic audit.*

Scoped to **one** file (`src/lib/withTimeout.ts`, 19 mutants):

| phase | wall | note |
|---|---|---|
| initial dry run (`perTest` coverage, 765 tests) | **236s** | FIXED — paid once per run, whatever you mutate |
| …of which actual test execution | 33s | the other **203s is transform/startup overhead** |
| mutant testing, 19 mutants @ concurrency 4 | ~51s | **~2.7s per mutant** |
| **total** | **293s** | |

**The shape that matters: the marginal cost is cheap and the fixed cost is not.** Four minutes of
dry run buys you nothing until the first mutant runs, and it is dominated by Vite transform and
startup, not by tests. Two consequences:

1. **Per-PR is affordable if the overhead is paid ONCE.** A typical PR here touches ~10 files;
   at ~19 mutants/file that is ~190 mutants ≈ 8–9 min of mutant testing + 4 min fixed ≈ **12–13
   min**. That is comparable to `verify`'s ~20 min in CI. Affordable — but only as ONE job over all
   changed files. A per-file loop pays the 4 minutes every time and is not affordable at all.
2. **Never in `verify`.** It roughly doubles the local gate, and its first broad run will produce a
   long surviving-mutant list. A gate everyone learns to ignore is worse than no gate — the issue
   said this and the numbers agree.

## What it found, in the first file it looked at

`src/lib/withTimeout.ts` scored **94.74%** (18 killed / 1 survived). The survivor is real, and it is
exactly the class this repo keeps finding by hand:

```
[Survived] CallExpression   src/lib/withTimeout.ts:69:9
-           clearTimeout(timer);
+           ;
```

Deleting `clearTimeout(timer)` from the **reject** branch left all 7 tests green. The suite already
had a test named *"clears the deadline timer once the promise settles (no dangling timer after
resolve)"* — and it only ever exercised **resolve**. A promise rejecting before its deadline left the
deadline timer armed: a dangling handle per failed call, in a wrapper whose entire purpose is not
leaving work behind.

Line coverage on that statement was already 100%. **Coverage proved the line ran; nothing proved its
behaviour was asserted.** Hand-verified before trusting the tool, then closed by `AC-TMO-004`, which
asserts `vi.getTimerCount()` rather than the spy — a spy-only assertion on the reject path would have
been satisfied by the resolve path's call and proved nothing, which is the same defect it was fixing.

## Recommendation

- **Adopt as an opt-in local pass**, scoped by changed files, not as a gate. One job, one dry run.
- **Judge by SURVIVORS, never by score.** A percentage invites threshold-gaming; a survivor list is a
  work queue. `withTimeout.ts` scored 94.74% while carrying a genuine defect.
- **The natural trigger is a review, not a commit** — the repo's own record is that mutation runs pay
  off when pointed at a diff someone is already reviewing (the 2026-08-21 wave found a dead oracle in
  nearly every issue; reading the assertions had caught none).
- **Before wiring anything permanent**, add the devDeps through `scripts/relock.sh` — `npm install`
  on macOS prunes the wasm32-wasi optional deps and CI's `npm ci` then fails.

## Cost of adoption, stated plainly

Two devDependencies and a config file. No production code. The honest risk is not technical: it is
that a long survivor list on first broad run gets triaged once and then ignored, at which point the
tool is worse than nothing because it looks like coverage. Scoping it to a diff under review is what
prevents that.
