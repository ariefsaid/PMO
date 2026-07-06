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

  // LOW-1 (security review, 2026-07-05): lock the urlTransform scheme allowlist against a FUTURE
  // regression (e.g. someone adding rehype-raw + a naive sanitizer). Today the raw-HTML-off boundary
  // already inerts these; this asserts the scheme gate directly across obfuscation vectors.
  it('AC-AXP-003 unsafe-scheme links/images never produce a navigable href/src', () => {
    const vectors = [
      '[a](javascript:alert(1))',
      '[b](JavaScript:alert(1))', // mixed case
      '[c](java\tscript:alert(1))', // control-char obfuscation
      '[d](data:text/html,<script>alert(1)</script>)',
      '[e](vbscript:msgbox(1))',
      '[f](//evil.example/x)', // protocol-relative
      '![g](javascript:alert(1))', // markdown image
      '![h](data:text/html,<script>alert(1)</script>)',
      '<javascript:alert(1)>', // autolink
    ].join('\n\n');

    render(
      <MemoryRouter>
        <Markdown text={vectors} />
      </MemoryRouter>,
    );

    // safeUrl normalizes obfuscated schemes to "" BEFORE render, so a sanitized href/src can never
    // begin with a dangerous scheme; this asserts none leaked through.
    const bad = /^\s*(?:javascript|data|vbscript|file|blob):/i;
    document.querySelectorAll('a[href]').forEach((a) => {
      expect(bad.test(a.getAttribute('href') ?? '')).toBe(false);
    });
    document.querySelectorAll('[src]').forEach((el) => {
      expect(bad.test(el.getAttribute('src') ?? '')).toBe(false);
    });
    // (protocol-relative //evil resolves to http(s) — a safe external link, not an injection vector —
    // so it is intentionally allowed; the assertions above prove no javascript:/data:/vbscript: survives.)
  });
});
