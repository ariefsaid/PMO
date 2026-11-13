import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const recordedVariants = vi.hoisted(() => [] as string[]);

vi.mock('../Button', async () => {
  const ReactModule = await import('react');
  return {
    Button: ({
      variant = 'primary',
      onClick,
      children,
    }: {
      variant?: string;
      onClick?: React.MouseEventHandler<HTMLButtonElement>;
      children?: React.ReactNode;
    }) => {
      recordedVariants.push(variant);
      return ReactModule.createElement('button', { type: 'button', onClick }, children);
    },
  };
});

import { ListState } from '../ListState';

describe('ListState empty action variant', () => {
  beforeEach(() => {
    recordedVariants.length = 0;
  });

  it('C21: uses the outline button variant for a secondary empty-state action', async () => {
    const onCreate = vi.fn();
    render(
      <ListState
        variant="empty"
        title="No projects yet"
        actionVariant="outline"
        action={{ label: 'Create project', onClick: onCreate }}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Create project' }));
    expect(onCreate).toHaveBeenCalledOnce();
    expect(recordedVariants.at(-1)).toBe('outline');
  });
});
