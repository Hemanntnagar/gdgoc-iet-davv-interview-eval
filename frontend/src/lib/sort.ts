export type SortDirection = 'asc' | 'desc';

export type SortAccessor<T> = (row: T, key: string) => unknown;

function isEmpty(value: unknown): boolean {
  return value === null || value === undefined || value === '';
}

/**
 * Compare two cell values. Numbers compare numerically; everything else uses a
 * natural, case-insensitive comparison so "Panel 2" sorts before "Panel 10"
 * and vertical names sort alphabetically.
 */
export function compareValues(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b);
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

/** Stable sort with empty values always last, regardless of direction. */
export function sortRows<T>(
  rows: T[],
  key: string | null,
  dir: SortDirection,
  getValue: SortAccessor<T>,
): T[] {
  if (!key) return rows;
  const indexed = rows.map((row, index) => ({ row, index, value: getValue(row, key) }));
  indexed.sort((a, b) => {
    const aEmpty = isEmpty(a.value);
    const bEmpty = isEmpty(b.value);
    if (aEmpty || bEmpty) {
      if (aEmpty && bEmpty) return a.index - b.index;
      return aEmpty ? 1 : -1;
    }
    const cmp = compareValues(a.value, b.value);
    if (cmp === 0) return a.index - b.index;
    return dir === 'asc' ? cmp : -cmp;
  });
  return indexed.map((entry) => entry.row);
}
