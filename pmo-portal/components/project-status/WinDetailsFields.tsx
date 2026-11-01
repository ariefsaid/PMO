import React from 'react';

/** Win "enter contract details" inputs, shared by the status menu and the board drop (DND, #1637). */
export const WinDetailsFields: React.FC<{
  idPrefix: string;
  contractRef: string;
  contractDate: string;
  onRef: (v: string) => void;
  onDate: (v: string) => void;
}> = ({ idPrefix, contractRef, contractDate, onRef, onDate }) => (
  <>
    <div>
      <label
        htmlFor={`contract-ref-${idPrefix}`}
        className="mb-0.5 block text-xs text-muted-foreground"
      >
        Customer contract ref
      </label>
      <input
        id={`contract-ref-${idPrefix}`}
        type="text"
        required
        value={contractRef}
        onChange={e => onRef(e.target.value)}
        placeholder="e.g. CPO-2026-001"
        className="w-full rounded-md border border-input bg-background px-2 py-1 text-sm outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      />
    </div>
    <div>
      <label
        htmlFor={`contract-date-${idPrefix}`}
        className="mb-0.5 block text-xs text-muted-foreground"
      >
        Contract date
      </label>
      <input
        id={`contract-date-${idPrefix}`}
        type="date"
        required
        value={contractDate}
        onChange={e => onDate(e.target.value)}
        className="w-full rounded-md border border-input bg-background px-2 py-1 text-sm outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      />
    </div>
  </>
);
