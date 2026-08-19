#!/usr/bin/env python3
"""Guard: the ADW must diagnose INFRASTRUCTURE failures as infrastructure (#482, #493).

Two failures on 2026-08-19 sent the operator — and the builder — to the wrong place:

  * a terminal `429 Usage limit reached` surfaced as "never produced valid PlanOutput
    JSON: no JSON object found in the response", so the obvious next move looked like
    debugging prompts and schemas rather than waiting for the quota window;
  * `exit 127` (command not found — a docs-only worktree has no node_modules) was fed
    back as a test failure, burning three fix rounds repairing a correct diff.

Both are the same class: report the symptom, hide the cause. Run with no arguments.
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FAILURES: list[str] = []


def check(name: str, actual, expected) -> None:
    if actual != expected:
        FAILURES.append(f"{name}: expected {expected!r}, got {actual!r}")


def load(module_path: str, start_marker: str, end_marker: str) -> dict:
    """Exec just the pure helpers out of a module, so this guard needs none of the
    ADW's runtime dependencies to run."""
    src = (ROOT / module_path).read_text()
    if start_marker not in src or end_marker not in src:
        FAILURES.append(f"{module_path}: markers missing — helpers renamed or removed?")
        return {}
    ns: dict = {"re": re, "subprocess": None}
    exec("import re\n" + src[src.index(start_marker):src.index(end_marker)], ns)
    return ns


# ── #482: a terminal substrate error must not be reported as a parse failure ──────
agents = load("adws/adw_modules/agents.py", "_SUBSTRATE_SIGNS = (", "def _parse_with_retries")
if agents:
    classify, hint = agents["_substrate_failure"], agents["_reset_hint"]
    real_429 = ('429: {"code":"1308","message":"Usage limit reached for 5 hour. '
                'Your limit will reset at 2026-08-19 22:34:44"}')
    check("429 is classified", classify(real_429) is not None, True)
    check("reset time surfaced", "22:34:44" in hint(real_429), True)
    check("401 is classified", classify("401 invalid_api_key") is not None, True)
    # Transport was named in #482 and missed on the first pass; observed live.
    check("fetch failed is classified", classify('{"errorMessage":"fetch failed"}') is not None, True)
    check("529 overloaded is classified", classify("529 Overloaded") is not None, True)
    # Polarity: a real parse problem must KEEP its parse error, or this guard has
    # traded one misdiagnosis for another.
    check("valid output is not a substrate failure",
          classify('{"status":"success","summary":"ok"}'), None)
    check("innocent prose is not a substrate failure",
          classify("Here is my plan; nothing unusual."), None)

# ── #493: the JS gate must not run when the diff has no JS ───────────────────────
quality = load("adws/adw_modules/quality.py", "_JS_SUFFIXES = (", "class ToolchainUnavailable")
if quality:
    suffixes, filenames = quality["_JS_SUFFIXES"], quality["_JS_FILENAMES"]
    js = lambda p: p.endswith(suffixes) or p.rsplit("/", 1)[-1] in filenames
    check("docs-only skips the JS gate", any(map(js, ["docs/a.md", "docs/adr/b.md"])), False)
    check("sql-only skips the JS gate", any(map(js, ["supabase/migrations/0187_x.sql"])), False)
    check("tsx triggers the JS gate", js("pmo-portal/pages/X.tsx"), True)
    check("package.json triggers the JS gate", js("pmo-portal/package.json"), True)

    src = (ROOT / "adws/adw_modules/quality.py").read_text()
    check("exit 127 raises rather than returning a verdict",
          "ToolchainUnavailable(" in src and "c.returncode == 127" in src, True)

# ── #469: the quality Literals must cover every spec quality.py constructs ───────
# A mismatch crashes pydantic BEFORE the gate reports, so the run dies with a
# literal_error instead of a test result. Parse both files rather than importing,
# so this guard needs none of the ADW's runtime dependencies.
dt = (ROOT / "adws/adw_modules/data_types.py").read_text()
ql = (ROOT / "adws/adw_modules/quality.py").read_text()
for field, literal_name in (("area", "QualityArea"), ("operation", "QualityOperation")):
    m = re.search(rf"^{literal_name} = Literal\[([^\]]*)\]", dt, re.M)
    if not m:
        FAILURES.append(f"{literal_name}: not found — renamed?")
        continue
    allowed = set(re.findall(r'"([^"]+)"', m.group(1)))
    used = set(re.findall(rf'{field}="([^"]+)"', ql))
    missing = used - allowed
    check(f"{literal_name} covers every {field} quality.py constructs "
          f"(allowed={sorted(allowed)}, used={sorted(used)})", missing, set())

if FAILURES:
    for line in FAILURES:
        print(f"✗ {line}", file=sys.stderr)
    sys.exit(1)
print("check-adw-diagnosis: OK")
