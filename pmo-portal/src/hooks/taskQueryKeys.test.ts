import { describe, expect, it, vi } from 'vitest';
import type { QueryClient } from '@tanstack/react-query';
import { invalidateTaskProjections } from './taskQueryKeys';

describe('work-order task projections', () => {
  it('invalidates work-order task lists when a project task changes', () => {
    const invalidateQueries = vi.fn();
    invalidateTaskProjections({ invalidateQueries } as unknown as QueryClient, 'org', 'project');
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['tasks', 'org', 'work-order'] });
  });
});
