import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), "verified-post-merge-cleanup.mjs");
const NODE = process.execPath;
const HEAD = "a".repeat(40);
const MERGE = "b".repeat(40);
const DEV = "c".repeat(40);
const BRANCH = "codex/topic";
const REQUIRED_CHECKS = ["unit (1)", "unit (2)", "unit (3)", "unit (4)", "verify", "pgtap"];
const GATE_PASSES = REQUIRED_CHECKS.map((name) => ({ name, bucket: "pass", state: "SUCCESS" }));

const FAKE_TOOL = String.raw`#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const statePath = process.env.FAKE_STATE_PATH;
const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
const tool = path.basename(process.argv[1]);
const args = process.argv.slice(2);
const index = state.journal.length;
state.journal.push({ index, tool, args, cwd: process.cwd() });
fs.writeFileSync(statePath, JSON.stringify(state));
if (state.failAtIndex === index) process.exit(17);
let code = 0;
let output = "";
const out = (value) => { output += value; };
const ref = "refs/heads/" + state.branch;
const isGit = tool === "git";
const serializeWorktrees = () => state.worktrees.map((item) =>
  "worktree " + item.path + "\nHEAD " + item.head + "\nbranch " + item.branch + "\n"
).join("\n");
const remoteLines = () => {
  if (state.remoteOutput !== undefined) return state.remoteOutput;
  if (!state.remoteOid) return "";
  const line = state.remoteOid + "\t" + ref + "\n";
  return state.duplicateRemote ? line + line : line;
};
if (!isGit) {
  if (args[0] === "pr" && args[1] === "view") {
    const view = state.mergeExecuted ? state.postMergeView : state.pr;
    out(state.malformedInitialView && !state.mergeExecuted ? "{broken" : JSON.stringify(view) + "\n");
  } else if (args[0] === "pr" && args[1] === "checks") {
    out(state.malformedChecks ? "{broken" : JSON.stringify(state.checks) + "\n");
    if (state.staleBeforeMerge) state.pr.headRefOid = state.staleBeforeMerge;
    if (state.checks.some((check) => ["fail", "cancel", "pending"].includes(check.bucket))) {
      code = state.checks.some((check) => check.bucket === "pending") ? 8 : 1;
    }
  } else if (args[0] === "pr" && args[1] === "merge") {
    const matchIndex = args.indexOf("--match-head-commit");
    const matchHead = matchIndex >= 0 ? args[matchIndex + 1] : null;
    if (state.mergeExitFailure || matchHead !== state.pr.headRefOid) code = 1;
    else {
      state.mergeExecuted = true;
      if (state.changeLocalHeadAfterMerge) state.localHead = state.changeLocalHeadAfterMerge;
      if (state.changeRemoteAfterMerge !== undefined) state.remoteOid = state.changeRemoteAfterMerge;
      if (state.postMergeViewOverride) state.postMergeView = state.postMergeViewOverride;
    }
  } else code = 64;
} else {
  let effective = args;
  let targetCwd = process.cwd();
  if (args[0] === "-C") {
    targetCwd = args[1];
    effective = args.slice(2);
  }
  const first = effective[0];
  if (first === "rev-parse" && effective[1] === "--show-toplevel") {
    out((targetCwd === state.worktreePath ? state.worktreePath : state.root) + "\n");
  } else if (first === "check-ref-format" && effective[1] === "--branch" && effective[2] === state.branch) {
    code = 0;
  } else if (first === "worktree" && effective[1] === "list" && effective[2] === "--porcelain") {
    out(state.forceWorktreeListOutput === undefined ? serializeWorktrees() : state.forceWorktreeListOutput);
  } else if (first === "rev-parse" && effective[1] === "HEAD" && targetCwd === state.worktreePath) {
    out((state.worktreeHead || state.expectedHead) + "\n");
  } else if (first === "branch" && effective[1] === "--show-current" && targetCwd === state.worktreePath) {
    out((state.worktreeBranch || state.branch) + "\n");
  } else if (first === "status" && effective[1] === "--porcelain=v1") {
    out(state.dirty ? "?? untracked.txt\n" : "");
  } else if (first === "rev-parse" && effective[1] === "refs/heads/" + state.branch) {
    if (!state.localHead) code = 128;
    else {
      const localRefRead = (state.localRefReadCount || 0) + 1;
      state.localRefReadCount = localRefRead;
      out(state.localHead + "\n");
      if (state.advanceLocalHeadAfterRead && localRefRead === 3) {
        state.localHead = state.advanceLocalHeadAfterRead;
      }
    }
  } else if (first === "ls-remote" && effective[1] === "--heads" && effective[2] === "origin") {
    out(remoteLines());
    const remoteRefRead = (state.remoteRefReadCount || 0) + 1;
    state.remoteRefReadCount = remoteRefRead;
    if (state.advanceRemoteOidAfterRead && remoteRefRead === 4) {
      state.remoteOid = state.advanceRemoteOidAfterRead;
    }
    if (state.changeRemoteAfterLsRemote) state.remoteOid = state.changeRemoteAfterLsRemote;
  } else if (first === "fetch" && effective[1] === "origin" && effective[2] === "refs/heads/dev:refs/remotes/origin/dev") {
    state.fetched = true;
    state.fetchCount = (state.fetchCount || 0) + 1;
  } else if (first === "merge-base" && effective[1] !== "--is-ancestor") {
    if (!state.fetched || effective[1] !== state.expectedHead || effective[2] !== "refs/remotes/origin/dev") code = 1;
    else out((state.preMergeBase || "d".repeat(40)) + "\n");
  } else if (first === "diff" && effective[1] === "--name-only" && effective[2] === "--no-renames" && effective[3] === "-z") {
    if (effective[4] !== (state.preMergeBase || "d".repeat(40)) || effective[5] !== state.expectedHead) code = 1;
    else out((state.changedPaths || ["added.txt", "changed.txt", "deleted.txt"]).join("\0") + "\0");
  } else if (first === "diff" && effective[1] === "--quiet") {
    const pathspec = effective.at(-1);
    const filePath = pathspec?.startsWith(":(literal)") ? pathspec.slice(10) : null;
    if (!filePath || effective.at(-4) !== state.expectedHead || effective.at(-3) !== "refs/remotes/origin/dev") code = 2;
    else if (state.contentMismatches?.includes(filePath)) code = 1;
  } else if (first === "merge-base" && effective[1] === "--is-ancestor") {
    if (!state.mergeReachable || effective[2] !== state.mergeOid || !state.fetched) code = 1;
  } else if (first === "worktree" && effective[1] === "remove") {
    const target = effective[2];
    if (effective.includes("--force") || effective.includes("-f")) code = 2;
    else if (!state.keepWorktreeOnRemove) {
      state.worktrees = state.worktrees.filter((item) => item.path !== target);
      fs.rmSync(target, { recursive: true, force: true });
    }
  } else if (first === "worktree" && effective[1] === "prune") {
    state.pruned = true;
  } else if (first === "update-ref" && effective[1] === "-d") {
    if (effective.length !== 4 || effective[2] !== ref || effective[3] !== state.expectedHead) code = 2;
    else if (state.localHead !== effective[3]) code = 1;
    else if (!state.keepLocalRefAfterDelete) state.localHead = null;
  } else if (first === "log" && effective[1] === "--format=%B") {
    const logIndex = state.logCount || 0;
    out(state.commitMessages?.[logIndex] ?? state.commitMessage ?? "topic change\n");
    state.logCount = logIndex + 1;
  } else if (first === "push") {
    const expectedLease = "--force-with-lease=" + ref + ":" + state.expectedHead;
    if (effective.length !== 4 || effective[1] !== expectedLease || effective[2] !== "origin" || effective[3] !== ":" + ref) code = 2;
    else if (state.remoteOid !== state.expectedHead) code = 1;
    else if (state.failRemoteDelete) {
      if (state.remoteDeleteAppliedDespiteFailure) state.remoteOid = null;
      code = 1;
    } else if (!state.retainRemoteAfterDelete) state.remoteOid = null;
  } else if (first === "show-ref" && effective[1] === "--verify" && effective[2] === "--quiet") {
    code = state.localHead ? 0 : 1;
  } else code = 64;
}
fs.writeFileSync(statePath, JSON.stringify(state));
if (output) process.stdout.write(output);
process.exit(code);
`;

