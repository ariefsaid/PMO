#!/usr/bin/env bash
# Round trip of migrations 0360-0362 (#1319, NFR-PFE-011) inside one pgTAP transaction. Run under
# scripts/with-db-lock.sh after a reset: scripts/with-db-lock.sh bash -c 'supabase db reset && scripts/test-procurement-flexible-rollback.sh'
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
test_file=supabase/tests/procurement_flexible_rollback.generated.test.sql
cleanup() { rm -f "$test_file"; }
trap cleanup EXIT
python3 - "$test_file" <<'PY'
from pathlib import Path
import sys
out = Path(sys.argv[1])
text = Path('scripts/procurement-flexible-rollback.test.sql').read_text()
for marker, source in [
    ('-- @0362_DOWN@', 'supabase/migrations/rollback/0362_procurement_start_anywhere_down.sql'),
    ('-- @0361_DOWN@', 'supabase/migrations/rollback/0361_procurement_erp_linking_down.sql'),
    ('-- @0360_DOWN@', 'supabase/migrations/rollback/0360_procurement_flexible_foundation_down.sql'),
    ('-- @0360_UP@', 'supabase/migrations/0360_procurement_flexible_foundation.sql'),
    ('-- @0361_UP@', 'supabase/migrations/0361_procurement_erp_linking.sql'),
    ('-- @0362_UP@', 'supabase/migrations/0362_procurement_start_anywhere.sql'),
]:
    assert text.count(marker) == 1, marker
    text = text.replace(marker, Path(source).read_text())
out.write_text(text)
PY
supabase test db "$test_file"
