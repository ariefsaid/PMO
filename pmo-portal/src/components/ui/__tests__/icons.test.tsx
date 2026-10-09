/**
 * Icon has a default 1em size so classless usages never balloon (timesheet toolbar regression, 2026-06-14)
 *
 * Root cause: <svg> had no default width/height, so classless <Icon> rendered
 * at ~77px (SVG user-agent default). Fixed via presentational attributes
 * width="1em" height="1em" — a Tailwind class always wins over a presentation
 * attribute, so explicit className / width / height props cleanly override.
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Icon, ICON_NAMES } from '../icons';
import * as legacyIcons from '../../../../components/icons';

describe('Icon', () => {
  it('AC-ICON-001: classless <Icon> renders with default width="1em" and height="1em" so it scales to surrounding text instead of ballooning', () => {
    render(<Icon name="plus" data-testid="icon" />);
    const svg = screen.getByTestId('icon');
    expect(svg).toHaveAttribute('width', '1em');
    expect(svg).toHaveAttribute('height', '1em');
  });

  it('AC-ICON-002: <Icon> with explicit className still carries the class (override path intact)', () => {
    render(<Icon name="plus" className="h-5 w-5" data-testid="icon" />);
    const svg = screen.getByTestId('icon');
    expect(svg).toHaveClass('h-5 w-5');
  });

  it('UIP-001: every compatibility and semantic key renders a named 24px stroke-2 icon', () => {
    const compatibilityKeys = [
      'grid', 'pipe', 'cart', 'folder', 'clock', 'doc', 'x', 'plus', 'help', 'up', 'down',
      'check', 'lock', 'alert', 'inbox', 'refresh', 'back', 'chev', 'cal', 'dollar', 'table',
      'cols', 'cards', 'export', 'search', 'bell', 'admin', 'pencil', 'trash', 'upload', 'file',
      'download', 'eye', 'eye-off', 'message', 'sun', 'moon', 'plug', 'info',
    ];
    expect(compatibilityKeys.every((name) => ICON_NAMES.includes(name as (typeof ICON_NAMES)[number]))).toBe(true);
    const { container } = render(
      <>{ICON_NAMES.map((name) => <Icon key={name} name={name} data-icon={name} />)}</>,
    );
    const icons = [...container.querySelectorAll('svg[data-icon]')];
    expect(icons).toHaveLength(ICON_NAMES.length);
    for (const icon of icons) {
      expect(icon).toHaveAttribute('viewBox', '0 0 24 24');
      expect(icon).toHaveAttribute('stroke', 'currentColor');
      expect(icon).toHaveAttribute('stroke-width', '2');
      expect(icon).toHaveAttribute('stroke-linecap', 'round');
      expect(icon).toHaveAttribute('stroke-linejoin', 'round');
      expect(icon).toHaveAttribute('aria-hidden', 'true');
      expect(icon.children.length).toBeGreaterThan(0);
    }
  });

  it('UIP-001: all 25 legacy named icon exports remain facade-backed shims', () => {
    const mappings = [
      [legacyIcons.DashboardIcon, 'dashboard'], [legacyIcons.ProjectsIcon, 'projects'],
      [legacyIcons.ProcurementIcon, 'procurement'], [legacyIcons.TimesheetsIcon, 'clock'],
      [legacyIcons.TasksIcon, 'tasks'], [legacyIcons.CompaniesIcon, 'companies'],
      [legacyIcons.ReportsIcon, 'reports'], [legacyIcons.AdminIcon, 'admin'],
      [legacyIcons.UserIcon, 'user'], [legacyIcons.BuildingOfficeIcon, 'companies'],
      [legacyIcons.CalendarDaysIcon, 'cal'], [legacyIcons.CurrencyDollarIcon, 'dollar'],
      [legacyIcons.CheckCircleIcon, 'circle-check'], [legacyIcons.ClockIcon, 'clock'],
      [legacyIcons.PlusIcon, 'plus'], [legacyIcons.ClipboardDocumentCheckIcon, 'clipboard-check'],
      [legacyIcons.ChartBarIcon, 'chart-column'], [legacyIcons.PencilSquareIcon, 'pencil'],
      [legacyIcons.TrashIcon, 'trash'], [legacyIcons.Squares2X2Icon, 'cards'],
      [legacyIcons.TableCellsIcon, 'table'], [legacyIcons.FunnelIcon, 'funnel'],
      [legacyIcons.DocumentIcon, 'doc'], [legacyIcons.CloudArrowUpIcon, 'cloud-upload'],
      [legacyIcons.EyeIcon, 'eye'],
    ] as const;
    const { container } = render(<>{mappings.map(([Component, name], index) => <Component key={`${name}-${index}`} />)}</>);
    const icons = [...container.querySelectorAll('svg[data-icon]')];
    expect(icons.map((icon) => icon.getAttribute('data-icon'))).toEqual(mappings.map(([, name]) => name));
    for (const icon of icons) expect(icon).toHaveAttribute('stroke-width', '2');
  });

  it('UIP-001: explicit width prop overrides the default presentational attribute', () => {
    render(<Icon name="plus" width={20} data-testid="icon" />);
    const svg = screen.getByTestId('icon');
    // React sets numeric width as a string attribute
    expect(svg).toHaveAttribute('width', '20');
  });
});
