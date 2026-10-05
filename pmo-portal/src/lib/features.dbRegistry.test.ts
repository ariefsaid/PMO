import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FEATURE_KEYS } from './features';

// The DB's org_features CHECK registry and the FE's FEATURE_KEYS must hold the same keys. A key the FE
// declares but the CHECK rejects can never be stored, so no Operator can entitle any org to it —
// exactly how `revenue` shipped (fixed in 0224). The LATEST migration that (re)defines the CHECK wins.
const MIGRATIONS = join(__dirname, '../../../supabase/migrations');

function latestRegistryKeys(): string[] {
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
  let keys: string[] | null = null;
  for (const f of files) {
    const sql = readFileSync(join(MIGRATIONS, f), 'utf8')
      .split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n');
    const m = sql.match(/feature_key\s+in\s*\(([^)]*)\)/i);
    if (m) keys = [...m[1].matchAll(/'([a-z0-9_]+)'/g)].map((x) => x[1]);
  }
  if (!keys) throw new Error('no org_features feature_key CHECK found in supabase/migrations');
  return keys;
}

describe('org_features CHECK registry', () => {
  it('AC-ENT-REV-002 accepts exactly the FE FEATURE_KEYS', () => {
    expect([...latestRegistryKeys()].sort()).toEqual([...FEATURE_KEYS].sort());
  });
});
