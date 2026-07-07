/**
 * SectionHeader — the shared section-header molecule (ops-admin Discover fix, `docs/decisions.md`
 * "section-header molecule"). Anatomy: an `<h2>` title + an optional trailing action slot, one
 * consistent flex row. Used by Administration's Users/Credits/Usage/Features sections so all four
 * render identical structure — previously Usage/Features had a bare parent-rendered `<h2>` while
 * Credits rolled its own internal header + action row.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SectionHeader } from '../SectionHeader';

describe('SectionHeader', () => {
  it('renders the title as an <h2>', () => {
    render(<SectionHeader title="Usage" />);
    expect(screen.getByRole('heading', { level: 2, name: 'Usage' })).toBeInTheDocument();
  });

  it('renders no trailing action when none is given', () => {
    const { container } = render(<SectionHeader title="Features" />);
    expect(container.querySelectorAll('button')).toHaveLength(0);
  });

  it('renders a trailing action slot when given', () => {
    render(<SectionHeader title="Credits" action={<button type="button">Grant credits</button>} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Credits' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Grant credits' })).toBeInTheDocument();
  });
});
