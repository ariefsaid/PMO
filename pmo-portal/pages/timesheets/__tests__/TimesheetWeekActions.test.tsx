import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TimesheetWeekActions } from '../TimesheetWeekActions';

const base = {
  mode: 'desktop' as const, dirty: true, editValid: true, canSubmit: true, hasHours: true, hasEntries: true,
  saving: false, submitting: false, deleting: false, isReconciling: false, onSave: vi.fn(), onSubmit: vi.fn(),
};

describe('#design-1115 the week footer says why Submit is off', () => {
  it('names the red hours when a typed value is out of range', () => {
    render(<TimesheetWeekActions {...base} editValid={false} canSubmit={false} />);
    expect(screen.getByText('Fix the hours marked in red to submit')).toBeInTheDocument();
    expect(screen.queryByText('Enter hours to submit')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Submit week' })).toBeDisabled();
  });
  it('asks for hours on an empty week, and says nothing once the week can be submitted', () => {
    const { rerender } = render(<TimesheetWeekActions {...base} canSubmit={false} hasHours={false} />);
    expect(screen.getByText('Enter hours to submit')).toBeInTheDocument();
    rerender(<TimesheetWeekActions {...base} />);
    expect(screen.queryByText('Enter hours to submit')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Submit week' })).toBeEnabled();
  });
  it('#2440 on a phone, the thumb bar names the red hours too (the bad day may be scrolled out of view)', () => {
    render(<TimesheetWeekActions {...base} mode="mobile" editValid={false} canSubmit={false} />);
    expect(screen.getByText('Fix the hours marked in red to submit')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Submit week' })).toBeDisabled();
  });
});
