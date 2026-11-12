import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import React from 'react';
import { LegacyHomeRedirect } from '../LegacyHomeRedirect';

const LocationProbe = () => {
  const location = useLocation();
  return <output data-testid="current-location">{location.pathname}{location.search}{location.hash}</output>;
};

describe('legacy /home route', () => {
  it('redirects bookmarks to the dashboard and preserves the query and hash', () => {
    render(
      <MemoryRouter initialEntries={['/home?from=bookmark#work']}>
        <LocationProbe />
        <Routes>
          <Route path="/home" element={<LegacyHomeRedirect />} />
          <Route path="/" element={<div>dashboard</div>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText('dashboard')).toBeInTheDocument();
    expect(screen.getByTestId('current-location')).toHaveTextContent('/?from=bookmark#work');
  });
});
