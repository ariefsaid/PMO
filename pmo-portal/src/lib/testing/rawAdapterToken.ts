/**
 * Test-only oracle for adapter push-error copy: a RAW adapter token is two-or-more lowercase/digit
 * segments joined by hyphens, standing alone as a word. Push surfaces assert their rendered text
 * against this so a new machine code can never quietly reach the DOM by being added to a writer and
 * forgotten in `adapterSeam/pushErrorCopy.ts`. Lives in test support (never imported by production).
 */
export const RAW_ADAPTER_TOKEN = /(?:^|[\s(])[a-z0-9]+(?:-[a-z0-9]+)+(?=$|[\s.,;:)])/;
