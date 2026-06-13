import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { ImportButton } from '../ImportButton';
import type { ImportDescriptor } from '@/src/lib/import';

const may = vi.fn();
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => may }));

interface Co {
  name: string;
  type: string;
}
const descriptor: ImportDescriptor<Co> = {
  entity: 'Companies',
  fields: [],
  toInput: (c) => ({ name: c.name ?? '', type: c.type ?? '' }),
  create: vi.fn(),
};

describe('ImportButton', () => {
  beforeEach(() => may.mockReset());

  it('AC-IMP-006: ImportButton renders for a create-permitted role and renders nothing for a non-writer', () => {
    // create-permitted → button shows
    may.mockReturnValue(true);
    const { unmount } = render(<ImportButton entity="company" descriptor={descriptor} />);
    expect(screen.getByRole('button', { name: /import/i })).toBeInTheDocument();
    expect(may).toHaveBeenCalledWith('create', 'company');
    unmount();

    // non-writer → nothing rendered (hidden, not disabled)
    may.mockReturnValue(false);
    render(<ImportButton entity="company" descriptor={descriptor} />);
    expect(screen.queryByRole('button', { name: /import/i })).not.toBeInTheDocument();
  });

  it('opens the wizard on click and closes it without importing (no onImported call)', async () => {
    const user = userEvent.setup();
    may.mockReturnValue(true);
    const onImported = vi.fn();
    render(<ImportButton entity="company" descriptor={descriptor} onImported={onImported} />);

    await user.click(screen.getByRole('button', { name: /import/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    // Cancel on the upload step closes without a write → onImported NOT called.
    await user.click(screen.getByRole('button', { name: /^cancel$/i }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(onImported).not.toHaveBeenCalled();
  });
});
