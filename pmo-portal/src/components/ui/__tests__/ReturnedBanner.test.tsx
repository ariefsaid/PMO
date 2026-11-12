import { afterEach, describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { resetActiveLocale, setActiveLocale } from '@/src/lib/locale/activeLocale';
import { ReturnedBanner } from '../ReturnedBanner';

afterEach(() => resetActiveLocale());

describe('returned decision banner', () => {
  it('places the joined person and shared date-time above the reason', () => {
    setActiveLocale({ locale: 'en', numberLocale: 'en-US', timezone: 'Asia/Jakarta' });
    render(<ReturnedBanner record="expense" person="Reviewer" at="2026-11-11T10:25:00.000Z" reason="Please attach the receipt." />);

    expect(screen.getByRole('status')).toHaveTextContent('Returned by Reviewer · 11 Nov 2026, 17:25');
    expect(screen.getByRole('status')).toHaveTextContent('Please attach the receipt.');
  });

  it('shows the time without claiming an unavailable person', () => {
    setActiveLocale({ locale: 'en', numberLocale: 'en-US', timezone: 'Asia/Jakarta' });
    render(<ReturnedBanner record="expense" at="2026-11-11T10:25:00.000Z" reason="Please attach the receipt." />);

    expect(screen.getByRole('status')).toHaveTextContent('Returned · 11 Nov 2026, 17:25');
    expect(screen.queryByText('Person unavailable')).not.toBeInTheDocument();
  });

  it('keeps legacy decisions readable without inventing a person or timestamp', () => {
    render(<ReturnedBanner record="expense" reason="Please attach the receipt." />);

    expect(screen.getByRole('status')).toHaveTextContent('Returned');
    expect(screen.queryByText('Person unavailable')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).not.toHaveTextContent('2026');
  });

  it('uses the waiting surface and a filled primary action for returned work', () => {
    render(<ReturnedBanner record="expense" reason="Please attach the receipt." action={{ label: 'Edit and resubmit', onClick: () => {} }} />);

    const banner = screen.getByRole('status');
    expect(banner).toHaveClass('bg-waiting-surface');
    expect(banner).toHaveClass('border-warning/30');
    expect(within(banner).getByText('Returned')).toHaveClass('text-warning-foreground');
    expect(within(banner).getByRole('button', { name: 'Edit and resubmit' })).toHaveClass('bg-primary');
  });

  it('keeps a terminal cash-float top-up labeled Rejected from the shared status map', () => {
    render(<ReturnedBanner record="imprest" reason="More detail needed." />);

    const banner = screen.getByRole('status');
    expect(banner).toHaveTextContent('Rejected');
    expect(banner).not.toHaveTextContent('2026');
    expect(banner).toHaveTextContent('More detail needed.');
    expect(banner).toHaveClass('bg-destructive/[0.07]');
  });
});
