/**
 * #2082 — a refused save in the ERP company picker / connect-credentials dialog moves focus to a
 * field the dialog really renders (the error summary used to point at an element that is not there).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { ErpCompanyModal } from './ErpCompanyModal';
import { ConnectCredentialsModal } from './ConnectCredentialsModal';

describe('ErpCompanyModal refused activation (#2082)', () => {
  it('focuses the company picker when the activation is refused', async () => {
    const user = userEvent.setup();
    const Harness: React.FC = () => {
      const [error, setError] = React.useState<string | null>(null);
      return (
        <ErpCompanyModal
          companies={[{ name: 'Acme Ltd' }]}
          isCompaniesPending={false}
          isCompaniesError={false}
          onRefetchCompanies={vi.fn()}
          loading={false}
          error={error}
          onSelectionChange={() => setError(null)}
          onSubmit={() => setError('Activation was refused.')}
          onClose={vi.fn()}
        />
      );
    };
    render(<Harness />);
    await user.click(await screen.findByRole('combobox', { name: /company/i }));
    await user.click(await screen.findByRole('option', { name: 'Acme Ltd' }));
    await user.click(screen.getByRole('button', { name: /activate/i }));
    await waitFor(() => expect(screen.getByRole('combobox', { name: /company/i })).toHaveFocus());
  });
});

describe('ConnectCredentialsModal refused connect (#2082)', () => {
  it('focuses the first field the ERPNext form renders (instance URL), not a missing token field', async () => {
    const user = userEvent.setup();
    const Harness: React.FC = () => {
      const [error, setError] = React.useState<string | null>(null);
      return (
        <ConnectCredentialsModal
          tier="erpnext"
          loading={false}
          error={error}
          onClose={vi.fn()}
          onSubmit={async () => setError('The site refused those credentials.')}
        />
      );
    };
    render(<Harness />);
    await user.type(await screen.findByLabelText(/instance url/i), 'https://erp.example.com');
    await user.type(screen.getByLabelText(/api key/i), 'k');
    await user.type(screen.getByLabelText(/api secret/i), 's');
    await user.click(screen.getByLabelText(/api key/i));
    await user.click(screen.getByRole('button', { name: /connect/i }));
    await waitFor(() => expect(screen.getByLabelText(/instance url/i)).toHaveFocus());
  });
});
