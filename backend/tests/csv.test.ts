import { describe, expect, it } from 'vitest';
import { parseCsv, parseCsvObjects, toCsv } from '../src/lib/csv.js';

describe('csv', () => {
  it('parses quoted fields, commas and newlines', () => {
    const rows = parseCsv('a,"b,c","d""e"\r\n1,2,3\n');
    expect(rows).toEqual([
      ['a', 'b,c', 'd"e'],
      ['1', '2', '3'],
    ]);
  });

  it('serializes with escaping and CRLF', () => {
    const csv = toCsv(['name', 'note'], [['Ada, "Lovelace"', 'line1\nline2']]);
    expect(csv).toContain('"Ada, ""Lovelace"""');
    expect(csv).toContain('"line1\nline2"');
    expect(csv.startsWith('name,note\r\n')).toBe(true);
  });

  it('round-trips through parseCsvObjects', () => {
    const csv = toCsv(['full_name', 'branch', 'panel'], [['Grace Hopper', 'CSE', 'Panel A']]);
    const { records, error } = parseCsvObjects(csv);
    expect(error).toBeUndefined();
    expect(records).toEqual([{ full_name: 'Grace Hopper', branch: 'CSE', panel: 'Panel A' }]);
  });

  it('rejects files without full_name column', () => {
    const { error } = parseCsvObjects('name,branch\nX,Y\n');
    expect(error).toMatch(/full_name/);
  });

  it('strips BOM and trims header/cell whitespace', () => {
    const { records } = parseCsvObjects('﻿ Full Name , Branch \n Alan Turing , Math \n');
    expect(records[0].full_name).toBe('Alan Turing');
    expect(records[0].branch).toBe('Math');
  });
});