function createFixture(options = {}) {
  const tempRoot = mkdtempSync(join(tmpdir(), "verified-post-merge-cleanup-"));
  const root = join(tempRoot, "repo");
  const worktreePath = join(tempRoot, "owned-worktree");
  const bin = join(tempRoot, "bin");
  const statePath = join(tempRoot, "state.json");
  const branch = options.branch ?? BRANCH;
  mkdirSync(root, { recursive: true });
  mkdirSync(worktreePath, { recursive: true });
  mkdirSync(bin, { recursive: true });
  const initial = {
    root, worktreePath, branch, expectedHead: HEAD, mergeOid: MERGE, journal: [],
    checks: [...GATE_PASSES, { name: "integration", bucket: "skipping", state: "SKIPPED" }],
    pr: { state: "OPEN", baseRefName: "dev", headRefName: branch, headRefOid: HEAD },
    postMergeView: {
      state: "MERGED", baseRefName: "dev", headRefName: branch, headRefOid: HEAD,
      mergeCommit: { oid: MERGE },
    },
    mergeExecuted: false, mergeReachable: true, localHead: HEAD, worktreeHead: HEAD,
    worktreeBranch: branch,
    worktrees: [
      { path: root, head: DEV, branch: "refs/heads/dev" },
      { path: worktreePath, head: HEAD, branch: "refs/heads/" + branch },
    ],
    remoteOid: HEAD, commitMessage: "topic change\n", dirty: false,
    ...options,
  };
  writeFileSync(statePath, JSON.stringify(initial));
  for (const name of ["gh", "git"]) {
    const executable = join(bin, name);
    writeFileSync(executable, FAKE_TOOL, { mode: 0o755 });
    chmodSync(executable, 0o755);
  }
  const env = {
    ...process.env,
    PATH: [bin, dirname(NODE), process.env.PATH].filter(Boolean).join(":"),
    FAKE_STATE_PATH: statePath,
  };
  return {
    tempRoot, root, worktreePath, statePath, env,
    run(worktree = worktreePath) {
      return spawnSync(NODE, [
        SCRIPT, "--pr", "123", "--worktree", worktree, "--expected-head", HEAD, "--base", "dev",
      ], { cwd: root, env, encoding: "utf8", timeout: 10000 });
    },
    state() { return JSON.parse(readFileSync(statePath, "utf8")); },
    cleanup() { rmSync(tempRoot, { recursive: true, force: true }); },
  };
}

