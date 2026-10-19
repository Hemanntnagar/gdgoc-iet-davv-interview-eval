/** Shared 1–5 star rubric constants (mirror of backend/src/lib/rubric.ts). */
export const RATING_DESCRIPTIONS: Record<number, string> = {
  1: 'Needs significant improvement',
  2: 'Below expectations',
  3: 'Meets expectations',
  4: 'Exceeds expectations',
  5: 'Exceptional',
};

export const STAR_MIN = 1;
export const STAR_MAX = 5;

/** Individual score = mean of criterion stars; round only for display (2dp). */
export function meanOf(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function displayScore(n: number | null): string {
  return n === null ? '—' : Number(n).toFixed(2);
}
