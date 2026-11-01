/**
 * Synthetic Odoo JSON-2 response shapes, as recorded on the dev bed (docs/research/2026-10-31-odoo20-dev-bed-verification.md
 * §1). Shapes only, never data from a real instance.
 */

/** 404 for an unknown method or model: the JSON error body (`timestamp` is extra on v20). */
export const ERR_404_JSON = {
  name: 'werkzeug.exceptions.NotFound',
  message: '404 Not Found',
  arguments: ['404 Not Found', 'The requested URL was not found'],
  timestamp: 0,
  context: {},
  debug: '',
};
