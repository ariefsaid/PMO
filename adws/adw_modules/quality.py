"""Deterministic lint, typecheck, build, and test blocks.

A known command is not a judgement call. Anything whose invocation you can write
down belongs here as code — it runs in milliseconds, costs nothing, and returns
the same answer every time. Agents are for the parts that need reading and
deciding.

╔══════════════════════════════════════════════════════════════════════════════╗
║  REPLACE THE PLACEHOLDER COMMANDS BELOW.                                     ║
║                                                                              ║
║  Every block ships as an `echo` that exits 0 and announces it is fake. They   ║
║  are placeholders on purpose: a stamped repo has no way to guess your test    ║
║  runner, and a wrong-but-plausible command that silently passes is worse      ║
║  than one that says so out loud.                                             ║
║                                                                              ║
║  For each block you want: swap `_placeholder(...)` for the real argv, e.g.    ║
║      argv=["bun", "test", "apps/web/server.test.ts"]                         ║
║      argv=["uv", "run", "pytest", "-q"]                                      ║
║      argv=["npm", "run", "lint"]                                             ║
║  Delete the blocks you don't need, and drop them from run_quality()'s list.   ║
║                                                                              ║
║  Two rules when you write the real command:                                  ║
║    1. argv LIST, never a shell string — no quoting bugs, no shell injection.  ║
║    2. Call binaries by BARE NAME. These blocks inherit the operator's         ║
║       environment (see utils.operator_env), so `bun`, `uv`, `pytest` resolve  ║
║       exactly as they do in their terminal. Never hard-code an absolute path  ║
║       like /Users/you/.bun/bin/bun — that bakes your machine into the trace.  ║
╚══════════════════════════════════════════════════════════════════════════════╝
"""

from __future__ import annotations

import fcntl
import os
import shlex
import subprocess
import time
from pathlib import Path
from typing import Callable, IO

from .data_types import (EventRecord, QualityCheckResult, QualityCheckSpec, QualityResult,
                         VerifyOutput)
from .utils import now_iso, operator_env

# How much of a failing command's output rides back inside the envelope. Enough
# for a builder to act on without opening the artifact; bounded so a runaway
# stack trace can't swamp the next agent's context.
TAIL_CHARS = 4_000


def _placeholder(name: str) -> list[str]:
    """A command that does nothing and admits it. Replace every call to this."""
    return ["echo", f"PLACEHOLDER {name}: edit adws/adw_modules/quality.py and "
                    f"replace this echo with the real {name} command"]


def _check_dir(run, name: str) -> Path:
    seq = run.phases[-1].seq if run.phases else 0
    path = run.context_handoff_dir / "quality" / f"{seq:02d}_{name}"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _text(value: str | bytes | None) -> str:
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace")
    return value or ""


def _acquire_lock(path: str, wait_seconds: int) -> IO[str] | None:
    """Take the machine-global advisory lock, polling up to `wait_seconds`.

    Same file and same fcntl.flock protocol as scripts/lib/flock-run.sh, so it excludes (and is
    excluded by) every `with-*-lock.sh` user. The kernel drops the lock when the handle closes
    or the process dies. Returns None when the wait was exhausted.
    """
    handle = open(path, "w")
    deadline = time.monotonic() + wait_seconds
    while True:
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
            handle.write(f"pid={os.getpid()} started={time.strftime('%H:%M:%S')}\n")
            handle.flush()
            return handle
        except BlockingIOError:
            if time.monotonic() >= deadline:
                handle.close()
                return None
            time.sleep(1)


