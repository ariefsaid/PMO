import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRegistryRow } from './provisionRegistryRow.mjs';

test('AC-PROV-006: registry row contains only public-safe fields, never a secret', () => {
  const row = buildRegistryRow({
    slug: 'acme-co', projectRef: 'abcxyz123', apiUrl: 'https://abcxyz123.supabase.co',
    anonKey: 'eyJhbGciOi...public-anon', frontendUrl: 'https://acme-co.pages.dev',
  });
  assert.match(row, /abcxyz123/);
  assert.match(row, /migrations: current/);
  assert.match(row, /seed: none/);
  assert.doesNotMatch(row, /service_role/i);
  assert.doesNotMatch(row, /SUPABASE_PROD_DB_URL/);
});
