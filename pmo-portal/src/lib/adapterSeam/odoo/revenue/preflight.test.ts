import { expect, it } from 'vitest';
import { revenuePreflight } from './preflight.ts';

it('AC-OCI-003 refuses links the caller\'s tenant does not own, and an absent customer, before any Odoo call', () => {
  for (const scenario of [
    { caller: 'A', customer: 'B' }, { caller: 'A', project: 'B' }, { caller: 'A', salesInvoice: 'B' }, { caller: 'A', customer: 'nobody' }, { caller: 'A', customer: 'A', salesInvoice: 'nobody' },
  ]) expect(revenuePreflight(scenario), JSON.stringify(scenario)).toEqual({ outcome: 'refused', code: 'cross-org-link-rejected', erpCalls: 0 });
});

it('AC-OCI-003 accepts the caller\'s own links, with or without optional ones', () => {
  expect(revenuePreflight({ caller: 'A', customer: 'A', project: 'A', salesInvoice: 'A' })).toEqual({ outcome: 'accepted', erpCalls: 0 });
  expect(revenuePreflight({ caller: 'B', customer: 'B' })).toEqual({ outcome: 'accepted', erpCalls: 0 });
  expect(revenuePreflight({ caller: 'A' })).toEqual({ outcome: 'accepted', erpCalls: 0 });
});
