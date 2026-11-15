import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ProcurementGroupedView } from '../ProcurementGroupedView';

describe('ProcurementGroupedView', () => {
  it('a11y(#2086): the grouped wrapper is a named group, not a role-less labelled div', () => {
    render(<MemoryRouter><ProcurementGroupedView rows={[]} role="Finance" reasonText={new Map()} /></MemoryRouter>);
    expect(screen.getByRole('group', { name: 'Procurements grouped by next step' })).toBeInTheDocument();
  });
});
