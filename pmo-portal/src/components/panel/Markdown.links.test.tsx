/**
 * Answer links: only same-origin links are clickable; external links show as plain text with the domain.
 */
import React from 'react';
import { it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Markdown } from './Markdown';

it('renders a same-origin link as a clickable anchor', () => {
  const { container } = render(<Markdown text={`[Projects](${window.location.origin}/projects) and [rel](/tasks)`} />);
  const hrefs = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href'));
  expect(hrefs).toEqual([`${window.location.origin}/projects`, '/tasks']);
});

it('renders an external link as plain text with the domain visible, never an anchor', () => {
  const { container } = render(<Markdown text="[click here](https://other.example.net/p?q=abc) and [mail](mailto:a@other.example.net)" />);
  expect(container.querySelector('a')).toBeNull();
  const text = container.textContent ?? '';
  expect(text).toContain('click here (other.example.net)');
  expect(text).toContain('other.example.net');
  expect(text).not.toContain('q=abc');
});

it('does not treat a look-alike host of the app origin as same-origin', () => {
  const { container } = render(<Markdown text={`[x](${window.location.origin}.evil.test/a)`} />);
  expect(container.querySelector('a')).toBeNull();
});
