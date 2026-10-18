import { describe, expect, it } from 'vitest';
import {
  computeOverallFromCriteria,
  meanOrNull,
  round2,
  ScoreError,
  validateOverallScore,
} from '../src/lib/scoring.js';

describe('scoring', () => {
  it('rounds half away from zero to 2 decimals', () => {
    expect(round2(8.005)).toBe(8.01);
    expect(round2(8.004)).toBe(8.0);
    expect(round2(1.235)).toBe(1.24);
  });

  it('meanOrNull returns null (not 0) for no evaluations', () => {
    expect(meanOrNull([])).toBeNull();
  });

  it('computes the mean of valid submitted scores only', () => {
    expect(meanOrNull([8, 7, 9, 6, 10])).toBe(8);
  });

  it('weighted criteria average with default weights', () => {
    const criteria = [
      { id: 'a', min_score: 1, max_score: 10, weight: 1 },
      { id: 'b', min_score: 1, max_score: 10, weight: 1 },
    ];
    expect(computeOverallFromCriteria(criteria, { a: 8, b: 6 })).toBe(7);
  });

  it('honours weights', () => {
    const criteria = [
      { id: 'a', min_score: 1, max_score: 10, weight: 3 },
      { id: 'b', min_score: 1, max_score: 10, weight: 1 },
    ];
    // (9*3 + 5*1) / 4 = 8
    expect(computeOverallFromCriteria(criteria, { a: 9, b: 5 })).toBe(8);
  });

  it('rejects out-of-range and missing criterion scores', () => {
    const criteria = [
      { id: 'a', min_score: 1, max_score: 10, weight: 1 },
      { id: 'b', min_score: 1, max_score: 10, weight: 1 },
    ];
    expect(() => computeOverallFromCriteria(criteria, { a: 11, b: 5 })).toThrow(ScoreError);
    expect(() => computeOverallFromCriteria(criteria, { a: 5 })).toThrow(ScoreError);
  });

  it('validates single overall scores', () => {
    expect(validateOverallScore(7.5)).toBe(7.5);
    expect(() => validateOverallScore(0)).toThrow(ScoreError);
    expect(() => validateOverallScore(11)).toThrow(ScoreError);
    expect(() => validateOverallScore(undefined)).toThrow(ScoreError);
  });
});