def _run(spec: QualityCheckSpec, run) -> QualityCheckResult:
    phase = run.phases[-1]
    output_dir = _check_dir(run, spec.name)
    output_artifact = output_dir / "command.log"
    command = shlex.join(spec.argv)
    env = operator_env()             # the engineer's own shell environment

    run.console.note(f"quality {spec.name}: {command}")
    started_at = now_iso()
    clock = time.monotonic()
    stdout = ""
    stderr = ""
    lock = None
    try:
        if spec.lock_path:
            # Queue for the lock OUTSIDE the command's timeout: time spent behind another
            # suite is not the suite's time (#704).
            lock = _acquire_lock(spec.lock_path, spec.lock_wait_seconds)
            if lock is None:
                raise TimeoutError(f"gave up after {spec.lock_wait_seconds}s waiting for the "
                                   f"shared lock {spec.lock_path}")
            env["PMO_TEST_LOCK_HELD"] = "1"   # so a self-wrapping child does not re-acquire it
            run.console.note(f"quality {spec.name}: lock acquired after "
                             f"{time.monotonic() - clock:.0f}s wait")
        completed = subprocess.run(
            spec.argv,
            cwd=run.repo_root,
            env=env,
            capture_output=True,
            text=True,
            timeout=spec.timeout_seconds,
        )
        returncode = completed.returncode
        stdout = completed.stdout
        stderr = completed.stderr
    except TimeoutError as error:
        returncode = 75                    # EX_TEMPFAIL, as flock-run.sh
        stderr = str(error)
    except subprocess.TimeoutExpired as error:
        returncode = 124
        # TimeoutExpired carries bytes even under text=True (CPython quirk).
        stdout = _text(error.stdout)
        stderr = _text(error.stderr) + f"\nTimed out after {spec.timeout_seconds}s."
    except OSError as error:
        # A missing binary lands here as exit 127 with the real message — no
        # pre-flight probe needed, and none wanted.
        returncode = 127
        stderr = str(error)
    finally:
        if lock is not None:
            lock.close()                   # releases the flock

    duration = time.monotonic() - clock
    output_artifact.write_text(
        f"$ {command}\nexit: {returncode}\nduration_seconds: {duration:.3f}\n"
        f"\n--- stdout ---\n{stdout}\n--- stderr ---\n{stderr}\n"
    )
    passed = returncode == 0
    run.tracer.event(EventRecord(
        adw_id=run.adw_id,
        phase_id=phase.phase_id,
        type="tool_call",
        name=f"quality:{spec.name}",
        payload={
            "area": spec.area,
            "operation": spec.operation,
            "command": command,
            "returncode": returncode,
            "passed": passed,
            "output_artifact": str(output_artifact),
        },
        started_at=started_at,
        ended_at=now_iso(),
    ))
    run.console.note(
        f"quality {spec.name}: {'passed' if passed else 'failed'} "
        f"(exit {returncode}, {duration:.1f}s)"
    )
    return QualityCheckResult(
        name=spec.name,
        area=spec.area,
        operation=spec.operation,
        command=command,
        returncode=returncode,
        passed=passed,
        duration_seconds=duration,
        output_artifact=str(output_artifact),
        output_tail=(stdout + stderr)[-TAIL_CHARS:],
    )


# ── Blocks ────────────────────────────────────────────────────────────────────
# Replace every argv below. See the banner at the top of this file.

# PMO wiring: app commands run from pmo-portal/ (CLAUDE.md). The vitest suite is heavy and the
# machine is shared, so `test` holds the same lock scripts/with-test-lock.sh uses (~/.pmo-test.lock,
# PMO_TEST_LOCK override) — one full suite at a time; the timeout starts once the lock is held. These are the inner-loop gates; the full 8-gate
# `npm run verify:locked` stays the Director's pre-PR concern, not a per-fix-loop cost.

def test(run) -> QualityCheckResult:
    """Run the project's test suite. The highest-value block to wire up first."""
    return _run(QualityCheckSpec(
        name="test",
        area="frontend",
        operation="build",
        argv=["bash", "-c", "cd pmo-portal && npm test"],
        # The lock is taken by _run BEFORE this clock starts, so the budget is the suite's alone
        # (#704).
        lock_path=os.environ.get("PMO_TEST_LOCK") or str(Path.home() / ".pmo-test.lock"),
        timeout_seconds=1200,
    ), run)


def lint(run) -> QualityCheckResult:
    return _run(QualityCheckSpec(
        name="lint",
        area="frontend",
        operation="lint",
        argv=["bash", "-c", "cd pmo-portal && npm run lint:ci"],
        timeout_seconds=300,
    ), run)


def typecheck(run) -> QualityCheckResult:
    return _run(QualityCheckSpec(
        name="typecheck",
        area="frontend",
        operation="typecheck",
        argv=["bash", "-c", "cd pmo-portal && npm run typecheck"],
        timeout_seconds=300,
    ), run)


def build(run) -> QualityCheckResult:
    return _run(QualityCheckSpec(
        name="build",
        area="frontend",
        operation="build",
        argv=["bash", "-c", "cd pmo-portal && npm run build"],
        timeout_seconds=600,
    ), run)


def pgtap(run) -> QualityCheckResult:
    """RLS/tenancy/role contracts. reset+test chained inside ONE db-lock hold —
    separate holds let a sibling worktree's reset land in between and produce
    false REDs and false GREENs alike (CLAUDE.md, pi-delegation §8)."""
    return _run(QualityCheckSpec(
        name="pgtap",
        area="db",
        operation="test",
        argv=["scripts/with-db-lock.sh", "bash", "-c",
              "supabase db reset && supabase test db"],
        timeout_seconds=1800,
    ), run)


def _changed_paths(run) -> list[str]:
    """Paths this run touched. Uncommitted-only is enough: the chain commits code
    only after this gate goes green."""
    listing = subprocess.run(
        ["bash", "-c", "git diff --name-only HEAD; git ls-files --others --exclude-standard"],
        cwd=run.repo_root, capture_output=True, text=True).stdout
    return [line for line in listing.splitlines() if line]


