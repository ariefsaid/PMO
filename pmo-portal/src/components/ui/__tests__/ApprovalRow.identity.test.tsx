import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ApprovalRow } from '../ApprovalRow';

 describe('UIP-008: request identity layout', () => {
  it('keeps the full accessible name in a two-line identity ahead of status and secondary metadata', () => {
    const name = 'Cable supply for extended commissioning — northern distribution boards';
    render(<ApprovalRow name={name} identityLayout="request" subtitle="Project Northern · PR-014" status={<span>Requested</span>} disclosure={<button aria-label={`Preview ${name}`}>Preview</button>} />);
    const identity = screen.getByText(name);
    expect(identity.className).toContain('line-clamp-2');
    expect(identity.className).not.toContain('truncate');
    expect(identity.parentElement).toContainElement(screen.getByText('Requested'));
    expect(identity.parentElement?.textContent).toMatch(/Cable supply.*Requested.*Project Northern/);
    expect(screen.getByRole('button', { name: `Preview ${name}` })).toBeVisible();
  });
  it('preserves the default timesheet/invoice shell and actions when no request layout is supplied', () => {
    render(<ApprovalRow name="Reviewer" week="Week of Jun 2" hours={40} status={<span>Submitted</span>}><button>Approve</button></ApprovalRow>);
    const identity = screen.getByText('Reviewer');
    expect(identity.className).toContain('truncate');
    expect(identity.parentElement).not.toContainElement(screen.getByText('Submitted'));
    expect(screen.getByText('40.0')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeVisible();
  });
});
