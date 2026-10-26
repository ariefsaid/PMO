import React, { useEffect, useId, useRef, useState } from 'react';
import { Button } from './Button';
import { cn } from './cn';
import { Icon } from './icons';

/**
 * A compact inline disclosure for a mobile list toolbar (FR-PRJUX-003).
 *
 * Unlike a popover, this is a real labelled `region` in normal document flow —
 * no portal, no absolute positioning, no focus trap. It opens beneath its trigger
 * and pushes the page content down (it never overlaps anything, so it can't clip
 * a 390px viewport).
 *
 * Behaviour:
 * - trigger carries `aria-expanded` + `aria-controls` and toggles the panel;
 * - on open, focus moves to the FIRST ENABLED interactive descendant (or to the
 *   panel itself when every descendant is disabled) so keyboard users land inside;
 * - Escape and an outside pointer-down close it AND restore focus to the trigger;
 * - normal Tab traversal is preserved (no focus trap) and the region is labelled
 *   by the trigger's label via `aria-labelledby`/aria-label.
 *
 * Supports both controlled (`open`/`onOpenChange`) and uncontrolled (`defaultOpen`)
 * usage so a consumer can close it after a selection or an action click.
 */
export interface MobileToolbarDisclosureProps {
  /** Accessible + visible label for the trigger and the panel region. */
  label: string;
  /** Use a named More icon on phones when the collection toolbar is space-constrained. */
  compactOnMobile?: boolean;
  /** The disclosure panel body (e.g. filter fields or bulk-action buttons). */
  children: React.ReactNode;
  /** Optional count badge on the trigger (e.g. active secondary-filter count). */
  count?: number;
  /** Classes for the outer wrapper (trigger + panel). */
  className?: string;
  /** Classes for the panel region. */
  panelClassName?: string;
  /** Controlled open state. */
  open?: boolean;
  /** Fired on every open/close change (controlled + uncontrolled). */
  onOpenChange?: (open: boolean) => void;
  /** Initial open state for uncontrolled usage. */
  defaultOpen?: boolean;
  /** Close after a native select changes and return focus to the trigger. */
  closeOnSelectChange?: boolean;
  /** Float the phone panel over the collection without moving its results. */
  mobileOverlay?: boolean;
  /** Align a floating phone panel with the start or end of its trigger. */
  mobileOverlayAlign?: 'start' | 'end';
}

// First selectors win; `:not([disabled])` handles disabled native controls so a
// disabled first child is skipped. `[tabindex]:not([tabindex="-1"])` catches any
// other explicitly-focusable element.
const FOCUSABLE =
  'button:not([disabled]), select:not([disabled]), input:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

function hasActiveDialog(): boolean {
  return Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]')).some((dialog) => {
    // The Assistant panel stays mounted as an inert, display:none dialog while
    // closed. A selector for role=dialog alone would block every disclosure.
    for (let node: HTMLElement | null = dialog; node; node = node.parentElement) {
      if (node.hasAttribute('inert') || node.hasAttribute('hidden') || node.getAttribute('aria-hidden') === 'true') return false;
      const style = window.getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
    }
    return true;
  });
}

