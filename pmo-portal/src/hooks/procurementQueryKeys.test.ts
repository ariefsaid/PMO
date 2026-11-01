import { describe, it, expect, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { invalidateProcurementCase, cachedProcurementProjectId, procurementDetailKey } from './procurementQueryKeys';

describe('invalidateProcurementCase', () => {
  it('refreshes detail, list family and committed/reserved spend of old and new project', () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, 'invalidateQueries');
    invalidateProcurementCase(qc, 'o1', 'c1', ['pOld', 'pNew', 'pNew', null]);
    const keys = spy.mock.calls.map((c) => c[0]?.queryKey);
    expect(keys).toEqual([
      ['procurement', 'o1', 'c1'],
      ['procurements', 'o1'],
      ['project-committed-spend', 'o1', 'pOld'],
      ['project-reserved-spend', 'o1', 'pOld'],
      ['project-committed-spend', 'o1', 'pNew'],
      ['project-reserved-spend', 'o1', 'pNew'],
    ]);
  });

  it('reads the project from the cached detail', () => {
    const qc = new QueryClient();
    qc.setQueryData([...procurementDetailKey('o1', 'c1'), 'u', 'r'], { project_id: 'pX' });
    expect(cachedProcurementProjectId(qc, 'o1', 'c1')).toBe('pX');
    expect(cachedProcurementProjectId(qc, 'o1', 'other')).toBeNull();
  });
});
