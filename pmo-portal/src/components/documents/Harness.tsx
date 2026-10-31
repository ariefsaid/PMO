// Test harness component for the document viewer suites (not imported by production code).
import { useDocumentViewer } from './viewerContext';
import type { DocumentViewTarget } from './types';

/** One button per target that opens it, plus a programmatic Close. */
export function Harness({ targets }: { targets: DocumentViewTarget[] }) {
  const viewer = useDocumentViewer();
  return (
    <>
      {targets.map((t) => (
        <button key={t.key} onClick={(e) => viewer.open(t, e.currentTarget)}>{`Preview ${t.name}`}</button>
      ))}
      <button onClick={viewer.close}>programmatic close</button>
    </>
  );
}
