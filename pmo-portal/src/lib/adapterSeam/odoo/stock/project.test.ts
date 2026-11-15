import { describe, expect, it } from 'vitest';
import { bindCall, type OdooCall } from '../client.ts';
import { createFakeOdoo } from '../fakeOdoo.ts';
import { resolveStockProject, type ResolveStockProjectResult } from './project.ts';

function setupFakeResolver() {
  const fake = createFakeOdoo({ key: 'test-key' });

  const rawCall = bindCall({
    baseUrl: 'https://odoo.example.test',
    apiKey: 'test-key',
    database: 'db1',
    companyId: 1,
    fetchImpl: fake.fetch,
  });

  const calls: Array<{ model: string; method: string; body: Record<string, unknown> }> = [];
  const call: OdooCall = async <T>(model: string, method: string, body: Record<string, unknown> = {}): Promise<T> => {
    calls.push({ model, method, body });
    return rawCall<T>(model, method, body);
  };

  return { fake, call, calls };
}

describe('resolveStockProject (AC-OSP-001)', () => {
  it('AC-OSP-001: resolves single active project for bound analytic account', async () => {
    const { fake, call, calls } = setupFakeResolver();
    fake.seed('project.project', [
      { id: 42, name: 'Project Apex', company_id: [1, 'Main Co'], account_id: [101, 'AA Apex'], active: true },
      { id: 99, name: 'Other Project', company_id: [1, 'Main Co'], account_id: [202, 'AA Other'], active: true },
    ]);

    const result = await resolveStockProject(call, 1, 101);

    expect(result).toEqual<ResolveStockProjectResult>({
      ok: true,
      projectId: 42,
    });

    // Reads only: assert zero write/mutation calls
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((c) => c.method === 'search_read' || c.method === 'read')).toBe(true);
    expect(calls.some((c) => ['create', 'write', 'unlink', 'load'].includes(c.method))).toBe(false);
  });

  it('AC-OSP-001: refuses when multiple active projects share the analytic account (project-ambiguous)', async () => {
    const { fake, call } = setupFakeResolver();
    fake.seed('project.project', [
      { id: 42, name: 'Project Alpha', company_id: [1, 'Main Co'], account_id: [101, 'Shared AA'], active: true },
      { id: 43, name: 'Project Beta', company_id: [1, 'Main Co'], account_id: [101, 'Shared AA'], active: true },
    ]);

    const result = await resolveStockProject(call, 1, 101);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('project-ambiguous');
      expect(result.message).toMatch(/multiple active projects.*share/i);
    }
  });

  it('AC-OSP-001: refuses when no project matches the analytic account (project-unlinked)', async () => {
    const { fake, call } = setupFakeResolver();
    fake.seed('project.project', [
      { id: 42, name: 'Project Apex', company_id: [1, 'Main Co'], account_id: [202, 'AA Other'], active: true },
    ]);

    const result = await resolveStockProject(call, 1, 101);

    expect(result).toEqual<ResolveStockProjectResult>({
      ok: false,
      reason: 'project-unlinked',
      message: 'No project found in company 1 for analytic account 101.',
    });
  });

  it('AC-OSP-001: refuses when the only matching project is archived (project-unavailable)', async () => {
    const { fake, call } = setupFakeResolver();
    fake.seed('project.project', [
      { id: 42, name: 'Project Archived', company_id: [1, 'Main Co'], account_id: [101, 'AA Apex'], active: false },
    ]);

    const result = await resolveStockProject(call, 1, 101);

    expect(result).toEqual<ResolveStockProjectResult>({
      ok: false,
      reason: 'project-unavailable',
      message: 'Linked project is archived or inactive in company 1.',
    });
  });

  it('AC-OSP-001: ignores archived projects when one active project exists', async () => {
    const { fake, call } = setupFakeResolver();
    fake.seed('project.project', [
      { id: 42, name: 'Project Active', company_id: [1, 'Main Co'], account_id: [101, 'AA Apex'], active: true },
      { id: 43, name: 'Project Archived', company_id: [1, 'Main Co'], account_id: [101, 'AA Apex'], active: false },
    ]);

    const result = await resolveStockProject(call, 1, 101);

    expect(result).toEqual<ResolveStockProjectResult>({
      ok: true,
      projectId: 42,
    });
  });

  it('AC-OSP-001: scopes project search by company id', async () => {
    const { fake, call } = setupFakeResolver();
    fake.seed('project.project', [
      { id: 42, name: 'Project Co 1', company_id: [1, 'Company 1'], account_id: [101, 'Shared AA'], active: true },
      { id: 43, name: 'Project Co 2', company_id: [2, 'Company 2'], account_id: [101, 'Shared AA'], active: true },
    ]);

    const resCo1 = await resolveStockProject(call, 1, 101);
    expect(resCo1).toEqual<ResolveStockProjectResult>({
      ok: true,
      projectId: 42,
    });

    const resCo2 = await resolveStockProject(call, 2, 101);
    expect(resCo2).toEqual<ResolveStockProjectResult>({
      ok: true,
      projectId: 43,
    });
  });

  it('AC-OSP-001: returns read-failed when Odoo call rejects or throws', async () => {
    const throwingCall: OdooCall = async () => {
      throw new Error('Connection refused by Odoo');
    };

    const result = await resolveStockProject(throwingCall, 1, 101);

    expect(result).toEqual<ResolveStockProjectResult>({
      ok: false,
      reason: 'read-failed',
      message: 'Connection refused by Odoo',
    });
  });

  it('AC-OSP-001: rejects invalid non-integer or non-positive identifiers', async () => {
    const { call } = setupFakeResolver();

    const badCompany = await resolveStockProject(call, 0, 101);
    expect(badCompany.ok).toBe(false);
    if (!badCompany.ok) {
      expect(badCompany.reason).toBe('project-unlinked');
    }

    const badAnalytic = await resolveStockProject(call, 1, -5);
    expect(badAnalytic.ok).toBe(false);
    if (!badAnalytic.ok) {
      expect(badAnalytic.reason).toBe('project-unlinked');
    }
  });
});
