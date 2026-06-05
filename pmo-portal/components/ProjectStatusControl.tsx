import React, { useState } from 'react';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { useProjectTransition } from '@/src/hooks/useProjectTransitions';
import {
  LEGAL_PROJECT_TRANSITIONS,
  type ProjectStatus,
} from '@/src/lib/db/projectTransitions';

// ---------------------------------------------------------------------------
// Write-role gate — the RPC is the real authority; this is cosmetic only (ADR-0008)
// ---------------------------------------------------------------------------
const WRITE_ROLES = new Set(['Admin', 'Executive', 'Project Manager', 'Finance']);

interface ProjectStatusControlProps {
  project: {
    id: string;
    status: ProjectStatus;
    customer_contract_ref: string | null;
  };
}

/**
 * Per-project status-change control (AC-1004, FR-PR-005/011, NFR-PR-UI-001).
 * Cosmetically gated by useEffectiveRole to write roles (Admin/Executive/PM/Finance).
 * Offers exactly the legal next statuses for the project's current status.
 * When the target is 'Won, Pending KoM', prompts for customer contract ref + date.
 * Surfaces RPC errors inline (not swallowed).
 */
const ProjectStatusControl: React.FC<ProjectStatusControlProps> = ({ project }) => {
  const { effectiveRole } = useEffectiveRole();
  const mutation = useProjectTransition();

  const [open, setOpen] = useState(false);
  const [pendingTarget, setPendingTarget] = useState<ProjectStatus | null>(null);
  const [contractRef, setContractRef] = useState('');
  const [contractDate, setContractDate] = useState('');

  // Cosmetic gate: hide for non-write roles (RPC is the real authority)
  if (!WRITE_ROLES.has(effectiveRole ?? '')) return null;

  const legalTargets = (LEGAL_PROJECT_TRANSITIONS[project.status as string] ?? []) as ProjectStatus[];

  // No transitions available (e.g. Internal Project terminal)
  if (legalTargets.length === 0) return null;

  const handleTargetSelect = (target: ProjectStatus) => {
    if (target === 'Won, Pending KoM') {
      // Prompt for contract ref + date before submitting
      setPendingTarget(target);
      setContractRef('');
      setContractDate('');
    } else {
      // Immediate transition
      setOpen(false);
      mutation.mutate({ id: project.id, to: target, opts: undefined });
    }
  };

  const handleWinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!contractRef.trim() || !contractDate) return;
    setOpen(false);
    setPendingTarget(null);
    mutation.mutate({
      id: project.id,
      to: 'Won, Pending KoM',
      opts: { customerContractRef: contractRef.trim(), contractDate },
    });
  };

  const handleCancel = () => {
    setOpen(false);
    setPendingTarget(null);
    setContractRef('');
    setContractDate('');
  };

  return (
    <div data-testid="project-status-control" className="relative">
      {/* Inline error display — always visible when error exists (NFR-PR-UI-001) */}
      {mutation.isError && mutation.error && (
        <p className="text-xs text-red-600 dark:text-red-400 mb-1" role="alert">
          {mutation.error.message}
        </p>
      )}

      {!open && !pendingTarget && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:border-primary-500 hover:text-primary-600 transition-colors"
          disabled={mutation.isPending}
          aria-label="Change status"
        >
          {mutation.isPending ? 'Saving…' : 'Change status'}
        </button>
      )}

      {/* Target selection dropdown */}
      {open && !pendingTarget && (
        <div className="absolute z-20 mt-1 left-0 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg min-w-[180px]">
          <p className="px-3 pt-2 pb-1 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
            Move to
          </p>
          {legalTargets.map(target => (
            <button
              key={target}
              type="button"
              onClick={() => handleTargetSelect(target)}
              className="block w-full text-left px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              {target}
            </button>
          ))}
          <button
            type="button"
            onClick={handleCancel}
            className="block w-full text-left px-3 py-2 text-xs text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 border-t border-gray-100 dark:border-gray-700"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Win form — requires customer contract ref + date */}
      {pendingTarget === 'Won, Pending KoM' && (
        <form
          onSubmit={handleWinSubmit}
          className="absolute z-20 mt-1 left-0 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-3 min-w-[240px] space-y-2"
        >
          <p className="text-xs font-semibold text-gray-700 dark:text-gray-300">
            Win — enter contract details
          </p>
          <div>
            <label
              htmlFor={`contract-ref-${project.id}`}
              className="block text-xs text-gray-600 dark:text-gray-400 mb-0.5"
            >
              Customer contract ref
            </label>
            <input
              id={`contract-ref-${project.id}`}
              type="text"
              required
              value={contractRef}
              onChange={e => setContractRef(e.target.value)}
              placeholder="e.g. CPO-2026-001"
              className="w-full px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:border-primary-500 dark:bg-gray-700 dark:text-gray-200"
            />
          </div>
          <div>
            <label
              htmlFor={`contract-date-${project.id}`}
              className="block text-xs text-gray-600 dark:text-gray-400 mb-0.5"
            >
              Contract date
            </label>
            <input
              id={`contract-date-${project.id}`}
              type="date"
              required
              value={contractDate}
              onChange={e => setContractDate(e.target.value)}
              className="w-full px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:border-primary-500 dark:bg-gray-700 dark:text-gray-200"
            />
          </div>
          <div className="flex gap-2 pt-1">
            <button
              type="submit"
              className="flex-1 px-3 py-1.5 text-xs font-medium text-white bg-primary-600 rounded hover:bg-primary-700 transition-colors"
            >
              Confirm
            </button>
            <button
              type="button"
              onClick={handleCancel}
              className="flex-1 px-3 py-1.5 text-xs text-gray-600 dark:text-gray-400 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
};

export default ProjectStatusControl;