export const MobileToolbarDisclosure: React.FC<MobileToolbarDisclosureProps> = ({
  label,
  compactOnMobile = false,
  children,
  count,
  className,
  panelClassName,
  open: openProp,
  onOpenChange,
  defaultOpen = false,
  closeOnSelectChange = false,
  mobileOverlay = false,
  mobileOverlayAlign = 'start',
}) => {
  const [internalOpen, setInternalOpen] = useState<boolean>(() => defaultOpen);
  const isControlled = openProp !== undefined;
  const isOpen = isControlled ? openProp : internalOpen;

  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const wasOpenRef = useRef(isOpen);

  const idPrefix = useId();
  const panelId = `${idPrefix}-panel`;

  const setOpen = (next: boolean) => {
    if (!isControlled) setInternalOpen(next);
    onOpenChange?.(next);
  };

  // On open, move focus to the first enabled interactive descendant — or to the
  // panel when none exists — so keyboard users land inside the disclosure.
  useEffect(() => {
    if (!isOpen || !panelRef.current) return;
    const panel = panelRef.current;
    const first = panel.querySelector<HTMLElement>(FOCUSABLE);
    if (first) {
      first.focus();
    } else {
      panel.focus();
    }
  }, [isOpen]);

  // A parent may close this controlled disclosure after an action such as Export.
  // Its focused action then unmounts and focus falls to <body>. Return focus to the
  // surviving trigger, but leave it alone when another disclosure has taken focus.
  useEffect(() => {
    if (wasOpenRef.current && !isOpen && document.activeElement === document.body) {
      triggerRef.current?.focus();
    }
    wasOpenRef.current = isOpen;
  }, [isOpen]);

  // Escape + outside pointer-down close and restore focus to the trigger. Listeners
  // are only attached while open, and cleaned up when it closes/unmounts.
  useEffect(() => {
    if (!isOpen) return;
    const closeAndRestoreFocus = () => {
      setOpen(false);
      triggerRef.current?.focus();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // A child portal dialog (e.g. the Import wizard) owns its own Escape handling.
      // Never let this disclosure close (unmounting the wizard mid-lifecycle) while one
      // is open on top — the wizard must stay mounted for its full lifecycle (DD-BIMP-3).
      if (hasActiveDialog()) return;
      e.preventDefault();
      closeAndRestoreFocus();
    };
    const onPointerDown = (e: Event) => {
      // A pointer-down anywhere outside the wrapper (incl. the trigger) closes — unless
      // it lands inside a child portal dialog, whose scrim must not unmount its wizard.
      const target = e.target as Node;
      // A portalled dialog and its scrim own pointer events until their close callback
      // completes. Unmounting the disclosure first would unmount the dialog too.
      if (hasActiveDialog()) return;
      // A sibling disclosure owns this click. Closing here would move its trigger
      // before click fires, so the pointer could miss the intended control.
      if (target instanceof Element && target.closest('[data-mobile-toolbar-disclosure-trigger]')) return;
      if (wrapperRef.current && !wrapperRef.current.contains(target)) {
        closeAndRestoreFocus();
        // Browser mousedown runs after pointerdown and can move focus back to
        // <body> when the outside target is non-interactive (for example a page
        // heading). Restore it after that default action, without stealing focus
        // from a real control the user clicked.
        window.setTimeout(() => {
          const active = document.activeElement;
          if ((active === document.body || active?.tagName === 'MAIN') && !hasActiveDialog()) {
            triggerRef.current?.focus();
          }
        }, 0);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  return (
    <div ref={wrapperRef} className={cn('relative min-w-0', className)}>
      <Button
        ref={triggerRef}
        data-mobile-toolbar-disclosure-trigger
        type="button"
        variant="outline"
        title={compactOnMobile ? label : undefined}
        className={cn('min-h-11 md:min-h-8', compactOnMobile && 'max-md:w-11 max-md:px-0')}
        aria-expanded={isOpen}
        aria-controls={panelId}
        onClick={() => setOpen(!isOpen)}
      >
        {compactOnMobile && <Icon name="menu" className="size-4 md:hidden" />}
        <span className={cn('flex items-center gap-1.5', compactOnMobile && 'max-md:sr-only')}>
          {label}
          {typeof count === 'number' && count > 0 && (
            <span
              data-testid="mobile-toolbar-count"
              className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-secondary px-1 text-[0.6875rem] font-semibold tabular text-muted-foreground"
            >
              {count}
            </span>
          )}
          <Icon name="chev" className={cn('size-3.5 shrink-0 transition-transform', isOpen && 'rotate-180')} />
        </span>
      </Button>
      {isOpen && (
        <div
          ref={panelRef}
          id={panelId}
          role="region"
          aria-label={label}
          tabIndex={-1}
          onChangeCapture={(event) => {
            if (!closeOnSelectChange || !(event.target instanceof HTMLSelectElement)) return;
            setOpen(false);
            triggerRef.current?.focus();
          }}
          className={cn(
            'mt-2 w-full min-w-0 max-w-full rounded-lg border border-border bg-card p-3 text-foreground',
            mobileOverlay && [
              'absolute top-full z-50 w-[min(22rem,calc(100vw-2rem))] max-h-[min(70dvh,32rem)] overflow-y-auto shadow-[0_10px_30px_hsl(240_10%_8%/0.16),0_2px_6px_hsl(240_10%_8%/0.08)]',
              mobileOverlayAlign === 'end' ? 'right-0' : 'left-0',
              'md:static md:mt-2 md:max-h-none md:w-full md:max-w-full md:overflow-visible md:shadow-none',
            ],
            compactOnMobile && mobileOverlay && 'max-md:fixed! max-md:inset-x-4! max-md:top-auto! max-md:w-auto! max-md:max-w-none!',
            panelClassName,
          )}
        >
          {children}
        </div>
      )}
    </div>
  );
};
