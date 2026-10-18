import { describe, it, expect } from 'vitest';
import { fireEvent, render, screen, renderHook } from '@testing-library/react';
import React from 'react';
import { ImpersonationProvider, useEffectiveRole, type DemoEligibility } from './impersonation';
import { usePermission, CanWrite } from './usePermission';
import type { Role } from './AuthContext';

const wrap =
  (realRole: Role | null) =>
  ({ children }: { children: React.ReactNode }) => (
    <ImpersonationProvider realRole={realRole}>{children}</ImpersonationProvider>
  );

const STATEMENT_ROLE_CASES: Array<[Role | null, boolean, boolean]> = [
  ['Admin', true, true],
  ['Executive', true, true],
  ['Project Manager', false, true],
  ['Finance', true, true],
  ['Engineer', false, true],
  [null, false, false],
];

function StatementPermissionProbe() {
  const { realRole, effectiveRole, viewAs } = useEffectiveRole();
  const may = usePermission();

  return (
    <>
      <p data-testid="statement-real-role">{realRole ?? 'null'}</p>
      <p data-testid="statement-effective-role">{effectiveRole ?? 'null'}</p>
      <p data-testid="statement-company-view">{String(may('view', 'financialStatements'))}</p>
      <p data-testid="statement-project-view">{String(may('view', 'projectProfitLoss'))}</p>
      <button type="button" onClick={() => viewAs('Engineer')}>View as Engineer</button>
      <button type="button" onClick={() => viewAs('Admin')}>View as Admin</button>
    </>
  );
}

function StatementPermissionPanel({
  realRole,
  demoEligibility = 'eligible',
}: {
  realRole: Role | null;
  demoEligibility?: DemoEligibility;
}) {
  return (
    <ImpersonationProvider realRole={realRole} demoEligibility={demoEligibility}>
      <StatementPermissionProbe />
    </ImpersonationProvider>
  );
}

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

  it.each(STATEMENT_ROLE_CASES)(
    'AC-009 supporting: real role %s gets the statement view eligibility matrix',
    (realRole, mayViewCompany, mayViewProject) => {
      render(<StatementPermissionPanel realRole={realRole} />);
      expect(screen.getByTestId('statement-real-role')).toHaveTextContent(realRole ?? 'null');
      expect(screen.getByTestId('statement-effective-role')).toHaveTextContent(realRole ?? 'null');
      expect(screen.getByTestId('statement-company-view')).toHaveTextContent(String(mayViewCompany));
      expect(screen.getByTestId('statement-project-view')).toHaveTextContent(String(mayViewProject));
    },
  );

  it('AC-009 supporting: an eligible Admin keeps statement views while actually viewing as Engineer', () => {
    render(<StatementPermissionPanel realRole="Admin" demoEligibility="eligible" />);
    fireEvent.click(screen.getByRole('button', { name: 'View as Engineer' }));

    expect(screen.getByTestId('statement-real-role')).toHaveTextContent('Admin');
    expect(screen.getByTestId('statement-effective-role')).toHaveTextContent('Engineer');
    expect(screen.getByTestId('statement-company-view')).toHaveTextContent('true');
    expect(screen.getByTestId('statement-project-view')).toHaveTextContent('true');
  });

  it.each(['Engineer', 'Project Manager'] as const)(
    'AC-009 supporting: non-Admin %s cannot view as Admin or company statements',
    (realRole) => {
      render(<StatementPermissionPanel realRole={realRole} demoEligibility="eligible" />);
      fireEvent.click(screen.getByRole('button', { name: 'View as Admin' }));

      expect(screen.getByTestId('statement-real-role')).toHaveTextContent(realRole);
      expect(screen.getByTestId('statement-effective-role')).toHaveTextContent(realRole);
      expect(screen.getByTestId('statement-company-view')).toHaveTextContent('false');
      expect(screen.getByTestId('statement-project-view')).toHaveTextContent('true');
    },
  );

  it('AC-009 supporting: statement permissions track synchronous Admin→Engineer→null provider changes', () => {
    const { rerender } = render(<StatementPermissionPanel realRole="Admin" />);
    expect(screen.getByTestId('statement-company-view')).toHaveTextContent('true');
    expect(screen.getByTestId('statement-project-view')).toHaveTextContent('true');

    rerender(<StatementPermissionPanel realRole="Engineer" />);
    expect(screen.getByTestId('statement-real-role')).toHaveTextContent('Engineer');
    expect(screen.getByTestId('statement-effective-role')).toHaveTextContent('Engineer');
    expect(screen.getByTestId('statement-company-view')).toHaveTextContent('false');
    expect(screen.getByTestId('statement-project-view')).toHaveTextContent('true');

    rerender(<StatementPermissionPanel realRole={null} />);
    expect(screen.getByTestId('statement-real-role')).toHaveTextContent('null');
    expect(screen.getByTestId('statement-effective-role')).toHaveTextContent('null');
    expect(screen.getByTestId('statement-company-view')).toHaveTextContent('false');
    expect(screen.getByTestId('statement-project-view')).toHaveTextContent('false');
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
