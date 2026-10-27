import { SelectField } from '../ui/FormFields';

export type StatementPeriodKind = 'month' | 'quarter' | 'fiscal_year';

export interface StatementPeriodChoice {
  kind: StatementPeriodKind;
  periodStart: string;
  label: string;
}

export interface StatementPeriodPickerProps {
  kind: StatementPeriodKind;
  periodStart: string | null;
  periods: readonly StatementPeriodChoice[];
  labels: {
    kind: string;
    period: string;
    month: string;
    quarter: string;
    fiscalYear: string;
    choosePeriod: string;
    noPeriods: string;
  };
  disabled?: boolean;
  onKindChange: (kind: StatementPeriodKind) => void;
  onPeriodChange: (periodStart: string) => void;
}

const PERIOD_KINDS: readonly StatementPeriodKind[] = ['month', 'quarter', 'fiscal_year'];

export function StatementPeriodPicker({
  kind,
  periodStart,
  periods,
  labels,
  disabled = false,
  onKindChange,
  onPeriodChange,
}: StatementPeriodPickerProps) {
  const kindOptions = [
    { value: 'month', label: labels.month },
    { value: 'quarter', label: labels.quarter },
    { value: 'fiscal_year', label: labels.fiscalYear },
  ];
  const periodChoices = periods.filter((period) => period.kind === kind);
  const periodOptions = periodChoices.map((period) => ({
    value: period.periodStart,
    label: period.label,
  }));
  const selectedPeriod =
    periodStart !== null && periodChoices.some((period) => period.periodStart === periodStart)
      ? periodStart
      : '';

  const handleKindChange = (value: string) => {
    if (disabled) return;
    const nextKind = PERIOD_KINDS.find((candidate) => candidate === value);
    if (nextKind) onKindChange(nextKind);
  };

  const handlePeriodChange = (value: string) => {
    if (disabled || periodChoices.length === 0) return;
    if (periodChoices.some((period) => period.periodStart === value)) onPeriodChange(value);
  };

  return (
    <div className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2">
      <SelectField
        label={labels.kind}
        value={kind}
        options={kindOptions}
        onChange={handleKindChange}
        disabled={disabled}
      />
      <SelectField
        label={labels.period}
        value={selectedPeriod}
        options={periodOptions}
        onChange={handlePeriodChange}
        placeholder={periodChoices.length === 0 ? labels.noPeriods : labels.choosePeriod}
        disabled={disabled || periodChoices.length === 0}
      />
    </div>
  );
}
