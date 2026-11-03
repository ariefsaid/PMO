import { expect, it } from 'vitest';
import { procurementPreflight } from './preflight.ts';
it('refuses foreign links and uncertain cutover before any ERP calls', () => {
  expect(procurementPreflight({ caller: 'A', procurement: 'B' })).toMatchObject({ outcome: 'refused', code: 'cross-org-link-rejected', erpCalls: 0 });
  expect(procurementPreflight({ caller: 'A', invoice: 'nobody' })).toMatchObject({ outcome: 'refused', erpCalls: 0 });
  expect(procurementPreflight({ caller: 'A', activated: false })).toMatchObject({ outcome: 'refused', code: 'config-rejected', erpCalls: 0 });
  expect(procurementPreflight({ caller: 'A', beforeCutover: 'unknown' })).toMatchObject({ outcome: 'refused', erpCalls: 0 });
  expect(procurementPreflight({ caller: 'A', procurement: 'A', activated: true, beforeCutover: false })).toMatchObject({ outcome: 'accepted', erpCalls: 0 });
});
