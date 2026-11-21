import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

// The shell's `t` with no catalogue loaded: the component's own default text is what renders (as in the other tests).
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, def?: string | Record<string, string>, opts?: Record<string, string>) => {
      const text = typeof def === 'string' ? def : _key;
      const vars = typeof def === 'object' ? def : opts;
      return text.replace(/\{\{(\w+)\}\}/g, (_, name: string) => vars?.[name] ?? '');
    },
  }),
}));

import { LinkedRecordLine } from './LinkedRecordLine';
import type { TaskLinkedRecord } from '@/src/lib/db/tasks';

const none = { procurement_id: null, expense_claim_id: null, material_request_id: null };
const claim = { ...none, expense_claim_id: 'c1' };
const ui = (el: React.ReactElement) => render(<MemoryRouter>{el}</MemoryRouter>);

const readable: TaskLinkedRecord = {
  taskId: 't1', linkType: 'expense_claim', recordId: 'c1', label: 'EXP-0007', status: 'Approved', isEndState: false, readable: true,
};

describe('AC-RLT-014 the linked record on a task', () => {
  it('shows the type, the number as a link to the record, and the live status', () => {
    ui(<LinkedRecordLine task={claim} linked={readable} />);
    expect(screen.getByText('Expense claim')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /EXP-0007/ });
    expect(link).toHaveAttribute('href', '/expenses/c1');
    expect(screen.getByText('Approved')).toBeInTheDocument();
  });

  it('FR-RLT-010 an unreadable record shows only its type and one sentence: no number, no status', () => {
    const hidden: TaskLinkedRecord = { taskId: 't1', linkType: 'expense_claim', recordId: null, label: null, status: null, isEndState: null, readable: false };
    ui(<LinkedRecordLine task={claim} linked={hidden} />);
    expect(screen.getByText(/linked record you cannot view/i)).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByText('Approved')).toBeNull();
  });

  it('a closed task gives the closing reason in words', () => {
    ui(<LinkedRecordLine task={{ ...claim, closed_by_record_type: 'expense_claim', closed_by_record_status: 'Paid' }}
      linked={{ ...readable, status: 'Paid', isEndState: true }} />);
    expect(screen.getByText(/Closed automatically: the expense claim is Paid/)).toBeInTheDocument();
  });

  it('a task closed by a person shows no closing reason', () => {
    ui(<LinkedRecordLine task={{ ...claim, closed_by_record_type: null, closed_by_record_status: null }} linked={readable} />);
    expect(screen.queryByText(/Closed automatically/)).toBeNull();
  });

  it('while the read is in flight it shows the type only, never a guessed status', () => {
    ui(<LinkedRecordLine task={{ ...none, material_request_id: 'm1' }} linked={undefined} />);
    expect(screen.getByText('Material request')).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('an unlinked task renders nothing', () => {
    const { container } = ui(<LinkedRecordLine task={none} linked={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });
});
