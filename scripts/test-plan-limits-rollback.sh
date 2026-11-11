#!/usr/bin/env bash
# Round trip of migration 0535 with a manual grant whose note shares the scheduler's prefix.
# Run under scripts/with-db-lock.sh after a reset.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
test_file=supabase/tests/plans_limits_rollback.generated.test.sql
cleanup() { rm -f "$test_file"; }
trap cleanup EXIT
python3 - "$test_file" <<'PY'
from pathlib import Path
import sys

out = Path(sys.argv[1])
text = Path('scripts/plan-limits-rollback.test.sql').read_text()
for marker, source in [
    ('-- @0535_DOWN@', 'supabase/migrations/rollback/0535_plan_limits_down.sql'),
    ('-- @0535_UP@', 'supabase/migrations/0535_plan_limits.sql'),
]:
    assert text.count(marker) == 1, marker
    text = text.replace(marker, Path(source).read_text())
out.write_text(text)
PY
supabase test db "$test_file"
