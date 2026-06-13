/**
 * AC-EXP-001: buildWorksheet maps column headers and exportValue correctly.
 * AC-EXP-002: React node cells with no exportValue produce an empty string (not "[object Object]").
 * AC-EXP-003: Columns that have no exportValue and render a React node are exported as "".
 * AC-EXP-004: Numeric exportValue is preserved as a number in the cell value map.
 */

import { describe, it, expect } from 'vitest';
import { buildWorksheetData } from '../buildWorksheet';
import type { Column } from '@/src/components/ui';
import React from 'react';

interface Row {
  id: string;
  name: string;
  value: number;
  status: string;
}

const rows: Row[] = [
  { id: '1', name: 'Alpha', value: 1000, status: 'Open' },
  { id: '2', name: 'Beta', value: 2500, status: 'Closed' },
];

describe('buildWorksheetData', () => {
  it('AC-EXP-001: returns headers matching column keys that have exportValue or string cell', () => {
    const columns: Column<Row>[] = [
      {
        key: 'name',
        header: 'Name',
        cell: (r) => r.name,
        exportValue: (r) => r.name,
      },
      {
        key: 'value',
        header: 'Value',
        align: 'num',
        cell: (r) => r.value,
        exportValue: (r) => r.value,
      },
    ];
    const { headers, dataRows } = buildWorksheetData(rows, columns);
    expect(headers).toEqual(['Name', 'Value']);
    expect(dataRows).toHaveLength(2);
    expect(dataRows[0]).toEqual(['Alpha', 1000]);
    expect(dataRows[1]).toEqual(['Beta', 2500]);
  });

  it('AC-EXP-001: uses column header string for the worksheet header', () => {
    const columns: Column<Row>[] = [
      { key: 'name', header: 'Company Name', cell: (r) => r.name, exportValue: (r) => r.name },
    ];
    const { headers } = buildWorksheetData(rows, columns);
    expect(headers[0]).toBe('Company Name');
  });

  it('AC-EXP-002: React node cells with no exportValue produce empty string', () => {
    const columns: Column<Row>[] = [
      {
        key: 'status',
        header: 'Status',
        // cell returns a React element — no exportValue
        cell: (r) => React.createElement('span', null, r.status),
      },
      {
        key: 'name',
        header: 'Name',
        cell: (r) => r.name,
        exportValue: (r) => r.name,
      },
    ];
    const { dataRows } = buildWorksheetData(rows, columns);
    // Status column has React node but no exportValue → ''
    expect(dataRows[0][0]).toBe('');
    // Name column has exportValue → 'Alpha'
    expect(dataRows[0][1]).toBe('Alpha');
  });

  it('AC-EXP-003: columns with no exportValue and string cell render the string value', () => {
    const columns: Column<Row>[] = [
      {
        key: 'status',
        header: 'Status',
        // cell returns a plain string (JSX text)
        cell: (r) => r.status,
        // no exportValue
      },
    ];
    const { dataRows } = buildWorksheetData(rows, columns);
    // A plain-string cell (typeof === 'string') is safe to export directly
    expect(dataRows[0][0]).toBe('Open');
    expect(dataRows[1][0]).toBe('Closed');
  });

  it('AC-EXP-004: numeric exportValue is preserved as number (not stringified)', () => {
    const columns: Column<Row>[] = [
      { key: 'value', header: 'Value', cell: (r) => r.value, exportValue: (r) => r.value },
    ];
    const { dataRows } = buildWorksheetData(rows, columns);
    expect(typeof dataRows[0][0]).toBe('number');
    expect(dataRows[0][0]).toBe(1000);
  });

  it('AC-EXP-001: empty rows produce a header row but no data rows', () => {
    const columns: Column<Row>[] = [
      { key: 'name', header: 'Name', cell: (r) => r.name, exportValue: (r) => r.name },
    ];
    const { headers, dataRows } = buildWorksheetData([], columns);
    expect(headers).toEqual(['Name']);
    expect(dataRows).toHaveLength(0);
  });
});
