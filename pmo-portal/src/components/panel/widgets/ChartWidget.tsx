import React from 'react';
import { useTranslation } from 'react-i18next';
import { StatusBarChart } from '@/src/components/dashboard/StatusBarChart';
import { ChartFrame } from '@/src/components/dashboard/ChartFrame';
import { chartTheme } from '@/src/components/ui/chartTheme';
import type { WidgetPayload } from '@/src/lib/agent/widgets/schema';

type ChartPayload = Extract<WidgetPayload, { kind: 'data_chart' }>;

export const ChartWidget: React.FC<{ widget: ChartPayload }> = ({ widget }) => {
  const { t } = useTranslation('assistantPanel');
  const chartData = widget.series.map((s) => ({ status: s.label, count: s.value }));
  const seriesTokens = Object.values(chartTheme.series);
  const labels = chartData.map((d) => d.status);
  const toneFor = (status: string) =>
    seriesTokens[Math.max(0, labels.indexOf(status)) % seriesTokens.length];
  return (
    <ChartFrame state="ready">
      {/* Item 4 (F2, review-remediation): the panel is a fixed ~365px-content-width
          container — far narrower than StatusBarChart's own useIsNarrow() viewport-
          width branch would ever detect on a desktop screen. compactYAxis (container-
          appropriate, opt-in) hides the Y-axis ticks + pins an explicit domain so the
          chart can never render a non-monotonic/garbled axis at this width; the
          existing figcaption legend already carries every count. */}
      <StatusBarChart
        data={chartData}
        toneFor={toneFor}
        label={widget.caption ?? t('widgetResults', 'Results')}
        noun={t('widgetNoun', 'items')}
        compactYAxis
      />
    </ChartFrame>
  );
};
