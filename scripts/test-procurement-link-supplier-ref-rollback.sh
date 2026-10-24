#!/usr/bin/env bash
# Round trip of migration 0380 (supplier check reads the Supplier: reference) inside one pgTAP transaction. Run under
# scripts/with-db-lock.sh after a reset: scripts/with-db-lock.sh bash -c 'supabase db reset && scripts/test-procurement-link-supplier-ref-rollback.sh'
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
test_file=supabase/tests/procurement_link_supplier_ref_rollback.generated.test.sql
cleanup() { rm -f "$test_file"; }
trap cleanup EXIT
python3 - "$test_file" <<'PY'
from pathlib import Path
import sys
out = Path(sys.argv[1])
text = Path('scripts/procurement-link-supplier-ref-rollback.test.sql').read_text()
for marker, source in [
    ('-- @0380_DOWN@', 'supabase/migrations/rollback/0380_procurement_link_supplier_ref_down.sql'),
    ('-- @0380_UP@', 'supabase/migrations/0380_procurement_link_supplier_ref.sql'),
]:
    assert text.count(marker) == 1, marker
    text = text.replace(marker, Path(source).read_text())
out.write_text(text)
PY
supabase test db "$test_file"
