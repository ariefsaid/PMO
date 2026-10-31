import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as companies from '@/src/lib/db/companies';
import * as contacts from '@/src/lib/db/contacts';
import * as activities from '@/src/lib/db/crmActivities';
import { routeDomainWrite } from '@/src/lib/adapterSeam/ownershipCache';
import { dispatchDomainCommand } from '@/src/lib/adapterSeam/dispatchClient';
import { companyRepository, contactRepository } from './companies';
import { itDelegates } from './__tests__/delegation';

vi.mock('@/src/lib/db/companies');
vi.mock('@/src/lib/db/contacts');
vi.mock('@/src/lib/db/crmActivities');
vi.mock('@/src/lib/adapterSeam/ownershipCache');
vi.mock('@/src/lib/adapterSeam/dispatchClient');

beforeEach(() => {
  vi.mocked(routeDomainWrite).mockReturnValue('pmo');
  vi.mocked(dispatchDomainCommand).mockReset();
});

describe('companyRepository reads and lifecycle', () => {
  itDelegates(companyRepository as never, companies, [
    ['listClients', 'listClientCompanies', []],
    ['list', 'listCompanies', [{ search: 'a' }]],
    ['get', 'getCompany', ['c1']],
    ['setProjectNumberSegment', 'setCompanyProjectNumberSegment', ['c1', 'ABC']],
    ['setTaxDefaults', 'setCompanyTaxDefaults', ['c1', { rate: 11 }]],
    ['archive', 'archiveCompany', ['c1']],
    ['delete', 'deleteCompany', ['c1']],
  ]);
});

describe('companyRepository create/update routing', () => {
  const vendor = { name: 'V', type: 'Vendor' } as never;
  const internal = { name: 'Us', type: 'Internal' } as never;

  it('create writes natively when the companies domain is not externally owned', async () => {
    vi.mocked(companies.createCompany).mockResolvedValue({ id: 'c1' } as never);
    await expect(companyRepository.create(vendor)).resolves.toEqual({ id: 'c1' });
    expect(companies.createCompany).toHaveBeenCalledWith(vendor);
    expect(dispatchDomainCommand).not.toHaveBeenCalled();
  });

  it('create of an Internal company stays native even when companies are externally owned', async () => {
    vi.mocked(routeDomainWrite).mockReturnValue('external');
    vi.mocked(companies.createCompany).mockResolvedValue({ id: 'c2' } as never);
    await companyRepository.create(internal);
    expect(companies.createCompany).toHaveBeenCalledWith(internal);
    expect(dispatchDomainCommand).not.toHaveBeenCalled();
  });

  it('external create of a Client dispatches a customer create and returns the canonical row', async () => {
    vi.mocked(routeDomainWrite).mockReturnValue('external');
    vi.mocked(dispatchDomainCommand).mockResolvedValue({ canonical: { id: 'c3', name: 'C' } } as never);
    await expect(companyRepository.create({ name: 'C', type: 'Client' } as never)).resolves.toEqual({ id: 'c3', name: 'C' });
    expect(dispatchDomainCommand).toHaveBeenCalledWith(
      'companies', 'create', expect.objectContaining({ name: 'C', erp_doc_kind: 'customer' }), { idempotencyKey: expect.any(String) },
    );
    expect(companies.createCompany).not.toHaveBeenCalled();
  });

  it('update writes natively when not externally owned, and for Internal companies', async () => {
    vi.mocked(companies.updateCompany).mockResolvedValue(undefined as never);
    await companyRepository.update('c1', vendor);
    expect(companies.updateCompany).toHaveBeenCalledWith('c1', vendor);
    vi.mocked(routeDomainWrite).mockReturnValue('external');
    await companyRepository.update('c2', internal);
    expect(companies.updateCompany).toHaveBeenLastCalledWith('c2', internal);
    expect(dispatchDomainCommand).not.toHaveBeenCalled();
  });

  it('external update without a short name dispatches an ERP update command', async () => {
    vi.mocked(routeDomainWrite).mockReturnValue('external');
    await companyRepository.update('c1', { name: 'V', type: 'Vendor' } as never);
    expect(dispatchDomainCommand).toHaveBeenCalledWith(
      'companies', 'update', { id: 'c1', name: 'V', type: 'Vendor', erp_doc_kind: 'supplier' }, { idempotencyKey: expect.any(String) },
    );
    expect(companies.updateCompany).not.toHaveBeenCalled();
  });
});

describe('contactRepository', () => {
  itDelegates(contactRepository as never, { ...contacts, ...activities }, [
    ['list', 'listContacts', [{ search: 'a' }]],
    ['listByCompany', 'listContactsByCompany', ['c1']],
    ['get', 'getContact', ['k1']],
    ['update', 'updateContact', ['k1', { name: 'N' }]],
    ['archive', 'archiveContact', ['k1']],
    ['delete', 'deleteContact', ['k1']],
    ['listActivities', 'listActivities', ['k1']],
    ['listActivitiesForContacts', 'listActivitiesForContacts', [['k1', 'k2']]],
    ['createActivity', 'createActivity', [{ contactId: 'k1', note: 'n' }, 'u1']],
    ['updateActivity', 'updateActivity', ['a1', { note: 'm' }]],
    ['deleteActivity', 'deleteActivity', ['a1']],
  ]);
});
