import { useEffect, useState } from 'react';
import { repositories } from '@/src/lib/repositories';

export type ProjectNumberProposalState =
  | { status: 'idle' | 'loading'; number: null; error: null }
  | { status: 'success'; number: string; error: null }
  | { status: 'error'; number: null; error: string };

/** Reserves a proposal when a client is selected; stale responses cannot replace a newer selection. */
export function useProjectNumberProposal(clientId: string | null, enabled: boolean) {
  const [state, setState] = useState<ProjectNumberProposalState>({
    status: 'idle',
    number: null,
    error: null,
  });

  useEffect(() => {
    if (!enabled || !clientId) {
      setState({ status: 'idle', number: null, error: null });
      return;
    }

    let current = true;
    setState({ status: 'loading', number: null, error: null });
    void repositories.project.proposeNumber(clientId).then(
      (number) => {
        if (current) setState({ status: 'success', number, error: null });
      },
      (cause: unknown) => {
        if (!current) return;
        const message = cause instanceof Error ? cause.message : 'Could not propose a project number.';
        setState({ status: 'error', number: null, error: message });
      },
    );
    return () => {
      current = false;
    };
  }, [clientId, enabled]);

  return state;
}