function hasCommand(state, tool, prefix) {
  return state.journal.some((event) => event.tool === tool && event.args.join(" ").startsWith(prefix));
}

function assertFailureBeforeMerge(fixture, result) {
  assert.notEqual(result.status, 0, result.stdout + result.stderr);
  assert.doesNotMatch(result.stdout, /VERIFIED CLEANUP COMPLETE/);
  const state = fixture.state();
  assert.equal(state.mergeExecuted, false);
  assert.equal(hasCommand(state, "git", "worktree remove"), false);
  assert.equal(hasCommand(state, "git", "update-ref -d"), false);
  assert.equal(hasCommand(state, "git", "push --force-with-lease="), false);
}

test("AC-OPS-1113-1: checks, exact squash merge, and proof-bound cleanup run in order", (t) => {
  const fixture = createFixture();
  t.after(() => fixture.cleanup());
  const result = fixture.run();
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal((result.stdout.match(/VERIFIED CLEANUP COMPLETE/g) || []).length, 1);
  assert.doesNotMatch(result.stderr, /FAILED/);
  const state = fixture.state();
  const index = (predicate) => state.journal.findIndex(predicate);
  const checks = index((e) => e.tool === "gh" && e.args[1] === "checks");
  const preMergeFetch = index((e) => e.tool === "git" && e.args[0] === "fetch");
  const preMergeAttribution = index((e) => e.tool === "git" && e.args[0] === "log");
  const merge = index((e) => e.tool === "gh" && e.args[1] === "merge");
  const fetch = state.journal.findLastIndex((e) => e.tool === "git" && e.args[0] === "fetch");
  const ancestry = state.journal.findLastIndex((e) => e.tool === "git" && e.args[0] === "merge-base");
  const changedFiles = index((e) => e.tool === "git" && e.args[0] === "diff" && e.args[1] === "--name-only");
  const adoption = index((e) => e.tool === "git" && e.args[0] === "diff" && e.args[1] === "--quiet");
  const remove = index((e) => e.tool === "git" && e.args[0] === "worktree" && e.args[1] === "remove");
  const prune = index((e) => e.tool === "git" && e.args[0] === "worktree" && e.args[1] === "prune");
  const localDelete = index((e) => e.tool === "git" && e.args[0] === "update-ref" && e.args[1] === "-d");
  const attribution = state.journal.findLastIndex((e) => e.tool === "git" && e.args[0] === "log");
  const push = index((e) => e.tool === "git" && e.args[0] === "push");
  const lastRemoteCheck = state.journal.findLastIndex((e) =>
    e.tool === "git" && e.args[0] === "ls-remote" && e.index > localDelete && e.index < push
  );
  assert.ok(checks >= 0 && checks < preMergeFetch && preMergeFetch < preMergeAttribution && preMergeAttribution < merge);
  assert.ok(merge < fetch && fetch < ancestry && ancestry < adoption && adoption < remove);
  assert.ok(preMergeAttribution > changedFiles);
  assert.ok(remove < prune && prune < localDelete);
  assert.ok(localDelete < attribution && attribution < lastRemoteCheck && lastRemoteCheck < push);
  assert.deepEqual(state.journal[checks].args, ["pr", "checks", "123", "--json", "name,bucket,state"]);
  assert.equal(state.journal[checks].args.includes("--required"), false);
  assert.deepEqual(state.journal[merge].args, ["pr", "merge", "123", "--squash", "--match-head-commit", HEAD]);
  assert.deepEqual(state.journal[fetch].args, ["fetch", "origin", "refs/heads/dev:refs/remotes/origin/dev"]);
  assert.deepEqual(
    state.journal.filter((e) => e.tool === "git" && e.args[0] === "diff" && e.args[1] === "--quiet")
      .map((e) => e.args.at(-1)),
    [":(literal)added.txt", ":(literal)changed.txt", ":(literal)deleted.txt"],
  );
  assert.deepEqual(state.journal[remove].args, ["worktree", "remove", fixture.worktreePath]);
  assert.equal(state.journal.some((e) => e.args.includes("--force") || e.args.includes("-f")), false);
  assert.deepEqual(state.journal[localDelete].args, ["update-ref", "-d", "refs/heads/" + BRANCH, HEAD]);
  assert.deepEqual(state.journal[push].args, [
    "push", "--force-with-lease=refs/heads/" + BRANCH + ":" + HEAD, "origin", ":refs/heads/" + BRANCH,
  ]);
  assert.equal(existsSync(fixture.worktreePath), false);
  assert.equal(state.localHead, null);
  assert.equal(state.remoteOid, null);
});

