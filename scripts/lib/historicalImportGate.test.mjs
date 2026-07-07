import assert from 'node:assert/strict';
import test from 'node:test';
import { parseArgs, requireOrgConfirmed } from './historicalImportGate.mjs';

test('AC-HIST-001: parseArgs without --org-id yields orgId: null (caller refuses to proceed)', () => {
  const args = parseArgs(['--file', 'x.csv']);
  assert.equal(args.orgId, null);
});

test('AC-HIST-001: parseArgs reads --org-id, --batch-id, --mark-provenance, --strict-refs', () => {
  const args = parseArgs(['--org-id', 'org-1', '--batch-id', 'batch-9', '--mark-provenance', '--strict-refs']);
  assert.equal(args.orgId, 'org-1');
  assert.equal(args.batchId, 'batch-9');
  assert.equal(args.markProvenance, true);
  assert.equal(args.strictRefs, true);
  assert.equal(args.dryRun, false);
});

test('B5: parseArgs reads --dry-run', () => {
  const args = parseArgs(['--org-id', 'org-1', '--dry-run']);
  assert.equal(args.dryRun, true);
});

test('HIST-E002: requireOrgConfirmed returns ok:false when the typed name does not match the resolved org name', () => {
  const result = requireOrgConfirmed({ resolvedOrgName: 'Acme Client Co', typedConfirmation: 'Acme Cliant Co' });
  assert.equal(result.ok, false);
});

test('requireOrgConfirmed returns ok:true when the typed name matches exactly', () => {
  const result = requireOrgConfirmed({ resolvedOrgName: 'Acme Client Co', typedConfirmation: 'Acme Client Co' });
  assert.equal(result.ok, true);
});
