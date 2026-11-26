import React, { useContext, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/src/components/ui/cn';
import { Icon } from '@/src/components/ui/icons';
import { MODULES } from './routeMatch';
import { AuthContext } from '@/src/auth/AuthContext';

export interface BreadcrumbPart {
  label: string;
  /** Contractual project identity disclosed on hover. */
  title?: string;
  /** Client-side navigation for a parent crumb; the last part omits it (current). */
  onClick?: () => void;
  /**
   * Local URL for an anchor-backed parent crumb. With `onClick`, a plain click runs the callback;
   * without it, the link navigates natively. Modified clicks always stay native.
   */
  href?: string;
  /**
   * Optional accessible name override for the clickable crumb button when the label
   * alone does not describe the destination (WCAG 2.4.6). Used for the 'My Views'
   * crumb that links to '/' (Dashboard) until a /views index route ships (OD-4, I4/I5).
   */
  ariaLabel?: string;
  /**
   * Optional i18n key. When present, `label` is the English source (fallback) and the
   * rendered text is `t(i18nKey, label)` at the shell's i18n boundary — so route-derived
   * crumbs agree with the locally-labelled rail in every locale instead of leaking an
   * English constant. Only set on the Administration + personal-integrations crumbs.
   */
  i18nKey?: string;
}

interface BreadcrumbProps {
  parts: BreadcrumbPart[];
  className?: string;
}

/** Wayfinding links remain visible and truncate within the header at every width.
 * Below the rail breakpoint, a page with its own title bounds the current crumb. */
/** True while the page body carries its own visible h1 (the phone top bar then stays empty). */
const usePageHasTitle = (): boolean => {
  const [has, setHas] = useState(false);
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const check = () => setHas(Boolean(document.querySelector('main h1, #main-content h1, [role="main"] h1')));
    check();
    const observer = typeof MutationObserver === 'undefined' ? null : new MutationObserver(check);
    observer?.observe(document.body, { childList: true, subtree: true });
    return () => observer?.disconnect();
  }, []);
  return has;
};

export const Breadcrumb: React.FC<BreadcrumbProps> = ({ parts, className }) => {
  const { t } = useTranslation();
  const pageHasTitle = usePageHasTitle();
  // The signed-in role (never a preview role): it decides which pages actually open.
  const realRole = useContext(AuthContext)?.role ?? null;
  // A parent crumb is a doorway only when this person can open it: a project manager on an invoice
  // sees where the record lives ("Finance > Receivables") without a link to a page that refuses them.
  const canOpen = (href: string | undefined): boolean => {
    if (!href || !realRole) return true;
    const destination = MODULES.find((module) => module.path === href.split('?')[0]);
    return !destination?.roles || (destination.roles as string[]).includes(realRole);
  };
  // Pending/not-found crumbs carry shared shell vocabulary keys that routeMatch attaches
  // dynamically (object properties), which catalogue extraction cannot see — so resolve those
  // two through the literal t() references below (same parser-visible pattern as Rail's
  // staticNavLabels). Every other crumb localizes through its own attached key.
  const STATE_CRUMBS: Record<string, string> = {
    'shell.breadcrumb.recordLoading': t('shell.breadcrumb.recordLoading', 'Loading…'),
    'shell.breadcrumb.recordNotFound': t('shell.breadcrumb.recordNotFound', 'Not found'),
  };
  const filteredModule = typeof window === 'undefined'
    ? undefined
    : MODULES.find((module) => module.path.includes('?') && module.path === `${window.location.pathname}${window.location.search}`);
  const visibleParts = filteredModule && parts.length > 0
    ? parts.map((part, index) => index === parts.length - 1
      ? { ...part, label: filteredModule.label, i18nKey: filteredModule.labelKey }
      : part)
    : parts;
  const resolveCrumb = (part: BreadcrumbPart): string => {
    if (!part.i18nKey) return part.label;
    // The two state crumbs come from the pre-resolved literal references above;
    // every other crumb localizes through its own attached key.
    return STATE_CRUMBS[part.i18nKey] ?? t(part.i18nKey, part.label);
  };
  return (
    <nav
      aria-label={t('shell.breadcrumb.label', 'Breadcrumb')}
      // One line in the 56px top bar: a long record name truncates (full name in its title) instead of wrapping out of the bar.
      className={cn('flex min-w-0 flex-nowrap items-center gap-2 overflow-hidden text-control', typeof window !== 'undefined' && window.location.pathname === '/my-tasks' && pageHasTitle && 'invisible', className)}
    >
      {visibleParts.length === 1 && (
        <span aria-hidden className="grid size-6 shrink-0 place-items-center rounded-[7px] bg-primary text-control font-bold text-primary-foreground min-[1101px]:hidden">P</span>
      )}
      {visibleParts.map((part, i) => {
        const last = i === parts.length - 1;
        const label = resolveCrumb(part);
        const parentTruncation = i > 0 ? 'min-w-[4rem] flex-1 truncate max-w-[10rem]' : 'min-w-[3rem] max-w-[6rem] truncate';
        return (
          <React.Fragment key={i}>
            {i > 0 && (
              // The parent remains a visible way back at phone widths.
              <span
                aria-hidden
                className="shrink-0 opacity-50 [&_svg]:size-3.5"
              >
                <Icon name="chev" />
              </span>
            )}
            {!last && (part.onClick || part.href) && !canOpen(part.href) ? (
              <span title={part.title ?? label} className={cn(parentTruncation, 'text-muted-foreground')}>
                {label}
              </span>
            ) : last || (!part.onClick && !part.href) ? (
              <span
                aria-current="page"
                title={part.title ?? (typeof label === 'string' ? label : undefined)}
                className={cn(
                  'min-w-0 truncate font-semibold text-foreground',
                  visibleParts.length > 2 && 'min-[1101px]:min-w-[4rem] min-[1101px]:flex-1 min-[1101px]:max-w-[18rem]',
                  pageHasTitle && 'max-[1100px]:max-w-[12rem]',
                )}
              >
                {label}
              </span>
            ) : (
              // C3: parent crumb links hide at exactly the breakpoint where the phoneOnly
              // BackBar shows (max-[1100px]), so no width has neither way back (#735).
              part.href ? (
                <a
                  href={part.href}
                  onClick={(event) => {
                    // No callback → plain link: the browser (or a guard upstream) handles it.
                    if (
                      !part.onClick ||
                      event.defaultPrevented ||
                      event.button !== 0 ||
                      event.metaKey ||
                      event.ctrlKey ||
                      event.shiftKey ||
                      event.altKey
                    ) {
                      return;
                    }
                    event.preventDefault();
                    part.onClick();
                  }}
                  aria-label={part.ariaLabel}
                  title={part.title ?? label}
                  className={cn(parentTruncation, 'text-muted-foreground hover:text-foreground')}
                >
                  {label}
                </a>
              ) : (
                <button
                  type="button"
                  onClick={part.onClick}
                  aria-label={part.ariaLabel}
                  title={part.title ?? label}
                  className={cn(parentTruncation, 'text-muted-foreground hover:text-foreground')}
                >
                  {label}
                </button>
              )
            )}
          </React.Fragment>
        );
      })}
    </nav>
  );
};
