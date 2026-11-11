import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeBudgetImportIdentity } from './lib/budget-import-identity.mjs';

const input = { projectUuid: 'ABC', project: 'Apollo', category: 'Labor', rawCategory: 'Labor', description: 'Crew', fiscalYear: '2026', amountText: '1,234.50', amount: 1234.5, reference: '' };
test('identity separates source namespaces and encodes normalized facts without delimiter ambiguity', () => {
  const first = encodeBudgetImportIdentity(input);
  assert.equal(first.legacyKey, 'fp:Apollo|Labor|Crew|2026|1,234.50');
  assert.equal(first.v2Key, 'bimp2:["f","abc","Labor","Crew","2026","1234.50"]');
  assert.equal(first.v2Key, encodeBudgetImportIdentity({ ...input, amountText: '1234.5' }).v2Key);
  assert.notEqual(first.v2Key, encodeBudgetImportIdentity({ ...input, reference: first.v2Key }).v2Key);
  assert.notEqual(encodeBudgetImportIdentity({ ...input, description: 'A|B', fiscalYear: 'C' }).v2Key, encodeBudgetImportIdentity({ ...input, description: 'A', fiscalYear: 'B|C' }).v2Key);
  assert.equal(encodeBudgetImportIdentity({ ...input, reference: ' fp:x ' }).legacyKey, 'fp:x');
});
test('rejects unsupported amounts and exposes the exact normalized amount', () => {
  assert.throws(() => encodeBudgetImportIdentity({ ...input, amount: 1.234 }), /amount/i);
  assert.throws(() => encodeBudgetImportIdentity({ ...input, amount: 1e12 }), /amount/i);
  assert.equal(encodeBudgetImportIdentity({ ...input, amount: 0.30000000000000004 }).decimalAmount, '0.30');
});
test('supports escaped Unicode, optional cells, zero and opaque reference namespaces', () => {
  const cells = { ...input, description: '  漢字 "\\|  ', fiscalYear: ' ', amount: 0, amountText: '0', reference: '' };
  const first = encodeBudgetImportIdentity(cells);
  assert.deepEqual(JSON.parse(first.v2Key.slice(6)), ['f', 'abc', 'Labor', '漢字 "\\|', '', '0.00']);
  for (const reference of ['fp:ambiguous', first.v2Key, ' bimp2:["r","x"] ']) {
    const result = encodeBudgetImportIdentity({ ...cells, reference });
    assert.deepEqual(JSON.parse(result.v2Key.slice(6)), ['r', reference.trim()]);
    assert.equal(result.legacyKey, reference.trim());
    assert.equal(result.hasReference, true);
    assert.notEqual(result.v2Key, first.v2Key);
  }
  assert.notEqual(encodeBudgetImportIdentity({ ...cells, reference: 'one' }).v2Key,
    encodeBudgetImportIdentity({ ...cells, reference: 'two' }).v2Key);
});
test('normalizes a loader-accepted floating boundary without binary rounding the identity', () => {
  assert.equal(encodeBudgetImportIdentity({ ...input, amount: 0.79999999 }).decimalAmount, '0.80');
});
