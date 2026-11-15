import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ErpCompanyModal } from './ErpCompanyModal';

function renderModal() {
  const onClose = vi.fn();
  render(
    <ErpCompanyModal
      companies={[{ name: 'Acme Corp' }]}
      isCompaniesPending={false}
      isCompaniesError={false}
      onRefetchCompanies={vi.fn()}
      loading={false}
      error={null}
      onSelectionChange={vi.fn()}
      onSubmit={vi.fn()}
      onClose={onClose}
    />,
  );
  return { onClose, user: userEvent.setup() };
}

describe('ErpCompanyModal discard prompt', () => {
  it('AC-WIG-2080 Esc before choosing a Company closes without a discard prompt', async () => {
    const { onClose, user } = renderModal();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });
});