test("AC-OPS-1113-2: the six current gates must pass once; skipped extras are allowed", (t) => {
  const cases = [
    ["missing", { checks: [...GATE_PASSES.slice(0, 5), { name: "extra-green", bucket: "pass", state: "SUCCESS" }] }],
    ["malformed", { malformedChecks: true }],
    ["duplicate", { checks: [...GATE_PASSES, { name: "verify", bucket: "pass", state: "SUCCESS" }] }],
    ["failed expected", { checks: [...GATE_PASSES.map((check) => check.name === "pgtap" ? { ...check, bucket: "fail", state: "FAILURE" } : check), { name: "integration", bucket: "skipping", state: "SKIPPED" }] }],
    ["failed extra", { checks: [...GATE_PASSES, { name: "integration", bucket: "fail", state: "FAILURE" }] }],
    ["pending extra", { checks: [...GATE_PASSES, { name: "integration", bucket: "pending", state: "IN_PROGRESS" }] }],
    ["incomplete expected", { checks: [...GATE_PASSES.map((check) => check.name === "verify" ? { ...check, state: "IN_PROGRESS" } : check), { name: "integration", bucket: "skipping", state: "SKIPPED" }] }],
  ];
  for (const [label, overrides] of cases) {
    const fixture = createFixture(overrides);
    const result = fixture.run();
    assertFailureBeforeMerge(fixture, result);
    assert.match(result.stderr, /CI checks|CI gates/i);
    fixture.cleanup();
    t.diagnostic("blocked " + label + " check response");
  }
});

