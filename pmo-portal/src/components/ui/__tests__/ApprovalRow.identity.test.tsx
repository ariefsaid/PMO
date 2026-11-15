import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ApprovalRow } from '../ApprovalRow';
import { setActiveLocale, resetActiveLocale } from '@/src/lib/locale/activeLocale';

describe('UIP-008: request identity layout', () => {
  it('keeps the full identity, status, and secondary metadata available', () => {
    const name = 'Cable supply for extended commissioning — northern distribution boards';
    render(<ApprovalRow name={name} identityLayout="request" subtitle="Project Northern · PR-014" status={<span>Requested</span>} disclosure={<button aria-label={`Preview ${name}`}>Preview</button>} />);
    const identity = screen.getByText(name);
    expect(identity).toHaveTextContent(name);
    expect(identity.parentElement).toContainElement(screen.getByText('Requested'));
    expect(identity.parentElement?.textContent).toMatch(/Cable supply.*Requested.*Project Northern/);
    expect(screen.getByRole('button', { name: `Preview ${name}` })).toBeVisible();
  });
  it('preserves the default timesheet/invoice shell and actions when no request layout is supplied', () => {
    render(<ApprovalRow name="Reviewer" week="Week of Jun 2" hours={40} status={<span>Submitted</span>}><button>Approve</button></ApprovalRow>);
    const identity = screen.getByText('Reviewer');
    expect(identity).toHaveTextContent('Reviewer');
    expect(identity.parentElement).not.toContainElement(screen.getByText('Submitted'));
    expect(screen.getByText('40')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeVisible();
  });
  it('#2089: hours render in the viewer locale (id: 7,5), not a toFixed dot', () => {
    setActiveLocale({ locale: 'id', numberLocale: 'id-ID', timezone: 'UTC' });
    try {
      render(<ApprovalRow name="Reviewer" week="Week of Jun 2" hours={7.5} status={<span>Submitted</span>} />);
      expect(screen.getByText('7,5')).toBeVisible();
    } finally {
      resetActiveLocale();
    }
  });
});
