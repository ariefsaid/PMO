# Verified post-merge cleanup (#1113)

Status: approved bounded v0.24 engineering scope; dev remains the ceiling.


FR-OPS-006: When merge/cleanup reports completion, every required check, exact-tip verification,
merge outcome and cleanup command shall already have succeeded and final state shall be verified.
FR-OPS-007: When a precondition or stage fails, the command shall exit nonzero, identify that stage
and preserve every not-yet-removed branch/worktree. Divergent or unverified tips are never deleted.
FR-OPS-008: When cleanup is accepted, capture MERGED/state/merge/headRef/headOid, fetch intended
base, prove merge reachability, exact local/remote head identity, exact clean owned worktree, then
remove worktree, prune, delete verified local branch, and delete still-matching remote branch last.
Absent remote may be accepted only when the checked immutable local tip remains correct. Post-step
absence checks decide success, not prose from git or a pipe's final command exit.
AC-OPS-1113-1 (Node process unit): Given fake gh/git successful responses and synthetic worktree,
when run, then operations occur in the required order and completion prints once after final proof.
AC-OPS-1113-2 (same owner): Given each precondition/stage failure, divergent local/remote head,
unclean/incorrect worktree, missing required check, failed remote deletion or final-state mismatch,
when run, then exit is nonzero, no completion line appears and later deletions do not occur.

