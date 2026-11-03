import { describe, expect, it } from 'vitest';
import { odooActionError } from './odooActionError';

const t = ((_k: string, d: string) => d) as never;
const unreachable = Object.assign(new Error('The external system could not be reached'), { code: 'external-unreachable' });

describe('AC-OPP-080 odooActionError: an action that needs Odoo fails honestly when Odoo cannot be reached', () => {
  it('on an Odoo org an unreachable answer says so, says nothing was sent, and never offers a queue', () => {
    expect(odooActionError(unreachable, true, t)).toEqual({ headline: 'Odoo is unreachable, try again.', detail: 'Nothing was sent.' });
  });

  it('any other error, or any other org, is left to the shared classifier', () => {
    expect(odooActionError(new Error('x'), true, t)).toBeNull();
    expect(odooActionError(Object.assign(new Error('x'), { code: 'commit-rejected' }), true, t)).toBeNull();
    expect(odooActionError(unreachable, false, t)).toBeNull();
  });
});
