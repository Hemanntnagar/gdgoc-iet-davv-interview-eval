/**
 * Scoring rules (documented, configurable per round via criteria weights):
 * - If a round has active criteria: overall = weighted mean of criterion scores.
 * - If a round has no active criteria: the judge supplies a single overall_score.
 * - Candidate average = mean of overall_scores of SUBMITTED evaluations only.
 *   Missing evaluations are never counted as zero.
 * - Rounding: 2 decimals, half away from zero (matches PostgreSQL round(numeric)).
 */

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface CriterionInput {
  id: string;
  min_score: number;
  max_score: number;
  weight: number;
}

export class ScoreError extends Error {
  details: Record<string, string>;
  constructor(details: Record<string, string>) {
    super('Invalid scores');
    this.details = details;
  }
}

/** Validate criterion scores and compute the weighted overall score. */
export function computeOverallFromCriteria(
  criteria: CriterionInput[],
  scores: Record<string, number>,
): number {
  const details: Record<string, string> = {};
  let weightedSum = 0;
  let weightTotal = 0;
  for (const c of criteria) {
    const raw = scores[c.id];
    if (raw === undefined || raw === null || Number.isNaN(Number(raw))) {
      details[c.id] = 'Score is required';
      continue;
    }
    const s = Number(raw);
    if (s < c.min_score || s > c.max_score) {
      details[c.id] = `Score must be between ${c.min_score} and ${c.max_score}`;
      continue;
    }
    weightedSum += s * c.weight;
    weightTotal += c.weight;
  }
  if (Object.keys(details).length > 0) throw new ScoreError(details);
  if (weightTotal <= 0) throw new ScoreError({ _: 'No active criteria weights' });
  return round2(weightedSum / weightTotal);
}

export function validateOverallScore(value: unknown, min = 1, max = 10): number {
  const s = Number(value);
  if (value === undefined || value === null || Number.isNaN(s) || s < min || s > max) {
    throw new ScoreError({ overall_score: `Score must be between ${min} and ${max}` });
  }
  return round2(s);
}

/** Mean of numbers; returns null for an empty list (never 0 for "no data"). */
export function meanOrNull(values: number[]): number | null {
  if (values.length === 0) return null;
  const sum = values.reduce((a, b) => a + b, 0);
  return round2(sum / values.length);
}
