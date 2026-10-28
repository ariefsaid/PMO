import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router';
import { useRecordContext } from './useRecordContext';

function RecordContextHarness() {
  const context = useRecordContext('/sales-invoices', 'invoice-1');
  return <button type="button" onClick={context.closeRecord}>Back</button>;
}

describe('useRecordContext', () => {
  it('returns an invoice opened from an embedded Finance list to the exact finance URL', () => {
    const financeUrl = '/finance/receivables?layout=b&todo=send';
    render(
      <MemoryRouter initialEntries={[{
        pathname: '/sales-invoices/invoice-1',
        state: { recordContext: { listPath: financeUrl } },
      }]}>
        <Routes>
          <Route path="/sales-invoices/:invoiceId" element={<RecordContextHarness />} />
          <Route path="/finance/:area" element={<div>Finance returned</div>} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByText('Finance returned')).toBeInTheDocument();
  });
});
