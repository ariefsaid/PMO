#!/usr/bin/env bash
# AC-2255 (issue #2255): migration 0867's reversal must actually run. The down script collapses the
# per-organization dispatch cursors to the earliest one per source, must be safe to run twice, and
# the up migration must re-apply cleanly. The harness inlines migration 0867 and its rollback into
# a generated pgTAP file (deleted on exit) and runs it against the current local DB inside ONE
# transaction that rolls back, so the database is left exactly as it found it.
# Run under scripts/with-db-lock.sh.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
test_file=supabase/tests/watermarks_per_org_rollback.generated.test.sql
cleanup() { rm -f "$test_file"; }
trap cleanup EXIT
python3 - "$test_file" <<'PY'
from pathlib import Path
import sys

out = Path(sys.argv[1])
text = Path('scripts/watermarks-per-org-rollback.test.sql').read_text()
for marker, source in [
    ('-- @0867_DOWN@', 'supabase/migrations/rollback/0867_agent_dispatch_watermarks_per_org_down.sql'),
    ('-- @0867_UP@', 'supabase/migrations/0867_agent_dispatch_watermarks_per_org.sql'),
]:
    assert text.count(marker) == 1, marker
    text = text.replace(marker, Path(source).read_text())
out.write_text(text)
PY
supabase test db "$test_file"
