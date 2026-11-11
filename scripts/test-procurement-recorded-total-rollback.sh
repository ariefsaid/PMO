#!/usr/bin/env bash
# Round trip of migration 0371 (recorded-document purchase total) inside one pgTAP transaction. Run under
# scripts/with-db-lock.sh after a reset: scripts/with-db-lock.sh bash -c 'supabase db reset && scripts/test-procurement-recorded-total-rollback.sh'
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
test_file=supabase/tests/procurement_recorded_total_rollback.generated.test.sql
cleanup() { rm -f "$test_file"; }
trap cleanup EXIT
python3 - "$test_file" <<'PY'
from pathlib import Path
import sys
out = Path(sys.argv[1])
text = Path('scripts/procurement-recorded-total-rollback.test.sql').read_text()
for marker, source in [
    ('-- @0371_DOWN@', 'supabase/migrations/rollback/0371_procurement_recorded_document_total_down.sql'),
    ('-- @0371_UP@', 'supabase/migrations/0371_procurement_recorded_document_total.sql'),
]:
    assert text.count(marker) == 1, marker
    text = text.replace(marker, Path(source).read_text())
out.write_text(text)
PY
supabase test db "$test_file"
