import { expect, it } from 'vitest';
import { can } from './policy';
import { ALL_ROLES } from './coarseRoles';

const roles = (action: Parameters<typeof can>[0], ctx: Record<string, unknown> = {}) =>
  ALL_ROLES.filter((r) => can(action, 'integration', { realRole: r, ...ctx }));

it('AC-ODC-082 only Admin manages the Odoo connection', () => {
  expect(roles('manage_external_bindings')).toEqual(['Admin']);
});
it('AC-ODC-082 Admin and Finance set values and refresh', () => {
  expect([...roles('setValue')].sort()).toEqual(['Admin', 'Finance']);
});
it('AC-ODC-082 Admin, Executive and Finance see the financial directory', () => {
  expect([...roles('view')].sort()).toEqual(['Admin', 'Executive', 'Finance']);
});
it('AC-ODC-082 view-as is a write fence: no write control while an Admin views as another role', () => {
  const ctx = { record: { viewOnly: true } };
  expect(roles('manage_external_bindings', ctx)).toEqual([]);
  expect(roles('setValue', ctx)).toEqual([]);
});
