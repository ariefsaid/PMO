import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const h = vi.hoisted(() => ({ canEdit: true, current: null as string | null | undefined, mutate: vi.fn(), currentError: false, peopleError: false, retry: vi.fn() }));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => h.canEdit }));
vi.mock('@/src/hooks/useWorkOrderResponsible', () => ({
  useWorkOrderResponsiblePerson: () => ({ data: h.currentError ? undefined : h.current, isError: h.currentError, refetch: h.retry }),
  useResponsibleCandidates: () => ({ data: h.peopleError ? undefined : [{ id: 'p1', name: 'Eli Engineer' }, { id: 'p2', name: 'Pia Manager' }], isError: h.peopleError, refetch: h.retry }),
  useSetResponsiblePerson: () => ({ mutate: h.mutate, isPending: false, isError: false, error: null }),
}));

import { ResponsiblePersonSection } from './ResponsiblePersonSection';

describe('AC-UW-011 the work order names its responsible person', () => {
  it.each(['currentError', 'peopleError'] as const)('retries %s without showing an assigned person as not set', async (key) => {
    h.canEdit = false; h.current = 'p2'; h[key] = true;
    try {
      const view = render(<ResponsiblePersonSection workOrderId="w1" />);
      expect(screen.queryByText(/Not set/)).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: /retry|try again/i }));
      expect(h.retry).toHaveBeenCalled();
      h[key] = false;
      view.rerender(<ResponsiblePersonSection workOrderId="w1" />);
      expect(screen.getByText('Pia Manager')).toBeInTheDocument();
    } finally { h[key] = false; }
  });
  beforeEach(() => { h.canEdit = true; h.current = null; h.mutate.mockClear(); });
  it('lets someone who can edit the work order name or clear the site engineer', async () => {
    render(<ResponsiblePersonSection workOrderId="w1" />);
    const field = screen.getByLabelText('Site engineer for this work order');
    expect(field).toHaveValue('');
    await userEvent.selectOptions(field, 'p1');
    expect(h.mutate).toHaveBeenCalledWith('p1');
  });
  it('tells a reader who the person is, or that it is not set and who sets it', () => {
    h.canEdit = false; h.current = 'p2';
    const { rerender } = render(<ResponsiblePersonSection workOrderId="w1" />);
    expect(screen.getByText('Pia Manager')).toBeInTheDocument();
    expect(screen.queryByLabelText('Site engineer for this work order')).not.toBeInTheDocument();
    h.current = null;
    rerender(<ResponsiblePersonSection workOrderId="w1" />);
    expect(screen.getByText('Not set. Ask a project manager to name the site engineer.')).toBeInTheDocument();
  });
  it('renders nothing until the value is read', () => {
    h.current = undefined;
    const { container } = render(<ResponsiblePersonSection workOrderId="w1" />);
    expect(container).toBeEmptyDOMElement();
  });
});
