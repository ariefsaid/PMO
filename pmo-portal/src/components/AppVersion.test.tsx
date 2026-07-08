import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';

/**
 * AppVersion is driven by the build-time `__*__` globals (see version.test.ts).
 * Vitest does not run Vite's `define`, so stub the globals and load the
 * component FRESH each test — it pulls them in transitively via `version.ts`,
 * which reads them at module-eval time.
 */
describe('AppVersion', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('__APP_VERSION__', '9.9.9');
    vi.stubGlobal('__GIT_SHA__', 'abc1234');
    vi.stubGlobal('__BUILD_TIME__', '2026-07-08T12:00:00.000Z');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the version label v<version> · <sha>', async () => {
    const { AppVersion } = await import('./AppVersion');
    render(<AppVersion />);
    expect(screen.getByText('v9.9.9')).toBeInTheDocument();
    expect(screen.getByText('abc1234')).toBeInTheDocument();
  });

  it('links the sha to its GitHub commit', async () => {
    const { AppVersion } = await import('./AppVersion');
    render(<AppVersion />);
    const link = screen.getByRole('link', { name: /abc1234/i });
    expect(link).toHaveAttribute(
      'href',
      'https://github.com/ariefsaid/PMO/commit/abc1234',
    );
    // external link safety
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('exposes the build time on hover via title', async () => {
    const { AppVersion } = await import('./AppVersion');
    const { container } = render(<AppVersion />);
    expect(container.querySelector('[title]')).toHaveAttribute(
      'title',
      '2026-07-08T12:00:00.000Z',
    );
  });

  it('merges an optional className prop for positioning', async () => {
    const { AppVersion } = await import('./AppVersion');
    const { container } = render(<AppVersion className="fixed bottom-3 left-3" />);
    expect(container.firstChild).toHaveClass('fixed', 'bottom-3', 'left-3');
  });

  it('renders on every environment (no prod-suppression, unlike EnvBadge)', async () => {
    const { AppVersion } = await import('./AppVersion');
    const { container } = render(<AppVersion />);
    expect(container.firstChild).not.toBeNull();
    expect(container.firstChild).toHaveClass('text-muted-foreground');
    // muted scale matches EnvBadge
    expect(container.firstChild).toHaveClass('text-[11px]');
  });
});
