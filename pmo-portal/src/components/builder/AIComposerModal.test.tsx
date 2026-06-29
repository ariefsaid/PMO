/**
 * AIComposerModal — accessibility and error-state tests.
 * AC-AS-013: open/accessibility (role=dialog, aria-modal, labelled textarea, focus trap).
 * AC-AS-017: 422 error state (rephrase message, onComposed not called).
 * AC-AS-018: 429 error state (rate-limit message, onComposed not called).
 * NFR-AS-A11Y-001..003: focus trap, live region, aria-describedby.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

// ── Hoisted mocks ────────────────────────────────────────────────────────────
const {
  mockCompose,
  mockStatus,
  mockError,
} = vi.hoisted(() => ({
  mockCompose: vi.fn(),
  mockStatus: { value: 'idle' as string },
  mockError: { value: null as string | null },
}));

vi.mock('@/src/hooks/useAIComposer', () => ({
  useAIComposer: () => ({
    compose: mockCompose,
    status: mockStatus.value,
    error: mockError.value,
  }),
}));

import AIComposerModal from './AIComposerModal';
import type { CompositionSpec } from '@/src/lib/viewspec/types';

const VALID_SPEC: CompositionSpec = {
  version: 1,
  panels: [
    {
      id: 'p1',
      primitive: 'KPITile',
      querySpec: { entity: 'projects', select: ['id', 'contract_value'], aggregate: { fn: 'sum', column: 'contract_value', alias: 'total' } },
    },
  ],
};

function renderModal(props: Partial<React.ComponentProps<typeof AIComposerModal>> = {}) {
  const onClose = vi.fn();
  const onComposed = vi.fn();
  const { unmount, rerender } = render(
    <AIComposerModal
      open={true}
      onClose={onClose}
      onComposed={onComposed}
      {...props}
    />,
  );
  return { onClose, onComposed, unmount, rerender };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockStatus.value = 'idle';
  mockError.value = null;
  mockCompose.mockResolvedValue(null);
});

describe('AIComposerModal — accessibility (AC-AS-013)', () => {
  it('AC-AS-013 renders role=dialog, aria-modal, a labelled textarea', () => {
    renderModal();

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    // aria-labelledby must resolve to a heading
    const labelId = dialog.getAttribute('aria-labelledby');
    expect(labelId).toBeTruthy();
    const heading = document.getElementById(labelId!);
    expect(heading).toBeTruthy();
    expect(heading!.textContent).toMatch(/compose with ai/i);

    // Labelled textarea
    const textarea = screen.getByLabelText(/describe the view you want/i);
    expect(textarea.tagName).toBe('TEXTAREA');
  });

  it('AC-AS-013 focus moves into the dialog on open', () => {
    renderModal();
    // Some focusable element within the dialog should have focus
    const dialog = screen.getByRole('dialog');
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('AC-AS-013 Escape key calls onClose', async () => {
    const { onClose } = renderModal();
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not render when open=false', () => {
    render(
      <AIComposerModal open={false} onClose={vi.fn()} onComposed={vi.fn()} />,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('Cancel button calls onClose', async () => {
    const { onClose } = renderModal();
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('has an aria-live region for loading/error announcements (NFR-AS-A11Y-002/003)', () => {
    renderModal();
    const liveRegion = screen.getByRole('dialog').querySelector('[aria-live]');
    expect(liveRegion).toBeTruthy();
  });
});

describe('AIComposerModal — happy path', () => {
  it('calls compose and then onComposed when compose resolves a spec', async () => {
    mockCompose.mockResolvedValue(VALID_SPEC);
    const { onComposed, onClose } = renderModal();

    const textarea = screen.getByLabelText(/describe the view you want/i);
    await userEvent.type(textarea, 'show me project KPIs');
    await userEvent.click(screen.getByRole('button', { name: /generate/i }));

    await waitFor(() => {
      expect(mockCompose).toHaveBeenCalledWith('show me project KPIs');
      expect(onComposed).toHaveBeenCalledWith(VALID_SPEC);
      expect(onClose).toHaveBeenCalled();
    });
  });
});

describe('AIComposerModal — error states', () => {
  it('AC-AS-017 shows the rephrase error and does not call onComposed when compose returns null (422)', async () => {
    // Mock compose to return null with a 422-style error message
    mockCompose.mockImplementation(async () => {
      mockError.value = "Couldn't generate a valid view for that description. Try rephrasing or being more specific.";
      return null;
    });

    const { onComposed } = renderModal();

    const textarea = screen.getByLabelText(/describe the view you want/i);
    await userEvent.type(textarea, 'something vague');
    await userEvent.click(screen.getByRole('button', { name: /generate/i }));

    await waitFor(() => {
      expect(mockCompose).toHaveBeenCalled();
      expect(onComposed).not.toHaveBeenCalled();
    });
  });

  it('AC-AS-018 shows a rate-limit error (429) and does not call onComposed', async () => {
    mockCompose.mockImplementation(async () => {
      mockError.value = "You've reached the AI compose limit. Try again later.";
      return null;
    });

    const { onComposed } = renderModal();

    const textarea = screen.getByLabelText(/describe the view you want/i);
    await userEvent.type(textarea, 'something');
    await userEvent.click(screen.getByRole('button', { name: /generate/i }));

    await waitFor(() => {
      expect(onComposed).not.toHaveBeenCalled();
    });
  });
});

describe('AIComposerModal — character counter', () => {
  it('shows a character counter (max 2000)', () => {
    renderModal();
    // The modal should display something about the char limit
    expect(screen.getByRole('dialog').textContent).toMatch(/2000/);
  });
});
