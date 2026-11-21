import { Button } from '@/src/components/ui/Button';
import { Card, CardHead, CardPad } from '@/src/components/ui/Card';

export interface ManagementProfitLossCardProps {
  labels: { title: string; line: string; openReports: string; setUp: string; marginHint: string; marginSetting: string };
  /** Omitted when the viewer's plan has no Reports screen: the line alone remains. */
  onOpenReports?: () => void;
  /** Admin / integration managers only. */
  onSetUp?: () => void;
  /** Admin only: points to the Profit per discipline setting that adds cost and margin to the report. */
  onOpenMarginSetting?: () => void;
}

/** #2734: what Statements shows an organisation with no accounting system connected. */
export function ManagementProfitLossCard({ labels, onOpenReports, onSetUp, onOpenMarginSetting }: ManagementProfitLossCardProps) {
  return (
    <section aria-labelledby="mgmt-pl-title" className="min-w-0">
      <Card className="min-w-0">
        <CardHead level={2} id="mgmt-pl-title" className="min-w-0 break-words">{labels.title}</CardHead>
        <CardPad className="flex min-w-0 flex-col gap-3">
          <p className="min-w-0 break-words text-control text-muted-foreground">{labels.line}</p>
          {onOpenMarginSetting && (
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 text-control text-muted-foreground">
              <span className="min-w-0 break-words">{labels.marginHint}</span>
              <Button variant="ghost" size="sm" onClick={onOpenMarginSetting}>{labels.marginSetting}</Button>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {onOpenReports && <Button variant="outline" onClick={onOpenReports}>{labels.openReports}</Button>}
            {onSetUp && <Button variant="ghost" onClick={onSetUp}>{labels.setUp}</Button>}
          </div>
        </CardPad>
      </Card>
    </section>
  );
}
