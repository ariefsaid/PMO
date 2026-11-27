import { it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '@/src/components/ui';
import type { SectionRollupRow } from '@/src/lib/repositories/workOrderSections';
import { SectionReadinessModal } from './SectionReadinessModal';

const h = vi.hoisted(() => ({ error: true, retry: vi.fn() }));
vi.mock('@/src/hooks/useWorkOrderSections', () => ({
  useSectionReadinessEvents: () => ({ data: h.error ? undefined : [], isError: h.error, refetch: h.retry }),
  useSetSectionReadiness: () => ({ isPending: false, mutateAsync: vi.fn() }),
}));
it('retries unavailable readiness history before showing no changes', async () => {
  const props = { workOrderId: 'w', section: { sectionId: 's', code: 'A' } as SectionRollupRow, canSet: false, names: new Map<string, string>(), onClose: vi.fn() };
  const view = render(<ToastProvider><SectionReadinessModal {...props} /></ToastProvider>);
  expect(screen.queryByText('No changes yet.')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /retry|try again/i }));
  expect(h.retry).toHaveBeenCalled();
  h.error = false;
  view.rerender(<ToastProvider><SectionReadinessModal {...props} /></ToastProvider>);
  expect(screen.getByText('No changes yet.')).toBeInTheDocument();
});
