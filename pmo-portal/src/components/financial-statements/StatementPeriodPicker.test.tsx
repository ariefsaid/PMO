import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  StatementPeriodPicker,
  type StatementPeriodChoice,
  type StatementPeriodKind,
  type StatementPeriodPickerProps,
} from './StatementPeriodPicker';

const catalogueChoices: readonly StatementPeriodChoice[] = [
  { kind: 'month', periodStart: '2024-07-01', label: 'July 2024' },
  { kind: 'month', periodStart: '2024-08-01', label: 'August 2024' },
  { kind: 'quarter', periodStart: '2024-07-01', label: 'July–September 2024' },
  { kind: 'quarter', periodStart: '2024-10-01', label: 'October–December 2024' },
  {
    kind: 'fiscal_year',
    periodStart: '2024-07-01',
    label: 'FY 2024/25 (July 2024–June 2025)',
  },
];

const englishLabels: StatementPeriodPickerProps['labels'] = {
  kind: 'Period type',
  period: 'Reporting period',
  month: 'Month',
  quarter: 'Quarter',
  fiscalYear: 'Fiscal year',
  choosePeriod: 'Choose a period',
  noPeriods: 'No periods available',
};

const indonesianLabels: StatementPeriodPickerProps['labels'] = {
  kind: 'Jenis periode',
  period: 'Periode laporan',
  month: 'Bulan',
  quarter: 'Triwulan',
  fiscalYear: 'Tahun fiskal',
  choosePeriod: 'Pilih periode',
  noPeriods: 'Tidak ada periode',
};

function pickerProps(overrides: Partial<StatementPeriodPickerProps> = {}): StatementPeriodPickerProps {
  return {
    kind: 'month',
    periodStart: '2024-07-01',
    periods: catalogueChoices,
    labels: englishLabels,
    onKindChange: vi.fn<(kind: StatementPeriodKind) => void>(),
    onPeriodChange: vi.fn<(periodStart: string) => void>(),
    ...overrides,
  };
}

function optionValues(select: HTMLElement): string[] {
  return Array.from(select.querySelectorAll('option')).map((option) => option.value);
}

