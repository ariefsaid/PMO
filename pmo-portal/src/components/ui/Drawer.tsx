import React, { useEffect, useId, useRef } from 'react';
import { Drawer as BaseDrawer } from '@base-ui/react/drawer';
import { useTranslation } from 'react-i18next';
import { cn } from './cn';
import { Icon } from './icons';
import { Button } from './Button';
import { RecordHeader } from './RecordHeader';
import { overlayBackdropClassName, overlayBackdropStyle } from './OverlaySurface';

// ---------------------------------------------------------------------------
// Drawer: the app's one right-side sheet (quick views, record previews, file viewer).
//
// Behaviour comes from Base UI's Drawer: focus trap and restore, Escape, outside
// press, swipe-to-dismiss on touch, enter/exit transition, scroll lock and the
// inert background. This file only supplies the look (DESIGN.md tokens) and the
// two rules the library cannot know:
//   - `loading` / `nestedOpen` veto a dismissal (mutation in flight; a nested
//     ConfirmDialog owns Escape and focus).
//   - stacking: drawers opened from separate React trees (the file viewer over a
//     record drawer) are not Base UI siblings, so a module-level stack lets only
//     the topmost one react to Escape or an outside press.
//
// One band below the modals (scrim z-[780], panel z-[790] vs their 800/810): a ConfirmDialog or
// form modal opened from a drawer sits above it, stays clickable and is not an "outside press".
// ---------------------------------------------------------------------------

/** Open drawers, oldest first. Only the last entry may be dismissed by Escape, outside press or swipe. */
const openStack: object[] = [];

export interface DrawerProps {
  open: boolean;
  /** Record name — the drawer's accessible name (aria-labelledby → the h2). */
  title: React.ReactNode;
  /** Optional subtitle (e.g. the type/status pill) → aria-describedby. */
  subtitle?: React.ReactNode;
  onClose: () => void;
  /** Mutation in flight: Esc/scrim lockout + close button disabled. */
  loading?: boolean;
  /**
   * A nested ConfirmDialog/EntityFormModal is open and owns focus + AT. While
   * true the drawer panel is made `inert` + aria-hidden and its own focus-trap
   * is suspended (so it doesn't fight the nested dialog's trap). Mirrors
   * EntityFormModal's discard-dialog pattern.
   */
  nestedOpen?: boolean;
  /** Desktop width preset: 'sm' = --drawer-width (default) | 'lg' = min(560px, 92vw). Drawers fill phones. */
  width?: 'sm' | 'lg';
  /** Optional border-top footer slot for secondary entry points. */
  footer?: React.ReactNode;
  /**
   * CW-3a: record-header anatomy. When `icon` or `status` is provided, the drawer
   * header renders the shared `RecordHeader` (name + status pill + a top-right
   * action zone) instead of the plain title/subtitle row — so a drawer record opens
   * with the SAME header anatomy as a full record page. `headerActions` holds the
   * record actions (Edit/Archive/Delete by permission), surfaced in the HEADER (not
   * the footer). `status` doubles as the drawer's aria-describedby content. The icon
   * itself is not drawn: a coloured tile in every drawer header is decoration.
   */
  icon?: React.ReactNode;
  /** Status pill node — surfaced beside the name in the RecordHeader anatomy. */
  status?: React.ReactNode;
  /** Top-right record action zone (Edit/Archive/Delete by permission). */
  headerActions?: React.ReactNode;
  children: React.ReactNode;
}

