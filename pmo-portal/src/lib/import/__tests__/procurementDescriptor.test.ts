import { describe, it, expect, vi, beforeEach } from 'vitest';

const { create } = vi.hoisted(() => ({ create: vi.fn().mockResolvedValue({ id: 'new-id' }) }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { procurement: { create } } }));

import { makeProcurementImportDescriptor } from '../procurementDescriptor';

const projects = [{ id: 'pr-1', name: 'Apollo' }];
const vendors = [{ id: 've-1', name: 'Bolt Supplies' }];

describe('makeProcurementImportDescriptor', () => {
  beforeEach(() => create.mockClear());
  const d = makeProcurementImportDescriptor(projects, vendors, 'user-7');
  const field = (k: string) => d.fields.find((f) => f.key === k)!;

  it('requires title; project/vendor optional but non-empty-no-match fails', () => {
    expect(field('title').validate('')).toMatch(/required/i);
    expect(field('projectId').validate('')).toBeNull();
    expect(field('projectId').validate('Ghost')).toMatch(/not found/i);
    expect(field('vendorId').validate('Bolt Supplies')).toBeNull();
  });

  it('toInput resolves refs and emits only {title,projectId,vendorId} (no org_id, no requester)', () => {
    const input = d.toInput({ title: ' Cables ', projectId: 'Apollo', vendorId: '' });
    expect(input).toEqual({ title: 'Cables', projectId: 'pr-1', vendorId: null });
    expect(input).not.toHaveProperty('org_id');
    expect(input).not.toHaveProperty('requested_by_id');
  });

  it('create injects the current user as requestedById (the spreadsheet cannot supply it)', async () => {
    const input = d.toInput({ title: 'Cables', projectId: 'Apollo', vendorId: 'Bolt Supplies' });
    await d.create(input);
    expect(create).toHaveBeenCalledWith(input, 'user-7');
  });
});
