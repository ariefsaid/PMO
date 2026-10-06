import { expect, it } from 'vitest';
import { agentCan } from '../../../../supabase/functions/agent-chat/agentCan';

it('AC-AIN-010 salesInvoice create is Finance/Admin only', () => {
  expect(agentCan('create', 'salesInvoice', { realRole: 'Finance' })).toBe(true);
  expect(agentCan('create', 'salesInvoice', { realRole: 'Admin' })).toBe(true);
  for (const r of ['Project Manager', 'Executive', 'Engineer']) expect(agentCan('create', 'salesInvoice', { realRole: r })).toBe(false);
  expect(agentCan('create', 'salesInvoice', { realRole: null })).toBe(false);
});
it('the two shipped rules are unchanged; anything else is denied', () => {
  expect(agentCan('create', 'contactActivity', { realRole: 'Project Manager' })).toBe(true);
  expect(agentCan('create', 'contactActivity', { realRole: 'Engineer' })).toBe(false);
  expect(agentCan('edit', 'taskStatus', { realRole: 'Engineer' })).toBe(true);
  expect(agentCan('edit', 'taskStatus', { realRole: 'Finance' })).toBe(false);
  expect(agentCan('transition', 'salesInvoice', { realRole: 'Finance' })).toBe(false);
});
