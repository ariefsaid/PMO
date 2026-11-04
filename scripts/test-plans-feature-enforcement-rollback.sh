#!/usr/bin/env bash
# AC-PLN-005 reversal round trip for 0534 (feature enforcement): reverses the later 0538 policy overlay
# first, asserts the 0534 entitlement conjunct is gone (and 0081's families kept theirs), then reapplies
# 0534 and 0538 in order. Transactional — the database is left at HEAD.
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
    ('-- @0538_DOWN@', 'supabase/migrations/rollback/0538_procurement_write_policy_enforcement_down.sql'),
    ('-- @0534_DOWN@', 'supabase/migrations/rollback/0534_feature_enforcement_down.sql'),
    ('-- @0534_UP@', 'supabase/migrations/0534_feature_enforcement.sql'),
    ('-- @0538_UP@', 'supabase/migrations/0538_procurement_write_policy_enforcement.sql'),
]:
    source_text = Path(source).read_text()
    if marker not in text:
        raise SystemExit(f'marker missing from harness: {marker}')
    text = text.replace(marker, source_text)
out.write_text(text)
PY
supabase test db "$test_file"
