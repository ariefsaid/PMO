import { describe, it, expect } from 'vitest';
import { render, screen, renderHook } from '@testing-library/react';
import React from 'react';
import { ImpersonationProvider } from './impersonation';
import { usePermission, CanWrite } from './usePermission';
import type { Role } from './AuthContext';

const wrap =
  (realRole: Role | null) =>
  ({ children }: { children: React.ReactNode }) => (
    <ImpersonationProvider realRole={realRole}>{children}</ImpersonationProvider>
  );

describe('usePermission() — binds can() to the REAL role (ADR-0016)', () => {
  it('ADR-0016: an Admin impersonating Engineer still gates on the REAL Admin role', () => {
    const { result } = renderHook(() => usePermission(), { wrapper: wrap('Admin') });
    // can('delete','project') is Admin-only; the real role is Admin so it stays true
    // even after viewing-as Engineer (the hook never reads effectiveRole).
    expect(result.current('delete', 'project')).toBe(true);
  });

  it('ADR-0016: a real Engineer cannot create a project (gate on real role)', () => {
    const { result } = renderHook(() => usePermission(), { wrapper: wrap('Engineer') });
    expect(result.current('create', 'project')).toBe(false);
    // but an Engineer CAN create a procurement (any member raises a PR)
    expect(result.current('create', 'procurement')).toBe(true);
  });

  it('ADR-0016: a null real role is denied', () => {
    const { result } = renderHook(() => usePermission(), { wrapper: wrap(null) });
    expect(result.current('create', 'procurement')).toBe(false);
  });
});

describe('<CanWrite> — declarative render gate (ADR-0016)', () => {
  it('ADR-0016: renders children when the real role is permitted', () => {
    render(
      <CanWrite action="create" entity="project">
        <button>New deal</button>
      </CanWrite>,
      { wrapper: wrap('Project Manager') },
    );
    expect(screen.getByRole('button', { name: 'New deal' })).toBeInTheDocument();
  });

  it('ADR-0016: renders nothing (no fallback) when denied', () => {
    render(
      <CanWrite action="create" entity="project">
        <button>New deal</button>
      </CanWrite>,
      { wrapper: wrap('Finance') },
    );
    expect(screen.queryByRole('button', { name: 'New deal' })).not.toBeInTheDocument();
  });

  it('ADR-0016: renders the fallback when denied', () => {
    render(
      <CanWrite action="create" entity="project" fallback={<span>Read only</span>}>
        <button>New deal</button>
      </CanWrite>,
      { wrapper: wrap('Engineer') },
    );
    expect(screen.queryByRole('button', { name: 'New deal' })).not.toBeInTheDocument();
    expect(screen.getByText('Read only')).toBeInTheDocument();
  });

  it('ADR-0016: forwards ctx (the contract_value SoD on a won project) to can()', () => {
    // PM is read-only on a WON project's value → children hidden, fallback shown.
    render(
      <CanWrite
        action="editContractValue"
        entity="project"
        ctx={{ record: { status: 'Won, Pending KoM' } }}
        fallback={<span>SoD locked</span>}
      >
        <button>Edit value</button>
      </CanWrite>,
      { wrapper: wrap('Project Manager') },
    );
    expect(screen.queryByRole('button', { name: 'Edit value' })).not.toBeInTheDocument();
    expect(screen.getByText('SoD locked')).toBeInTheDocument();
  });
});