def _touches_db(run) -> bool:
    """Did this run change anything under supabase/?"""
    return any(path.startswith("supabase/") for path in _changed_paths(run))


# Suffixes and filenames whose change means the JS toolchain has something to say.
_JS_SUFFIXES = (".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".css")
_JS_FILENAMES = ("package.json", "package-lock.json", "tsconfig.json", "eslint.config.js",
                 "vite.config.ts", "vitest.config.ts")


def _touches_js(run) -> bool:
    """Does the JS gate have anything to check? A docs-only or SQL-only slice does
    not, and running typecheck/lint/vitest against it is pure cost — worse, in a
    worktree with no node_modules the tools are absent and their exit 127 used to
    reach the builder as if the DIFF were broken (#493)."""
    paths = _changed_paths(run)
    return any(p.endswith(_JS_SUFFIXES) or p.rsplit("/", 1)[-1] in _JS_FILENAMES
               for p in paths)


class ToolchainUnavailable(RuntimeError):
    """A gate command did not RUN — as opposed to running and finding problems.

    Exit 127 is 'command not found'. Handing that to a builder asks it to repair
    something it cannot see, and it will either invent changes or loop until the
    round budget is gone (#493: three fix rounds burned on a correct diff).
    """


def run_tests(run) -> QualityResult:
    """The deterministic test phase: typecheck + lint always, then the suite,
    then pgTAP when the run touched supabase/. Cheap blocks run first and a
    failure skips the heavy ones — fast feedback rounds; the loop's final
    passing round necessarily ran everything.

    This is what replaces a `tester` agent once the commands are written down.
    An agent rediscovering the runner on every run costs a fortune to learn what
    a subprocess already knows; the repair loop is unchanged, because failures
    still reach the builder through `as_envelope` below.
    """
    checks = []
    if _touches_js(run):
        checks.extend([typecheck(run), lint(run)])
        if all(check.passed for check in checks):
            checks.append(test(run))
    if all(check.passed for check in checks) and _touches_db(run):
        checks.append(pgtap(run))

    # A tool that did not RUN is an environment fault, not a verdict on the diff.
    # Raise instead of returning a failure envelope: the fix loop cannot help, and
    # sending it there burns rounds repairing code that was never broken (#493).
    absent = [c for c in checks if c.returncode == 127]
    if absent:
        raise ToolchainUnavailable(
            "gate command(s) did not run (exit 127 — command not found): "
            + "; ".join(f"{c.name}: `{c.command}`" for c in absent)
            + ". This is an environment fault (commonly: no node_modules in this "
              "worktree), not a problem with the diff. Install the toolchain or "
              "narrow the gate; do not send this to the builder.")

    failures = [f"{check.name}: `{check.command}` exited {check.returncode}\n"
                f"{check.output_tail}".rstrip()
                for check in checks if not check.passed]
    return QualityResult(passed=not failures, checks=checks, failures=failures,
                         artifacts=[check.output_artifact for check in checks])


def as_envelope(result: QualityResult, what: str) -> VerifyOutput:
    """Wrap a deterministic result so an agent can be handed it directly.

    Agents hand each other typed envelopes; code blocks return QualityResult.
    This is the adapter, so a failing lint or test run flows back into the
    builder through exactly the same door an agent's report would — the ADW
    script is the only thing that knows the difference.
    """
    return VerifyOutput(
        status="success" if result.passed else "fail",
        summary=(f"{what}: all {len(result.checks)} check(s) passed" if result.passed
                 else f"{what}: {len(result.failures)} of {len(result.checks)} check(s) failed"),
        artifacts=result.artifacts,
        notes_for_next_agent=("" if result.passed else
                              "Fix every failure below. The output is verbatim from the "
                              "command — trust it over any summary."),
        passed=result.passed,
        failures=result.failures,
    )


def run_quality(run) -> QualityResult:
    """Run every block and collect ALL failures — one pass tells you everything.

    Ordering contract for the caller: a failing block does NOT fail the phase.
    The runner did its job; the CODE is what failed. Hand this result to the
    builder and let the bounded repair loop decide the run's fate.
    """
    blocks: list[Callable] = [
        test,
        lint,
        typecheck,
        build,
    ]
    checks = [block(run) for block in blocks]
    # A failure is the command, its exit code, and what it actually printed —
    # everything a builder needs to repair without opening a log or being told
    # what the error "means" by a parser that guessed.
    failures = [
        f"{check.name}: `{check.command}` exited {check.returncode}\n{check.output_tail}".rstrip()
        for check in checks if not check.passed
    ]
    return QualityResult(
        passed=not failures,
        checks=checks,
        failures=failures,
        artifacts=[check.output_artifact for check in checks],
    )
