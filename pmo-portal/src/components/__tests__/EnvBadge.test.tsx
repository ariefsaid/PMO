import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { EnvBadge } from '../EnvBadge';

afterEach(() => {
  vi.unstubAllEnvs();
  cleanup();
});

describe('EnvBadge', () => {
  it('renders nothing when VITE_APP_ENV is unset (prod-clean default)', () => {
    vi.stubEnv('VITE_APP_ENV', '');
    render(<EnvBadge />);
    expect(screen.queryByTestId('env-badge')).toBeNull();
  });

  it.each(['prod', 'production', 'PROD'])('renders nothing for %s', (v) => {
    vi.stubEnv('VITE_APP_ENV', v);
    render(<EnvBadge />);
    expect(screen.queryByTestId('env-badge')).toBeNull();
  });

  it.each(['test', 'local', 'staging'])('shows the %s ribbon', (env) => {
    vi.stubEnv('VITE_APP_ENV', env);
    render(<EnvBadge />);
    const badge = screen.getByTestId('env-badge');
    // textContent is the raw value; the visual upper-casing is CSS-only.
    expect(badge).toHaveTextContent(env);
    expect(badge.className).toContain('uppercase');
    expect(badge).toHaveAttribute('aria-label', `Environment: ${env}`);
  });
});
