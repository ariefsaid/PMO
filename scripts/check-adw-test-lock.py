#!/usr/bin/env -S uv run
# /// script
# dependencies = ["pydantic", "python-dotenv", "pyyaml", "rich"]
# ///
"""Guard: the ADW test timeout must cover the suite, NOT the wait for the shared test lock (#704).

The ADW `test` check used to run `scripts/with-test-lock.sh bash -c 'npm test'` under one
subprocess timeout, so time queued behind another suite was billed to the run. Two runs on
2026-09-28 (#681, #687) failed their test phase without ever starting the suite.

These checks drive the REAL `quality._run` against a temp lock file — no mocks of the lock:
  * a spec with a lock waits for a busy holder, then runs, and the wait is not timed;
  * the same wait does NOT stop a genuinely slow command from being timed out (exit 124);
  * the lock is released afterwards (timed out or not), so the next suite is not starved;
  * the child is told the lock is held, so a self-wrapping script does not deadlock.

Run: uv run scripts/check-adw-test-lock.py
"""
import fcntl
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "adws"))

from adw_modules import quality  # noqa: E402
from adw_modules.data_types import QualityCheckSpec  # noqa: E402

FAILURES: list[str] = []


def check(name: str, actual, expected) -> None:
    if actual != expected:
        FAILURES.append(f"{name}: expected {expected!r}, got {actual!r}")


def fake_run(repo_root: Path):
    handoff = repo_root / "handoff"
    handoff.mkdir(exist_ok=True)
    return SimpleNamespace(
        adw_id="test", repo_root=repo_root, context_handoff_dir=handoff,
        phases=[SimpleNamespace(seq=1, phase_id="p1")],
        console=SimpleNamespace(note=lambda *_a, **_k: None),
        tracer=SimpleNamespace(event=lambda *_a, **_k: None),
    )


def spec(argv, timeout, lock_path, wait=30):
    return QualityCheckSpec(name="test", area="frontend", operation="build", argv=argv,
                            timeout_seconds=timeout, lock_path=lock_path,
                            lock_wait_seconds=wait)


def hold_lock(path: str, seconds: float) -> subprocess.Popen:
    """Another suite holding the shared lock, exactly as with-test-lock.sh would."""
    holder = subprocess.Popen([
        sys.executable, "-c",
        "import fcntl,sys,time\n"
        "f=open(sys.argv[1],'w'); fcntl.flock(f, fcntl.LOCK_EX)\n"
        "print('held', flush=True); time.sleep(float(sys.argv[2]))",
        path, str(seconds)], stdout=subprocess.PIPE, text=True)
    holder.stdout.readline()          # do not proceed until the lock is really held
    return holder


def lock_is_free(path: str) -> bool:
    with open(path, "a") as f:
        try:
            fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
            return True
        except BlockingIOError:
            return False


with tempfile.TemporaryDirectory() as tmp:
    root = Path(tmp)
    lock = str(root / "test.lock")
    run = fake_run(root)

    # 1. Queue behind a busy holder for LONGER than the run timeout; the run still passes.
    holder = hold_lock(lock, 3)
    started = time.monotonic()
    result = quality._run(spec(["true"], timeout=1, lock_path=lock), run)
    waited = time.monotonic() - started
    holder.wait()
    check("waiting on the lock is not billed to the timeout (exit code)", result.returncode, 0)
    check("it really waited for the holder (mutual exclusion)", waited >= 2, True)

    # 2. The timeout still bites a slow suite, once the lock is held.
    result = quality._run(spec(["sleep", "5"], timeout=1, lock_path=lock), run)
    check("a slow suite still times out", result.returncode, 124)
    check("timeout message survives", "Timed out after 1s" in result.output_tail, True)
    check("the lock is released after a timed-out run", lock_is_free(lock), True)

    # 3. The child is told the lock is held.
    result = quality._run(
        spec(["bash", "-c", "echo held=$PMO_TEST_LOCK_HELD"], timeout=5, lock_path=lock), run)
    check("child sees PMO_TEST_LOCK_HELD=1", "held=1" in result.output_tail, True)
    check("the lock is released after a normal run", lock_is_free(lock), True)

    # 4. A wedged holder must not hang the run forever: give up with EX_TEMPFAIL (75).
    holder = hold_lock(lock, 4)
    result = quality._run(spec(["true"], timeout=5, lock_path=lock, wait=1), run)
    holder.kill()
    holder.wait()
    check("gives up waiting with 75", result.returncode, 75)
    check("says it was the lock", "lock" in result.output_tail, True)

    # 5. The real `test` check declares the shared lock and times the suite on its own.
    captured = []
    real_run = quality._run
    quality._run = lambda s, r: captured.append(s)
    try:
        os.environ["PMO_TEST_LOCK"] = lock
        quality.test(run)
    finally:
        quality._run = real_run
        os.environ.pop("PMO_TEST_LOCK", None)
    check("test check takes the shared test lock", getattr(captured[0], "lock_path", None), lock)
    check("test check no longer shells through with-test-lock.sh",
          "with-test-lock.sh" in " ".join(captured[0].argv), False)

if FAILURES:
    for line in FAILURES:
        print(f"✗ {line}", file=sys.stderr)
    sys.exit(1)
print("check-adw-test-lock: OK")
