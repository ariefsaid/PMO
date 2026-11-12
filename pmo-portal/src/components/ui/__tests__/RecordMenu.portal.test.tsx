import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RecordMenu } from '../RecordMenu';
import { RowMenu } from '../RowMenu';

describe('RecordMenu portal placement', () => {
  it('keeps a record action menu inside its enclosing dialog', async () => {
    const { container } = render(
      <div role="dialog" aria-label="Project record">
        <RecordMenu
          ariaLabel="More actions"
          items={[{ key: 'archive', label: 'Archive', onSelect: () => {} }]}
        />
      </div>,
    );
    const dialog = container.querySelector('[role="dialog"]')!;

    await userEvent.click(screen.getByRole('button', { name: 'More actions' }));

    expect(dialog).toContainElement(await screen.findByRole('menu', { name: 'More actions' }));
  });

  it('keeps a row action menu inside its enclosing dialog', async () => {
    const { container } = render(
      <div role="dialog" aria-label="Budget category">
        <RowMenu
          ariaLabel="Category actions"
          items={[{ label: 'Export category', onClick: () => {} }]}
        />
      </div>,
    );
    const dialog = container.querySelector('[role="dialog"]')!;

    await userEvent.click(screen.getByRole('button', { name: 'Category actions' }));

    expect(dialog).toContainElement(await screen.findByRole('menu'));
  });
});
