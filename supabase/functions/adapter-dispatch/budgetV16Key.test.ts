import { budgetAccountIdentity, budgetAccountPushKey, budgetRangeIdentity } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/budgetAccountIdentity.ts';
import { encodeFiscalYear } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/fiscalYearEncoding.ts';
import { isOpaqueIdempotencyKey } from './transitionTargetGuard.ts';

Deno.test('v16 account keys are admitted only when their framed identity and epoch are valid', () => {
  const version = '3f1b0c9e-1a2b-4c3d-8e4f-5a6b7c8d9e0f';
  const identity = budgetAccountIdentity(version, 'FY/2026: α', 'Salary: East/α');
  const key = budgetAccountPushKey(identity, '2026-10-15T10:00:00Z');
  const checks: [boolean, string][] = [
    [isOpaqueIdempotencyKey(key), 'valid framed key should pass'],
    [!isOpaqueIdempotencyKey(`${key.slice(0, -1)}x`), 'corrupt epoch should fail'],
    [!isOpaqueIdempotencyKey(key.replace(':a:', ':b:')), 'corrupt identity discriminator should fail'],
    [!isOpaqueIdempotencyKey(`bud16:${version}:a:4:!!!!!!!!:ff:1792058400000`), 'corrupt FY/account tokens should fail'],
    [!isOpaqueIdempotencyKey(`bud16:${version}:a:04:${encodeFiscalYear('2026')}:434f4753:1792058400000`), 'noncanonical length should fail'],
    [isOpaqueIdempotencyKey(`bud:${version}:${encodeFiscalYear('2026')}:1792058400000`), 'legacy per-year key should pass'],
    [isOpaqueIdempotencyKey(version), 'legacy UUID key should pass'],
    [!isOpaqueIdempotencyKey(`bud16:${identity}:1792058400000:trailer`), 'trailing data should fail'],
  ];
  const failed = checks.find(([passed]) => !passed);
  if (failed) throw new Error(failed[1]);
});

Deno.test('AC-010 a 140-character account in a range identity remains valid under the served key guard', () => {
  const version = '3f1b0c9e-1a2b-4c3d-8e4f-5a6b7c8d9e0f';
  const identity = budgetRangeIdentity(version, 'FY/2026:', 'FY2028', 'A'.repeat(140));
  const key = budgetAccountPushKey(identity, '2026-10-15T10:00:00Z');

  if (!isOpaqueIdempotencyKey(key)) throw new Error('a 140-character ERP account range key must pass the shipped guard');
});
