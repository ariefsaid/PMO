export const CONTRACT_LINE_BASES: readonly ['unit_rate', 'lump_sum'];
export const isAmount: (v: unknown) => boolean;
export const isQuantity: (v: unknown) => boolean;
export function defaultContractLineBasis(unit: string): 'unit_rate' | 'lump_sum';
export interface ContractLineValues {
  key?: unknown; item_code?: unknown; description?: unknown; unit?: unknown;
  quantity?: unknown; rate?: unknown; line_no?: number | null; basis?: string;
}
export function contractLineProblems(line: ContractLineValues, seen?: Set<string>): string[];
export interface ContractLineProblem {
  field: 'key' | 'item_code' | 'description' | 'unit' | 'quantity' | 'rate' | 'line_no' | 'basis';
  code: 'required' | 'tooLong' | 'duplicate' | 'invalid' | 'notWhole' | 'outOfRange' | 'lumpSumOne';
  params?: { max?: number; value?: string };
}
export function contractLineProblemCodes(line: ContractLineValues, seen?: Set<string>): ContractLineProblem[];
export function contractLineProblemText(problem: ContractLineProblem): string;
