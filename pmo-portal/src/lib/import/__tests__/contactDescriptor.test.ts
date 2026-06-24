import { describe, it, expect, vi, beforeEach } from 'vitest';

const { create } = vi.hoisted(() => ({ create: vi.fn().mockResolvedValue({ id: 'new-id' }) }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { contact: { create } } }));

import { makeContactImportDescriptor } from '../contactDescriptor';

const companies = [{ id: 'co-1', name: 'Acme Corp' }];

describe('makeContactImportDescriptor', () => {
  beforeEach(() => create.mockClear());
  const d = makeContactImportDescriptor(companies);

  it('requires full_name and a resolvable Company', () => {
    const name = d.fields.find((f) => f.key === 'full_name')!;
    const company = d.fields.find((f) => f.key === 'company_id')!;
    expect(name.validate('')).toMatch(/required/i);
    expect(company.validate('')).toMatch(/required/i);
    expect(company.validate('Nope')).toMatch(/not found/i);
    expect(company.validate('acme corp')).toBeNull();
  });

  it('toInput resolves Company name → company_id and emits no org_id; optionals → null', () => {
    const input = d.toInput({ full_name: ' Jane ', company_id: 'Acme Corp', title: '', email: ' j@x.io ', phone: '', notes: '' });
    expect(input).toEqual({
      company_id: 'co-1',
      full_name: 'Jane',
      title: null,
      email: 'j@x.io',
      phone: null,
      notes: null,
    });
    expect(input).not.toHaveProperty('org_id');
  });

  it('create delegates to repositories.contact.create', async () => {
    const input = d.toInput({ full_name: 'Jane', company_id: 'Acme Corp', title: '', email: '', phone: '', notes: '' });
    await d.create(input);
    expect(create).toHaveBeenCalledWith(input);
  });
});
