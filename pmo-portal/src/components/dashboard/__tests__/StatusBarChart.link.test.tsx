/**
 * AC-JR-W1-10: Dashboard Procurement-by-Status legend entries link to /procurement?status=
 * Plan: docs/plans/2026-06-15-jtbd-remediation.md W1-T05
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { StatusBarChart } from '../StatusBarChart';

const data = [
  { status: 'Requested' as const, count: 7 },
  { status: 'Draft' as const, count: 2 },
];

const toneFor = () => '#000000';

describe('StatusBarChart hrefFor prop (AC-JR-W1-10)', () => {
  it('AC-JR-W1-10: renders legend entries as Links when hrefFor is provided', () => {
    render(
      <MemoryRouter>
        <StatusBarChart
          data={data}
          toneFor={toneFor}
          label="Procurement by status"
          noun="requests"
          hrefFor={(s) => `/procurement?status=${encodeURIComponent(s)}`}
        />
      </MemoryRouter>,
    );
    // Each legend entry for "Requested" should be a link to /procurement?status=Requested
    const link = screen.getByRole('link', { name: /Requested/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', '/procurement?status=Requested');

    // "Draft" entry should also link
    const draftLink = screen.getByRole('link', { name: /Draft/i });
    expect(draftLink).toBeInTheDocument();
    expect(draftLink).toHaveAttribute('href', '/procurement?status=Draft');
  });

  it('AC-JR-W1-10: legend entries are plain text (no link) when hrefFor is omitted — no behavior change for other callers', () => {
    render(
      <MemoryRouter>
        <StatusBarChart
          data={data}
          toneFor={toneFor}
          label="Procurement by status"
          noun="requests"
        />
      </MemoryRouter>,
    );
    // No links should be rendered when hrefFor is not provided
    expect(screen.queryByRole('link')).toBeNull();
    // The status text should still be present (as plain text)
    expect(screen.getByText('Requested')).toBeInTheDocument();
    expect(screen.getByText('Draft')).toBeInTheDocument();
  });

  it('AC-JR-W1-10: each legend link contains the dot + count (color-not-only is preserved)', () => {
    render(
      <MemoryRouter>
        <StatusBarChart
          data={data}
          toneFor={toneFor}
          label="Procurement by status"
          noun="requests"
          hrefFor={(s) => `/procurement?status=${encodeURIComponent(s)}`}
        />
      </MemoryRouter>,
    );
    const link = screen.getByRole('link', { name: /Requested/i });
    // The dot (aria-hidden) should be inside the link element
    const dot = link.querySelector('[data-testid="legend-dot"]');
    expect(dot).not.toBeNull();
    // The count should appear inside the link
    expect(link.textContent).toContain('7');
  });
});
