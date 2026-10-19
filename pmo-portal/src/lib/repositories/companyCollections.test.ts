import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/src/lib/db/companyCollections', () => ({
  listCompanyCustomerRefs: vi.fn(),
  listCompanyCustomerRefsByErpCustomerIds: vi.fn(),
}));

import type { ErpAgingSnapshotRow } from '@/src/lib/db/erpSnapshots';
import * as dal from '@/src/lib/db/companyCollections';
import { companyCollectionsRepository, composeCompanyCollections, customerLinksForVisibleCompanies } from './companyCollections';

const agingRow = (overrides: Partial<ErpAgingSnapshotRow> = {}): ErpAgingSnapshotRow => ({
  party: 'Customer:C-0001',
  partyType: 'Customer',
  currency: 'USD',
  totalOutstanding: 0,
  current: 0,
  bucket0to30: 0,
  bucket31to60: 0,
  bucket61to90: 0,
  bucketOver90: 0,
  rangeLabels: { b_0_30: '0-30 days' },
  reportDate: '2026-10-18',
  ageingBasedOn: 'Due Date',
  asOf: '2026-10-18T00:00:00Z',
  sourceReport: 'Accounts Receivable',
  reportVersion: '1',
  snapshotId: 'snapshot-1',
  ...overrides,
});

beforeEach(() => vi.clearAllMocks());

describe('company collections repository', () => {
  it('delegates each batched read with the exact identity list', async () => {
    const byCompany = [{ companyId: 'company-1', erpCustomerId: 'Customer:C-0001' }];
    const byErpId = [{ companyId: 'company-2', erpCustomerId: 'Customer:C-0002' }];
    vi.mocked(dal.listCompanyCustomerRefs).mockResolvedValue(byCompany);
    vi.mocked(dal.listCompanyCustomerRefsByErpCustomerIds).mockResolvedValue(byErpId);

    await expect(companyCollectionsRepository.listForCompanies(['company-1', 'company-2'])).resolves.toBe(byCompany);
    await expect(companyCollectionsRepository.listForErpCustomerIds(['Customer:C-0002'])).resolves.toBe(byErpId);
    expect(dal.listCompanyCustomerRefs).toHaveBeenCalledWith(['company-1', 'company-2']);
    expect(dal.listCompanyCustomerRefsByErpCustomerIds).toHaveBeenCalledWith(['Customer:C-0002']);
  });

  it('normalizes DAL errors and retains their database code', async () => {
    vi.mocked(dal.listCompanyCustomerRefs).mockRejectedValue({ message: 'read denied', code: '42501' });
    await expect(companyCollectionsRepository.listForCompanies(['company-1'])).rejects.toMatchObject({
      name: 'AppError', message: 'read denied', code: '42501',
    });
  });
});

describe('company collections composition', () => {
  it('joins exact Customer document IDs and keeps every source currency/window row untouched', () => {
    const usd = agingRow({ currency: 'USD', reportDate: '2026-10-18' });
    const cad = agingRow({ currency: 'CAD', reportDate: '2026-10-11', ageingBasedOn: 'Posting Date' });
    const displayNameCollision = agingRow({ party: 'Example Legal Company' });
    const supplierWithSameSuffix = agingRow({ party: 'Supplier:C-0001', partyType: 'Supplier' });

    const result = composeCompanyCollections(
      [usd, cad, displayNameCollision, supplierWithSameSuffix],
      [{ companyId: 'company-1', erpCustomerId: 'Customer:C-0001' }],
      'company-1',
    );

    expect(result.state).toBe('known');
    expect(result.positions).toEqual([usd, cad]);
    expect(result.positions[0]).toBe(usd);
    expect(result.positions[1]).toBe(cad);
  });

  it('keeps a known zero distinct from no matching evidence', () => {
    const zero = agingRow();
    expect(composeCompanyCollections([zero], [{ companyId: 'company-1', erpCustomerId: 'Customer:C-0001' }], 'company-1'))
      .toEqual({ state: 'known', positions: [zero] });
    expect(composeCompanyCollections([], [{ companyId: 'company-1', erpCustomerId: 'Customer:C-0001' }], 'company-1'))
      .toEqual({ state: 'unavailable', positions: [] });
    expect(composeCompanyCollections([zero], [], 'company-1'))
      .toEqual({ state: 'unavailable', positions: [] });
  });

  it('marks a canonical ERP party mapped to multiple companies ambiguous', () => {
    const row = agingRow({ totalOutstanding: 250 });
    expect(composeCompanyCollections(
      [row],
      [
        { companyId: 'company-1', erpCustomerId: 'Customer:C-0001' },
        { companyId: 'company-2', erpCustomerId: 'Customer:C-0001' },
      ],
      'company-1',
    )).toEqual({ state: 'ambiguous', positions: [row] });
  });

  it('does not call duplicate refs for one company ambiguous, or link an exact party also mapped offscreen', () => {
    const duplicateForOneCompany = [
      { companyId: 'company-1', erpCustomerId: 'Customer:C-0001' },
      { companyId: 'company-1', erpCustomerId: 'Customer:C-0001' },
    ];
    const refs = [
      ...duplicateForOneCompany,
      { companyId: 'company-3', erpCustomerId: 'Customer:C-0001' },
      { companyId: 'company-2', erpCustomerId: 'Customer:C-0002' },
    ];
    expect(composeCompanyCollections([agingRow()], duplicateForOneCompany, 'company-1').state).toBe('known');
    expect(composeCompanyCollections([agingRow()], refs, 'company-1').state).toBe('ambiguous');
    expect(customerLinksForVisibleCompanies(refs, ['company-1'])).toEqual(new Map());
  });
});
