#!/usr/bin/env bash
# AC-PLN-005 reversal round trip for 0534 (feature enforcement): reverses every later migration that
# rewrote the same policy text (0820's ALL-write split, then 0646's initplan wrapping, then 0538's
# procurement overlay) first, asserts the 0534 entitlement conjunct is gone (and 0081's families kept
# theirs), then reapplies 0534, 0538, 0646 and 0820 in order. Transactional — the database is left at
# HEAD. 0820 must bracket the round trip because 0646's shipped up/down text pins the five ALL
# `<t>_write` policy names that 0820 split into `_write_insert`/`_update`/`_delete` (0534 is
# catalog-driven and does not rely on the names); reversing 0820 first restores the pre-0820 catalog
# shape 0646's files were generated against.
# Run under scripts/with-db-lock.sh: scripts/with-db-lock.sh scripts/test-plans-feature-enforcement-rollback.sh
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
test_file=supabase/tests/plans_feature_enforcement_rollback.generated.test.sql
cleanup() { rm -f "$test_file"; }
trap cleanup EXIT
python3 - "$test_file" <<'PY'
from pathlib import Path
import re
import sys
out = Path(sys.argv[1])
text = Path('scripts/plans-feature-enforcement-rollback.test.sql').read_text()

# One transaction owns the whole round trip: the file's own begin;/rollback; is what makes a failure
# leave the database at HEAD (and keeps a red assertion from poisoning the rest of the pgTAP job).
# 0646 and its down are wrapped in begin;/commit; like the rest of that generation, so — same rule as
# scripts/fx-rates-rollback.test.sh — strip bare transaction-boundary statements when inlining.
txn_boundary = re.compile(r'(?im)^\s*(?:begin|commit)\s*;\s*$')

for marker, source in [
    ('-- @0820_DOWN@', 'supabase/migrations/rollback/0820_rls_procurement_core_policy_shape_down.sql'),
    ('-- @0646_DOWN@', 'supabase/migrations/rollback/0646_rls_caller_initplans_down.sql'),
    ('-- @0538_DOWN@', 'supabase/migrations/rollback/0538_procurement_write_policy_enforcement_down.sql'),
    ('-- @0534_DOWN@', 'supabase/migrations/rollback/0534_feature_enforcement_down.sql'),
    ('-- @0534_UP@', 'supabase/migrations/0534_feature_enforcement.sql'),
    ('-- @0538_UP@', 'supabase/migrations/0538_procurement_write_policy_enforcement.sql'),
    ('-- @0646_UP@', 'supabase/migrations/0646_rls_caller_initplans.sql'),
    ('-- @0820_UP@', 'supabase/migrations/0820_rls_procurement_core_policy_shape.sql'),
]:
    if marker not in text:
        raise SystemExit(f'marker missing from harness: {marker}')
    source_text = txn_boundary.sub('-- (transaction boundary stripped: the harness owns the transaction)',
                                   Path(source).read_text())
    text = text.replace(marker, source_text)
out.write_text(text)
PY
supabase test db "$test_file"