test("AC-OPS-1113-2: PR, base, exact worktree, cleanliness, and immutable tips are preconditions", (t) => {
  const wrongPath = join(tmpdir(), "unowned-cleanup-worktree");
  const cases = [
    ["malformed PR metadata", { malformedInitialView: true }],
    ["stale PR head", { pr: { state: "OPEN", baseRefName: "dev", headRefName: BRANCH, headRefOid: "d".repeat(40) } }],
    ["wrong base", { pr: { state: "OPEN", baseRefName: "main", headRefName: BRANCH, headRefOid: HEAD } }],
    ["dirty worktree", { dirty: true }],
    ["wrong worktree branch", { worktreeBranch: "other", worktrees: [{ path: "ROOT", head: DEV, branch: "refs/heads/dev" }, { path: "WT", head: HEAD, branch: "refs/heads/other" }] }],
    ["wrong worktree path", { worktrees: [{ path: "ROOT", head: DEV, branch: "refs/heads/dev" }, { path: wrongPath, head: HEAD, branch: "refs/heads/" + BRANCH }] }],
    ["stale local branch", { localHead: "d".repeat(40) }],
    ["stale worktree head", { worktreeHead: "d".repeat(40) }],
    ["stale remote branch", { remoteOid: "d".repeat(40) }],
    ["duplicate remote ref", { duplicateRemote: true }],
  ];
  for (const [label, rawOverrides] of cases) {
    const fixture = createFixture();
    const overrides = structuredClone(rawOverrides);
    if (overrides.worktrees) {
      overrides.worktrees = overrides.worktrees.map((item) => ({
        ...item,
        path: item.path === "ROOT" ? fixture.root : item.path === "WT" ? fixture.worktreePath : item.path,
      }));
    }
    writeFileSync(fixture.statePath, JSON.stringify({ ...fixture.state(), ...overrides }));
    const result = fixture.run();
    assertFailureBeforeMerge(fixture, result);
    fixture.cleanup();
    t.diagnostic("blocked " + label);
  }

  for (const branch of ["main", "master", "production", "dev"]) {
    const fixture = createFixture({ branch });
    const result = fixture.run();
    assertFailureBeforeMerge(fixture, result);
    assert.match(result.stderr, /branch is not eligible for cleanup/i);
    assert.equal(hasCommand(fixture.state(), "gh", "pr checks"), false);
    fixture.cleanup();
    t.diagnostic("refused reserved branch " + branch + " before checks or merge");
  }
});

test("AC-OPS-1113-2: moved head, malformed merge result, unreachable merge, or changed tips stop cleanup", (t) => {
  const cases = [
    ["head moved after checks", { staleBeforeMerge: "d".repeat(40) }, /merge/i],
    ["merge command failed", { mergeExitFailure: true }, /merge/i],
    ["unreachable merge", { mergeReachable: false }, /merge/i],
    ["missing merge commit", { postMergeViewOverride: { state: "MERGED", baseRefName: "dev", headRefName: BRANCH, headRefOid: HEAD, mergeCommit: null } }, /merge/i],
    ["merged head changed", { postMergeViewOverride: { state: "MERGED", baseRefName: "dev", headRefName: BRANCH, headRefOid: "d".repeat(40), mergeCommit: { oid: MERGE } } }, /merge/i],
    ["local tip changed after merge", { changeLocalHeadAfterMerge: "d".repeat(40) }, /tip/i],
    ["remote tip changed after merge", { changeRemoteAfterMerge: "d".repeat(40) }, /tip/i],
  ];
  for (const [label, overrides, expectedStage] of cases) {
    const fixture = createFixture(overrides);
    const result = fixture.run();
    assert.notEqual(result.status, 0, result.stdout + result.stderr);
    assert.doesNotMatch(result.stdout, /VERIFIED CLEANUP COMPLETE/);
    assert.match(result.stderr, expectedStage);
    const state = fixture.state();
    assert.equal(hasCommand(state, "git", "worktree remove"), false);
    assert.equal(hasCommand(state, "git", "update-ref -d"), false);
    assert.equal(hasCommand(state, "git", "push --force-with-lease="), false);
    fixture.cleanup();
    t.diagnostic("stopped after " + label);
  }
});

