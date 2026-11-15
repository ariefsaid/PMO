import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

vi.mock('@/src/hooks/useAIComposer', () => ({
  useAIComposer: () => ({ compose: vi.fn(), status: 'idle', error: null }),
}));

import AIComposerModal from './AIComposerModal';

/** #2130: the composer enters like every other modal (scale + fade), and not at all under reduced motion. */
describe('AIComposerModal entrance (#2130)', () => {
  it('the dialog uses the house entrance and opts out under reduced motion', () => {
    render(<AIComposerModal open onClose={vi.fn()} onComposed={vi.fn()} />);
    expect(screen.getByRole('dialog')).toHaveClass('confirm-anim', 'motion-reduce:animate-none');
  });
});
