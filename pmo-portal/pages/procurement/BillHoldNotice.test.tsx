import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.unmock('@/pages/procurement/BillHoldNotice'); // test/setup.ts stubs it for the record-capture suites

const h = vi.hoisted(() => ({ gates: { data: undefined as unknown }, match: { on: false } }));
vi.mock('@/src/hooks/useProcurementGates', () => ({ useProcurementGates: () => h.gates }));
vi.mock('@/src/hooks/useThreeWayMatch', () => ({ useThreeWayMatchOn: () => h.match }));

import { BillHoldNotice } from './BillHoldNotice';

const GATES = { request_before_order: false, approval_before_order: false, receipt_before_invoice: true, approval_before_payment: false };

beforeEach(() => { h.gates = { data: GATES }; h.match = { on: false }; });

describe('JOB-PU23 the bill form says what holds the bill and who releases it', () => {
  it('names the receipt rule while no receipt is recorded, and who changes the rule', () => {
    render(<BillHoldNotice hasReceipt={false} />);
    expect(screen.getByTestId('bill-hold-rule')).toHaveTextContent(/held by a purchase rule/);
    expect(screen.getByTestId('bill-hold-rule')).toHaveTextContent(/An Admin can change the rule/);
  });
  it('says nothing about the rule once a receipt exists', () => {
    render(<BillHoldNotice hasReceipt />);
    expect(screen.queryByTestId('bill-hold-rule')).toBeNull();
    expect(screen.queryByTestId('bill-hold-notice')).toBeNull();
  });
  it('names the three-way match hold and who can approve an exception', () => {
    h.match = { on: true };
    render(<BillHoldNotice hasReceipt />);
    expect(screen.getByTestId('bill-hold-match')).toHaveTextContent(/Admin or Finance user, other than the person who recorded the bill/);
  });
});
