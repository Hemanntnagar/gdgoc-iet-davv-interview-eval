/**
 * The five initial evaluation criteria (editable by admins before/during
 * recruitment — these are only the defaults created with each new round).
 *
 * Scale: clickable 1–5 star rating with these exact descriptions.
 */
export const RATING_DESCRIPTIONS: Record<number, string> = {
  1: 'Needs significant improvement',
  2: 'Below expectations',
  3: 'Meets expectations',
  4: 'Exceeds expectations',
  5: 'Exceptional',
};

export const STAR_MIN = 1;
export const STAR_MAX = 5;

export interface DefaultCriterion {
  name: string;
  description: string;
}

export const DEFAULT_CRITERIA: DefaultCriterion[] = [
  {
    name: 'Curiosity and Willingness to Learn',
    description:
      'Asks thoughtful questions, explores beyond the brief, and shows eagerness to pick up new tools or ideas.',
  },
  {
    name: 'Dedication and Commitment',
    description:
      'Effort visible in the submitted task, reliability, and how seriously they treat deadlines and responsibilities.',
  },
  {
    name: 'Confidence and Communication',
    description:
      'Clarity while explaining decisions, composure under questions, and structure in verbal and written communication.',
  },
  {
    name: 'Quality of Submitted Task',
    description:
      'Depth, correctness and polish of the task submitted before the interview, judged against the brief.',
  },
  {
    name: 'Problem-Solving and Role-Specific Skills',
    description:
      'Approach to unfamiliar problems and demonstrated skill for the vertical they applied to.',
  },
];

/** Round an interviewer's mean up/down at display time only (never mid-calculation). */
export function displayScore(n: number): string {
  return n.toFixed(2);
}
