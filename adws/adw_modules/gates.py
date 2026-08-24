"""Validation gates: verify the envelope's CLAIMS, never guesses.

A gate is `gate(envelope, run) -> GateReport` — one check per item it looked at.
Violations are derived from the failed checks and sent back to the SAME agent
session as a correction. Every check is recorded either way, so a green gate
says WHAT it verified instead of only that it passed.

Gates check what is mechanically checkable; plan quality is a reviewer's job.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

from . import permissions
from .data_types import EnvelopeBase, GateReport

TAIL_CHARS = 1000        # command output kept as evidence on a failure


def _size(path: Path) -> str:
    n = path.stat().st_size
    return f"{n}B" if n < 1024 else f"{n / 1024:.1f}KB"


def artifacts_exist(envelope: EnvelopeBase, run) -> GateReport:
    report = GateReport()
    for a in envelope.artifacts:
        p = Path(a)
        report.check(a, p.exists(),
                     f"exists, {_size(p)}" if p.exists() else "declared artifact does not exist")
    return report


def files_non_empty(envelope: EnvelopeBase, run) -> GateReport:
    report = GateReport()
    for a in envelope.artifacts:
        p = Path(a)
        if not (p.exists() and p.is_file()):
            continue                       # existence is artifacts_exist's job
        empty = p.stat().st_size == 0
        report.check(a, not empty, "declared artifact is empty" if empty else _size(p))
    return report


def json_parses(envelope: EnvelopeBase, run) -> GateReport:
    report = GateReport()
    for a in envelope.artifacts:
        p = Path(a)
        if p.suffix != ".json" or not p.exists():
            continue
        try:
            parsed = json.loads(p.read_text())
            report.check(a, True, f"parses, {type(parsed).__name__}")
        except json.JSONDecodeError as e:
            report.check(a, False, f"declared JSON artifact does not parse: {e}")
    return report


def diff_matches_claims(envelope: EnvelopeBase, run) -> GateReport:
    """The claimed diff and the real one must be the same set — BOTH directions.

    Claimed-but-absent is a hallucination. Changed-but-unclaimed is an
    under-report, and until #539 nothing checked for it: a builder on run
    c0bc91ce modified ten files, named none of them, and passed this gate. That
    matters beyond a tidy envelope, because `commit_build` commits the TREE —
    so an unnamed file is committed anyway, under a message written about work
    the agent did not describe. It is also how a run sweeps unrelated files into
    one commit.

    A third case — writing outside the agent's `writes` allowlist — belongs to
    `permissions.enforce`, which rolls the change back rather than merely
    reporting it. Not duplicated here; a weaker second answer to a question that
    already has a strong one is worse than no answer.
    """
    report = GateReport()
    for f in getattr(envelope, "changed_files", []):
        p = Path(f)
        report.check(f, p.exists(),
                     f"exists, {_size(p)}" if p.exists() else "claimed changed file does not exist")

    # Only envelopes that HAVE a `changed_files` field are making a claim about the
    # diff; a plan or a review says nothing about it and cannot under-report it.
    if not hasattr(envelope, "changed_files"):
        return report
    before = getattr(run, "tree_before", None)
    if before is None:
        return report          # no baseline pinned: nothing to compare against

    # Artifacts count as claimed. An agent that writes its plan to a file and names
    # it under `artifacts` has declared that file, just not in the other list.
    claimed = {*getattr(envelope, "changed_files", []), *getattr(envelope, "artifacts", [])}
    touched = permissions.changed_paths(before, permissions.snapshot(run))
    unclaimed = sorted(set(touched) - claimed)
    report.check(
        "every changed file is claimed",
        not unclaimed,
        "claimed diff matches the tree" if not unclaimed
        else (f"{len(unclaimed)} file(s) changed but not named in changed_files: "
              + ", ".join(unclaimed[:8]) + (" …" if len(unclaimed) > 8 else "")))
    return report


def verdict_consistent(envelope: EnvelopeBase, run) -> GateReport:
    """A review's verdict must agree with the findings it just wrote down.

    Nothing here judges the code — that is the reviewer's job. This checks the
    envelope against itself: an approval that ships blocking items, or a
    rejection that names no problem, is a claim the harness can refute without
    reading a line of the diff.
    """
    report = GateReport()
    approved = bool(getattr(envelope, "approved", False))
    blocking = list(getattr(envelope, "blocking", []))
    unmet = [f.requirement for f in getattr(envelope, "findings", []) if not f.met]

    report.check("approved vs blocking", not (approved and blocking),
                 "no blocking items" if not blocking
                 else f"{len(blocking)} blocking item(s) while approved=true"
                 if approved else f"{len(blocking)} blocking item(s), not approved")
    report.check("approved vs findings", not (approved and unmet),
                 "every requirement met" if not unmet
                 else f"{len(unmet)} unmet requirement(s) while approved=true"
                 if approved else f"{len(unmet)} unmet requirement(s), not approved")
    report.check("rejection names a problem", approved or bool(blocking or unmet),
                 "verdict is supported" if approved or blocking or unmet
                 else "approved=false but no blocking item or unmet requirement was given")
    return report


def tests_pass(command: str):
    """Gate factory: the given shell command must exit 0."""
    def gate(envelope: EnvelopeBase, run) -> GateReport:
        result = subprocess.run(command, shell=True, capture_output=True, text=True)
        ok = result.returncode == 0
        note = f"exit {result.returncode}"
        if not ok:
            note += "\n" + (result.stdout + result.stderr)[-TAIL_CHARS:]
        return GateReport().check(command, ok, note)
    gate.__name__ = f"tests_pass({command})"
    return gate
