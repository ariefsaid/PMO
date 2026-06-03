import { describe, it, expect } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { ImpersonationProvider, useEffectiveRole } from './impersonation';
import type { Role } from './AuthContext';

const wrap =
  (realRole: Role) =>
  ({ children }: { children: React.ReactNode }) => (
    <ImpersonationProvider realRole={realRole}>{children}</ImpersonationProvider>
  );

describe('impersonation (AC-AUTH-010/011)', () => {
  it('is a no-op for non-Admin', () => {
    const { result } = renderHook(() => useEffectiveRole(), { wrapper: wrap('Finance') });
    expect(result.current.canImpersonate).toBe(false);
    act(() => result.current.viewAs('Engineer'));
    expect(result.current.effectiveRole).toBe('Finance');
  });

  it('overrides displayed role for Admin without changing realRole', () => {
    const { result } = renderHook(() => useEffectiveRole(), { wrapper: wrap('Admin') });
    expect(result.current.canImpersonate).toBe(true);
    act(() => result.current.viewAs('Engineer'));
    expect(result.current.effectiveRole).toBe('Engineer');
    expect(result.current.realRole).toBe('Admin');
  });
});
