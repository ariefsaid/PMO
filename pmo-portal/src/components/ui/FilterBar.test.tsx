/**
 * FilterBar — the "Showing x of y" line (#2345, fresh-eyes row 11): the default count text must come
 * from the catalogue (`ui.listPage.showingOf`, en + id), not bypass it with a hard-coded template.
 * A caller-supplied `labels.count` keeps winning — the prop contract is unchanged.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { FilterBar } from './FilterBar';
import { BahasaProvider } from '@/test/bahasa';

const base = {
  searchKey: 'q',
  searchLabel: 'Search',
  filters: [],
  values: {},
  onChange: vi.fn(),
  onClear: vi.fn(),
  shown: 3,
  total: 10,
};

describe('FilterBar count line', () => {
  it('defaults to the catalogue showingOf key (English)', () => {
    render(<FilterBar {...base} />);
    expect(screen.getByText('Showing 3 of 10')).toBeInTheDocument();
  });

  it('renders "Menampilkan 3 dari 10" under id instead of the bypassing fallback (#2345 row 11)', () => {
    render(
      <BahasaProvider locale="id">
        <FilterBar {...base} />
      </BahasaProvider>,
    );
    expect(screen.getByText('Menampilkan 3 dari 10')).toBeInTheDocument();
    expect(screen.queryByText('Showing 3 of 10')).not.toBeInTheDocument();
  });

  it('a caller-supplied labels.count still wins', () => {
    render(<FilterBar {...base} labels={{ count: (shown, total) => `${shown} within ${total}` }} />);
    expect(screen.getByText('3 within 10')).toBeInTheDocument();
  });
});
