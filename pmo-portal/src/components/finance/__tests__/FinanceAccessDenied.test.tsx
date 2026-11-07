import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { FinanceAccessDenied } from '../FinanceAccessDenied';

const renderDenied = (surface: 'area' | 'reports', onBack?: () => void) => render(
  <MemoryRouter>
    <FinanceAccessDenied surface={surface} onBack={onBack} />
  </MemoryRouter>,
);

describe('FinanceAccessDenied (#1459: one gate surface, one access-denied copy)', () => {
  it('names the finance area and who may open it', async () => {
    const onBack = vi.fn();
    renderDenied('area', onBack);
    expect(screen.getByRole('heading', { name: 'Finance' })).toBeInTheDocument();
    expect(screen.getByText('Finance is available to Finance, Executive and Admin roles.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Back to dashboard/i }));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it('keeps the Reports surface’s own heading and copy', () => {
    renderDenied('reports');
    expect(screen.getByRole('heading', { name: "You don't have access to Reports" })).toBeInTheDocument();
    expect(screen.getByText('Finance reports are available to Finance, Executive and Admin roles.')).toBeInTheDocument();
  });
});
