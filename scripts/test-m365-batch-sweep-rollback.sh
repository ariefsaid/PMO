#!/usr/bin/env bash
# Round trip of migration 0375 (SharePoint batch linking and folder-sweep runs) inside one pgTAP transaction. Run under
# scripts/with-db-lock.sh after a reset: scripts/with-db-lock.sh bash -c 'supabase db reset && scripts/test-m365-batch-sweep-rollback.sh'
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
test_file=supabase/tests/m365_batch_sweep_rollback.generated.test.sql
cleanup() { rm -f "$test_file"; }
trap cleanup EXIT
python3 - "$test_file" <<'PY'
from pathlib import Path
import sys
out = Path(sys.argv[1])
text = Path('scripts/m365-batch-sweep-rollback.test.sql').read_text()
for marker, source in [
    ('-- @0375_DOWN@', 'supabase/migrations/rollback/0375_m365_batch_and_sweep_runs_down.sql'),
    ('-- @0375_UP@', 'supabase/migrations/0375_m365_batch_and_sweep_runs.sql'),
]:
    assert text.count(marker) == 1, marker
    text = text.replace(marker, Path(source).read_text())
out.write_text(text)
PY
supabase test db "$test_file"
