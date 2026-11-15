import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProcurementGroupedView } from './ProcurementGroupedView';

describe('ProcurementGroupedView', () => {
  it('a11y(#2086): the grouped wrapper is a named group, not a role-less labelled div', () => {
    render(<ProcurementGroupedView rows={[]} role="Finance" reasonText={undefined} />);
    expect(screen.getByRole('group', { name: 'Procurements grouped by next step' })).toBeInTheDocument();
  });
});