test("AC-OPS-1113-2: a local branch that advances after its final lookup is preserved", (t) => {
  const newerLocalHead = "d".repeat(40);
  const local = createFixture({ advanceLocalHeadAfterRead: newerLocalHead });
  t.after(() => local.cleanup());
  const localResult = local.run();
  const localState = local.state();
  assert.notEqual(localResult.status, 0, localResult.stdout + localResult.stderr);
  assert.doesNotMatch(localResult.stdout, /VERIFIED CLEANUP COMPLETE/);
  assert.match(localResult.stderr, /local branch deletion/i);
  assert.equal(localState.localHead, newerLocalHead);
  assert.deepEqual(localState.journal.at(-1).args, ["update-ref", "-d", "refs/heads/" + BRANCH, HEAD]);
  assert.equal(hasCommand(localState, "git", "push --force-with-lease="), false);
});

test("AC-OPS-1113-2: a remote branch that advances after its final lookup is preserved", (t) => {
  const newerRemoteHead = "e".repeat(40);
  const remote = createFixture({ advanceRemoteOidAfterRead: newerRemoteHead });
  t.after(() => remote.cleanup());
  const remoteResult = remote.run(remote.worktreePath);
  const remoteState = remote.state();
  assert.notEqual(remoteResult.status, 0, remoteResult.stdout + remoteResult.stderr);
  assert.doesNotMatch(remoteResult.stdout, /VERIFIED CLEANUP COMPLETE/);
  assert.match(remoteResult.stderr, /remote branch deletion/i);
  assert.equal(remoteState.remoteOid, newerRemoteHead);
  const remoteDeleteIndex = remoteState.journal.findLastIndex((event) =>
    event.tool === "git" && event.args[0] === "push" && event.args[1]?.startsWith("--force-with-lease=")
  );
  assert.ok(remoteDeleteIndex >= 0);
  assert.equal(remoteDeleteIndex, remoteState.journal.length - 1, "no cleanup command follows the rejected delete");
});

