import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { SubcontractLinesEditor } from './SubcontractLinesEditor';

const query = vi.hoisted(() => ({ data: [] as { id: string; item_code: string; description: string; rate: number; unit: string }[], isPending: false, isError: false, refetch: vi.fn() }));
vi.mock('@/src/hooks/useProgressBilling', () => ({ useBoqItems: () => query }));
beforeEach(() => { query.data = []; query.isPending = false; query.isError = false; query.refetch.mockClear(); });
const editor = (save = vi.fn()) => <SubcontractLinesEditor projectId="project" currency="USD" initial={[{ boq_item_id: 'a', quantity: 7 }]} onSave={save} onClose={vi.fn()} />;

it('shows loading rather than an empty BoQ while reading', () => {
  query.isPending = true;
  render(editor());
  expect(screen.getByTestId('liststate-loading')).toBeInTheDocument();
  expect(screen.queryByText('This project has no BoQ items yet.')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save lines' })).toBeDisabled();
});
it('retries an unavailable BoQ and preserves existing draft quantities', async () => {
  query.isError = true;
  const save = vi.fn().mockResolvedValue(undefined);
  const { rerender } = render(editor(save));
  expect(screen.queryByText('This project has no BoQ items yet.')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save lines' })).toBeDisabled();
  await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(query.refetch).toHaveBeenCalled();
  query.isError = false;
  query.data = [{ id: 'a', item_code: 'A', description: 'Cable', unit: 'm', rate: 10 }];
  rerender(editor(save));
  expect(screen.getByLabelText('A — Cable (m)')).toHaveValue('7');
  await userEvent.click(screen.getByRole('button', { name: 'Save lines' }));
  expect(save).toHaveBeenCalledWith([{ boqItemId: 'a', quantity: 7, rate: 10, unit: 'm' }]);
});
it('shows an empty BoQ only after a successful empty read', () => {
  render(editor());
  expect(screen.getByText('This project has no BoQ items yet.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
});

it('keeps unsaved quantities when a background draft read fails', async () => {
  query.data = [{ id: 'a', item_code: 'A', description: 'Cable', unit: 'm', rate: 10 }];
  const retry = vi.fn();
  const props = { projectId: 'project', currency: 'USD', initial: [{ boq_item_id: 'a', quantity: 7 }], onSave: vi.fn(), onClose: vi.fn() };
  const { rerender } = render(<SubcontractLinesEditor {...props} />);
  await userEvent.clear(screen.getByLabelText('A — Cable (m)'));
  await userEvent.type(screen.getByLabelText('A — Cable (m)'), '9');
  rerender(<SubcontractLinesEditor {...props} draftRead={{ isPending: false, isError: true, onRetry: retry }} />);
  expect(screen.getByRole('button', { name: 'Save lines' })).toBeDisabled();
  await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(retry).toHaveBeenCalled();
  rerender(<SubcontractLinesEditor {...props} />);
  expect(screen.getByLabelText('A — Cable (m)')).toHaveValue('9');
});