describe('StatementPeriodPicker', () => {
  it('renders two labelled native selects with the signed kinds and catalogue order/keys', () => {
    const props = pickerProps();
    const { container } = render(<StatementPeriodPicker {...props} />);
    const kindSelect = screen.getByLabelText('Period type');
    const periodSelect = screen.getByLabelText('Reporting period');

    expect(kindSelect.tagName).toBe('SELECT');
    expect(periodSelect.tagName).toBe('SELECT');
    expect(screen.getAllByRole('combobox')).toHaveLength(2);
    expect(optionValues(kindSelect)).toEqual(['month', 'quarter', 'fiscal_year']);
    expect(within(kindSelect).getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Month',
      'Quarter',
      'Fiscal year',
    ]);
    expect(optionValues(periodSelect)).toEqual(['', '2024-07-01', '2024-08-01']);
    expect(within(periodSelect).getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Choose a period',
      'July 2024',
      'August 2024',
    ]);
    expect(periodSelect).toHaveValue('2024-07-01');
    expect(container.querySelector('input')).toBeNull();
  });

  it('filters by the controlled kind while preserving every supplied non-January fiscal choice in order', () => {
    const props = pickerProps({ onKindChange: vi.fn(), onPeriodChange: vi.fn() });
    const { rerender } = render(<StatementPeriodPicker {...props} />);

    rerender(<StatementPeriodPicker {...props} kind="quarter" periodStart="2024-10-01" />);
    expect(optionValues(screen.getByLabelText('Reporting period'))).toEqual([
      '',
      '2024-07-01',
      '2024-10-01',
    ]);
    expect(within(screen.getByLabelText('Reporting period')).getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Choose a period',
      'July–September 2024',
      'October–December 2024',
    ]);
    expect(screen.getByLabelText('Reporting period')).toHaveValue('2024-10-01');

    rerender(
      <StatementPeriodPicker
        {...props}
        kind="fiscal_year"
        periodStart="2024-07-01"
      />,
    );
    expect(optionValues(screen.getByLabelText('Reporting period'))).toEqual(['', '2024-07-01']);
    expect(within(screen.getByLabelText('Reporting period')).getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Choose a period',
      'FY 2024/25 (July 2024–June 2025)',
    ]);
    expect(props.onKindChange).not.toHaveBeenCalled();
    expect(props.onPeriodChange).not.toHaveBeenCalled();
  });

  it('emits only the exact valid controlled change and waits for parent props to update', async () => {
    const user = userEvent.setup();
    const onKindChange = vi.fn<(kind: StatementPeriodKind) => void>();
    const onPeriodChange = vi.fn<(periodStart: string) => void>();
    render(
      <StatementPeriodPicker
        {...pickerProps({ onKindChange, onPeriodChange })}
        onKindChange={onKindChange}
        onPeriodChange={onPeriodChange}
      />,
    );
    const kindSelect = screen.getByLabelText('Period type');
    const periodSelect = screen.getByLabelText('Reporting period');

    await user.selectOptions(kindSelect, 'quarter');
    expect(onKindChange).toHaveBeenCalledTimes(1);
    expect(onKindChange).toHaveBeenCalledWith('quarter');
    expect(onPeriodChange).not.toHaveBeenCalled();
    expect(kindSelect).toHaveValue('month');

    await user.selectOptions(periodSelect, '2024-08-01');
    expect(onPeriodChange).toHaveBeenCalledTimes(1);
    expect(onPeriodChange).toHaveBeenCalledWith('2024-08-01');
    expect(onKindChange).toHaveBeenCalledTimes(1);
    expect(periodSelect).toHaveValue('2024-07-01');
  });

  it('uses placeholders for null or stale keys and never corrects selection during catalogue/locale rerenders', () => {
    const props = pickerProps({ periodStart: null, onKindChange: vi.fn(), onPeriodChange: vi.fn() });
    const { rerender } = render(<StatementPeriodPicker {...props} />);
    expect(screen.getByLabelText('Reporting period')).toHaveValue('');
    expect(screen.getByRole('option', { name: 'Choose a period' })).toBeDisabled();

    const replacementCatalogue: readonly StatementPeriodChoice[] = [
      { kind: 'quarter', periodStart: '2031-04-01', label: 'April–June 2031' },
    ];
    rerender(
      <StatementPeriodPicker
        {...props}
        kind="quarter"
        periodStart="1999-01-01"
        periods={replacementCatalogue}
        labels={indonesianLabels}
      />,
    );

    const periodSelect = screen.getByLabelText('Periode laporan');
    expect(screen.getByLabelText('Jenis periode')).toBeInTheDocument();
    expect(periodSelect).toHaveValue('');
    expect(within(periodSelect).getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Pilih periode',
      'April–June 2031',
    ]);
    expect(props.onKindChange).not.toHaveBeenCalled();
    expect(props.onPeriodChange).not.toHaveBeenCalled();
  });

  it('disables only an empty period select and leaves kind selection available', async () => {
    const user = userEvent.setup();
    const onKindChange = vi.fn<(kind: StatementPeriodKind) => void>();
    const onPeriodChange = vi.fn<(periodStart: string) => void>();
    render(
      <StatementPeriodPicker
        {...pickerProps({
          periods: [
            { kind: 'quarter', periodStart: '2024-07-01', label: 'July–September 2024' },
          ],
          periodStart: null,
        })}
        onKindChange={onKindChange}
        onPeriodChange={onPeriodChange}
      />,
    );

    const kindSelect = screen.getByLabelText('Period type');
    const periodSelect = screen.getByLabelText('Reporting period');
    expect(kindSelect).toBeEnabled();
    expect(periodSelect).toBeDisabled();
    expect(within(periodSelect).getByRole('option', { name: 'No periods available' })).toBeDisabled();

    await user.selectOptions(kindSelect, 'quarter');
    expect(onKindChange).toHaveBeenCalledTimes(1);
    expect(onKindChange).toHaveBeenCalledWith('quarter');
    expect(onPeriodChange).not.toHaveBeenCalled();
  });

  it('disables both controls and ignores disallowed synthetic change events', () => {
    const onKindChange = vi.fn<(kind: StatementPeriodKind) => void>();
    const onPeriodChange = vi.fn<(periodStart: string) => void>();
    const { rerender } = render(
      <StatementPeriodPicker
        {...pickerProps({ onKindChange, onPeriodChange })}
        onKindChange={onKindChange}
        onPeriodChange={onPeriodChange}
        disabled
      />,
    );

    const disabledKind = screen.getByLabelText('Period type');
    const disabledPeriod = screen.getByLabelText('Reporting period');
    expect(disabledKind).toBeDisabled();
    expect(disabledPeriod).toBeDisabled();
    fireEvent.change(disabledKind, { target: { value: 'week' } });
    fireEvent.change(disabledPeriod, { target: { value: '2031-04-01' } });
    expect(onKindChange).not.toHaveBeenCalled();
    expect(onPeriodChange).not.toHaveBeenCalled();

    rerender(
      <StatementPeriodPicker
        {...pickerProps({ onKindChange, onPeriodChange })}
        onKindChange={onKindChange}
        onPeriodChange={onPeriodChange}
      />,
    );
    fireEvent.change(screen.getByLabelText('Period type'), { target: { value: 'week' } });
    fireEvent.change(screen.getByLabelText('Reporting period'), { target: { value: '2031-04-01' } });
    expect(onKindChange).not.toHaveBeenCalled();
    expect(onPeriodChange).not.toHaveBeenCalled();
  });

  it('keeps English and Indonesian labels visible with distinct native associations across instances', () => {
    const first = pickerProps();
    const second = pickerProps({
      labels: indonesianLabels,
      periodStart: '2024-08-01',
      periods: [
        { kind: 'month', periodStart: '2024-07-01', label: 'Juli 2024' },
        { kind: 'month', periodStart: '2024-08-01', label: 'Agustus 2024' },
      ],
    });
    render(
      <>
        <StatementPeriodPicker {...first} />
        <StatementPeriodPicker {...second} />
      </>,
    );

    const selects = [
      screen.getByLabelText('Period type'),
      screen.getByLabelText('Reporting period'),
      screen.getByLabelText('Jenis periode'),
      screen.getByLabelText('Periode laporan'),
    ];
    const ids = selects.map((select) => select.id);
    expect(new Set(ids).size).toBe(4);
    for (const select of selects) {
      expect(select.id).not.toBe('');
      expect(document.querySelector(`label[for="${select.id}"]`)).toBeVisible();
    }
    expect(within(screen.getByLabelText('Jenis periode')).getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Bulan',
      'Triwulan',
      'Tahun fiskal',
    ]);
    expect(within(screen.getByLabelText('Periode laporan')).getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Pilih periode',
      'Juli 2024',
      'Agustus 2024',
    ]);
    expect(screen.getByText('Month')).toBeVisible();
    expect(screen.getByText('Agustus 2024')).toBeVisible();
  });

  it('uses the shared responsive native field grammar and preserves tab order/focus on selection', async () => {
    const user = userEvent.setup();
    const props = pickerProps({ onKindChange: vi.fn(), onPeriodChange: vi.fn() });
    const { container } = render(<StatementPeriodPicker {...props} />);
    const layout = container.firstElementChild;
    const kindSelect = screen.getByLabelText('Period type');
    const periodSelect = screen.getByLabelText('Reporting period');

    expect(layout).toHaveClass('min-w-0', 'grid', 'grid-cols-1', 'gap-4', 'md:grid-cols-2');
    expect(container.querySelectorAll('select')).toHaveLength(2);
    for (const select of [kindSelect, periodSelect]) {
      expect(select).toHaveClass('h-8', 'rounded-md', 'border-input');
    }

    await user.tab();
    expect(document.activeElement).toBe(kindSelect);
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(kindSelect);
    await user.tab();
    expect(document.activeElement).toBe(periodSelect);
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(periodSelect);
  });
});
