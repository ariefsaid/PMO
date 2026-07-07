import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Quarantine guard test — ensures quarantined e2e specs carry documented QUARANTINE markers.
 *
 * This test validates that:
 * 1. Each quarantined spec file has a clear `// QUARANTINE:` marker
 * 2. The count of quarantined tests is tracked (adding/removing a skip is deliberate)
 * 3. Each quarantined test has a reason string in the skip/fixme call
 *
 * When a feature is re-enabled, updating/removing the QUARANTINE marker will fail this test,
 * forcing the developer to also un-skip the corresponding tests — preventing silent rot.
 *
 * Current quarantined tests (4 total):
 * - AC-IN-001-incidents-crud.spec.ts: 2 tests (feature flag incidents=false)
 * - AC-INC-001-incident-detail.spec.ts: 1 test (feature flag incidents=false)
 * - AC-IXD-PROC-W5-3-approvals-inbox.spec.ts: 1 test (parallel-worker shared-DB race)
 */
test('quarantine guard: quarantined e2e specs have documented QUARANTINE markers and tracked count', async () => {
  const e2eDir = __dirname;
  const quarantinedSpecs = [
    'AC-IN-001-incidents-crud.spec.ts',
    'AC-INC-001-incident-detail.spec.ts',
    'AC-IXD-PROC-W5-3-approvals-inbox.spec.ts',
  ];

  for (const specFile of quarantinedSpecs) {
    const filePath = join(e2eDir, specFile);
    const content = readFileSync(filePath, 'utf-8');

    // Assert each quarantined spec has a QUARANTINE marker
    expect(content).toMatch(/\/\/\s*QUARANTINE:/i);

    // Assert the QUARANTINE marker includes an "un-skip when" clause
    expect(content).toMatch(/un-skip when/i);
  }

  // Count quarantined tests in each file and assert the total
  // This ensures adding/removing a skip is a deliberate, reviewed change
  const acIn001Content = readFileSync(join(e2eDir, 'AC-IN-001-incidents-crud.spec.ts'), 'utf-8');
  const acInc001Content = readFileSync(join(e2eDir, 'AC-INC-001-incident-detail.spec.ts'), 'utf-8');
  const acIxdContent = readFileSync(join(e2eDir, 'AC-IXD-PROC-W5-3-approvals-inbox.spec.ts'), 'utf-8');

  // Count test.skip calls with QUARANTINE reason strings
  const acIn001Skips = (acIn001Content.match(/test\.skip\(\s*'QUARANTINE:/g) || []).length;
  const acInc001Skips = (acInc001Content.match(/test\.skip\(\s*'QUARANTINE:/g) || []).length;
  const acIxdFixmes = (acIxdContent.match(/test\.fixme\(\s*'QUARANTINE:/g) || []).length;

  // Expected: 2 skips in AC-IN-001, 1 skip in AC-INC-001, 1 fixme in AC-IXD = 4 total
  expect(acIn001Skips).toBe(2);
  expect(acInc001Skips).toBe(1);
  expect(acIxdFixmes).toBe(1);

  const totalQuarantined = acIn001Skips + acInc001Skips + acIxdFixmes;
  expect(totalQuarantined).toBe(4);
});