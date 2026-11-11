#!/usr/bin/env bash
# Round trip of migration 0373 (queued procurement gate, document currency, committed spend per currency) inside one pgTAP transaction. Run under
# scripts/with-db-lock.sh after a reset: scripts/with-db-lock.sh bash -c 'supabase db reset && scripts/test-procurement-queue-gate-rollback.sh'
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
test_file=supabase/tests/procurement_queue_gate_rollback.generated.test.sql
cleanup() { rm -f "$test_file"; }
trap cleanup EXIT
python3 - "$test_file" <<'PY'
from pathlib import Path
import sys
out = Path(sys.argv[1])
text = Path('scripts/procurement-queue-gate-rollback.test.sql').read_text()
for marker, source in [
    ('-- @0373_DOWN@', 'supabase/migrations/rollback/0373_procurement_queue_gate_and_currency_down.sql'),
    ('-- @0373_UP@', 'supabase/migrations/0373_procurement_queue_gate_and_currency.sql'),
]:
    assert text.count(marker) == 1, marker
    text = text.replace(marker, Path(source).read_text())
out.write_text(text)
PY
supabase test db "$test_file"
