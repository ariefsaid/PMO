import { describe, it, expect } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import React from 'react';
import { ImpersonationProvider, useEffectiveRole } from './impersonation';
import { ImpersonationBanner } from './ImpersonationBanner';
import type { Role } from './AuthContext';

const wrap =
  (realRole: Role | null) =>
  ({ children }: { children: React.ReactNode }) => (
    <ImpersonationProvider realRole={realRole}>{children}</ImpersonationProvider>
  );

describe('<ImpersonationBanner> (ADR-0016)', () => {
  it('ADR-0016: renders nothing when effectiveRole === realRole (the normal case)', () => {
    const { container } = render(<ImpersonationBanner />, { wrapper: wrap('Project Manager') });
    expect(container).toBeEmptyDOMElement();
  });

  it('ADR-0016: renders nothing for a non-Admin (cannot impersonate, so no divergence)', () => {
    const { container } = render(<ImpersonationBanner />, { wrapper: wrap('Finance') });
    expect(container).toBeEmptyDOMElement();
  });

  it('ADR-0016: when an Admin views-as another role, shows the banner naming BOTH roles', () => {
    // Drive the provider to a divergent state via the hook, then render the banner
    // under the same provider instance.
    function Harness() {
      const { viewAs, effectiveRole, realRole } = useEffectiveRole();
      return (
        <div>
          <button onClick={() => viewAs('Engineer')}>view-as</button>
          <span data-testid="eff">{effectiveRole}</span>
          <span data-testid="real">{realRole}</span>
          <ImpersonationBanner />
        </div>
      );
    }
    render(<Harness />, { wrapper: wrap('Admin') });

    // Before view-as: real === effective → no banner.
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    act(() => {
      screen.getByText('view-as').click();
    });

    const banner = screen.getByRole('status');
    expect(banner).toHaveTextContent(/viewing as/i);
    expect(banner).toHaveTextContent(/engineer/i);
    expect(banner).toHaveTextContent(/admin/i);
    // The copy must explain writes run as the real role (no silent mislead).
    expect(banner).toHaveTextContent(/writes run as your real role/i);
    // Verbatim rbac-visibility.md wording, period form (NO em-dash — house rule).
    expect(banner).toHaveTextContent('Viewing as Engineer. Writes run as your real role, Admin.');
    expect(banner.textContent ?? '').not.toContain('—');
  });

  it('ADR-0016: the banner is announced politely (aria-live, role=status — no focus steal)', () => {
    function Harness() {
      const { viewAs } = useEffectiveRole();
      React.useEffect(() => viewAs('Finance'), [viewAs]);
      return <ImpersonationBanner />;
    }
    render(<Harness />, { wrapper: wrap('Admin') });
    const banner = screen.getByRole('status');
    expect(banner).toHaveAttribute('aria-live', 'polite');
  });
});
