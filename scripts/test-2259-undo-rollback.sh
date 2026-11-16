#!/usr/bin/env bash
# #2259 rollback proof. Run under scripts/with-db-lock.sh against a database at head. Static: 0896's body is 0882's plus only lines marked
# "-- 0896", and the down is 0882's body verbatim. Then a rolled-back transaction runs the down and compares with the 0882 definition.
set -euo pipefail
cd "$(dirname "$0")/.."
test_file="supabase/tests/2259_undo_rollback.generated.test.sql"
trap 'rm -f "$test_file"' EXIT
python3 - "$test_file" <<'PY'
from pathlib import Path
import re, sys
def body(path):
    s = Path(path).read_text()
    st = [m.start() for m in re.finditer(r'create or replace function public\.undo_captured_purchase\(', s)][-1]
    return s[st:s.index('end $$;', st) + len('end $$;')]
prev = body('supabase/migrations/0882_capture_invoice_assignment.sql')
up = body('supabase/migrations/0896_undo_capture_kind_order.sql')
down = body('supabase/migrations/rollback/0896_undo_capture_kind_order_down.sql')
marked = [l for l in up.split('\n') if l.rstrip().endswith('-- 0896')]
if len(marked) != 1 or up.replace(marked[0], marked[0].replace(' order by captured_at, request_id limit 1;  -- 0896', ';')) != prev:
    sys.exit('0896 is not the 0882 body plus its one marked ordering line')
if down != prev: sys.exit('the down does not restore the 0882 body verbatim')
print('ok undo_captured_purchase: 0896 = 0882 with one marked line; down = 0882 body')
ref = prev.replace('public.undo_captured_purchase(', 'public.p0_proof_undo_ref(', 1)
ref += '\nrevoke all on function public.p0_proof_undo_ref(uuid,text,boolean) from public, anon;\ngrant execute on function public.p0_proof_undo_ref(uuid,text,boolean) to authenticated;\n'
dsql = Path('supabase/migrations/rollback/0896_undo_capture_kind_order_down.sql').read_text()
if '$down$' in dsql: sys.exit('down file contains the proof delimiter')
text = Path('scripts/2259-undo-rollback.test.sql').read_text().replace('-- @REF@', ref).replace('@DOWN@', dsql)
# 0903 (#2277) redefines undo_captured_purchase above 0896: its down runs first in the proof's transaction, restoring 0896's body.
text = text.replace('begin;\n', 'begin;\n' + Path('supabase/migrations/rollback/0903_capture_order_family_down.sql').read_text() + '\n', 1)
Path(sys.argv[1]).write_text(text)
PY
supabase test db "$test_file"
