import { describe, it } from '@std/testing/bdd';
import { assertEquals } from '@std/assert';
import { erpReason } from './erpReason.ts';

describe('M11 erpReason: the ERP words an Admin reads', () => {
  it('drops exception class names, tracebacks, markup, tokens and anything that looks like an address', () => {
    assertEquals(erpReason(new Error('frappe.exceptions.ValidationError: Value missing for Item Group')), 'Value missing for Item Group');
    assertEquals(erpReason(new Error('Traceback (most recent call last):\n  File "x.py", line 3\nfrappe.exceptions.LinkValidationError: Could not find Supplier Group')), null);
    assertEquals(erpReason(new Error('<div class="msg">Duplicate name</div>')), 'Duplicate name');
    assertEquals(erpReason(new Error('see https://erp.example.com/app/item')), null);
    assertEquals(erpReason(new Error('')), null);
  });
});
