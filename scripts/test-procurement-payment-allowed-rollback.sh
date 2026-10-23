#!/usr/bin/env bash
# Round trip of migration 0368 (#1319 slice G review) inside one pgTAP transaction. Run under
# scripts/with-db-lock.sh after a reset: scripts/with-db-lock.sh bash -c 'supabase db reset && scripts/test-procurement-payment-allowed-rollback.sh'
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
test_file=supabase/tests/procurement_payment_allowed_rollback.generated.test.sql
cleanup() { rm -f "$test_file"; }
trap cleanup EXIT
python3 - "$test_file" <<'PY'
from pathlib import Path
import sys
out = Path(sys.argv[1])
text = Path('scripts/procurement-payment-allowed-rollback.test.sql').read_text()
for marker, source in [
    ('-- @0368_DOWN@', 'supabase/migrations/rollback/0368_procurement_payment_allowed_down.sql'),
    ('-- @0368_UP@', 'supabase/migrations/0368_procurement_payment_allowed.sql'),
]:
    assert text.count(marker) == 1, marker
    text = text.replace(marker, Path(source).read_text())
out.write_text(text)
PY
supabase test db "$test_file"
