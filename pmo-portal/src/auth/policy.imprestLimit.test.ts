import { expect, it } from 'vitest';
import { can } from './policy';

it('PU10 only a named senior or Admin may decide a loaded limit route', () => {
 const route = { route_kind: 'named' as const, action: 'approve' as const, approvers: [{ id: 'named', name: 'Approver', role: 'Finance' }], admin_breakglass: true };
 expect(can('decide', 'imprestFloat', { realRole: 'Finance', currentUserId: 'named', record: { imprestLimitRoute: route } })).toBe(true);
 expect(can('decide', 'imprestFloat', { realRole: 'Finance', currentUserId: 'other', record: { imprestLimitRoute: route } })).toBe(false);
 expect(can('decide', 'imprestFloat', { realRole: 'Admin', record: { imprestLimitRoute: route } })).toBe(true);
 expect(can('decide', 'imprestFloat', { realRole: 'Admin' })).toBe(false);
});
