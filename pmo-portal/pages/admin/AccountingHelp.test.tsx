import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AccountingHelp } from './AccountingHelp';

describe('AccountingHelp: each Accounting setup section explains itself here, once', () => {
  it('AC-WHA-004 / I-8: receipts post to the default account; an unmapped budget category blocks the whole push', () => {
    render(<AccountingHelp />);
    expect(screen.getAllByText(/Receipts without their own account post to the default/)).toHaveLength(1);
    expect(screen.getAllByText(/blocks the whole push/i)).toHaveLength(1);
    expect(screen.getByText(/existing choices are kept/i)).toBeInTheDocument();
  });

  it('UX-081: the standard approval rule is stated once, with the roles', () => {
    render(<AccountingHelp />);
    expect(screen.getByText(/nobody listed, Admin, Executive, Project Manager or Finance can approve/i)).toBeInTheDocument();
  });
});
