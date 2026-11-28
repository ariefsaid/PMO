import { test } from 'node:test';
import assert from 'node:assert/strict';
import { convert } from './sync-guide.mjs';

test('title from first heading, heading removed', () => {
  assert.equal(convert('# Work "orders"\n\nBody', 'office/work-orders.md'), '---\ntitle: "Work \\"orders\\""\n---\n\nBody');
});

test('relative .md links become site URLs; external and anchor links untouched', () => {
  const out = convert(
    '# T\n[a](three-way-match.md) [b](../crews/x.md#step-2) [c](office/y.md) [d](https://e.com/z.md) [e](#here)',
    'office/page.md',
  );
  assert.match(out, /\[a\]\(\/office\/three-way-match\/\)/);
  assert.match(out, /\[b\]\(\/crews\/x\/#step-2\)/);
  assert.match(out, /\[c\]\(\/office\/office\/y\/\)/);
  assert.match(out, /\[d\]\(https:\/\/e\.com\/z\.md\)/);
  assert.match(out, /\[e\]\(#here\)/);
});

test('README link from root resolves to its folder index', () => {
  assert.match(convert('# T\n[home](README.md) [t](office/terminology.md)', 'README.md'), /\[home\]\(\/\)[\s\S]*\(\/office\/terminology\/\)/);
});

test('page without a heading fails loudly', () => {
  assert.throws(() => convert('no heading', 'x.md'), /no "# Title"/);
});
