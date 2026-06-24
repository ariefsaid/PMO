import { describe, it, expect, vi, beforeEach } from 'vitest';

const { create } = vi.hoisted(() => ({ create: vi.fn().mockResolvedValue({ id: 'new-id' }) }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { project: { create } } }));

import { makeProjectImportDescriptor } from '../projectDescriptor';

const companies = [{ id: 'co-1', name: 'Acme Corp' }];
const managers = [{ id: 'pm-1', name: 'Jane Manager' }];

describe('makeProjectImportDescriptor', () => {
  beforeEach(() => create.mockClear());
  const d = makeProjectImportDescriptor(companies, managers);
  const field = (k: string) => d.fields.find((f) => f.key === k)!;

  it('constrains status to origination statuses', () => {
    expect(field('status').validate('Leads')).toBeNull();
    expect(field('status').validate('Internal Project')).toBeNull();
    expect(field('status').validate('On-hand')).toMatch(/Leads/);
  });

  it('validates contract_value as a non-negative number, optional', () => {
    expect(field('contract_value').validate('')).toBeNull();
    expect(field('contract_value').validate('1000')).toBeNull();
    expect(field('contract_value').validate('-5')).toMatch(/non-negative/i);
    expect(field('contract_value').validate('abc')).toMatch(/number/i);
  });

  it('optional refs: empty → null, non-empty no-match → error', () => {
    expect(field('client_id').validate('')).toBeNull();
    expect(field('client_id').validate('Ghost')).toMatch(/not found/i);
    expect(field('project_manager_id').validate('Jane Manager')).toBeNull();
  });

  it('toInput resolves refs, defaults contract_value to 0, emits no org_id', () => {
    const input = d.toInput({
      name: ' Apollo ',
      status: 'Leads',
      client_id: 'Acme Corp',
      project_manager_id: '',
      contract_value: '',
      start_date: '',
      end_date: '2026-12-31',
    });
    expect(input).toEqual({
      name: 'Apollo',
      status: 'Leads',
      client_id: 'co-1',
      project_manager_id: null,
      contract_value: 0,
      start_date: null,
      end_date: '2026-12-31',
    });
    expect(input).not.toHaveProperty('org_id');
  });

  it('create delegates to repositories.project.create', async () => {
    const input = d.toInput({ name: 'X', status: 'Leads', client_id: '', project_manager_id: '', contract_value: '', start_date: '', end_date: '' });
    await d.create(input);
    expect(create).toHaveBeenCalledWith(input);
  });
});
