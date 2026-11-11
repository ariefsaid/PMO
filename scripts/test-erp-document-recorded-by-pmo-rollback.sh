#!/usr/bin/env bash
# Round trip of migration 0378 (ERP document recorded by PMO) inside one pgTAP transaction. Run under
# scripts/with-db-lock.sh after a reset: scripts/with-db-lock.sh bash -c 'supabase db reset && scripts/test-erp-document-recorded-by-pmo-rollback.sh'
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
test_file=supabase/tests/erp_document_recorded_by_pmo_rollback.generated.test.sql
cleanup() { rm -f "$test_file"; }
trap cleanup EXIT
python3 - "$test_file" <<'PY'
from pathlib import Path
import sys
out = Path(sys.argv[1])
text = Path('scripts/erp-document-recorded-by-pmo-rollback.test.sql').read_text()
for marker, source in [
    ('-- @0378_DOWN@', 'supabase/migrations/rollback/0378_erp_document_recorded_by_pmo_down.sql'),
    ('-- @0378_UP@', 'supabase/migrations/0378_erp_document_recorded_by_pmo.sql'),
]:
    assert text.count(marker) == 1, marker
    text = text.replace(marker, Path(source).read_text())
out.write_text(text)
PY
supabase test db "$test_file"
