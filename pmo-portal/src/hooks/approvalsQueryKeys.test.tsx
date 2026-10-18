import { describe, expect, it } from 'vitest';
import { externalDomainOwnershipKey } from './useExternalDomainOwnership';
import { expenseClaimsAwaitingKey } from './useExpenseClaims';
import { nativeDraftInvoicesKey } from './useRevenue';
import { procurementsKey } from './useProcurements';
import { awaitingApprovalKey } from './useTimesheetApproval';

describe('approval queue query key factories', () => {
  it('AC-FAA-007 preserves each owner cache tuple, including optional scopes', () => {
    expect(procurementsKey('org-1')).toEqual(['procurements', 'org-1']);
    expect(procurementsKey('org-1', true)).toEqual(['procurements', 'org-1', 'with-refs']);
    expect(expenseClaimsAwaitingKey('org-1')).toEqual(['expense-claims-awaiting', 'org-1']);
    expect(awaitingApprovalKey('org-1', 'user-1', 'Project Manager')).toEqual([
      'timesheets-awaiting', 'org-1', 'user-1', 'Project Manager',
    ]);
    expect(nativeDraftInvoicesKey('org-1')).toEqual(['salesInvoices', 'org-1', 'native-drafts']);
    expect(externalDomainOwnershipKey('org-1')).toEqual(['external-domain-ownership', 'org-1']);
  });

  it('AC-FAA-007 keeps absent org, user, and role context explicit in the tuple', () => {
    expect(procurementsKey(undefined)).toEqual(['procurements', undefined]);
    expect(expenseClaimsAwaitingKey(undefined)).toEqual(['expense-claims-awaiting', undefined]);
    expect(awaitingApprovalKey(undefined, undefined, null)).toEqual([
      'timesheets-awaiting', undefined, undefined, null,
    ]);
    expect(nativeDraftInvoicesKey(undefined)).toEqual(['salesInvoices', undefined, 'native-drafts']);
    expect(externalDomainOwnershipKey(undefined)).toEqual(['external-domain-ownership', undefined]);
  });

  it('AC-FAA-007 separates organization, user, and role-specific awaiting queues', () => {
    expect(awaitingApprovalKey('org-1', 'user-1', 'Project Manager')).not.toEqual(
      awaitingApprovalKey('org-1', 'user-2', 'Project Manager'),
    );
    expect(awaitingApprovalKey('org-1', 'user-1', 'Project Manager')).not.toEqual(
      awaitingApprovalKey('org-1', 'user-1', 'Executive'),
    );
    expect(procurementsKey('org-1')).not.toEqual(procurementsKey('org-2'));
    expect(expenseClaimsAwaitingKey('org-1')).not.toEqual(expenseClaimsAwaitingKey('org-2'));
  });
});
