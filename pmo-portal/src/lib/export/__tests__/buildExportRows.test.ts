import { describe, it, expect } from 'vitest';
import React from 'react';
import { buildExportRows } from '../buildExportRows';
import type { Column } from '@/src/components/ui';

type R = { name: string; value: number; status: string };

const cols: Column<R>[] = [
  { key: 'name', header: 'Name', cell: (r) => r.name, exportValue: (r) => r.name },
  { key: 'value', header: 'Value', cell: (r) => r.value, exportValue: (r) => r.value },
  { key: 'icon', header: 'Icon', cell: () => null }, // no exportValue
];
const rows: R[] = [{ name: 'Acme', value: 1500, status: 'open' }];

describe('buildExportRows', () => {
  it('AC-EXP-001: header = labels, body = exportValue per row in column order', () => {
    const { header, body } = buildExportRows(rows, cols);
    expect(header).toEqual(['Name', 'Value', 'Icon']);
    expect(body).toEqual([['Acme', 1500, '']]);
  });

  it('AC-EXP-002: a column with no exportValue serializes to empty string (never a React node)', () => {
    const { body } = buildExportRows(rows, cols);
    expect(body[0][2]).toBe('');
  });

  it('AC-EXP-001: a React-node header falls back to the column key', () => {
    const reactHeaderCols: Column<R>[] = [
      {
        key: 'name',
        header: React.createElement('span', null, 'X'),
        cell: (r) => r.name,
        exportValue: (r) => r.name,
      },
    ];
    const { header } = buildExportRows(rows, reactHeaderCols);
    expect(header).toEqual(['name']);
  });

  it('AC-EXP-001: empty rows produce a header but no body rows', () => {
    const { header, body } = buildExportRows([], cols);
    expect(header).toEqual(['Name', 'Value', 'Icon']);
    expect(body).toHaveLength(0);
  });

  it('LIB02-003: carries explicit export cell types through buildExportRows', () => {
    type RowWithDate = { name: string; amount: number; date: string; ref: string };
    const typedCols: Column<RowWithDate>[] = [
      { key: 'name', header: 'Name', cell: (r) => r.name, exportValue: (r) => r.name },
      { key: 'amount', header: 'Amount', cell: (r) => r.amount, exportValue: (r) => r.amount, kind: 'money' },
      { key: 'date', header: 'Date', cell: (r) => r.date, exportValue: (r) => r.date, exportType: 'date' },
      { key: 'ref', header: 'Reference', cell: (r) => r.ref, exportValue: (r) => r.ref, exportType: 'text' },
    ];
    const { types } = buildExportRows<RowWithDate>([], typedCols);
    expect(types).toEqual(['text', 'number', 'date', 'text']);
  });
});
