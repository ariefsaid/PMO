import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RecordSectionIndex } from '../RecordSectionIndex';

describe('RecordSectionIndex', () => {
  it('keeps one named section layer and navigates to the chosen record section', async () => {
    const user = userEvent.setup();
    render(
      <RecordSectionIndex
        identity="Pembangunan Gedung Layanan Terpadu Tahap IV Baru"
        sections={[{ id: 'activity', label: 'Activity' }, { id: 'details', label: 'Details' }]}
      >
        <section id="activity"><h2>Activity</h2></section>
        <section id="details"><h2>Details</h2></section>
      </RecordSectionIndex>,
    );

    expect(screen.getAllByRole('link', { name: 'Activity' })).toHaveLength(2);
    await user.click(screen.getAllByRole('link', { name: 'Details' })[0]);
    expect(window.location.hash).toBe('#details');
    expect(screen.getAllByRole('link', { name: 'Details' })).toHaveLength(2);
  });
});
