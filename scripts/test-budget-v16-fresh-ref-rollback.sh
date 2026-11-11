#!/usr/bin/env bash
# Migration 0379 (fresh v16 budget ref): the down/up round trip and the one-off repair, each inside one pgTAP
# transaction. Run under scripts/with-db-lock.sh after a reset:
#   scripts/with-db-lock.sh bash -c 'supabase db reset && scripts/test-budget-v16-fresh-ref-rollback.sh'
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
files=(supabase/tests/budget_v16_fresh_ref_rollback.generated.test.sql supabase/tests/budget_v16_fresh_ref_repair.generated.test.sql)
cleanup() { rm -f "${files[@]}"; }
trap cleanup EXIT
python3 - <<'PY'
from pathlib import Path
up = Path('supabase/migrations/0379_budget_v16_fresh_ref.sql').read_text()
down = Path('supabase/migrations/rollback/0379_budget_v16_fresh_ref_down.sql').read_text()
for template, out, markers in [
    ('scripts/budget-v16-fresh-ref-rollback.test.sql', 'supabase/tests/budget_v16_fresh_ref_rollback.generated.test.sql',
     [('-- @0379_DOWN@', down), ('-- @0379_UP@', up)]),
    ('scripts/budget-v16-fresh-ref-repair.test.sql', 'supabase/tests/budget_v16_fresh_ref_repair.generated.test.sql',
     [('-- @0379_UP@', up)]),
]:
    text = Path(template).read_text()
    for marker, source in markers:
        assert text.count(marker) == 1, (template, marker)
        text = text.replace(marker, source)
    Path(out).write_text(text)
PY
supabase test db "${files[@]}"
