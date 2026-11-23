import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const h = vi.hoisted(() => ({ canEdit: true, current: null as string | null | undefined, mutate: vi.fn() }));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => h.canEdit }));
vi.mock('@/src/hooks/useWorkOrderResponsible', () => ({
  useWorkOrderResponsiblePerson: () => ({ data: h.current }),
  useResponsibleCandidates: () => ({ data: [{ id: 'p1', name: 'Eli Engineer' }, { id: 'p2', name: 'Pia Manager' }] }),
  useSetResponsiblePerson: () => ({ mutate: h.mutate, isPending: false, isError: false, error: null }),
}));

import { ResponsiblePersonSection } from './ResponsiblePersonSection';

describe('AC-UW-011 the work order names its responsible person', () => {
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
