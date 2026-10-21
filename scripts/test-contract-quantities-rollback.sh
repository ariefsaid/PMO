#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
test_file=supabase/tests/contract_quantities_rollback.generated.test.sql
cleanup() { rm -f "$test_file"; }
trap cleanup EXIT
python3 - "$test_file" <<'PY'
from pathlib import Path
import sys
out=Path(sys.argv[1])
text=Path('scripts/contract-quantities-rollback.test.sql').read_text()
for marker, source in [
    ('-- @0337_DOWN@', 'supabase/migrations/rollback/0337_contract_quantities_down.sql'),
    ('-- @0337_UP@', 'supabase/migrations/0337_contract_quantities.sql'),
]:
    text=text.replace(marker, Path(source).read_text())
out.write_text(text)
PY
supabase test db "$test_file"
