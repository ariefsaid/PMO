/**
 * Markdown security gate — hostile-markdown never executes (ADR-0049 §2).
 * FR-AXP-002/003, NFR-AXP-SEC-001.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Markdown } from './Markdown';

describe('Markdown security gate', () => {
  it('AC-AXP-003 hostile markdown never executes', () => {
    const hostile = [
      '<script>alert(1)</script>',
      '<img src=x onerror=alert(1)>',
      "<iframe src='https://evil'></iframe>",
      '[click](javascript:alert(1))',
      "<div onclick='x()'>hi</div>",
    ].join('\n\n');

    render(
      <MemoryRouter>
        <Markdown text={hostile} />
      </MemoryRouter>,
    );

    expect(document.querySelector('script')).toBeNull();
    expect(document.querySelector('iframe')).toBeNull();

    document.querySelectorAll('*').forEach((el) => {
      el.getAttributeNames().forEach((name) => {
        expect(name.startsWith('on')).toBe(false);
      });
    });

    expect(document.querySelector('a[href^="javascript:"]')).toBeNull();

    document.querySelectorAll('a').forEach((a) => {
      const rel = a.getAttribute('rel') ?? '';
      expect(rel).toContain('noopener');
      expect(rel).toContain('nofollow');
    });
  });
});
