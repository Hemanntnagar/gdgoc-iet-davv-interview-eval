/** RFC-4180 CSV parsing/serialization (quotes, commas, CRLF, embedded newlines). */

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  // Strip UTF-8 BOM
  if (text.charCodeAt(0) === 0xfeff) i = 1;
  const pushField = () => {
    row.push(field);
    field = '';
  };
  const pushRow = () => {
    pushField();
    // Ignore completely empty trailing lines
    if (!(row.length === 1 && row[0] === '')) rows.push(row);
    row = [];
  };
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ',') {
      pushField();
      i += 1;
      continue;
    }
    if (ch === '\r') {
      if (text[i + 1] === '\n') i += 1;
      pushRow();
      i += 1;
      continue;
    }
    if (ch === '\n') {
      pushRow();
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }
  if (field !== '' || row.length > 0) pushRow();
  return rows;
}

function escapeCsv(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const lines = [headers.map(escapeCsv).join(',')];
  for (const r of rows) lines.push(r.map(escapeCsv).join(','));
  // CRLF + trailing newline for spreadsheet compatibility
  return `${lines.join('\r\n')}\r\n`;
}

/** Parse an object-style CSV (header row) into records with trimmed values. */
export function parseCsvObjects(text: string): { records: Record<string, string>[]; error?: string } {
  const rows = parseCsv(text);
  if (rows.length === 0) return { records: [], error: 'CSV file is empty' };
  const headers = rows[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
  if (!headers.includes('full_name')) {
    return { records: [], error: 'Missing required column: full_name' };
  }
  const records: Record<string, string>[] = [];
  for (let r = 1; r < rows.length; r += 1) {
    const rec: Record<string, string> = {};
    headers.forEach((h, idx) => {
      rec[h] = (rows[r][idx] ?? '').trim();
    });
    records.push(rec);
  }
  return { records };
}
