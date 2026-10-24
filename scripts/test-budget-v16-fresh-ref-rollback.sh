#!/usr/bin/env bash
# Round trip of migration 0379 (fresh v16 budget ref) inside one pgTAP transaction. Run under
# scripts/with-db-lock.sh after a reset: scripts/with-db-lock.sh bash -c 'supabase db reset && scripts/test-budget-v16-fresh-ref-rollback.sh'
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
test_file=supabase/tests/budget_v16_fresh_ref_rollback.generated.test.sql
cleanup() { rm -f "$test_file"; }
trap cleanup EXIT
python3 - "$test_file" <<'PY'
from pathlib import Path
import sys
out = Path(sys.argv[1])
text = Path('scripts/budget-v16-fresh-ref-rollback.test.sql').read_text()
for marker, source in [
    ('-- @0379_DOWN@', 'supabase/migrations/rollback/0379_budget_v16_fresh_ref_down.sql'),
    ('-- @0379_UP@', 'supabase/migrations/0379_budget_v16_fresh_ref.sql'),
]:
    assert text.count(marker) == 1, marker
    text = text.replace(marker, Path(source).read_text())
out.write_text(text)
PY
supabase test db "$test_file"
