import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { ConnectCredentialsModal } from './ConnectCredentialsModal';

/**
 * #2092 (WIG, Forms) — an instance URL is a URL: the mobile keyboard and the browser's URL
 * handling must follow the type, and an API key is never autofilled.
 */
describe('#2092 Connect credentials: the instance URL is typed as a URL', () => {
  const mount = () =>
    render(
      <ConnectCredentialsModal tier="erpnext" loading={false} error={null} onClose={() => {}} onSubmit={vi.fn()} />,
    );

  it('#2092 AC3: the instance URL opens the URL keyboard', () => {
    mount();
    const url = screen.getByLabelText(/Instance URL/);
    expect(url).toHaveAttribute('type', 'url');
  });

  it('the API key and secret stay masked and unautofilled', () => {
    mount();
    expect(screen.getByLabelText(/API Key/)).toHaveAttribute('autocomplete', 'off');
    const secret = screen.getByLabelText(/API Secret/);
    expect(secret).toHaveAttribute('type', 'password');
    expect(secret).toHaveAttribute('autocomplete', 'off');
  });
});
