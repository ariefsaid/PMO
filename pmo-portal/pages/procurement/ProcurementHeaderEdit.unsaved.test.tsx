import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { ToastProvider } from '@/src/components/ui';

vi.mock('@/src/hooks/useFkOptions', () => ({
  useProjectOptions: () => ({ data: [] }),
  useVendorOptions: () => ({ data: [] }),
}));

import { ProcurementHeaderEdit } from './ProcurementHeaderEdit';

function renderEdit() {
  const onClose = vi.fn();
  render(
    <ToastProvider>
      <MemoryRouter initialEntries={['/procurement/p1']}>
        <a href="/projects">Projects</a>
        <ProcurementHeaderEdit title="Welding consumables" projectId={null} projectName={null}
          vendorId={null} vendorName={null} onSave={vi.fn()} onError={vi.fn()} onClose={onClose} />
      </MemoryRouter>
    </ToastProvider>,
  );
  return { onClose };
}

describe('#2080 ProcurementHeaderEdit unsaved edits', () => {
  it('an untouched edit card cancels and navigates without a prompt', async () => {
    const { onClose } = renderEdit();
    await userEvent.click(screen.getByRole('link', { name: 'Projects' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it('a changed title asks before following a link and before Cancel; Keep editing retains it', async () => {
    const { onClose } = renderEdit();
    const title = screen.getByLabelText(/title/i);
    await userEvent.clear(title);
    await userEvent.type(title, 'Renamed');
    await userEvent.click(screen.getByRole('link', { name: 'Projects' }));
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /keep editing/i }));
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: /keep editing/i }));
    expect(screen.getByLabelText(/title/i)).toHaveValue('Renamed');
  });
});
