/**
 * <FeatureRoute> — the interim UI feature-flag route gate.
 *
 * Proves the gate both ways (so it's a hiding mechanism, not a deletion):
 *  - flag OFF → renders <Navigate> (redirect), NOT the element
 *  - flag ON  → renders the element
 *  - honours a custom redirectTo
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { FeatureRoute } from '../FeatureRoute';
import * as features from '@/src/lib/features';

const Home = () => <div data-testid="home">Home</div>;
const Other = () => <div data-testid="other">Other</div>;
const Guarded = () => <div data-testid="guarded">Guarded</div>;

const renderAt = (path: string, redirectTo?: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/other" element={<Other />} />
        <Route
          path="/guarded"
          element={<FeatureRoute feature="incidents" element={<Guarded />} redirectTo={redirectTo} />}
        />
      </Routes>
    </MemoryRouter>,
  );

afterEach(() => vi.restoreAllMocks());

describe('FeatureRoute', () => {
  it('flag OFF: redirects to "/" and does NOT render the element', () => {
    vi.spyOn(features, 'isFeatureEnabled').mockReturnValue(false);
    renderAt('/guarded');
    expect(screen.getByTestId('home')).toBeInTheDocument();
    expect(screen.queryByTestId('guarded')).toBeNull();
  });

  it('flag ON: renders the element', () => {
    vi.spyOn(features, 'isFeatureEnabled').mockReturnValue(true);
    renderAt('/guarded');
    expect(screen.getByTestId('guarded')).toBeInTheDocument();
    expect(screen.queryByTestId('home')).toBeNull();
  });

  it('flag OFF: honours a custom redirectTo', () => {
    vi.spyOn(features, 'isFeatureEnabled').mockReturnValue(false);
    renderAt('/guarded', '/other');
    expect(screen.getByTestId('other')).toBeInTheDocument();
    expect(screen.queryByTestId('guarded')).toBeNull();
  });

  it('passes the queried feature key through to isFeatureEnabled', () => {
    const spy = vi.spyOn(features, 'isFeatureEnabled').mockReturnValue(true);
    renderAt('/guarded');
    expect(spy).toHaveBeenCalledWith('incidents');
  });
});
