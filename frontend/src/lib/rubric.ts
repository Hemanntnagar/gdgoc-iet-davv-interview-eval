/** Shared 1–10 star rubric constants (mirror of backend/src/lib/rubric.ts). */
export const RATING_DESCRIPTIONS: Record<number, string> = {
  1: 'Needs significant improvement',
  2: 'Well below expectations',
  3: 'Below expectations',
  4: 'Slightly below expectations',
  5: 'Meets expectations',
  6: 'Slightly above expectations',
  7: 'Above expectations',
  8: 'Exceeds expectations',
  9: 'Strongly exceeds expectations',
  10: 'Exceptional',
};

export const STAR_MIN = 1;
export const STAR_MAX = 10;

/** Individual score = mean of criterion stars; round only for display (2dp). */
export function meanOf(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function displayScore(n: number | null): string {
  return n === null ? '—' : Number(n).toFixed(2);
}
