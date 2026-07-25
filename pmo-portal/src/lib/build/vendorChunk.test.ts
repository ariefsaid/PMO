import { describe, it, expect } from 'vitest';
import { vendorChunkFor } from './vendorChunk';

/**
 * The regression this suite exists for: the previous inline predicate matched the literal
 * `'react-router-dom'`, but the router's code lives in `node_modules/react-router/`. The router
 * therefore fell OUT of `vendor-react` for the whole v7 era with every test green, because the
 * predicate had no testable seam. Assert on real rollup-shaped module ids.
 */
describe('vendorChunkFor', () => {
  it('puts the ROUTER CORE in vendor-react — the id is node_modules/react-router/, never react-router-dom', () => {
    expect(vendorChunkFor('/repo/pmo-portal/node_modules/react-router/dist/index.mjs')).toBe('vendor-react');
    expect(vendorChunkFor('/repo/pmo-portal/node_modules/react-router/dist/dom.mjs')).toBe('vendor-react');
  });

  it('puts react + react-dom + scheduler in vendor-react', () => {
    expect(vendorChunkFor('/repo/node_modules/react/index.js')).toBe('vendor-react');
    expect(vendorChunkFor('/repo/node_modules/react-dom/client.js')).toBe('vendor-react');
    expect(vendorChunkFor('/repo/node_modules/scheduler/index.js')).toBe('vendor-react');
  });

  it('maps the other vendor families', () => {
    expect(vendorChunkFor('/repo/node_modules/@tanstack/react-query/build/index.js')).toBe('vendor-query');
    expect(vendorChunkFor('/repo/node_modules/@supabase/supabase-js/dist/main/index.js')).toBe('vendor-supabase');
    expect(vendorChunkFor('/repo/node_modules/recharts/es6/index.js')).toBe('vendor-recharts');
  });

  it('does NOT let a substring-alike package hijack a chunk', () => {
    // The whole point of exact package matching: these must not become vendor-react.
    expect(vendorChunkFor('/repo/node_modules/react-markdown/index.js')).toBeUndefined();
    expect(vendorChunkFor('/repo/node_modules/react-router-devtools/index.js')).toBeUndefined();
    expect(vendorChunkFor('/repo/node_modules/@react-router/dev/index.js')).toBeUndefined();
  });

  it('never assigns APPLICATION code to a vendor chunk', () => {
    expect(vendorChunkFor('/repo/pmo-portal/src/lib/react-helpers.ts')).toBeUndefined();
    expect(vendorChunkFor('/repo/pmo-portal/App.tsx')).toBeUndefined();
    // A src path that merely contains the word does not qualify.
    expect(vendorChunkFor('/repo/pmo-portal/src/react-router-shim.ts')).toBeUndefined();
  });

  it('resolves NESTED installs by the last node_modules segment', () => {
    expect(vendorChunkFor('/repo/node_modules/some-pkg/node_modules/react-router/dist/index.mjs')).toBe(
      'vendor-react',
    );
  });

  it('handles windows-style separators', () => {
    expect(vendorChunkFor('C:\\repo\\node_modules\\react-router\\dist\\index.mjs')).toBe('vendor-react');
  });
});
