import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';

vi.mock('@/src/hooks/useExpenseReceipts', () => ({
  useExpenseReceipts: () => ({
    list: { data: [{ id: 'f1', file_path: 'org/c1/f/receipt.pdf', title: null }], isPending: false, isError: false },
    upload: { mutate: vi.fn(), isPending: false },
    archive: { mutate: vi.fn(), isPending: false },
    download: vi.fn(),
    progress: null,
    uploadError: null,
    clearUploadError: vi.fn(),
  }),
}));

import { ExpenseReceiptsCard } from './ExpenseReceiptsCard';

describe('ExpenseReceiptsCard', () => {
  it('AC-EXP-066 every viewer can download; only a writer can attach or remove', () => {
    const { rerender } = render(<ToastProvider><ExpenseReceiptsCard claimId="c1" canWrite={false} /></ToastProvider>);
    expect(screen.getByText('receipt.pdf')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Preview receipt' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download receipt.pdf' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Attach receipt' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Remove receipt.pdf' })).toBeNull();
    rerender(<ToastProvider><ExpenseReceiptsCard claimId="c1" canWrite /></ToastProvider>);
    expect(screen.getByRole('button', { name: 'Attach receipt' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove receipt.pdf' })).toBeInTheDocument();
  });
});
