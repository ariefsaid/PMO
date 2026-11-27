import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OpenChecksWarning } from './OpenChecksWarning';
import { SectionMaterialCheck } from './SectionMaterialCheck';

const h = vi.hoisted(() => ({ error: true, retry: vi.fn() }));
vi.mock('@/src/hooks/useWorkOrderChecks', () => ({ useWorkOrderChecks: () => ({ isError: h.error, data: h.error ? undefined : [{ name: 'Check site', status: 'Open' }], refetch: h.retry }) }));
vi.mock('@/src/hooks/useWorkOrderSectionMaterials', () => ({ useSectionMaterialCheck: () => ({ isError: h.error, data: h.error ? undefined : [], refetch: h.retry }) }));
vi.mock('@/src/hooks/useStock', () => ({ useStockItems: () => ({ data: [] }) }));

beforeEach(() => { h.error = true; h.retry.mockReset(); });
describe('work order dependent reads', () => {
  it('retries unavailable issue checks then shows the open check', async () => {
    const view = render(<OpenChecksWarning projectId="p" workOrderId="w" />);
    await userEvent.click(screen.getByRole('button', { name: /retry|try again/i }));
    expect(h.retry).toHaveBeenCalled();
    h.error = false;
    view.rerender(<OpenChecksWarning projectId="p" workOrderId="w" />);
    expect(screen.getByText('Still open: Check site')).toBeInTheDocument();
  });
  it('retries an unavailable material check and preserves successful empty output', async () => {
    const view = render(<SectionMaterialCheck workOrderId="w" sections={[]} />);
    await userEvent.click(screen.getByRole('button', { name: /retry|try again/i }));
    expect(h.retry).toHaveBeenCalled();
    h.error = false;
    view.rerender(<SectionMaterialCheck workOrderId="w" sections={[]} />);
    expect(view.container).toBeEmptyDOMElement();
  });
});
