/**
 * commandUnit — the per-budget-unit command mint (#1714).
 *
 * ⚑ AC-1714: a budget fan-out attempt must act on ITS OWN command object. The served handler used to
 * re-bind the shared request command per year (`command = { ...command, record: unit.record, ... }`),
 * which made the loop's correctness depend on mutation order instead of structure. This helper makes
 * the per-unit command EXPLICIT: every unit's attempt, target guard and failure writer receive their
 * own `AdapterCommand`, and the request command is never re-bound.
 *
 * The request command arrives here AFTER its existing pre-dispatch mutations (server-derived Odoo
 * invoice key, timesheet canonical truth, trusted field stripping) — this helper only replaces the
 * two fields that make a unit distinct: the unit's own gate-resolved `record` and its server-derived
 * `idempotencyKey`. The unit's `identity` is intentionally NOT inserted anywhere: it stays the
 * separate outbox argument the attempt names, while `record.id` remains the bare version UUID the
 * gate, mirror FK and inbound feed key on.
 *
 * Pure and type-only: no behavior, no I/O, no dependency injection — the shipped handler is untouched.
 */
import type { AdapterCommand } from '../../../pmo-portal/src/lib/adapterSeam/contract.ts';
import type { BudgetDispatchUnit } from './budgetDispatch.ts';

/** Mint the command ONE budget dispatch unit is attempted under — never mutating the request command
 *  or the unit; each call returns a fresh object, so two units can never alias one command. */
export function commandForBudgetUnit(command: AdapterCommand, unit: BudgetDispatchUnit): AdapterCommand {
  return { ...command, record: unit.record, idempotencyKey: unit.idempotencyKey };
}