test("AC-OPS-1113-2: real Git compare-delete accepts the expected tip and rejects a stale tip", (t) => {
  const tempRoot = mkdtempSync(join(tmpdir(), "cleanup-compare-delete-git-"));
  t.after(() => rmSync(tempRoot, { recursive: true, force: true }));
  const repo = join(tempRoot, "repo");
  const bare = join(tempRoot, "origin.git");
  mkdirSync(repo);
  mkdirSync(bare);
  const env = {
    ...process.env,
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
  };
  const git = (cwd, args) => spawnSync("git", args, {
    cwd, env, encoding: "utf8", timeout: 10000,
  });
  const success = (result) => assert.equal(result.status, 0, result.stdout + result.stderr);

  success(git(repo, ["init", "--quiet", "--initial-branch=dev"]));
  success(git(bare, ["init", "--bare", "--quiet"]));
  success(git(repo, ["config", "user.name", "Temporary cleanup test"]));
  success(git(repo, ["config", "user.email", "cleanup-test@example.invalid"]));
  success(git(repo, ["config", "commit.gpgsign", "false"]));
  writeFileSync(join(repo, "tracked.txt"), "first\n");
  success(git(repo, ["add", "tracked.txt"]));
  success(git(repo, ["commit", "--quiet", "-m", "initial fixture"]));
  success(git(repo, ["checkout", "--quiet", "-b", BRANCH]));
  success(git(repo, ["remote", "add", "origin", bare]));
  success(git(repo, ["push", "--quiet", "-u", "origin", "refs/heads/" + BRANCH]));
  const expectedHead = git(repo, ["rev-parse", "HEAD"]).stdout.trim();
  assert.match(expectedHead, /^[0-9a-f]{40}$/);

  success(git(repo, ["checkout", "--quiet", "--detach"]));
  success(git(repo, ["update-ref", "-d", "refs/heads/" + BRANCH, expectedHead]));
  assert.equal(git(repo, ["show-ref", "--verify", "--quiet", "refs/heads/" + BRANCH]).status, 1);

  writeFileSync(join(repo, "tracked.txt"), "second\n");
  success(git(repo, ["add", "tracked.txt"]));
  success(git(repo, ["commit", "--quiet", "-m", "advanced fixture"]));
  const newerHead = git(repo, ["rev-parse", "HEAD"]).stdout.trim();
  assert.notEqual(newerHead, expectedHead);
  success(git(repo, ["update-ref", "refs/heads/" + BRANCH, newerHead]));
  const staleLocalDelete = git(repo, ["update-ref", "-d", "refs/heads/" + BRANCH, expectedHead]);
  assert.notEqual(staleLocalDelete.status, 0, staleLocalDelete.stdout + staleLocalDelete.stderr);
  assert.equal(git(repo, ["rev-parse", "refs/heads/" + BRANCH]).stdout.trim(), newerHead);

  success(git(repo, ["push", "--quiet", "origin", newerHead + ":refs/heads/" + BRANCH]));
  const remoteDelete = (ref, head) => git(repo, [
    "push", "--force-with-lease=" + ref + ":" + head, "origin", ":" + ref,
  ]);
  const staleRemoteDelete = remoteDelete("refs/heads/" + BRANCH, expectedHead);
  assert.notEqual(staleRemoteDelete.status, 0, staleRemoteDelete.stdout + staleRemoteDelete.stderr);
  const remoteHeadAfterStaleDelete = git(repo, ["ls-remote", "--heads", "origin", "refs/heads/" + BRANCH]);
  success(remoteHeadAfterStaleDelete);
  assert.match(remoteHeadAfterStaleDelete.stdout, new RegExp("^" + newerHead + "\\s+refs/heads/" + BRANCH + "\\n$"));

  const successRef = "refs/heads/codex/expected-cleanup";
  success(git(repo, ["push", "--quiet", "origin", expectedHead + ":" + successRef]));
  success(remoteDelete(successRef, expectedHead));
  assert.equal(git(repo, ["ls-remote", "--heads", "origin", successRef]).stdout, "");
});

test("AC-OPS-1113-2: feature file content must be present on fetched dev before any removal", (t) => {
  const cases = [
    ["changed content differs", { contentMismatches: ["changed.txt"] }],
    ["feature addition missing", { contentMismatches: ["added.txt"] }],
    ["feature deletion retained", { contentMismatches: ["deleted.txt"] }],
  ];
  for (const [label, overrides] of cases) {
    const fixture = createFixture(overrides);
    const result = fixture.run();
    assert.notEqual(result.status, 0, result.stdout + result.stderr);
    assert.doesNotMatch(result.stdout, /VERIFIED CLEANUP COMPLETE/);
    assert.match(result.stderr, /content adoption/i);
    const state = fixture.state();
    assert.equal(hasCommand(state, "git", "worktree remove"), false);
    assert.equal(hasCommand(state, "git", "update-ref -d"), false);
    assert.equal(hasCommand(state, "git", "push --force-with-lease="), false);
    fixture.cleanup();
    t.diagnostic("preserved cleanup state when " + label);
  }
});

test("AC-OPS-1113-2: an absent remote is accepted only after the expected local tip is verified", (t) => {
  const fixture = createFixture({ remoteOid: null });
  t.after(() => fixture.cleanup());
  const result = fixture.run();
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal((result.stdout.match(/VERIFIED CLEANUP COMPLETE/g) || []).length, 1);
  assert.equal(hasCommand(fixture.state(), "git", "push --force-with-lease="), false);
});

