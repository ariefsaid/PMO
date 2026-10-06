import { describe, it, expect, vi, beforeEach } from 'vitest';

const { create } = vi.hoisted(() => ({ create: vi.fn().mockResolvedValue({ id: 'new-id' }) }));
vi.mock('@/src/lib/repositories', () => ({
  repositories: { company: { create } },
}));

import { companyImportDescriptor } from '../companyDescriptor';

describe('companyImportDescriptor', () => {
  beforeEach(() => create.mockClear());

  it('AC-NICK-003: import accepts an optional trimmed short name without changing the legal name', async () => {
    const input = companyImportDescriptor.toInput({ name: ' Example Legal Company ', type: ' Client ', short_name: ' Example ' });
    expect(input).toEqual({ name: 'Example Legal Company', type: 'Client', short_name: 'Example' });
    expect(companyImportDescriptor.fields.find((f) => f.key === 'short_name')?.required).toBe(false);
    await companyImportDescriptor.create(input);
    expect(create).toHaveBeenCalledWith(input);
  });

  it('AC-IMP-008: descriptor.toInput emits only {name,type} (no org_id) and trims; create delegates to repositories.company.create', async () => {
    const input = companyImportDescriptor.toInput({ name: '  Acme  ', type: ' Client ' });
    // Only name + type — never org_id (a crafted xlsx cannot carry a tenancy key).
    expect(Object.keys(input).sort()).toEqual(['name', 'type']);
    expect(input).not.toHaveProperty('org_id');
    expect(input.name).toBe('Acme');
    expect(input.type).toBe('Client');

    await companyImportDescriptor.create(input);
    expect(create).toHaveBeenCalledWith(input);
    expect(create.mock.calls[0][0]).not.toHaveProperty('org_id');
  });
});
