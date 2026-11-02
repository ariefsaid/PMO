import { useState, useRef, useEffect } from 'react';

export interface ColumnSizeConfig {
  key: string;
  kind?: string;
  size?: number;
  minSize?: number;
  maxSize?: number;
}

export function columnMinSize(column: ColumnSizeConfig): number | undefined {
  const contractMin = column.kind === 'primary' ? 240 : column.kind === 'status' ? 112 : undefined;
  return contractMin === undefined ? column.minSize : Math.max(contractMin, column.minSize ?? contractMin);
}

export function columnMaxSize(column: ColumnSizeConfig): number | undefined {
  const contractMax = column.kind === 'primary' ? 640 : column.kind === 'status' ? 220 : undefined;
  const maximum = column.maxSize ?? contractMax;
  const minimum = columnMinSize(column);
  return maximum === undefined ? undefined : Math.max(maximum, minimum ?? 0);
}

export function columnDefaultSize(column: ColumnSizeConfig): number | undefined {
  return column.size ?? (column.kind === 'primary' ? 320 : column.kind === 'status' ? 140 : undefined);
}

export function readColumnSizing(
  tableId: string | undefined,
  userId: string | undefined,
  columns: ColumnSizeConfig[],
): Record<string, number> {
  if (!tableId || !userId || typeof window === 'undefined') return {};
  try {
    const saved = window.localStorage.getItem(`pmo.table.${tableId}.widths.v1:${userId}`);
    if (!saved) return {};
    const value: unknown = JSON.parse(saved);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const known = new Map(columns.map((column) => [column.key, column]));
    return Object.fromEntries(
      Object.entries(value).flatMap(([key, width]) => {
        const column = known.get(key);
        if (!column || typeof width !== 'number' || !Number.isFinite(width)) return [];
        const min = columnMinSize(column) ?? 20;
        const max = columnMaxSize(column) ?? 900;
        return [[key, Math.min(max, Math.max(min, width))]];
      }),
    );
  } catch {
    return {};
  }
}

export function useTableColumnSizing(
  tableId: string | undefined,
  userId: string | undefined,
  columns: ColumnSizeConfig[],
) {
  const [columnSizing, setColumnSizing] = useState<Record<string, number>>(() =>
    readColumnSizing(tableId, userId, columns),
  );
  const widthIdentity = `${tableId ?? ''}:${userId ?? ''}`;
  const previousWidthIdentity = useRef(widthIdentity);

  useEffect(() => {
    if (previousWidthIdentity.current === widthIdentity) return;
    previousWidthIdentity.current = widthIdentity;
    setColumnSizing(readColumnSizing(tableId, userId, columns));
  }, [tableId, userId, columns, widthIdentity]);

  const onColumnSizingChange = (
    updater: ((current: Record<string, number>) => Record<string, number>) | Record<string, number>,
  ) => {
    setColumnSizing((current) => {
      const next = typeof updater === 'function' ? updater(current) : updater;
      if (tableId && userId && typeof window !== 'undefined') {
        try {
          window.localStorage.setItem(`pmo.table.${tableId}.widths.v1:${userId}`, JSON.stringify(next));
        } catch {
          // Storage is an enhancement; live resizing remains available when it is denied.
        }
      }
      return next;
    });
  };

  return { columnSizing, setColumnSizing, onColumnSizingChange };
}
