/**
 * Procurement goods receipt read eval (FR-PLN-008, AC-PLN-006, #1783 D17).
 *
 * Verifies that with procurement Basic ON and procurement_full OFF:
 * 1. The assistant offers query_entity for procurement_receipts (goods receipts/GRNs).
 * 2. An ordinary goods receipt request selects query_entity with input.entity === 'procurement_receipts'.
 * 3. query_entity returns the actual success shape { rowCount, rows } with no error.
 * 4. The returned rows contain the known fixture receipt GR number.
 * 5. The assistant grounds its answer in the returned receipt data (which was not in the prompt).
 */
import type { Scorer } from '../harness/scorers';
import { defineEvalSuite, runEvalSuite } from '../harness/runEval';

export function usesGroundedReceiptQuery(expectedGrNumber: string): Scorer {
  return (run) => {
    // 1. Find the tool call for procurement_receipts
    const call = run.toolCalls.find(
      (t) =>
        t.name === 'query_entity' &&
        typeof t.input === 'object' &&
        t.input !== null &&
        (t.input as { entity?: unknown }).entity === 'procurement_receipts',
    );
    if (!call) {
      const actualTools = run.toolCalls
        .map((t) => `${t.name}(${JSON.stringify(t.input)})`)
        .join(', ');
      return {
        pass: false,
        reason: `expected query_entity for "procurement_receipts", actual calls: [${actualTools || 'none'}]`,
      };
    }

    // 2. Inspect tool call result shape
    const res = call.result as Record<string, unknown> | undefined;
    if (!res || typeof res !== 'object') {
      return {
        pass: false,
        reason: `query_entity result is missing or not an object: ${JSON.stringify(call.result)}`,
      };
    }

    if (res.error) {
      return {
        pass: false,
        reason: `query_entity returned error: ${JSON.stringify(res.error)} (code: ${res.code})`,
      };
    }

    const rows = res.rows as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(rows) || typeof res.rowCount !== 'number') {
      return {
        pass: false,
        reason: `query_entity result does not have { rowCount, rows } shape: ${JSON.stringify(res)}`,
      };
    }

    const hasExpectedGr = rows.some((r) => r.gr_number === expectedGrNumber);
    if (!hasExpectedGr) {
      const actualGrNumbers = rows.map((r) => r.gr_number).join(', ');
      return {
        pass: false,
        reason: `query_entity result did not return expected receipt "${expectedGrNumber}"; actual GRs: [${actualGrNumbers}]`,
      };
    }

    // 3. Grounded answer assertion: answerText must contain expectedGrNumber
    if (!run.answerText.includes(expectedGrNumber)) {
      return {
        pass: false,
        reason: `assistant answer text does not ground the returned receipt number "${expectedGrNumber}": ${run.answerText.slice(0, 200)}`,
      };
    }

    return {
      pass: true,
      reason: `query_entity successfully returned "${expectedGrNumber}" and assistant grounded it in answer`,
    };
  };
}

export default runEvalSuite(
  defineEvalSuite({
    name: 'procurement receipt read (deepseek-v4.1-flash)',
    cases: [
      {
        name: 'goods receipts read selects query_entity for procurement_receipts and grounds data',
        prompt: 'What goods receipts exist for purchase PROC-2026-008?',
        expect: [
          usesGroundedReceiptQuery('GR-2602240001'),
        ],
      },
    ],
  }),
);
