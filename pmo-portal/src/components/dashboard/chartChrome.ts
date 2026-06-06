import { chartTheme } from '@/src/components/ui/chartTheme';

/**
 * Shared recharts chrome derived from DESIGN.md tokens (replaces the legacy
 * `rgba(31,41,55,.8)` tooltip + `#…` axis fills). Tooltip = card bg + border +
 * popover shadow; cursor = quiet secondary wash.
 */
export const tooltipContentStyle: React.CSSProperties = {
  background: 'hsl(var(--popover))',
  border: '1px solid hsl(var(--border))',
  borderRadius: 8,
  boxShadow: '0 10px 30px hsl(240 10% 8% / 0.16)',
  color: 'hsl(var(--popover-foreground))',
  fontSize: 12.5,
  padding: '8px 10px',
};

export const tooltipLabelStyle: React.CSSProperties = {
  color: 'hsl(var(--muted-foreground))',
  fontSize: 11.5,
  fontWeight: 600,
};

export const tooltipCursorFill = { fill: 'hsl(var(--secondary))', opacity: 0.6 } as const;

export const axisTickStyle = { fill: chartTheme.axis, fontSize: 11 } as const;
