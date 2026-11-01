import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const h = vi.hoisted(() => ({ conn: { data: undefined as unknown } }));
vi.mock('@/src/hooks/useOdoo', () => ({ useOdooConnection: () => h.conn }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { org_id: 'org-1' } }) }));
vi.mock('@/src/components/integrations/ProjectMatchReview', () => ({ ProjectMatchReview: () => <div>erpnext link</div> }));
vi.mock('./ProjectOdooLink', () => ({ ProjectOdooLink: (p: { projectId: string; managerId: string | null }) => <div>odoo link {p.projectId} {p.managerId}</div> }));
import { ProjectErpLink } from './ProjectErpLink';

beforeEach(() => { h.conn.data = undefined; });
afterEach(cleanup);

it('FR-ODC-112 an org connected to Odoo gets the Odoo cost-account link, not the ERPNext match review', () => {
  h.conn.data = { status: 'active', activated: true };
  render(<ProjectErpLink projectId="p-1" managerId="u-1" />);
  expect(screen.getByText('odoo link p-1 u-1')).toBeInTheDocument();
  expect(screen.queryByText('erpnext link')).not.toBeInTheDocument();
});

it('any other org keeps the ERPNext review exactly as before', () => {
  for (const data of [undefined, { status: 'disconnected', activated: false }]) {
    h.conn.data = data;
    render(<ProjectErpLink projectId="p-1" />);
    expect(screen.getByText('erpnext link')).toBeInTheDocument();
    cleanup();
  }
});
