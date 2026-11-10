import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { SearchMini } from '../TableControls';

/**
 * #2092 (WIG, Forms) — the table search box is a free-text filter, not an identity field: the
 * browser's own history/autofill dropdown must never cover the results the user is searching.
 */
describe('#2092 SearchMini: no browser autofill over the results', () => {
  it('#2092 AC2: the search input turns autocomplete off by default', () => {
    render(<SearchMini aria-label="Search companies" value="" onChange={() => {}} />);
    expect(screen.getByLabelText('Search companies')).toHaveAttribute('autocomplete', 'off');
  });

  it('a caller can still opt in to an explicit autocomplete token', () => {
    render(
      <SearchMini aria-label="Search companies" value="" onChange={() => {}} autoComplete="postal-code" />,
    );
    expect(screen.getByLabelText('Search companies')).toHaveAttribute('autocomplete', 'postal-code');
  });
});
