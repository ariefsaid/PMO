/**
 * task 2.7 (FR-TSP-090..095, spike §8b/§9) — `bodies/employee.ts`'s `employeeToBody`/`employeeFromDoc`
 * pair. New file (not `bodies.test.ts`, the money-doc R9 fixture set, and not `party.test.ts` — the
 * timesheets domain owns this kind, not `companies`, FR-TSP-094) so no existing test file is touched.
 */
import { describe, expect, it } from 'vitest';
import { employeeToBody, employeeFromDoc } from './employee.ts';

describe('erpnext/bodies/employee.ts — READ-ONLY Employee master (FR-TSP-093)', () => {
  it('AC-TSP-093 employeeToBody THROWS commit-rejected/employee-is-read-only — PMO never writes an ERP Employee', () => {
    expect(() => employeeToBody()).toThrow('employee-is-read-only');
    try {
      employeeToBody();
      expect.fail('expected employeeToBody to throw');
    } catch (err) {
      expect((err as { code?: string }).code).toBe('commit-rejected');
    }
  });

  it('AC-TSP-090 employeeFromDoc mirrors §8b/§9\'s frozen fields — work_email reads prefered_email, NOT company_email/personal_email', () => {
    const canonical = employeeFromDoc({
      name: 'HR-EMP-00001',
      employee_name: 'Spike Employee',
      company_email: 'spike.company@example.com',
      personal_email: 'spike.personal@example.com',
      prefered_email: 'spike.company@example.com', // ERP's own server-derived resolution (spike §8b)
      user_id: 'Administrator',
      status: 'Active',
      docstatus: 0,
      modified: '2026-07-20 09:00:00.000000',
    });
    expect(canonical).toMatchObject({
      id: 'HR-EMP-00001',
      employee_number: 'HR-EMP-00001',
      employee_name: 'Spike Employee',
      work_email: 'spike.company@example.com',
      erp_user_id: 'Administrator',
      erp_status: 'Active',
      erp_docstatus: 0,
      erp_modified: '2026-07-20 09:00:00.000000',
      erp_amended_from: null,
      erp_cancelled_at: null,
    });
  });

  it('AC-TSP-095 employeeFromDoc returns EXACTLY its narrow key set — no salary/bank/national-id field leaks (PII minimization)', () => {
    const canonical = employeeFromDoc({
      name: 'HR-EMP-00002',
      employee_name: 'Wide Doc Employee',
      prefered_email: 'wide@example.com',
      user_id: null,
      status: 'Active',
      docstatus: 0,
      modified: '2026-07-20 09:00:00.000000',
      // A wide doctype read would also carry these — must NEVER surface in the canonical:
      salary_currency: 'IDR',
      bank_name: 'Some Bank',
      bank_ac_no: '1234567890',
      national_identity_number: 'NIK-0000',
      date_of_birth: '1990-01-01',
    });
    expect(Object.keys(canonical).sort()).toEqual(
      [
        'id',
        'employee_number',
        'employee_name',
        'work_email',
        'erp_user_id',
        'erp_status',
        'erp_docstatus',
        'erp_modified',
        'erp_amended_from',
        'erp_cancelled_at',
      ].sort(),
    );
  });

  it('AC-TSP-090 employeeFromDoc treats an empty prefered_email as NO proposal candidate (null, not empty string)', () => {
    const canonical = employeeFromDoc({
      name: 'HR-EMP-00003',
      employee_name: 'No Email Employee',
      prefered_email: null,
      status: 'Active',
      docstatus: 0,
      modified: '2026-07-20 09:00:00.000000',
    });
    expect(canonical.work_email).toBeNull();
  });

  it('AC-TSP-090 employeeFromDoc handles a missing user_id (spike §8b: NOT auto-populated) as null', () => {
    const canonical = employeeFromDoc({
      name: 'HR-EMP-00004',
      employee_name: 'Fresh Employee',
      prefered_email: 'fresh@example.com',
      status: 'Active',
      docstatus: 0,
      modified: '2026-07-20 09:00:00.000000',
    });
    expect(canonical.erp_user_id).toBeNull();
  });
});
