#!/usr/bin/env python3
"""Real-process regression checks for the flock-and-run lock stamp.

Run with: python3 -m unittest discover -s scripts/tests -v
"""
from __future__ import annotations

import os
import re
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
FLOCK_RUN = REPO_ROOT / "scripts" / "lib" / "flock-run.sh"
STAMP = re.compile(rb"pid=(\d+) started=(\d{2}:\d{2}:\d{2})\n")


def locked_holder(path: Path) -> subprocess.Popen[bytes]:
    """Hold a real flock on a prepared file and announce only after acquiring it."""
    code = (
        "import fcntl,sys\n"
        "with open(sys.argv[1], 'r+b') as lock:\n"
        " fcntl.flock(lock, fcntl.LOCK_EX)\n"
        " print('READY', flush=True)\n"
        " sys.stdin.readline()\n"
    )
    process = subprocess.Popen(
        [sys.executable, "-u", "-c", code, str(path)],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    assert process.stdout is not None
    ready = process.stdout.readline()
    if ready != b"READY\n":
        process.kill()
        _, stderr = process.communicate()
        raise AssertionError(f"lock holder failed to acquire: {ready!r} {stderr!r}")
    return process


def release(process: subprocess.Popen[bytes]) -> None:
    if process.poll() is None and process.stdin is not None and not process.stdin.closed:
        try:
            process.stdin.write(b"release\n")
            process.stdin.flush()
        except BrokenPipeError:
            pass
    try:
        process.communicate(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()
        process.communicate(timeout=5)


def run_locked(
    path: Path,
    *,
    label: str,
    timeout: float,
    child_code: str,
    slots: int | None = None,
) -> subprocess.Popen[bytes]:
    env = os.environ.copy()
    if slots is not None:
        env["FLOCK_SLOTS"] = str(slots)
    return subprocess.Popen(
        [
            str(FLOCK_RUN),
            label,
            str(path),
            str(timeout),
            "TEST_LOCK_HELD",
            "the test lock",
            "--",
            sys.executable,
            "-c",
            child_code,
        ],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=env,
    )


def assert_stamp(test: unittest.TestCase, path: Path, pid: int) -> bytes:
    data = path.read_bytes()
    match = STAMP.fullmatch(data)
    test.assertIsNotNone(match, f"stamp has trailing bytes or invalid format: {data!r}")
    assert match is not None
    test.assertEqual(int(match.group(1)), pid, "stamp must identify the lock-owning parent")
    return data


class FlockRunStampTests(unittest.TestCase):
    def test_blocked_waiter_preserves_stamp_then_replaces_it_without_tail(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            lock = Path(directory) / "lock"
            original = b"previous-holder-stamp " + (b"old-data-" * 80) + b"\n"
            lock.write_bytes(original)
            holder = locked_holder(lock)
            waiter = None
            try:
                waiter = run_locked(
                    lock,
                    label="stamp-test",
                    timeout=0,
                    child_code=(
                        "import os,sys; "
                        "sys.exit(19 if os.environ.get('TEST_LOCK_HELD') == '1' else 97)"
                    ),
                )
                assert waiter.stderr is not None
                waiting = waiter.stderr.readline()
                self.assertIn(b"waiting for the test lock", waiting)
                self.assertIsNone(waiter.poll(), "waiter must still be blocked behind the holder")
                self.assertEqual(lock.read_bytes(), original, "blocked waiter must not mutate stamp")

                release(holder)
                _, stderr = waiter.communicate(timeout=5)
                self.assertEqual(waiter.returncode, 19, stderr.decode(errors="replace"))
                new_stamp = assert_stamp(self, lock, waiter.pid)
                self.assertLess(len(new_stamp), len(original), "fixture must detect a stale tail")
            finally:
                release(holder)
                if waiter is not None:
                    if waiter.poll() is None:
                        waiter.kill()
                    waiter.communicate(timeout=5)

    def test_timed_out_waiter_preserves_stamp_and_returns_tempfail(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            lock = Path(directory) / "lock"
            original = b"holder-stamp " + (b"preserve-this-entire-long-stamp-" * 40) + b"\n"
            lock.write_bytes(original)
            holder = locked_holder(lock)
            waiter = None
            try:
                waiter = run_locked(
                    lock,
                    label="timeout-test",
                    timeout=0.1,
                    child_code="raise SystemExit('timed-out waiter must not run')",
                )
                _, stderr = waiter.communicate(timeout=5)
                self.assertEqual(waiter.returncode, 75, stderr.decode(errors="replace"))
                self.assertEqual(lock.read_bytes(), original, "timeout must leave holder stamp intact")
            finally:
                release(holder)
                if waiter is not None:
                    if waiter.poll() is None:
                        waiter.kill()
                    waiter.communicate(timeout=5)

    def test_released_lock_can_be_reused_by_a_later_operation(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            lock = Path(directory) / "lock"
            lock.write_bytes(b"initial\n")

            first = run_locked(
                lock,
                label="reuse-test-first",
                timeout=2,
                child_code="raise SystemExit(17)",
            )
            _, first_stderr = first.communicate(timeout=5)
            self.assertEqual(first.returncode, 17, first_stderr.decode(errors="replace"))
            assert_stamp(self, lock, first.pid)

            second = run_locked(
                lock,
                label="reuse-test-second",
                timeout=2,
                child_code="raise SystemExit(23)",
            )
            _, second_stderr = second.communicate(timeout=5)
            self.assertEqual(second.returncode, 23, second_stderr.decode(errors="replace"))
            assert_stamp(self, lock, second.pid)

    def test_two_slots_reentrancy_marker_parent_pid_and_child_status(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            lock = Path(directory) / "lock"
            lock.write_bytes(b"initial\n")
            first = run_locked(
                lock,
                label="slot-test-first",
                timeout=2,
                slots=2,
                child_code=(
                    "import os,sys; print('READY', flush=True); sys.stdin.readline(); "
                    "sys.exit(17 if os.environ.get('TEST_LOCK_HELD') == '1' "
                    "and 'FLOCK_SLOTS' not in os.environ else 98)"
                ),
            )
            second = None
            try:
                assert first.stderr is not None and first.stdout is not None
                self.assertIn(b"ACQUIRED", first.stderr.readline())
                self.assertEqual(first.stdout.readline(), b"READY\n")
                assert_stamp(self, lock, first.pid)

                second = run_locked(
                    lock,
                    label="slot-test-second",
                    timeout=2,
                    slots=2,
                    child_code=(
                        "import os,sys; "
                        "sys.exit(23 if os.environ.get('TEST_LOCK_HELD') == '1' "
                        "and 'FLOCK_SLOTS' not in os.environ else 98)"
                    ),
                )
                _, stderr = second.communicate(timeout=5)
                self.assertEqual(second.returncode, 23, stderr.decode(errors="replace"))
                assert_stamp(self, Path(f"{lock}.1"), second.pid)
                self.assertIsNone(first.poll(), "slot one must not release slot zero")

                release(first)
                self.assertEqual(first.returncode, 17)
            finally:
                release(first)
                if second is not None:
                    if second.poll() is None:
                        second.kill()
                    second.communicate(timeout=5)


if __name__ == "__main__":
    unittest.main()
