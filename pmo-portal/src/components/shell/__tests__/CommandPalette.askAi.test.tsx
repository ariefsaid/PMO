import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { CommandPalette } from '../CommandPalette';

vi.mock('@/src/hooks/useReferenceRecordSearch', () => ({
  useReferenceRecordSearch: () => ({ data: undefined, isFetching: false, isError: false, refetch: vi.fn() }),
}));

describe('CommandPalette Ask AI fallback', () => {
  it('AC-AT2-006 zero-result query renders Ask AI only when flag on, passing the draft as typed', async () => {
    const onAskAi = vi.fn();
    const onClose = vi.fn();
    render(
      <MemoryRouter>
        <CommandPalette open items={[]} onClose={onClose} onAskAi={onAskAi} />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Over budget PRJ cases' } });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));
    });

    const option = await screen.findByRole('option', { name: /ask ai/i });
    expect(option).toHaveTextContent('Over budget PRJ cases');
    expect(screen.queryByText(/no results for/i)).not.toBeInTheDocument();

    fireEvent.click(option);
    expect(onAskAi).toHaveBeenCalledWith('Over budget PRJ cases');
    expect(onClose).toHaveBeenCalled();
  });

  it('AC-AT2-006 flag-off keeps the normal no-results state', async () => {
    render(
      <MemoryRouter>
        <CommandPalette open items={[]} onClose={vi.fn()} />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'over budget cases' } });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));
    });

    expect(await screen.findByText(/no results for/i)).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /ask ai/i })).not.toBeInTheDocument();
  });

  it('AC-AT2-006 Enter on the zero-result Ask AI entry opens the assistant with the draft', async () => {
    const onAskAi = vi.fn();
    const onClose = vi.fn();
    render(
      <MemoryRouter>
        <CommandPalette open items={[]} onClose={onClose} onAskAi={onAskAi} />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'over budget cases' } });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));
    });

    const option = await screen.findByRole('option', { name: /ask ai/i });
    // the Ask AI row is the only option, so the palette selects it for Enter
    expect(option).toHaveAttribute('aria-selected', 'true');
    await act(async () => {
      fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Enter' });
    });
    expect(onAskAi).toHaveBeenCalledWith('over budget cases');
    expect(onClose).toHaveBeenCalled();
  });
});
