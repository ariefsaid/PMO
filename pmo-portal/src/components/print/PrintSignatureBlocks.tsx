import React from 'react';
import { cn } from '@/src/components/ui';
import { BUILT_IN_ROLES } from '@/src/auth/builtInRoles';
import { useBuiltInRoleName } from '@/src/hooks/useOrgRoleNames';

/** A signature line naming a built-in role (by key or by its shipped name in either language) shows the org's role name. */
function useSignatureTitle(): (title: string) => string {
  const roleName = useBuiltInRoleName();
  return (title) => {
    const probe = title.trim().toLowerCase();
    const role = BUILT_IN_ROLES.find(
      (r) => r.key === probe || r.nameEn.toLowerCase() === probe || r.nameId.toLowerCase() === probe,
    );
    return role ? roleName(role.key) : title;
  };
}

export interface SignatureBlockItem {
  title: string;
  nameLabel?: string;
  dateLabel?: string;
  signLabel?: string;
  note?: string;
}

export interface PrintSignatureBlocksProps {
  blocks: (string | SignatureBlockItem)[];
  nameLabel?: string;
  dateLabel?: string;
  signLabel?: string;
  className?: string;
}

/**
 * Reusable physical signature blocks for PMO printable documents (#2687, #2688).
 * Renders boxes with dedicated signing area, printed name line, and date line.
 * Marked with `break-inside-avoid` so blocks are never split across paper pages.
 */
export const PrintSignatureBlocks: React.FC<PrintSignatureBlocksProps> = ({
  blocks,
  nameLabel = 'Name',
  dateLabel = 'Date',
  signLabel = 'Signature',
  className,
}) => {
  const signatureTitle = useSignatureTitle();
  if (!blocks || blocks.length === 0) return null;

  const normalized: SignatureBlockItem[] = blocks.map((b) =>
    typeof b === 'string'
      ? { title: signatureTitle(b), nameLabel, dateLabel, signLabel }
      : {
          title: signatureTitle(b.title),
          nameLabel: b.nameLabel ?? nameLabel,
          dateLabel: b.dateLabel ?? dateLabel,
          signLabel: b.signLabel ?? signLabel,
          note: b.note,
        },
  );

  return (
    <section
      className={cn(
        'mt-10 pt-6 border-t border-border break-inside-avoid print:break-inside-avoid',
        className,
      )}
      data-testid="print-signature-blocks"
      aria-label="Signatures"
    >
      <div
        className={cn(
          'grid gap-6',
          normalized.length === 2 && 'grid-cols-2',
          normalized.length === 3 && 'grid-cols-1 sm:grid-cols-3',
          normalized.length >= 4 && 'grid-cols-2 sm:grid-cols-4',
          'print:flex print:flex-row print:justify-between print:gap-4',
        )}
      >
        {normalized.map((block, idx) => (
          <div
            key={idx}
            className="flex-1 flex flex-col justify-between border border-border rounded p-4 bg-muted/10 print:bg-transparent print:border-foreground/30 min-h-[140px]"
            data-testid={`signature-block-${idx}`}
          >
            <div>
              <div className="text-xs font-bold text-foreground text-center border-b border-border pb-1.5 mb-2">
                {block.title}
              </div>
              {block.note ? (
                <div className="text-xs text-muted-foreground text-center mb-1">
                  {block.note}
                </div>
              ) : null}
            </div>

            {/* Wet-ink signature box */}
            <div className="h-16 flex items-end justify-center pb-1">
              <span className="text-[11px] text-muted-foreground/60 italic print:hidden">
                ({block.signLabel ?? signLabel})
              </span>
            </div>

            <div className="space-y-1.5 border-t border-dashed border-border pt-2 text-xs">
              <div className="flex items-center gap-1.5">
                <span className="text-muted-foreground shrink-0">{block.nameLabel}:</span>
                <span className="border-b border-dotted border-border flex-1 min-w-[3rem]" />
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-muted-foreground shrink-0">{block.dateLabel}:</span>
                <span className="border-b border-dotted border-border flex-1 min-w-[3rem]" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
};
