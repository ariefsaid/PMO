import React from 'react';
import { Icon } from '@/src/components/ui/icons';
import { useTheme } from '@/src/hooks/useTheme';

/**
 * ThemeToggle — F2 dark-mode icon button for the top bar.
 *
 * A11y contract (see __tests__/ThemeToggle.test.tsx): the button's aria-label
 * names the ACTION it will perform, reflecting the CURRENT theme state — so a
 * screen-reader user hears "Switch to dark theme" while in light mode (and
 * vice-versa). The icon is decorative (aria-hidden); the label carries meaning.
 *
 * Sizing/hit-area mirror the other top-bar icon buttons (`.touch-target` extends
 * the tappable area to ≥44px on coarse pointers per WCAG 2.5.5; the visual is
 * the same 32px square). Tokens only — color comes from `text-muted-foreground`
 * + `hover:bg-accent`.
 */
export const ThemeToggle: React.FC = () => {
  const { theme, toggle } = useTheme();
  const isDark = theme === 'dark';
  // Label = the action clicking will perform (target state), per current state.
  const label = isDark ? 'Switch to light theme' : 'Switch to dark theme';

  return (
    <button
      type="button"
      aria-label={label}
      onClick={toggle}
      className="touch-target theme-toggle grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground [&_svg]:size-[17px]"
    >
      {/* Moon in light mode (where you'll go), sun in dark mode — intuitive target. */}
      <Icon name={isDark ? 'sun' : 'moon'} />
    </button>
  );
};