test("AC-OPS-1113-2: deletion failure or any final absence mismatch is not completion", (t) => {
  const cases = [
    ["remote deletion reports failure after removal", { failRemoteDelete: true, remoteDeleteAppliedDespiteFailure: true }],
    ["remote deletion failure", { failRemoteDelete: true }],
    ["worktree remains", { keepWorktreeOnRemove: true }],
    ["local ref remains", { keepLocalRefAfterDelete: true }],
    ["remote ref remains", { retainRemoteAfterDelete: true }],
  ];
  for (const [label, overrides] of cases) {
    const fixture = createFixture(overrides);
    const result = fixture.run();
    assert.notEqual(result.status, 0, result.stdout + result.stderr);
    assert.doesNotMatch(result.stdout, /VERIFIED CLEANUP COMPLETE/);
    assert.match(result.stderr, /FAILED/);
    const state = fixture.state();
    if (label === "remote deletion failure") {
      assert.match(result.stderr, /FAILED \[remote branch deletion\]/);
      assert.equal(state.localHead, null);
      assert.equal(state.remoteOid, HEAD);
      assert.equal(state.journal.filter((event) =>
        event.tool === "git" && event.args.join(" ").startsWith("show-ref --verify --quiet")
      ).length, 1);
    }
    if (label === "remote deletion reports failure after removal") {
      assert.match(result.stderr, /FAILED \[remote branch deletion\]/);
      assert.equal(state.remoteOid, null);
      assert.equal(state.journal.filter((event) =>
        event.tool === "git" && event.args.join(" ").startsWith("show-ref --verify --quiet")
      ).length, 1);
    }
    if (label === "local ref remains") {
      assert.equal(hasCommand(state, "git", "push --force-with-lease="), false);
    }
    fixture.cleanup();
    t.diagnostic("rejected " + label);
  }
});

test("AC-OPS-1113-2: any co-authored marker blocks merge and is checked again before remote deletion", (t) => {
  for (const [label, options, mergeMustNotRun] of [
    ["marker variant before merge", { commitMessage: "This commit was co-authored in a pair session.\n" }, true],
    ["marker introduced before deletion gate", { commitMessages: ["topic change\n", "co-authored mention\n"] }, false],
  ]) {
    const fixture = createFixture(options);
    const result = fixture.run();
    assert.notEqual(result.status, 0, result.stdout + result.stderr);
    assert.doesNotMatch(result.stdout, /VERIFIED CLEANUP COMPLETE/);
    assert.match(result.stderr, /attribution/i);
    const state = fixture.state();
    assert.equal(state.mergeExecuted, !mergeMustNotRun);
    assert.equal(hasCommand(state, "git", "push --force-with-lease="), false);
    if (mergeMustNotRun) assert.equal(hasCommand(state, "git", "worktree remove"), false);
    fixture.cleanup();
    t.diagnostic("blocked " + label);
  }
});

test("AC-OPS-1113-2: failure injection at every subprocess boundary stops the run", (t) => {
  const baseline = createFixture();
  const baselineResult = baseline.run();
  assert.equal(baselineResult.status, 0, baselineResult.stdout + baselineResult.stderr);
  const boundaryCount = baseline.state().journal.length;
  baseline.cleanup();
  for (let index = 0; index < boundaryCount; index += 1) {
    const fixture = createFixture({ failAtIndex: index });
    const result = fixture.run();
    assert.notEqual(result.status, 0, "boundary " + index + " unexpectedly passed");
    assert.doesNotMatch(result.stdout, /VERIFIED CLEANUP COMPLETE/, "boundary " + index);
    assert.match(result.stderr, /FAILED/, "boundary " + index);
    assert.equal(fixture.state().journal.length, index + 1, "a later child process ran at " + index);
    fixture.cleanup();
  }
  t.diagnostic("injected failures at " + boundaryCount + " child-process boundaries");
});
