import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AgentContextContext } from '@/src/lib/agent/context/agentContextInternal';
import { EXAMPLE_QUESTIONS } from './emptyState.constants';
import { EmptyState } from './EmptyState';
import { SUGGESTION_CHIPS } from './suggestionChips.constants';

function renderWithEntity(entity?: { type: string; id: string; label: string }, onPick = vi.fn()) {
  return {
    onPick,
    ...render(
      <AgentContextContext.Provider
        value={{
          getContext: () => (entity ? { entity, route: '/test' } : { route: '/test' }),
          setEntity: vi.fn(),
          setSelection: vi.fn(),
        }}
      >
        <EmptyState onPick={onPick} />
      </AgentContextContext.Provider>,
    ),
  };
}

describe('EmptyState route-aware suggestions', () => {
  it('AC-AT2-009 entity route shows route-aware chips that pre-fill on tap', async () => {
    const { onPick } = renderWithEntity({ type: 'project', id: 'p-1', label: 'Alpha' });

    const prompt = SUGGESTION_CHIPS.project[0];
    expect(screen.getByRole('button', { name: prompt })).toBeInTheDocument();
    for (const label of SUGGESTION_CHIPS.project) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }

    fireEvent.click(screen.getByRole('button', { name: prompt }));
    expect(onPick).toHaveBeenCalledWith(prompt);
  });

  it('AC-AT2-009 falls back to generic examples when no entity is present', () => {
    renderWithEntity(undefined);

    expect(screen.getByRole('button', { name: EXAMPLE_QUESTIONS[0] })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: SUGGESTION_CHIPS.project[0] })).not.toBeInTheDocument();
  });

  it('AC-AT2-010 suggestion chip text is static, no model call', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    renderWithEntity({ type: 'company', id: 'c-1', label: 'Acme' });

    for (const label of SUGGESTION_CHIPS.company) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
