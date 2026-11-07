import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const permission = vi.hoisted(() => ({ allowed: [] as string[] }));

vi.mock('@/src/auth/usePermission', () => ({
  usePermission: () => (action: string, entity: string) => permission.allowed.includes(`${action}:${entity}`),
}));

import { useFinanceAccess } from '../useFinanceAccess';

describe('useFinanceAccess (#1459: the finance gate is written once)', () => {
  beforeEach(() => { permission.allowed = []; });

  it('reads the view and act gates off the same permission seam', () => {
    permission.allowed = ['view:finance'];
    expect(renderHook(() => useFinanceAccess()).result.current).toEqual({ canView: true, canAct: false });
  });

  it('grants acting only with the act permission, and denies both without it', () => {
    permission.allowed = ['view:finance', 'act:finance'];
    expect(renderHook(() => useFinanceAccess()).result.current).toEqual({ canView: true, canAct: true });
    permission.allowed = [];
    expect(renderHook(() => useFinanceAccess()).result.current).toEqual({ canView: false, canAct: false });
  });
});
