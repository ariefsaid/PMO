import { createParser } from '@openuidev/react-lang';
import { describe, expect, it } from 'vitest';
import { assistantLibrary } from './assistantLibrary';

describe('assistant OpenUI component library', () => {
  it('registers the product-owned answer and data components in OpenUI Lang', () => {
    const schema = assistantLibrary.toJSONSchema();

    expect(Object.keys(schema.$defs ?? {}).sort()).toEqual([
      'Answer',
      'DataChart',
      'DataTable',
      'KPITile',
      'RecordLink',
      'StatTiles',
      'Text',
    ]);
    expect(schema.functions).toBeUndefined();
    expect(schema.actions).toBeUndefined();
  });

  it('parses a grounded KPI answer with nested product components', () => {
    const parser = createParser(assistantLibrary.toJSONSchema(), assistantLibrary.root);
    const result = parser.parse(
      'metric = KPITile("Active projects", 3, "blue")\nroot = Answer("Active projects", [metric])',
    );

    expect(result.meta.errors).toEqual([]);
    expect(result.queryStatements).toEqual([]);
    expect(result.mutationStatements).toEqual([]);
    expect(result.root?.typeName).toBe('Answer');
    expect(result.root?.props.children).toEqual([
      expect.objectContaining({ typeName: 'KPITile' }),
    ]);
  });
});
