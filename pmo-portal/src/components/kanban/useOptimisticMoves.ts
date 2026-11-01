import { useCallback, useState } from 'react';

export type MoveState = 'held' | 'saving';
type Moves = Record<string, { column: string; state: MoveState }>;

/** Board-local optimistic placement (FR-DND-030..033). Never touches the query cache. */
export function useOptimisticMoves() {
  const [moves, setMoves] = useState<Moves>({});
  const hold = useCallback((id: string, column: string) =>
    setMoves((m) => ({ ...m, [id]: { column, state: 'held' } })), []);
  const save = useCallback((id: string) =>
    setMoves((m) => (m[id] ? { ...m, [id]: { ...m[id], state: 'saving' } } : m)), []);
  const release = useCallback((id: string) =>
    setMoves((m) => { if (!(id in m)) return m; const next = { ...m }; delete next[id]; return next; }), []);
  // Let the refetched rows render before the card stops being held, so it never flickers back (FR-DND-033).
  const releaseAfterRender = useCallback(async (id: string) => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    release(id);
  }, [release]);
  const columnOf = useCallback((id: string, fallback: string) => moves[id]?.column ?? fallback, [moves]);
  const stateOf = useCallback((id: string): MoveState | null => moves[id]?.state ?? null, [moves]);
  return { hold, save, release, releaseAfterRender, columnOf, stateOf };
}
