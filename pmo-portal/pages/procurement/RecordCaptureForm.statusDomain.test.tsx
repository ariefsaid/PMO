/** Every status a PR/RFQ capture form offers must be in the DB check domain (migration 0035). */
import { describe, it, expect, vi } from 'vitest';
vi.mock('@/src/hooks/useOrgTaxDefault', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, useOrgTaxDefault: () => 'exclusive' };
});

import { render, screen } from '@testing-library/react';
import { ToastProvider } from '@/src/components/ui';
import { RecordCaptureForm } from './RecordCaptureForm';

const DB_DOMAIN = {
  purchase_request: ['Draft', 'Submitted', 'Approved', 'Closed'],
  rfq: ['Draft', 'Issued', 'Closed'],
} as const;

describe('RecordCaptureForm status options match the DB domain', () => {
  it.each(Object.entries(DB_DOMAIN))('%s offers exactly the DB-allowed statuses', (kind, domain) => {
    render(
      <ToastProvider>
        <RecordCaptureForm kind={kind as 'purchase_request' | 'rfq'} onCreate={vi.fn()} onClose={vi.fn()} />
      </ToastProvider>,
    );
    const select = screen.getByTestId(`${kind}-status-select`) as HTMLSelectElement;
    const values = Array.from(select.options).map((o) => o.value);
    expect(values).toEqual([...domain]);
  });
});