export const Drawer: React.FC<DrawerProps> = ({
  open,
  title,
  subtitle,
  onClose,
  loading = false,
  nestedOpen = false,
  width = 'sm',
  footer,
  icon,
  status,
  headerActions,
  children,
}) => {
  const { t } = useTranslation();
  const titleId = useId();
  const subId = useId();
  const stackToken = useRef({});

  useEffect(() => {
    if (!open) return;
    const token = stackToken.current;
    openStack.push(token);
    return () => {
      const index = openStack.indexOf(token);
      if (index >= 0) openStack.splice(index, 1);
    };
  }, [open]);

  const handleOpenChange = (next: boolean, details: BaseDrawer.Root.ChangeEventDetails) => {
    if (next) return;
    if (loading) {
      details.cancel();
      return;
    }
    if (details.reason === 'close-press') {
      onClose();
      return;
    }
    // Escape, outside press, focus-out, swipe: a nested dialog or a drawer above owns them.
    // A press inside a modal opened from this drawer (not a drawer itself) is not "outside".
    const target = details.event?.target;
    const inNestedModal = target instanceof Element
      && Boolean(target.closest('[aria-modal="true"]:not([data-drawer-panel])'));
    if (nestedOpen || inNestedModal || openStack[openStack.length - 1] !== stackToken.current) {
      details.cancel();
      return;
    }
    onClose();
  };

  // CW-3a: when record-header props are supplied the drawer header renders the shared
  // RecordHeader anatomy (icon + name + status + top-right action zone) instead of the
  // plain title/subtitle row. The dialog's accessible name/description stay wired via
  // visually-hidden id anchors (RecordHeader's own h1/status carry no stable ids).
  const useRecordHeader = icon != null || status != null || headerActions != null;

  return (
    <BaseDrawer.Root open={open} onOpenChange={handleOpenChange} swipeDirection="right">
      <BaseDrawer.Portal>
        <BaseDrawer.Backdrop
          data-testid="drawer-scrim"
          className={cn('fixed inset-0 z-[780]', overlayBackdropClassName)}
          style={overlayBackdropStyle}
        />
        <BaseDrawer.Viewport className="fixed inset-0 z-[790] flex items-stretch justify-end">
          <BaseDrawer.Popup
            // Shared-toast placement seam (issue 1816): marks this overlay as an
            // edge-anchored drawer so ToastProvider tucks toasts below the header
            // band instead of on top of it (the generic dialog remedy lands exactly
            // there). Every drawer built on this component inherits the rule.
            data-drawer-panel
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={subtitle ? subId : undefined}
            // While a nested ConfirmDialog/Modal is open it owns focus + AT; make
            // the panel inert so the background can't be tabbed into or read.
            inert={nestedOpen || undefined}
            aria-hidden={nestedOpen || undefined}
            className={cn(
              // Edge-anchored: full-height right panel, square against the viewport
              // edge (inner cards keep their own radius); the left border is the only seam.
              'drawer-sheet flex h-full flex-col border-l border-border bg-popover outline-none',
              'max-md:w-full',
              width === 'lg' ? 'md:w-[min(560px,92vw)]' : 'md:w-[min(420px,92vw)]',
            )}
          >
            {/* Header */}
            <div data-drawer-header className="flex items-start gap-2 border-b border-border bg-secondary px-[var(--space-content-inset)] py-3">
              {useRecordHeader ? (
                <div className="min-w-0 flex-1">
                  {/* Visually-hidden a11y anchor: RecordHeader's own h1 carries no stable
                      id, so the dialog's accessible name (aria-labelledby) points here. */}
                  <span id={titleId} className="sr-only">
                    {title}
                  </span>
                  <RecordHeader
                    variant="drawer"
                    icon={null}
                    name={title}
                    status={status}
                    meta={subtitle}
                    metaId={subtitle ? subId : undefined}
                    actions={headerActions}
                  />
                </div>
              ) : (
                <div className="min-w-0 flex-1">
                  <h2
                    id={titleId}
                    className="break-words text-control font-semibold text-popover-foreground"
                  >
                    {title}
                  </h2>
                  {subtitle && (
                    <div id={subId} className="mt-1 break-words text-control text-muted-foreground">
                      {subtitle}
                    </div>
                  )}
                </div>
              )}
              <BaseDrawer.Close
                disabled={loading}
                render={<Button variant="ghost" iconOnly aria-label={t('entityForm.close', 'Close')} />}
              >
                <Icon name="x" />
              </BaseDrawer.Close>
            </div>

            {/* Body (scrollable). Content lets a mouse select text without starting a swipe. */}
            <BaseDrawer.Content className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-[var(--space-content-inset)] py-[var(--space-content-inset)]">
              {children}
            </BaseDrawer.Content>

            {/* Optional footer action row */}
            {footer && (
              <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-[var(--space-content-inset)] pt-2 pb-4">
                {footer}
              </div>
            )}
          </BaseDrawer.Popup>
        </BaseDrawer.Viewport>
      </BaseDrawer.Portal>
    </BaseDrawer.Root>
  );
};

Drawer.displayName = 'Drawer';
