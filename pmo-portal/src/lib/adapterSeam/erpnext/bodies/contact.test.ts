import { describe, expect, it } from 'vitest';
import { AdapterError } from '../../contract.ts';
import { DOCTYPE_BODIES } from '../doctypeBodies.ts';
import type { ErpCtx } from '../doctypeRegistry.ts';
import { contactCanonicalFromDoc, contactFromDoc, contactToBody } from './contact.ts';

describe('Contact mapping through the shipped adapter body', () => {
  const ctx: ErpCtx = { refs: { contact_party_type: 'Customer', contact_party_name: 'C-001' }, config: {} };

  it('AC-CON-001 preserves ERP identity, primary child details and parent links on a full read', () => {
    expect(DOCTYPE_BODIES.contact?.fromDoc({
      name: 'CONTACT-001', first_name: 'Synthetic', middle_name: 'Middle', last_name: 'Contact',
      email_ids: [{ email_id: 'secondary@example.test' }, { email_id: 'primary@example.test', is_primary: 1 }],
      phone_nos: [{ phone: '000-SECONDARY' }, { phone: '000-PRIMARY', is_primary_phone: 1 }],
      links: [{ link_doctype: 'Customer', link_name: 'C-001' }], modified: '2026-10-05 09:00:00',
    })).toEqual({
      id: 'Contact:CONTACT-001', full_name: 'Synthetic Middle Contact', email: 'primary@example.test',
      phone: '000-PRIMARY', erp_modified: '2026-10-05 09:00:00',
      erp_contact_links: [{ link_doctype: 'Customer', link_name: 'C-001' }],
    });
  });

  it('prefers ERP scalar display and contact fields over child fallback values', () => {
    expect(contactFromDoc({ full_name: 'Synthetic Display', first_name: 'Ignored', email_id: 'scalar@example.test',
      phone: '000-SCALAR', mobile_no: '000-MOBILE', email_ids: [{ email_id: 'child@example.test' }],
      phone_nos: [{ phone: '000-CHILD' }],
    })).toEqual({ full_name: 'Synthetic Display', email: 'scalar@example.test', phone: '000-SCALAR' });
  });

  it('uses first child details when ERP has no primary child', () => {
    expect(contactFromDoc({ first_name: 'Synthetic', last_name: 'Contact',
      email_ids: [{ email_id: 'first@example.test' }, { email_id: 'second@example.test' }],
      phone_nos: [{ phone: '000-FIRST' }, { phone: '000-SECOND' }],
    })).toEqual({ full_name: 'Synthetic Contact', email: 'first@example.test', phone: '000-FIRST' });
  });

  it('uses mobile scalar and primary mobile child when a phone scalar is absent', () => {
    expect(contactFromDoc({ full_name: 'Synthetic', mobile_no: '000-MOBILE' }).phone).toBe('000-MOBILE');
    expect(contactFromDoc({ full_name: 'Synthetic', phone_nos: [
      { phone: '000-SECONDARY' }, { phone: '000-MOBILE', is_primary_mobile_no: 1 },
    ] }).phone).toBe('000-MOBILE');
  });

  it('clears absent optional ERP details instead of fabricating identity or contact values', () => {
    expect(contactCanonicalFromDoc({})).toEqual({ id: 'Contact:', full_name: '', email: null, phone: null,
      erp_modified: null, erp_contact_links: [] });
  });

  it('AC-CON-003 writes primary child tables linked to the resolved company', () => {
    expect(DOCTYPE_BODIES.contact?.toBody({ id: 'pmo-contact', full_name: '  Synthetic Contact  ',
      email: 'synthetic@example.test', phone: '000-PRIMARY' }, ctx)).toEqual({
      first_name: 'Synthetic Contact', links: [{ link_doctype: 'Customer', link_name: 'C-001' }],
      email_ids: [{ email_id: 'synthetic@example.test', is_primary: 1 }],
      phone_nos: [{ phone: '000-PRIMARY', is_primary_phone: 1 }],
    });
  });

  it('omits optional child tables when authoring details are empty', () => {
    expect(contactToBody({ id: 'pmo-contact', full_name: 'Synthetic Contact', email: null, phone: '' }, ctx))
      .toEqual({ first_name: 'Synthetic Contact', links: [{ link_doctype: 'Customer', link_name: 'C-001' }] });
  });

  it.each(['', '   ', null, 42])('rejects invalid authoring name %s before building a write', (full_name) => {
    expect(() => contactToBody({ id: 'pmo-contact', full_name }, ctx)).toThrow(new AdapterError('commit-rejected', 'Contact name is required'));
  });

  it.each([
    { contact_party_type: null, contact_party_name: 'C-001' },
    { contact_party_type: 'Customer', contact_party_name: null },
  ])('rejects unresolved company identity %j before building a write', (refs) => {
    expect(() => contactToBody({ id: 'pmo-contact', full_name: 'Synthetic Contact' }, { refs, config: {} }))
      .toThrow(new AdapterError('commit-rejected', 'Contact company must be mapped to ERPNext'));
  });
});
