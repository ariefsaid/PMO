#!/usr/bin/env bash
# Round trip of migration 0381 (dashboard Actual completeness without an Active budget) inside one pgTAP transaction. Run under
# scripts/with-db-lock.sh after a reset: scripts/with-db-lock.sh bash -c 'supabase db reset && scripts/test-dashboard-unbudgeted-actual-rollback.sh'
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
test_file=supabase/tests/dashboard_unbudgeted_actual_rollback.generated.test.sql
cleanup() { rm -f "$test_file"; }
trap cleanup EXIT
python3 - "$test_file" <<'PY'
from pathlib import Path
import sys
out = Path(sys.argv[1])
text = Path('scripts/dashboard-unbudgeted-actual-rollback.test.sql').read_text()
for marker, source in [
    ('-- @0381_DOWN@', 'supabase/migrations/rollback/0381_dashboard_unbudgeted_actual_down.sql'),
    ('-- @0381_UP@', 'supabase/migrations/0381_dashboard_unbudgeted_actual.sql'),
]:
    assert text.count(marker) == 1, marker
    text = text.replace(marker, Path(source).read_text())
out.write_text(text)
PY
supabase test db "$test_file"
