#!/usr/bin/env bash
# AC-PLN-005 reversal round trip for 0534 (feature enforcement): applies the SHIPPED down migration,
# asserts the entitlement conjunct is gone (and 0081's families kept theirs), then re-applies the
# migration and asserts it is back. Transactional — the database is left at HEAD.
# Run under scripts/with-db-lock.sh: scripts/with-db-lock.sh scripts/test-plans-feature-enforcement-rollback.sh
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
test_file=supabase/tests/plans_feature_enforcement_rollback.generated.test.sql
cleanup() { rm -f "$test_file"; }
trap cleanup EXIT
python3 - "$test_file" <<'PY'
from pathlib import Path
import sys
out = Path(sys.argv[1])
text = Path('scripts/plans-feature-enforcement-rollback.test.sql').read_text()
for marker, source in [
    ('-- @0534_DOWN@', 'supabase/migrations/rollback/0534_feature_enforcement_down.sql'),
    ('-- @0534_UP@', 'supabase/migrations/0534_feature_enforcement.sql'),
]:
    source_text = Path(source).read_text()
    if marker not in text:
        raise SystemExit(f'marker missing from harness: {marker}')
    text = text.replace(marker, source_text)
out.write_text(text)
PY
supabase test db "$test_file"
