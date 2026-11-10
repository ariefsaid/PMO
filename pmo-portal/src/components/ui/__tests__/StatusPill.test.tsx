import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusPill } from '../StatusPill';

const pillFor = (label: string) => screen.getByText(label).parentElement!;

describe('StatusPill reads the shared status map', () => {
  it('record + state supplies the label and the tone', () => {
    render(<StatusPill record="expense" state="Rejected" />);
    const pill = pillFor('Rejected');
    expect(pill.style.color).toBe('hsl(var(--status-lost-text))');
    expect(pill.className).toContain('bg-status-danger-surface');
  });

  it('the same state paints the same on every record type', () => {
    render(<><StatusPill record="expense" state="Paid" /><StatusPill record="procurement" state="Paid" /></>);
    const [aLabel, bLabel] = screen.getAllByText('Paid');
    const a = aLabel.parentElement!;
    const b = bLabel.parentElement!;
    expect(a.className).toBe(b.className);
    expect(a.className).toContain('bg-status-success-surface');
  });

  it('an unknown state shows its stored text in grey, not an error', () => {
    render(<StatusPill record="expense" state="Mystery" />);
    expect(pillFor('Mystery').className).toContain('bg-status-neutral-surface');
  });

  it('children override the words but not the tone', () => {
    render(<StatusPill record="push" state="held">Waiting for finance</StatusPill>);
    expect(pillFor('Waiting for finance').className).toContain('bg-status-warning-surface');
  });

  it('the legacy variant call still works unchanged', () => {
    render(<StatusPill variant="won">Fine</StatusPill>);
    expect(pillFor('Fine').className).toContain('bg-status-success-surface');
  });

  it('overdue is red, like every other exception', () => {
    render(<StatusPill variant="overdue">Late</StatusPill>);
    const pill = pillFor('Late');
    expect(pill.className).toContain('bg-status-danger-surface');
    expect(pill.style.color).toBe('hsl(var(--status-lost-text))');
  });
});
